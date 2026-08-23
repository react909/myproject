"""Закупка и поставщики: проведение, задвоение остатков, себестоимость, права.

Пять проверок здесь важнее остальных, и все пять — про деньги и остатки:

1. Проведение применяет документ ровно один раз.
2. ПОВТОРНОЕ проведение остатки НЕ ЗАДВАИВАЕТ. Это главный страх этой задачи:
   двойное нажатие, повторная отправка запроса, вернувшийся таймаут — любой из
   них при слабой защите добавил бы товар второй раз, а заметили бы это через
   неделю по инвентаризации.
3. Отмена проведения возвращает и остаток, и себестоимость, и розничную цену
   ровно к тому, что было.
4. Себестоимость считается средневзвешенной — по формуле из одного места.
5. Оплата поставщику требует открытой двери владельца, и проверка стоит на
   сервере: прямой запрос без повышенной сессии отклоняется.

Запуск: python -m unittest discover -s tests (из каталога backend).
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from api_fixture import (  # noqa: E402
    OWNER_CABINET_PASSWORD,
    auth_headers,
    client,
    ensure_setup,
)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.money import weighted_average_cost  # noqa: E402


class PurchaseFlow(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        cls.headers = auth_headers(ensure_setup())
        supplier = cls.client.post(
            "/api/suppliers",
            headers=cls.headers,
            json={"name": "ОсОО Бишкек-Опт", "phone": "+996700111222"},
        )
        assert supplier.status_code == 201, supplier.text
        cls.supplier = supplier.json()

    # ── помощники ────────────────────────────────────────────────────────────

    def make_product(self, name: str, *, stock: float = 0, cost: float = 0, price: float = 0) -> dict:
        response = self.client.post(
            "/api/products",
            headers=self.headers,
            json={
                "name": name,
                "price": price,
                "cost_price": cost,
                "stock_qty": stock,
                "kind": "piece",
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def product(self, product_id: int) -> dict:
        response = self.client.get(f"/api/products/{product_id}", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def make_doc(self, lines: list[dict], **header) -> dict:
        body = {"supplier_id": self.supplier["id"], "settlement": "paid", "lines": lines}
        body.update(header)
        response = self.client.post("/api/purchases", headers=self.headers, json=body)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def post_doc(self, doc_id: int):
        return self.client.post(f"/api/purchases/{doc_id}/post", headers=self.headers)

    # ── сами проверки ────────────────────────────────────────────────────────

    def test_draft_touches_nothing(self) -> None:
        """Черновик не влияет ни на остатки, ни на цены."""
        product = self.make_product("Черновик-товар", stock=5, cost=10, price=20)
        self.make_doc(
            [{"product_id": product["id"], "qty": 100, "cost_tiyin": 5_000, "retail_tiyin": 9_000}]
        )
        after = self.product(product["id"])
        self.assertEqual(after["stock_qty"], 5)
        self.assertEqual(after["cost_price"], 10)
        self.assertEqual(after["price"], 20)

    def test_posting_applies_stock_cost_and_price(self) -> None:
        """Проведение поднимает остаток, пересчитывает себестоимость, ставит цену."""
        product = self.make_product("Сахар", stock=10, cost=40.0, price=55.0)
        doc = self.make_doc(
            [
                {
                    "product_id": product["id"],
                    "qty": 30,
                    "cost_tiyin": 5_000,      # 50.00 сом
                    "retail_tiyin": 7_000,    # 70.00 сом
                }
            ]
        )
        self.assertEqual(doc["status"], "draft")
        self.assertEqual(doc["total_tiyin"], 150_000)
        self.assertEqual(doc["lines"][0]["markup_percent"], 40.0)

        posted = self.post_doc(doc["id"])
        self.assertEqual(posted.status_code, 200, posted.text)
        self.assertEqual(posted.json()["status"], "posted")

        after = self.product(product["id"])
        self.assertEqual(after["stock_qty"], 40)
        self.assertEqual(after["price"], 70.0)
        # (10 × 4000 + 30 × 5000) ÷ 40 = 4750 тыйынов
        self.assertEqual(round(after["cost_price"] * 100), 4_750)
        self.assertEqual(
            weighted_average_cost(10, 4_000, 30, 5_000), 4_750, "формула разошлась с проведением"
        )

    def test_posting_twice_does_not_double_stock(self) -> None:
        """ПОВТОРНОЕ ПРОВЕДЕНИЕ НЕ ЗАДВАИВАЕТ ОСТАТКИ.

        Второй вызов получает 409 и склада не касается вовсе: провести можно
        только черновик, а после первого проведения документ уже не черновик.
        Проверяется именно остаток, а не только код ответа — 409 без проверки
        остатка не отличил бы «не применил» от «применил и пожаловался».
        """
        product = self.make_product("Гречка", stock=0, cost=0, price=0)
        doc = self.make_doc(
            [{"product_id": product["id"], "qty": 25, "cost_tiyin": 8_000, "retail_tiyin": 11_000}]
        )

        first = self.post_doc(doc["id"])
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(self.product(product["id"])["stock_qty"], 25)

        for attempt in range(3):
            again = self.post_doc(doc["id"])
            self.assertEqual(again.status_code, 409, f"попытка {attempt}: {again.text}")
            self.assertIn("уже проведён", again.json()["detail"])
            self.assertEqual(
                self.product(product["id"])["stock_qty"],
                25,
                f"остаток задвоился на попытке {attempt}",
            )

        # И себестоимость с ценой тоже не поехали.
        after = self.product(product["id"])
        self.assertEqual(round(after["cost_price"] * 100), 8_000)
        self.assertEqual(round(after["price"] * 100), 11_000)

    def test_unposting_restores_everything(self) -> None:
        """Отмена проведения возвращает остаток, себестоимость и розничную цену."""
        product = self.make_product("Масло", stock=8, cost=90.0, price=120.0)
        doc = self.make_doc(
            [{"product_id": product["id"], "qty": 12, "cost_tiyin": 11_000, "retail_tiyin": 15_000}]
        )
        self.assertEqual(self.post_doc(doc["id"]).status_code, 200)

        applied = self.product(product["id"])
        self.assertEqual(applied["stock_qty"], 20)
        self.assertEqual(applied["price"], 150.0)
        self.assertEqual(round(applied["cost_price"] * 100), weighted_average_cost(8, 9_000, 12, 11_000))

        canceled = self.client.post(f"/api/purchases/{doc['id']}/unpost", headers=self.headers)
        self.assertEqual(canceled.status_code, 200, canceled.text)
        self.assertEqual(canceled.json()["status"], "canceled")

        restored = self.product(product["id"])
        self.assertEqual(restored["stock_qty"], 8, "остаток не вернулся")
        self.assertEqual(restored["cost_price"], 90.0, "себестоимость не вернулась")
        self.assertEqual(restored["price"], 120.0, "розничная цена не вернулась")

        # Отменять второй раз нечего.
        twice = self.client.post(f"/api/purchases/{doc['id']}/unpost", headers=self.headers)
        self.assertEqual(twice.status_code, 409, twice.text)

    def test_unpost_after_sale_keeps_the_sale(self) -> None:
        """Отмена вычитает приход, а не отменяет заодно продажи.

        Товар пришёл (10), продали 3, отменили приход — остаётся −3, а не 0
        и не 7: продажу отмена не трогает. Заодно `/sold-after` показывает,
        что именно продано, — это то, что видит кассир перед отменой.
        """
        product = self.make_product("Чай отменяемый", stock=0, cost=0, price=0)
        doc = self.make_doc(
            [{"product_id": product["id"], "qty": 10, "cost_tiyin": 3_000, "retail_tiyin": 5_000}]
        )
        self.assertEqual(self.post_doc(doc["id"]).status_code, 200)

        from api_fixture import ensure_shift

        ensure_shift(self.headers)
        sale = self.client.post(
            "/api/sales",
            headers=self.headers,
            json={
                "items": [
                    {
                        "product_id": product["id"],
                        "name": "Чай отменяемый",
                        "quantity": 3,
                        "unit_price": 50,
                        "line_total": 150,
                    }
                ],
                "payment_method": "cash",
                "subtotal": 150,
                "total": 150,
                "cash_received": 150,
            },
        )
        self.assertEqual(sale.status_code, 201, sale.text)
        self.assertEqual(self.product(product["id"])["stock_qty"], 7)

        sold = self.client.get(f"/api/purchases/{doc['id']}/sold-after", headers=self.headers)
        self.assertEqual(sold.status_code, 200, sold.text)
        self.assertEqual(sold.json()[0]["qty"], 3)

        self.assertEqual(
            self.client.post(f"/api/purchases/{doc['id']}/unpost", headers=self.headers).status_code,
            200,
        )
        self.assertEqual(self.product(product["id"])["stock_qty"], -3)

    def test_return_to_supplier_reduces_stock_only(self) -> None:
        """Возврат поставщику уменьшает остаток и не трогает цены."""
        product = self.make_product("Возвратный товар", stock=0, cost=0, price=0)
        purchase = self.make_doc(
            [{"product_id": product["id"], "qty": 20, "cost_tiyin": 4_000, "retail_tiyin": 6_000}]
        )
        self.assertEqual(self.post_doc(purchase["id"]).status_code, 200)
        before = self.product(product["id"])

        back = self.make_doc(
            [{"product_id": product["id"], "qty": 5, "cost_tiyin": 4_000}],
            kind="return",
            source_doc_id=purchase["id"],
        )
        self.assertEqual(self.post_doc(back["id"]).status_code, 200)

        after = self.product(product["id"])
        self.assertEqual(after["stock_qty"], 15)
        self.assertEqual(after["cost_price"], before["cost_price"], "возврат тронул себестоимость")
        self.assertEqual(after["price"], before["price"], "возврат тронул розничную цену")

    def test_posted_document_cannot_be_edited_or_deleted(self) -> None:
        """Проведённый документ нельзя ни переписать, ни удалить."""
        product = self.make_product("Неизменяемый", stock=0)
        doc = self.make_doc([{"product_id": product["id"], "qty": 1, "cost_tiyin": 100}])
        self.assertEqual(self.post_doc(doc["id"]).status_code, 200)

        edited = self.client.put(
            f"/api/purchases/{doc['id']}",
            headers=self.headers,
            json={
                "supplier_id": self.supplier["id"],
                "settlement": "paid",
                "lines": [{"product_id": product["id"], "qty": 999, "cost_tiyin": 100}],
            },
        )
        self.assertEqual(edited.status_code, 409, edited.text)
        removed = self.client.delete(f"/api/purchases/{doc['id']}", headers=self.headers)
        self.assertEqual(removed.status_code, 409, removed.text)

    def test_empty_document_is_not_posted(self) -> None:
        """Документ без строк провести нельзя."""
        doc = self.make_doc([])
        response = self.post_doc(doc["id"])
        self.assertEqual(response.status_code, 400, response.text)

    def test_last_cost_hint(self) -> None:
        """Подсказка последней закупочной цены — по этому поставщику."""
        product = self.make_product("Подсказка", stock=0)
        doc = self.make_doc([{"product_id": product["id"], "qty": 4, "cost_tiyin": 7_777}])
        self.assertEqual(self.post_doc(doc["id"]).status_code, 200)

        hint = self.client.get(
            "/api/purchases/last-cost",
            headers=self.headers,
            params={"product_id": product["id"], "supplier_id": self.supplier["id"]},
        )
        self.assertEqual(hint.status_code, 200, hint.text)
        self.assertEqual(hint.json()["cost_tiyin"], 7_777)

        # У поставщика, который его не возил, подсказки нет — чужая цена в
        # подсказке хуже отсутствующей.
        other = self.client.post(
            "/api/suppliers", headers=self.headers, json={"name": "Другой поставщик"}
        ).json()
        empty = self.client.get(
            "/api/purchases/last-cost",
            headers=self.headers,
            params={"product_id": product["id"], "supplier_id": other["id"]},
        )
        self.assertIsNone(empty.json()["cost_tiyin"])

    def test_labels_skip_zero_price(self) -> None:
        """Ценник без цены не печатается."""
        priced = self.make_product("С ценой", stock=0)
        unpriced = self.make_product("Без цены", stock=0)
        doc = self.make_doc(
            [
                {"product_id": priced["id"], "qty": 1, "cost_tiyin": 100, "retail_tiyin": 500},
                {"product_id": unpriced["id"], "qty": 1, "cost_tiyin": 100, "retail_tiyin": 0},
            ]
        )
        self.assertEqual(self.post_doc(doc["id"]).status_code, 200)
        rows = self.client.get(f"/api/purchases/{doc['id']}/labels", headers=self.headers).json()
        self.assertEqual([row["name"] for row in rows], ["С ценой"])


class SupplierAccess(unittest.TestCase):
    """Долг, оплаты и права на них."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        cls.headers = auth_headers(ensure_setup())
        cls.supplier = cls.client.post(
            "/api/suppliers",
            headers=cls.headers,
            json={"name": "Долговой поставщик", "phone": "+996555999888"},
        ).json()

    def setUp(self) -> None:
        # Каждый тест начинается с закрытой двери владельца: соседний набор мог
        # оставить её открытой, и проверка отказа проверяла бы не то.
        self.client.post("/api/auth/access/leave", headers=self.headers)

    def test_credit_purchase_creates_debt(self) -> None:
        """Проведённая закупка в долг увеличивает сальдо, черновик — нет."""
        product = self.client.post(
            "/api/products",
            headers=self.headers,
            json={"name": "Долговой товар", "price": 0, "kind": "piece"},
        ).json()

        before = self.client.get(
            f"/api/suppliers/{self.supplier['id']}", headers=self.headers
        ).json()["debt_tiyin"]

        doc = self.client.post(
            "/api/purchases",
            headers=self.headers,
            json={
                "supplier_id": self.supplier["id"],
                "settlement": "credit",
                "lines": [{"product_id": product["id"], "qty": 10, "cost_tiyin": 2_500}],
            },
        ).json()

        # Черновик долга не создаёт.
        self.assertEqual(
            self.client.get(f"/api/suppliers/{self.supplier['id']}", headers=self.headers).json()[
                "debt_tiyin"
            ],
            before,
        )

        self.assertEqual(
            self.client.post(f"/api/purchases/{doc['id']}/post", headers=self.headers).status_code,
            200,
        )
        card = self.client.get(
            f"/api/suppliers/{self.supplier['id']}", headers=self.headers
        ).json()
        self.assertEqual(card["debt_tiyin"], before + 25_000)

    def test_payment_requires_owner_door(self) -> None:
        """Оплата поставщику — только из-под открытой двери владельца.

        Проверка на СЕРВЕРЕ: запрос идёт напрямую, никакой кнопки в
        интерфейсе при этом не нажимают. Скрытый пункт меню защитой не
        считается, и тест это фиксирует.
        """
        refused = self.client.post(
            f"/api/suppliers/{self.supplier['id']}/payments",
            headers=self.headers,
            json={"amount_tiyin": 10_000, "method": "cash"},
        )
        self.assertEqual(refused.status_code, 403, refused.text)

        # Просмотр долга при этом доступен: кассир должен знать, что должны.
        self.assertEqual(
            self.client.get(f"/api/suppliers/{self.supplier['id']}", headers=self.headers).status_code,
            200,
        )
        self.assertEqual(
            self.client.get(
                f"/api/suppliers/{self.supplier['id']}/payments", headers=self.headers
            ).status_code,
            200,
        )

    def test_payment_reduces_debt(self) -> None:
        """Оплата уменьшает долг, и остаток после платежа виден в истории."""
        product = self.client.post(
            "/api/products",
            headers=self.headers,
            json={"name": "Оплачиваемый товар", "price": 0, "kind": "piece"},
        ).json()
        doc = self.client.post(
            "/api/purchases",
            headers=self.headers,
            json={
                "supplier_id": self.supplier["id"],
                "settlement": "credit",
                "lines": [{"product_id": product["id"], "qty": 1, "cost_tiyin": 40_000}],
            },
        ).json()
        self.client.post(f"/api/purchases/{doc['id']}/post", headers=self.headers)
        before = self.client.get(
            f"/api/suppliers/{self.supplier['id']}", headers=self.headers
        ).json()["debt_tiyin"]

        opened = self.client.post(
            "/api/auth/access/unlock",
            headers=self.headers,
            json={"secret": OWNER_CABINET_PASSWORD},
        )
        self.assertEqual(opened.status_code, 200, opened.text)
        try:
            paid = self.client.post(
                f"/api/suppliers/{self.supplier['id']}/payments",
                headers=self.headers,
                json={"amount_tiyin": 15_000, "method": "cash", "comment": "Частично"},
            )
            self.assertEqual(paid.status_code, 201, paid.text)
            self.assertEqual(paid.json()["debt_tiyin"], before - 15_000)
        finally:
            self.client.post("/api/auth/access/leave", headers=self.headers)

        history = self.client.get(
            f"/api/suppliers/{self.supplier['id']}/payments", headers=self.headers
        ).json()
        self.assertEqual(history[0]["amount_tiyin"], 15_000)
        self.assertEqual(history[0]["balance_after_tiyin"], before - 15_000)

    def test_supplier_with_debt_is_not_archived(self) -> None:
        """Поставщика с долгом убрать из списка нельзя."""
        response = self.client.delete(
            f"/api/suppliers/{self.supplier['id']}", headers=self.headers
        )
        self.assertEqual(response.status_code, 409, response.text)


if __name__ == "__main__":
    unittest.main()
