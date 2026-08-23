"""Одна дорогая проверка на один ввод пароля — не девять.

Проверка argon2id стоит около 120 мс процессорного времени и 64 МБ памяти. Окно
ввода отправляет набранное само, без кнопки, поэтому по дороге к настоящему
паролю на сервер приезжают его куски. Пока каждый кусок доходил до argon2, ввод
шестнадцати символов превращался в девять полных проверок — больше секунды
счёта и до полугигабайта памяти, и машина уходила в своп.

Теперь дверь сначала смотрит на длину: не совпала — это заведомо не пароль, и
дорогая проверка не запускается вовсе. Здесь проверяется, что отсечение
работает, что оно ничего не ломает и что попытки на нём не сгорают.

Запуск: python -m unittest discover -s tests (из каталога backend).
"""

from __future__ import annotations

import sqlite3
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from api_fixture import (  # noqa: E402
    DB_PATH as _TEMP_DB,
    OWNER_CABINET_PASSWORD,
    auth_headers,
    client,
    ensure_setup,
)

from app.core.elevation import registry as elevation  # noqa: E402
from app.core.typing_chain import registry as typing_chain  # noqa: E402


class OwnerLengthGate(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        cls.headers = auth_headers(ensure_setup())
        cls.user_id = cls.client.get("/api/auth/me", headers=cls.headers).json()["id"]

    def setUp(self) -> None:
        elevation.revoke(self.user_id)
        typing_chain.reset()
        self.reset_counter()

    def reset_counter(self) -> None:
        con = sqlite3.connect(_TEMP_DB)
        try:
            con.execute(
                "UPDATE store_settings SET owner_failed_attempts = 0, owner_locked_until = NULL"
            )
            con.commit()
        finally:
            con.close()

    def counter(self) -> int:
        con = sqlite3.connect(_TEMP_DB)
        try:
            return con.execute("SELECT owner_failed_attempts FROM store_settings").fetchone()[0]
        finally:
            con.close()

    def attempt(self, password: str):
        return self.client.post(
            "/api/auth/owner/unlock", headers=self.headers, json={"password": password}
        )

    # -- подсказка о длине --------------------------------------------------- #

    def test_hint_reports_the_length(self) -> None:
        response = self.client.get("/api/auth/owner/hint", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["length"], len(OWNER_CABINET_PASSWORD))

    def test_hint_needs_a_session(self) -> None:
        """Без входа длину не спрашивают: это не публичные сведения."""
        self.assertEqual(self.client.get("/api/auth/owner/hint").status_code, 401)

    def test_hint_never_leaks_the_password(self) -> None:
        body = self.client.get("/api/auth/owner/hint", headers=self.headers).json()
        self.assertEqual(set(body), {"length"})
        self.assertNotIn(OWNER_CABINET_PASSWORD, str(body))

    # -- отсечение по длине --------------------------------------------------- #

    def test_wrong_length_is_refused_without_the_expensive_check(self) -> None:
        """Главное свойство: куски пароля отваливаются даром.

        Время здесь — часть проверки, а не украшение: одна argon2id на этой
        машине идёт около 120 мс, и уложиться в такой запас, посчитав её,
        невозможно.
        """
        short = OWNER_CABINET_PASSWORD[:-1]
        started = time.perf_counter()
        response = self.attempt(short)
        elapsed = time.perf_counter() - started

        self.assertEqual(response.status_code, 403)
        self.assertLess(
            elapsed,
            0.06,
            f"отказ занял {elapsed * 1000:.0f} мс — похоже, argon2 всё-таки считалась",
        )

    def test_typing_towards_the_password_costs_no_attempts(self) -> None:
        """Весь набор целиком не тратит ни одной попытки из пяти."""
        for length in range(1, len(OWNER_CABINET_PASSWORD)):
            self.assertEqual(self.attempt(OWNER_CABINET_PASSWORD[:length]).status_code, 403)
        self.assertEqual(self.counter(), 0)
        # А дописанный до конца пароль пускает.
        self.assertEqual(self.attempt(OWNER_CABINET_PASSWORD).status_code, 200)

    def test_a_wrong_password_of_the_right_length_still_counts(self) -> None:
        """Отсечение не должно превращаться в бесплатный перебор."""
        wrong = "X" * len(OWNER_CABINET_PASSWORD)
        self.assertEqual(self.attempt(wrong).status_code, 403)
        self.assertEqual(self.counter(), 1)

    def test_the_right_password_still_opens_the_door(self) -> None:
        self.assertEqual(self.attempt(OWNER_CABINET_PASSWORD).status_code, 200)
