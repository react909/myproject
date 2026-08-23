"""Проведение закупки, отмена проведения и себестоимость.

Здесь живут два действия, которые меняют склад и цены, и оба обязаны быть
атомарными: документ либо применён целиком, либо не применён вовсе. Половина
проведённой накладной — это остатки, которые не сходятся ни с чем, и найти
такое постфактум нельзя.

Три правила, которые держат этот модуль:

1. НИ ОДНОГО ЗАПРОСА В ЦИКЛЕ. Товары всех строк загружаются одним `IN`, а не
   по одному на строку: накладная на двести позиций иначе давала бы двести
   обращений к базе внутри транзакции, и касса всё это время ждала бы записи.

2. ПОВТОРНОЕ ПРОВЕДЕНИЕ НЕВОЗМОЖНО ПО ПОСТРОЕНИЮ. Не «маловероятно», а
   невозможно: проведение начинается с проверки статуса, и провести можно
   только черновик. Двойное нажатие, повторная отправка запроса, вернувшийся
   таймаут — второй вызов получает 409 и склада не касается.

3. ОТМЕНА ВОЗВРАЩАЕТ СНИМОК, А НЕ СЧИТАЕТ ОБРАТНУЮ ФОРМУЛУ. Средневзвешенная
   себестоимость необратима: из новой средней и цены прихода старую не
   восстановить, если между приходом и отменой была продажа. Поэтому при
   проведении каждая строка запоминает, что стояло в карточке товара ДО неё,
   и отмена просто возвращает это.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.money import to_tiyin, weighted_average_cost
from app.db.models import (
    Product,
    PurchaseCounter,
    PurchaseDoc,
    PurchaseLine,
    Sale,
    SaleItem,
    StockMove,
    SupplierPayment,
    User,
)

# Виды документа. Возврат поставщику — тот же документ с обратным знаком по
# складу, а не отдельная таблица: список, фильтры, проведение и отмена у них
# общие целиком.
KIND_PURCHASE = "purchase"
KIND_RETURN = "return"
KINDS = (KIND_PURCHASE, KIND_RETURN)

STATUS_DRAFT = "draft"
STATUS_POSTED = "posted"
STATUS_CANCELED = "canceled"


class PostingError(Exception):
    """Документ нельзя провести или отменить. Текст идёт кассиру как есть."""

    def __init__(self, message: str, *, conflict: bool = True) -> None:
        super().__init__(message)
        self.message = message
        self.conflict = conflict


async def next_doc_number(session: AsyncSession) -> int:
    """Следующий номер документа. Счётчиком, как у чеков."""
    counter = (
        await session.execute(select(PurchaseCounter).where(PurchaseCounter.id == 1))
    ).scalar_one_or_none()
    if counter is None:
        highest = int(
            (
                await session.execute(select(func.coalesce(func.max(PurchaseDoc.number), 0)))
            ).scalar_one()
            or 0
        )
        counter = PurchaseCounter(id=1, last_number=highest)
        session.add(counter)
        await session.flush()
    counter.last_number += 1
    return counter.last_number


def recalc_totals(doc: PurchaseDoc, lines: list[PurchaseLine]) -> None:
    """Итоги документа — снимком в самом документе.

    Считать их на лету в списке значило бы делать SUM по строкам на каждую
    страницу — то есть запрос в цикле по документам. Снимок пересчитывается
    ровно там, где строки меняются, и больше нигде.
    """
    doc.total_tiyin = sum(int(line.line_total_tiyin) for line in lines)
    doc.positions_count = len(lines)
    doc.total_qty = round(sum(float(line.qty) for line in lines), 3)


async def load_products(session: AsyncSession, lines: list[PurchaseLine]) -> dict[int, Product]:
    """Товары всех строк — ОДНИМ запросом.

    Именно здесь легче всего написать запрос в цикле, и именно поэтому загрузка
    вынесена отдельной функцией: у неё на входе весь список строк, а не одна.
    """
    ids = {int(line.product_id) for line in lines if line.product_id}
    if not ids:
        return {}
    rows = (await session.execute(select(Product).where(Product.id.in_(ids)))).scalars().all()
    return {product.id: product for product in rows}


async def post_document(session: AsyncSession, doc: PurchaseDoc, user: User) -> PurchaseDoc:
    """Провести документ. Одной транзакцией: либо всё, либо ничего.

    Что делает проведение прихода:

      * увеличивает остаток товара;
      * пересчитывает себестоимость средневзвешенной (app/core/money.py —
        формула записана ровно в одном месте);
      * применяет новую розничную цену, если она указана в строке;
      * пишет движение по складу, чтобы приход был виден в истории товара.

    Возврат поставщику делает то же зеркально: остаток уменьшается,
    себестоимость и розничная цена НЕ трогаются. Возврат — это не отрицательная
    закупка: товар уезжает по той цене, по которой приехал, и пересчитывать
    среднюю по нему второй раз значило бы её испортить.

    Задолженность перед поставщиком нигде не хранится числом — она считается
    агрегатом (`supplier_balance`). Поле «текущий долг» рассинхронизировалось
    бы с документами при первой же правке задним числом.
    """
    if doc.status != STATUS_DRAFT:
        # Единственная защита от задвоения остатков, и она достаточна: второй
        # вызов не дойдёт до склада вовсе.
        raise PostingError(
            f"Документ №{doc.number} уже {'проведён' if doc.status == STATUS_POSTED else 'отменён'}."
        )

    lines = list(
        (
            await session.execute(
                select(PurchaseLine)
                .where(PurchaseLine.doc_id == doc.id)
                .order_by(PurchaseLine.sort_order, PurchaseLine.id)
            )
        ).scalars().all()
    )
    if not lines:
        raise PostingError("В документе нет строк — проводить нечего.", conflict=False)

    products = await load_products(session, lines)
    missing = [line.name for line in lines if line.product_id and line.product_id not in products]
    if missing:
        raise PostingError(
            "Товар из документа не найден: " + ", ".join(missing[:5]), conflict=False
        )
    without_product = [line.name for line in lines if not line.product_id]
    if without_product:
        raise PostingError(
            "Строка без товара: " + ", ".join(without_product[:5]) + ". Выберите товар или удалите строку.",
            conflict=False,
        )

    now = datetime.now(UTC)
    incoming = doc.kind == KIND_PURCHASE

    for line in lines:
        product = products[int(line.product_id)]

        # Снимок «до». Пишется ДО изменения — иначе отмена вернула бы то же
        # самое, что и было после проведения.
        line.before_qty = float(product.stock_qty)
        line.before_cost_tiyin = to_tiyin(product.cost_price)
        line.before_retail_tiyin = to_tiyin(product.price)

        qty = float(line.qty)
        if incoming:
            product.cost_price = (
                weighted_average_cost(
                    stock_qty=float(product.stock_qty),
                    stock_cost_tiyin=line.before_cost_tiyin,
                    incoming_qty=qty,
                    incoming_cost_tiyin=int(line.cost_tiyin),
                )
                / 100
            )
            product.stock_qty = float(product.stock_qty) + qty
            if int(line.retail_tiyin) > 0:
                product.price = int(line.retail_tiyin) / 100
        else:
            product.stock_qty = float(product.stock_qty) - qty

        session.add(
            StockMove(
                product_id=product.id,
                qty_delta=qty if incoming else -qty,
                reason="purchase" if incoming else "return",
                ref_type="purchase_doc",
                ref_id=str(doc.id),
                note=f"{'Приход' if incoming else 'Возврат поставщику'} по документу №{doc.number}",
                user_id=user.id,
            )
        )

    doc.status = STATUS_POSTED
    doc.posted_at = now
    doc.posted_by_user_id = user.id
    recalc_totals(doc, lines)
    return doc


async def unpost_document(session: AsyncSession, doc: PurchaseDoc, user: User) -> PurchaseDoc:
    """Отменить проведение: вернуть остатки и цены ровно как было.

    Возвращается СНИМОК, снятый при проведении, а не результат обратной
    формулы. Обратной формулы для средневзвешенной себестоимости не
    существует: между приходом и отменой мог быть и расход, и другой приход,
    и остаток в знаменателе уже другой.

    Остаток при этом именно вычитается, а не восстанавливается снимком: после
    прихода товар продавали, и вернуть его остаток к тому, что было до
    накладной, значило бы отменить заодно все продажи.
    """
    if doc.status != STATUS_POSTED:
        raise PostingError(f"Документ №{doc.number} не проведён — отменять нечего.")

    lines = list(
        (
            await session.execute(select(PurchaseLine).where(PurchaseLine.doc_id == doc.id))
        ).scalars().all()
    )
    products = await load_products(session, lines)
    incoming = doc.kind == KIND_PURCHASE

    for line in lines:
        product = products.get(int(line.product_id or 0))
        if product is None:
            # Товар удалили после проведения. Строку пропускаем, но молча это
            # не оставляем: остаток по несуществующему товару вернуть некуда,
            # и документ должен это показать.
            continue
        qty = float(line.qty)
        product.stock_qty = float(product.stock_qty) - qty if incoming else float(product.stock_qty) + qty
        if incoming:
            # Цены — снимком. Остаток — вычитанием: см. док-строку функции.
            product.cost_price = int(line.before_cost_tiyin) / 100
            product.price = int(line.before_retail_tiyin) / 100
        session.add(
            StockMove(
                product_id=product.id,
                qty_delta=-qty if incoming else qty,
                reason="adjust",
                ref_type="purchase_doc_unpost",
                ref_id=str(doc.id),
                note=f"Отмена проведения документа №{doc.number}",
                user_id=user.id,
            )
        )

    doc.status = STATUS_CANCELED
    return doc


async def sold_after_posting(session: AsyncSession, doc: PurchaseDoc) -> list[dict]:
    """Что из документа успели продать после его проведения.

    Нужно перед отменой: если товар уже ушёл покупателю, отмена вернёт остаток
    в минус, и кассир должен увидеть, что именно продано, а не узнать об этом
    из отчёта через неделю.

    Одним запросом с группировкой по товару. Список товаров документа — одним
    `IN`, а не запросом на строку.
    """
    if doc.posted_at is None:
        return []
    ids = list(
        (
            await session.execute(
                select(PurchaseLine.product_id).where(
                    PurchaseLine.doc_id == doc.id, PurchaseLine.product_id.is_not(None)
                )
            )
        ).scalars().all()
    )
    if not ids:
        return []
    rows = (
        await session.execute(
            select(
                SaleItem.product_id,
                func.min(SaleItem.name).label("name"),
                func.sum(SaleItem.quantity).label("qty"),
                func.count(func.distinct(Sale.id)).label("receipts"),
            )
            .join(Sale, SaleItem.sale_id == Sale.id)
            .where(
                SaleItem.product_id.in_(ids),
                Sale.created_at >= doc.posted_at,
                Sale.status.not_in(("canceled", "refunded")),
            )
            .group_by(SaleItem.product_id)
        )
    ).all()
    return [
        {
            "product_id": int(row.product_id),
            "name": row.name or "",
            "qty": float(row.qty or 0),
            "receipts": int(row.receipts or 0),
        }
        for row in rows
        if float(row.qty or 0) > 0
    ]


def debt_delta_expression():
    """Вклад одного документа в долг перед поставщиком, в тыйынах.

    Долг создаёт только ПРОВЕДЁННАЯ закупка «в долг»: черновик ничего не
    значит, оплаченная сразу закупка долга не создаёт, отменённая его снимает.
    Проведённый возврат «в долг» долг уменьшает — товар уехал обратно.

    Выражение вынесено, потому что его спрашивают в трёх местах: сальдо одного
    поставщика, столбец «долг» в списке поставщиков и просроченность. Три
    копии одного условия однажды разошлись бы, и список показывал бы один
    долг, а карточка — другой.
    """
    counts = (PurchaseDoc.status == STATUS_POSTED) & (PurchaseDoc.settlement == "credit")
    return case(
        (counts & (PurchaseDoc.kind == KIND_PURCHASE), PurchaseDoc.total_tiyin),
        (counts & (PurchaseDoc.kind == KIND_RETURN), -PurchaseDoc.total_tiyin),
        else_=0,
    )


async def supplier_balance(session: AsyncSession, supplier_id: int) -> int:
    """Сколько должны поставщику сейчас, в тыйынах.

    Долг = проведённые закупки в долг − проведённые возвраты в долг − оплаты.
    Два агрегата, не больше: по документам и по оплатам.

    Считается, а не хранится полем. Поле пришлось бы править из четырёх мест
    (проведение, отмена, оплата, удаление оплаты), и первое же пропущенное
    место дало бы долг, который не сходится с документами, — а какой из двух
    цифр верить, никто не скажет.
    """
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
    paid = int(
        (
            await session.execute(
                select(func.coalesce(func.sum(SupplierPayment.amount_tiyin), 0)).where(
                    SupplierPayment.supplier_id == supplier_id
                )
            )
        ).scalar_one()
        or 0
    )
    return charged - paid
