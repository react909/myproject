"""Замер каталога на объёме крупного магазина.

Поиск товара — самый частый запрос в системе: он идёт с кассы, из закупки, из
состава комплекта и с этой страницы. Мерить его на пустой базе бессмысленно.

Здесь наливается 20 000 товаров и 50 000 записей о файлах, и меряется:

  * поиск по названию — строчными и прописными (кириллица!);
  * поиск по штрихкоду — точным совпадением;
  * открытие списка и его вторая страница;
  * карточка товара с составом комплекта.

ОТДЕЛЬНО МЕРЯЕТСЯ ЦЕНА ПОДМЕНЫ `lower`. Встроенный `lower` в SQLite не знает
кириллицы, поэтому приложение подменяет его питоновским (db/database.py). Это
вызов Python на строку, и надо знать, во что он обходится. Прогон идёт трижды:
без индексов, с индексами, и с индексами но со встроенным `lower` — последний
показывает цену правильного поиска.

Запуск (из каталога backend):

    .venv\\Scripts\\python.exe scripts\\bench_products.py
"""

from __future__ import annotations

import asyncio
import random
import statistics
import sys
import tempfile
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from sqlalchemy import event, func, or_, select, text  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.db.models import Base, Product, ProductMedia  # noqa: E402

PRODUCTS = 20_000
MEDIA = 50_000

WORDS_A = ["Молоко", "Хлеб", "Сыр", "Колбаса", "Печенье", "Сок", "Вода", "Чай", "Кофе", "Крупа"]
WORDS_B = ["Умут", "Ак-Сут", "Шоро", "Дордой", "Бишкек", "Ош", "Талас", "Нарын"]
WORDS_C = ["классический", "домашний", "фермерский", "детский", "лёгкий", "premium"]

# Индексы миграции 0031 — повторены строками, чтобы мерить «до» и «после» в
# одном прогоне, не гоняя alembic туда-обратно.
INDEX_SQL = [
    # Обычный индекс по штрихкоду был и остаётся: частичный уникальный
    # (ниже) планировщик для точного поиска не берёт — условие `barcode = ?`
    # не подразумевает его предиката `barcode != ''`.
    "CREATE INDEX ix_products_barcode ON products (barcode)",
    "CREATE INDEX ix_products_name ON products (name)",
    "CREATE INDEX ix_products_kind_name ON products (kind, name)",
    "CREATE INDEX ix_products_supplier_id ON products (supplier_id)",
    "CREATE INDEX ix_products_expires_at ON products (expires_at)",
    "CREATE UNIQUE INDEX ux_products_barcode_not_empty ON products (barcode) WHERE barcode != ''",
    "CREATE INDEX ix_product_media_product_sort ON product_media (product_id, sort_order)",
]

# Индексы, которые создают сами метаданные (они объявлены на колонках моделей).
# Снимаем их для прогона «без индексов»: иначе «до» мерилось бы уже с частью
# нужных индексов, и выигрыш выглядел бы меньше, чем он есть.
DROP_FIRST = [
    "ix_products_name",
    "ix_products_barcode",
    "ix_products_supplier_id",
    "ix_product_media_product_id",
    "ix_product_bundle_items_bundle_id",
    "ix_product_bundle_items_item_id",
]


def unicode_lower(value):
    return value.lower() if isinstance(value, str) else value


def attach_unicode_lower(engine) -> None:
    """Та же подмена, что делает приложение (db/database.py)."""

    @event.listens_for(engine.sync_engine, "connect")
    def _on_connect(dbapi_connection, _record):  # type: ignore[no-untyped-def]
        dbapi_connection.create_function("lower", 1, unicode_lower, deterministic=True)


async def seed(engine) -> None:
    random.seed(20260823)
    async with engine.begin() as conn:
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        await conn.execute(text("PRAGMA synchronous=OFF"))
        await conn.run_sync(Base.metadata.create_all)
        for name in DROP_FIRST:
            await conn.execute(text(f"DROP INDEX IF EXISTS {name}"))

    rows = []
    for index in range(1, PRODUCTS + 1):
        # Названия с заглавной буквы — так их и заводят в жизни. Именно из-за
        # этого поиск строчными и не работал до подмены `lower`.
        name = (
            f"{random.choice(WORDS_A)} {random.choice(WORDS_B)} "
            f"{random.choice(WORDS_C)} {index}"
        )
        rows.append(
            {
                "id": index,
                "name": name,
                "bc": f"46{index:011d}",
                "kind": random.choice(["piece"] * 8 + ["weight", "service"]),
                "price": round(random.uniform(20, 2500), 2),
                "cost": round(random.uniform(10, 2000), 2),
                "stock": random.randint(0, 500),
                "min_stock": random.choice([0, 0, 0, 5, 10]),
            }
        )

    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO products (id, name, barcode, extra_barcodes, kind, unit, price,"
                " wholesale_price, cost_price, stock_qty, image, is_active, min_stock, brand,"
                " country, description, wholesale_from_qty, bundle_price_mode, client_token)"
                " VALUES (:id, :name, :bc, '', :kind, 'шт', :price, 0, :cost, :stock, '', 1,"
                " :min_stock, '', '', '', 0, 'own', '')"
            ),
            rows,
        )
        await conn.execute(
            text(
                "INSERT INTO product_media (product_id, kind, sort_order, file_name, thumb_name,"
                " mime, bytes_size, width, height, duration_ms, created_at)"
                " VALUES (:p, 'photo', :o, :f, :t, 'image/jpeg', 180000, 1200, 900, 0,"
                " CURRENT_TIMESTAMP)"
            ),
            [
                {
                    "p": random.randint(1, PRODUCTS),
                    "o": index % 5,
                    "f": f"{index:032x}.jpg",
                    "t": f"{index:032x}_t.jpg",
                }
                for index in range(MEDIA)
            ],
        )


