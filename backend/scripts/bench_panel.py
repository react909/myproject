"""Замер журнала панели на реальном объёме магазина.

Зачем отдельным скриптом: на пустой базе любой запрос отвечает мгновенно, и
проверить по ней нечего. Здесь генерируются двести тысяч чеков за два года —
столько накапливает средний магазин, — и каждый запрос панели меряется дважды:
без индексов и с ними.

Запуск (из каталога backend):

    .venv\\Scripts\\python.exe scripts\\bench_panel.py

База создаётся временная, рабочую скрипт не трогает.
"""

from __future__ import annotations

import asyncio
import random
import statistics
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.db.models import Base  # noqa: E402
from app.modules.panel.repository import (  # noqa: E402
    ReceiptFilters,
    fetch_cashiers,
    fetch_page,
    fetch_summary,
)

SALES = 200_000
ITEMS_PER_SALE = 3
DAYS = 730

CASHIERS = ["Айгуль", "Нурлан", "Мария", "Данияр", "Асель"]
STATUSES = ["paid"] * 88 + ["debt"] * 5 + ["canceled"] * 3 + ["refunded"] * 2 + ["partial_refund"] * 2
METHODS = ["cash"] * 55 + ["card"] * 35 + ["mixed"] * 5 + ["debt"] * 5
GOODS = [
    "Хлеб белый", "Молоко 2.5%", "Яблоки", "Картофель", "Сахар", "Масло подсолнечное",
    "Куриное филе", "Гречка", "Чай чёрный", "Кофе молотый", "Сыр Гауда", "Колбаса варёная",
    "Помидоры", "Огурцы", "Рис", "Макароны", "Печенье", "Вода питьевая",
]

# Индексы миграции 0029 — здесь повторены строками, чтобы мерить «до» и «после»
# в одном прогоне, не гоняя alembic туда-обратно.
INDEX_SQL = [
    "CREATE INDEX ix_sales_doc_number ON sales (doc_number)",
    "CREATE INDEX ix_sales_created_at_id ON sales (created_at, id)",
    "CREATE INDEX ix_sales_status_total ON sales (status, total)",
    "CREATE INDEX ix_sales_payment_method ON sales (payment_method)",
    "CREATE INDEX ix_sales_cashier_created ON sales (cashier_name, created_at)",
    "CREATE INDEX ix_sale_items_name_sale ON sale_items (name, sale_id)",
    "CREATE INDEX ix_sale_items_sale_kind ON sale_items (sale_id, is_weight)",
]


async def seed(engine) -> None:
    """Наливает объём напрямую в SQL.

    Через ORM это заняло бы десятки минут: двести тысяч объектов Sale плюс
    шестьсот тысяч SaleItem, каждый со своим identity-map. Здесь замер
    производительности запросов, а не вставки, поэтому наливаем пачками
    executemany.
    """
    random.seed(20260821)
    start = datetime(2024, 8, 21, 8, 0, 0)

    async with engine.begin() as conn:
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        await conn.execute(text("PRAGMA synchronous=OFF"))
        await conn.run_sync(Base.metadata.create_all)
        # Индексы, созданные метаданными, снимаем: первый прогон должен
        # мерить именно «без индексов».
        for name in ("ix_sales_doc_number", "ix_sales_created_at"):
            await conn.execute(text(f"DROP INDEX IF EXISTS {name}"))
        # Строки в users не заводим: внешние ключи в SQLite по умолчанию не
        # проверяются, а меряем мы запросы к чекам, а не целостность схемы.

    batch_sales: list[dict] = []
    batch_items: list[dict] = []
    sale_sql = text(
        "INSERT INTO sales (id, doc_number, status, payment_method, subtotal, discount_total,"
        " total, cash_received, card_amount, change_amount, debt_balance, client_name,"
        " client_phone, user_id, cashier_name, created_at, note, payment_provider,"
        " payment_provider_title, payment_ref, payment_confirmation)"
        " VALUES (:id, :doc, :st, :pm, :sub, 0, :total, :total, 0, 0, :debt, :client,"
        " '', 1, :cashier, :created, '', '', '', '', 'manual')"
    )
    item_sql = text(
        "INSERT INTO sale_items (id, sale_id, product_id, name, is_weight, is_service,"
        " quantity, unit_price, discount, line_total, cost_price)"
        " VALUES (:id, :sale, NULL, :name, :weight, 0, :qty, :price, 0, :total, 0)"
    )

    item_id = 0
    async with engine.begin() as conn:
        for sale_id in range(1, SALES + 1):
            moment = start + timedelta(seconds=random.randint(0, DAYS * 86_400))
            status = random.choice(STATUSES)
            total = round(random.uniform(80, 4200), 2)
            batch_sales.append(
                {
                    "id": sale_id,
                    "doc": sale_id,
                    "st": status,
                    "pm": random.choice(METHODS),
                    "sub": total,
                    "total": total,
                    "debt": total if status == "debt" else 0.0,
                    "client": f"Клиент {sale_id % 900}" if sale_id % 7 == 0 else "",
                    "cashier": random.choice(CASHIERS),
                    "created": moment.isoformat(sep=" "),
                }
            )
            for _ in range(ITEMS_PER_SALE):
                item_id += 1
                weight = random.random() < 0.35
                price = round(random.uniform(20, 900), 2)
                qty = round(random.uniform(0.1, 3.0), 3) if weight else float(random.randint(1, 4))
                batch_items.append(
                    {
                        "id": item_id,
                        "sale": sale_id,
                        "name": random.choice(GOODS),
                        "weight": 1 if weight else 0,
                        "qty": qty,
                        "price": price,
                        "total": round(price * qty, 2),
                    }
                )

            if len(batch_sales) >= 5_000:
                await conn.execute(sale_sql, batch_sales)
                await conn.execute(item_sql, batch_items)
                batch_sales.clear()
                batch_items.clear()

        if batch_sales:
            await conn.execute(sale_sql, batch_sales)
            await conn.execute(item_sql, batch_items)


