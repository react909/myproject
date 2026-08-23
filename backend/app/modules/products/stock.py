"""Что списывается со склада при продаже: товар, услуга или комплект.

Модуль существует ради одной вещи — комплекта. Продажа комплекта списывает не
его самого, а СОСТАВЛЯЮЩИЕ, и эта развёртка нужна одинаково при продаже, при
возврате и при подсчёте остатка комплекта на витрине. Три копии этой логики
разошлись бы на первой же правке: касса списывала бы одно, возврат возвращал
другое, а витрина показывала третье.

Правила по видам позиции:

    piece / weight  списывается сам, количеством строки чека;
    service         не списывается вовсе, остатка не имеет;
    bundle          сам не списывается; списываются составляющие, каждая —
                    (количество в составе × количество в строке чека).

Вложенных комплектов нет: составляющая комплекта — обычный товар. Разворачивать
дерево неизвестной глубины в горячем пути продажи нельзя.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Product, ProductBundleItem

KIND_SERVICE = "service"
KIND_BUNDLE = "bundle"
#: Виды, у которых есть собственный остаток на складе.
STOCKED_KINDS = ("piece", "weight")


@dataclass
class Component:
    """Составляющая комплекта: товар и сколько его входит в один комплект."""

    product: Product
    qty: float


@dataclass
class Catalog:
    """Всё, что нужно знать о позициях чека, вынутое из базы ДВУМЯ запросами.

    Не по запросу на строку: чек на двадцать позиций иначе давал бы двадцать
    обращений к базе внутри транзакции продажи, а продажа — это то, чего ждёт
    человек у кассы.
    """

    products: dict[int, Product] = field(default_factory=dict)
    components: dict[int, list[Component]] = field(default_factory=dict)

    def get(self, product_id: int) -> Product | None:
        return self.products.get(product_id)

    def is_bundle(self, product_id: int) -> bool:
        product = self.products.get(product_id)
        return bool(product and product.kind == KIND_BUNDLE)


async def load_catalog(session: AsyncSession, product_ids: set[int]) -> Catalog:
    """Товары чека и составы комплектов среди них. Два запроса, не больше."""
    catalog = Catalog()
    if not product_ids:
        return catalog

    rows = (
        await session.execute(select(Product).where(Product.id.in_(product_ids)))
    ).scalars().all()
    catalog.products = {product.id: product for product in rows}

    bundle_ids = {p.id for p in rows if p.kind == KIND_BUNDLE}
    if not bundle_ids:
        return catalog

    # Состав и сами составляющие — одним запросом с соединением: иначе после
    # состава пришлось бы вторым заходом добирать товары по одному.
    pairs = (
        await session.execute(
            select(ProductBundleItem, Product)
            .join(Product, ProductBundleItem.item_id == Product.id)
            .where(ProductBundleItem.bundle_id.in_(bundle_ids))
            .order_by(ProductBundleItem.bundle_id, ProductBundleItem.sort_order)
        )
    ).all()
    for item, product in pairs:
        catalog.components.setdefault(item.bundle_id, []).append(
            Component(product=product, qty=float(item.qty))
        )
        # Составляющая тоже должна быть под рукой: остаток списывается с неё.
        catalog.products.setdefault(product.id, product)
    return catalog


def stock_deltas(catalog: Catalog, sold: dict[int, float]) -> dict[int, float]:
    """Сколько списать с каждого товара. Комплекты уже развёрнуты.

    Чистая функция: на входе то, что вынули из базы, и что продали, — на выходе
    карта «товар → количество». Это позволяет проверить развёртку комплектов
    тестом, не заводя продажу.

    Один и тот же товар может прийти и строкой чека, и составляющей комплекта
    из другой строки. Количества СКЛАДЫВАЮТСЯ: иначе списалось бы только одно
    из двух.
    """
    deltas: dict[int, float] = {}
    for product_id, quantity in sold.items():
        product = catalog.get(product_id)
        if product is None or quantity <= 0:
            continue

        if product.kind == KIND_SERVICE:
            continue

        if product.kind == KIND_BUNDLE:
            for component in catalog.components.get(product_id, []):
                if component.product.kind not in STOCKED_KINDS:
                    continue
                deltas[component.product.id] = round(
                    deltas.get(component.product.id, 0.0) + component.qty * quantity, 6
                )
            continue

        deltas[product_id] = round(deltas.get(product_id, 0.0) + quantity, 6)
    return deltas


def unit_cost(catalog: Catalog, product_id: int) -> float:
    """Себестоимость единицы позиции — для прибыли в отчётах.

    У комплекта своей себестоимости нет: она складывается из составляющих. Если
    бы комплект носил собственную `cost_price`, она разошлась бы с ценами
    составляющих при первом же приходе.
    """
    product = catalog.get(product_id)
    if product is None:
        return 0.0
    if product.kind != KIND_BUNDLE:
        return float(product.cost_price)
    return round(
        sum(
            float(component.product.cost_price) * component.qty
            for component in catalog.components.get(product_id, [])
        ),
        2,
    )


@dataclass(frozen=True)
class Shortage:
    """Чего и сколько не хватает, чтобы продать комплект."""

    bundle_name: str
    item_name: str
    needed: float
    available: float
    #: Составляющая помечена удалённой — это не «не хватает», это «нельзя».
    archived: bool = False


def check_bundles(catalog: Catalog, sold: dict[int, float]) -> list[Shortage]:
    """Можно ли продать заказанные комплекты. Пусто — можно.

    ПОЧЕМУ ОТКАЗ, А НЕ МИНУС НА ОСТАТКЕ. Обычный товар, проданный сверх
    остатка, уходит в минус — так касса работала всегда, и трогать это в этой
    задаче не нужно: продавец видит одну неверную цифру у одного товара и
    поправляет её инвентаризацией.

    С комплектом иначе. Он списывает несколько товаров сразу, и его продажа
    «в минус» портит остатки сразу нескольким позициям, ни одна из которых в
    чеке не названа. Найти потом причину нельзя: в чеке комплект, в остатках
    минус у трёх товаров. Поэтому здесь отказ, и отказ ИМЕНУЕТ, чего не
    хватило, — иначе кассир у живой очереди не поймёт, что делать.

    Составляющая, помеченная удалённой, останавливает продажу отдельно от
    нехватки: её остаток может быть каким угодно, но продавать комплект,
    собранный из выведенного товара, нельзя.
    """
    shortages: list[Shortage] = []
    for product_id, quantity in sold.items():
        product = catalog.get(product_id)
        if product is None or product.kind != KIND_BUNDLE or quantity <= 0:
            continue

        components = catalog.components.get(product_id, [])
        if not components:
            # Комплект без состава списывать нечего, и продавать его — значит
            # продать воздух по цене набора.
            shortages.append(
                Shortage(
                    bundle_name=product.name,
                    item_name="состав не задан",
                    needed=quantity,
                    available=0.0,
                )
            )
            continue

        for component in components:
            item = component.product
            if not item.is_active:
                shortages.append(
                    Shortage(
                        bundle_name=product.name,
                        item_name=item.name,
                        needed=0.0,
                        available=0.0,
                        archived=True,
                    )
                )
                continue
            if item.kind not in STOCKED_KINDS:
                continue
            needed = round(component.qty * quantity, 6)
            available = float(item.stock_qty)
            if needed > available:
                shortages.append(
                    Shortage(
                        bundle_name=product.name,
                        item_name=item.name,
                        needed=needed,
                        available=available,
                    )
                )
    return shortages


def shortage_message(shortages: list[Shortage]) -> str:
    """Отказ, из которого понятно, что делать. Не «недостаточно товара»."""
    archived = [s for s in shortages if s.archived]
    if archived:
        names = ", ".join(sorted({f"«{s.item_name}»" for s in archived}))
        return (
            f"Комплект «{archived[0].bundle_name}» продать нельзя: "
            f"из состава убран товар {names}. Поправьте состав комплекта."
        )
    parts = [
        f"«{s.item_name}» — нужно {s.needed:g}, есть {s.available:g}"
        for s in shortages[:4]
    ]
    tail = f" и ещё {len(shortages) - 4}" if len(shortages) > 4 else ""
    return (
        f"Не хватает составляющих комплекта «{shortages[0].bundle_name}»: "
        + "; ".join(parts)
        + tail
        + "."
    )


def bundle_stock(catalog: Catalog, bundle_id: int) -> float:
    """Сколько комплектов можно собрать из того, что есть на складе.

    Минимум по составляющим: комплект кончается, как только кончилась любая из
    них. Показывается на витрине и в отчёте по остаткам вместо собственного
    остатка комплекта, которого у него нет.
    """
    components = catalog.components.get(bundle_id, [])
    if not components:
        return 0.0
    possible = []
    for component in components:
        if component.qty <= 0:
            continue
        if component.product.kind not in STOCKED_KINDS:
            # Услуга в составе не ограничивает: её можно оказать сколько угодно.
            continue
        possible.append(float(component.product.stock_qty) / component.qty)
    if not possible:
        return 0.0
    return float(int(min(possible))) if min(possible) > 0 else 0.0
