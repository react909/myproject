"""Проверка пароля не должна валить машину.

История настоящая. Окно ввода секрета отправляло пароль на каждую нажатую
букву, а каждая проверка argon2id стоит около 120 мс процессорного времени и
64 МБ памяти. Набор шестнадцати символов превращался в девять таких проверок —
больше секунды сплошного счёта и до полугигабайта памяти разом. Вдобавок
проверка была синхронной внутри `async def`, то есть занимала событийный цикл
целиком: сервер переставал отвечать вообще на всё. Со стороны это выглядело как
«перестал работать весь компьютер», и владелец решил, что поймал вирус.

Интерфейс исправлен, но полагаться на это нельзя: следующая такая ошибка не
должна доходить до железа. Здесь проверяется серверная страховка — что счёт
идёт вне цикла событий и что одновременных проверок не больше положенного.

Запуск: python -m unittest discover -s tests (из каталога backend).
"""

from __future__ import annotations

import asyncio
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import security  # noqa: E402


class VerifyIsBounded(unittest.TestCase):
    def test_concurrency_is_capped(self) -> None:
        """Сколько бы проверок ни пришло разом, считаются не все сразу.

        Именно это ограничивает память сверху: без потолка каждый запрос
        добавлял бы свои 64 МБ, и десяток запросов уводил машину в своп.
        """
        running = 0
        peak = 0
        lock = __import__("threading").Lock()

        def slow_verify(_password: str, _hashed: str) -> bool:
            nonlocal running, peak
            with lock:
                running += 1
                peak = max(peak, running)
            time.sleep(0.05)
            with lock:
                running -= 1
            return False

        original = security.verify_password
        security.verify_password = slow_verify
        try:

            async def hammer() -> None:
                # Двадцать запросов разом — примерно то, во что превращался
                # набор длинного пароля вместе с исправлениями.
                await asyncio.gather(
                    *(security.verify_password_async("x", "$argon2id$fake") for _ in range(20))
                )

            asyncio.run(hammer())
        finally:
            security.verify_password = original

        self.assertLessEqual(
            peak,
            security.VERIFY_CONCURRENCY,
            f"одновременно считалось {peak} проверок при потолке "
            f"{security.VERIFY_CONCURRENCY} — память ничем не ограничена",
        )

    def test_event_loop_stays_responsive(self) -> None:
        """Пока пароль проверяется, сервер отвечает на другие запросы.

        Раньше проверка была синхронной внутри `async def` и занимала цикл
        событий целиком: касса и печать чека вставали вместе с ней.
        """

        def slow_verify(_password: str, _hashed: str) -> bool:
            time.sleep(0.3)
            return False

        original = security.verify_password
        security.verify_password = slow_verify
        try:
            ticks = 0

            async def heartbeat() -> None:
                nonlocal ticks
                for _ in range(20):
                    await asyncio.sleep(0.01)
                    ticks += 1

            async def scenario() -> None:
                await asyncio.gather(
                    security.verify_password_async("x", "$argon2id$fake"),
                    heartbeat(),
                )

            asyncio.run(scenario())
        finally:
            security.verify_password = original

        # Если бы проверка держала цикл, ни один тик не успел бы пройти.
        self.assertEqual(ticks, 20, "событийный цикл стоял, пока считался пароль")

    def test_empty_hash_costs_nothing(self) -> None:
        """Пустой хэш не должен занимать место в очереди на проверку."""

        async def scenario() -> tuple[bool, tuple[bool, str | None]]:
            return (
                await security.verify_password_async("x", ""),
                await security.verify_and_upgrade_async("x", ""),
            )

        matched, (upgraded_ok, upgraded) = asyncio.run(scenario())
        self.assertFalse(matched)
        self.assertFalse(upgraded_ok)
        self.assertIsNone(upgraded)
