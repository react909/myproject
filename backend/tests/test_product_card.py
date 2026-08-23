"""Карточка товара: услуги, комплекты, штрихкод, фото и видео.

Что здесь проверяется по существу:

* комплект списывает СОСТАВЛЯЮЩИЕ, а возврат возвращает их же;
* комплект, которому не хватает составляющей, НЕ ПРОДАЁТСЯ, и отказ называет,
  чего именно не хватило, — вместо ухода остатков в минус сразу у нескольких
  товаров;
* комплект с выведенной составляющей не продаётся отдельно от нехватки;
* цена комплекта в режиме «сумма» живая: подорожала составляющая — подорожал
  комплект;
* штрихкод уникален на уровне базы, а «нет штрихкода» — это всегда пустая
  строка, сколько бы таких товаров ни было;
* повторная отправка формы не создаёт дубль;
* сервер не верит тому, что ему сказали про файл: проверяются сигнатура,
  размер в байтах и размер в точках.

Запуск: python -m unittest discover -s tests (из каталога backend).
"""

from __future__ import annotations

import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from api_fixture import auth_headers, client, ensure_setup, ensure_shift  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.modules.products import media as media_store  # noqa: E402


def png_header(width: int, height: int) -> bytes:
    """PNG, у которого настоящий только заголовок.

    Этого достаточно и это честно: проверка на сервере читает ровно заголовок
    и ничего не декодирует — декодирование потребовало бы Pillow, которого мы
    намеренно не тащим. Тест проверяет то, что код действительно делает.
    """
    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + struct.pack(">II", width, height)
        + b"\x08\x06\x00\x00\x00"
        + b"\x00" * 8
    )


def jpeg_header(width: int, height: int) -> bytes:
    """JPEG с одним маркером SOF0 — тем, из которого читаются размеры."""
    return (
        b"\xff\xd8"
        + b"\xff\xc0"
        + struct.pack(">H", 17)
        + b"\x08"
        + struct.pack(">HH", height, width)
        + b"\x03\x01\x11\x00\x02\x11\x01\x03\x11\x01"
    )


