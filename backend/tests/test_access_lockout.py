"""Защита от перебора в окне «Служебный доступ».

Окно одно на обе скрытые двери, поэтому и счётчик неудач общий: попытка
засчитывается один раз и только тогда, когда не подошло ни то ни другое. Пока
счётчики были раздельными, одна опечатка засчитывалась обеим дверям сразу.

Проверяется на живом приложении: блокировка, нарастающая задержка, разводка по
секрету и то, что в журнал не попадает сам секрет.

Запуск: python -m unittest discover -s tests (из каталога backend).
"""

from __future__ import annotations

import sqlite3
import sys
import unittest
from pathlib import Path
from unittest import mock

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

from app.modules.auth import router as auth_router  # noqa: E402
from app.modules.auth.router import (  # noqa: E402
    ACCESS_DELAY_MAX_SECONDS,
    ACCESS_MAX_ATTEMPTS,
    OWNER_MAX_ATTEMPTS,
    access_delay_seconds,
)


class AccessLockout(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        cls.headers = auth_headers(ensure_setup())
        # Паузы здесь настоящие — до восьми секунд на попытку, а попыток в
        # этих тестах десятки. Саму формулу проверяет отдельный тест ниже, он
        # зовёт функцию напрямую и заглушки не видит.
        cls._delay_patch = mock.patch.object(auth_router, "access_delay_seconds", lambda _: 0.0)
        cls._delay_patch.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls._delay_patch.stop()

    def setUp(self) -> None:
        # Каждый тест начинается с чистого счётчика: они проверяют разные
        # ветки одной и той же двери.
        self.reset_counter()

    def reset_counter(self) -> None:
        con = sqlite3.connect(_TEMP_DB)
        try:
            con.execute(
                "UPDATE store_settings SET access_failed_attempts = 0, access_locked_until = NULL"
            )
            con.commit()
        finally:
            con.close()

    def attempt(self, secret: str):
        return self.client.post(
            "/api/auth/access/unlock", headers=self.headers, json={"secret": secret}
        )

    def counter(self) -> int:
        con = sqlite3.connect(_TEMP_DB)
        try:
            return con.execute("SELECT access_failed_attempts FROM store_settings").fetchone()[0]
        finally:
            con.close()

    def test_service_key_opens_specialist_door(self) -> None:
        response = self.attempt(SERVICE_KEY)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["door"], "specialist")

    def test_license_key_opens_specialist_door(self) -> None:
        """Специалист приходит с ключом установки, а не с секретом владельца."""
        import api_fixture

        response = self.attempt(api_fixture.LICENSE_KEY)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["door"], "specialist")

    def test_license_key_is_case_insensitive(self) -> None:
        """Ключ читают с наклейки — придираться к регистру здесь не к чему."""
        import api_fixture

        response = self.attempt(api_fixture.LICENSE_KEY.lower())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["door"], "specialist")

    def test_wrong_license_shaped_key_is_refused(self) -> None:
        """Похожий на лицензионный, но чужой ключ — обычная неудача."""
        response = self.attempt("KASSIR-0000-0000-0000")
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.counter(), 1)

    def test_owner_password_opens_owner_door(self) -> None:
        response = self.attempt(OWNER_CABINET_PASSWORD)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["door"], "owner")

    def test_account_password_opens_nothing(self) -> None:
        """Пароль входа — не ключ от кабинета владельца.

        Под учётной записью владельца работает вся смена: он же логин установки,
        и его диктуют кассиру по телефону. Открывался бы им кабинет — разделения
        секретов не существовало бы вовсе, как бы оно ни выглядело в интерфейсе.
        """
        response = self.attempt(OWNER_PASSWORD)
        self.assertEqual(response.status_code, 403, response.text)

    def test_wrong_secret_counts_once(self) -> None:
        """Одна опечатка — одна попытка, а не по одной каждой двери."""
        self.assertEqual(self.attempt("не подходит").status_code, 403)
        self.assertEqual(self.counter(), 1)
        self.assertEqual(self.attempt("тоже нет").status_code, 403)
        self.assertEqual(self.counter(), 2)

    def test_lockout_only_after_the_full_limit(self) -> None:
        # На пятой попытке окно ещё открыто: лимит здесь выше, чем у отдельных
        # дверей, потому что опечатки специалиста закрывают заодно владельца.
        for _ in range(OWNER_MAX_ATTEMPTS):
            self.attempt("мимо")
        self.assertEqual(self.attempt(SERVICE_KEY).status_code, 200)

        self.reset_counter()
        for _ in range(ACCESS_MAX_ATTEMPTS):
            self.attempt("мимо")
        # А теперь не пускает даже верный ключ: дверь закрыта на четверть часа.
        locked = self.attempt(SERVICE_KEY)
        self.assertEqual(locked.status_code, 429)
        self.assertIn("Повторите через", locked.json()["detail"])

    def test_success_resets_counter(self) -> None:
        self.attempt("мимо")
        self.attempt("мимо")
        self.assertEqual(self.counter(), 2)
        self.assertEqual(self.attempt(SERVICE_KEY).status_code, 200)
        self.assertEqual(self.counter(), 0)

    def test_error_text_does_not_reveal_which_door(self) -> None:
        detail = self.attempt("мимо").json()["detail"]
        self.assertNotIn("ключ", detail.lower())
        self.assertNotIn("пароль", detail.lower())

    def test_secret_never_reaches_the_log(self) -> None:
        self.attempt("СекретКоторогоНетВЖурнале1")
        con = sqlite3.connect(_TEMP_DB)
        try:
            rows = con.execute(
                "SELECT action, target, old_value, new_value FROM audit_entries"
            ).fetchall()
        finally:
            con.close()
        dump = " ".join(str(cell) for row in rows for cell in row)
        self.assertIn("access.denied", dump)
        self.assertNotIn("СекретКоторогоНетВЖурнале1", dump)
        # И ни в каком урезанном виде тоже.
        self.assertNotIn("Секрет", dump)

    def test_delay_grows_after_three_attempts(self) -> None:
        """Первые три попытки быстрые, дальше пауза удваивается до потолка."""
        quick = access_delay_seconds(1)
        self.assertEqual(access_delay_seconds(2), quick)
        self.assertEqual(access_delay_seconds(3), quick)
        self.assertGreater(access_delay_seconds(4), quick)
        self.assertGreater(access_delay_seconds(5), access_delay_seconds(4))
        self.assertLessEqual(access_delay_seconds(99), ACCESS_DELAY_MAX_SECONDS)


if __name__ == "__main__":
    unittest.main()
