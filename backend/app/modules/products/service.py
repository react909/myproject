"""Правила карточки товара, которые нужны больше чем одному маршруту.

Здесь живёт то, что нельзя оставить в обработчике: пересчёт цены комплекта и
проверка штрихкода. Оба нужны и при создании, и при правке, и оба легко
разъезжаются, если написать их дважды.
"""

from __future__ import annotations

from sqlalchemy import literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Product, ProductBundleItem

#: Комплект берёт цену из состава, а не из своего поля.
PRICE_MODE_SUM = "sum"
#: У комплекта своя цена, состав на неё не влияет.
PRICE_MODE_OWN = "own"


async def recompute_bundle_prices(
    session: AsyncSession, changed_product_ids: set[int]
) -> list[int]:
    """Пересчитать цену комплектов, куда входят изменённые товары.

    ЦЕНА КОМПЛЕКТА В РЕЖИМЕ «СУММА» ЖИВАЯ, А НЕ ЗАМОРОЖЕННАЯ. Выбор между
    этими двумя вариантами и есть суть функции, поэтому вот причина.

    Замороженная сумма — это цена, посчитанная один раз при сохранении. Она
    тихо расходится с составляющими: подорожал чай, комплект «чай + пирожок»
    продолжает продаваться по вчерашней цене, и заметят это по прибыли через
    месяц. Владелец при этом уверен, что выбрал «сумма составляющих» именно
    чтобы такого не было.

    Живая сумма означает, что менять `products.price` комплекта надо в момент,
    когда меняется цена составляющей. Считать её на лету при каждом чтении
    нельзя: цену комплекта читает касса — из своего кеша каталога, одним полем,
    без похода за составом. Поэтому здесь она ПЕРЕСЧИТЫВАЕТСЯ И ЗАПИСЫВАЕТСЯ,
    и касса не меняется вовсе.

    Комплектов в магазине единицы, поэтому пересчёт стоит два запроса и
    выполняется только когда действительно менялась цена.

    Возвращает идентификаторы комплектов, которым цена поменялась.
    """
    if not changed_product_ids:
        return []

    # Какие комплекты собраны из этих товаров. Один запрос.
    bundle_ids = set(
        (
            await session.execute(
                select(ProductBundleItem.bundle_id).where(
                    ProductBundleItem.item_id.in_(changed_product_ids)
                )
            )
        ).scalars().all()
    )
    # Сам изменённый товар может быть комплектом — его тоже пересчитываем.
    bundle_ids |= changed_product_ids
    if not bundle_ids:
        return []

    bundles = (
        await session.execute(
            select(Product).where(
                Product.id.in_(bundle_ids),
                Product.kind == "bundle",
                Product.bundle_price_mode == PRICE_MODE_SUM,
            )
        )
    ).scalars().all()
    if not bundles:
        return []

    # Состав всех этих комплектов вместе с ценами составляющих. Один запрос.
    rows = (
        await session.execute(
            select(ProductBundleItem.bundle_id, ProductBundleItem.qty, Product.price)
            .join(Product, ProductBundleItem.item_id == Product.id)
            .where(ProductBundleItem.bundle_id.in_([b.id for b in bundles]))
        )
    ).all()

    totals: dict[int, float] = {}
    for bundle_id, qty, price in rows:
        totals[bundle_id] = totals.get(bundle_id, 0.0) + float(price) * float(qty)

    touched: list[int] = []
    for bundle in bundles:
        fresh = round(totals.get(bundle.id, 0.0), 2)
        if abs(float(bundle.price) - fresh) > 1e-9:
            bundle.price = fresh
            touched.append(bundle.id)
    return touched


async def barcode_owner(
    session: AsyncSession, barcode: str, *, exclude_id: int | None = None
) -> Product | None:
    """Чей это штрихкод. `None` — свободен.

    Проверка в коде НЕ ЗАМЕНЯЕТ уникальный индекс в базе (миграция 0031) — она
    его дополняет. Индекс не даст завести дубль никогда и ничем, включая
    прямой запрос; проверка здесь нужна, чтобы вместо голого «нарушение
    уникальности» показать, какой именно товар уже носит этот код, и
    предложить открыть его.

    Ищет и по основному коду, и по дополнительным: сканер на кассе смотрит в
    оба списка, и код, занятый как дополнительный, тоже занят.
    """
    code = (barcode or "").strip()
    if not code:
        return None
    conditions = [Product.barcode == code]
    stmt = select(Product).where(*conditions)
    if exclude_id is not None:
        stmt = stmt.where(Product.id != exclude_id)
    found = (await session.execute(stmt.limit(1))).scalar_one_or_none()
    if found is not None:
        return found

    # Дополнительные коды лежат строкой через запятую — точное совпадение
    # ищется по обрамлённой запятыми строке, иначе «123» нашлось бы внутри
    # «1234».
    #
    # Склейка оператором `+`, а не `func.concat`: SQLAlchemy превращает его в
    # `||`, который понимают и SQLite, и Postgres. Функции `concat` в SQLite
    # нет вовсе.
    like = f"%,{code},%"
    stmt = select(Product).where(
        (literal(",") + Product.extra_barcodes + literal(",")).like(like)
    )
    if exclude_id is not None:
        stmt = stmt.where(Product.id != exclude_id)
    return (await session.execute(stmt.limit(1))).scalar_one_or_none()
