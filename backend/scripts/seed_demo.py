"""Демонстрационная база: установка и наполненный журнал чеков.

Зачем. Панель управления живёт за входом, и посмотреть на неё, не заведя
магазин, нельзя. Заводить его в рабочей базе клиента, чтобы поглядеть на
вёрстку, тем более нельзя. Скрипт поднимает ОТДЕЛЬНУЮ базу, проходит установку
через API и наливает чеки — рабочая база при этом не открывается вовсе.

Запуск (из каталога backend):

    $env:SQLITE_PATH = "$env:TEMP\\kassir-demo.db"
    .venv\\Scripts\\python.exe scripts\\seed_demo.py

После этого тем же SQLITE_PATH запускается main.py, и в интерфейс можно войти
парой DEMO_EMAIL / DEMO_PASSWORD, напечатанной в конце.

Инструмент разработки, как scripts/bench_panel.py. В сборку не входит и на
рабочую базу не смотрит: путь берётся только из переменной окружения, без неё
скрипт отказывается работать.
"""

from __future__ import annotations

import asyncio
import os
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

if not os.environ.get("SQLITE_PATH"):
    raise SystemExit(
        "SQLITE_PATH не задан. Скрипт не трогает рабочую базу — путь задаётся явно."
    )
os.environ.setdefault("NURCRM_DB_MODE", "sqlite_only")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db.database import sqlite_engine  # noqa: E402
from app.main import app  # noqa: E402
from app.modules.licensing.activation import generate_key  # noqa: E402

DEMO_EMAIL = "owner@example.kg"
DEMO_PASSWORD = "Parol12345"
DEMO_OWNER_PASSWORD = "Vladelec2026"

# Сколько чеков налить. Две тысячи — достаточно, чтобы список прокручивался и
# догружался порциями по 50, и мало, чтобы скрипт отработал за секунды.
RECEIPTS = 2_000

CASHIERS = ["Айгуль Осмонова", "Нурлан Абдиев", "Мария Ким", "Данияр Токтогулов"]
STATUSES = ["paid"] * 86 + ["debt"] * 6 + ["canceled"] * 3 + ["refunded"] * 3 + ["partial_refund"] * 2
METHODS = ["cash"] * 52 + ["card"] * 38 + ["mixed"] * 5 + ["debt"] * 5
GOODS = [
    ("Хлеб белый", False), ("Молоко 2.5%", False), ("Яблоки Фуджи", True),
    ("Картофель", True), ("Сахар-песок", True), ("Масло подсолнечное", False),
    ("Куриное филе", True), ("Гречка ядрица", True), ("Чай чёрный листовой", False),
    ("Кофе молотый", False), ("Сыр Гауда", True), ("Колбаса варёная", True),
    ("Помидоры розовые", True), ("Огурцы длинноплодные", True), ("Рис длиннозёрный", True),
    ("Макароны спагетти", False), ("Печенье овсяное", False), ("Вода питьевая 5 л", False),
]
CLIENTS = ["", "", "", "Асель", "Бакыт", "Гулнара", "Тимур", "Айбек"]


def install() -> None:
    """Проходит установку через API — теми же маршрутами, что и мастер."""
    with TestClient(app) as api:
        if not api.get("/api/setup/status").json().get("needs_setup"):
            print("установка уже пройдена, наливаем только чеки")
            return

        key = generate_key(get_settings().license_hmac_secret)
        activated = api.post("/api/setup/activate", json={"license_key": key})
        activated.raise_for_status()

        created = api.post(
            "/api/setup/init",
            json={
                "setup_token": activated.json()["setup_token"],
                "edition": "standard",
                "onboarding": {
                    "fiscalMode": "simple",
                    "company": {"shortName": "Магазин Бимар", "legalName": "ОсОО Бимар"},
                    "outlet": {"name": "Бимар на Чуй", "city": "Бишкек", "street": "Чуй", "building": "1"},
                    "contacts": {"phone": "+996555123456"},
                    "owner": {"firstName": "Хузайфа", "lastName": "Шакиржанов", "email": DEMO_EMAIL},
                },
                "account": {
                    "email": DEMO_EMAIL,
                    "password": DEMO_PASSWORD,
                    "owner_password": DEMO_OWNER_PASSWORD,
                    "service_key": "Bimar2026",
                },
            },
        )
        created.raise_for_status()
        print(f"установка выполнена, лицензионный ключ: {key}")


