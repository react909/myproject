"""Снятие блокировки паролем входа — и только снятие.

Владелец, промахнувшийся раскладкой у кассы с очередью, не должен стоять и
ждать несколько минут. Паролем от своей учётной записи он подтверждает, что это
он, и пробует снова сразу.

Главное здесь — то, чего маршрут НЕ делает. Он не открывает кабинет. Если бы
пароль входа после блокировки пускал внутрь, разделение секретов исчезло бы
совсем: кассир, знающий пароль от кассы, ошибся бы пять раз нарочно и получил
финансы. Половина тестов ниже — именно про это.

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
    auth_headers,
    client,
    ensure_setup,
)

from app.core.elevation import registry as elevation  # noqa: E402
from app.core.typing_chain import registry as typing_chain  # noqa: E402
from app.modules.auth.router import OWNER_MAX_ATTEMPTS  # noqa: E402

# Догадка той же длины, что настоящий пароль: короче — и дверь отсекает её по
# длине, не считая попыткой (см. test_owner_length_gate).
WRONG = "X" * len(OWNER_CABINET_PASSWORD)


class OwnerLockoutLift(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        cls.headers = auth_headers(ensure_setup())
        cls.user_id = cls.client.get("/api/auth/me", headers=cls.headers).json()["id"]

    def setUp(self) -> None:
        elevation.revoke(self.user_id)
        typing_chain.reset()
        self.reset_counter()

    def tearDown(self) -> None:
        # Убираем за собой обязательно: тесты этого файла запирают дверь
        # намеренно, и незакрытая блокировка досталась бы соседнему набору —
        # он упирался бы в 429 на ровном месте.
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

    def unlock(self, password: str):
        return self.client.post(
            "/api/auth/owner/unlock", headers=self.headers, json={"password": password}
        )

    def lift(self, password: str):
        return self.client.post(
            "/api/auth/owner/lockout/lift", headers=self.headers, json={"password": password}
        )

    def lock_the_door(self) -> None:
        for _ in range(OWNER_MAX_ATTEMPTS):
            self.unlock(WRONG)
        self.assertEqual(self.unlock(OWNER_CABINET_PASSWORD).status_code, 429)

    # -- снятие работает ----------------------------------------------------- #

    def test_account_password_lifts_the_lockout(self) -> None:
        self.lock_the_door()
        self.assertEqual(self.lift(OWNER_PASSWORD).status_code, 200)
        # Ждать больше нечего — но войти по-прежнему можно только своим паролем.
        self.assertEqual(self.unlock(OWNER_CABINET_PASSWORD).status_code, 200)

    def test_wrong_account_password_does_not_lift(self) -> None:
        self.lock_the_door()
        self.assertEqual(self.lift("не тот пароль входа").status_code, 403)
        self.assertEqual(self.unlock(OWNER_CABINET_PASSWORD).status_code, 429)

    # -- и не открывает дверь ------------------------------------------------ #

    def test_lifting_does_not_open_the_cabinet(self) -> None:
        """Главная проверка этого файла.

        Снятие блокировки — это снятие таймера, а не вход. Повышенная сессия
        после него не выдаётся, и разделы кабинета остаются закрытыми.
        """
        self.lock_the_door()
        self.assertEqual(self.lift(OWNER_PASSWORD).status_code, 200)
        for url in ("/api/analytics/summary", "/api/finance/summary", "/api/users"):
            with self.subTest(route=url):
                response = self.client.get(url, headers=self.headers)
                self.assertEqual(response.status_code, 403, f"{url}: {response.text}")

    def test_account_password_still_does_not_open_the_door_after_lifting(self) -> None:
        """Обход «ошибись пять раз, потом войди паролем входа» не работает."""
        self.lock_the_door()
        self.assertEqual(self.lift(OWNER_PASSWORD).status_code, 200)
        self.assertEqual(self.unlock(OWNER_PASSWORD).status_code, 403)

    def test_lifting_needs_a_session(self) -> None:
        response = self.client.post(
            "/api/auth/owner/lockout/lift", json={"password": OWNER_PASSWORD}
        )
        self.assertEqual(response.status_code, 401)

    # -- журнал -------------------------------------------------------------- #

    def test_lifting_is_written_to_the_journal(self) -> None:
        """Частые снятия — признак подбора, и владелец должен это видеть."""
        self.lock_the_door()
        self.assertEqual(self.lift(OWNER_PASSWORD).status_code, 200)
        con = sqlite3.connect(_TEMP_DB)
        try:
            count = con.execute(
                "SELECT COUNT(*) FROM audit_entries WHERE action = 'access.lockout_lifted'"
            ).fetchone()[0]
        finally:
            con.close()
        self.assertGreaterEqual(count, 1)
