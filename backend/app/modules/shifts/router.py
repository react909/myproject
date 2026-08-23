"""Маршруты кассовой смены.

Модуль был, и часть его маршрутов держит работающую кассу: `services/posShift.ts`
ходит в `/current`, `/open`, `/{id}/close` и в список. Их формы ответов
СОХРАНЕНЫ целиком — новые поля добавлены рядом, ни одно старое не убрано и не
переименовано. Раздел «Смена» пользуется новыми полями, касса продолжает читать
старые.

Что изменилось по сути:

* открытая смена ОДНА на установку, а не одна на кассира (см. service.py);
* попытка открыть вторую — отказ 409 с кодом `shift_already_open`, а не тихий
  возврат чужой смены;
* закрыть смену с расхождением можно только объяснив его или из-под открытой
  двери владельца. Правило проверяется на сервере для ЛЮБОГО клиента, включая
  саму кассу: правило, которое обходится другим полем в запросе, — не правило.

История смен вынесена в `/history` отдельным маршрутом. Старый `GET /api/shifts`
не тронут: он отдаёт список массивом, на этом стоит касса, и превращать его в
объект со страницами значило бы сломать её ради удобства нового раздела.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.backup import create_daily_backup
from app.core.elevation import DOOR_OWNER, ELEVATION_IDLE_MINUTES, registry
from app.core.money import to_som
from app.core.security import get_current_user
from app.db.database import current_db_mode, get_db_session
from app.db.models import CashMovement, Sale, Shift, User
from app.modules.panel.repository import REFUND_STATUSES, REVENUE_STATUSES
from app.modules.shifts import service
from app.modules.shifts.service import refunded_amount, tiyin_sum

logger = logging.getLogger("nurcrm.shifts")

router = APIRouter(prefix="/api/shifts", tags=["shifts"])

# Потолок страницы истории. Тот же, что у журнала чеков: страница, которую
# нельзя нарисовать за кадр, никому не нужна.
MAX_PAGE = 200


# ── Схемы ─────────────────────────────────────────────────────────────────────


class ShiftOut(BaseModel):
    """Смена в старой форме — ровно та, что читает касса.

    Ни одно поле отсюда убирать нельзя: `services/posShift.ts` разбирает их
    поимённо. Новые поля добавлены ниже, необязательными.
    """

    id: int
    status: str
    opened_at: str
    closed_at: str | None
    open_cash: float
    close_cash: float
    sales_count: int
    sales_total: float
    user_id: int
    cashbox_name: str

    # ── Добавлено вместе с разделом «Смена» ──
    number: int = 0
    opened_by_name: str = ""
    closed_by_name: str = ""
    open_cash_tiyin: int = 0
    counted_cash_tiyin: int = 0
    expected_cash_tiyin: int = 0
    variance_tiyin: int = 0
    variance_reason: str = ""
    #: Была ли сверка вообще. У смен, закрытых до появления раздела, её не было,
    #: и ноль в расхождении у них значит «не сверяли», а не «сошлось ровно».
    reconciled: bool = False


class ShiftMetricsOut(BaseModel):
    """Показатели смены. Всё в тыйынах — на фронте делится на сто один раз."""

    sales_count: int
    refunds_count: int
    revenue_tiyin: int
    cash_tiyin: int
    card_tiyin: int
    qr_tiyin: int
    debt_tiyin: int
    refunds_tiyin: int
    discounts_tiyin: int
    avg_check_tiyin: int


class ShiftStateOut(BaseModel):
    """Полное состояние смены: сама смена, показатели и наличные в ящике."""

    shift: ShiftOut
    metrics: ShiftMetricsOut
    #: Сколько наличных должно быть в ящике прямо сейчас.
    expected_cash_tiyin: int
    #: Внесено и изъято за смену — отдельно, чтобы полосу состояния можно было
    #: показать без второго запроса за списком движений.
    deposits_tiyin: int
    withdrawals_tiyin: int
    #: Сколько смена идёт, в секундах. Считается на сервере: часы кассы могут
    #: отставать, а «смена идёт 14 часов» — повод её закрыть.
    duration_seconds: int


class MovementOut(BaseModel):
    id: int
    kind: str
    amount_tiyin: int
    reason: str
    comment: str
    actor_name: str
    created_at: str


class MovementsPage(BaseModel):
    items: list[MovementOut]
    next_cursor: str | None = None


class ShiftOpenRequest(BaseModel):
    # Старое поле кассы. Осталось, чтобы `posShift.ts` работал без правок.
    open_cash: float = Field(default=0, ge=0)
    cashbox_name: str = "Основная"
    #: Новое поле раздела «Смена»: та же сумма целыми тыйынами. Если пришло —
    #: имеет приоритет над `open_cash`: целое точнее.
    open_cash_tiyin: int | None = Field(default=None, ge=0)
    cashier_name: str = ""


class ShiftCloseRequest(BaseModel):
    # Старое поле кассы: фактические наличные в сомах.
    close_cash: float = Field(default=0, ge=0)
    #: Новое поле: те же фактические наличные целыми тыйынами.
    counted_cash_tiyin: int | None = Field(default=None, ge=0)
    #: Чем объяснили расхождение. Без него и без двери владельца смену с
    #: расхождением закрыть нельзя.
    variance_reason: str = Field(default="", max_length=512)


class CashMovementRequest(BaseModel):
    kind: str = Field(pattern="^(deposit|withdrawal)$")
    amount_tiyin: int = Field(gt=0)
    reason: str = Field(default="", max_length=128)
    comment: str = Field(default="", max_length=512)
    #: Кто забрал деньги при изъятии. При внесении обычно пусто.
    actor_name: str = Field(default="", max_length=255)


class ShiftHistoryRow(BaseModel):
    id: int
    number: int
    opened_at: str
    closed_at: str | None
    status: str
    cashier: str
    revenue_tiyin: int
    cash_tiyin: int
    cashless_tiyin: int
    refunds_tiyin: int
    variance_tiyin: int
    reconciled: bool


class ShiftHistoryPage(BaseModel):
    items: list[ShiftHistoryRow]
    next_cursor: str | None = None


class ShiftReportOut(BaseModel):
    """Данные для печати отчёта. Разметку строит фронт — он же печатает чеки."""

    kind: str  # x — промежуточный, z — итоговый
    shift: ShiftOut
    metrics: ShiftMetricsOut
    expected_cash_tiyin: int
    deposits_tiyin: int
    withdrawals_tiyin: int
    printed_at: str
    printed_by: str


# ── Преобразования ────────────────────────────────────────────────────────────


def _shift_out(s: Shift) -> ShiftOut:
    return ShiftOut(
        id=s.id,
        status=s.status,
        opened_at=s.opened_at.isoformat() if s.opened_at else "",
        closed_at=s.closed_at.isoformat() if s.closed_at else None,
        open_cash=s.open_cash,
        close_cash=s.close_cash,
        sales_count=s.sales_count,
        sales_total=s.sales_total,
        user_id=s.user_id,
        cashbox_name=s.cashbox_name,
        number=s.number,
        opened_by_name=s.opened_by_name,
        closed_by_name=s.closed_by_name,
        open_cash_tiyin=s.open_cash_tiyin,
        counted_cash_tiyin=s.counted_cash_tiyin,
        expected_cash_tiyin=s.expected_cash_tiyin,
        variance_tiyin=s.variance_tiyin,
        variance_reason=s.variance_reason,
        # Сверка была, если смена закрыта и расчётная сумма записана. У смен,
        # закрытых до появления раздела, она нулевая — и это честно значит
        # «не сверяли», а не «сошлось».
        reconciled=s.status == "closed" and s.expected_cash_tiyin != 0,
    )


def _metrics_out(m: service.ShiftMetrics) -> ShiftMetricsOut:
    return ShiftMetricsOut(
        sales_count=m.sales_count,
        refunds_count=m.refunds_count,
        revenue_tiyin=m.revenue_tiyin,
        cash_tiyin=m.cash_tiyin,
        card_tiyin=m.card_tiyin,
        qr_tiyin=m.qr_tiyin,
        debt_tiyin=m.debt_tiyin,
        refunds_tiyin=m.refunds_tiyin,
        discounts_tiyin=m.discounts_tiyin,
        avg_check_tiyin=m.avg_check_tiyin,
    )


async def _movement_totals(session: AsyncSession, shift_id: int) -> tuple[int, int]:
    """Внесено и изъято за смену — одним запросом на оба числа.

    Через `case`, а не через двухаргументные `max`/`min`: у них разное имя в
    SQLite и в Postgres, а установка с несколькими кассами работает на втором.
    """
    positive = case((CashMovement.amount_tiyin > 0, CashMovement.amount_tiyin), else_=0)
    negative = case((CashMovement.amount_tiyin < 0, CashMovement.amount_tiyin), else_=0)
    row = (
        await session.execute(
            select(
                func.coalesce(func.sum(positive), 0).label("deposits"),
                func.coalesce(func.sum(negative), 0).label("withdrawals"),
            ).where(CashMovement.shift_id == shift_id)
        )
    ).one()
    return int(row.deposits or 0), abs(int(row.withdrawals or 0))


async def _state(session: AsyncSession, shift: Shift) -> ShiftStateOut:
    metrics = await service.fetch_metrics(session, shift.id)
    deposits, withdrawals = await _movement_totals(session, shift.id)
    expected = (
        int(shift.open_cash_tiyin) + metrics.cash_tiyin + deposits - withdrawals
        if shift.status == "open"
        # У закрытой смены расчётная сумма — снимок на момент закрытия. Считать
        # её заново нельзя: формула могла измениться, а сверялись по той.
        else shift.expected_cash_tiyin
    )
    ended = shift.closed_at or datetime.now(UTC)
    began = shift.opened_at
    duration = 0
    if began is not None:
        # Время в базе может прийти без часового пояса (старые строки SQLite).
        # Приводим к UTC, а не падаем: разница дат — не повод не показать смену.
        if began.tzinfo is None:
            began = began.replace(tzinfo=UTC)
        if ended.tzinfo is None:
            ended = ended.replace(tzinfo=UTC)
        duration = max(0, int((ended - began).total_seconds()))
    return ShiftStateOut(
        shift=_shift_out(shift),
        metrics=_metrics_out(metrics),
        expected_cash_tiyin=expected,
        deposits_tiyin=deposits,
        withdrawals_tiyin=withdrawals,
        duration_seconds=duration,
    )


async def _load(session: AsyncSession, shift_id: int) -> Shift:
    shift = (
        await session.execute(select(Shift).where(Shift.id == shift_id))
    ).scalar_one_or_none()
    if shift is None:
        raise HTTPException(status_code=404, detail="Смена не найдена.")
    return shift


# ── Маршруты ──────────────────────────────────────────────────────────────────
#
# Порядок объявления значим: `/current`, `/state`, `/history` обязаны стоять
# ВЫШЕ `/{shift_id}`, иначе FastAPI разберёт слово «current» как номер смены и
# ответит 422 на каждый запрос кассы.


@router.get("/current", response_model=ShiftOut | None)
async def current_shift(
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> ShiftOut | None:
    """Открытая смена в старой форме. Этим маршрутом живёт касса."""
    shift = await service.current_open_shift(session)
    return _shift_out(shift) if shift else None


@router.get("/state", response_model=ShiftStateOut | None)
async def current_state(
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> ShiftStateOut | None:
    """Полное состояние открытой смены — витрина раздела «Смена».

    Отдельно от `/current`, а не расширением его: `/current` дёргает касса
    после каждой продажи, и вешать на неё два агрегата значило бы платить за
    отчёт на горячем пути.
    """
    shift = await service.current_open_shift(session)
    return await _state(session, shift) if shift else None


@router.get("/history", response_model=ShiftHistoryPage)
async def shift_history(
    date_from: str | None = None,
    date_to: str | None = None,
    cashier: str = "",
    limit: int = Query(default=50, ge=1, le=MAX_PAGE),
    cursor: str | None = None,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> ShiftHistoryPage:
    """История смен: фильтры, сортировка и страницы — в SQL.

    Показатели каждой строки берутся из ОДНОГО запроса с группировкой по
    смене, а не запросом на строку. Список из пятидесяти смен, каждая со своим
    агрегатом по чекам, — это ровно тот «запрос в цикле», которого быть не
    должно; на полутысяче смен он занимал бы секунды.
    """
    conditions = []
    if date_from:
        try:
            conditions.append(Shift.opened_at >= datetime.fromisoformat(date_from))
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверная дата начала периода.")
    if date_to:
        try:
            conditions.append(Shift.opened_at <= datetime.fromisoformat(date_to))
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверная дата конца периода.")
    if cashier.strip():
        conditions.append(Shift.opened_by_name.ilike(f"%{cashier.strip()}%"))
    if cursor:
        try:
            conditions.append(Shift.id < int(cursor))
        except ValueError:
            # Испорченный курсор — не повод падать: отдаём первую страницу.
            pass

    # Страница смен — сначала сами смены, и только по ним агрегат. Обратный
    # порядок (агрегат по всем чекам, потом отбор) заставил бы обойти всю
    # таблицу продаж ради пятидесяти строк.
    page = list(
        (
            await session.execute(
                select(Shift).where(*conditions).order_by(Shift.id.desc()).limit(limit + 1)
            )
        ).scalars().all()
    )
    has_more = len(page) > limit
    page = page[:limit]
    if not page:
        return ShiftHistoryPage(items=[], next_cursor=None)

    # Закрытые смены отдают снимок, снятый при закрытии; агрегат считается
    # только для ОТКРЫТЫХ, а их не больше одной.
    #
    # Так история перестаёт зависеть от объёма продаж. Пока агрегат шёл по
    # всей странице, замер на 500 сменах и 120 000 чеках давал 64 мс — и
    # индекс не помогал: страница в 50 смен покрывает десятую часть всех
    # чеков, и полный проход по ним и есть правильный план. Со снимком тот же
    # запрос читает только строки смен.
    live_ids = [s.id for s in page if s.status == "open"]
    totals: dict[int, object] = {}
    if live_ids:
        is_revenue = Sale.status.in_(REVENUE_STATUSES)
        is_refund = Sale.status.in_(REFUND_STATUSES)
        refunded = refunded_amount()
        totals = {
            row.shift_id: row
            for row in (
                await session.execute(
                    select(
                        Sale.shift_id,
                        tiyin_sum(case((is_revenue, Sale.total), else_=0.0)).label("revenue"),
                        tiyin_sum(Sale.cash_received - Sale.change_amount).label("cash"),
                        tiyin_sum(Sale.card_amount).label("cashless"),
                        tiyin_sum(case((is_refund, refunded), else_=0.0)).label("refunds"),
                    )
                    .where(Sale.shift_id.in_(live_ids))
                    .group_by(Sale.shift_id)
                )
            ).all()
        }

    def _figure(shift: Shift, field: str) -> int:
        if shift.status == "open":
            return int(getattr(totals.get(shift.id), field, 0) or 0)
        return int(getattr(shift, f"{field}_tiyin"))

    items = [
        ShiftHistoryRow(
            id=s.id,
            number=s.number,
            opened_at=s.opened_at.isoformat() if s.opened_at else "",
            closed_at=s.closed_at.isoformat() if s.closed_at else None,
            status=s.status,
            cashier=s.opened_by_name,
            revenue_tiyin=_figure(s, "revenue"),
            cash_tiyin=_figure(s, "cash"),
            cashless_tiyin=_figure(s, "cashless"),
            refunds_tiyin=_figure(s, "refunds"),
            variance_tiyin=s.variance_tiyin,
            reconciled=s.status == "closed" and s.expected_cash_tiyin != 0,
        )
        for s in page
    ]
    return ShiftHistoryPage(
        items=items,
        next_cursor=str(page[-1].id) if has_more else None,
    )


@router.post("/open", response_model=ShiftOut, status_code=status.HTTP_201_CREATED)
async def open_shift(
    payload: ShiftOpenRequest,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> ShiftOut:
    """Открыть смену. Одновременно открытой может быть только одна.

    Раньше проверка стояла по `user_id` и при уже открытой смене того же
    кассира молча возвращала её. Теперь открытая смена ищется по всей
    установке, а попытка открыть вторую — отказ, а не тихий возврат чужой:
    два человека, считающие деньги в одном ящике по двум сменам, не сойдутся
    ни по одной.
    """
    existing = await service.current_open_shift(session)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Смена №{existing.number} уже открыта"
                f"{f' — {existing.opened_by_name}' if existing.opened_by_name else ''}. "
                "Сначала закройте её."
            ),
        )

    open_tiyin = (
        payload.open_cash_tiyin
        if payload.open_cash_tiyin is not None
        else int(round(float(payload.open_cash) * 100))
    )
    shift = Shift(
        user_id=user.id,
        status="open",
        cashbox_name=payload.cashbox_name,
        number=await service.next_shift_number(session),
        open_cash_tiyin=open_tiyin,
        # Зеркало для кассы — та же сумма в сомах.
        open_cash=to_som(open_tiyin),
        opened_by_name=(payload.cashier_name.strip() or service.actor_name(user))[:255],
    )
    session.add(shift)
    await session.commit()
    await session.refresh(shift)
    return _shift_out(shift)


@router.get("/{shift_id}", response_model=ShiftStateOut)
async def shift_card(
    shift_id: int,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> ShiftStateOut:
    """Карточка смены — открытой или закрытой."""
    return await _state(session, await _load(session, shift_id))


@router.get("/{shift_id}/movements", response_model=MovementsPage)
async def shift_movements(
    shift_id: int,
    limit: int = Query(default=100, ge=1, le=MAX_PAGE),
    cursor: str | None = None,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> MovementsPage:
    """Заведённые движения по ящику. Страницами, по курсору.

    Продаж наличными здесь нет: они не заводятся записью, а входят в
    расчётную сумму агрегатом — см. модель `CashMovement`. Раздел показывает
    их отдельной строкой из показателей смены.
    """
    conditions = [CashMovement.shift_id == shift_id]
    if cursor:
        try:
            conditions.append(CashMovement.id < int(cursor))
        except ValueError:
            pass
    rows = list(
        (
            await session.execute(
                select(CashMovement)
                .where(*conditions)
                .order_by(CashMovement.id.desc())
                .limit(limit + 1)
            )
        ).scalars().all()
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    return MovementsPage(
        items=[
            MovementOut(
                id=m.id,
                kind=m.kind,
                amount_tiyin=m.amount_tiyin,
                reason=m.reason,
                comment=m.comment,
                actor_name=m.actor_name,
                created_at=m.created_at.isoformat() if m.created_at else "",
            )
            for m in rows
        ],
        next_cursor=str(rows[-1].id) if has_more and rows else None,
    )


@router.post("/{shift_id}/cash", response_model=ShiftStateOut, status_code=status.HTTP_201_CREATED)
async def add_cash_movement(
    shift_id: int,
    payload: CashMovementRequest,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> ShiftStateOut:
    """Внесение или изъятие наличных.

    Заводится только в ОТКРЫТУЮ смену: закрытую менять нельзя, а движение по
    ящику закрытой смены меняло бы её расчётную сумму задним числом — то есть
    подделывало бы уже подписанную сверку.
    """
    shift = await _load(session, shift_id)
    if shift.status != "open":
        raise HTTPException(status_code=409, detail="Смена закрыта — движения по ней недоступны.")
    if payload.kind == "withdrawal":
        expected = await service.expected_cash(session, shift)
        if payload.amount_tiyin > expected:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"В ящике {to_som(expected):.2f} сом — изъять больше нельзя."
                ),
            )
    await service.add_movement(
        session,
        shift_id=shift.id,
        kind=payload.kind,
        amount_tiyin=payload.amount_tiyin,
        reason=payload.reason,
        comment=payload.comment,
        actor=payload.actor_name or service.actor_name(user),
        user_id=user.id,
        ref_type="manual",
    )
    await session.commit()
    await session.refresh(shift)
    return await _state(session, shift)


@router.get("/{shift_id}/report", response_model=ShiftReportOut)
async def shift_report(
    shift_id: int,
    kind: str = Query(default="x", pattern="^(x|z)$"),
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> ShiftReportOut:
    """Данные отчёта: промежуточного (x) или итогового (z).

    Промежуточный смену НЕ ЗАКРЫВАЕТ и ничего в ней не меняет — он только
    читает. Именно поэтому он GET, а не POST: запрос, который ничего не
    меняет, не должен уметь менять.
    """
    shift = await _load(session, shift_id)
    state = await _state(session, shift)
    return ShiftReportOut(
        kind=kind,
        shift=state.shift,
        metrics=state.metrics,
        expected_cash_tiyin=state.expected_cash_tiyin,
        deposits_tiyin=state.deposits_tiyin,
        withdrawals_tiyin=state.withdrawals_tiyin,
        printed_at=datetime.now(UTC).isoformat(),
        printed_by=service.actor_name(user),
    )


@router.post("/{shift_id}/close", response_model=ShiftOut)
async def close_shift(
    shift_id: int,
    payload: ShiftCloseRequest,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> ShiftOut:
    """Закрыть смену со сверкой наличных.

    Три правила, и все три проверяются здесь, а не в интерфейсе:

    1. Закрыть можно только открытую. Повторное нажатие «Закрыть» на уже
       закрытой смене получает 409, а не молча переписывает сверку — иначе
       двойная отправка стёрла бы объяснение расхождения.
    2. Расхождение нужно объяснить: либо причиной в запросе, либо открытой
       дверью владельца. Проверка едина для всех клиентов, включая саму
       кассу: правило, которое обходится другим полем в теле запроса, — не
       правило.
    3. Закрытую смену изменить нельзя. Ни этим маршрутом, ни движениями по
       ящику (см. `/cash`).
    """
    shift = await _load(session, shift_id)
    if shift.status != "open":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Смена №{shift.number} уже закрыта.",
        )
    if shift.user_id != user.id and user.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Недостаточно прав.")

    counted = (
        payload.counted_cash_tiyin
        if payload.counted_cash_tiyin is not None
        else int(round(float(payload.close_cash) * 100))
    )
    metrics = await service.fetch_metrics(session, shift.id)
    deposits, withdrawals = await _movement_totals(session, shift.id)
    expected = int(shift.open_cash_tiyin) + metrics.cash_tiyin + deposits - withdrawals
    variance = counted - expected

    if variance != 0 and not payload.variance_reason.strip():
        # Дверь владельца заменяет объяснение: владелец видит сверку целиком и
        # отвечает за неё сам. `registry.check` продлевает окно бездействия —
        # это осознанное действие владельца, а не фоновая проверка.
        if registry.check(user.id, DOOR_OWNER, ELEVATION_IDLE_MINUTES) is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Расхождение "
                    f"{'излишек' if variance > 0 else 'недостача'} "
                    f"{abs(variance) / 100:.2f} сом. "
                    "Укажите причину или войдите как владелец."
                ),
            )

    service.apply_close(
        shift,
        counted_tiyin=counted,
        expected_tiyin=expected,
        reason=payload.variance_reason,
        user=user,
        metrics=metrics,
    )
    await session.commit()
    await session.refresh(shift)

    # Суточная копия базы. Закрытие смены — единственный момент, когда касса
    # заведомо не в середине продажи, и он случается каждый день сам собой:
    # просить владельца «не забывать делать бэкап» бессмысленно.
    #
    # Ошибка копии не отменяет закрытие смены: смена уже закрыта и
    # зафиксирована, а откатывать её из-за неудавшегося снимка значит
    # оставить кассу с открытой сменой и пустой кассой одновременно.
    if current_db_mode() != "postgres":
        try:
            made = await create_daily_backup()
            if made is not None:
                logger.info("резервная копия при закрытии смены: %s", made.name)
        except Exception:  # noqa: BLE001
            logger.exception("не удалось создать резервную копию при закрытии смены")

    return _shift_out(shift)


@router.get("", response_model=list[ShiftOut])
async def list_shifts(
    limit: int = 50,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[ShiftOut]:
    """Список смен массивом. Форма ответа не менялась — этим живёт касса.

    Постраничная история с фильтрами — в `/history`.
    """
    rows = (
        await session.execute(select(Shift).order_by(Shift.id.desc()).limit(min(limit, MAX_PAGE)))
    ).scalars().all()
    return [_shift_out(s) for s in rows]
