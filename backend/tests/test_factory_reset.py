"""Удаление аккаунта: отказ без пароля и полное стирание с ним.

Набор написан по следу настоящего дефекта. Симптом был такой: владелец вводил
пароль для удаления аккаунта, его выбрасывало на экран входа, а аккаунт
оставался на месте — «удаление не работает».

Причин оказалось две, и обе проверяются здесь:

1. **Неверный пароль отвечал 401.** Клиент трактует любой 401 как протухшую
   сессию: стирает токен и разлогинивает. Отсюда и «выбросило на логин», хотя
   удаление даже не начиналось. Отказ в подтверждении — это 403.
2. **Список таблиц был неполным.** В нём не было расходов и намерений оплаты, а
   ссылка на `users` у них есть. Внешние ключи в SQLite включены, поэтому на
   магазине, где занесён хоть один расход, удаление обрывалось ошибкой
   целостности.

База у всех наборов одна на процесс (см. api_fixture), поэтому стирающий тест
восстанавливает установку за собой: иначе соседние наборы получили бы пустую
базу и падали бы не по своей вине.
"""

from __future__ import annotations

import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import api_fixture  # noqa: E402
from api_fixture import (  # noqa: E402
    DB_PATH as _TEMP_DB,
    OWNER_CABINET_PASSWORD,
    OWNER_PASSWORD,
    auth_headers,
    client,
    ensure_setup,
)


class FactoryReset(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        cls.token = ensure_setup()
        cls.headers = auth_headers(cls.token)

    def open_owner_door(self) -> None:
        # Дверь открывает пароль владельца. Само удаление ниже переспрашивает
        # пароль учётной записи — это разные секреты, и здесь видно, зачем:
        # открытая дверь не должна означать «можно стирать базу».
        response = self.client.post(
            "/api/auth/owner/unlock",
            headers=self.headers,
            json={"password": OWNER_CABINET_PASSWORD},
        )
        self.assertEqual(response.status_code, 200, response.text)

    def reset(self, password: str):
        return self.client.post(
            "/api/setup/factory-reset", headers=self.headers, json={"password": password}
        )

    def test_wrong_password_refuses_without_logging_out(self) -> None:
        """403, а не 401: неверный пароль не должен разлогинивать."""
        self.open_owner_door()
        response = self.reset("совсем-не-тот-пароль")
        self.assertEqual(response.status_code, 403, response.text)

        # Сессия цела — тот же токен по-прежнему работает.
        alive = self.client.get("/api/auth/me", headers=self.headers)
        self.assertEqual(alive.status_code, 200, alive.text)

        # И аккаунт на месте: установка не тронута.
        status = self.client.get("/api/setup/status").json()
        self.assertFalse(status.get("needs_setup"), status)

    def test_reset_without_open_door_is_refused(self) -> None:
        """Одного пароля мало: дверь владельца должна быть открыта."""
        from app.core.elevation import registry

        registry.clear()
        response = self.reset(OWNER_PASSWORD)
        self.assertEqual(response.status_code, 403, response.text)

    def test_zz_reset_actually_wipes_the_install(self) -> None:
        """Последним в классе: после удаления база пуста, а касса просит установку.

        Имя с `zz` — тесты внутри класса идут по алфавиту, а этот стирает всё,
        чем пользуются соседние проверки.
        """
        self.open_owner_door()

        # Расход — та самая запись, из-за которой удаление падало: у неё ссылка
        # на пользователя, а в списке таблиц её не было.
        created = self.client.post(
            "/api/finance/expenses",
            headers=self.headers,
            json={"amount": 1500, "note": "аренда"},
        )
        self.assertEqual(created.status_code, 201, created.text)

        done = self.reset(OWNER_PASSWORD)
        self.assertEqual(done.status_code, 204, done.text)

        # Касса стартует как новая — не как «войдите в старый аккаунт».
        status = self.client.get("/api/setup/status").json()
        self.assertTrue(status.get("needs_setup"), status)

        # И в базе действительно пусто.
        con = sqlite3.connect(_TEMP_DB)
        try:
            for table in ("users", "store_settings", "expenses", "sales"):
                left = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                self.assertEqual(left, 0, f"в таблице {table} осталось {left}")
        finally:
            con.close()

        # Возвращаем установку соседям: база одна на процесс, и следующий набор
        # не должен разбираться, почему у него нет владельца. Ключ лицензии
        # сбрасываем — после стирания он у базы новый.
        api_fixture.LICENSE_KEY = ""
        restored = ensure_setup()
        self.assertTrue(restored)


if __name__ == "__main__":
    unittest.main()
