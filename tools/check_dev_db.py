"""Состояние рабочей базы разработчика после миграции 0030.

Отвечает на один вопрос: цела ли база и заполнились ли новые колонки. Нужен
после того, как на базу накатилась новая схема, — чтобы не гадать по логам.

Запуск: backend\\.venv\\Scripts\\python.exe tools\\check_dev_db.py [путь]
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("backend/nurcrm.db")
if not path.exists():
    print(f"базы нет: {path}")
    raise SystemExit(1)

connection = sqlite3.connect(str(path))

version = connection.execute("SELECT version_num FROM alembic_version").fetchone()
print(f"схема: {version[0] if version else 'нет'}")

tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
needed = [
    "suppliers",
    "purchase_docs",
    "purchase_lines",
    "supplier_payments",
    "cash_movements",
    "shift_counters",
    "purchase_counters",
]
missing = [name for name in needed if name not in tables]
print(f"новые таблицы: {'все на месте' if not missing else 'НЕТ — ' + ', '.join(missing)}")

print("\nсодержимое:")
for table in ("users", "products", "sales", "sale_items", "shifts", "stock_moves"):
    if table in tables:
        count = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table:12} {count}")

print("\nсмены (id, №, кассир, размен сом → тыйын, статус):")
for row in connection.execute(
    "SELECT id, number, opened_by_name, open_cash, open_cash_tiyin, status FROM shifts ORDER BY id"
):
    print(f"  {row}")

without = connection.execute("SELECT COUNT(*) FROM sales WHERE shift_id IS NULL").fetchone()[0]
with_shift = connection.execute("SELECT COUNT(*) FROM sales WHERE shift_id IS NOT NULL").fetchone()[0]
print(f"\nчеки: со сменой {with_shift}, без смены {without} (последним смена не выдумывалась)")

open_shifts = connection.execute("SELECT COUNT(*) FROM shifts WHERE status = 'open'").fetchone()[0]
print(f"открытых смен: {open_shifts}")
if open_shifts > 1:
    print("  ВНИМАНИЕ: открытых смен больше одной — это состояние из старой схемы.")
    print("  Продажа привяжется к последней; лишние надо закрыть в разделе «Смена».")
