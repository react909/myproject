"""Три секрета, три двери, и ни одного пересечения.

Главный инвариант всей схемы прав, и проверяется он здесь целиком, матрицей:
каждый секрет пробуется в каждую дверь, а не только в свою. Половина этих
сочетаний — те, которые обязаны получить отказ, и без них тест доказывал бы
только то, что верный секрет работает, а это никогда и не ломалось.

| Секрет            | Кабинет владельца | Сервисный режим |
|-------------------|-------------------|-----------------|
| Пароль входа      | нет               | нет             |
| Пароль владельца  | да                | нет             |
| Лицензионный ключ | нет               | да              |

Отдельно проверяется, что права живут на сервере: прямой запрос к защищённому
маршруту без повышенной сессии отвергается независимо от того, что нарисовано в
интерфейсе. Спрятанный пункт меню защитой не считается.

Запуск: python -m unittest discover -s tests (из каталога backend).
"""

from __future__ import annotations

import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from api_fixture import (  # noqa: E402
    DB_PATH as _TEMP_DB,
    OWNER_CABINET_PASSWORD,
    OWNER_PASSWORD,
    SERVICE_KEY,
    auth_headers,
    client,
    ensure_setup,
)

from app.core.elevation import registry  # noqa: E402

# Маршруты за дверью владельца. Все три раздела кабинета — по одному на каждый.
OWNER_ROUTES = (
    "/api/analytics/summary",
    "/api/finance/summary",
    "/api/users",
)


class SecretSeparation(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        cls.token = ensure_setup()
        cls.headers = auth_headers(cls.token)
        cls.user_id = cls.client.get("/api/auth/me", headers=cls.headers).json()["id"]

    def setUp(self) -> None:
        # Каждый тест начинается кассиром — без единой открытой двери.
        registry.revoke(self.user_id)
        # И с чистыми счётчиками: тесты подбирают неверные секреты десятками, а
        # после пятой неудачи дверь закрывается на четверть часа и следующий
        # тест получал бы 429 вместо осмысленного ответа.
        self.reset_counters()

    def reset_counters(self) -> None:
        con = sqlite3.connect(_TEMP_DB)
        try:
            con.execute(
                "UPDATE store_settings SET"
                " owner_failed_attempts = 0, owner_locked_until = NULL,"
                " service_failed_attempts = 0, service_locked_until = NULL,"
                " access_failed_attempts = 0, access_locked_until = NULL"
            )
            con.commit()
        finally:
            con.close()

    # -- двери ------------------------------------------------------------- #

    def open_owner(self, password: str):
        return self.client.post(
            "/api/auth/owner/unlock", headers=self.headers, json={"password": password}
        )

    def open_specialist(self, key: str):
        return self.client.post(
            "/api/auth/service-key/unlock", headers=self.headers, json={"key": key}
        )

    def license_key(self) -> str:
        import api_fixture

        return api_fixture.LICENSE_KEY

    # -- пароль входа не открывает ничего ----------------------------------- #

    def test_account_password_does_not_open_owner_cabinet(self) -> None:
        """Ключевой запрет всей задачи.

        Под учётной записью владельца работает смена: её логин — email
        установки, и пароль от неё владелец диктует кассиру по телефону, чтобы
        тот пробил возврат. Открывался бы им кабинет — вместе с возвратом
        человек получал бы выручку, себестоимость и сотрудников.
        """
        self.assertEqual(self.open_owner(OWNER_PASSWORD).status_code, 403)

    def test_account_password_does_not_open_service_mode(self) -> None:
        self.assertEqual(self.open_specialist(OWNER_PASSWORD).status_code, 403)

    # -- пароль владельца открывает только кабинет -------------------------- #

    def test_owner_password_opens_the_cabinet(self) -> None:
        self.assertEqual(self.open_owner(OWNER_CABINET_PASSWORD).status_code, 200)

    def test_owner_password_does_not_open_service_mode(self) -> None:
        """Владелец видит деньги, но оборудование не настраивает."""
        self.assertEqual(self.open_specialist(OWNER_CABINET_PASSWORD).status_code, 403)

    # -- лицензионный ключ открывает только сервисный режим ----------------- #

    def test_license_key_opens_service_mode(self) -> None:
        self.assertEqual(self.open_specialist(self.license_key()).status_code, 200)

    def test_license_key_does_not_open_owner_cabinet(self) -> None:
        """Специалист настраивает кассу, но денег магазина не видит."""
        self.assertEqual(self.open_owner(self.license_key()).status_code, 403)

    def test_service_key_does_not_open_owner_cabinet(self) -> None:
        """То же и для собственного сервисного ключа старых установок."""
        self.assertEqual(self.open_owner(SERVICE_KEY).status_code, 403)

    # -- права проверяет сервер, а не интерфейс ----------------------------- #

    def test_protected_routes_refuse_without_elevation(self) -> None:
        """Прямой запрос без повышенной сессии — отказ.

        Именно это отличает защиту от спрятанного пункта меню: интерфейс до
        этих маршрутов не доводит, но дойти до них можно и мимо интерфейса.
        """
        for url in OWNER_ROUTES:
            with self.subTest(route=url):
                response = self.client.get(url, headers=self.headers)
                self.assertEqual(response.status_code, 403, f"{url}: {response.text}")

    def test_owner_password_opens_all_three_cabinet_sections(self) -> None:
        self.assertEqual(self.open_owner(OWNER_CABINET_PASSWORD).status_code, 200)
        for url in OWNER_ROUTES:
            with self.subTest(route=url):
                response = self.client.get(url, headers=self.headers)
                self.assertEqual(response.status_code, 200, f"{url}: {response.text}")

    def test_service_mode_does_not_reach_the_money(self) -> None:
        """Открытая дверь специалиста не даёт ни выручки, ни сотрудников."""
        self.assertEqual(self.open_specialist(self.license_key()).status_code, 200)
        for url in OWNER_ROUTES:
            with self.subTest(route=url):
                response = self.client.get(url, headers=self.headers)
                self.assertEqual(response.status_code, 403, f"{url}: {response.text}")

    # -- счётчики попыток раздельные ---------------------------------------- #

    def test_failed_owner_attempts_do_not_lock_the_specialist(self) -> None:
        """Опечатки владельца не запирают дверь, которой он не касался.

        Иначе кассир, пять раз промахнувшийся мимо пароля владельца, оставлял
        бы приехавшего специалиста без доступа к оборудованию на четверть часа.
        """
        # Догадки той же длины, что и настоящий пароль: иначе дверь отсекает их
        # по длине и попыткой не считает (см. test_owner_length_gate).
        wrong = "X" * len(OWNER_CABINET_PASSWORD)
        for _ in range(5):
            self.open_owner(wrong)
        # Дверь владельца закрылась…
        self.assertEqual(self.open_owner(OWNER_CABINET_PASSWORD).status_code, 429)
        # …а дверь специалиста открывается как ни в чём не бывало.
        self.assertEqual(self.open_specialist(self.license_key()).status_code, 200)
