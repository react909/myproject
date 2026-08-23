"""Кассовая смена: одна открытая, движения по ящику, сверка при закрытии.

Что здесь проверяется по существу, а не «эндпоинт отвечает 200»:

* вторую смену открыть нельзя — иначе деньги в одном ящике считаются по двум
  сменам сразу и не сходятся ни по одной;
* продажа без смены не проходит: раньше касса открывала смену молча, с нулевым
  разменом, и сверка в конце дня показывала излишек на всю сумму размена;
* расчётная сумма наличных сходится с тем, что кассир пересчитает руками, —
  включая возврат наличными и погашение долга;
* смену с расхождением нельзя закрыть, не объяснив его;
* закрытую смену изменить нельзя.

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


class ShiftLifecycle(unittest.TestCase):
    """Открытие, движения, сверка, закрытие."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        cls.headers = auth_headers(ensure_setup())
        # Наборы тестов делят одну базу и один процесс. Смену, оставленную
        # соседним набором, закрываем — иначе первый же тест «вторую открыть
        # нельзя» проверял бы не то, что думает.
        cls._close_any_open()

    @classmethod
    def _close_any_open(cls) -> None:
        current = cls.client.get("/api/shifts/current", headers=cls.headers).json()
        if not current:
            return
        state = cls.client.get(f"/api/shifts/{current['id']}", headers=cls.headers).json()
        cls.client.post(
            f"/api/shifts/{current['id']}/close",
            headers=cls.headers,
            json={"counted_cash_tiyin": state["expected_cash_tiyin"]},
        )

    def setUp(self) -> None:
        # Двери владельца закрываем перед каждым тестом.
        #
        # Повышение живёт в памяти процесса, а наборы тестов делят один
        # процесс: соседний набор открывал дверь владельца и не закрывал её за
        # собой. Из-за этого проверка «смену с расхождением без причины
        # закрыть нельзя» проходила успешно — потому что дверь была открыта, и
        # правило честно её пропускало. Тест при этом проверял не то, что
        # думал, и падал бы только при запуске в одиночку.
        self.client.post("/api/auth/access/leave", headers=self.headers)
        self._close_any_open()

    def tearDown(self) -> None:
        self._close_any_open()
        self.client.post("/api/auth/access/leave", headers=self.headers)

    # ── помощники ────────────────────────────────────────────────────────────

    def open_shift(self, open_cash_tiyin: int = 50_000) -> dict:
        response = self.client.post(
            "/api/shifts/open",
            headers=self.headers,
            json={"open_cash_tiyin": open_cash_tiyin, "cashier_name": "Айгуль"},
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def state(self) -> dict:
        response = self.client.get("/api/shifts/state", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def sell(self, total: float, method: str = "cash", **extra) -> dict:
        body = {
            "items": [
                {"name": "Товар смены", "quantity": 1, "unit_price": total, "line_total": total}
            ],
            "payment_method": method,
            "subtotal": total,
            "total": total,
            "cash_received": total if method == "cash" else 0,
            "card_amount": total if method == "card" else 0,
        }
        body.update(extra)
        response = self.client.post("/api/sales", headers=self.headers, json=body)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    # ── сами проверки ────────────────────────────────────────────────────────

    def test_second_shift_is_refused(self) -> None:
        """Одновременно открыта может быть только одна смена."""
        first = self.open_shift()
        second = self.client.post(
            "/api/shifts/open",
            headers=self.headers,
            json={"open_cash_tiyin": 10_000},
        )
        self.assertEqual(second.status_code, 409, second.text)
        self.assertIn("уже открыта", second.json()["detail"])
        # Первая смена от неудачной попытки не пострадала.
        current = self.client.get("/api/shifts/current", headers=self.headers).json()
        self.assertEqual(current["id"], first["id"])

    def test_sale_without_shift_is_refused(self) -> None:
        """Продажа без смены отклоняется, а не открывает смену молча."""
        self.assertIsNone(self.client.get("/api/shifts/current", headers=self.headers).json())
        response = self.client.post(
            "/api/sales",
            headers=self.headers,
            json={
                "items": [{"name": "Хлеб", "quantity": 1, "unit_price": 30, "line_total": 30}],
                "payment_method": "cash",
                "subtotal": 30,
                "total": 30,
                "cash_received": 30,
            },
        )
        self.assertEqual(response.status_code, 409, response.text)
        # Слово «смен» в тексте — по нему касса узнаёт эту ошибку и предлагает
        # открыть смену. См. NO_SHIFT_DETAIL в sales/router.py.
        self.assertIn("мен", response.json()["detail"].lower())
        # И ни одной смены при этом не завелось.
        self.assertIsNone(self.client.get("/api/shifts/current", headers=self.headers).json())

    def test_expected_cash_follows_sales_and_movements(self) -> None:
        """Расчётная сумма = размен + наличные по чекам + внесения − изъятия."""
        self.open_shift(open_cash_tiyin=50_000)  # 500 сом размена

        self.sell(120.0, "cash")   # +12000
        self.sell(300.0, "card")   # ящика не касается
        self.sell(80.50, "cash")   # +8050

        state = self.state()
        self.assertEqual(state["expected_cash_tiyin"], 50_000 + 12_000 + 8_050)
        self.assertEqual(state["metrics"]["cash_tiyin"], 20_050)
        self.assertEqual(state["metrics"]["card_tiyin"], 30_000)
        self.assertEqual(state["metrics"]["sales_count"], 3)

        shift_id = state["shift"]["id"]
        deposit = self.client.post(
            f"/api/shifts/{shift_id}/cash",
            headers=self.headers,
            json={"kind": "deposit", "amount_tiyin": 5_000, "reason": "Размен из сейфа"},
        )
        self.assertEqual(deposit.status_code, 201, deposit.text)
        self.assertEqual(deposit.json()["expected_cash_tiyin"], 75_050)

        withdrawal = self.client.post(
            f"/api/shifts/{shift_id}/cash",
            headers=self.headers,
            json={
                "kind": "withdrawal",
                "amount_tiyin": 25_000,
                "reason": "Инкассация",
                "actor_name": "Бухгалтер",
            },
        )
        self.assertEqual(withdrawal.status_code, 201, withdrawal.text)
        self.assertEqual(withdrawal.json()["expected_cash_tiyin"], 50_050)
        self.assertEqual(withdrawal.json()["deposits_tiyin"], 5_000)
        self.assertEqual(withdrawal.json()["withdrawals_tiyin"], 25_000)

        # Оба движения видны списком, свежее сверху.
        movements = self.client.get(
            f"/api/shifts/{shift_id}/movements", headers=self.headers
        ).json()["items"]
        self.assertEqual([m["kind"] for m in movements], ["withdrawal", "deposit"])
        self.assertEqual(movements[0]["amount_tiyin"], -25_000)
        self.assertEqual(movements[0]["actor_name"], "Бухгалтер")

    def test_withdrawal_over_drawer_is_refused(self) -> None:
        """Изъять больше, чем есть в ящике, нельзя."""
        shift = self.open_shift(open_cash_tiyin=10_000)
        response = self.client.post(
            f"/api/shifts/{shift['id']}/cash",
            headers=self.headers,
            json={"kind": "withdrawal", "amount_tiyin": 10_001, "reason": "Слишком много"},
        )
        self.assertEqual(response.status_code, 400, response.text)

    def test_cash_refund_leaves_the_drawer(self) -> None:
        """Возврат наличными уменьшает расчётную сумму ровно на возвращённое.

        Это проверка ошибки, которую легко не заметить: возврат в кассе не
        заводит записи на сумму, а уменьшает `total` самого чека. Наличные
        при этом считаются по `cash_received`, которое возврат не трогает, —
        и без отдельной записи движения ящик «не заметил» бы выдачи.
        """
        self.open_shift(open_cash_tiyin=0)
        sale = self.sell(200.0, "cash")
        self.assertEqual(self.state()["expected_cash_tiyin"], 20_000)

        refund = self.client.post(
            f"/api/sales/{sale['id']}/refund",
            headers=self.headers,
            json={"items": [{"sale_item_id": sale["items"][0]["id"], "quantity": 1}]},
        )
        self.assertEqual(refund.status_code, 200, refund.text)

        state = self.state()
        self.assertEqual(state["expected_cash_tiyin"], 0)
        self.assertEqual(state["metrics"]["refunds_count"], 1)
        self.assertEqual(state["metrics"]["refunds_tiyin"], 20_000)

    def test_cash_debt_payment_enters_the_drawer(self) -> None:
        """Погашение долга наличными увеличивает расчётную сумму."""
        self.open_shift(open_cash_tiyin=0)
        sale = self.sell(500.0, "debt", cash_received=0)
        self.assertEqual(self.state()["expected_cash_tiyin"], 0)

        paid = self.client.post(
            f"/api/sales/{sale['id']}/pay-debt",
            headers=self.headers,
            json={"amount": 500.0, "payment_method": "cash", "cash_received": 500.0},
        )
        self.assertEqual(paid.status_code, 200, paid.text)
        self.assertEqual(self.state()["expected_cash_tiyin"], 50_000)

    def test_close_without_variance(self) -> None:
        """Сошлось ровно — закрывается без объяснений."""
        shift = self.open_shift(open_cash_tiyin=20_000)
        self.sell(150.0, "cash")

        expected = self.state()["expected_cash_tiyin"]
        self.assertEqual(expected, 35_000)

        closed = self.client.post(
            f"/api/shifts/{shift['id']}/close",
            headers=self.headers,
            json={"counted_cash_tiyin": expected},
        )
        self.assertEqual(closed.status_code, 200, closed.text)
        body = closed.json()
        self.assertEqual(body["status"], "closed")
        self.assertEqual(body["variance_tiyin"], 0)
        self.assertEqual(body["expected_cash_tiyin"], expected)
        self.assertTrue(body["reconciled"])

    def test_close_with_variance_needs_reason(self) -> None:
        """С расхождением — только с причиной или из-под двери владельца."""
        shift = self.open_shift(open_cash_tiyin=20_000)
        self.sell(100.0, "cash")
        expected = self.state()["expected_cash_tiyin"]

        # Недостача в 50 сом без объяснения — отказ.
        refused = self.client.post(
            f"/api/shifts/{shift['id']}/close",
            headers=self.headers,
            json={"counted_cash_tiyin": expected - 5_000},
        )
        self.assertEqual(refused.status_code, 409, refused.text)
        self.assertIn("недостача", refused.json()["detail"].lower())
        # Смена от отказа не закрылась.
        self.assertEqual(
            self.client.get("/api/shifts/current", headers=self.headers).json()["id"], shift["id"]
        )

        # С причиной — закрывается, и причина попадает в отчёт.
        closed = self.client.post(
            f"/api/shifts/{shift['id']}/close",
            headers=self.headers,
            json={
                "counted_cash_tiyin": expected - 5_000,
                "variance_reason": "Ошиблись сдачей утром",
            },
        )
        self.assertEqual(closed.status_code, 200, closed.text)
        self.assertEqual(closed.json()["variance_tiyin"], -5_000)
        self.assertEqual(closed.json()["variance_reason"], "Ошиблись сдачей утром")

    def test_owner_door_replaces_the_reason(self) -> None:
        """Владелец закрывает смену с расхождением без объяснения."""
        shift = self.open_shift(open_cash_tiyin=10_000)
        opened = self.client.post(
            "/api/auth/access/unlock",
            headers=self.headers,
            json={"secret": OWNER_CABINET_PASSWORD},
        )
        self.assertEqual(opened.status_code, 200, opened.text)
        try:
            closed = self.client.post(
                f"/api/shifts/{shift['id']}/close",
                headers=self.headers,
                json={"counted_cash_tiyin": 12_000},
            )
            self.assertEqual(closed.status_code, 200, closed.text)
            self.assertEqual(closed.json()["variance_tiyin"], 2_000)
        finally:
            # Дверь за собой закрываем: соседние наборы тестов не должны
            # унаследовать открытую сессию владельца.
            self.client.post("/api/auth/access/leave", headers=self.headers)

    def test_closed_shift_is_immutable(self) -> None:
        """Закрытую смену нельзя ни закрыть повторно, ни трогать её ящик."""
        shift = self.open_shift(open_cash_tiyin=0)
        first = self.client.post(
            f"/api/shifts/{shift['id']}/close",
            headers=self.headers,
            json={"counted_cash_tiyin": 0},
        )
        self.assertEqual(first.status_code, 200, first.text)

        again = self.client.post(
            f"/api/shifts/{shift['id']}/close",
            headers=self.headers,
            json={"counted_cash_tiyin": 999_999, "variance_reason": "Повторная отправка"},
        )
        self.assertEqual(again.status_code, 409, again.text)

        movement = self.client.post(
            f"/api/shifts/{shift['id']}/cash",
            headers=self.headers,
            json={"kind": "deposit", "amount_tiyin": 100},
        )
        self.assertEqual(movement.status_code, 409, movement.text)

        # Сверка осталась той, что зафиксировали.
        card = self.client.get(f"/api/shifts/{shift['id']}", headers=self.headers).json()
        self.assertEqual(card["shift"]["counted_cash_tiyin"], 0)

    def test_interim_report_does_not_close(self) -> None:
        """Промежуточный отчёт смену не закрывает."""
        shift = self.open_shift(open_cash_tiyin=1_000)
        report = self.client.get(
            f"/api/shifts/{shift['id']}/report", headers=self.headers, params={"kind": "x"}
        )
        self.assertEqual(report.status_code, 200, report.text)
        self.assertEqual(report.json()["kind"], "x")
        self.assertEqual(report.json()["shift"]["status"], "open")
        self.assertEqual(
            self.client.get("/api/shifts/current", headers=self.headers).json()["id"], shift["id"]
        )

    def test_history_carries_totals(self) -> None:
        """История отдаёт показатели строкой, не заставляя ходить за каждой."""
        shift = self.open_shift(open_cash_tiyin=0)
        self.sell(70.0, "cash")
        self.client.post(
            f"/api/shifts/{shift['id']}/close",
            headers=self.headers,
            json={"counted_cash_tiyin": 7_000},
        )
        page = self.client.get(
            "/api/shifts/history", headers=self.headers, params={"limit": 5}
        ).json()
        row = next(item for item in page["items"] if item["id"] == shift["id"])
        self.assertEqual(row["cash_tiyin"], 7_000)
        self.assertEqual(row["revenue_tiyin"], 7_000)
        self.assertEqual(row["cashier"], "Айгуль")


if __name__ == "__main__":
    unittest.main()