class BundleAndCard(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        cls.headers = auth_headers(ensure_setup())
        ensure_shift(cls.headers)

    # ── помощники ────────────────────────────────────────────────────────────

    def card(self, **over) -> dict:
        body = {
            "kind": "piece",
            "name": "Товар",
            "price_tiyin": 10_000,
            "cost_tiyin": 6_000,
            "stock_qty": 0,
        }
        body.update(over)
        response = self.client.post("/api/products/card", headers=self.headers, json=body)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def product(self, product_id: int) -> dict:
        response = self.client.get(f"/api/products/{product_id}", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def sell(self, product_id: int, name: str, qty: float, price: float):
        return self.client.post(
            "/api/sales",
            headers=self.headers,
            json={
                "items": [
                    {
                        "product_id": product_id,
                        "name": name,
                        "quantity": qty,
                        "unit_price": price,
                        "line_total": price * qty,
                    }
                ],
                "payment_method": "cash",
                "subtotal": price * qty,
                "total": price * qty,
                "cash_received": price * qty,
            },
        )

    # ── комплект ─────────────────────────────────────────────────────────────

    def test_bundle_sale_writes_off_components(self) -> None:
        """Продажа комплекта списывает составляющие, а не сам комплект."""
        tea = self.card(name="Чай в стакане", stock_qty=50, price_tiyin=4_000)
        bun = self.card(name="Пирожок", stock_qty=30, price_tiyin=6_000)
        combo = self.card(
            kind="bundle",
            name="Чай + пирожок",
            price_tiyin=9_000,
            bundle=[
                {"product_id": tea["id"], "qty": 1},
                {"product_id": bun["id"], "qty": 2},
            ],
        )
        self.assertEqual(combo["kind"], "bundle")
        # Своего остатка у комплекта нет — есть «сколько можно собрать».
        self.assertEqual(combo["stock_qty"], 0)
        self.assertEqual(combo["available"], 15)  # пирожков хватает на 15

        sale = self.sell(combo["id"], "Чай + пирожок", 3, 90.0)
        self.assertEqual(sale.status_code, 201, sale.text)

        self.assertEqual(self.product(tea["id"])["stock_qty"], 47)
        self.assertEqual(self.product(bun["id"])["stock_qty"], 24)
        # Сам комплект остался нетронутым.
        self.assertEqual(self.product(combo["id"])["stock_qty"], 0)

    def test_bundle_refund_returns_components(self) -> None:
        """Возврат комплекта возвращает составляющие — зеркально продаже."""
        cup = self.card(name="Стакан", stock_qty=20, price_tiyin=1_000)
        lid = self.card(name="Крышка", stock_qty=20, price_tiyin=500)
        combo = self.card(
            kind="bundle",
            name="Стакан с крышкой",
            price_tiyin=1_500,
            bundle=[
                {"product_id": cup["id"], "qty": 1},
                {"product_id": lid["id"], "qty": 1},
            ],
        )
        sale = self.sell(combo["id"], "Стакан с крышкой", 4, 15.0).json()
        self.assertEqual(self.product(cup["id"])["stock_qty"], 16)

        refund = self.client.post(
            f"/api/sales/{sale['id']}/refund",
            headers=self.headers,
            json={"items": [{"sale_item_id": sale["items"][0]["id"], "quantity": 4}]},
        )
        self.assertEqual(refund.status_code, 200, refund.text)
        self.assertEqual(self.product(cup["id"])["stock_qty"], 20)
        self.assertEqual(self.product(lid["id"])["stock_qty"], 20)
        # И на складе не появилось комплектов, которых там быть не может.
        self.assertEqual(self.product(combo["id"])["stock_qty"], 0)

    def test_bundle_sale_refused_when_component_is_short(self) -> None:
        """Не хватает составляющей — отказ, а не минус на остатке.

        Проверяется и текст: кассир у очереди должен понять, чего не хватило,
        а не читать «недостаточно товара».
        """
        many = self.card(name="Много", stock_qty=100, price_tiyin=1_000)
        few = self.card(name="Мало", stock_qty=2, price_tiyin=1_000)
        combo = self.card(
            kind="bundle",
            name="Набор дефицитный",
            price_tiyin=3_000,
            bundle=[
                {"product_id": many["id"], "qty": 1},
                {"product_id": few["id"], "qty": 1},
            ],
        )
        response = self.sell(combo["id"], "Набор дефицитный", 5, 30.0)
        self.assertEqual(response.status_code, 409, response.text)
        detail = response.json()["detail"]
        self.assertIn("Мало", detail)
        self.assertIn("нужно 5", detail)
        self.assertIn("есть 2", detail)

        # ГЛАВНОЕ: остатки не тронуты — ни у одной составляющей.
        self.assertEqual(self.product(many["id"])["stock_qty"], 100)
        self.assertEqual(self.product(few["id"])["stock_qty"], 2)

    def test_bundle_with_archived_component_is_refused(self) -> None:
        """Составляющую вывели — комплект перестаёт продаваться и говорит почему."""
        alive = self.card(name="Живой товар", stock_qty=50, price_tiyin=1_000)
        doomed = self.card(name="Выведенный товар", stock_qty=50, price_tiyin=1_000)
        combo = self.card(
            kind="bundle",
            name="Набор с выведенным",
            price_tiyin=2_000,
            bundle=[
                {"product_id": alive["id"], "qty": 1},
                {"product_id": doomed["id"], "qty": 1},
            ],
        )
        removed = self.client.delete(f"/api/products/{doomed['id']}", headers=self.headers)
        self.assertEqual(removed.status_code, 204, removed.text)

        response = self.sell(combo["id"], "Набор с выведенным", 1, 20.0)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn("убран товар", response.json()["detail"])
        self.assertIn("Выведенный товар", response.json()["detail"])
        self.assertEqual(self.product(alive["id"])["stock_qty"], 50)

    def test_bundle_price_follows_components(self) -> None:
        """Режим «сумма составляющих»: цена живая, а не замороженная."""
        first = self.card(name="Первая часть", stock_qty=10, price_tiyin=3_000)
        second = self.card(name="Вторая часть", stock_qty=10, price_tiyin=2_000)
        combo = self.card(
            kind="bundle",
            name="Набор по сумме",
            bundle_price_mode="sum",
            price_tiyin=1,  # должно быть проигнорировано
            bundle=[
                {"product_id": first["id"], "qty": 2},
                {"product_id": second["id"], "qty": 1},
            ],
        )
        # 2×30 + 1×20 = 80 сом
        self.assertEqual(combo["price_tiyin"], 8_000)

        # Подорожала составляющая — подорожал комплект.
        bumped = self.client.patch(
            f"/api/products/{first['id']}", headers=self.headers, json={"price": 40.0}
        )
        self.assertEqual(bumped.status_code, 200, bumped.text)
        fresh = self.client.get(
            f"/api/products/{combo['id']}/card", headers=self.headers
        ).json()
        self.assertEqual(fresh["price_tiyin"], 10_000)  # 2×40 + 20

    def test_bundle_cannot_contain_bundle(self) -> None:
        """Вложенных комплектов нет: они дали бы рекурсию при списании."""
        part = self.card(name="Часть набора", stock_qty=5)
        inner = self.card(
            kind="bundle",
            name="Внутренний набор",
            bundle=[{"product_id": part["id"], "qty": 1}],
        )
        response = self.client.post(
            "/api/products/card",
            headers=self.headers,
            json={
                "kind": "bundle",
                "name": "Внешний набор",
                "price_tiyin": 100,
                "bundle": [{"product_id": inner["id"], "qty": 1}],
            },
        )
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("комплектов", response.json()["detail"])

    def test_bundle_without_composition_is_refused(self) -> None:
        response = self.client.post(
            "/api/products/card",
            headers=self.headers,
            json={"kind": "bundle", "name": "Пустой набор", "price_tiyin": 100},
        )
        self.assertEqual(response.status_code, 400, response.text)

    # ── услуга ───────────────────────────────────────────────────────────────

    def test_service_has_no_stock_and_is_not_written_off(self) -> None:
        service = self.card(kind="service", name="Заточка ножей", price_tiyin=15_000, stock_qty=99)
        self.assertEqual(service["stock_qty"], 0)
        self.assertEqual(service["unit"], "усл")

        sale = self.sell(service["id"], "Заточка ножей", 3, 150.0)
        self.assertEqual(sale.status_code, 201, sale.text)
        self.assertEqual(self.product(service["id"])["stock_qty"], 0)

    # ── штрихкод ─────────────────────────────────────────────────────────────

    def test_barcode_is_unique_and_owner_is_named(self) -> None:
        first = self.card(name="Первый с кодом", barcode="4600000000017")
        owner = self.client.get(
            "/api/products/barcode-owner",
            headers=self.headers,
            params={"barcode": "4600000000017"},
        ).json()
        self.assertEqual(owner["id"], first["id"])
        self.assertEqual(owner["name"], "Первый с кодом")

        second = self.client.post(
            "/api/products/card",
            headers=self.headers,
            json={"kind": "piece", "name": "Второй с тем же кодом", "barcode": "4600000000017"},
        )
        self.assertEqual(second.status_code, 409, second.text)
        self.assertIn("Первый с кодом", second.json()["detail"])

    def test_many_products_without_barcode(self) -> None:
        """«Нет штрихкода» — это пустая строка, и таких товаров сколько угодно.

        Ровно то, ради чего индекс частичный: обычный UNIQUE не дал бы завести
        второй товар без кода.
        """
        for index in range(4):
            created = self.card(name=f"Без кода {index}")
            self.assertEqual(created["barcode"], "")

    def test_extra_barcode_is_taken_too(self) -> None:
        """Код, занятый как дополнительный, тоже занят: сканер смотрит в оба."""
        self.card(name="С доп. кодами", barcode="4600000000024", extra_barcodes="777001,777002")
        response = self.client.post(
            "/api/products/card",
            headers=self.headers,
            json={"kind": "piece", "name": "Претендент", "barcode": "777002"},
        )
        self.assertEqual(response.status_code, 409, response.text)

    def test_client_token_prevents_double_submit(self) -> None:
        """Повторная отправка формы возвращает тот же товар, а не второй."""
        body = {
            "kind": "piece",
            "name": "Товар одной кнопки",
            "price_tiyin": 5_000,
            "client_token": "form-abc-123",
        }
        first = self.client.post("/api/products/card", headers=self.headers, json=body)
        self.assertEqual(first.status_code, 201, first.text)
        second = self.client.post("/api/products/card", headers=self.headers, json=body)
        self.assertEqual(second.status_code, 201, second.text)
        self.assertEqual(first.json()["id"], second.json()["id"])

        found = self.client.get(
            "/api/products/search", headers=self.headers, params={"q": "Товар одной кнопки"}
        ).json()
        self.assertEqual(found["total"], 1)


class MediaValidation(unittest.TestCase):
    """Сервер не верит тому, что ему сказали про файл."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        cls.headers = auth_headers(ensure_setup())

    def stage(self, payload: bytes, kind: str, mime: str, duration_ms: int = 0):
        return self.client.post(
            "/api/products/media/staged",
            headers={**self.headers, "Content-Type": "application/octet-stream"},
            params={"kind": kind, "mime": mime, "duration_ms": duration_ms},
            content=payload,
        )

    def test_real_png_and_jpeg_are_accepted(self) -> None:
        for payload, mime in ((png_header(800, 600), "image/png"), (jpeg_header(640, 480), "image/jpeg")):
            response = self.stage(payload, "photo", mime)
            self.assertEqual(response.status_code, 201, response.text)
            body = response.json()
            # Размеры взяты ИЗ ФАЙЛА, а не из запроса.
            self.assertIn(body["width"], (800, 640))
            self.assertIn(body["height"], (600, 480))

    def test_file_lying_about_its_type_is_refused(self) -> None:
        """Назвался картинкой — покажи сигнатуру."""
        response = self.stage(b"MZ\x90\x00" + b"\x00" * 200, "photo", "image/png")
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("не похож на изображение", response.json()["detail"])

    def test_png_declared_as_jpeg_is_refused(self) -> None:
        response = self.stage(png_header(100, 100), "photo", "image/jpeg")
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("на самом деле", response.json()["detail"])

    def test_huge_picture_is_refused(self) -> None:
        """Картинка 30 000 точек весит мало, а в памяти разворачивается в гигабайты."""
        response = self.stage(png_header(30_000, 30_000), "photo", "image/png")
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("точек по стороне", response.json()["detail"])

    def test_tiny_picture_is_refused(self) -> None:
        response = self.stage(png_header(2, 2), "photo", "image/png")
        self.assertEqual(response.status_code, 400, response.text)

    def test_oversized_photo_is_refused(self) -> None:
        payload = png_header(800, 600) + b"\x00" * (media_store.MAX_PHOTO_BYTES + 1)
        response = self.stage(payload, "photo", "image/png")
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("МБ", response.json()["detail"])

    def test_video_signature_is_checked(self) -> None:
        fake = self.stage(b"just text, not a video at all" * 10, "video", "video/mp4")
        self.assertEqual(fake.status_code, 400, fake.text)
        self.assertIn("не похож на видео", fake.json()["detail"])

        real = self.stage(b"\x00\x00\x00\x20ftypisom" + b"\x00" * 100, "video", "video/mp4")
        self.assertEqual(real.status_code, 201, real.text)

    def test_photo_is_attached_with_its_thumbnail(self) -> None:
        """Уменьшенная копия привязывается вместе со снимком.

        Это проверка настоящего пропуска: копия делалась интерфейсом, но на
        сервер не уходила, и в списках показывался бы ОРИГИНАЛ — двести
        килобайт на плитку вместо десяти. Заметить это по экрану нельзя:
        картинка та же, разница только в весе.
        """
        full = self.stage(png_header(1200, 900), "photo", "image/png").json()
        thumb = self.stage(png_header(240, 180), "photo", "image/png").json()

        created = self.client.post(
            "/api/products/card",
            headers=self.headers,
            json={
                "kind": "piece",
                "name": "Товар с фото",
                "price_tiyin": 10_000,
                "media_tokens": [{"token": full["token"], "thumb_token": thumb["token"]}],
            },
        )
        self.assertEqual(created.status_code, 201, created.text)
        media = created.json()["media"]
        self.assertEqual(len(media), 1)
        # Адрес уменьшенной копии отличается от адреса оригинала — значит она
        # действительно есть, а не подменена оригиналом.
        self.assertNotEqual(media[0]["thumb_url"], media[0]["url"])
        self.assertIn("thumb=1", media[0]["thumb_url"])

        # И оба файла отдаются.
        product_id = created.json()["id"]
        for suffix in ("", "?thumb=1"):
            response = self.client.get(
                f"/api/products/{product_id}/media/{media[0]['id']}{suffix}",
                headers=self.headers,
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertGreater(len(response.content), 0)

        # В списке отдаётся адрес именно копии.
        found = self.client.get(
            "/api/products/search", headers=self.headers, params={"q": "Товар с фото"}
        ).json()
        row = next(item for item in found["items"] if item["id"] == product_id)
        self.assertIn("thumb=1", row["thumb_url"])

    def test_declared_duration_over_limit_is_refused(self) -> None:
        """Длительность приходит от интерфейса — сервер её не измеряет.

        Сверка с потолком ловит честную ошибку, но не подделанный запрос. Тест
        фиксирует ровно это поведение, чтобы никто не рассчитывал на большее.
        """
        response = self.stage(
            b"\x00\x00\x00\x20ftypisom" + b"\x00" * 100,
            "video",
            "video/mp4",
            duration_ms=(media_store.MAX_VIDEO_SECONDS + 5) * 1000,
        )
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("длиннее", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
