"""Наливает демо-магазин в отдельную базу и печатает токен для съёмки экранов.

Зачем отдельным скриптом: смотреть на пустые разделы бессмысленно — пустое
состояние это отдельный экран, а работу интерфейса видно только на данных.
Здесь заводится всё, что нужно трём новым разделам: поставщики с долгами и
просрочкой, документы закупки во всех состояниях, открытая смена с продажами,
возвратами и движениями по ящику, плюс история закрытых смен.

Запуск (backend должен быть уже поднят на 127.0.0.1:8000 с нужной базой):

    .venv\\Scripts\\python.exe ..\\tools\\seed_demo_shop.py

Печатает в stdout строку `TOKEN=...` — её подхватывает скрипт съёмки.
"""

from __future__ import annotations

import json
import random
import sys
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta

BASE = "http://127.0.0.1:8000"
EMAIL = "demo@kassir.kg"
PASSWORD = "Parol12345"
OWNER_PASSWORD = "Vladelec2026"
SERVICE_KEY = "Bimar2026"


def call(method: str, path: str, body: dict | None = None, token: str = "") -> tuple[int, dict]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    request = urllib.request.Request(BASE + path, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8")
        # Ошибку не проглатываем: половина налитых данных хуже, чем ни одной, —
        # по такому экрану нельзя понять, что сломалось.
        try:
            return error.code, json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return error.code, {"detail": raw}


def must(status: int, body: dict, what: str, ok: tuple[int, ...] = (200, 201)) -> dict:
    if status not in ok:
        print(f"ОШИБКА на «{what}»: {status} {body}", file=sys.stderr)
        sys.exit(1)
    return body


GOODS = [
    ("Хлеб «Тартин»", "2000000000017", 4500, 6500),
    ("Молоко 2.5% 1 л", "2000000000024", 7800, 9900),
    ("Яблоки Гала", "2000000000031", 9000, 14500),
    ("Картофель мытый", "2000000000048", 3200, 5500),
    ("Сахар-песок 1 кг", "2000000000055", 6400, 8900),
    ("Масло подсолнечное 1 л", "2000000000062", 13500, 17900),
    ("Куриное филе", "2000000000079", 32000, 45000),
    ("Гречка 900 г", "2000000000086", 11000, 15500),
    ("Чай чёрный 100 пак.", "2000000000093", 18000, 24900),
    ("Кофе молотый 250 г", "2000000000109", 42000, 58000),
    ("Сыр «Гауда» 200 г", "2000000000116", 19500, 27500),
    ("Колбаса варёная", "2000000000123", 28000, 38500),
    ("Помидоры розовые", "2000000000130", 12000, 18000),
    ("Огурцы длинноплодные", "2000000000147", 9500, 14000),
    ("Рис «Лазер» 1 кг", "2000000000154", 14000, 19500),
    ("Макароны «Спагетти»", "2000000000161", 5600, 8200),
    ("Печенье овсяное", "2000000000178", 7200, 10500),
    ("Вода питьевая 5 л", "2000000000185", 6000, 8500),
]

SUPPLIERS = [
    ("ОсОО «Бишкек-Опт»", "Асанов Тимур", "+996 700 11 22 33", "Бишкек, ул. Ибраимова 115"),
    ("ИП Мамытова А.К.", "Мамытова Айгуль", "+996 555 44 55 66", "Бишкек, Аламединский рынок"),
    ("ОсОО «Ак-Сут»", "Джолдошев Нурлан", "+996 770 88 99 00", "Чуйская обл., с. Кант"),
    ("ТД «Восток-Трейд»", "Ким Сергей", "+996 701 23 45 67", "Бишкек, ул. Льва Толстого 20"),
    ("ИП Осмонов Б.", "Осмонов Бакыт", "+996 559 10 20 30", "Ош, ул. Курманжан Датка 8"),
]


def main() -> None:
    random.seed(20260823)

    # 1. Установка. Если база уже настроена — просто входим.
    status, body = call("POST", "/api/setup/activate", {"license_key": _license_key()})
    if status == 200:
        setup_token = body["setup_token"]
        status, body = call(
            "POST",
            "/api/setup/init",
            {
                "setup_token": setup_token,
                "edition": "start",
                "onboarding": {
                    "fiscalMode": "simple",
                    "company": {"shortName": "Магазин «Береке»"},
                    "outlet": {"city": "Бишкек", "street": "ул. Киевская 148"},
                    "contacts": {"phone": "+996555123456"},
                    "owner": {"firstName": "Айбек", "lastName": "Осмонов", "email": EMAIL},
                },
                "account": {
                    "email": EMAIL,
                    "password": PASSWORD,
                    "owner_password": OWNER_PASSWORD,
                    "service_key": SERVICE_KEY,
                },
            },
        )
    if status == 201:
        token = body["access_token"]
    else:
        logged = must(
            *call("POST", "/api/auth/login", {"username": EMAIL, "password": PASSWORD}), "вход"
        )
        token = logged["access_token"]

    # 2. Товары.
    products: list[dict] = []
    existing = must(*call("GET", "/api/products", token=token), "список товаров")
    by_name = {p["name"]: p for p in existing}
    for name, barcode, cost, price in GOODS:
        if name in by_name:
            products.append(by_name[name])
            continue
        products.append(
            must(
                *call(
                    "POST",
                    "/api/products",
                    {
                        "name": name,
                        "barcode": barcode,
                        "kind": "piece",
                        "price": price / 100,
                        "cost_price": cost / 100,
                        "stock_qty": random.randint(12, 180),
                    },
                    token,
                ),
                f"товар {name}",
            )
        )

    # 3. Поставщики.
    suppliers: list[dict] = []
    known = must(*call("GET", "/api/suppliers", token=token), "список поставщиков")["items"]
    by_supplier = {s["name"]: s for s in known}
    for name, contact, phone, address in SUPPLIERS:
        if name in by_supplier:
            suppliers.append(by_supplier[name])
            continue
        suppliers.append(
            must(
                *call(
                    "POST",
                    "/api/suppliers",
                    {
                        "name": name,
                        "contact_person": contact,
                        "phone": phone,
                        "address": address,
                        "comment": "",
                    },
                    token,
                ),
                f"поставщик {name}",
            )
        )

    # 4. Документы закупки: проведённые, один черновик, один просроченный долг.
    now = datetime.now(UTC)
    docs = must(*call("GET", "/api/purchases", token=token), "список закупок")["items"]
    if len(docs) < 12:
        for index in range(14):
            supplier = suppliers[index % len(suppliers)]
            picked = random.sample(products, random.randint(3, 7))
            lines = []
            for product in picked:
                cost = int(round(product["cost_price"] * 100))
                # Часть позиций дорожает — чтобы подсказка «подорожало» была видна.
                cost = int(cost * random.choice([1.0, 1.0, 1.06, 1.12]))
                lines.append(
                    {
                        "product_id": product["id"],
                        "qty": random.choice([6, 10, 12, 20, 24, 30, 50]),
                        "cost_tiyin": cost,
                        "retail_tiyin": int(cost * random.uniform(1.28, 1.55)),
                    }
                )
            credit = index % 3 == 0
            doc_date = now - timedelta(days=index * 4 + random.randint(0, 3))
            created = must(
                *call(
                    "POST",
                    "/api/purchases",
                    {
                        "supplier_id": supplier["id"],
                        "doc_date": doc_date.isoformat(),
                        "invoice_number": f"НК-{2600 + index}",
                        "comment": "",
                        "settlement": "credit" if credit else "paid",
                        # Часть долгов просрочена — строка в списке помечается.
                        "due_date": (doc_date + timedelta(days=7 if index < 4 else 45)).isoformat()
                        if credit
                        else None,
                        "lines": lines,
                    },
                    token,
                ),
                "документ закупки",
            )
            # Последние два оставляем черновиками: список должен показывать все
            # три состояния, а не одно.
            if index < 12:
                must(*call("POST", f"/api/purchases/{created['id']}/post", token=token), "проведение")

    # 5. Оплаты поставщикам — за дверью владельца.
    must(*call("POST", "/api/auth/access/unlock", {"secret": OWNER_PASSWORD}, token), "дверь владельца")
    for supplier in suppliers[:3]:
        card = must(*call("GET", f"/api/suppliers/{supplier['id']}", token=token), "карточка")
        if card["debt_tiyin"] > 20_000:
            call(
                "POST",
                f"/api/suppliers/{supplier['id']}/payments",
                {
                    "amount_tiyin": card["debt_tiyin"] // 3,
                    "method": "transfer",
                    "comment": "Частичный расчёт",
                },
                token,
            )
    call("POST", "/api/auth/access/leave", None, token)

    # 6. Смены: несколько закрытых для истории и одна открытая с работой.
    history = must(*call("GET", "/api/shifts/history?limit=5", token=token), "история смен")
    if len(history["items"]) < 4:
        for index in range(4):
            current = call("GET", "/api/shifts/current", token=token)[1]
            if not current:
                current = must(
                    *call(
                        "POST",
                        "/api/shifts/open",
                        {
                            "open_cash_tiyin": random.choice([30_000, 50_000, 80_000]),
                            "cashier_name": random.choice(["Айгуль", "Нурлан", "Мария"]),
                        },
                        token,
                    ),
                    "открытие смены",
                )
            _sell(token, products, random.randint(6, 14))
            state = must(*call("GET", "/api/shifts/state", token=token), "состояние смены")
            # Одна смена из четырёх закрывается с недостачей — чтобы сверка
            # показывала не только «сошлось».
            counted = state["expected_cash_tiyin"] - (7_500 if index == 2 else 0)
            must(
                *call(
                    "POST",
                    f"/api/shifts/{current['id']}/close",
                    {
                        "counted_cash_tiyin": counted,
                        "variance_reason": "Ошиблись сдачей" if index == 2 else "",
                    },
                    token,
                ),
                "закрытие смены",
            )

    # Текущая смена: продажи, возврат, внесение и изъятие.
    current = call("GET", "/api/shifts/current", token=token)[1]
    if not current:
        current = must(
            *call(
                "POST",
                "/api/shifts/open",
                {"open_cash_tiyin": 50_000, "cashier_name": "Айгуль Сатыбалдиева"},
                token,
            ),
            "открытие текущей смены",
        )
        sales = _sell(token, products, 17)
        # Возврат по одному чеку — он должен быть виден и в движениях, и в
        # показателях.
        for sale in sales:
            if sale["payment_method"] == "cash" and sale["items"]:
                call(
                    "POST",
                    f"/api/sales/{sale['id']}/refund",
                    {
                        "items": [{"sale_item_id": sale["items"][0]["id"], "quantity": 1}],
                        "note": "Покупатель передумал",
                    },
                    token,
                )
                break
        call(
            "POST",
            f"/api/shifts/{current['id']}/cash",
            {"kind": "deposit", "amount_tiyin": 20_000, "reason": "Размен из сейфа"},
            token,
        )
        call(
            "POST",
            f"/api/shifts/{current['id']}/cash",
            {
                "kind": "withdrawal",
                "amount_tiyin": 45_000,
                "reason": "Инкассация",
                "actor_name": "Осмонов А.",
                "comment": "Передано владельцу",
            },
            token,
        )

    print(f"TOKEN={token}")
    print(f"EMAIL={EMAIL}")


def _sell(token: str, products: list[dict], count: int) -> list[dict]:
    made = []
    for _ in range(count):
        picked = random.sample(products, random.randint(1, 4))
        items = []
        total = 0.0
        for product in picked:
            qty = random.randint(1, 3)
            price = float(product["price"])
            total += price * qty
            items.append(
                {
                    "product_id": product["id"],
                    "name": product["name"],
                    "quantity": qty,
                    "unit_price": price,
                    "line_total": round(price * qty, 2),
                }
            )
        total = round(total, 2)
        method = random.choice(["cash"] * 6 + ["card"] * 3 + ["debt"])
        status, body = call(
            "POST",
            "/api/sales",
            {
                "items": items,
                "payment_method": method,
                "subtotal": total,
                "total": total,
                "cash_received": total if method == "cash" else 0,
                "card_amount": total if method == "card" else 0,
                "client_name": "Постоянный клиент" if method == "debt" else "",
            },
            token,
        )
        if status == 201:
            made.append(body)
    return made


def _license_key() -> str:
    """Ключ установки. Генерируется тем же кодом, что и в бэкенде."""
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1] / "backend"))
    from app.core.config import get_settings
    from app.modules.licensing.activation import generate_key

    return generate_key(get_settings().license_hmac_secret)


if __name__ == "__main__":
    main()