CASES: dict[str, ReceiptFilters] = {
    "журнал за всё время": ReceiptFilters(),
    "за последние 7 дней": ReceiptFilters(date_from=datetime(2026, 8, 14)),
    "по кассиру за месяц": ReceiptFilters(cashier="Мария", date_from=datetime(2026, 7, 21)),
    "статус «возврат»": ReceiptFilters(status="refunded"),
    "оплата картой": ReceiptFilters(payment_method="card"),
    "поиск по номеру": ReceiptFilters(doc_number="154321"),
    "по товару": ReceiptFilters(product="Молоко"),
    # Так фильтр по товару используют на самом деле: почти всегда вместе с
    # периодом. «За всё время» — редкий случай, и он же самый дорогой.
    "по товару за месяц": ReceiptFilters(product="Молоко", date_from=datetime(2026, 7, 21)),
    "только весовые": ReceiptFilters(product_kind="weight"),
    "весовые за неделю": ReceiptFilters(product_kind="weight", date_from=datetime(2026, 8, 14)),
}


async def measure(session_factory, label: str) -> dict[str, float]:
    """Медиана из пяти прогонов на запрос — одиночный замер шумит."""
    results: dict[str, float] = {}
    async with session_factory() as session:
        for name, filters in CASES.items():
            for kind, run in (
                ("список", lambda f=filters: fetch_page(
                    session, f, limit=50, cursor=None, sort="created_at", direction="desc"
                )),
                ("показатели", lambda f=filters: fetch_summary(session, f)),
            ):
                samples = []
                for _ in range(5):
                    began = time.perf_counter()
                    await run()
                    samples.append((time.perf_counter() - began) * 1000)
                results[f"{name} · {kind}"] = statistics.median(samples)

        samples = []
        for _ in range(5):
            began = time.perf_counter()
            await fetch_cashiers(session)
            samples.append((time.perf_counter() - began) * 1000)
        results["список кассиров"] = statistics.median(samples)

    print(f"\n=== {label} ===")
    for name, value in results.items():
        print(f"  {name:<34} {value:8.1f} мс")
    return results


async def main() -> None:
    path = Path(tempfile.mkdtemp()) / "bench.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{path.as_posix()}")
    factory = async_sessionmaker(engine, expire_on_commit=False)

    began = time.perf_counter()
    await seed(engine)
    print(f"налито {SALES} чеков и {SALES * ITEMS_PER_SALE} позиций "
          f"за {time.perf_counter() - began:.1f} с, файл {path.stat().st_size / 1024 / 1024:.0f} МБ")

    before = await measure(factory, "БЕЗ ИНДЕКСОВ")

    async with engine.begin() as conn:
        began = time.perf_counter()
        for sql in INDEX_SQL:
            await conn.execute(text(sql))
        print(f"\nиндексы построены за {time.perf_counter() - began:.1f} с")
    async with engine.begin() as conn:
        await conn.execute(text("ANALYZE"))

    after = await measure(factory, "С ИНДЕКСАМИ (миграция 0029)")

    print(f"\n=== ИТОГ ===\n{'запрос':<34} {'до':>10} {'после':>10} {'выигрыш':>10}")
    for name in before:
        was, now = before[name], after[name]
        gain = f"×{was / now:.1f}" if now > 0.05 else "—"
        print(f"{name:<34} {was:8.1f} мс {now:8.1f} мс {gain:>10}")

    print(f"\nфайл базы после индексов: {path.stat().st_size / 1024 / 1024:.0f} МБ")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
