"""Расчёты смены: показатели, наличные в ящике, открытие и закрытие.

Отдельный слой от маршрутов, потому что одну и ту же арифметику спрашивают из
четырёх мест — витрина состояния, показатели, промежуточный отчёт и сверка при
закрытии, — и разойтись им нельзя. Пока «сколько сейчас в ящике» считалось в
каждом обработчике по-своему, промежуточный отчёт и сверка давали разные
числа, а кассир объяснял разницу как недостачу.

Правила, которых держится модуль:

* деньги считаются ТОЛЬКО в целых тыйынах (app/core/money.py);
* показатели — одним агрегатом по `sales`, а не перебором чеков;
* ни одного запроса в цикле;
* статусы чеков берутся из панели (`panel/repository.py`), а не заводятся
  здесь заново: цифры смены и цифры журнала обязаны совпадать.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import Integer, case, cast, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    CashMovement,
    Sale,
    Shift,
    ShiftCounter,
    StoreSettings,
    User,
)
from app.modules.panel.repository import REFUND_STATUSES, REVENUE_STATUSES

# Чек, по которому денег не было вовсе. В наличные в ящике не попадает.
VOID_STATUSES = ("canceled",)

# Виды движений, которые заводятся записью. Продажи наличными здесь нет
# намеренно — см. шапку модели CashMovement.
MOVEMENT_KINDS = ("deposit", "withdrawal", "refund", "debt_payment")

# Что кассир может завести руками. Возврат и погашение долга заводит система.
MANUAL_MOVEMENT_KINDS = ("deposit", "withdrawal")


@dataclass(frozen=True)
class ShiftMetrics:
    """Показатели смены. Всё в тыйынах, кроме счётчиков."""

    sales_count: int
    refunds_count: int
    revenue_tiyin: int
    cash_tiyin: int
    card_tiyin: int
    qr_tiyin: int
    debt_tiyin: int
    refunds_tiyin: int
    discounts_tiyin: int

    @property
    def avg_check_tiyin(self) -> int:
        """Средний чек по тем чекам, что дали выручку.

        Делить на все строки вместе с отменёнными значило бы занижать средний
        чек тем сильнее, чем больше отмен было в смене.
        """
        return self.revenue_tiyin // self.sales_count if self.sales_count else 0


def refunded_amount():
    """Сколько по чеку вернули: чек стоил минус то, что от него осталось.

    Возврат в кассе не заводит записи на сумму — он УМЕНЬШАЕТ `total` самого
    чека, до нуля при полном возврате. Поэтому `SUM(total)` по возвращённым
    складывал бы нули, а не возвраты.

    Отсечение отрицательного — через `case`, а не через `max(x, 0)`. Двух-
    аргументный `max` есть в SQLite и нет в Postgres: там `max` это агрегат, и
    запрос на общем хранилище магазина упал бы. Тот же приём в
    `panel/repository.py` написан через `func.max` и на Postgres не работает —
    это не исправлено здесь, чтобы не трогать журнал чеков, но повторять его в
    новом коде незачем.

    Само отсечение нужно от порчи данных: если чек правили руками и остаток
    оказался больше исходной суммы, «возвраты» не должны уходить в минус.
    """
    left = Sale.subtotal - Sale.discount_total - Sale.total
    return case((left > 0, left), else_=0.0)


def tiyin_sum(expression):
    """Сумма из float-колонки `sales` в целых тыйынах.

    Округление применяется К КАЖДОЙ СТРОКЕ, а не к итогу, и это не педантизм.
    Сумма одного чека — заведомо целое число тыйынов; float хранит её с
    хвостом, и сложение трёхсот хвостов за смену даёт ошибку в несколько
    тыйынов. Округлив каждую строку до целого, мы складываем уже точные числа,
    и итог сходится с тем, что кассир видел на чеках.
    """
    return func.coalesce(func.sum(cast(func.round(expression * 100), Integer)), 0)


async def qr_provider_ids(session: AsyncSession) -> list[str]:
    """Идентификаторы способов оплаты, которые считаются QR.

    Чек не хранит вид способа оплаты — он хранит идентификатор провайдера
    (`payment_provider`). Вид лежит в настройках магазина, в JSON со списком
    провайдеров. Читаем его один раз и превращаем в список идентификаторов для
    условия `IN`: добавлять колонку в `sales` ради разбивки в отчёте значило бы
    трогать таблицу продаж, а это горячий путь кассы.

    Испорченный JSON — это не повод не показать смену: возвращаем пустой
    список, и вся безналичная выручка попадает в «карту». Ошибка при этом не
    проглатывается молча, а видна в самом отчёте: колонка QR будет нулевой.
    """
    raw = (
        await session.execute(select(StoreSettings.payment_providers).limit(1))
    ).scalar_one_or_none()
    if not raw:
        return []
    try:
        items = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(items, list):
        return []
    return [
        str(item["id"])
        for item in items
        if isinstance(item, dict)
        and isinstance(item.get("id"), str)
        and str(item.get("kind", "")).startswith("qr")
    ]


async def fetch_metrics(session: AsyncSession, shift_id: int) -> ShiftMetrics:
    """Все показатели смены ОДНИМ агрегатом.

    Девять чисел за один проход по чекам смены. Отдельными запросами это были
    бы девять обходов той же выборки; `case` внутри агрегатов делит суммы по
    статусу и способу оплаты, а обход при этом всё равно один.

    По какому индексу идёт: `ix_sales_shift_status` (shift_id, status),
    миграция 0030.
    """
    qr_ids = await qr_provider_ids(session)

    # Наличные, взятые с покупателя: принято минус сдача. Поле не меняется при
    # возврате, поэтому возвраты не вычитаются отсюда дважды — они приходят
    # своей записью в cash_movements.
    cash_taken = Sale.cash_received - Sale.change_amount

    is_revenue = Sale.status.in_(REVENUE_STATUSES)
    is_refund = Sale.status.in_(REFUND_STATUSES)
    refunded = refunded_amount()

    # `case`, а не `iif`: `iif` есть в SQLite и нет в Postgres, а магазин с
    # несколькими кассами работает на Postgres. Один и тот же запрос обязан
    # выполняться на обоих движках.
    is_qr = Sale.payment_provider.in_(qr_ids) if qr_ids else None
    qr_amount = case((is_qr, Sale.card_amount), else_=0.0) if qr_ids else literal(0.0)
    card_amount = case((is_qr, 0.0), else_=Sale.card_amount) if qr_ids else Sale.card_amount

    row = (
        await session.execute(
            select(
                func.coalesce(func.sum(case((is_revenue, 1), else_=0)), 0).label("sales_count"),
                func.coalesce(func.sum(case((is_refund, 1), else_=0)), 0).label("refunds_count"),
                tiyin_sum(case((is_revenue, Sale.total), else_=0.0)).label("revenue"),
                tiyin_sum(
                    case((Sale.status.in_(VOID_STATUSES), 0.0), else_=cash_taken)
                ).label("cash"),
                tiyin_sum(card_amount).label("card"),
                tiyin_sum(qr_amount).label("qr"),
                tiyin_sum(
                    case((Sale.payment_method == "debt", Sale.total), else_=0.0)
                ).label("debt"),
                tiyin_sum(case((is_refund, refunded), else_=0.0)).label("refunds"),
                tiyin_sum(case((is_revenue, Sale.discount_total), else_=0.0)).label("discounts"),
            ).where(Sale.shift_id == shift_id)
        )
    ).one()

    return ShiftMetrics(
        sales_count=int(row.sales_count or 0),
        refunds_count=int(row.refunds_count or 0),
        revenue_tiyin=int(row.revenue or 0),
        cash_tiyin=int(row.cash or 0),
        card_tiyin=int(row.card or 0),
        qr_tiyin=int(row.qr or 0),
        debt_tiyin=int(row.debt or 0),
        refunds_tiyin=int(row.refunds or 0),
        discounts_tiyin=int(row.discounts or 0),
    )


async def movements_total(session: AsyncSession, shift_id: int) -> int:
    """Сумма заведённых движений по ящику, со знаком. Один агрегат."""
    return int(
        (
            await session.execute(
                select(func.coalesce(func.sum(CashMovement.amount_tiyin), 0)).where(
                    CashMovement.shift_id == shift_id
                )
            )
        ).scalar_one()
        or 0
    )


async def expected_cash(session: AsyncSession, shift: Shift) -> int:
    """Сколько наличных должно быть в ящике прямо сейчас, в тыйынах.

    Размен + наличные, взятые по чекам + движения (внесения плюсом, изъятия и
    возвраты минусом). Ровно то, что кассир пересчитает руками при закрытии.

    Два запроса, не больше: агрегат по чекам и агрегат по движениям. Разложить
    его на «продажи», «возвраты», «внесения» отдельными запросами было бы
    четыре обхода ради одной суммы.
    """
    metrics = await fetch_metrics(session, shift.id)
    return int(shift.open_cash_tiyin) + metrics.cash_tiyin + await movements_total(
        session, shift.id
    )


async def current_open_shift(session: AsyncSession) -> Shift | None:
    """Открытая смена. ОДНА на всю установку, а не одна на кассира.

    Раньше здесь стояло `Shift.user_id == user.id`, и это была настоящая
    ошибка, а не упрощение: за одной кассой работают посменно, и вторая смена
    открывалась молча, стоило смениться человеку за экраном. Деньги при этом
    оставались в том же ящике, а сходились по двум сменам сразу — то есть не
    сходились ни по одной.
    """
    return (
        await session.execute(
            select(Shift).where(Shift.status == "open").order_by(Shift.id.desc()).limit(1)
        )
    ).scalar_one_or_none()


async def next_shift_number(session: AsyncSession) -> int:
    """Следующий номер смены. Счётчиком, как у чеков."""
    counter = (
        await session.execute(select(ShiftCounter).where(ShiftCounter.id == 1))
    ).scalar_one_or_none()
    if counter is None:
        # Первый номер после обновления не должен столкнуться с историческими:
        # миграция их пронумеровала, счётчик мог не завестись только на базе,
        # где смен не было вовсе.
        highest = int(
            (await session.execute(select(func.coalesce(func.max(Shift.number), 0)))).scalar_one()
            or 0
        )
        counter = ShiftCounter(id=1, last_number=highest)
        session.add(counter)
        await session.flush()
    counter.last_number += 1
    return counter.last_number


def actor_name(user: User) -> str:
    return user.full_name or user.username


async def add_movement(
    session: AsyncSession,
    *,
    shift_id: int,
    kind: str,
    amount_tiyin: int,
    reason: str = "",
    comment: str = "",
    actor: str = "",
    user_id: int | None = None,
    ref_type: str = "",
    ref_id: str = "",
) -> CashMovement:
    """Записать движение по ящику.

    Знак ставится ЗДЕСЬ, по виду движения, и больше нигде. Иначе каждое место,
    которое заводит движение, обязано помнить, что изъятие отрицательное, —
    и однажды не вспомнит.
    """
    signed = abs(int(amount_tiyin))
    if kind in ("withdrawal", "refund"):
        signed = -signed
    movement = CashMovement(
        shift_id=shift_id,
        kind=kind,
        amount_tiyin=signed,
        reason=reason.strip()[:128],
        comment=comment.strip()[:512],
        actor_name=actor.strip()[:255],
        user_id=user_id,
        ref_type=ref_type,
        ref_id=ref_id,
    )
    session.add(movement)
    return movement


async def record_cash_refund(
    session: AsyncSession,
    *,
    sale: Sale,
    amount: float,
    user: User,
    note: str = "",
) -> None:
    """Возврат наличными — минус из ящика той смены, в которой он произошёл.

    Не той, в которой продали: деньги отдают из ящика сегодня, а чек мог быть
    позавчерашним. Если смены нет вовсе (возврат вне смены), запись не
    заводится — списывать не из чего, и придумывать смену нельзя.

    Безналичный возврат ящика не касается: деньги ушли обратно на карту.
    """
    if amount <= 0:
        return
    if sale.payment_method not in ("cash", "mixed"):
        return
    shift = await current_open_shift(session)
    if shift is None:
        return
    await add_movement(
        session,
        shift_id=shift.id,
        kind="refund",
        amount_tiyin=int(round(amount * 100)),
        reason="Возврат по чеку",
        comment=note,
        actor=actor_name(user),
        user_id=user.id,
        ref_type="sale",
        ref_id=str(sale.id),
    )


async def record_cash_debt_payment(
    session: AsyncSession,
    *,
    amount: float,
    payment_method: str,
    sale_id: int,
    user: User,
) -> None:
    """Погашение долга наличными — плюс в ящик.

    Задача перечисляет четыре вида движений и этого среди них нет. Он здесь
    потому, что без него «расчётная сумма наличных прямо сейчас» занижена:
    покупатель принёс долг, деньги легли в ящик, а система о них не знает —
    и на закрытии показывает недостачу, которой нет. Сверка, которая врёт,
    хуже отсутствующей.
    """
    if payment_method != "cash" or amount <= 0:
        return
    shift = await current_open_shift(session)
    if shift is None:
        return
    await add_movement(
        session,
        shift_id=shift.id,
        kind="debt_payment",
        amount_tiyin=int(round(float(amount) * 100)),
        reason="Погашение долга",
        actor=actor_name(user),
        user_id=user.id,
        ref_type="sale",
        ref_id=str(sale_id),
    )


def apply_close(
    shift: Shift,
    *,
    counted_tiyin: int,
    expected_tiyin: int,
    reason: str,
    user: User,
    metrics: ShiftMetrics,
) -> None:
    """Проставить смене всё, что делает её закрытой. Без commit.

    Собрано в одну функцию, потому что закрытие обязано быть атомарным: смена,
    у которой статус уже `closed`, а расчётная сумма ещё не записана, — это
    смена, которую нельзя ни изменить, ни объяснить.

    Старые float-колонки заполняются здесь же, из тех же чисел. На них живёт
    касса, и разъехаться им негде — источник один.
    """
    now = datetime.now(UTC)
    shift.status = "closed"
    shift.closed_at = now
    shift.counted_cash_tiyin = counted_tiyin
    shift.expected_cash_tiyin = expected_tiyin
    shift.variance_tiyin = counted_tiyin - expected_tiyin
    shift.variance_reason = reason.strip()[:512]
    shift.closed_by_user_id = user.id
    shift.closed_by_name = actor_name(user)

    # Снимок показателей. Закрытая смена больше не меняется, и её история
    # читается отсюда, а не пересчитывается агрегатом по чекам — см. модель.
    shift.revenue_tiyin = metrics.revenue_tiyin
    shift.cash_tiyin = metrics.cash_tiyin
    shift.cashless_tiyin = metrics.card_tiyin + metrics.qr_tiyin
    shift.refunds_tiyin = metrics.refunds_tiyin

    # Зеркало для кассы: те же числа в сомах.
    shift.close_cash = counted_tiyin / 100
    shift.sales_count = metrics.sales_count
    shift.sales_total = metrics.revenue_tiyin / 100
