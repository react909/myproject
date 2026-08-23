"""Разделение ролей: то, что нельзя обойти запросом мимо интерфейса.

Смысл набора — не «проверить, что кнопки спрятаны», а обратное: спрятанность
кнопок ничего не значит, и каждый закрытый маршрут обязан отвечать 403 на
прямой запрос. Экран настроек можно обойти, `curl` — нет.

Проверяется три вещи, и каждая ломается по-своему:

* **дверь целиком** — кассир без повышения не получает ни финансов, ни
  аналитики, ни сотрудников, ни правки реквизитов;
* **разделение по полям** — один и тот же PATCH пускает владельца к телефону и
  не пускает к ширине ленты, а специалиста наоборот. Это тот случай, где легко
  получить «тихо проигнорировали» вместо отказа;
* **окно бездействия** — повышение живёт десять минут и продлевается
  активностью, а «Выйти из режима» закрывает дверь сразу.

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

# Маршруты за дверью владельца: деньги магазина и сотрудники.
#
# Список нарочно шире одного эндпоинта на модуль: проверка у финансов и
# аналитики висит на маршрутизаторе целиком, и смысл теста — поймать день,
# когда её снимут ради «одного безобидного отчёта».
OWNER_ONLY_GET = [
    "/api/finance/summary",
    "/api/finance/expenses",
    "/api/analytics/summary",
    "/api/analytics/daily",
    "/api/analytics/products",
    "/api/users",
]


class RoleMatrix(unittest.TestCase):
    """Роль → раздел → операция, на живом приложении."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        cls.token = ensure_setup()
        cls.headers = auth_headers(cls.token)

    def setUp(self) -> None:
        # Каждый сценарий начинается с закрытых дверей: повышение живёт в
        # памяти процесса и иначе протекало бы из соседнего теста.
        registry.clear()

    # ── Вспомогательное ──────────────────────────────────────────────────

    def open_door(self, door: str) -> None:
        if door == DOOR_SPECIALIST:
            response = self.client.post(
                "/api/auth/service-key/unlock", headers=self.headers, json={"key": SERVICE_KEY}
            )
        else:
            # Пароль владельца — отдельный секрет; пароль входа эту дверь
            # не открывает.
            response = self.client.post(
                "/api/auth/owner/unlock",
                headers=self.headers,
                json={"password": OWNER_CABINET_PASSWORD},
            )
        self.assertEqual(response.status_code, 200, response.text)

    def store(self) -> dict:
        response = self.client.get("/api/settings/store", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["onboarding"]

    def patch_store(self, onboarding: dict):
        return self.client.patch(
            "/api/settings/store", headers=self.headers, json={"onboarding": onboarding}
        )

    # ── Кассир: дверей нет вообще ────────────────────────────────────────

    def test_cashier_gets_403_on_owner_sections(self) -> None:
        """Без открытой двери деньги и сотрудники не отдаются никак."""
        for path in OWNER_ONLY_GET:
            with self.subTest(path=path):
                response = self.client.get(path, headers=self.headers)
                self.assertEqual(response.status_code, 403, f"{path}: {response.text}")

    def test_cashier_cannot_touch_requisites(self) -> None:
        data = self.store()
        data["contacts"]["phone"] = "+996555000111"
        response = self.patch_store(data)
        self.assertEqual(response.status_code, 403, response.text)

    def test_refusal_says_nothing_about_the_section(self) -> None:
        """Отказ не подтверждает, что раздел существует и чем он закрыт."""
        detail = self.client.get("/api/finance/summary", headers=self.headers).json()["detail"]
        self.assertEqual(detail, "Недостаточно прав.")
        for leak in ("владел", "специалист", "пароль", "ключ", "PIN"):
            self.assertNotIn(leak.lower(), detail.lower())

    # ── Разделение одного PATCH по полям ─────────────────────────────────

    def test_owner_changes_business_text_but_not_equipment(self) -> None:
        """Телефон — да, ширина ленты — нет, и именно отказом, а не молчанием."""
        self.open_door(DOOR_OWNER)

        data = self.store()
        data["contacts"]["phone"] = "+996555222333"
        allowed = self.patch_store(data)
        self.assertEqual(allowed.status_code, 200, allowed.text)
        self.assertEqual(self.store()["contacts"]["phone"], "+996555222333")

        data = self.store()
        data["branding"]["receiptRollWidth"] = "58" if data["branding"]["receiptRollWidth"] == "80" else "80"
        refused = self.patch_store(data)
        self.assertEqual(refused.status_code, 403, refused.text)
        # Тихое игнорирование хуже отказа: человек уходит уверенным, что сохранил.
        self.assertIn("специалист", refused.json()["detail"].lower())

    def test_specialist_changes_equipment_but_not_business_text(self) -> None:
        """Зеркальный случай: ширина ленты — да, телефон — нет."""
        self.open_door(DOOR_SPECIALIST)

        data = self.store()
        width = "58" if data["branding"]["receiptRollWidth"] == "80" else "80"
        data["branding"]["receiptRollWidth"] = width
        allowed = self.patch_store(data)
        self.assertEqual(allowed.status_code, 200, allowed.text)
        self.assertEqual(self.store()["branding"]["receiptRollWidth"], width)

        data = self.store()
        data["contacts"]["phone"] = "+996555444555"
        refused = self.patch_store(data)
        self.assertEqual(refused.status_code, 403, refused.text)

    def test_specialist_has_no_access_to_money(self) -> None:
        """Сервисный ключ открывает оборудование, но не выручку."""
        self.open_door(DOOR_SPECIALIST)
        for path in ("/api/finance/summary", "/api/analytics/summary", "/api/users"):
            with self.subTest(path=path):
                response = self.client.get(path, headers=self.headers)
                self.assertEqual(response.status_code, 403, f"{path}: {response.text}")

    def test_owner_reaches_money(self) -> None:
        self.open_door(DOOR_OWNER)
        for path in OWNER_ONLY_GET:
            with self.subTest(path=path):
                response = self.client.get(path, headers=self.headers)
                self.assertEqual(response.status_code, 200, f"{path}: {response.text}")

    # ── Окно бездействия ─────────────────────────────────────────────────

    def test_elevation_window_is_ten_minutes(self) -> None:
        self.assertEqual(ELEVATION_IDLE_MINUTES, 10)

    def test_elevation_expires_after_idle(self) -> None:
        """Десять минут без запросов — и дверь закрыта."""
        start = datetime.now(UTC)
        registry.grant(1, DOOR_SPECIALIST, ELEVATION_IDLE_MINUTES, now=start)

        alive = registry.check(
            1, DOOR_SPECIALIST, ELEVATION_IDLE_MINUTES, now=start + timedelta(minutes=9)
        )
        self.assertIsNotNone(alive)

        # Отсчёт идёт от последней активности: проверка выше его продлила.
        expired = registry.check(
            1, DOOR_SPECIALIST, ELEVATION_IDLE_MINUTES, now=start + timedelta(minutes=30)
        )
        self.assertIsNone(expired)

    def test_activity_extends_the_window(self) -> None:
        """Работающий специалист не оказывается за дверью на одиннадцатой минуте."""
        start = datetime.now(UTC)
        registry.grant(2, DOOR_SPECIALIST, ELEVATION_IDLE_MINUTES, now=start)
        moment = start
        for _ in range(6):
            moment += timedelta(minutes=5)
            self.assertIsNotNone(
                registry.check(2, DOOR_SPECIALIST, ELEVATION_IDLE_MINUTES, now=moment),
                f"дверь закрылась на {moment - start}",
            )

    def test_leaving_the_mode_closes_the_door_at_once(self) -> None:
        """«Выйти из режима» — не ожидание таймаута.

        Через настоящий маршрут, а не вызовом реестра: интерфейс до недавнего
        времени закрывал дверь только у себя, в sessionStorage, и повышенная
        сессия на сервере ещё десять минут пускала прямой запрос.
        """
        self.open_door(DOOR_OWNER)
        self.assertEqual(
            self.client.get("/api/finance/summary", headers=self.headers).status_code, 200
        )

        left = self.client.post("/api/auth/access/leave", headers=self.headers)
        self.assertEqual(left.status_code, 200, left.text)

        self.assertEqual(
            self.client.get("/api/finance/summary", headers=self.headers).status_code, 403
        )

    def test_doors_are_independent(self) -> None:
        """Открытая дверь специалиста не открывает дверь владельца."""
        registry.grant(4, DOOR_SPECIALIST, ELEVATION_IDLE_MINUTES)
        self.assertIsNone(registry.peek(4, DOOR_OWNER))


if __name__ == "__main__":
    unittest.main()
