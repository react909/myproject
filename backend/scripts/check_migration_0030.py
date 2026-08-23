"""Проверка миграции 0030 на БАЗЕ С ДАННЫМИ, а не на пустой.

На пустой базе любая миграция проходит. Смысл проверки в другом: база клиента
уже работает, в ней есть смены, чеки и товары, и обновление обязано их
сохранить, а новые колонки — заполнить осмысленно, а не нулями.

Что делает скрипт:

1. Создаёт временную базу и накатывает её ДО 0029 — то есть до состояния,
   в котором сейчас стоят установки у клиентов.
2. Наливает данные: пользователей, товары, смены (с разменом в сомах, как
   умела старая схема) и чеки, привязанные к сменам.
3. Снимает слепок: сколько строк в каждой таблице и контрольные суммы.
4. Накатывает 0030.
5. Сверяет слепок и проверяет заполнение новых колонок.

Запуск (из каталога backend):

    .venv\\Scripts\\python.exe scripts\\check_migration_0030.py
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

SHIFTS = 12
SALES_PER_SHIFT = 40


def alembic_config(dsn: str) -> Config:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.attributes["target_dsn"] = dsn
    return cfg


def seed(engine) -> None:
    """Данные в форме, которую умела схема 0029: деньги в сомах, float."""
    start = datetime(2026, 1, 10, 8, 0, 0)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, username, full_name, hashed_password, role, is_active,"
                " pin_hash, permissions, created_at)"
                " VALUES (1, 'kassir@shop.kg', 'Айгуль Сатыбалдиева', 'x', 'owner', 1, '', '',"
                " CURRENT_TIMESTAMP),"
                " (2, 'nurlan@shop.kg', '', 'x', 'cashier', 1, '', '', CURRENT_TIMESTAMP)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO products (id, name, barcode, extra_barcodes, kind, unit, price,"
                " wholesale_price, cost_price, stock_qty, image, is_active)"
                " VALUES (:id, :name, '', '', 'piece', 'шт', :price, 0, :cost, :stock, '', 1)"
            ),
            [
                {"id": i, "name": f"Товар {i}", "price": 100.0 + i, "cost": 60.0 + i, "stock": 50}
                for i in range(1, 21)
            ],
        )
        conn.execute(
            text(
                "INSERT INTO shifts (id, opened_at, closed_at, open_cash, close_cash,"
                " sales_count, sales_total, user_id, status, cashbox_name)"
                " VALUES (:id, :opened, :closed, :open_cash, :close_cash, 0, 0, :user, :status,"
                " 'Основная')"
            ),
            [
                {
                    "id": i,
                    "opened": (start + timedelta(days=i)).isoformat(sep=" "),
                    "closed": (start + timedelta(days=i, hours=12)).isoformat(sep=" ")
                    if i < SHIFTS
                    else None,
                    # Разные разменные суммы, включая дробную: проверяем перевод в тыйыны.
                    "open_cash": 500.0 if i % 2 else 1234.56,
                    "close_cash": 5000.0 + i if i < SHIFTS else 0.0,
                    "user": 1 if i % 2 else 2,
                    "status": "closed" if i < SHIFTS else "open",
                }
                for i in range(1, SHIFTS + 1)
            ],
        )
        rows = []
        sale_id = 0
        for shift in range(1, SHIFTS + 1):
            for _ in range(SALES_PER_SHIFT):
                sale_id += 1
                total = 100.0 + (sale_id % 900)
                rows.append(
                    {
                        "id": sale_id,
                        "doc": sale_id,
                        "st": "paid" if sale_id % 10 else "refunded",
                        "pm": "cash" if sale_id % 3 else "card",
                        "total": total,
                        "cash": total if sale_id % 3 else 0.0,
                        "card": 0.0 if sale_id % 3 else total,
                        "shift": shift,
                        "created": (start + timedelta(days=shift, hours=9)).isoformat(sep=" "),
                    }
                )
        conn.execute(
            text(
                "INSERT INTO sales (id, doc_number, status, payment_method, subtotal,"
                " discount_total, total, cash_received, card_amount, change_amount, debt_balance,"
                " client_name, client_phone, shift_id, user_id, cashier_name, created_at, note,"
                " payment_provider, payment_provider_title, payment_ref, payment_confirmation)"
                " VALUES (:id, :doc, :st, :pm, :total, 0, :total, :cash, :card, 0, 0, '', '',"
                " :shift, 1, 'Айгуль', :created, '', '', '', '', 'manual')"
            ),
            rows,
        )
        # Один чек БЕЗ смены — такие есть у всех, кто работал до появления смен.
        conn.execute(
            text(
                "INSERT INTO sales (id, doc_number, status, payment_method, subtotal,"
                " discount_total, total, cash_received, card_amount, change_amount, debt_balance,"
                " client_name, client_phone, shift_id, user_id, cashier_name, created_at, note,"
                " payment_provider, payment_provider_title, payment_ref, payment_confirmation)"
                " VALUES (999999, 999999, 'paid', 'cash', 250, 0, 250, 250, 0, 0, 0, '', '',"
                " NULL, 1, 'Айгуль', '2025-12-01 10:00:00', '', '', '', '', 'manual')"
            )
        )


def snapshot(engine) -> dict:
    with engine.connect() as conn:
        return {
            "users": conn.execute(text("SELECT COUNT(*) FROM users")).scalar_one(),
            "products": conn.execute(text("SELECT COUNT(*) FROM products")).scalar_one(),
            "shifts": conn.execute(text("SELECT COUNT(*) FROM shifts")).scalar_one(),
            "sales": conn.execute(text("SELECT COUNT(*) FROM sales")).scalar_one(),
            "sales_total": round(
                conn.execute(text("SELECT COALESCE(SUM(total), 0) FROM sales")).scalar_one(), 2
            ),
            "open_cash": round(
                conn.execute(text("SELECT COALESCE(SUM(open_cash), 0) FROM shifts")).scalar_one(), 2
            ),
            "sales_without_shift": conn.execute(
                text("SELECT COUNT(*) FROM sales WHERE shift_id IS NULL")
            ).scalar_one(),
        }


def main() -> None:
    workdir = Path(tempfile.mkdtemp())
    path = workdir / "existing.db"
    dsn = f"sqlite:///{path.as_posix()}"

    print("1. База в состоянии 0029 (как у клиента сейчас)")
    command.upgrade(alembic_config(dsn), "0029")

    engine = create_engine(dsn)
    print("2. Наливаем данные")
    seed(engine)
    before = snapshot(engine)
    print(f"   {before}")

    # Копия «до» — чтобы можно было посмотреть глазами, если что-то разойдётся.
    shutil.copy(path, workdir / "before.db")

    print("3. Накатываем 0030")
    command.upgrade(alembic_config(dsn), "0030")

    after = snapshot(engine)
    print(f"   {after}")

    problems: list[str] = []
    for key in before:
        if before[key] != after[key]:
            problems.append(f"{key}: было {before[key]}, стало {after[key]}")

    with engine.connect() as conn:
        # Размен переведён в тыйыны — включая дробный.
        mismatched = conn.execute(
            text(
                "SELECT COUNT(*) FROM shifts "
                "WHERE open_cash_tiyin != CAST(ROUND(open_cash * 100) AS INTEGER)"
            )
        ).scalar_one()
        if mismatched:
            problems.append(f"размен не перенесён у {mismatched} смен")

        # Номера проставлены и уникальны.
        numbers = conn.execute(text("SELECT COUNT(DISTINCT number), COUNT(*) FROM shifts")).one()
        if numbers[0] != numbers[1] or conn.execute(
            text("SELECT COUNT(*) FROM shifts WHERE number = 0")
        ).scalar_one():
            problems.append(f"номера смен не уникальны или пусты: {numbers}")

        # Счётчик встал на максимум — следующая смена не столкнётся с занятым.
        counter = conn.execute(text("SELECT last_number FROM shift_counters WHERE id = 1")).scalar()
        top = conn.execute(text("SELECT MAX(number) FROM shifts")).scalar_one()
        if counter != top:
            problems.append(f"счётчик смен {counter} != максимума {top}")

        # Имя кассира подтянуто из users; у второго пользователя full_name пуст,
        # и туда должен встать username.
        empty_names = conn.execute(
            text("SELECT COUNT(*) FROM shifts WHERE opened_by_name = ''")
        ).scalar_one()
        if empty_names:
            problems.append(f"кассир не проставлен у {empty_names} смен")

        # Снимок показателей закрытых смен посчитан, а у открытой — нет.
        closed_zero = conn.execute(
            text("SELECT COUNT(*) FROM shifts WHERE status = 'closed' AND revenue_tiyin = 0")
        ).scalar_one()
        if closed_zero:
            problems.append(f"снимок выручки не посчитан у {closed_zero} закрытых смен")

        # Новые таблицы созданы и пусты.
        for table in (
            "cash_movements",
            "suppliers",
            "purchase_docs",
            "purchase_lines",
            "supplier_payments",
        ):
            count = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar_one()
            if count != 0:
                problems.append(f"{table} не пуста после миграции: {count}")

        # Чек без смены остался без смены — ему её не выдумали.
        orphan = conn.execute(
            text("SELECT shift_id FROM sales WHERE doc_number = 999999")
        ).scalar()
        if orphan is not None:
            problems.append(f"чеку без смены выдали смену {orphan}")

        sample = conn.execute(
            text(
                "SELECT number, opened_by_name, open_cash, open_cash_tiyin, status,"
                " revenue_tiyin, cash_tiyin FROM shifts ORDER BY id LIMIT 4"
            )
        ).all()

    print("\nВыборочно после миграции (номер, кассир, размен сом → тыйын, статус, выручка, наличные):")
    for row in sample:
        print(f"   {row}")

    print(f"\nфайл до:    {workdir / 'before.db'}")
    print(f"файл после: {path}")

    if problems:
        print("\nПРОБЛЕМЫ:")
        for item in problems:
            print(f"   ✗ {item}")
        sys.exit(1)
    print("\n✓ Данные на месте, новые колонки заполнены, новые таблицы созданы.")


if __name__ == "__main__":
    main()
