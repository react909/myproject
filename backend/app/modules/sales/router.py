from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import get_current_user
from app.db.database import get_db_session
from app.db.models import (
    DebtPayment,
    Sale,
    SaleCounter,
    SaleItem,
    StockMove,
    User,
)
from app.modules.products.stock import (
    check_bundles,
    load_catalog,
    shortage_message,
    stock_deltas,
    unit_cost,
)
from app.modules.shifts.service import (
    current_open_shift,
    record_cash_debt_payment,
    record_cash_refund,
)

router = APIRouter(prefix="/api", tags=["sales"])


# Остатки ведутся всегда.
#
# Раньше здесь был `_tracks_stock`: установка могла выбрать режим «без
# остатков», и тогда продажа склад не трогала. Выбор был ложным. Отчёт по
# остаткам нужен любому магазину, а точка, отключившая склад при установке,
# оставалась без него навсегда — и узнавала об этом через полгода, когда
# восстанавливать историю движений уже нечем.
#
# Товар без остатка описывается на уровне товара: у услуги (kind == "service")
# остатка нет по природе, и списывать там нечего.


class SaleItemIn(BaseModel):
    product_id: int | None = None
    name: str
    is_weight: bool = False
    is_service: bool = False
    quantity: float = Field(gt=0)
    unit_price: float = Field(ge=0)
    discount: float = Field(default=0, ge=0)
    line_total: float = Field(ge=0)


class SaleCreateRequest(BaseModel):
    items: list[SaleItemIn] = Field(min_length=1)
    payment_method: str = Field(pattern="^(cash|card|mixed|debt)$")
    subtotal: float = Field(ge=0)
    discount_total: float = Field(default=0, ge=0)
    total: float = Field(ge=0)
    cash_received: float = Field(default=0, ge=0)
    card_amount: float = Field(default=0, ge=0)
    change_amount: float = Field(default=0, ge=0)
    client_name: str = ""
    client_phone: str = ""
    note: str = ""
    # Как приняли безнал. Значения по умолчанию рассчитаны на старых клиентов:
    # без провайдера продажа считается подтверждённой вручную — это осторожная
    # сторона, а не оптимистичная.
    payment_provider: str = Field(default="", max_length=64)
    payment_provider_title: str = Field(default="", max_length=128)
    payment_ref: str = Field(default="", max_length=128)
    payment_confirmation: str = Field(default="manual", pattern="^(auto|manual)$")


class SaleItemOut(BaseModel):
    id: int
    product_id: int | None
    name: str
    is_weight: bool
    is_service: bool
    quantity: float
    unit_price: float
    discount: float
    line_total: float


class SaleOut(BaseModel):
    id: int
    doc_number: int
    status: str
    payment_method: str
    subtotal: float
    discount_total: float
    total: float
    cash_received: float
    card_amount: float
    change_amount: float
    debt_balance: float
    client_name: str
    client_phone: str
    cashier_name: str
    shift_id: int | None
    created_at: str
    paid_at: str | None
    items: list[SaleItemOut] = []


class DebtPayRequest(BaseModel):
    amount: float = Field(gt=0)
    payment_method: str = Field(default="cash", pattern="^(cash|card)$")
    cash_received: float = Field(default=0, ge=0)


class RefundItemIn(BaseModel):
    sale_item_id: int
    quantity: float = Field(gt=0)


class RefundRequest(BaseModel):
    items: list[RefundItemIn] = Field(min_length=1)
    note: str = ""


def _sale_out(sale: Sale) -> SaleOut:
    return SaleOut(
        id=sale.id,
        doc_number=sale.doc_number,
        status=sale.status,
        payment_method=sale.payment_method,
        subtotal=sale.subtotal,
        discount_total=sale.discount_total,
        total=sale.total,
        cash_received=sale.cash_received,
        card_amount=sale.card_amount,
        change_amount=sale.change_amount,
        debt_balance=sale.debt_balance,
        client_name=sale.client_name,
        client_phone=sale.client_phone,
        cashier_name=sale.cashier_name,
        shift_id=sale.shift_id,
        created_at=sale.created_at.isoformat() if sale.created_at else "",
        paid_at=sale.paid_at.isoformat() if sale.paid_at else None,
        items=[
            SaleItemOut(
                id=i.id,
                product_id=i.product_id,
                name=i.name,
                is_weight=i.is_weight,
                is_service=i.is_service,
                quantity=i.quantity,
                unit_price=i.unit_price,
                discount=i.discount,
                line_total=i.line_total,
            )
            for i in (sale.items or [])
        ],
    )


