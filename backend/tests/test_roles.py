"""Матрица прав: кто куда не проходит.

Главное свойство, которое здесь проверяется: скрытый пункт меню — не защита.
Запрос уходит прямо на маршрут, минуя интерфейс, и должен получить отказ.

Роль аккаунта в этих тестах всё время одна и та же — владелец: именно его email
является логином установки, и на кассе залогинен он. Разницу делает не роль, а
повышенная сессия, полученная секретом (см. core/elevation.py). Поэтому «кассир»
ниже — это состояние без повышения, а не отдельный аккаунт.

Запуск: python -m unittest discover -s tests (из каталога backend).
"""

from __future__ import annotations

import sys
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from api_fixture import (  # noqa: E402
    OWNER_CABINET_PASSWORD,
    OWNER_PASSWORD,
    SERVICE_KEY,
    auth_headers,
    client,
    ensure_setup,
)

from app.core.elevation import (  # noqa: E402
    DOOR_OWNER,
    DOOR_SPECIALIST,
    ELEVATION_IDLE_MINUTES,
    registry,
)

# Маршруты, на которые кассир не имеет права. Метод, адрес и тело — ровно то,
# что ушло бы из интерфейса, если бы кнопку кто-то нашёл.
CASHIER_FORBIDDEN = [
    ("GET", "/api/finance/summary", None),
    ("GET", "/api/finance/expenses", None),
    ("POST", "/api/finance/expenses", {"category_id": 1, "amount": 100, "comment": ""}),
    ("GET", "/api/analytics/summary", None),
    ("GET", "/api/analytics/daily", None),
    ("GET", "/api/users", None),
    ("DELETE", "/api/users/2", {"password": OWNER_PASSWORD}),
    ("PATCH", "/api/settings/store", {"onboarding": None}),
    ("GET", "/api/payments/providers/secrets", None),
    ("PUT", "/api/payments/providers/qr-1/secret", {"api_key": "x"}),
    ("GET", "/api/diagnostics/export-db", None),
    ("POST", "/api/diagnostics/backups", None),
    ("POST", "/api/setup/factory-reset", {"password": OWNER_PASSWORD}),
    ("GET", "/api/payments/manual-confirmations", None),
]

# Диагностика, доступная кассиру: смотреть можно, менять нельзя.
CASHIER_ALLOWED = [
    ("GET", "/api/diagnostics/info", None),
    ("GET", "/api/settings/store", None),
    ("GET", "/api/settings/capabilities", None),
]


