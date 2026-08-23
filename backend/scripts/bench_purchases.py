"""Замер смен, закупок и поставщиков на объёме, который набирает магазин.

На пустой базе любой из этих запросов отвечает мгновенно, и проверять по ней
нечего. Здесь наливается:

    5 000 документов закупки, 50 000 строк, 500 смен, 300 поставщиков,
    120 000 чеков по сменам, 2 000 движений по ящику.

Каждый запрос меряется дважды: без индексов миграции 0030 и с ними.

Запуск (из каталога backend):

    .venv\\Scripts\\python.exe scripts\\bench_purchases.py

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

from sqlalchemy import select, text  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.db.models import Base, PurchaseDoc, Shift  # noqa: E402
from app.modules.purchases.service import (  # noqa: E402
    sold_after_posting,
    supplier_balance,
)
from app.modules.shifts.service import fetch_metrics  # noqa: E402

DOCS = 5_000
LINES_PER_DOC = 10
SHIFTS = 500
SUPPLIERS = 300
PRODUCTS = 3_000
SALES = 120_000
MOVEMENTS = 2_000
DAYS = 730

# Индексы миграции 0030 — повторены строками, чтобы мерить «до» и «после» в
# одном прогоне, не гоняя alembic туда-обратно.
INDEX_SQL = [
    "CREATE INDEX ix_sales_shift_status ON sales (shift_id, status)",
    "CREATE INDEX ix_sale_items_product_sale ON sale_items (product_id, sale_id)",
    "CREATE INDEX ix_shifts_status ON shifts (status)",
    "CREATE INDEX ix_shifts_opened_at_id ON shifts (opened_at, id)",
    "CREATE INDEX ix_shifts_user_opened ON shifts (user_id, opened_at)",
    "CREATE INDEX ix_cash_movements_shift_created ON cash_movements (shift_id, created_at)",
    "CREATE INDEX ix_purchase_docs_date_id ON purchase_docs (doc_date, id)",
    "CREATE INDEX ix_purchase_docs_status_date ON purchase_docs (status, doc_date)",
    "CREATE INDEX ix_purchase_docs_supplier_status ON purchase_docs (supplier_id, status)",
    "CREATE INDEX ix_purchase_lines_doc_sort ON purchase_lines (doc_id, sort_order)",
    "CREATE INDEX ix_purchase_lines_product_doc ON purchase_lines (product_id, doc_id)",
    "CREATE INDEX ix_supplier_payments_supplier_paid ON supplier_payments (supplier_id, paid_at)",
]

# Индексы, которые метаданные создают сами (они объявлены на колонках моделей).
# Снимаем их для прогона «без индексов»: иначе «до» мерилось бы уже с половиной
# нужных индексов и выигрыш выглядел бы меньше, чем он есть.
DROP_FIRST = [
    "ix_purchase_docs_supplier_id",
    "ix_purchase_docs_doc_date",
    "ix_purchase_docs_status",
    "ix_purchase_docs_number",
    "ix_purchase_lines_doc_id",
    "ix_purchase_lines_product_id",
    "ix_supplier_payments_supplier_id",
    "ix_supplier_payments_paid_at",
    "ix_cash_movements_shift_id",
    "ix_cash_movements_created_at",
    "ix_shifts_number",
    "ix_suppliers_name",
    "ix_suppliers_phone",
    "ix_sale_items_sale_id",
]

GOODS = [
    "Хлеб белый", "Молоко 2.5%", "Яблоки", "Картофель", "Сахар", "Масло подсолнечное",
    "Куриное филе", "Гречка", "Чай чёрный", "Кофе молотый", "Сыр Гауда", "Колбаса варёная",
]
CASHIERS = ["Айгуль", "Нурлан", "Мария", "Данияр", "Асель"]


async def seed(engine) -> None:
    """Наливает объём напрямую в SQL: меряем запросы, а не скорость вставки."""
    random.seed(20260823)
    start = datetime(2024, 8, 23, 8, 0, 0)

    async with engine.begin() as conn:
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        await conn.execute(text("PRAGMA synchronous=OFF"))
        await conn.run_sync(Base.metadata.create_all)
        for name in DROP_FIRST:
            await conn.execute(text(f"DROP INDEX IF EXISTS {name}"))

    async with engine.begin() as conn:
        await conn.execute(
            text("INSERT INTO users (id, username, full_name, hashed_password, role, is_active, "
                 "pin_hash, permissions, created_at) "
                 "VALUES (1, 'bench', 'Бенчмарк', 'x', 'owner', 1, '', '', CURRENT_TIMESTAMP)")
        )
        await conn.execute(
            text("INSERT INTO suppliers (id, name, phone, contact_person, address, comment, is_active) "
                 "VALUES (:id, :name, :phone, '', '', '', 1)"),
            [
                {"id": i, "name": f"Поставщик {i:03d}", "phone": f"+9967{i:08d}"}
                for i in range(1, SUPPLIERS + 1)
            ],
        )
        await conn.execute(
            text("INSERT INTO products (id, name, barcode, extra_barcodes, kind, unit, price, "
                 "wholesale_price, cost_price, stock_qty, image, is_active) "
                 "VALUES (:id, :name, :bc, '', 'piece', 'шт', :price, 0, :cost, :stock, '', 1)"),
            [
                {
                    "id": i,
                    "name": f"{random.choice(GOODS)} {i}",
                    "bc": f"200{i:09d}",
                    "price": round(random.uniform(30, 900), 2),
                    "cost": round(random.uniform(20, 700), 2),
                    "stock": random.randint(0, 400),
                }
                for i in range(1, PRODUCTS + 1)
            ],
        )

        # Смены.
        shifts = []
        for i in range(1, SHIFTS + 1):
            opened = start + timedelta(days=i * DAYS // SHIFTS, hours=8)
            shifts.append(
                {
                    "id": i,
                    "num": i,
                    "opened": opened.isoformat(sep=" "),
                    "closed": (opened + timedelta(hours=12)).isoformat(sep=" ") if i < SHIFTS else None,
                    "status": "open" if i == SHIFTS else "closed",
                    "open_t": random.randint(10_000, 100_000),
                    "name": random.choice(CASHIERS),
                }
            )
        await conn.execute(
            text("INSERT INTO shifts (id, number, opened_at, closed_at, status, open_cash, close_cash, "
                 "sales_count, sales_total, user_id, cashbox_name, open_cash_tiyin, counted_cash_tiyin, "
                 "expected_cash_tiyin, variance_tiyin, variance_reason, opened_by_name, closed_by_name, "
                 "revenue_tiyin, cash_tiyin, cashless_tiyin, refunds_tiyin) "
                 "VALUES (:id, :num, :opened, :closed, :status, 0, 0, 0, 0, 1, 'Основная', :open_t, 0, 0, 0, "
                 "'', :name, '', 0, 0, 0, 0)"),
            shifts,
        )

        # Чеки, разложенные по сменам, и позиции к ним.
        #
        # Позиции нужны не для украшения: по ним идёт вопрос «что из документа
        # успели продать», и на пустой таблице он мерил бы пустоту.
        sales = []
        items = []
        item_id = 0
        for sale_id in range(1, SALES + 1):
            shift_id = random.randint(1, SHIFTS)
            total = round(random.uniform(80, 4200), 2)
            method = random.choice(["cash"] * 6 + ["card"] * 3 + ["debt"])
            sales.append(
                {
                    "id": sale_id,
                    "doc": sale_id,
                    "st": random.choice(["paid"] * 95 + ["refunded", "partial_refund", "debt"] + ["canceled", "paid"]),
                    "pm": method,
                    "total": total,
                    "cash": total if method == "cash" else 0.0,
                    "card": total if method == "card" else 0.0,
                    "shift": shift_id,
                    "created": (start + timedelta(seconds=random.randint(0, DAYS * 86_400))).isoformat(sep=" "),
                    "cashier": random.choice(CASHIERS),
                }
            )
            for _ in range(2):
                item_id += 1
                items.append(
                    {
                        "id": item_id,
                        "sale": sale_id,
                        "product": random.randint(1, PRODUCTS),
                        "name": random.choice(GOODS),
                        "qty": float(random.randint(1, 4)),
                        "price": round(total / 2, 2),
                    }
                )
            if len(sales) >= 20_000:
                await conn.execute(_sale_sql(), sales)
                await conn.execute(_item_sql(), items)
                sales.clear()
                items.clear()
        if sales:
            await conn.execute(_sale_sql(), sales)
            await conn.execute(_item_sql(), items)

        # Снимок показателей закрытых смен — тем же запросом, что и миграция.
        # Без него замер истории мерил бы чтение нулей, а не жизнь.
        await conn.execute(
            text(
                """
                UPDATE shifts SET
                  revenue_tiyin = COALESCE((
                    SELECT SUM(CAST(ROUND(s.total * 100) AS INTEGER)) FROM sales s
                    WHERE s.shift_id = shifts.id AND s.status IN ('paid', 'debt')), 0),
                  cash_tiyin = COALESCE((
                    SELECT SUM(CAST(ROUND((s.cash_received - s.change_amount) * 100) AS INTEGER))
                    FROM sales s WHERE s.shift_id = shifts.id AND s.status != 'canceled'), 0),
                  cashless_tiyin = COALESCE((
                    SELECT SUM(CAST(ROUND(s.card_amount * 100) AS INTEGER)) FROM sales s
                    WHERE s.shift_id = shifts.id), 0),
                  refunds_tiyin = COALESCE((
                    SELECT SUM(CAST(ROUND(
                      MAX(s.subtotal - s.discount_total - s.total, 0) * 100) AS INTEGER))
                    FROM sales s WHERE s.shift_id = shifts.id
                      AND s.status IN ('refunded', 'partial_refund')), 0)
                WHERE status = 'closed'
                """
            )
        )

        # Движения по ящику.
        await conn.execute(
            text("INSERT INTO cash_movements (shift_id, kind, amount_tiyin, reason, comment, actor_name, "
                 "ref_type, ref_id, user_id, created_at) "
                 "VALUES (:shift, :kind, :amount, 'Замер', '', '', 'manual', '', 1, :created)"),
            [
                {
                    "shift": random.randint(1, SHIFTS),
                    "kind": random.choice(["deposit", "withdrawal"]),
                    "amount": random.choice([1, -1]) * random.randint(1_000, 90_000),
                    "created": (start + timedelta(seconds=random.randint(0, DAYS * 86_400))).isoformat(sep=" "),
                }
                for _ in range(MOVEMENTS)
            ],
        )

        # Документы закупки и строки.
        docs = []
        lines = []
        line_id = 0
        for doc_id in range(1, DOCS + 1):
            supplier = random.randint(1, SUPPLIERS)
            moment = start + timedelta(seconds=random.randint(0, DAYS * 86_400))
            status = random.choice(["posted"] * 8 + ["draft", "canceled"])
            settlement = random.choice(["paid"] * 6 + ["credit"] * 4)
            total = 0
            for order in range(LINES_PER_DOC):
                line_id += 1
                cost = random.randint(2_000, 70_000)
                qty = random.randint(1, 60)
                total += cost * qty
                lines.append(
                    {
                        "id": line_id,
                        "doc": doc_id,
                        "product": random.randint(1, PRODUCTS),
                        "name": random.choice(GOODS),
                        "qty": qty,
                        "cost": cost,
                        "line_total": cost * qty,
                        "retail": int(cost * 1.35),
                        "order": order,
                    }
                )
            docs.append(
                {
                    "id": doc_id,
                    "num": doc_id,
                    "supplier": supplier,
                    "date": moment.isoformat(sep=" "),
                    "status": status,
                    "settlement": settlement,
                    "total": total,
                    "due": (moment + timedelta(days=14)).isoformat(sep=" "),
                    "posted": moment.isoformat(sep=" ") if status == "posted" else None,
                }
            )
        await conn.execute(_doc_sql(), docs)
        for chunk in range(0, len(lines), 20_000):
            await conn.execute(_line_sql(), lines[chunk : chunk + 20_000])

        # Оплаты поставщикам.
        await conn.execute(
            text("INSERT INTO supplier_payments (supplier_id, amount_tiyin, paid_at, method, comment, "
                 "user_id, created_at) VALUES (:s, :a, :d, 'cash', '', 1, :d)"),
            [
                {
                    "s": random.randint(1, SUPPLIERS),
                    "a": random.randint(10_000, 900_000),
                    "d": (start + timedelta(seconds=random.randint(0, DAYS * 86_400))).isoformat(sep=" "),
                }
                for _ in range(3_000)
            ],
        )


def _sale_sql():
    return text(
        "INSERT INTO sales (id, doc_number, status, payment_method, subtotal, discount_total, total,"
        " cash_received, card_amount, change_amount, debt_balance, client_name, client_phone,"
        " shift_id, user_id, cashier_name, created_at, note, payment_provider,"
        " payment_provider_title, payment_ref, payment_confirmation)"
        " VALUES (:id, :doc, :st, :pm, :total, 0, :total, :cash, :card, 0, 0, '', '',"
        " :shift, 1, :cashier, :created, '', '', '', '', 'manual')"
    )


def _item_sql():
    return text(
        "INSERT INTO sale_items (id, sale_id, product_id, name, is_weight, is_service,"
        " quantity, unit_price, discount, line_total, cost_price)"
        " VALUES (:id, :sale, :product, :name, 0, 0, :qty, :price, 0, :price, 0)"
    )


def _doc_sql():
    return text(
        "INSERT INTO purchase_docs (id, number, kind, supplier_id, doc_date, invoice_number, comment,"
        " settlement, due_date, status, total_tiyin, positions_count, total_qty, posted_at,"
        " posted_by_user_id, source_doc_id, user_id, created_at, updated_at)"
        " VALUES (:id, :num, 'purchase', :supplier, :date, '', '', :settlement, :due, :status,"
        " :total, 10, 100, :posted, 1, NULL, 1, :date, :date)"
    )


def _line_sql():
    return text(
        "INSERT INTO purchase_lines (id, doc_id, product_id, name, barcode, unit, qty, cost_tiyin,"
        " line_total_tiyin, retail_tiyin, sort_order, before_qty, before_cost_tiyin, before_retail_tiyin)"
        " VALUES (:id, :doc, :product, :name, '', 'шт', :qty, :cost, :line_total, :retail, :order, 0, 0, 0)"
    )


async def measure(engine, factory, label: str) -> dict[str, float]:
    """Медиана из пяти прогонов на запрос — одиночный замер шумит."""
    from app.modules.purchases.router import list_docs, summary
    from app.modules.shifts.router import _movement_totals, shift_history
    from app.modules.suppliers.router import list_suppliers, supplier_products

    results: dict[str, float] = {}

    async def timed(name: str, run) -> None:
        samples = []
        for _ in range(5):
            began = time.perf_counter()
            await run()
            samples.append((time.perf_counter() - began) * 1000)
        results[name] = statistics.median(samples)

    # Обработчики зовутся напрямую, поэтому ВСЕ параметры передаются явно: по
    # умолчанию у них стоят объекты `Query(...)`, которые подставляет FastAPI,
    # а без него они дошли бы до кода как есть и упали бы на `KeyError`.
    def docs(**over):
        params = dict(
            date_from=None, date_to=None, supplier_id=None, doc_status="", kind="",
            sort="doc_date", direction="desc", limit=50, cursor=None,
        )
        params.update(over)
        return params

    async with factory() as session:
        none_user = None
        await timed(
            "список закупок · страница",
            lambda: list_docs(**docs(), session=session, _=none_user),
        )
        await timed(
            "список закупок · за месяц",
            lambda: list_docs(**docs(date_from="2026-07-23"), session=session, _=none_user),
        )
        await timed(
            "список закупок · по поставщику",
            lambda: list_docs(**docs(supplier_id=42), session=session, _=none_user),
        )
        await timed(
            "список закупок · черновики",
            lambda: list_docs(**docs(doc_status="draft"), session=session, _=none_user),
        )
        await timed(
            "итоги закупок",
            lambda: summary(
                date_from=None, date_to=None, supplier_id=None, doc_status="", kind="",
                session=session, _=none_user,
            ),
        )
        await timed(
            "итоги закупок · за месяц",
            lambda: summary(
                date_from="2026-07-23", date_to=None, supplier_id=None, doc_status="", kind="",
                session=session, _=none_user,
            ),
        )
        await timed(
            "поставщики · список с долгами",
            lambda: list_suppliers(
                q="", include_inactive=False, sort="name", direction="asc",
                limit=100, cursor=None, session=session, _=none_user,
            ),
        )
        await timed(
            "поставщики · сортировка по долгу",
            lambda: list_suppliers(
                q="", include_inactive=False, sort="debt", direction="desc",
                limit=100, cursor=None, session=session, _=none_user,
            ),
        )
        await timed("поставщик · сальдо", lambda: supplier_balance(session, 42))
        await timed(
            "поставщик · товары",
            lambda: supplier_products(42, limit=200, session=session, _=none_user),
        )
        await timed("показатели смены", lambda: fetch_metrics(session, 250))
        await timed("движения смены", lambda: _movement_totals(session, 250))
        await timed(
            "история смен · страница",
            lambda: shift_history(
                date_from=None, date_to=None, cashier="", limit=50, cursor=None,
                session=session, _=none_user,
            ),
        )
        await timed(
            "история смен · по кассиру",
            lambda: shift_history(
                date_from=None, date_to=None, cashier="Мария", limit=50, cursor=None,
                session=session, _=none_user,
            ),
        )
        # Именно ПРОВЕДЁННЫЙ документ, и постарше: у черновика `posted_at`
        # пуст, и функция вышла бы сразу — замер показал бы ноль и ничего не
        # проверил. Самый старый проведённый — самый дорогой случай: после
        # него продано больше всего.
        doc = (
            await session.execute(
                select(PurchaseDoc)
                .where(PurchaseDoc.status == "posted")
                .order_by(PurchaseDoc.doc_date.asc())
                .limit(1)
            )
        ).scalar_one()
        await timed("что продано после прихода", lambda: sold_after_posting(session, doc))

    print(f"\n=== {label} ===")
    for name, value in results.items():
        print(f"  {name:<34} {value:8.1f} мс")
    return results


async def main() -> None:
    path = Path(tempfile.mkdtemp()) / "bench-purchases.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{path.as_posix()}")
    factory = async_sessionmaker(engine, expire_on_commit=False)

    began = time.perf_counter()
    await seed(engine)
    print(
        f"налито {DOCS} документов, {DOCS * LINES_PER_DOC} строк, {SHIFTS} смен, "
        f"{SALES} чеков, {SUPPLIERS} поставщиков за {time.perf_counter() - began:.1f} с; "
        f"файл {path.stat().st_size / 1024 / 1024:.0f} МБ"
    )

    before = await measure(engine, factory, "БЕЗ ИНДЕКСОВ")

    async with engine.begin() as conn:
        began = time.perf_counter()
        for sql in INDEX_SQL:
            await conn.execute(text(sql))
        print(f"\nиндексы построены за {time.perf_counter() - began:.1f} с")
    async with engine.begin() as conn:
        await conn.execute(text("ANALYZE"))

    after = await measure(engine, factory, "С ИНДЕКСАМИ (миграция 0030)")

    print(f"\n=== ИТОГ ===\n{'запрос':<34} {'до':>10} {'после':>10} {'выигрыш':>10}")
    for name in before:
        was, now = before[name], after[name]
        gain = f"×{was / now:.1f}" if now > 0.05 else "—"
        print(f"{name:<34} {was:8.1f} мс {now:8.1f} мс {gain:>10}")

    print(f"\nфайл базы после индексов: {path.stat().st_size / 1024 / 1024:.0f} МБ")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
