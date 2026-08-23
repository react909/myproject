"""Единая проверка прав на защищённые маршруты.

Одна зависимость на всё приложение вместо `if role ==` в каждом обработчике:
забыть проверку в новом маршруте так гораздо труднее, а правило видно в
сигнатуре — сразу понятно, за какой дверью живёт этот эндпоинт.

Отказ намеренно скупой: «Недостаточно прав.» и ничего больше. Текст вроде
«нужен пароль владельца» подтверждает, что раздел существует и чем он закрыт, —
это подсказка тому, кто пробует наугад.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, status

from app.core.elevation import (
    DOOR_OWNER,
    DOOR_SPECIALIST,
    ELEVATION_IDLE_MINUTES,
    registry,
)
from app.core.security import get_current_user
from app.db.models import User

DENIED = "Недостаточно прав."


def require_door(door: str):
    """Требует активную повышенную сессию за указанной дверью.

    Роль аккаунта здесь не при чём: на кассе залогинен владелец, а стоит за ней
    кассир. Пропуск даёт только секрет, введённый в этой сессии, — пароль
    владельца или сервисный ключ.
    """

    async def _dep(user: User = Depends(get_current_user)) -> User:
        if registry.check(user.id, door, ELEVATION_IDLE_MINUTES) is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DENIED)
        return user

    return _dep


def require_any_door(*doors: str):
    """Пропускает, если открыта хотя бы одна из дверей."""

    async def _dep(user: User = Depends(get_current_user)) -> User:
        for door in doors:
            if registry.check(user.id, door, ELEVATION_IDLE_MINUTES) is not None:
                return user
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DENIED)

    return _dep


def open_doors(user_id: int) -> set[str]:
    """Какие двери открыты сейчас. Нужна там, где право зависит от поля.

    Не продлевает окно бездействия: продление — дело `require_door`, которая уже
    отработала на входе в маршрут. Иначе одна правка продлевала бы сессию дважды.
    """
    return {door for door in (DOOR_OWNER, DOOR_SPECIALIST) if registry.peek(user_id, door)}


# Готовые зависимости под две двери — чтобы не собирать их в каждом модуле.
require_owner = require_door(DOOR_OWNER)
require_specialist = require_door(DOOR_SPECIALIST)
require_requisites = require_any_door(DOOR_OWNER, DOOR_SPECIALIST)