class RoleMatrix(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        cls.token = ensure_setup()
        cls.headers = auth_headers(cls.token)
        cls.user_id = cls.client.get("/api/auth/me", headers=cls.headers).json()["id"]

    def setUp(self) -> None:
        # Каждый тест начинается кассиром: повышения снимаются.
        registry.revoke(self.user_id)

    def call(self, method: str, url: str, body: dict | None):
        return self.client.request(method, url, headers=self.headers, json=body)

    def open_owner(self) -> None:
        # Пароль владельца, а не пароль входа: это разные секреты и разные
        # двери. Пароль учётной записи не открывает здесь ничего.
        response = self.client.post(
            "/api/auth/access/unlock", headers=self.headers, json={"secret": OWNER_CABINET_PASSWORD}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["door"], "owner")

    def open_specialist(self) -> None:
        response = self.client.post(
            "/api/auth/access/unlock", headers=self.headers, json={"secret": SERVICE_KEY}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["door"], "specialist")

    def test_cashier_is_denied_everywhere(self) -> None:
        for method, url, body in CASHIER_FORBIDDEN:
            with self.subTest(route=f"{method} {url}"):
                response = self.call(method, url, body)
                self.assertEqual(response.status_code, 403, f"{method} {url}: {response.text}")

    def test_denial_does_not_hint_at_the_section(self) -> None:
        """Отказ одинаковый и молчит о том, чем закрыт раздел."""
        detail = self.call("GET", "/api/finance/summary", None).json()["detail"]
        self.assertEqual(detail, "Недостаточно прав.")
        for word in ("пароль", "ключ", "владелец", "специалист"):
            self.assertNotIn(word, detail.lower())

    def test_cashier_keeps_reading_diagnostics(self) -> None:
        for method, url, body in CASHIER_ALLOWED:
            with self.subTest(route=f"{method} {url}"):
                self.assertEqual(self.call(method, url, body).status_code, 200)

    def test_owner_door_opens_money_but_not_equipment(self) -> None:
        self.open_owner()
        self.assertEqual(self.call("GET", "/api/finance/summary", None).status_code, 200)
        self.assertEqual(self.call("GET", "/api/analytics/summary", None).status_code, 200)
        self.assertEqual(self.call("GET", "/api/users", None).status_code, 200)
        # Техника — не его дверь. Реквизиты при этом открыты по полям: свои
        # менять можно, оборудование нет (см. отдельные тесты ниже).
        self.assertEqual(self.call("GET", "/api/payments/providers/secrets", None).status_code, 403)

    def test_specialist_door_opens_equipment_but_not_money(self) -> None:
        self.open_specialist()
        self.assertEqual(self.call("GET", "/api/payments/providers/secrets", None).status_code, 200)
        # Финансы и удаление аккаунта — не его дверь.
        self.assertEqual(self.call("GET", "/api/finance/summary", None).status_code, 403)
        self.assertEqual(self.call("GET", "/api/analytics/summary", None).status_code, 403)
        self.assertEqual(
            self.call("POST", "/api/setup/factory-reset", {"password": OWNER_PASSWORD}).status_code,
            403,
        )

    def test_specialist_session_expires_by_idle(self) -> None:
        self.open_specialist()
        self.assertEqual(self.call("GET", "/api/payments/providers/secrets", None).status_code, 200)
        # Отматываем время вперёд на срок бездействия: ждать десять минут в
        # тесте нечестно по отношению к тому, кто его запускает.
        registry.grant(
            self.user_id,
            DOOR_SPECIALIST,
            0,
            now=datetime.now(UTC) - timedelta(minutes=ELEVATION_IDLE_MINUTES + 1),
        )
        self.assertEqual(self.call("GET", "/api/payments/providers/secrets", None).status_code, 403)

    def test_activity_extends_the_session(self) -> None:
        """Пока специалист работает, дверь не захлопывается у него за спиной."""
        self.open_specialist()
        registry.grant(
            self.user_id,
            DOOR_SPECIALIST,
            ELEVATION_IDLE_MINUTES,
            now=datetime.now(UTC) - timedelta(minutes=ELEVATION_IDLE_MINUTES - 1),
        )
        # Запрос проходит и продлевает окно…
        self.assertEqual(self.call("GET", "/api/payments/providers/secrets", None).status_code, 200)
        # …поэтому следующий, сделанный сразу, тоже проходит.
        self.assertEqual(self.call("GET", "/api/payments/providers/secrets", None).status_code, 200)

    def test_leaving_closes_both_doors(self) -> None:
        self.open_owner()
        self.open_specialist()
        state = self.client.get("/api/auth/access/state", headers=self.headers).json()
        self.assertCountEqual(state["doors"], [DOOR_OWNER, DOOR_SPECIALIST])

        left = self.client.post("/api/auth/access/leave", headers=self.headers)
        self.assertEqual(left.status_code, 200)
        after = self.client.get("/api/auth/access/state", headers=self.headers).json()
        self.assertEqual(after["doors"], [])
        self.assertEqual(self.call("GET", "/api/finance/summary", None).status_code, 403)

    # --- Разделение реквизитов по полям --------------------------------- #

    def read_onboarding(self) -> dict:
        response = self.client.get("/api/settings/store", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["onboarding"]

    def patch_onboarding(self, data: dict):
        return self.client.patch(
            "/api/settings/store", headers=self.headers, json={"onboarding": data}
        )

    def test_owner_changes_business_requisites(self) -> None:
        """Переезд и новый номер не должны ждать приезда установщика."""
        self.open_owner()
        data = self.read_onboarding()
        data["contacts"]["phone"] = "+996700111222"
        data["outlet"]["city"] = "Ош"
        response = self.patch_onboarding(data)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.read_onboarding()["contacts"]["phone"], "+996700111222")

    def test_owner_cannot_touch_equipment_fields(self) -> None:
        self.open_owner()
        data = self.read_onboarding()
        data["branding"]["receiptRollWidth"] = "58" if data["branding"]["receiptRollWidth"] == "80" else "80"
        response = self.patch_onboarding(data)
        self.assertEqual(response.status_code, 403, response.text)
        # Отказ называет, что именно не прошло: молча проигнорировать правку
        # хуже — человек уйдёт уверенным, что сохранил.
        self.assertIn("специалист", response.json()["detail"])

    def test_owner_cannot_replace_logo(self) -> None:
        self.open_owner()
        data = self.read_onboarding()
        data["branding"]["logoMark"] = "data:image/png;base64,iVBORw0KGgo="
        self.assertEqual(self.patch_onboarding(data).status_code, 403)

    def test_specialist_changes_equipment(self) -> None:
        self.open_specialist()
        data = self.read_onboarding()
        data["branding"]["receiptRollWidth"] = "58" if data["branding"]["receiptRollWidth"] == "80" else "80"
        self.assertEqual(self.patch_onboarding(data).status_code, 200)

    def test_specialist_cannot_touch_business_requisites(self) -> None:
        self.open_specialist()
        data = self.read_onboarding()
        data["contacts"]["phone"] = "+996700333444"
        response = self.patch_onboarding(data)
        self.assertEqual(response.status_code, 403, response.text)

    def test_unchanged_fields_do_not_trigger_denial(self) -> None:
        """Форма присылает объект целиком — это не попытка правки."""
        self.open_owner()
        # Ничего не меняем: техника в запросе есть, но она та же самая.
        self.assertEqual(self.patch_onboarding(self.read_onboarding()).status_code, 200)

    def test_both_doors_open_allow_everything(self) -> None:
        self.open_owner()
        self.open_specialist()
        data = self.read_onboarding()
        data["contacts"]["phone"] = "+996700555666"
        data["branding"]["receiptLogoThreshold"] = 180
        self.assertEqual(self.patch_onboarding(data).status_code, 200)

    def test_state_does_not_extend_the_session(self) -> None:
        """Плашка опрашивает состояние по таймеру и не должна продлевать сессию."""
        self.open_owner()
        registry.grant(
            self.user_id,
            DOOR_OWNER,
            ELEVATION_IDLE_MINUTES,
            now=datetime.now(UTC) - timedelta(minutes=ELEVATION_IDLE_MINUTES - 1),
        )
        before = self.client.get("/api/auth/access/state", headers=self.headers).json()
        after = self.client.get("/api/auth/access/state", headers=self.headers).json()
        self.assertLessEqual(after["expires_in_seconds"], before["expires_in_seconds"])


if __name__ == "__main__":
    unittest.main()
