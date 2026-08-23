from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from fastapi import Depends, Header, HTTPException, status
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.database import get_db_session
from app.db.models import User

# Пароли и ключи — argon2id.
#
# bcrypt остаётся в списке только для чтения: установки, сделанные до этой
# правки, хранят bcrypt-хэши, и выкинуть схему значило бы запереть владельца
# снаружи собственной кассы. Новые хэши считаются argon2id, а старые
# переписываются при первой же успешной проверке — см. verify_and_upgrade.
#
# Параметры: 64 МБ памяти и 3 прохода. Это осознанный компромисс под кассовый
# моноблок — стандартные для argon2id значения на слабой машине дают заметную
# паузу при входе, а перебор офлайновой базы всё равно упирается в память,
# а не во время.
pwd_context = CryptContext(
    schemes=["argon2", "bcrypt"],
    deprecated=["bcrypt"],
    argon2__type="ID",
    argon2__memory_cost=65536,
    argon2__time_cost=3,
    argon2__parallelism=2,
)
settings = get_settings()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False
    try:
        return pwd_context.verify(password, hashed_password)
    except ValueError:
        # Хэш неизвестного формата — считаем несовпадением, а не падаем:
        # исключение здесь означало бы 500 вместо «неверный пароль».
        return False


def verify_and_upgrade(password: str, hashed_password: str) -> tuple[bool, str | None]:
    """Проверяет секрет и, если хэш устарел, возвращает новый.

    Второй элемент — argon2id-хэш того же секрета, когда исходный был bcrypt;
    иначе None. Вызывающий обязан его сохранить: без этого установка так и
    останется на bcrypt навсегда, потому что другого момента, когда секрет
    известен в открытом виде, у нас нет.
    """
    if not hashed_password:
        return False, None
    try:
        ok, updated = pwd_context.verify_and_update(password, hashed_password)
    except ValueError:
        return False, None
    return ok, updated


# --------------------------------------------------------------------------- #
# Проверка секретов: вне цикла событий и с ограничением одновременных           #
# --------------------------------------------------------------------------- #
#
# Одна проверка argon2id стоит около 120 мс процессорного времени и 64 МБ
# памяти — столько же, сколько она стоит подбирающему, в этом весь её смысл.
# Но цена одинакова и для того, кто просто вводит пароль, и это делает проверку
# опасной в двух отношениях.
#
# Во-первых, `verify_password` синхронная, а вызывается из `async def`: пока она
# считает, событийный цикл стоит целиком, и сервер не отвечает ни на один другой
# запрос — ни кассе, ни печати чека.
#
# Во-вторых, без ограничения число одновременных проверок равно числу
# пришедших запросов. Ошибка в интерфейсе это уже проверила на живом ноутбуке:
# окно ввода отправляло пароль на каждую нажатую букву, и набор шестнадцати
# символов превращался в девять проверок — больше секунды сплошной нагрузки и до
# полугигабайта памяти разом. Машина уходила в своп, и человек видел, что
# «перестал работать весь компьютер».
#
# Отсюда две меры вместе. `to_thread` убирает счёт из цикла событий: касса
# продолжает работать, пока пароль проверяется. Семафор ограничивает
# одновременные проверки, и потребление памяти становится ограниченным сверху
# независимо от того, сколько запросов пришло.
#
# Правильное место для этого — здесь, а не в интерфейсе. Интерфейс уже
# исправлен, но следующая такая ошибка не должна снова доходить до железа.

"""Сколько проверок считается одновременно.

Две: столько же, сколько потоков использует сама argon2id (parallelism=2), то
есть больше ядер этим всё равно не занять. Потолок памяти при этом — 128 МБ,
переживаемо для кассового моноблока. Очередь сверх этого просто ждёт: ждать
дольше лучше, чем уронить машину в своп.
"""
VERIFY_CONCURRENCY = 2

_verify_gate = asyncio.Semaphore(VERIFY_CONCURRENCY)


async def verify_password_async(password: str, hashed_password: str) -> bool:
    """`verify_password`, не занимающая цикл событий и ограниченная по числу."""
    if not hashed_password:
        return False
    async with _verify_gate:
        return await asyncio.to_thread(verify_password, password, hashed_password)


async def verify_and_upgrade_async(
    password: str, hashed_password: str
) -> tuple[bool, str | None]:
    """`verify_and_upgrade` с теми же двумя мерами."""
    if not hashed_password:
        return False, None
    async with _verify_gate:
        return await asyncio.to_thread(verify_and_upgrade, password, hashed_password)


def create_access_token(user: User, extra: dict[str, Any] | None = None) -> str:
    payload: dict[str, Any] = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "exp": datetime.now(UTC) + timedelta(hours=settings.jwt_hours),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_setup_token(extra: dict[str, Any] | None = None) -> str:
    payload: dict[str, Any] = {
        "purpose": "initial_setup",
        "exp": datetime.now(UTC) + timedelta(minutes=30),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def verify_setup_token(token: str) -> dict[str, Any] | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except Exception:  # noqa: BLE001
        return None
    return payload if payload.get("purpose") == "initial_setup" else None


async def get_current_user(
    authorization: str = Header(default=""),
    session: AsyncSession = Depends(get_db_session),
) -> User:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Требуется авторизация.")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = int(payload["sub"])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Токен недействителен.") from exc

    result = await session.execute(select(User).where(User.id == user_id, User.is_active.is_(True)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Пользователь не найден.")
    return user


def require_roles(*roles: str):
    async def _dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles and user.role != "owner":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав.")
        return user

    return _dep
