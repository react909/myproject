"""Журнал чеков панели: фильтры, порции и показатели — на сервере.

Главное, что здесь проверяется: показатели считаются по ТОЙ ЖЕ выборке, что и
список. Пока журнал фильтровался на фронте, сумма над таблицей относилась не к
фильтру, а к тому, что успело приехать, — и заметить это можно было только
сложив столбец вручную.

Запуск: python -m unittest discover -s tests (из каталога backend).
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from api_fixture import auth_headers, client, ensure_setup, ensure_shift  # noqa: E402


class PanelJournal(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        cls.headers = auth_headers(ensure_setup())
        # Продажа без открытой смены больше не проходит — см. ensure_shift.
        ensure_shift(cls.headers)
        cls.sold: list[dict] = []
        # Три продажи с разными суммами и способами оплаты: одной мало, чтобы
        # отличить «фильтр работает» от «фильтр не применился вовсе».
        for index, (total, method) in enumerate(
            ((100.0, "cash"), (250.0, "card"), (400.0, "cash")), start=1
        ):
            response = cls.client.post(
                "/api/sales",
                headers=cls.headers,
                json={
                    "items": [
                        {
                            "name": f"Тестовый товар {index}",
                            "quantity": 1,
                            "unit_price": total,
                            "line_total": total,
                        }
                    ],
                    "payment_method": method,
                    "subtotal": total,
                    "total": total,
                    "cash_received": total if method == "cash" else 0,
                    "card_amount": total if method == "card" else 0,
                },
            )
            assert response.status_code == 201, response.text
            cls.sold.append(response.json())

    def receipts(self, **params) -> dict:
        response = self.client.get("/api/panel/receipts", headers=self.headers, params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def summary(self, **params) -> dict:
        response = self.client.get(
            "/api/panel/receipts/summary", headers=self.headers, params=params
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    # -- доступ -------------------------------------------------------------- #

    def test_journal_requires_authorisation(self) -> None:
        """Журнал чеков нельзя прочитать прямым запросом без токена."""
        for path in (
            "/api/panel/receipts",
            "/api/panel/receipts/summary",
            "/api/panel/cashiers",
        ):
            response = self.client.get(path)
            self.assertIn(response.status_code, (401, 403), f"{path}: {response.text}")

    # -- порции -------------------------------------------------------------- #

    def test_list_comes_in_pages_with_a_cursor(self) -> None:
        """Весь журнал одним ответом не отдаётся ни при каких параметрах."""
        first = self.receipts(limit=2)
        self.assertEqual(len(first["rows"]), 2)
        self.assertIsNotNone(first["next_cursor"])

        second = self.receipts(limit=2, cursor=first["next_cursor"])
        # Страницы не пересекаются: порядок доопределён по id, и чек не может
        # попасть в обе или потеряться между ними.
        first_ids = {row["id"] for row in first["rows"]}
        second_ids = {row["id"] for row in second["rows"]}
        self.assertFalse(first_ids & second_ids, "страницы пересеклись")

    def test_page_size_has_a_hard_ceiling(self) -> None:
        """Попросить весь журнал одним ответом нельзя."""
        response = self.client.get(
            "/api/panel/receipts", headers=self.headers, params={"limit": 100_000}
        )
        self.assertEqual(response.status_code, 422, response.text)

    def test_rows_carry_no_items(self) -> None:
        """Позиции в списке не приезжают — только в карточке чека.

        На странице в полсотни чеков это сотни лишних строк в каждом ответе,
        которых таблица всё равно не показывает.
        """
        rows = self.receipts(limit=1)["rows"]
        self.assertNotIn("items", rows[0])

        details = self.client.get(
            f"/api/panel/receipts/{rows[0]['id']}", headers=self.headers
        )
        self.assertEqual(details.status_code, 200, details.text)
        self.assertTrue(details.json()["items"], "в карточке чека нет позиций")

    # -- фильтры ------------------------------------------------------------- #

    def test_filter_by_payment_method_applies_to_list_and_summary(self) -> None:
        """Список и показатели считаются по одной выборке.

        Это и есть смысл серверной фильтрации: раньше таблица показывала одно,
        а сумма над ней относилась к другому набору чеков.
        """
        rows = self.receipts(payment_method="card", limit=200)["rows"]
        self.assertTrue(rows, "чеки по карте не нашлись")
        self.assertTrue(all(row["payment_method"] == "card" for row in rows))

        totals = self.summary(payment_method="card")
        self.assertEqual(totals["receipts_count"], len(rows))
        self.assertAlmostEqual(totals["revenue"], sum(row["total"] for row in rows), places=2)

    def test_filter_by_document_number_finds_one_receipt(self) -> None:
        target = self.sold[1]
        rows = self.receipts(doc_number=str(target["doc_number"]))["rows"]
        self.assertEqual(len(rows), 1, rows)
        self.assertEqual(rows[0]["doc_number"], target["doc_number"])

    def test_filter_by_product_matches_the_receipt_items(self) -> None:
        """Фильтр по товару смотрит в позиции чека, а не в его поля."""
        rows = self.receipts(product="Тестовый товар 2", limit=200)["rows"]
        self.assertEqual(len(rows), 1, rows)
        self.assertEqual(rows[0]["doc_number"], self.sold[1]["doc_number"])

    def test_letters_in_the_number_field_find_nothing(self) -> None:
        """Буквы в поле номера не должны показывать весь журнал.

        Прежний список молча игнорировал негодное значение и отдавал всё
        подряд — человек видел чужие чеки и считал, что фильтр не работает.
        """
        self.assertEqual(self.receipts(doc_number="абв")["rows"], [])

    def test_broken_date_is_refused_instead_of_ignored(self) -> None:
        response = self.client.get(
            "/api/panel/receipts", headers=self.headers, params={"date_from": "вчера"}
        )
        self.assertEqual(response.status_code, 422, response.text)

    def test_unknown_status_is_refused(self) -> None:
        response = self.client.get(
            "/api/panel/receipts", headers=self.headers, params={"status": "выдуманный"}
        )
        self.assertEqual(response.status_code, 422, response.text)

    # -- показатели ---------------------------------------------------------- #

    def test_summary_counts_revenue_and_average(self) -> None:
        totals = self.summary()
        rows = self.receipts(limit=200)["rows"]
        paid = [row for row in rows if row["status"] in ("paid", "debt")]

        self.assertEqual(totals["receipts_count"], len(rows))
        self.assertAlmostEqual(totals["revenue"], sum(row["total"] for row in paid), places=2)
        self.assertAlmostEqual(
            totals["avg_check"], sum(row["total"] for row in paid) / len(paid), places=2
        )

    def test_panel_has_no_owner_money(self) -> None:
        """В ответах панели нет ни прибыли, ни себестоимости.

        Они принадлежат кабинету владельца. Проверка на составе ответа, а не на
        интерфейсе: спрятать поле показом — значит всё равно привезти его в
        браузер кассира.
        """
        forbidden = {"profit", "cost", "cost_price", "margin"}
        self.assertFalse(forbidden & set(self.summary()))
        self.assertFalse(forbidden & set(self.receipts(limit=1)["rows"][0]))

    def test_refund_moves_its_amount_into_the_refunds_figure(self) -> None:
        """Полный возврат прибавляет сумму чека к «Возвратам» и убирает её из выручки.

        Ошибка, ради которой написана проверка: возврат в кассе не заводит
        отдельной записи на сумму, он уменьшает `total` самого чека — до нуля
        при полном возврате. Показатель складывал `total` возвращённых чеков и
        поэтому прибавлял нули: после настоящего возврата плитка «Возвраты» не
        двигалась ни на копейку, а сходилось это только с ручным пересчётом.
        """
        sale = self.client.post(
            "/api/sales",
            headers=self.headers,
            json={
                "items": [
                    {
                        "name": "Товар под возврат",
                        "quantity": 2,
                        "unit_price": 300.0,
                        "line_total": 600.0,
                    }
                ],
                "payment_method": "cash",
                "subtotal": 600.0,
                "total": 600.0,
                "cash_received": 600.0,
            },
        ).json()

        before = self.summary()
        refund = self.client.post(
            f"/api/sales/{sale['id']}/refund",
            headers=self.headers,
            json={
                "items": [{"sale_item_id": sale["items"][0]["id"], "quantity": 2}],
                "note": "проверка показателя",
            },
        )
        self.assertEqual(refund.status_code, 200, refund.text)
        self.assertEqual(refund.json()["status"], "refunded")
        after = self.summary()

        self.assertAlmostEqual(after["refunds"] - before["refunds"], 600.0, places=2)
        self.assertAlmostEqual(before["revenue"] - after["revenue"], 600.0, places=2)

    def test_partial_refund_counts_only_what_came_back(self) -> None:
        """Частичный возврат прибавляет возвращённую часть, а не остаток чека.

        Обратная половина той же ошибки: складывая `total`, показатель на
        частичном возврате прибавлял то, что покупатель ОСТАВИЛ себе.
        """
        sale = self.client.post(
            "/api/sales",
            headers=self.headers,
            json={
                "items": [
                    {
                        "name": "Товар под частичный возврат",
                        "quantity": 4,
                        "unit_price": 100.0,
                        "line_total": 400.0,
                    }
                ],
                "payment_method": "cash",
                "subtotal": 400.0,
                "total": 400.0,
                "cash_received": 400.0,
            },
        ).json()

        before = self.summary()
        refund = self.client.post(
            f"/api/sales/{sale['id']}/refund",
            headers=self.headers,
            json={
                "items": [{"sale_item_id": sale["items"][0]["id"], "quantity": 1}],
                "note": "вернули одну штуку",
            },
        )
        self.assertEqual(refund.status_code, 200, refund.text)
        self.assertEqual(refund.json()["status"], "partial_refund")
        after = self.summary()

        # Вернули одну штуку из четырёх — сто, а не оставшиеся триста.
        self.assertAlmostEqual(after["refunds"] - before["refunds"], 100.0, places=2)

    def test_export_gives_every_receipt_exactly_once(self) -> None:
        """Выгрузка на нескольких порциях: без повторов и без пропусков.

        Ошибка, ради которой написана проверка: порции шли по паре
        «время, номер», а курсор сравнивал ОДИН номер. Пока время и номера
        растут вместе, это совпадает; стоит им разойтись — и после первой порции
        условие отсекает не то, что уже отдано. На двух тысячах чеков выгрузка
        давала 3916 строк вместо 2000.

        Время здесь намеренно перемешано относительно номеров: на данных, где
        они согласованы, прежний код проходит проверку и ошибку не видно.
        Порция уменьшена до двух, иначе стыка между порциями просто не будет.
        """
        import os
        import sqlite3

        from app.modules.panel import repository

        marker = "Позиция для выгрузки"
        created: list[int] = []
        for index in range(5):
            response = self.client.post(
                "/api/sales",
                headers=self.headers,
                json={
                    "items": [
                        {
                            "name": marker,
                            "quantity": 1,
                            "unit_price": 10.0 + index,
                            "line_total": 10.0 + index,
                        }
                    ],
                    "payment_method": "cash",
                    "subtotal": 10.0 + index,
                    "total": 10.0 + index,
                    "cash_received": 10.0 + index,
                },
            )
            self.assertEqual(response.status_code, 201, response.text)
            created.append(response.json()["id"])

        # Время вразнобой: пятый чек оказывается самым старым, первый — самым
        # новым, и порядок по времени перестаёт совпадать с порядком по номеру.
        shuffle = ["2026-03-05 10:00:00", "2026-03-01 10:00:00", "2026-03-04 10:00:00",
                   "2026-03-02 10:00:00", "2026-03-03 10:00:00"]
        db = sqlite3.connect(os.environ["SQLITE_PATH"])
        try:
            for sale_id, moment in zip(created, shuffle):
                db.execute("UPDATE sales SET created_at = ? WHERE id = ?", (moment, sale_id))
            db.commit()
        finally:
            db.close()

        was = repository.EXPORT_CHUNK
        repository.EXPORT_CHUNK = 2
        try:
            response = self.client.get(
                "/api/panel/receipts/export",
                headers=self.headers,
                params={"product": marker},
            )
            self.assertEqual(response.status_code, 200, response.text)
            body = response.content.decode("utf-8-sig")
        finally:
            repository.EXPORT_CHUNK = was

        # Первая строка — «sep=;» для Excel, вторая — заголовки.
        rows = [line for line in body.split("\r\n")[2:] if line]
        numbers = [line.split(";")[0] for line in rows]

        self.assertEqual(len(numbers), len(set(numbers)), f"чеки повторились: {numbers}")
        self.assertEqual(len(numbers), len(created), f"чеков в файле {len(numbers)}, ждали {len(created)}")

    def test_export_carries_the_current_filters(self) -> None:
        """В файл попадает то же, что видно в журнале, а не весь журнал."""
        everything = self.client.get("/api/panel/receipts/export", headers=self.headers)
        card = self.client.get(
            "/api/panel/receipts/export", headers=self.headers, params={"payment_method": "card"}
        )
        self.assertEqual(card.status_code, 200, card.text)

        rows = [line for line in card.content.decode("utf-8-sig").split("\r\n")[2:] if line]
        self.assertTrue(rows, "по карте не выгрузилось ни одного чека")
        # Столбец «Оплата» — шестой; во всех строках он обязан быть одним и тем же.
        self.assertEqual({line.split(";")[5] for line in rows}, {"Карта"})
        self.assertLess(len(card.content), len(everything.content))

        totals = self.summary(payment_method="card")
        self.assertEqual(len(rows), totals["receipts_count"])

    def test_cashiers_come_from_the_database(self) -> None:
        response = self.client.get("/api/panel/cashiers", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsInstance(response.json(), list)
