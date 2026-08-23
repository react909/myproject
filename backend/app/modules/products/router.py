"""Маршруты каталога: карточка товара, состав комплекта, фото и видео.

Что здесь важно знать, прежде чем править.

ЦЕНЫ В API — ЦЕЛЫЕ ТЫЙЫНЫ, в базе — float. Граница проходит ровно здесь, и
перевод делается функциями из `app/core/money.py`, а не умножением по месту.
Колонки не переводятся в целые намеренно: на них стоит вся касса — витрина,
чек, возврат, закупка, отчёты, — и перевод означал бы переписать продажу.

СТАРЫЕ МАРШРУТЫ СОХРАНЕНЫ. `GET /api/products`, `POST /api/products`,
`PATCH`, `DELETE` отвечают в прежней форме: на них стоит каталог кассы
(`services/products.ts`) и форма закупки. Новые поля добавлены рядом, ни одно
старое не убрано и не переименовано.

ФАЙЛЫ ФОТО И ВИДЕО НЕ ЛЕЖАТ В БАЗЕ — см. `media.py`. Здесь только приём,
привязка к товару и отдача.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.money import to_som, to_tiyin
from app.core.security import get_current_user
from app.db.database import get_db_session
from app.db.models import (
    Category,
    Product,
    ProductBundleItem,
    ProductMedia,
    StockMove,
    Supplier,
    User,
)
from app.modules.products import media as media_store
from app.modules.products.service import (
    PRICE_MODE_SUM,
    barcode_owner,
    recompute_bundle_prices,
)
from app.modules.products.stock import bundle_stock, load_catalog

logger = logging.getLogger("nurcrm.products")

router = APIRouter(prefix="/api", tags=["products"])

KINDS = ("piece", "weight", "service", "bundle")
MAX_PAGE = 200


# ── Схемы: старые (их читает касса) ───────────────────────────────────────────


class CategoryOut(BaseModel):
    id: int
    name: str
    sort_order: int


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    sort_order: int = 0


class ProductOut(BaseModel):
    """Форма, которую разбирает каталог кассы. Поля не убирать и не переименовывать."""

    id: int
    name: str
    barcode: str
    extra_barcodes: str
    kind: str
    unit: str
    price: float
    wholesale_price: float
    cost_price: float
    stock_qty: float
    category_id: int | None
    category_name: str | None = None
    image: str
    is_active: bool


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    barcode: str = ""
    extra_barcodes: str = ""
    kind: str = Field(default="piece", pattern="^(piece|weight|service|bundle)$")
    unit: str = "шт"
    price: float = Field(ge=0)
    wholesale_price: float = Field(default=0, ge=0)
    cost_price: float = Field(default=0, ge=0)
    stock_qty: float = Field(default=0)
    category_id: int | None = None
    image: str = ""


class ProductUpdate(BaseModel):
    name: str | None = None
    barcode: str | None = None
    extra_barcodes: str | None = None
    kind: str | None = None
    unit: str | None = None
    price: float | None = None
    wholesale_price: float | None = None
    cost_price: float | None = None
    stock_qty: float | None = None
    category_id: int | None = None
    image: str | None = None
    is_active: bool | None = None


# ── Схемы: карточка товара ────────────────────────────────────────────────────


class BundleLineIn(BaseModel):
    product_id: int
    qty: float = Field(gt=0)


class BundleLineOut(BaseModel):
    product_id: int
    name: str
    qty: float
    unit: str
    stock_qty: float
    price_tiyin: int
    is_active: bool


class MediaOut(BaseModel):
    id: int
    kind: str
    sort_order: int
    mime: str
    bytes_size: int
    width: int
    height: int
    duration_ms: int
    #: Адреса файла и уменьшенной копии. Полные, чтобы интерфейс не собирал их
    #: сам: собранный по кускам адрес — это место, где однажды потеряется id.
    url: str
    thumb_url: str


class MediaTokenIn(BaseModel):
    """Загруженный файл и его уменьшенная копия.

    Копия приходит ОТДЕЛЬНЫМ файлом, а не делается сервером: уменьшает
    интерфейс, у которого уже есть распакованная картинка в памяти. Заставлять
    Python распаковывать её второй раз ради миниатюры значит грузить процесс,
    который обслуживает кассу.

    У видео копии нет — `thumb_token` пуст. Кадр из видео без ffmpeg не
    вынуть, и делать вид, что мы это умеем, не нужно.
    """

    token: str = Field(max_length=128)
    thumb_token: str = Field(default="", max_length=128)


class CardIn(BaseModel):
    """Карточка целиком. Один запрос на товар, состав и медиа."""

    kind: str = Field(default="piece", pattern="^(piece|weight|service|bundle)$")
    name: str = Field(min_length=1, max_length=255)
    barcode: str = Field(default="", max_length=64)
    extra_barcodes: str = Field(default="", max_length=512)
    unit: str = Field(default="шт", max_length=16)
    stock_qty: float = 0

    cost_tiyin: int = Field(default=0, ge=0)
    price_tiyin: int = Field(default=0, ge=0)
    wholesale_tiyin: int = Field(default=0, ge=0)
    wholesale_from_qty: float = Field(default=0, ge=0)

    min_stock: float = Field(default=0, ge=0)
    expires_at: str | None = None

    supplier_id: int | None = None
    category_id: int | None = None
    #: Новая категория одной строкой — чтобы не уходить со страницы за ней.
    category_name: str = Field(default="", max_length=255)
    brand: str = Field(default="", max_length=128)
    country: str = Field(default="", max_length=128)
    description: str = Field(default="", max_length=2000)

    bundle_price_mode: str = Field(default="own", pattern="^(own|sum)$")
    bundle: list[BundleLineIn] = Field(default_factory=list, max_length=50)

    #: Файлы, загруженные заранее (см. media.stage).
    media_tokens: list[MediaTokenIn] = Field(default_factory=list, max_length=6)
    #: Ключ формы: второй раз тот же токен товар не создаёт.
    client_token: str = Field(default="", max_length=64)


class CardOut(BaseModel):
    id: int
    kind: str
    name: str
    barcode: str
    extra_barcodes: str
    unit: str
    stock_qty: float

    cost_tiyin: int
    price_tiyin: int
    wholesale_tiyin: int
    wholesale_from_qty: float
    markup_percent: float

    min_stock: float
    expires_at: str | None

    supplier_id: int | None
    supplier_name: str
    category_id: int | None
    category_name: str
    brand: str
    country: str
    description: str

    bundle_price_mode: str
    bundle: list[BundleLineOut]
    #: Сколько комплектов можно собрать из остатков. У обычного товара — свой остаток.
    available: float

    media: list[MediaOut]
    is_active: bool


class StagedOut(BaseModel):
    token: str
    kind: str
    mime: str
    bytes_size: int
    width: int
    height: int


class BarcodeOwnerOut(BaseModel):
    """Кто уже носит этот штрихкод. `id = null` — код свободен."""

    id: int | None = None
    name: str = ""
    kind: str = ""
    price_tiyin: int = 0


class SearchRow(BaseModel):
    id: int
    name: str
    barcode: str
    kind: str
    unit: str
    price_tiyin: int
    stock_qty: float
    min_stock: float
    thumb_url: str
    is_active: bool


class SearchPage(BaseModel):
    items: list[SearchRow]
    next_cursor: str | None = None
    total: int


# ── Преобразования ────────────────────────────────────────────────────────────


def _product_out(p: Product, category_name: str | None = None) -> ProductOut:
    return ProductOut(
        id=p.id,
        name=p.name,
        barcode=p.barcode,
        extra_barcodes=p.extra_barcodes,
        kind=p.kind,
        unit=p.unit,
        price=p.price,
        wholesale_price=p.wholesale_price,
        cost_price=p.cost_price,
        stock_qty=p.stock_qty,
        category_id=p.category_id,
        category_name=category_name,
        image=p.image,
        is_active=p.is_active,
    )


def _media_out(row: ProductMedia) -> MediaOut:
    base = f"/api/products/{row.product_id}/media/{row.id}"
    return MediaOut(
        id=row.id,
        kind=row.kind,
        sort_order=row.sort_order,
        mime=row.mime,
        bytes_size=row.bytes_size,
        width=row.width,
        height=row.height,
        duration_ms=row.duration_ms,
        url=base,
        thumb_url=f"{base}?thumb=1" if row.thumb_name else base,
    )


def _markup(cost_tiyin: int, price_tiyin: int) -> float:
    if cost_tiyin <= 0:
        return 0.0
    return round((price_tiyin - cost_tiyin) * 100 / cost_tiyin, 2)


def _moment(raw: str | None, *, field: str) -> datetime | None:
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Неверная дата: {field}.")
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


async def _load(session: AsyncSession, product_id: int) -> Product:
    product = (
        await session.execute(select(Product).where(Product.id == product_id))
    ).scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=404, detail="Товар не найден.")
    return product


async def _card_out(session: AsyncSession, product: Product) -> CardOut:
    supplier_name = ""
    if product.supplier_id:
        supplier_name = (
            await session.execute(select(Supplier.name).where(Supplier.id == product.supplier_id))
        ).scalar_one_or_none() or ""
    category_name = ""
    if product.category_id:
        category_name = (
            await session.execute(select(Category.name).where(Category.id == product.category_id))
        ).scalar_one_or_none() or ""

    lines: list[BundleLineOut] = []
    available = float(product.stock_qty)
    expires_at = product.expires_at
    cost_price = float(product.cost_price)
    if product.kind == "bundle":
        rows = (
            await session.execute(
                select(ProductBundleItem, Product)
                .join(Product, ProductBundleItem.item_id == Product.id)
                .where(ProductBundleItem.bundle_id == product.id)
                .order_by(ProductBundleItem.sort_order, ProductBundleItem.id)
            )
        ).all()
        lines = [
            BundleLineOut(
                product_id=item.item_id,
                name=component.name,
                qty=item.qty,
                unit=component.unit,
                stock_qty=component.stock_qty,
                price_tiyin=to_tiyin(component.price),
                is_active=component.is_active,
            )
            for item, component in rows
        ]
        catalog = await load_catalog(session, {product.id})
        available = bundle_stock(catalog, product.id)
        # Себестоимость комплекта — сумма составляющих. Своей у него нет и быть
        # не может: она разошлась бы с ценами составляющих при первом приходе.
        cost_price = sum(float(c.cost_price) * float(i.qty) for i, c in rows)
        # Срок годности — по САМОМУ РАННЕМУ в составе: комплект портится тогда,
        # когда испортилась первая его часть, а не последняя.
        dates = [c.expires_at for _i, c in rows if c.expires_at is not None]
        expires_at = min(dates) if dates else None

    media_rows = (
        await session.execute(
            select(ProductMedia)
            .where(ProductMedia.product_id == product.id)
            .order_by(ProductMedia.sort_order, ProductMedia.id)
        )
    ).scalars().all()

    cost_tiyin = to_tiyin(cost_price)
    price_tiyin = to_tiyin(product.price)
    return CardOut(
        id=product.id,
        kind=product.kind,
        name=product.name,
        barcode=product.barcode,
        extra_barcodes=product.extra_barcodes,
        unit=product.unit,
        stock_qty=product.stock_qty,
        cost_tiyin=cost_tiyin,
        price_tiyin=price_tiyin,
        wholesale_tiyin=to_tiyin(product.wholesale_price),
        wholesale_from_qty=product.wholesale_from_qty,
        markup_percent=_markup(cost_tiyin, price_tiyin),
        min_stock=product.min_stock,
        expires_at=expires_at.isoformat() if expires_at else None,
        supplier_id=product.supplier_id,
        supplier_name=supplier_name,
        category_id=product.category_id,
        category_name=category_name,
        brand=product.brand,
        country=product.country,
        description=product.description,
        bundle_price_mode=product.bundle_price_mode,
        bundle=lines,
        available=available,
        media=[_media_out(row) for row in media_rows],
        is_active=product.is_active,
    )


# ── Категории (без изменений) ─────────────────────────────────────────────────


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[CategoryOut]:
    rows = (
        await session.execute(select(Category).order_by(Category.sort_order, Category.name))
    ).scalars().all()
    return [CategoryOut(id=c.id, name=c.name, sort_order=c.sort_order) for c in rows]


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
async def create_category(
    payload: CategoryCreate,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> CategoryOut:
    cat = Category(name=payload.name.strip(), sort_order=payload.sort_order)
    session.add(cat)
    await session.commit()
    await session.refresh(cat)
    return CategoryOut(id=cat.id, name=cat.name, sort_order=cat.sort_order)


# ── Каталог кассы (форма ответа не менялась) ──────────────────────────────────


@router.get("/products", response_model=list[ProductOut])
async def list_products(
    q: str = Query(default=""),
    active_only: bool = Query(default=True),
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[ProductOut]:
    stmt = select(Product, Category.name).outerjoin(Category, Product.category_id == Category.id)
    if active_only:
        stmt = stmt.where(Product.is_active.is_(True))
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Product.name.ilike(like),
                Product.barcode.ilike(like),
                Product.extra_barcodes.ilike(like),
            )
        )
    stmt = stmt.order_by(Product.name)
    rows = (await session.execute(stmt)).all()
    return [_product_out(p, cat_name) for p, cat_name in rows]


# ── Поиск для списков карточек ────────────────────────────────────────────────
#
# Объявлен ВЫШЕ `/products/{product_id}`: иначе FastAPI разберёт «search» как
# номер товара и ответит 422.


@router.get("/products/search", response_model=SearchPage)
async def search_products(
    q: str = "",
    kind: str = "",
    supplier_id: int | None = None,
    low_stock: bool = False,
    expiring_days: int | None = None,
    include_archived: bool = False,
    limit: int = Query(default=50, ge=1, le=MAX_PAGE),
    cursor: str | None = None,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> SearchPage:
    """Список товаров: фильтры и страницы — в SQL.

    Курсор по `id`, а не по названию: два товара с одинаковым именем (обычное
    дело — «Пакет» у трёх поставщиков) иначе могли бы поменяться местами между
    страницами, и один попал бы в обе, другой ни в одну.
    """
    conditions = []
    if not include_archived:
        conditions.append(Product.is_active.is_(True))
    if kind:
        conditions.append(Product.kind == kind)
    if supplier_id is not None:
        conditions.append(Product.supplier_id == supplier_id)
    if q.strip():
        like = f"%{q.strip()}%"
        conditions.append(
            or_(
                Product.name.ilike(like),
                Product.barcode.ilike(like),
                Product.extra_barcodes.ilike(like),
            )
        )
    if low_stock:
        # «Заканчивается»: следим только за теми, кому порог задали.
        conditions.append(Product.min_stock > 0)
        conditions.append(Product.stock_qty <= Product.min_stock)
    if expiring_days is not None:
        edge = datetime.now(UTC).timestamp() + expiring_days * 86400
        conditions.append(Product.expires_at.is_not(None))
        conditions.append(Product.expires_at <= datetime.fromtimestamp(edge, UTC))

    total = int(
        (
            await session.execute(select(func.count(Product.id)).where(*conditions))
        ).scalar_one()
        or 0
    )

    page_conditions = list(conditions)
    if cursor:
        try:
            page_conditions.append(Product.id > int(cursor))
        except ValueError:
            pass

    rows = list(
        (
            await session.execute(
                select(Product).where(*page_conditions).order_by(Product.id).limit(limit + 1)
            )
        ).scalars().all()
    )
    has_more = len(rows) > limit
    rows = rows[:limit]

    # Главное фото каждого товара — ОДНИМ запросом на всю страницу, а не по
    # запросу на строку: пятьдесят товаров иначе дали бы пятьдесят обращений.
    thumbs: dict[int, ProductMedia] = {}
    if rows:
        media_rows = (
            await session.execute(
                select(ProductMedia)
                .where(
                    ProductMedia.product_id.in_([p.id for p in rows]),
                    ProductMedia.kind == "photo",
                )
                .order_by(ProductMedia.product_id, ProductMedia.sort_order, ProductMedia.id)
            )
        ).scalars().all()
        for row in media_rows:
            thumbs.setdefault(row.product_id, row)

    items = []
    for product in rows:
        thumb = thumbs.get(product.id)
        items.append(
            SearchRow(
                id=product.id,
                name=product.name,
                barcode=product.barcode,
                kind=product.kind,
                unit=product.unit,
                price_tiyin=to_tiyin(product.price),
                stock_qty=product.stock_qty,
                min_stock=product.min_stock,
                thumb_url=(
                    f"/api/products/{product.id}/media/{thumb.id}?thumb=1" if thumb else ""
                ),
                is_active=product.is_active,
            )
        )
    return SearchPage(
        items=items,
        next_cursor=str(rows[-1].id) if has_more and rows else None,
        total=total,
    )


@router.get("/products/barcode-owner", response_model=BarcodeOwnerOut)
async def check_barcode(
    barcode: str,
    exclude_id: int | None = None,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> BarcodeOwnerOut:
    """Свободен ли штрихкод. Спрашивается формой ДО сохранения.

    Нужен, чтобы вместо «нарушение уникальности» показать, какой именно товар
    уже носит этот код, и предложить открыть его вместо создания дубля.
    """
    owner = await barcode_owner(session, barcode, exclude_id=exclude_id)
    if owner is None:
        return BarcodeOwnerOut()
    return BarcodeOwnerOut(
        id=owner.id,
        name=owner.name,
        kind=owner.kind,
        price_tiyin=to_tiyin(owner.price),
    )


# ── Карточка ──────────────────────────────────────────────────────────────────


async def _apply_card(
    session: AsyncSession,
    product: Product,
    payload: CardIn,
    *,
    user: User,
    creating: bool,
) -> None:
    """Разложить карточку по колонкам. Общая часть создания и правки."""
    kind = payload.kind
    unit = payload.unit.strip() or "шт"
    if kind == "weight":
        unit = "кг"
    elif kind == "service":
        unit = "усл"
    elif kind == "bundle":
        unit = "шт"

    # Категория «на месте»: заводится, если такой ещё нет. Уходить со страницы
    # за новой категорией посреди ввода товара — верный способ потерять ввод.
    category_id = payload.category_id
    if not category_id and payload.category_name.strip():
        name = payload.category_name.strip()
        found = (
            await session.execute(select(Category).where(func.lower(Category.name) == name.lower()))
        ).scalar_one_or_none()
        if found is None:
            found = Category(name=name)
            session.add(found)
            await session.flush()
        category_id = found.id

    product.kind = kind
    product.name = payload.name.strip()
    # Пустой штрихкод — ВСЕГДА пустая строка, никогда NULL: на этом стоит
    # частичный уникальный индекс (миграция 0031).
    product.barcode = (payload.barcode or "").strip()
    product.extra_barcodes = (payload.extra_barcodes or "").strip()
    product.unit = unit
    product.category_id = category_id
    product.brand = payload.brand.strip()
    product.country = payload.country.strip()
    product.description = payload.description.strip()
    product.supplier_id = payload.supplier_id
    product.expires_at = _moment(payload.expires_at, field="срок годности")

    product.cost_price = to_som(payload.cost_tiyin)
    product.wholesale_price = to_som(payload.wholesale_tiyin)
    product.wholesale_from_qty = payload.wholesale_from_qty
    product.bundle_price_mode = payload.bundle_price_mode if kind == "bundle" else "own"
    # Цену комплекта в режиме «сумма» ставит пересчёт ниже, а не форма.
    if not (kind == "bundle" and payload.bundle_price_mode == PRICE_MODE_SUM):
        product.price = to_som(payload.price_tiyin)

    if kind == "service":
        # У услуги нет ни остатка, ни порога, ни срока годности — по природе.
        product.stock_qty = 0
        product.min_stock = 0
        product.expires_at = None
    elif kind == "bundle":
        # У комплекта нет СВОЕГО остатка — он считается по составу. А порог
        # есть: «предупреди, когда собрать можно меньше пяти» — обычный вопрос.
        # Срок годности тоже не свой: он берётся по самому раннему в составе
        # (считается при чтении карточки).
        product.stock_qty = 0
        product.min_stock = payload.min_stock
        product.expires_at = None
    else:
        product.min_stock = payload.min_stock
        if creating:
            product.stock_qty = payload.stock_qty

    # ── Состав комплекта ──
    if kind == "bundle":
        if not payload.bundle:
            raise HTTPException(status_code=400, detail="Комплект без состава сохранить нельзя.")
        item_ids = {line.product_id for line in payload.bundle}
        if product.id in item_ids:
            raise HTTPException(status_code=400, detail="Комплект не может входить сам в себя.")
        components = (
            await session.execute(select(Product).where(Product.id.in_(item_ids)))
        ).scalars().all()
        found = {c.id: c for c in components}
        missing = item_ids - set(found)
        if missing:
            raise HTTPException(status_code=400, detail="Товар из состава не найден.")
        nested = [c.name for c in components if c.kind == "bundle"]
        if nested:
            # Вложенные комплекты дали бы рекурсию при списании в горячем пути
            # продажи. Один уровень покрывает то, ради чего комплекты заводят.
            raise HTTPException(
                status_code=400,
                detail=f"Комплект не может состоять из комплектов: {', '.join(nested[:3])}.",
            )

    if not creating:
        await session.execute(
            delete(ProductBundleItem).where(ProductBundleItem.bundle_id == product.id)
        )
    if kind == "bundle":
        for order, line in enumerate(payload.bundle):
            session.add(
                ProductBundleItem(
                    bundle_id=product.id,
                    item_id=line.product_id,
                    qty=line.qty,
                    sort_order=order,
                )
            )

    # ── Медиа ──
    if payload.media_tokens:
        existing = int(
            (
                await session.execute(
                    select(func.count(ProductMedia.id)).where(
                        ProductMedia.product_id == product.id
                    )
                )
            ).scalar_one()
            or 0
        )
        photos = int(
            (
                await session.execute(
                    select(func.count(ProductMedia.id)).where(
                        ProductMedia.product_id == product.id, ProductMedia.kind == "photo"
                    )
                )
            ).scalar_one()
            or 0
        )
        videos = existing - photos
        for order, item in enumerate(payload.media_tokens):
            info = media_store.describe_staged(item.token)
            if info.kind == "photo":
                photos += 1
                if photos > media_store.MAX_PHOTOS:
                    raise HTTPException(
                        status_code=400, detail=f"Фото не больше {media_store.MAX_PHOTOS}."
                    )
            else:
                videos += 1
                if videos > media_store.MAX_VIDEOS:
                    raise HTTPException(status_code=400, detail="Видео можно только одно.")
            # Перенос файлов — внутри той же транзакции, что и запись о них.
            name = media_store.promote(item.token)
            thumb = media_store.promote(item.thumb_token) if item.thumb_token else ""
            session.add(
                ProductMedia(
                    product_id=product.id,
                    kind=info.kind,
                    sort_order=existing + order,
                    file_name=name,
                    thumb_name=thumb,
                    mime=info.mime,
                    bytes_size=info.bytes_size,
                    width=info.width,
                    height=info.height,
                    duration_ms=info.duration_ms,
                )
            )

    _ = user


@router.post("/products/card", response_model=CardOut, status_code=status.HTTP_201_CREATED)
async def create_card(
    payload: CardIn,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> CardOut:
    """Создать товар, услугу или комплект — ОДНОЙ транзакцией.

    Товар, состав комплекта и записи о файлах пишутся вместе. Оборвалось на
    середине — не остаётся ни половины товара, ни комплекта без состава.
    Сами файлы к этому моменту уже лежат во временной папке и переносятся
    здесь же; при откате они остаются там и убираются уборкой.

    Повторная отправка той же формы возвращает уже созданный товар, а не
    заводит второй: по `client_token` стоит уникальный индекс.
    """
    token = payload.client_token.strip()
    if token:
        existing = (
            await session.execute(select(Product).where(Product.client_token == token))
        ).scalar_one_or_none()
        if existing is not None:
            # Второе нажатие «Сохранить» или повтор после обрыва сети.
            return await _card_out(session, existing)

    owner = await barcode_owner(session, payload.barcode)
    if owner is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Штрихкод уже у товара «{owner.name}».",
        )

    # Название и вид ставятся сразу, до `flush`: `flush` нужен, чтобы получить
    # `id` для состава и медиа, а без названия он упрётся в NOT NULL. Остальное
    # раскладывает `_apply_card`.
    product = Product(name=payload.name.strip(), kind=payload.kind, client_token=token)
    session.add(product)
    await session.flush()
    await _apply_card(session, product, payload, user=user, creating=True)

    if product.kind not in ("service", "bundle") and payload.stock_qty:
        session.add(
            StockMove(
                product_id=product.id,
                qty_delta=payload.stock_qty,
                reason="adjust",
                ref_type="initial",
                note="Начальный остаток",
                user_id=user.id,
            )
        )

    try:
        await recompute_bundle_prices(session, {product.id})
        await session.commit()
    except IntegrityError:
        await session.rollback()
        # Сюда приходит гонка: пока форма проверяла штрихкод, его занял другой.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Товар с таким штрихкодом уже есть.",
        )
    await session.refresh(product)
    return await _card_out(session, product)


@router.get("/products/{product_id}/card", response_model=CardOut)
async def get_card(
    product_id: int,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> CardOut:
    return await _card_out(session, await _load(session, product_id))


@router.put("/products/{product_id}/card", response_model=CardOut)
async def save_card(
    product_id: int,
    payload: CardIn,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> CardOut:
    product = await _load(session, product_id)
    owner = await barcode_owner(session, payload.barcode, exclude_id=product.id)
    if owner is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Штрихкод уже у товара «{owner.name}».",
        )
    await _apply_card(session, product, payload, user=user, creating=False)
    try:
        # Цена изменилась — комплекты, куда входит этот товар, пересчитываются.
        await recompute_bundle_prices(session, {product.id})
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Товар с таким штрихкодом уже есть."
        )
    await session.refresh(product)
    return await _card_out(session, product)


# ── Файлы ─────────────────────────────────────────────────────────────────────


@router.post("/products/media/staged", response_model=StagedOut, status_code=201)
async def stage_media(
    request: Request,
    kind: str = Query(pattern="^(photo|video)$"),
    mime: str = Query(max_length=64),
    duration_ms: int = Query(default=0, ge=0),
    _: User = Depends(get_current_user),
) -> StagedOut:
    """Принять файл во временную папку и вернуть токен.

    Тело — сырые байты, а не multipart: файл уже уменьшен и сжат интерфейсом,
    и заворачивать его в форму значит гонять лишнюю кодировку ради ничего.

    Что проверяется, разобрано в `media.check_upload`. Коротко: сигнатура,
    размер в байтах и размер в точках — по самому файлу, а не по тому, что
    сказано в запросе.
    """
    payload = await request.body()
    try:
        staged = media_store.stage(payload, kind=kind, mime=mime, duration_ms=duration_ms)
    except media_store.MediaError as error:
        raise HTTPException(status_code=400, detail=str(error))
    return StagedOut(
        token=staged.token,
        kind=staged.kind,
        mime=staged.mime,
        bytes_size=staged.bytes_size,
        width=staged.width,
        height=staged.height,
    )


@router.get("/products/{product_id}/media/{media_id}")
async def get_media(
    product_id: int,
    media_id: int,
    thumb: int = 0,
    session: AsyncSession = Depends(get_db_session),
) -> FileResponse:
    """Отдать файл.

    Без проверки входа намеренно: адрес подставляется в `<img src>` и
    `<video src>`, а туда заголовок Authorization не прикрепить. Сервер слушает
    только 127.0.0.1 — это тот же порог доступа, что и у всей кассы.
    """
    row = (
        await session.execute(
            select(ProductMedia).where(
                ProductMedia.id == media_id, ProductMedia.product_id == product_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Файл не найден.")
    name = row.thumb_name if (thumb and row.thumb_name) else row.file_name
    try:
        path = media_store.file_path(name)
    except media_store.MediaError:
        raise HTTPException(status_code=404, detail="Файл не найден.")
    if not path.exists():
        # Строка есть, файла нет: его могли потерять при восстановлении из
        # старой копии. 404 честнее, чем пятисотая.
        raise HTTPException(status_code=404, detail="Файл не найден на диске.")
    return FileResponse(path, media_type=row.mime)


@router.delete("/products/{product_id}/media/{media_id}", status_code=204)
async def delete_media(
    product_id: int,
    media_id: int,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> None:
    row = (
        await session.execute(
            select(ProductMedia).where(
                ProductMedia.id == media_id, ProductMedia.product_id == product_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Файл не найден.")
    names = [row.file_name, row.thumb_name]
    await session.delete(row)
    await session.commit()
    # Файлы убираются ПОСЛЕ фиксации: обратный порядок оставил бы запись,
    # ссылающуюся в пустоту, если фиксация не прошла.
    for name in names:
        if name:
            media_store.remove(name)


class MediaOrderIn(BaseModel):
    order: list[int] = Field(max_length=6)


@router.put("/products/{product_id}/media/order", response_model=list[MediaOut])
async def reorder_media(
    product_id: int,
    payload: MediaOrderIn,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[MediaOut]:
    """Порядок фото. Первое — главное: оно и попадает на витрину кассы."""
    rows = (
        await session.execute(select(ProductMedia).where(ProductMedia.product_id == product_id))
    ).scalars().all()
    by_id = {row.id: row for row in rows}
    for order, media_id in enumerate(payload.order):
        row = by_id.get(media_id)
        if row is not None:
            row.sort_order = order
    await session.commit()
    fresh = (
        await session.execute(
            select(ProductMedia)
            .where(ProductMedia.product_id == product_id)
            .order_by(ProductMedia.sort_order, ProductMedia.id)
        )
    ).scalars().all()
    return [_media_out(row) for row in fresh]


# ── Старые маршруты товара (форма не менялась) ────────────────────────────────


@router.get("/products/{product_id}", response_model=ProductOut)
async def get_product(
    product_id: int,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> ProductOut:
    row = (
        await session.execute(
            select(Product, Category.name)
            .outerjoin(Category, Product.category_id == Category.id)
            .where(Product.id == product_id)
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Товар не найден.")
    p, cat_name = row
    return _product_out(p, cat_name)


@router.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
async def create_product(
    payload: ProductCreate,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> ProductOut:
    """Короткое создание товара. Этим маршрутом пользуется закупка.

    Полная карточка — `POST /api/products/card`. Здесь только то, что нужно,
    чтобы завести позицию, не уходя из накладной.
    """
    unit = payload.unit
    if payload.kind == "weight":
        unit = "кг"
    elif payload.kind == "service":
        unit = "усл"

    owner = await barcode_owner(session, payload.barcode)
    if owner is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Штрихкод уже у товара «{owner.name}».",
        )

    product = Product(
        name=payload.name.strip(),
        barcode=(payload.barcode or "").strip(),
        extra_barcodes=(payload.extra_barcodes or "").strip(),
        kind=payload.kind,
        unit=unit,
        price=payload.price,
        wholesale_price=payload.wholesale_price,
        cost_price=payload.cost_price,
        stock_qty=0 if payload.kind in ("service", "bundle") else payload.stock_qty,
        category_id=payload.category_id,
        image=payload.image,
    )
    session.add(product)
    await session.flush()
    if payload.kind not in ("service", "bundle") and payload.stock_qty != 0:
        session.add(
            StockMove(
                product_id=product.id,
                qty_delta=payload.stock_qty,
                reason="adjust",
                ref_type="initial",
                note="Начальный остаток",
                user_id=user.id,
            )
        )
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Товар с таким штрихкодом уже есть."
        )
    await session.refresh(product)
    return _product_out(product)


@router.patch("/products/{product_id}", response_model=ProductOut)
async def update_product(
    product_id: int,
    payload: ProductUpdate,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> ProductOut:
    product = (
        await session.execute(select(Product).where(Product.id == product_id))
    ).scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Товар не найден.")
    data = payload.model_dump(exclude_unset=True)
    new_stock = data.pop("stock_qty", None)
    if "barcode" in data:
        data["barcode"] = (data["barcode"] or "").strip()
        owner = await barcode_owner(session, data["barcode"], exclude_id=product.id)
        if owner is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Штрихкод уже у товара «{owner.name}».",
            )
    for key, value in data.items():
        setattr(product, key, value)
    if new_stock is not None and product.kind not in ("service", "bundle"):
        delta = float(new_stock) - float(product.stock_qty)
        if abs(delta) > 1e-9:
            product.stock_qty = float(new_stock)
            session.add(
                StockMove(
                    product_id=product.id,
                    qty_delta=delta,
                    reason="adjust",
                    ref_type="manual",
                    note="Корректировка остатка",
                    user_id=user.id,
                )
            )
    # Цена могла поменяться — комплекты с этим товаром пересчитываются.
    await recompute_bundle_prices(session, {product.id})
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Товар с таким штрихкодом уже есть."
        )
    await session.refresh(product)
    return _product_out(product)


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: int,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> None:
    """Пометить товар удалённым. Физически строка и файлы остаются.

    Товар стоит в чеках, в накладных и в движениях склада; удалить строку —
    значит оставить их без названия. Файлы убираются отдельной уборкой, а не
    здесь: удаление в интерфейсе должно быть мгновенным.
    """
    product = (
        await session.execute(select(Product).where(Product.id == product_id))
    ).scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Товар не найден.")
    product.is_active = False
    await session.commit()
