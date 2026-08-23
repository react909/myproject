"""Повышенные сессии: владелец и специалист.

Роль аккаунта и повышенная сессия — две разные вещи, и это главное в модуле.
На кассе почти всегда залогинен владелец (его email — это логин установки),
поэтому проверка «роль аккаунта = owner» не защищает ничего: за кассой в этот
момент стоит кассир. Дверь открывает не роль, а секрет, введённый только что:
пароль владельца или сервисный ключ.

Повышение живёт в памяти процесса, а не в базе, и это тоже осознанно:

* оно обязано исчезать при перезапуске приложения — так записано в требованиях,
  а бэкенд перезапускается вместе с ним;
* его нельзя подделать со стороны интерфейса: в localStorage лежит только
  подсказка «показать плашку», решение принимает сервер;
* писать в базу на каждый запрос ради продления таймера — лишние записи на
  диск в горячем пути кассы.

Таймаут — по бездействию: каждый успешно пропущенный запрос продлевает окно.
Открытая на кассе дверь закрывается сама, а работающий специалист не
выбрасывается посреди настройки.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

# Двери. Кассир — это отсутствие повышения, поэтому его здесь нет.
DOOR_OWNER = "owner"
DOOR_SPECIALIST = "specialist"
DOORS = (DOOR_OWNER, DOOR_SPECIALIST)

"""Сколько минут бездействия держится повышение.

Десять минут — столько же, сколько отведено сервисному режиму мастера: специалист
уходит от кассы, не нажав «Выйти», и дверь обязана закрыться сама. Для владельца
срок тот же: его дверь опаснее, а работа за ней короче.
"""
ELEVATION_IDLE_MINUTES = 10


@dataclass(frozen=True)
class Grant:
    door: str
    expires_at: datetime


class ElevationRegistry:
    """Кто и куда сейчас допущен. Живёт ровно столько, сколько процесс."""

    def __init__(self) -> None:
        self._grants: dict[tuple[int, str], datetime] = {}
        # Запросы приходят из разных задач одного цикла событий, но словарь
        # трогают и фоновые проверки — блокировка дешевле рассуждений о том,
        # где именно возможна перестановка.
        self._lock = threading.Lock()

    def grant(self, user_id: int, door: str, minutes: int, now: datetime | None = None) -> Grant:
        moment = now or datetime.now(UTC)
        expires = moment + timedelta(minutes=minutes)
        with self._lock:
            self._grants[(user_id, door)] = expires
        return Grant(door=door, expires_at=expires)

    def check(
        self, user_id: int, door: str, minutes: int, now: datetime | None = None
    ) -> datetime | None:
        """Активна ли дверь. Успешная проверка продлевает окно бездействия."""
        moment = now or datetime.now(UTC)
        with self._lock:
            expires = self._grants.get((user_id, door))
            if expires is None:
                return None
            if expires <= moment:
                # Протухшее убираем сразу: иначе словарь копил бы записи
                # каждого входа за смену.
                self._grants.pop((user_id, door), None)
                return None
            renewed = moment + timedelta(minutes=minutes)
            self._grants[(user_id, door)] = renewed
            return renewed

    def peek(self, user_id: int, door: str, now: datetime | None = None) -> datetime | None:
        """Как `check`, но не продлевает: для плашки в интерфейсе."""
        moment = now or datetime.now(UTC)
        with self._lock:
            expires = self._grants.get((user_id, door))
        return expires if expires and expires > moment else None

    def revoke(self, user_id: int, door: str | None = None) -> None:
        with self._lock:
            if door is None:
                for key in [key for key in self._grants if key[0] == user_id]:
                    self._grants.pop(key, None)
                return
            self._grants.pop((user_id, door), None)

    def clear(self) -> None:
        """Только для тестов: между сценариями состояние не переносится."""
        with self._lock:
            self._grants.clear()


registry = ElevationRegistry()