async def seed() -> None:
    """Наливает чеки напрямую в SQL.

    Через API это две тысячи HTTP-вызовов и столько же транзакций; здесь важен
    результат в базе, а не путь, которым он туда попал.
    """
    random.seed(20260822)
    started = datetime.now() - timedelta(days=120)

    async with sqlite_engine.begin() as conn:
        existing = (await conn.execute(text("SELECT COUNT(*) FROM sales"))).scalar_one()
        if existing >= RECEIPTS:
            print(f"чеки уже налиты ({existing}), пропускаем")
            return

        next_id = (await conn.execute(text("SELECT COALESCE(MAX(id), 0) FROM sales"))).scalar_one()
        next_item = (
            await conn.execute(text("SELECT COALESCE(MAX(id), 0) FROM sale_items"))
        ).scalar_one()

        sale_sql = text(
            "INSERT INTO sales (id, doc_number, status, payment_method, subtotal, discount_total,"
            " total, cash_received, card_amount, change_amount, debt_balance, client_name,"
            " client_phone, user_id, cashier_name, created_at, note, payment_provider,"
            " payment_provider_title, payment_ref, payment_confirmation)"
            " VALUES (:id, :doc, :st, :pm, :sub, :disc, :total, :cash, :card, 0, :debt, :client,"
            " '', 1, :cashier, :created, '', '', '', '', 'manual')"
        )
        item_sql = text(
            "INSERT INTO sale_items (id, sale_id, product_id, name, is_weight, is_service,"
            " quantity, unit_price, discount, line_total, cost_price)"
            " VALUES (:id, :sale, NULL, :name, :weight, 0, :qty, :price, 0, :total, :cost)"
        )

        sales, items = [], []
        for index in range(1, RECEIPTS + 1):
            sale_id = next_id + index
            moment = started + timedelta(seconds=random.randint(0, 120 * 86_400))
            status = random.choice(STATUSES)
            method = random.choice(METHODS)

            lines = []
            for _ in range(random.randint(1, 5)):
                name, weight = random.choice(GOODS)
                price = round(random.uniform(35, 950), 2)
                qty = round(random.uniform(0.15, 2.8), 3) if weight else float(random.randint(1, 4))
                lines.append((name, weight, qty, price, round(price * qty, 2)))

            subtotal = round(sum(line[4] for line in lines), 2)
            discount = round(subtotal * 0.05, 2) if index % 11 == 0 else 0.0
            total = round(subtotal - discount, 2)

            sales.append({
                "id": sale_id, "doc": sale_id, "st": status, "pm": method,
                "sub": subtotal, "disc": discount, "total": total,
                "cash": total if method in ("cash", "mixed") else 0.0,
                "card": total if method == "card" else 0.0,
                "debt": total if status == "debt" else 0.0,
                "client": random.choice(CLIENTS),
                "cashier": random.choice(CASHIERS),
                "created": moment.isoformat(sep=" "),
            })
            for name, weight, qty, price, line_total in lines:
                next_item += 1
                items.append({
                    "id": next_item, "sale": sale_id, "name": name,
                    "weight": 1 if weight else 0, "qty": qty, "price": price,
                    "total": line_total, "cost": round(price * 0.7, 2),
                })

        await conn.execute(sale_sql, sales)
        await conn.execute(item_sql, items)
        # Счётчик номеров догоняем: иначе следующая настоящая продажа выдаст
        # номер, который уже занят налитыми чеками.
        await conn.execute(
            text("UPDATE sale_counters SET last_number = :n WHERE id = 1"),
            {"n": next_id + RECEIPTS},
        )
        print(f"налито {len(sales)} чеков и {len(items)} позиций")

    await sqlite_engine.dispose()


if __name__ == "__main__":
    install()
    asyncio.run(seed())
    print()
    print(f"база:     {get_settings().sqlite_path}")
    print(f"вход:     {DEMO_EMAIL} / {DEMO_PASSWORD}")
    print(f"владелец: {DEMO_OWNER_PASSWORD}")