async def _next_doc_number(session: AsyncSession) -> int:
    counter = (await session.execute(select(SaleCounter).where(SaleCounter.id == 1))).scalar_one_or_none()
    if counter is None:
        counter = SaleCounter(id=1, last_number=0)
        session.add(counter)
        await session.flush()
    counter.last_number += 1
    return counter.last_number


#: Текст отказа, когда смены нет.
#:
#: Слово «смен» в нём обязательно: `services/posShift.ts` узнаёт эту ошибку по
#: подстроке и показывает кассиру предложение открыть смену вместо общего
#: сообщения «касса не приняла чек». Менять текст можно, корень слова — нет.
NO_SHIFT_DETAIL = "Смена не открыта. Откройте смену, чтобы продавать."


@router.post("/sales", response_model=SaleOut, status_code=status.HTTP_201_CREATED)
async def create_sale(
    payload: SaleCreateRequest,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> SaleOut:
    """Продажа. Привязывается к ОТКРЫТОЙ смене; без смены не проходит.

    Раньше здесь стояло автооткрытие: смены нет — заводим молча, с нулевым
    разменом, от имени того, кто в этот момент залогинен. Это выглядело
    удобством, а было потерей денег. Смена, открытая сама собой, имеет
    размен ноль и кассира «кто попал», а в ящике при этом лежат вчерашние
    деньги — и сверка в конце дня показывает излишек на всю сумму размена.
    Найти причину постфактум нельзя: в базе такая смена ничем не отличается
    от настоящей.

    Теперь система отказывает и предлагает открыть смену. Отказ 409, а не
    400: это не ошибка в запросе, а состояние, которое надо поправить и
    повторить. Касса ловит его по слову «смена» и открывает окно смены.
    """
    shift = await current_open_shift(session)
    if shift is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=NO_SHIFT_DETAIL)

    now = datetime.now(UTC)
    is_debt = payload.payment_method == "debt"
    sale = Sale(
        doc_number=await _next_doc_number(session),
        status="debt" if is_debt else "paid",
        payment_method=payload.payment_method,
        subtotal=payload.subtotal,
        discount_total=payload.discount_total,
        total=payload.total,
        cash_received=payload.cash_received,
        card_amount=payload.card_amount,
        change_amount=payload.change_amount,
        debt_balance=payload.total if is_debt else 0,
        client_name=payload.client_name.strip(),
        client_phone=payload.client_phone.strip(),
        shift_id=shift.id,
        user_id=user.id,
        cashier_name=user.full_name or user.username,
        created_at=now,
        paid_at=None if is_debt else now,
        note=payload.note,
        payment_provider=payload.payment_provider.strip(),
        payment_provider_title=payload.payment_provider_title.strip(),
        payment_ref=payload.payment_ref.strip(),
        payment_confirmation=payload.payment_confirmation,
    )
    session.add(sale)
    await session.flush()

    # Списание со склада: одним разбором на весь чек, а не запросом на строку.
    #
    # Раньше здесь для каждой позиции шёл отдельный SELECT товара. На чеке из
    # двадцати позиций это двадцать обращений к базе внутри транзакции продажи —
    # ровно там, где человек стоит у кассы и ждёт. Теперь товары чека и составы
    # комплектов среди них вынимаются двумя запросами (products/stock.py).
    #
    # Комплект списывает СОСТАВЛЯЮЩИЕ, а не себя: своего остатка у него нет.
    # Услуга не списывается вовсе.
    wanted: dict[int, float] = {}
    for line in payload.items:
        if line.product_id and not line.is_service:
            wanted[line.product_id] = wanted.get(line.product_id, 0.0) + float(line.quantity)

    catalog = await load_catalog(session, set(wanted))

    # Комплект, которому не хватает составляющих, не продаётся.
    #
    # Обычный товар при этом по-прежнему уходит в минус — так касса работала
    # всегда, и менять это здесь не задача. Разница в последствиях: минус по
    # одному товару виден и правится инвентаризацией, а комплект портит
    # остатки сразу нескольким позициям, ни одна из которых в чеке не названа.
    # Подробнее — в products/stock.py.
    shortages = check_bundles(catalog, wanted)
    if shortages:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=shortage_message(shortages)
        )

    for product_id, quantity in stock_deltas(catalog, wanted).items():
        product = catalog.get(product_id)
        if product is None:
            continue
        product.stock_qty = float(product.stock_qty) - quantity
        session.add(
            StockMove(
                product_id=product.id,
                qty_delta=-quantity,
                reason="sale",
                ref_type="sale",
                ref_id=str(sale.id),
                user_id=user.id,
            )
        )

    for line in payload.items:
        # Себестоимость нужна обоим режимам аналитики: прибыль считается из
        # неё, а выручка показывается рядом. У комплекта она складывается из
        # составляющих — своей у него нет.
        cost = (
            unit_cost(catalog, line.product_id)
            if line.product_id and not line.is_service
            else 0.0
        )
        session.add(
            SaleItem(
                sale_id=sale.id,
                product_id=line.product_id,
                name=line.name,
                is_weight=line.is_weight,
                is_service=line.is_service,
                quantity=line.quantity,
                unit_price=line.unit_price,
                discount=line.discount,
                line_total=line.line_total,
                cost_price=cost,
            )
        )

    shift.sales_count += 1
    shift.sales_total = float(shift.sales_total) + float(payload.total)
    await session.commit()

    result = (
        await session.execute(
            select(Sale).options(selectinload(Sale.items)).where(Sale.id == sale.id)
        )
    ).scalar_one()
    return _sale_out(result)


