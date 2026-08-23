"""Маршруты справочника поставщиков: список с долгами, карточка, оплаты.

Два места здесь стоят отдельного внимания.

ПЕРВОЕ — список. Каждая строка показывает пять чисел, посчитанных по чужим
таблицам: сколько закупок, на какую сумму, сколько должны, когда была
последняя поставка, просрочена ли оплата. Собрать их запросом на строку —
самый естественный и самый неправильный способ: на трёхстах поставщиках это
полторы тысячи запросов на одну страницу. Здесь всё считается ДВУМЯ агрегатами
с группировкой — по документам и по оплатам — и склеивается в память.

ВТОРОЕ — оплата поставщику. Это выдача денег, и она закрыта дверью владельца
НА СЕРВЕРЕ (`require_owner`). Просмотр долга открыт всем: кассир должен знать,
что поставщику должны, чтобы не принять товар второй раз. Внести оплату он не
может, и скрытая кнопка тут ни при чём — прямой запрос отклоняется.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access import require_owner
from app.core.security import get_current_user
from app.db.database import get_db_session
from app.db.models import (
    Product,
    PurchaseDoc,
    PurchaseLine,
    Supplier,
    SupplierPayment,
    User,
)
from app.modules.purchases.service import (
    KIND_PURCHASE,
    STATUS_POSTED,
    debt_delta_expression,
    supplier_balance,
)

router = APIRouter(prefix="/api/suppliers", tags=["suppliers"])

MAX_PAGE = 200

SORTABLE = {
    "name": Supplier.name,
    "phone": Supplier.phone,
}


# ── Схемы ─────────────────────────────────────────────────────────────────────


class SupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    contact_person: str = Field(default="", max_length=255)
    phone: str = Field(default="", max_length=64)
    address: str = Field(default="", max_length=512)
    comment: str = Field(default="", max_length=1024)


class SupplierRow(BaseModel):
    id: int
    name: str
    phone: str
    contact_person: str
    purchases_count: int
    purchases_tiyin: int
    debt_tiyin: int
    last_delivery: str | None
    #: Есть ли у поставщика проведённая закупка в долг с истёкшим сроком
    #: оплаты. Строка с ней помечается в списке заметно.
    overdue: bool


class SupplierPage(BaseModel):
    items: list[SupplierRow]
    next_cursor: str | None = None


class SupplierCard(BaseModel):
    id: int
    name: str
    contact_person: str
    phone: str
    address: str
    comment: str
    is_active: bool
    debt_tiyin: int
    purchases_count: int
    purchases_tiyin: int
    paid_tiyin: int
    last_delivery: str | None


class SupplyRow(BaseModel):
    id: int
    number: int
    kind: str
    doc_date: str
    positions_count: int
    total_tiyin: int
    status: str
    settlement: str
    due_date: str | None
    overdue: bool


class PaymentIn(BaseModel):
    amount_tiyin: int = Field(gt=0)
    paid_at: str | None = None
    method: str = Field(default="cash", pattern="^(cash|card|transfer)$")
    comment: str = Field(default="", max_length=512)


class PaymentRow(BaseModel):
    id: int
    amount_tiyin: int
    paid_at: str
    method: str
    comment: str
    #: Остаток долга ПОСЛЕ этого платежа. Считается на сервере по всей
    #: истории: на фронте это означало бы догадываться о порядке платежей.
    balance_after_tiyin: int


class SupplierProductRow(BaseModel):
    product_id: int
    name: str
    last_cost_tiyin: int
    prev_cost_tiyin: int | None
    #: На сколько процентов изменилась цена с прошлой поставки. `None` —
    #: поставка была одна, сравнивать не с чем.
    change_percent: float | None
    last_date: str | None
    deliveries: int


# ── Вспомогательное ───────────────────────────────────────────────────────────


def _moment(raw: str | None, *, field: str) -> datetime | None:
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Неверная дата: {field}.")
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


async def _load(session: AsyncSession, supplier_id: int) -> Supplier:
    supplier = (
        await session.execute(select(Supplier).where(Supplier.id == supplier_id))
    ).scalar_one_or_none()
    if supplier is None:
        raise HTTPException(status_code=404, detail="Поставщик не найден.")
    return supplier


# ── Маршруты ──────────────────────────────────────────────────────────────────


@router.get("", response_model=SupplierPage)
async def list_suppliers(
    q: str = "",
    include_inactive: bool = False,
    sort: str = Query(default="name", pattern="^(name|phone|debt|purchases|last)$"),
    direction: str = Query(default="asc", pattern="^(asc|desc)$"),
    limit: int = Query(default=100, ge=1, le=MAX_PAGE),
    cursor: str | None = None,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> SupplierPage:
    """Список поставщиков с показателями. ТРИ запроса на страницу, не больше.

    Порядок такой: сначала отбираем страницу поставщиков, потом двумя
    агрегатами добираем к ним числа. Обратный порядок (посчитать всё, потом
    отобрать) заставил бы обойти все документы ради ста строк.

    Сортировка по вычисляемым столбцам (долг, сумма закупок, последняя
    поставка) идёт ПО СТРАНИЦЕ, а не по всей таблице, и это честное
    ограничение, а не недосмотр: сортировать по долгу в SQL значит считать
    долг для всех поставщиков сразу на каждое нажатие заголовка. На справочнике
    в несколько сотен строк страница вмещает его целиком, и разница не видна;
    на большем — сортировка по имени и телефону остаётся точной, а по числам
    относится к показанной странице. Список поставщиков не растёт как журнал
    чеков: их десятки, а не сотни тысяч.
    """
    conditions = []
    if not include_inactive:
        conditions.append(Supplier.is_active.is_(True))
    if q.strip():
        like = f"%{q.strip()}%"
        conditions.append(or_(Supplier.name.ilike(like), Supplier.phone.ilike(like)))
    if cursor:
        try:
            conditions.append(Supplier.id > int(cursor))
        except ValueError:
            pass

    column = SORTABLE.get(sort, Supplier.name)
    order = column.asc() if direction == "asc" else column.desc()
    rows = list(
        (
            await session.execute(
                select(Supplier).where(*conditions).order_by(order, Supplier.id).limit(limit + 1)
            )
        ).scalars().all()
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    if not rows:
        return SupplierPage(items=[], next_cursor=None)

    ids = [s.id for s in rows]
    now = datetime.now(UTC)

    # Агрегат 1: всё, что считается по документам, — одним проходом.
    doc_stats = {
        row.supplier_id: row
        for row in (
            await session.execute(
                select(
                    PurchaseDoc.supplier_id,
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    (PurchaseDoc.status == STATUS_POSTED)
                                    & (PurchaseDoc.kind == KIND_PURCHASE),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ).label("count"),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    (PurchaseDoc.status == STATUS_POSTED)
                                    & (PurchaseDoc.kind == KIND_PURCHASE),
                                    PurchaseDoc.total_tiyin,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ).label("total"),
                    func.coalesce(func.sum(debt_delta_expression()), 0).label("charged"),
                    func.max(
                        case(
                            (PurchaseDoc.status == STATUS_POSTED, PurchaseDoc.doc_date),
                            else_=None,
                        )
                    ).label("last_delivery"),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    (PurchaseDoc.status == STATUS_POSTED)
                                    & (PurchaseDoc.settlement == "credit")
                                    & (PurchaseDoc.due_date.is_not(None))
                                    & (PurchaseDoc.due_date < now),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ).label("overdue"),
                )
                .where(PurchaseDoc.supplier_id.in_(ids))
                .group_by(PurchaseDoc.supplier_id)
            )
        ).all()
    }

    # Агрегат 2: оплаты.
    paid = {
        row.supplier_id: int(row.paid or 0)
        for row in (
            await session.execute(
                select(
                    SupplierPayment.supplier_id,
                    func.coalesce(func.sum(SupplierPayment.amount_tiyin), 0).label("paid"),
                )
                .where(SupplierPayment.supplier_id.in_(ids))
                .group_by(SupplierPayment.supplier_id)
            )
        ).all()
    }

    items = []
    for supplier in rows:
        stats = doc_stats.get(supplier.id)
        charged = int(getattr(stats, "charged", 0) or 0)
        debt = charged - paid.get(supplier.id, 0)
        last = getattr(stats, "last_delivery", None)
        items.append(
            SupplierRow(
                id=supplier.id,
                name=supplier.name,
                phone=supplier.phone,
                contact_person=supplier.contact_person,
                purchases_count=int(getattr(stats, "count", 0) or 0),
                purchases_tiyin=int(getattr(stats, "total", 0) or 0),
                debt_tiyin=debt,
                last_delivery=last.isoformat() if isinstance(last, datetime) else (last or None),
                overdue=bool(int(getattr(stats, "overdue", 0) or 0)) and debt > 0,
            )
        )

    # Сортировка по вычисленным столбцам — по странице. См. док-строку.
    if sort in ("debt", "purchases", "last"):
        key = {
            "debt": lambda row: row.debt_tiyin,
            "purchases": lambda row: row.purchases_tiyin,
            "last": lambda row: row.last_delivery or "",
        }[sort]
        items.sort(key=key, reverse=direction == "desc")

    return SupplierPage(items=items, next_cursor=str(rows[-1].id) if has_more else None)


@router.post("", response_model=SupplierCard, status_code=status.HTTP_201_CREATED)
async def create_supplier(
    payload: SupplierIn,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> SupplierCard:
    supplier = Supplier(
        name=payload.name.strip(),
        contact_person=payload.contact_person.strip(),
        phone=payload.phone.strip(),
        address=payload.address.strip(),
        comment=payload.comment.strip(),
    )
    session.add(supplier)
    await session.commit()
    await session.refresh(supplier)
    return await _card(session, supplier)


async def _card(session: AsyncSession, supplier: Supplier) -> SupplierCard:
    """Карточка: реквизиты плюс сальдо. Два агрегата, как и у списка."""
    row = (
        await session.execute(
            select(
                func.coalesce(
                    func.sum(
                        case(
                            (
                                (PurchaseDoc.status == STATUS_POSTED)
                                & (PurchaseDoc.kind == KIND_PURCHASE),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("count"),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                (PurchaseDoc.status == STATUS_POSTED)
                                & (PurchaseDoc.kind == KIND_PURCHASE),
                                PurchaseDoc.total_tiyin,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("total"),
                func.max(
                    case((PurchaseDoc.status == STATUS_POSTED, PurchaseDoc.doc_date), else_=None)
                ).label("last_delivery"),
            ).where(PurchaseDoc.supplier_id == supplier.id)
        )
    ).one()
    paid = int(
        (
            await session.execute(
                select(func.coalesce(func.sum(SupplierPayment.amount_tiyin), 0)).where(
                    SupplierPayment.supplier_id == supplier.id
                )
            )
        ).scalar_one()
        or 0
    )
    last = row.last_delivery
    return SupplierCard(
        id=supplier.id,
        name=supplier.name,
        contact_person=supplier.contact_person,
        phone=supplier.phone,
        address=supplier.address,
        comment=supplier.comment,
        is_active=supplier.is_active,
        debt_tiyin=await supplier_balance(session, supplier.id),
        purchases_count=int(row.count or 0),
        purchases_tiyin=int(row.total or 0),
        paid_tiyin=paid,
        last_delivery=last.isoformat() if isinstance(last, datetime) else (last or None),
    )


@router.get("/{supplier_id}", response_model=SupplierCard)
async def get_supplier(
    supplier_id: int,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> SupplierCard:
    return await _card(session, await _load(session, supplier_id))


@router.patch("/{supplier_id}", response_model=SupplierCard)
async def update_supplier(
    supplier_id: int,
    payload: SupplierIn,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> SupplierCard:
    supplier = await _load(session, supplier_id)
    supplier.name = payload.name.strip()
    supplier.contact_person = payload.contact_person.strip()
    supplier.phone = payload.phone.strip()
    supplier.address = payload.address.strip()
    supplier.comment = payload.comment.strip()
    await session.commit()
    await session.refresh(supplier)
    return await _card(session, supplier)


@router.delete("/{supplier_id}", response_model=SupplierCard)
async def archive_supplier(
    supplier_id: int,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> SupplierCard:
    """Убрать поставщика из списка. Физически строка не удаляется.

    За поставщиком стоят накладные и история расчётов. Удалить строку значит
    оставить их без имени: отчёт за прошлый год превратился бы в список
    «поставщик №14». Поставщик с непогашенным долгом не убирается вовсе —
    долг, исчезнувший из списка, никто не вспомнит.
    """
    supplier = await _load(session, supplier_id)
    debt = await supplier_balance(session, supplier.id)
    if debt > 0:
        raise HTTPException(
            status_code=409,
            detail=f"У поставщика долг {debt / 100:.2f} сом. Сначала рассчитайтесь.",
        )
    supplier.is_active = False
    await session.commit()
    await session.refresh(supplier)
    return await _card(session, supplier)


@router.get("/{supplier_id}/purchases", response_model=list[SupplyRow])
async def supplier_purchases(
    supplier_id: int,
    limit: int = Query(default=100, ge=1, le=MAX_PAGE),
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[SupplyRow]:
    """Вкладка «Поставки»: документы этого поставщика."""
    await _load(session, supplier_id)
    now = datetime.now(UTC)
    rows = list(
        (
            await session.execute(
                select(PurchaseDoc)
                .where(PurchaseDoc.supplier_id == supplier_id)
                .order_by(PurchaseDoc.doc_date.desc(), PurchaseDoc.id.desc())
                .limit(limit)
            )
        ).scalars().all()
    )
    return [
        SupplyRow(
            id=doc.id,
            number=doc.number,
            kind=doc.kind,
            doc_date=doc.doc_date.isoformat() if doc.doc_date else "",
            positions_count=doc.positions_count,
            total_tiyin=doc.total_tiyin,
            status=doc.status,
            settlement=doc.settlement,
            due_date=doc.due_date.isoformat() if doc.due_date else None,
            overdue=bool(
                doc.settlement == "credit"
                and doc.status == STATUS_POSTED
                and doc.due_date is not None
                and (doc.due_date.replace(tzinfo=UTC) if doc.due_date.tzinfo is None else doc.due_date)
                < now
            ),
        )
        for doc in rows
    ]


@router.get("/{supplier_id}/payments", response_model=list[PaymentRow])
async def supplier_payments(
    supplier_id: int,
    limit: int = Query(default=100, ge=1, le=MAX_PAGE),
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[PaymentRow]:
    """Вкладка «Оплаты»: история платежей с остатком долга после каждого.

    Остаток считается ОДНИМ проходом по возрастанию даты, а не запросом на
    платёж. Начисленный долг берётся один раз агрегатом, дальше вычитаем.
    """
    await _load(session, supplier_id)
    charged = int(
        (
            await session.execute(
                select(func.coalesce(func.sum(debt_delta_expression()), 0)).where(
                    PurchaseDoc.supplier_id == supplier_id
                )
            )
        ).scalar_one()
        or 0
    )
    rows = list(
        (
            await session.execute(
                select(SupplierPayment)
                .where(SupplierPayment.supplier_id == supplier_id)
                .order_by(SupplierPayment.paid_at.asc(), SupplierPayment.id.asc())
                .limit(limit)
            )
        ).scalars().all()
    )
    balance = charged
    rendered: list[PaymentRow] = []
    for payment in rows:
        balance -= int(payment.amount_tiyin)
        rendered.append(
            PaymentRow(
                id=payment.id,
                amount_tiyin=payment.amount_tiyin,
                paid_at=payment.paid_at.isoformat() if payment.paid_at else "",
                method=payment.method,
                comment=payment.comment,
                balance_after_tiyin=balance,
            )
        )
    # Показываем сверху свежие, а считали снизу вверх: порядок расчёта и
    # порядок показа — разные вещи.
    rendered.reverse()
    return rendered


@router.post(
    "/{supplier_id}/payments", response_model=SupplierCard, status_code=status.HTTP_201_CREATED
)
async def pay_supplier(
    supplier_id: int,
    payload: PaymentIn,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(require_owner),
) -> SupplierCard:
    """Внести оплату поставщику. ТОЛЬКО из-под открытой двери владельца.

    Это выдача денег, и проверка стоит здесь, на сервере, а не в интерфейсе:
    скрытая кнопка защитой не считается. Прямой запрос без повышенной сессии
    получает 403 — независимо от роли учётной записи, потому что на кассе
    почти всегда залогинен владелец, а стоит за ней кассир.
    """
    supplier = await _load(session, supplier_id)
    session.add(
        SupplierPayment(
            supplier_id=supplier.id,
            amount_tiyin=payload.amount_tiyin,
            paid_at=_moment(payload.paid_at, field="дата оплаты") or datetime.now(UTC),
            method=payload.method,
            comment=payload.comment.strip(),
            user_id=user.id,
        )
    )
    await session.commit()
    await session.refresh(supplier)
    return await _card(session, supplier)


@router.get("/{supplier_id}/products", response_model=list[SupplierProductRow])
async def supplier_products(
    supplier_id: int,
    limit: int = Query(default=200, ge=1, le=500),
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[SupplierProductRow]:
    """Вкладка «Товары»: что поставляет, по какой цене и как она изменилась.

    Две поставки на товар нужны, чтобы посчитать изменение цены, и обе
    приходят ОДНИМ запросом: берём все строки этого поставщика по проведённым
    документам, отсортированные по дате, и в один проход по ним оставляем две
    последние цены на товар. Запросом «предыдущая цена» на каждый товар это
    был бы запрос в цикле по всему ассортименту.
    """
    await _load(session, supplier_id)
    rows = (
        await session.execute(
            select(
                PurchaseLine.product_id,
                PurchaseLine.name,
                PurchaseLine.cost_tiyin,
                PurchaseDoc.doc_date,
            )
            .join(PurchaseDoc, PurchaseLine.doc_id == PurchaseDoc.id)
            .where(
                PurchaseDoc.supplier_id == supplier_id,
                PurchaseDoc.status == STATUS_POSTED,
                PurchaseDoc.kind == KIND_PURCHASE,
                PurchaseLine.product_id.is_not(None),
            )
            .order_by(PurchaseDoc.doc_date.desc(), PurchaseDoc.id.desc())
        )
    ).all()

    collected: dict[int, dict] = {}
    for product_id, name, cost, moment in rows:
        entry = collected.setdefault(
            int(product_id),
            {"name": name, "costs": [], "last_date": moment, "deliveries": 0},
        )
        entry["deliveries"] += 1
        if len(entry["costs"]) < 2:
            entry["costs"].append(int(cost))

    items: list[SupplierProductRow] = []
    for product_id, entry in list(collected.items())[:limit]:
        costs = entry["costs"]
        last = costs[0]
        prev = costs[1] if len(costs) > 1 else None
        change = None
        if prev and prev > 0:
            change = round((last - prev) * 100 / prev, 2)
        moment = entry["last_date"]
        items.append(
            SupplierProductRow(
                product_id=product_id,
                name=entry["name"],
                last_cost_tiyin=last,
                prev_cost_tiyin=prev,
                change_percent=change,
                last_date=moment.isoformat() if isinstance(moment, datetime) else (moment or None),
                deliveries=entry["deliveries"],
            )
        )
    items.sort(key=lambda row: row.name.lower())
    return items


