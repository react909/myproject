"""Набор пароля не считается перебором, а перебор по-прежнему считается.

Правило появилось, чтобы убрать паузу перед проверкой: окно отправляет
набранное сразу, и длинный пароль доезжает до сервера по частям. Без правила
владелец выбирал бы лимит из пяти попыток собственным правильным паролем.

Проверяется симметрично: что набор действительно бесплатен и что подбор
действительно платный. Второе важнее — правило трогает защиту от перебора, и
тест на «удобно» без теста на «безопасно» здесь ничего не доказывает.

Запуск: python -m unittest discover -s tests (из каталога backend).
"""

from __future__ import annotations

import sqlite3
import sys
import unittest
from datetime import UTC, datetime, timedelta
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
from app.core.typing_chain import (  # noqa: E402
    CONTINUATION_TTL_SECONDS,
    TypingChainRegistry,
)
from app.core.typing_chain import registry as typing_chain  # noqa: E402
from app.modules.auth.router import OWNER_MAX_ATTEMPTS  # noqa: E402


class TypingChainRules(unittest.TestCase):
    """Само правило, без обращения к сети."""

    def setUp(self) -> None:
        self.chain = TypingChainRegistry()

    def test_nothing_remembered_means_no_continuation(self) -> None:
        self.assertFalse(self.chain.is_continuation(1, "owner", "Vlad"))

    def test_dopisannoe_is_a_continuation(self) -> None:
        self.chain.remember(1, "owner", "Vladelec")
        self.assertTrue(self.chain.is_continuation(1, "owner", "Vladelec2026"))

    def test_a_different_guess_is_not_a_continuation(self) -> None:
        """Главная проверка: подбор остаётся платным."""
        self.chain.remember(1, "owner", "Vladelec")
        self.assertFalse(self.chain.is_continuation(1, "owner", "Parol12345"))
        # И даже похожее, но не продолжающее — тоже догадка.
        self.assertFalse(self.chain.is_continuation(1, "owner", "Vladeleb2026"))

    def test_the_same_value_again_is_not_free(self) -> None:
        """Иначе одну догадку можно было бы слать бесконечно."""
        self.chain.remember(1, "owner", "Vladelec")
        self.assertFalse(self.chain.is_continuation(1, "owner", "Vladelec"))

    def test_shortening_is_not_a_continuation(self) -> None:
        self.chain.remember(1, "owner", "Vladelec2026")
        self.assertFalse(self.chain.is_continuation(1, "owner", "Vladelec"))

    def test_memory_expires(self) -> None:
        started = datetime.now(UTC)
        self.chain.remember(1, "owner", "Vladelec", now=started)
        late = started + timedelta(seconds=CONTINUATION_TTL_SECONDS + 1)
        self.assertFalse(self.chain.is_continuation(1, "owner", "Vladelec2026", now=late))

    def test_chains_do_not_cross_users_or_doors(self) -> None:
        self.chain.remember(1, "owner", "Vladelec")
        self.assertFalse(self.chain.is_continuation(2, "owner", "Vladelec2026"))
        self.assertFalse(self.chain.is_continuation(1, "specialist", "Vladelec2026"))

    def test_success_forgets_the_chain(self) -> None:
        self.chain.remember(1, "owner", "Vladelec")
        self.chain.clear(1, "owner")
        self.assertFalse(self.chain.is_continuation(1, "owner", "Vladelec2026"))


class TypingChainOverApi(unittest.TestCase):
    """То же правило на живом маршруте двери владельца."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        cls.headers = auth_headers(ensure_setup())
        cls.user_id = cls.client.get("/api/auth/me", headers=cls.headers).json()["id"]

    def setUp(self) -> None:
        elevation.revoke(self.user_id)
        typing_chain.reset()
        self.reset_counter()
        # Длина пароля забывается намеренно.
        #
        # На установках новее миграции 0024 набор отсекается ещё раньше — по
        # длине, не доходя до argon2 (см. test_owner_length_gate). Правило
        # цепочки остаётся страховкой для тех, кто обновился со старой версии:
        # там длина неизвестна, пока владелец не войдёт хотя бы раз. Именно этот
        # случай здесь и проверяется, поэтому длина обнуляется.
        self.set_length(0)

    def tearDown(self) -> None:
        self.set_length(len(OWNER_CABINET_PASSWORD))

    def set_length(self, length: int) -> None:
        con = sqlite3.connect(_TEMP_DB)
        try:
            con.execute("UPDATE store_settings SET owner_password_length = ?", (length,))
            con.commit()
        finally:
            con.close()

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

    def test_typing_a_long_password_costs_one_attempt(self) -> None:
        """Ровно тот случай, ради которого правило и заведено."""
        for prefix in ("Vladelec", "Vladelec2", "Vladelec20", "Vladelec202"):
            self.assertEqual(self.attempt(prefix).status_code, 403)
        # Четыре куска одного набора — одна засчитанная попытка, а не четыре.
        self.assertEqual(self.counter(), 1)
        # И дописанный до конца пароль всё ещё пускает.
        self.assertEqual(self.attempt(OWNER_CABINET_PASSWORD).status_code, 200)

    def test_guessing_still_costs_every_time(self) -> None:
        """Правило не должно превращаться в бесплатный перебор."""
        for guess in ("первый", "второй", "третий"):
            self.assertEqual(self.attempt(guess).status_code, 403)
        self.assertEqual(self.counter(), 3)

    def test_lockout_still_happens_on_real_guessing(self) -> None:
        for index in range(OWNER_MAX_ATTEMPTS):
            self.assertEqual(self.attempt(f"догадка-{index}").status_code, 403)
        # Дверь закрыта — даже для верного пароля.
        self.assertEqual(self.attempt(OWNER_CABINET_PASSWORD).status_code, 429)

    def test_successful_entry_resets_the_chain(self) -> None:
        self.assertEqual(self.attempt("Vladelec").status_code, 403)
        self.assertEqual(self.attempt(OWNER_CABINET_PASSWORD).status_code, 200)
        elevation.revoke(self.user_id)
        self.reset_counter()
        # Успешный вход заодно запомнил длину — вернём «неизвестно», иначе
        # дальше сработает отсечение по длине, а проверяется здесь не оно.
        self.set_length(0)
        # После входа дописывание к прежнему обрывку снова стоит попытки.
        self.assertEqual(self.attempt("Vladelec2").status_code, 403)
        self.assertEqual(self.counter(), 1)