@router.get("/sales", response_model=list[SaleOut])
async def list_sales(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, le=500),
    date_from: str | None = None,
    date_to: str | None = None,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[SaleOut]:
    stmt = select(Sale).options(selectinload(Sale.items)).order_by(Sale.id.desc()).limit(limit)
    if status_filter:
        stmt = stmt.where(Sale.status == status_filter)
    if date_from:
        try:
            dt = datetime.fromisoformat(date_from)
            stmt = stmt.where(Sale.created_at >= dt)
        except ValueError:
            pass
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to)
            stmt = stmt.where(Sale.created_at <= dt)
        except ValueError:
            pass
    rows = (await session.execute(stmt)).scalars().all()
    return [_sale_out(s) for s in rows]


@router.get("/sales/{sale_id}", response_model=SaleOut)
async def get_sale(
    sale_id: int,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> SaleOut:
    sale = (
        await session.execute(
            select(Sale).options(selectinload(Sale.items)).where(Sale.id == sale_id)
        )
    ).scalar_one_or_none()
    if not sale:
        raise HTTPException(status_code=404, detail="Чек не найден.")
    return _sale_out(sale)


@router.get("/debts", response_model=list[SaleOut])
async def list_debts(
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[SaleOut]:
    rows = (
        await session.execute(
            select(Sale)
            .options(selectinload(Sale.items))
            .where(Sale.status == "debt", Sale.debt_balance > 0)
            .order_by(Sale.created_at.desc())
        )
    ).scalars().all()
    return [_sale_out(s) for s in rows]


@router.post("/sales/{sale_id}/pay-debt", response_model=SaleOut)
async def pay_debt(
    sale_id: int,
    payload: DebtPayRequest,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> SaleOut:
    sale = (
        await session.execute(
            select(Sale).options(selectinload(Sale.items)).where(Sale.id == sale_id)
        )
    ).scalar_one_or_none()
    if not sale or sale.status != "debt":
        raise HTTPException(status_code=404, detail="Долг не найден.")
    amount = round(float(payload.amount), 2)
    if amount > float(sale.debt_balance) + 0.01:
        raise HTTPException(status_code=400, detail="Сумма больше остатка долга.")
    change = 0.0
    cash_received = float(payload.cash_received or 0)
    if payload.payment_method == "cash":
        if cash_received < amount:
            cash_received = amount
        change = round(cash_received - amount, 2)

    session.add(
        DebtPayment(
            sale_id=sale.id,
            amount=amount,
            payment_method=payload.payment_method,
            cash_received=cash_received,
            change_amount=change,
            user_id=user.id,
        )
    )
    sale.debt_balance = round(float(sale.debt_balance) - amount, 2)
    if sale.debt_balance <= 0.01:
        sale.debt_balance = 0
        sale.status = "paid"
        sale.paid_at = datetime.now(UTC)

    # Наличные за долг легли в ящик — значит, они должны быть в расчётной
    # сумме смены. Без этой записи закрытие показывало бы излишек на всю
    # принесённую сумму. Безналичное погашение ящика не касается.
    await record_cash_debt_payment(
        session,
        amount=amount,
        payment_method=payload.payment_method,
        sale_id=sale.id,
        user=user,
    )
    await session.commit()
    await session.refresh(sale)
    return _sale_out(sale)


@router.post("/sales/{sale_id}/refund", response_model=SaleOut)
async def refund_sale(
    sale_id: int,
    payload: RefundRequest,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> SaleOut:
    sale = (
        await session.execute(
            select(Sale).options(selectinload(Sale.items)).where(Sale.id == sale_id)
        )
    ).scalar_one_or_none()
    if not sale:
        raise HTTPException(status_code=404, detail="Чек не найден.")
    if sale.status in ("canceled",):
        raise HTTPException(status_code=400, detail="Чек уже отменён.")

    item_map = {i.id: i for i in sale.items}
    refunded_total = 0.0

    # Возврат ЗЕРКАЛИТ продажу, и это не фигура речи, а требование.
    #
    # Списание при продаже разворачивает комплекты в составляющие. Значит и
    # возврат обязан разворачивать их так же — ТЕМ ЖЕ кодом (products/stock.py),
    # а не «похожим». Если бы возврат возвращал на склад сам комплект, продажа
    # уводила бы составляющие в минус, а на складе появлялся бы комплект,
    # которого там быть не может: своего остатка у него нет.
    #
    # Услуга не возвращается — её и не списывали.
    wanted: dict[int, float] = {}
    for entry in payload.items:
        item = item_map.get(entry.sale_item_id)
        if not item:
            raise HTTPException(status_code=400, detail=f"Позиция {entry.sale_item_id} не найдена.")
        qty = min(float(entry.quantity), float(item.quantity))
        if qty <= 0:
            continue
        unit_net = float(item.line_total) / float(item.quantity) if item.quantity else 0
        refunded_total += unit_net * qty
        item.quantity = float(item.quantity) - qty
        item.line_total = round(float(item.line_total) - unit_net * qty, 2)
        if item.product_id and not item.is_service:
            wanted[item.product_id] = wanted.get(item.product_id, 0.0) + qty

    catalog = await load_catalog(session, set(wanted))
    for product_id, quantity in stock_deltas(catalog, wanted).items():
        product = catalog.get(product_id)
        if product is None:
            continue
        product.stock_qty = float(product.stock_qty) + quantity
        session.add(
            StockMove(
                product_id=product.id,
                qty_delta=quantity,
                reason="return",
                ref_type="sale",
                ref_id=str(sale.id),
                note=payload.note,
                user_id=user.id,
            )
        )

    remaining_lines = [i for i in sale.items if i.quantity > 1e-9]
    if not remaining_lines:
        sale.status = "refunded"
        sale.total = 0
    else:
        sale.status = "partial_refund"
        sale.total = round(max(0.0, float(sale.total) - refunded_total), 2)
    sale.note = (sale.note + " | " + payload.note).strip(" |")

    # Деньги, вынутые из ящика, — отдельной записью движения.
    #
    # В самом чеке этой суммы нет: возврат уменьшает `total`, а не заводит
    # запись. Расчётная сумма наличных считается по `cash_received`, которое
    # возврат не трогает, — и без этой строки ящик «не заметил» бы выдачи, а
    # сверка на закрытии показала бы недостачу ровно на неё.
    #
    # Пишется в ТЕКУЩУЮ открытую смену, а не в смену чека: деньги отдают
    # сегодня, а чек мог быть позавчерашним.
    await record_cash_refund(
        session, sale=sale, amount=round(refunded_total, 2), user=user, note=payload.note
    )
    await session.commit()
    await session.refresh(sale)
    return _sale_out(sale)
