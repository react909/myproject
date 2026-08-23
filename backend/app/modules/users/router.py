"""Сотрудники магазина: кассиры, их PIN и права.

PIN задаётся здесь, а не при установке. На шаге регистрации кассиров ещё нет —
магазин только заводится, и спрашивать PIN человека, которого ещё не наняли,
значит получить PIN, который потом знают все.

PIN у каждого свой. Общий PIN на установку означал, что по журналу нельзя
сказать, кто именно отменил чек, — а ровно для этого журнал и ведётся.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access import require_owner
from app.core.audit import write_audit
from app.core.security import get_current_user, hash_password, verify_password_async
from app.db.database import get_db_session
from app.db.models import User
from app.modules.users.permissions import (
    PERMISSIONS,
    normalize_permissions,
    parse_permissions,
)

router = APIRouter(prefix="/api/users", tags=["users"])

# Очевидные PIN подбираются взглядом через плечо за одну смену.
_WEAK_PINS = {"1234", "0000", "1111", "4321", "123456", "654321", "000000", "111111"}


def _validate_pin(pin: str) -> str:
    pin = pin.strip()
    if not pin.isdigit() or not 4 <= len(pin) <= 6:
        raise ValueError("PIN кассира — от 4 до 6 цифр.")
    if pin in _WEAK_PINS or len(set(pin)) == 1:
        raise ValueError("Такой PIN подбирается мгновенно — выберите другой.")
    return pin


class PermissionOut(BaseModel):
    key: str
    label: str


class UserOut(BaseModel):
    id: int
    username: str
    full_name: str
    role: str
    is_active: bool
    # Сам PIN не возвращается никогда — только факт, что он задан.
    has_pin: bool
    permissions: list[str]


class UserCreate(BaseModel):
    """Новый сотрудник. Логин и пароль нужны для входа в приложение,
    PIN — для подтверждения кассовых операций на уже открытой смене."""

    username: str = Field(min_length=2, max_length=255)
    password: str = Field(min_length=4, max_length=128)
    full_name: str = Field(default="", max_length=255)
    role: str = Field(default="cashier", pattern="^(admin|cashier)$")
    pin: str | None = Field(default=None, max_length=6)
    permissions: list[str] | None = None

    @field_validator("pin")
    @classmethod
    def _check_pin(cls, value: str | None) -> str | None:
        return _validate_pin(value) if value else None


class UserUpdate(BaseModel):
    full_name: str | None = None
    role: str | None = Field(default=None, pattern="^(admin|cashier|owner)$")
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=4, max_length=128)
    # Пусто — PIN не трогаем. Чтобы снять PIN, передаётся пустая строка.
    pin: str | None = Field(default=None, max_length=6)
    permissions: list[str] | None = None

    @field_validator("pin")
    @classmethod
    def _check_pin(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return value
        return _validate_pin(value)


class UserDeleteRequest(BaseModel):
    # Re-confirms it's really the owner acting, not just an unattended
    # session — deleting a staff account is destructive and immediate.
    password: str = Field(min_length=1, max_length=128)


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        has_pin=bool(user.pin_hash),
        permissions=parse_permissions(user.permissions),
    )


@router.get("/permissions", response_model=list[PermissionOut])
async def list_permissions(_: User = Depends(get_current_user)) -> list[PermissionOut]:
    """Справочник прав. Интерфейс рисует галочки по нему, а не своим списком."""
    return [PermissionOut(key=key, label=label) for key, label in PERMISSIONS.items()]


@router.get("", response_model=list[UserOut])
async def list_users(
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(require_owner),
) -> list[UserOut]:
    """Список сотрудников — дверь владельца: там PIN-статусы и права."""
    rows = (await session.execute(select(User).order_by(User.id))).scalars().all()
    return [_user_out(u) for u in rows]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    session: AsyncSession = Depends(get_db_session),
    current: User = Depends(require_owner),
) -> UserOut:
    # Логины приводятся к нижнему регистру: владелец входит по email, и
    # «Kassir1@…» не должен становиться вторым аккаунтом рядом с «kassir1@…».
    username = payload.username.strip().lower()
    exists = (await session.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Логин занят.")
    if payload.pin and await _pin_taken(session, payload.pin):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Такой PIN уже у другого сотрудника — по журналу их будет не различить.",
        )
    permissions = normalize_permissions(payload.permissions)
    user = User(
        username=username,
        full_name=payload.full_name.strip(),
        hashed_password=hash_password(payload.password),
        role=payload.role,
        pin_hash=hash_password(payload.pin) if payload.pin else "",
        permissions=permissions,
    )
    session.add(user)
    await write_audit(
        session,
        actor=current,
        action="staff.created",
        target=payload.full_name.strip() or username,
        new_value=f"role={payload.role}; permissions={permissions}; pin={'задан' if payload.pin else 'нет'}",
    )
    await session.commit()
    await session.refresh(user)
    return _user_out(user)


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    payload: UserUpdate,
    session: AsyncSession = Depends(get_db_session),
    current: User = Depends(require_owner),
) -> UserOut:
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден.")
    if user.role == "owner" and current.role != "owner":
        raise HTTPException(status_code=403, detail="Нельзя менять владельца.")

    before = {
        "full_name": user.full_name,
        "role": user.role,
        "is_active": user.is_active,
        "permissions": user.permissions,
        "pin": "задан" if user.pin_hash else "нет",
    }

    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.role is not None and user.role != "owner":
        user.role = payload.role
    if payload.is_active is not None and user.role != "owner":
        user.is_active = payload.is_active
    if payload.password:
        user.hashed_password = hash_password(payload.password)
    if payload.permissions is not None:
        user.permissions = normalize_permissions(payload.permissions)
    if payload.pin is not None:
        if payload.pin == "":
            user.pin_hash = ""
        else:
            if await _pin_taken(session, payload.pin, exclude_id=user.id):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Такой PIN уже у другого сотрудника — по журналу их будет не различить.",
                )
            user.pin_hash = hash_password(payload.pin)

    after = {
        "full_name": user.full_name,
        "role": user.role,
        "is_active": user.is_active,
        "permissions": user.permissions,
        "pin": "задан" if user.pin_hash else "нет",
    }
    changed = [key for key in after if before[key] != after[key]]
    if changed:
        await write_audit(
            session,
            actor=current,
            action="staff.updated",
            target=user.full_name or user.username,
            old_value="; ".join(f"{k}={before[k]}" for k in changed),
            new_value="; ".join(f"{k}={after[k]}" for k in changed),
        )
    await session.commit()
    await session.refresh(user)
    return _user_out(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    payload: UserDeleteRequest,
    session: AsyncSession = Depends(get_db_session),
    current: User = Depends(require_owner),
) -> None:
    if not await verify_password_async(payload.password, current.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный пароль владельца.")
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден.")
    if user.role == "owner" or user.id == current.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Владельца нельзя удалить здесь — используйте сброс кассы в настройках.",
        )
    name = user.full_name or user.username
    await session.delete(user)
    await write_audit(session, actor=current, action="staff.deleted", target=name)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="За этим сотрудником есть продажи или смены — удалить нельзя. Деактивируйте аккаунт вместо этого.",
        ) from exc


async def _pin_taken(session: AsyncSession, pin: str, exclude_id: int | None = None) -> bool:
    """Занят ли такой PIN другим сотрудником.

    Хэши сравнить нельзя — у argon2 своя соль на каждый, поэтому перебираем
    активных сотрудников с заданным PIN. Их единицы, это дешевле, чем хранить
    PIN в виде, допускающем сравнение.

    Перебор идёт через асинхронную проверку, и это не украшение: одна argon2id
    стоит около 120 мс, а здесь их столько же, сколько сотрудников. Синхронный
    цикл занимал бы событийный цикл на секунду при десятке кассиров — касса и
    печать чека вставали бы каждый раз, когда владелец заводит нового
    сотрудника (см. core/security.py).
    """
    rows = (
        (await session.execute(select(User).where(User.pin_hash != "")))
        .scalars()
        .all()
    )
    for member in rows:
        if member.id == exclude_id:
            continue
        if await verify_password_async(pin, member.pin_hash):
            return True
    return False