def like_search(term: str):
    like = f"%{term}%"
    return (
        select(Product)
        .where(
            Product.is_active.is_(True),
            or_(
                Product.name.ilike(like),
                Product.barcode.ilike(like),
                Product.extra_barcodes.ilike(like),
            ),
        )
        .order_by(Product.id)
        .limit(50)
    )


CASES = {
    "поиск «молоко» (строчными)": lambda: like_search("молоко"),
    "поиск «Молоко» (как в базе)": lambda: like_search("Молоко"),
    "поиск «шоро» (строчными)": lambda: like_search("шоро"),
    "поиск по штрихкоду точно": lambda: select(Product).where(Product.barcode == "46000000012345"),
    "список: первая страница": lambda: select(Product)
    .where(Product.is_active.is_(True))
    .order_by(Product.id)
    .limit(50),
    "список: страница на 15 000": lambda: select(Product)
    .where(Product.is_active.is_(True), Product.id > 15_000)
    .order_by(Product.id)
    .limit(50),
    "что заканчивается": lambda: select(Product)
    .where(Product.min_stock > 0, Product.stock_qty <= Product.min_stock)
    .order_by(Product.id)
    .limit(50),
    "счётчик всего": lambda: select(func.count(Product.id)).where(Product.is_active.is_(True)),
    "фото товара": lambda: select(ProductMedia)
    .where(ProductMedia.product_id == 777)
    .order_by(ProductMedia.sort_order),
}


async def measure(factory, label: str) -> dict[str, float]:
    results: dict[str, float] = {}
    async with factory() as session:
        for name, build in CASES.items():
            samples = []
            for _ in range(5):
                began = time.perf_counter()
                await session.execute(build())
                samples.append((time.perf_counter() - began) * 1000)
            results[name] = statistics.median(samples)
    print(f"\n=== {label} ===")
    for name, value in results.items():
        print(f"  {name:<32} {value:8.1f} мс")
    return results


async def count_found(factory, term: str) -> int:
    async with factory() as session:
        rows = (await session.execute(like_search(term))).scalars().all()
        return len(rows)


async def main() -> None:
    path = Path(tempfile.mkdtemp()) / "bench-products.db"
    dsn = f"sqlite+aiosqlite:///{path.as_posix()}"

    # ── Прогон 1: без индексов, со ВСТРОЕННЫМ lower ──
    plain = create_async_engine(dsn)
    plain_factory = async_sessionmaker(plain, expire_on_commit=False)

    began = time.perf_counter()
    await seed(plain)
    print(
        f"налито {PRODUCTS} товаров и {MEDIA} записей о файлах за "
        f"{time.perf_counter() - began:.1f} с; файл {path.stat().st_size / 1024 / 1024:.0f} МБ"
    )

    print(f"\nвстроенный lower находит «молоко»: {await count_found(plain_factory, 'молоко')} строк")
    print(f"встроенный lower находит «Молоко»: {await count_found(plain_factory, 'Молоко')} строк")

    before = await measure(plain_factory, "БЕЗ ИНДЕКСОВ, встроенный lower")
    builtin_no_index = before

    async with plain.begin() as conn:
        began = time.perf_counter()
        for sql in INDEX_SQL:
            await conn.execute(text(sql))
        print(f"\nиндексы построены за {time.perf_counter() - began:.1f} с")
    async with plain.begin() as conn:
        await conn.execute(text("ANALYZE"))

    builtin_indexed = await measure(plain_factory, "С ИНДЕКСАМИ, встроенный lower (ищет мимо)")
    await plain.dispose()

    # ── Прогон 2: те же индексы, но lower ПОДМЕНЁН — как в приложении ──
    smart = create_async_engine(dsn)
    attach_unicode_lower(smart)
    smart_factory = async_sessionmaker(smart, expire_on_commit=False)

    print(f"\nподменённый lower находит «молоко»: {await count_found(smart_factory, 'молоко')} строк")
    after = await measure(smart_factory, "С ИНДЕКСАМИ, подменённый lower (как в приложении)")

    print(f"\n=== ИТОГ ===\n{'запрос':<32} {'без индексов':>14} {'с индексами':>13} {'+ свой lower':>14}")
    for name in builtin_no_index:
        print(
            f"{name:<32} {builtin_no_index[name]:11.1f} мс {builtin_indexed[name]:10.1f} мс "
            f"{after[name]:11.1f} мс"
        )

    print(f"\nфайл базы: {path.stat().st_size / 1024 / 1024:.0f} МБ")
    await smart.dispose()


if __name__ == "__main__":
    asyncio.run(main())
