"""Сквозная проверка установки: мастер → база → чтение реквизитов.

Поднимается настоящее приложение на временной базе и проходится тот же путь,
что проходит касса при первом запуске: подтверждение лицензии, отправка
реквизитов мастером, чтение их обратно экраном настроек.

Проверяется главное, что легко сломать незаметно: картинки уходят в свою
таблицу, но возвращаются интерфейсу там же, где он их ждёт, а строка настроек
больше не таскает мегабайты base64.

Запуск: python -m unittest discover -s tests (из каталога backend).
"""

from __future__ import annotations

import base64
import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from api_fixture import (  # noqa: E402
    DB_PATH as _TEMP_DB,
    OWNER_EMAIL,
    OWNER_PASSWORD,
    SERVICE_KEY,
    auth_headers,
    client,
    ensure_setup,
)

# Однопиксельные картинки: содержимое неважно, важен путь, которым они ходят.
PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n-ui").decode()
WORDMARK_PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n-wordmark").decode()
COMBINED_PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n-combined").decode()
RECEIPT_PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n-receipt").decode()
QR_JPEG = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff-qr").decode()


def onboarding_payload() -> dict:
    return {
        "fiscalMode": "simple",
        "edition": "standard",
        "company": {"shortName": "Магазин Бимар"},
        "outlet": {"city": "Бишкек", "street": "Чуй 1"},
        "contacts": {"phone": "+996555123456"},
        "owner": {"firstName": "Иван", "lastName": "Петров", "email": "owner@example.kg"},
        "acquiring": {
            "methods": ["cash", "qr"],
            "providers": [
                {
                    "id": "qr-static-1",
                    "kind": "qr-static",
                    "title": "QR банка",
                    "enabled": True,
                    "imageDataUrl": QR_JPEG,
                }
            ],
        },
        "branding": {
            "useFactoryBrand": False,
            "mode": "image",
            "headerLayout": "mark_left",
            "logoShape": "circle",
            "logo": PNG,
            "logoMark": PNG,
            "logoWordmark": WORDMARK_PNG,
            "logoCombined": COMBINED_PNG,
            "logoVariants": {"s512": PNG, "s128": PNG, "s64": PNG, "receipt": PNG},
            "receiptLogoFile": RECEIPT_PNG,
            "receiptLogoMark": RECEIPT_PNG,
            "receiptLogoVariants": {"w384": RECEIPT_PNG, "w288": RECEIPT_PNG},
            "receiptLogoShape": "circle",
        },
    }


class SetupFlow(unittest.TestCase):
    """Путь установки целиком, на живом приложении."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        # Установка выполняется здесь же, если её ещё не делал соседний набор
        # тестов: приложение и база в процессе одни на всех.
        cls.token = ensure_setup(onboarding=onboarding_payload(), edition="standard")
        cls.init_body = {
            "onboarding": cls.client.get(
                "/api/settings/store", headers=auth_headers(cls.token)
            ).json()["onboarding"]
        }

    def setUp(self) -> None:
        # Правка реквизитов живёт за дверью специалиста, а тесты этого набора
        # правят их постоянно: открываем её перед каждым.
        opened = self.client.post(
            "/api/auth/access/unlock",
            headers=auth_headers(self.token),
            json={"secret": SERVICE_KEY},
        )
        self.assertEqual(opened.status_code, 200, opened.text)

    def read_store(self) -> dict:
        response = self.client.get(
            "/api/settings/store", headers=auth_headers(self.token)
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_setup_returns_images_back(self) -> None:
        branding = self.init_body["onboarding"]["branding"]
        self.assertEqual(branding["logoMark"], PNG)
        self.assertEqual(branding["receiptLogoFile"], RECEIPT_PNG)
        self.assertEqual(branding["logoVariants"]["s128"], PNG)

    def test_header_pictures_survive_the_round_trip(self) -> None:
        """Три картинки шапки не смешиваются между собой по дороге в базу."""
        branding = self.read_store()["onboarding"]["branding"]
        self.assertEqual(branding["logoMark"], PNG)
        self.assertEqual(branding["logoWordmark"], WORDMARK_PNG)
        self.assertEqual(branding["logoCombined"], COMBINED_PNG)

    def test_settings_read_returns_same_images(self) -> None:
        data = self.read_store()["onboarding"]
        self.assertEqual(data["branding"]["logoMark"], PNG)
        self.assertEqual(data["branding"]["receiptLogoVariants"]["w384"], RECEIPT_PNG)
        provider = data["acquiring"]["providers"][0]
        self.assertEqual(provider["imageDataUrl"], QR_JPEG)

    def test_tariff_and_look_persisted(self) -> None:
        body = self.read_store()
        self.assertEqual(body["edition"], "standard")
        self.assertEqual(body["onboarding"]["edition"], "standard")
        self.assertEqual(body["onboarding"]["branding"]["headerLayout"], "mark_left")
        self.assertEqual(body["onboarding"]["branding"]["logoShape"], "circle")
        self.assertEqual(body["onboarding"]["branding"]["receiptLogoShape"], "circle")

    def test_phone_stored_normalized(self) -> None:
        self.assertEqual(self.read_store()["onboarding"]["contacts"]["phone"], "+996555123456")

    def test_images_live_in_their_own_table(self) -> None:
        """Строка настроек — не хранилище картинок."""
        con = sqlite3.connect(_TEMP_DB)
        try:
            columns = con.execute(
                "SELECT logo_image, logo_mark, receipt_logo_file, payment_providers"
                " FROM store_settings"
            ).fetchone()
            images = con.execute("SELECT kind, slot FROM store_images ORDER BY kind, slot").fetchall()
        finally:
            con.close()

        logo_image, logo_mark, receipt_file, providers = columns
        self.assertEqual(logo_image, "")
        self.assertEqual(logo_mark, "")
        self.assertEqual(receipt_file, "")
        self.assertNotIn("imageDataUrl", providers)

        self.assertIn(("logo_ui", "mark"), images)
        self.assertIn(("logo_receipt", "file"), images)
        self.assertIn(("qr", "qr-static-1"), images)

    def test_update_replaces_image_without_leaving_the_old_one(self) -> None:
        data = self.read_store()["onboarding"]
        data["branding"]["logoMark"] = RECEIPT_PNG
        response = self.client.patch(
            "/api/settings/store",
            headers=auth_headers(self.token),
            json={"onboarding": data},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.read_store()["onboarding"]["branding"]["logoMark"], RECEIPT_PNG)

        con = sqlite3.connect(_TEMP_DB)
        try:
            rows = con.execute(
                "SELECT COUNT(*) FROM store_images WHERE kind = 'logo_ui' AND slot = 'mark'"
            ).fetchone()[0]
        finally:
            con.close()
        # Один слот — одна картинка: замена не должна плодить строки.
        self.assertEqual(rows, 1)

    def test_rejects_unknown_edition_over_api(self) -> None:
        response = self.client.patch(
            "/api/settings/store",
            headers=auth_headers(self.token),
            json={"edition": "premium"},
        )
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
