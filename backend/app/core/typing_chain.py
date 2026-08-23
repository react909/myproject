"""Отличает «человек ещё набирает» от «человек подбирает».

Зачем это нужно. В окнах ввода секрета нет кнопки «Войти»: набранное уходит на
проверку само. У пароля, в отличие от лицензионного ключа, длина заранее
неизвестна, поэтому «человек закончил» приходится определять по паузе — а пауза
это ожидание, и ожидание владельцу видно как «касса думает над верным паролем».

Убрать паузу мешал счётчик попыток. Без неё пароль «Vladelec2026» уходит на
проверку пять раз — «Vladelec», «Vladelec2», …, — и лимит из пяти неудач
владелец выбирает сам, ни разу не ошибившись. Поэтому пауза убрана здесь, а не
в интерфейсе: сервер перестаёт считать попытками то, что попытками не является.

Правило одно: неудача, которая является строгим продолжением предыдущей неудачи
того же человека в ту же дверь, засчитывается не отдельной попыткой, а заменяет
её. «Vladelec» → «Vladelec2» → «Vladelec20» — это один набор, а не три догадки.

Почему это не ослабляет защиту от перебора. Сервер не отвечает, «правильно ли
начало»: любая неудача выглядит одинаково. Значит цепочка продолжений не даёт
подбирающему обратной связи и не позволяет искать пароль по одной букве. Цепочка
любой длины содержит ровно одно значение нужной длины — то есть ровно одну
осмысленную догадку, столько же, сколько стоила бы одна обычная попытка. Разными
догадками одной длины остаются только разные цепочки, а каждая новая цепочка
по-прежнему стоит попытки.

Хранится не сам секрет, а его отпечаток. Соль случайная и живёт в памяти
процесса, записи протухают за `CONTINUATION_TTL_SECONDS` и стираются при первом
же успешном входе: восстановить по этому набранный пароль нельзя, на диск он не
попадает и в журнал тоже.
"""

from __future__ import annotations

import hashlib
import secrets
import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

"""Сколько живёт память о предыдущей неудаче.

Полминуты: столько человек набирает длинный пароль на экранной клавиатуре, ища
клавиши глазами. Дольше держать незачем — продолжением набора это уже не будет,
а подбирающему лишние секунды памяти ни к чему.
"""
CONTINUATION_TTL_SECONDS = 30

# Соль на процесс. Отпечатки живут секунды и только в памяти, но подбирать по
# ним короткий пароль перебором словаря не должно быть возможно и в эти секунды.
_SALT = secrets.token_bytes(16)


def _digest(value: str) -> str:
    return hashlib.sha256(_SALT + value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class _LastFailure:
    """Предыдущая неудача: отпечаток начала, его длина и время."""

    prefix_digest: str
    length: int
    at: datetime


class TypingChainRegistry:
    """Последняя неудачная попытка каждого человека в каждую дверь."""

    def __init__(self) -> None:
        self._last: dict[tuple[int, str], _LastFailure] = {}
        # Запросы приходят из разных задач одного цикла событий; блокировка
        # дешевле рассуждений о том, где именно возможна перестановка.
        self._lock = threading.Lock()

    def is_continuation(
        self, user_id: int, door: str, secret: str, now: datetime | None = None
    ) -> bool:
        """Дописал ли человек к тому, что уже пробовал секунду назад."""
        moment = now or datetime.now(UTC)
        with self._lock:
            last = self._last.get((user_id, door))
        if last is None:
            return False
        if moment - last.at > timedelta(seconds=CONTINUATION_TTL_SECONDS):
            return False
        # Строго длиннее: то же самое значение продолжением не считается —
        # иначе повторная отправка того же пароля была бы бесплатной вечно.
        if len(secret) <= last.length:
            return False
        return secrets.compare_digest(_digest(secret[: last.length]), last.prefix_digest)

    def remember(self, user_id: int, door: str, secret: str, now: datetime | None = None) -> None:
        with self._lock:
            self._last[(user_id, door)] = _LastFailure(
                prefix_digest=_digest(secret),
                length=len(secret),
                at=now or datetime.now(UTC),
            )

    def clear(self, user_id: int, door: str) -> None:
        with self._lock:
            self._last.pop((user_id, door), None)

    def reset(self) -> None:
        """Только для тестов: между сценариями состояние не переносится."""
        with self._lock:
            self._last.clear()


registry = TypingChainRegistry()
