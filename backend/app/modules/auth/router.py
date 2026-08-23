from __future__ import annotations

import asyncio
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit
from app.core.elevation import DOORS, ELEVATION_IDLE_MINUTES, registry
from app.core.typing_chain import registry as typing_chain
from app.core.security import (
    create_access_token,
    get_current_user,
    hash_password,
    require_roles,
    verify_and_upgrade_async,
    verify_password_async,
)
from app.db.database import get_db_session
from app.core.access import require_owner
from app.db.models import AuditEntry, OwnerEntryPhoto, StoreSettings, User

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Как долго закрытые разделы остаются открытыми после ввода сервисного PIN.
# Достаточно, чтобы владелец успел посмотреть отчёты, и мало, чтобы касса не
# осталась разблокированной на всю смену.
PIN_UNLOCK_MINUTES = 15

# Задержка на неверный секрет. PIN короткий — четыре цифры перебираются за
# секунды, если сервер отвечает мгновенно, а он локальный.
_WRONG_PASSWORD_DELAY_SECONDS = 0.4

PIN_PATTERN = r"^\d{4,6}$"


def _license_key_matches(supplied: str, activation_key: str) -> bool:
    """Совпадает ли введённое с лицензионным ключом этой установки.

    Лицензионный ключ и есть сервисный: специалиста вызывают с тем же ключом
    вида KASSIR-XXXX-XXXX-XXXX, который вводили при установке. Второй секрет
    «специально для сервиса» на практике теряется первым — его некому помнить,
    потому что приходит установщик, а заводил его владелец полгода назад.

    Ключ у каждой установки свой и в коде не лежит: он приходит с наклейки на
    устройстве и сверяется здесь, на локальном сервере.

    Регистр не значим: ключ выдан заглавными в алфавите без похожих символов
    (см. licensing/activation.py), и требовать точного регистра от человека,
    читающего его с наклейки, незачем.

    Сравнение постоянного времени: строка короткая, но это секрет, и утечка
    через время сравнения здесь ничем не оправдана. Сравниваются байты, а не
    строки: в это поле приходит и то, что человек набрал в окне ключа, а
    `compare_digest` отказывается сравнивать строки с не-ASCII — набранный
    по-русски пароль владельца ронял бы обработчик прямо на проверке.
    """
    stored = (activation_key or "").strip().upper()
    if not stored:
        return False
    return secrets.compare_digest(
        supplied.strip().upper().encode("utf-8"), stored.encode("utf-8")
    )


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    id: int
    username: str
    full_name: str
    role: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, session: AsyncSession = Depends(get_db_session)) -> AuthResponse:
    # Логин владельца — его email, поэтому регистр не должен иметь значения:
    # «Owner@shop.kg» и «owner@shop.kg» — один и тот же человек. Логины
    # сотрудников тоже приводятся к нижнему регистру при создании.
    login_name = payload.username.strip().lower()
    result = await session.execute(select(User).where(User.username == login_name))
    user = result.scalar_one_or_none()
    ok, upgraded = (False, None)
    if user is not None and user.is_active:
        ok, upgraded = await verify_and_upgrade_async(payload.password, user.hashed_password)
    if not ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный логин или пароль.")
    assert user is not None  # выше уже проверено, здесь только для типов
    # Вход — единственный момент, когда пароль известен открытым текстом.
    # Установки со старым bcrypt-хэшем переезжают на argon2id именно здесь и
    # молча: просить владельца сменить пароль ради формата хранения незачем.
    if upgraded:
        user.hashed_password = upgraded
        await session.commit()
    token = create_access_token(user)
    return AuthResponse(
        access_token=token,
        user=UserOut(id=user.id, username=user.username, full_name=user.full_name, role=user.role),
    )


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut(id=user.id, username=user.username, full_name=user.full_name, role=user.role)


# --------------------------------------------------------------------------- #
# Подтверждение личности и сервисный PIN                                       #
# --------------------------------------------------------------------------- #


class PasswordRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class PinRequest(BaseModel):
    # Длина как у пароля, а не как у PIN: на кассах, настроенных до появления
    # PIN, сюда приходит прежний «Пароль доступа». Ограничение в 16 символов
    # отсекало его валидацией раньше, чем дело доходило до проверки хэша, и
    # владелец не мог войти в собственные настройки.
    pin: str = Field(min_length=1, max_length=128)


class OkResponse(BaseModel):
    ok: bool = True


class PinStatusResponse(BaseModel):
    configured: bool
    unlock_minutes: int = PIN_UNLOCK_MINUTES


class PinUnlockResponse(BaseModel):
    # Чей PIN подошёл. Пусто — сработал старый общий PIN установки, у которой
    # сотрудники ещё не заведены.
    user_id: int | None = None
    user_name: str = ""
    ok: bool = True
    unlock_minutes: int = PIN_UNLOCK_MINUTES


class PinChangeRequest(BaseModel):
    # Текущий PIN, а на установках, обновлённых со старых версий, — прежний
    # мастер-пароль или пароль владельца (см. _service_pin_matches).
    current_secret: str = Field(min_length=1, max_length=128)
    new_pin: str = Field(pattern=PIN_PATTERN)

    @model_validator(mode="after")
    def _new_must_differ(self) -> "PinChangeRequest":
        if self.new_pin == self.current_secret:
            raise ValueError("Новый PIN совпадает с текущим.")
        if len(set(self.new_pin)) == 1 or self.new_pin in "0123456789" or self.new_pin in "9876543210":
            raise ValueError("Такой PIN подбирается мгновенно — выберите другой.")
        return self


async def _get_store(session: AsyncSession) -> StoreSettings:
    store = (await session.execute(select(StoreSettings).limit(1))).scalar_one_or_none()
    if store is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Настройка ещё не выполнена.")
    return store


async def _get_owner(session: AsyncSession) -> User | None:
    statement = select(User).where(User.role == "owner", User.is_active.is_(True)).limit(1)
    return (await session.execute(statement)).scalar_one_or_none()


async def _service_pin_matches(session: AsyncSession, store: StoreSettings, secret: str) -> bool:
    """Сервисный PIN, а на обновлённых установках — прежний секрет.

    Порядок отката важен: сначала PIN, затем мастер-пароль прошлой версии, и
    только потом пароль владельца. Без этой цепочки касса, обновившаяся с
    версии без PIN, осталась бы с наглухо закрытыми настройками и без способа
    их открыть — экран смены PIN находится за той же дверью.
    """
    if store.service_pin_hash:
        matched, upgraded = await verify_and_upgrade_async(secret, store.service_pin_hash)
        if matched and upgraded:
            store.service_pin_hash = upgraded
        return matched
    if store.master_password_hash:
        return await verify_password_async(secret, store.master_password_hash)
    owner = await _get_owner(session)
    return owner is not None and await verify_password_async(secret, owner.hashed_password)


@router.post("/verify-password", response_model=OkResponse)
async def verify_own_password(
    payload: PasswordRequest, current: User = Depends(get_current_user)
) -> OkResponse:
    """Переподтверждение личности текущего пользователя — используется при выходе."""
    if not await verify_password_async(payload.password, current.hashed_password):
        await asyncio.sleep(_WRONG_PASSWORD_DELAY_SECONDS)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Неверный пароль.")
    return OkResponse()


@router.get("/pin/status", response_model=PinStatusResponse)
async def pin_status(
    session: AsyncSession = Depends(get_db_session), _: User = Depends(get_current_user)
) -> PinStatusResponse:
    """Есть ли вообще кому подтверждать операции PIN-ом."""
    staff_pins = (
        await session.execute(
            select(func.count(User.id)).where(User.pin_hash != "", User.is_active.is_(True))
        )
    ).scalar_one()
    if staff_pins:
        return PinStatusResponse(configured=True)
    store = await _get_store(session)
    return PinStatusResponse(configured=bool(store.service_pin_hash))


@router.post("/pin/unlock", response_model=PinUnlockResponse)
async def pin_unlock(
    payload: PinRequest,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> PinUnlockResponse:
    """Проверяет PIN кассира.

    PIN теперь у каждого сотрудника свой, и проверка идёт по ним: только так в
    журнале видно, кто именно подтвердил отмену или возврат. Общий PIN на
    установку этого не давал — по журналу все действия выглядели одинаково.

    Роль вошедшего не проверяется намеренно: PIN подтверждает операцию, а не
    вход. Владелец должен уметь подтвердить возврат, не выгоняя кассира из
    смены, и наоборот.

    Старый общий PIN остаётся рабочим для установок, где сотрудников ещё не
    завели: иначе обновление отняло бы у них возможность подтвердить возврат.
    """
    pin = payload.pin.strip()
    staff = (
        (await session.execute(select(User).where(User.pin_hash != "", User.is_active.is_(True))))
        .scalars()
        .all()
    )
    for member in staff:
        matched, upgraded = await verify_and_upgrade_async(pin, member.pin_hash)
        if not matched:
            continue
        if upgraded:
            member.pin_hash = upgraded
        await write_audit(
            session,
            actor=member,
            action="pin.unlock",
            target="кассовая операция",
            actor_kind="cashier",
        )
        await session.commit()
        return PinUnlockResponse(user_id=member.id, user_name=member.full_name or member.username)

    store = await _get_store(session)
    if staff or not await _service_pin_matches(session, store, pin):
        await asyncio.sleep(_WRONG_PASSWORD_DELAY_SECONDS)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Неверный PIN.")
    await session.commit()
    return PinUnlockResponse()


# --------------------------------------------------------------------------- #
# Три ключа: пароль владельца, PIN кассира, сервисный ключ лицензии            #
# --------------------------------------------------------------------------- #
#
# Их роли не пересекаются, и это главное.
#
# * Пароль владельца открывает деньги и необратимое: финансы, аналитику,
#   сотрудников, удаление базы. Его знает один человек. Это отдельный секрет:
#   пароль, которым владелец входит в систему, сюда не подходит и не должен —
#   на кассе под его учётной записью работает смена (см. _owner_password_matches).
# * PIN кассира открывает только кассовые операции — смену, отмену позиции,
#   возврат. Финансов и удаления он не открывает, иначе разделение теряет смысл.
# * Сервисный ключ лицензии открывает настройки оборудования и режима работы.
#   Его знает установщик, а не магазин.
#
# Ниже — двери владельца и специалиста. Дверь кассира это существующий
# /pin/unlock.


# Сколько неверных паролей подряд закрывают дверь и на сколько минут.
OWNER_MAX_ATTEMPTS = 5
"""Пять минут, а не пятнадцать.

Пятнадцать выбирались против перебора, но перебор здесь останавливает не столько
срок, сколько цена одной попытки: проверка стоит 120 мс и 64 МБ, то есть быстрее
восьми догадок в секунду не выйдет при любой блокировке. А платит за длинный
срок владелец, ошибшийся раскладкой у кассы с покупателями в очереди: четверть
часа без финансов и сотрудников — это уже не защита, а простой.

Пять минут перебор не облегчают: даже без единой блокировки на подбор
двенадцатисимвольного пароля ушли бы столетия.
"""
OWNER_LOCK_MINUTES = 5


class ServiceKeyRequest(BaseModel):
    # Здесь длина не ограничивается снизу: ограничение «минимум 8, буквы и
    # цифры» проверяется при задании ключа (setup/router.py), а не при вводе.
    # Отсекать короткий ввод на входе значило бы подсказывать подбирающему,
    # что его догадка не той длины.
    key: str = Field(min_length=1, max_length=128)


class AccessResponse(BaseModel):
    ok: bool = True
    unlock_minutes: int = PIN_UNLOCK_MINUTES


def _as_utc(value: datetime | None) -> datetime | None:
    """Приводит время из базы к UTC-осознанному.

    SQLite не хранит часовой пояс и возвращает наивный datetime, даже когда
    колонка объявлена как DateTime(timezone=True). Сравнение такого значения с
    datetime.now(UTC) бросает TypeError — а поскольку это происходило внутри
    проверки блокировки, дверь владельца после пятой неудачной попытки
    переставала открываться вообще, включая верный пароль.
    """
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


async def _owner_password_matches(
    store: StoreSettings, supplied: str
) -> tuple[bool, str | None]:
    """Совпадает ли введённое с паролем владельца этой установки.

    Единственное место, где этот секрет сверяется, — и оно намеренно не знает
    ничего про таблицу пользователей. Пароль учётной записи сюда не подходит и
    подходить не должен: это два разных ключа от двух разных дверей, и любая
    «на всякий случай» проверка второго свела бы разделение ролей к нулю.

    Пустой хэш — пароль владельца ещё не задан. Такое возможно только на базе,
    где мастер установки не доходил до конца: миграция 0023 переносит хэш с
    учётной записи всем, у кого владелец есть. Открывать дверь в этом случае
    нечем, и подставлять вместо него пароль входа — ровно та ошибка, от которой
    уходим.

    Возвращает пару «подошло, обновлённый хэш»: вход — единственный момент,
    когда пароль известен открытым текстом, и старый bcrypt здесь переезжает на
    argon2id молча.

    Проверка асинхронная: одна argon2id стоит около 120 мс и 64 МБ, а
    синхронный вызов занял бы на это время весь событийный цикл сервера — касса
    и печать чека встали бы вместе с ним (см. core/security.py).
    """
    if not store.owner_password_hash:
        return False, None
    return await verify_and_upgrade_async(supplied, store.owner_password_hash)


async def _write_audit(
    session: AsyncSession,
    *,
    actor_kind: str,
    actor_name: str,
    action: str,
    target: str = "",
    old_value: str = "",
    new_value: str = "",
) -> None:
    session.add(
        AuditEntry(
            actor_kind=actor_kind,
            actor_name=actor_name,
            action=action,
            target=target,
            old_value=old_value,
            new_value=new_value,
        )
    )


@router.post("/owner/unlock", response_model=AccessResponse)
async def owner_unlock(
    payload: PasswordRequest,
    session: AsyncSession = Depends(get_db_session),
    current: User = Depends(get_current_user),
) -> AccessResponse:
    """Дверь владельца: финансы, аналитика, сотрудники, удаление данных.

    Проверяется **пароль владельца** — отдельный секрет из мастера установки, а
    не пароль учётной записи и не пароль того, кто сейчас в смене.

    Разница принципиальная. На кассе почти всегда залогинен аккаунт владельца, а
    за клавиатурой стоит кассир: пароль входа владелец диктует по телефону
    («зайди под моим, пробей возврат»), и пока эта дверь открывалась им, вместе с
    возвратом человек получал финансы, аналитику и сотрудников. Теперь секреты
    независимы, и смена пароля входа не трогает пароль владельца.

    Перебор ограничен пятью попытками — дальше дверь закрывается на четверть
    часа. Счётчик свой: неудача здесь не должна закрывать дверь специалиста.
    """
    store = await _get_store(session)
    now = datetime.now(UTC)

    locked_until = _as_utc(store.owner_locked_until)
    if locked_until and locked_until > now:
        left = int((locked_until - now).total_seconds() // 60) + 1
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Слишком много неверных попыток. Повторите через {left} мин.",
        )

    supplied = payload.password

    # Длина не совпала — это не пароль, и argon2 здесь не нужна.
    #
    # Отсечение стоит доли миллисекунды вместо 120 мс и 64 МБ, и именно оно
    # позволяет окну отправлять набранное сразу, без ожидания паузы: всё, что
    # человек набрал по дороге к своему паролю, отваливается здесь даром. Так
    # за один ввод остаётся ровно одна дорогая проверка — та, где длина сошлась.
    #
    # Попыткой это не считается и в журнал не пишется: значение заведомо не
    # могло подойти, и наказывать за него нечем. Длину этим можно нащупать, но
    # она и так видна — окно рисует по кружку на символ (см. миграцию 0024).
    if store.owner_password_length and len(supplied) != store.owner_password_length:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Неверный пароль владельца."
        )

    owner_ok, owner_upgraded = await _owner_password_matches(store, supplied)
    if not owner_ok:
        # Продолжение набора — не догадка.
        #
        # Окно вводит секрет без кнопки «Войти» и отправляет набранное сразу,
        # поэтому длинный пароль доезжает сюда по частям: «Vlad», «Vladel»,
        # «Vladelec»… Считать каждую часть попыткой значит запирать владельца
        # его же правильным паролем на пятом символе. Разбор, почему это не
        # ослабляет защиту от перебора, — в core/typing_chain.py.
        typing = typing_chain.is_continuation(current.id, "owner", supplied)
        if not typing:
            # Пауза только на настоящей догадке: тормозить набор бессмысленно,
            # а перебор она по-прежнему делает бесполезным.
            await asyncio.sleep(_WRONG_PASSWORD_DELAY_SECONDS)
            store.owner_failed_attempts += 1
            if store.owner_failed_attempts >= OWNER_MAX_ATTEMPTS:
                store.owner_locked_until = now + timedelta(minutes=OWNER_LOCK_MINUTES)
                store.owner_failed_attempts = 0
            # В журнал тоже попадает только догадка: иначе один набранный
            # пароль оставлял бы в нём десяток строк «отказано» и прятал
            # настоящие попытки подбора среди шума.
            await _write_audit(
                session,
                actor_kind="owner",
                actor_name=current.username,
                action="access.denied",
                target="owner_settings",
            )
        typing_chain.remember(current.id, "owner", supplied)
        await session.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Неверный пароль владельца.")

    # Вошли — цепочка набора больше не нужна.
    typing_chain.clear(current.id, "owner")
    # Единственный момент, когда пароль известен открытым текстом, — здесь же
    # проставляется его длина установкам, которые обновились со старой версии.
    # Дальше их дверь работает так же быстро, как у новых.
    if not store.owner_password_length:
        store.owner_password_length = len(supplied)
    store.owner_failed_attempts = 0
    store.owner_locked_until = None
    # Прямая дверь владельца (аккорд за ноутбуком) выдаёт то же повышение, что
    # и общее окно: маршруты проверяют его, а не то, каким путём человек вошёл.
    registry.grant(current.id, "owner", ELEVATION_IDLE_MINUTES)
    # Пароль здесь известен открытым текстом — момент перевести старый
    # bcrypt-хэш на argon2id, другого такого не будет.
    if owner_upgraded:
        store.owner_password_hash = owner_upgraded
    await _write_audit(
        session,
        actor_kind="owner",
        actor_name=current.username,
        action="access.granted",
        target="owner_settings",
    )
    await session.commit()
    return AccessResponse()


@router.post("/owner/lockout/lift", response_model=OkResponse)
async def owner_lockout_lift(
    payload: PasswordRequest,
    session: AsyncSession = Depends(get_db_session),
    current: User = Depends(get_current_user),
) -> OkResponse:
    """Снимает блокировку двери владельца паролем учётной записи.

    Зачем. После пяти неверных попыток дверь закрывается на несколько минут, и
    владелец, промахнувшийся раскладкой у кассы с очередью, вынужден стоять и
    ждать. Паролем от своего аккаунта он подтверждает, что это действительно он,
    и пробует снова сразу.

    И вот чего этот маршрут НЕ делает: он не открывает кабинет. Повышение здесь
    не выдаётся ни при каких условиях — снимается только таймер, после чего
    по-прежнему нужен пароль владельца.

    Разница принципиальная, и ради неё маршрут отдельный. Если бы пароль входа
    после блокировки пускал внутрь, разделение секретов исчезло бы совсем:
    кассир, знающий пароль от кассы, пять раз ошибся бы нарочно — и получил
    финансы. Дверь открывает только пароль владельца, всегда.

    Проверяется пароль учётной записи владельца, а не того, кто сейчас в смене:
    дверь его, и снимать с неё блокировку тоже ему.

    Записывается в журнал: частые снятия — признак того, что пароль владельца
    подбирают, и владелец должен это увидеть.
    """
    store = await _get_store(session)
    owner = await _get_owner(session)
    matched = owner is not None and await verify_password_async(
        payload.password, owner.hashed_password
    )
    if not matched:
        await asyncio.sleep(_WRONG_PASSWORD_DELAY_SECONDS)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Неверный пароль входа.")

    store.owner_failed_attempts = 0
    store.owner_locked_until = None
    # Цепочка набора тоже гасится: после снятия блокировки набор начинается
    # заново, и обрывки прошлых попыток к нему не относятся.
    typing_chain.clear(current.id, "owner")
    await _write_audit(
        session,
        actor_kind="owner",
        actor_name=current.username,
        action="access.lockout_lifted",
        target="owner_settings",
    )
    await session.commit()
    return OkResponse()


# --------------------------------------------------------------------------- #
# Фотофиксация входов в кабинет владельца                                      #
# --------------------------------------------------------------------------- #
#
# Не распознавание и не защита: дверь по-прежнему открывает только пароль
# владельца. Это след — владелец видит, кто заходил в его финансы. Для магазина,
# где деньги смотрит один человек, а за кассой стоит смена, след работает не хуже
# замка: подобрать пароль незаметно больше нельзя.

"""Сколько снимков хранится.

Полсотни — это примерно месяц работы магазина, где владелец заглядывает в
финансы раз в день. Дальше старые удаляются: база ездит в резервных копиях, и
расти ей бесконечно нельзя.
"""
ENTRY_PHOTOS_KEPT = 50

"""Потолок размера снимка.

Кадр 320×240 в JPEG — это 20–40 КБ, в data URL примерно на треть больше. Сто
килобайт с запасом покрывают это и отсекают попытку положить в журнал
что-нибудь другое.
"""
ENTRY_PHOTO_MAX_CHARS = 100_000

_JPEG_DATA_URL = "data:image/jpeg;base64,"


class EntryPhotoRequest(BaseModel):
    image: str = Field(min_length=1, max_length=ENTRY_PHOTO_MAX_CHARS)


@router.post("/owner/entry-photo", response_model=OkResponse, status_code=status.HTTP_201_CREATED)
async def owner_entry_photo(
    payload: EntryPhotoRequest,
    session: AsyncSession = Depends(get_db_session),
    current: User = Depends(require_owner),
) -> OkResponse:
    """Кладёт снимок вошедшего в кабинет и отмечает это в журнале.

    За дверью владельца (`require_owner`): снимок относится к уже состоявшемуся
    входу, и слать его может только тот, кто вошёл. Иначе журнал можно было бы
    засыпать чужими картинками, не зная ни одного секрета.

    Формат проверяется явно. Здесь принимается только JPEG в data URL — не
    потому, что другие хуже, а потому, что принимать «что пришлют» в поле,
    которое потом покажут владельцу в браузере, нельзя: SVG, например, это
    исполняемая разметка.
    """
    image = payload.image.strip()
    if not image.startswith(_JPEG_DATA_URL):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ожидается снимок JPEG.",
        )

    session.add(OwnerEntryPhoto(actor_name=current.username, image=image))
    await session.flush()

    # Старые снимки убираем здесь же: отдельной уборки в кассе нет, а расти
    # бесконечно таблица не должна.
    keep = (
        select(OwnerEntryPhoto.id)
        .order_by(OwnerEntryPhoto.id.desc())
        .limit(ENTRY_PHOTOS_KEPT)
        .scalar_subquery()
    )
    await session.execute(delete(OwnerEntryPhoto).where(OwnerEntryPhoto.id.not_in(keep)))

    await _write_audit(
        session,
        actor_kind="owner",
        actor_name=current.username,
        action="access.photo",
        target="owner_settings",
    )
    await session.commit()
    return OkResponse()


class EntryPhotoOut(BaseModel):
    id: int
    actor_name: str
    image: str
    created_at: str | None = None


@router.get("/owner/entry-photo", response_model=list[EntryPhotoOut])
async def list_owner_entry_photos(
    limit: int = 20,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(require_owner),
) -> list[EntryPhotoOut]:
    """Последние снимки входов — их смотрит владелец, и только он."""
    rows = (
        (
            await session.execute(
                select(OwnerEntryPhoto)
                .order_by(OwnerEntryPhoto.created_at.desc())
                .limit(max(1, min(ENTRY_PHOTOS_KEPT, limit)))
            )
        )
        .scalars()
        .all()
    )
    return [
        EntryPhotoOut(
            id=row.id,
            actor_name=row.actor_name,
            image=row.image,
            created_at=row.created_at.isoformat() if row.created_at else None,
        )
        for row in rows
    ]


class OwnerHintResponse(BaseModel):
    """Сколько символов в пароле владельца. `null` — длина ещё неизвестна."""

    length: int | None = None


@router.get("/owner/hint", response_model=OwnerHintResponse)
async def owner_hint(
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> OwnerHintResponse:
    """Длина пароля владельца — чтобы окно знало, когда его отправлять.

    Так работает ввод кода на телефоне: длина известна заранее, и код уходит на
    проверку ровно в момент последнего символа — не по таймеру и не по кнопке.
    Здесь то же самое, и это единственный способ сделать вход мгновенным, не
    запуская дорогую проверку на каждый набранный символ.

    Отдавать длину не опасно: окно рисует по кружку на символ, то есть её и так
    видно всякому, кто стоит рядом. Самого пароля здесь нет ни в каком виде.
    `null` — установка старше миграции 0024; окно тогда работает по паузе, а
    длина проставится сама при первом успешном входе.
    """
    store = await _get_store(session)
    return OwnerHintResponse(length=store.owner_password_length or None)


@router.post("/service-key/unlock", response_model=AccessResponse)
async def service_key_unlock(
    payload: ServiceKeyRequest,
    session: AsyncSession = Depends(get_db_session),
    current: User = Depends(get_current_user),
) -> AccessResponse:
    """Дверь специалиста: оборудование, режим работы, лицензия, мастер регистрации.

    Подходят два ключа, и оба — секреты этой установки:

    * лицензионный ключ вида KASSIR-XXXX-XXXX-XXXX, который вводили при
      установке. Это основной путь: специалист приезжает именно с ним;
    * ключ, который владелец завёл себе сам при установке (минимум 8 символов,
      буквы и цифры), — если заводил. Хранится хэшем, в открытом виде нигде.

    Регистр значим у собственного ключа владельца и не значим у лицензионного:
    первый человек придумывает сам, и приведение к верхнему регистру вчетверо
    сузило бы перебор; второй выдан заглавными и читается с наклейки.

    Перебор ограничен так же, как у владельца: пять попыток, дальше четверть
    часа. Ключ длиннее, но дверь за ним не менее опасная — за ней повторный
    проход мастера регистрации, то есть всё устройство.
    """
    store = await _get_store(session)
    now = datetime.now(UTC)

    locked_until = _as_utc(store.service_locked_until)
    if locked_until and locked_until > now:
        left = int((locked_until - now).total_seconds() // 60) + 1
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Слишком много неверных попыток. Повторите через {left} мин.",
        )

    supplied = payload.key.strip()

    matched = False
    if store.service_key_hash:
        matched, upgraded = await verify_and_upgrade_async(supplied, store.service_key_hash)
        if matched and upgraded:
            store.service_key_hash = upgraded

    # Лицензионный ключ открывает ту же дверь — и тогда, когда владелец завёл
    # себе отдельный сервисный ключ. Специалист приезжает с ключом установки, а
    # не с секретом, который придумал владелец: заставлять его искать второй
    # ключ значит не пустить его к оборудованию вовсе.
    if not matched and _license_key_matches(supplied, store.activation_key):
        matched = True
        # Хэша ещё нет — установка старше этой двери: заводим его на месте,
        # чтобы дальше сверялся хэш, а не открытая строка.
        if not store.service_key_hash:
            store.service_key_hash = hash_password(supplied)

    if not matched:
        await asyncio.sleep(_WRONG_PASSWORD_DELAY_SECONDS)
        store.service_failed_attempts += 1
        if store.service_failed_attempts >= OWNER_MAX_ATTEMPTS:
            store.service_locked_until = now + timedelta(minutes=OWNER_LOCK_MINUTES)
            store.service_failed_attempts = 0
        await _write_audit(
            session,
            actor_kind="specialist",
            actor_name=current.username,
            action="access.denied",
            target="specialist_settings",
        )
        await session.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Неверный сервисный ключ.")

    store.service_failed_attempts = 0
    store.service_locked_until = None
    registry.grant(current.id, "specialist", ELEVATION_IDLE_MINUTES)

    await _write_audit(
        session,
        actor_kind="specialist",
        actor_name=current.username,
        action="access.granted",
        target="specialist_settings",
    )
    await session.commit()
    return AccessResponse()


# ---- Окно «Служебный доступ»: одно поле, две двери, общий счётчик ----


class AccessSecretRequest(BaseModel):
    # Ни ключ, ни пароль — просто «секрет»: по имени поля не должно быть видно,
    # что именно ждут. Нижняя граница минимальная: отказ «слишком коротко»
    # подсказывал бы длину настоящего секрета.
    secret: str = Field(min_length=1, max_length=128)


class AccessOpenedResponse(BaseModel):
    """Какая дверь открылась. По ней интерфейс решает, куда вести."""

    door: str = Field(pattern="^(owner|specialist)$")
    unlock_minutes: int = PIN_UNLOCK_MINUTES


"""Сколько неудач подряд закрывают окно «Служебный доступ».

Семь, а не пять, как у отдельных дверей, и это следствие общего счётчика: одно
окно на две роли означает, что опечатки специалиста закрывают заодно и дверь
владельца. Пять попыток на ключ из букв и цифр, набираемый экранной
клавиатурой с переключением раскладки, — это мало: промах по регистру и
раскладке съедает половину лимита.

Безопасность от этого не страдает. Перебор здесь останавливает не столько
лимит, сколько нарастающая пауза: к седьмой попытке ответ идёт восемь секунд,
то есть быстрее сотни попыток в час не выйдет при любом лимите. А прямые двери
(аккорд владельца и отдельная проверка ключа) сохраняют прежние пять попыток —
подобрать пароль владельца через это окно не легче, чем через его собственное.
"""
ACCESS_MAX_ATTEMPTS = 7

"""Нарастающая задержка после трёх неудач подряд.

Первые три попытки отвечают быстро: человек ошибается раскладкой или регистром,
и наказывать за это ожиданием незачем. Дальше пауза удваивается — перебор
становится бессмысленным задолго до блокировки, а живой специалист разницы
почти не замечает: к четвёртой попытке он уже смотрит на бумажку с ключом.
"""
ACCESS_DELAY_AFTER = 3
ACCESS_DELAY_MAX_SECONDS = 8.0


def access_delay_seconds(failed_attempts: int) -> float:
    """Пауза перед ответом на неудачную попытку номер `failed_attempts`."""
    if failed_attempts <= ACCESS_DELAY_AFTER:
        return _WRONG_PASSWORD_DELAY_SECONDS
    growth = 2.0 ** (failed_attempts - ACCESS_DELAY_AFTER)
    return min(ACCESS_DELAY_MAX_SECONDS, growth)


@router.post("/access/unlock", response_model=AccessOpenedResponse)
async def access_unlock(
    payload: AccessSecretRequest,
    session: AsyncSession = Depends(get_db_session),
    current: User = Depends(get_current_user),
) -> AccessOpenedResponse:
    """Одно окно на обе скрытые двери: куда пустит, решает сам секрет.

    Так устроен вход жестом на логотипе: поля два не нужны, а спрашивать «вы
    кто?» до ввода — лишний шаг у кассы. Сервисный ключ открывает настройку
    оборудования и мастер, пароль владельца — финансы и сотрудников.

    Счётчик неудач общий на окно. Раздельные счётчики означали бы, что одна
    опечатка засчитывается обеим дверям сразу, и пять опечаток закрывают в том
    числе ту дверь, к которой человек не прикасался.

    В журнал пишется каждая попытка — и удачная, и нет. Самого секрета там нет
    ни в каком виде: ни целиком, ни частями, ни длиной.
    """
    store = await _get_store(session)
    now = datetime.now(UTC)

    locked_until = _as_utc(store.access_locked_until)
    if locked_until and locked_until > now:
        left = int((locked_until - now).total_seconds() // 60) + 1
        await _write_audit(
            session,
            actor_kind="specialist",
            actor_name=current.username,
            action="access.locked",
            target="hidden_settings",
        )
        await session.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Слишком много неверных попыток. Повторите через {left} мин.",
        )

    supplied = payload.secret.strip()
    opened: str | None = None

    # Сначала сервисный ключ: специалист приходит к кассе чаще, чем владелец
    # открывает отчёты жестом. Порядок здесь ни на что не влияет — счётчик
    # общий, и неудача засчитывается один раз после обеих проверок.
    if store.service_key_hash:
        matched, upgraded = await verify_and_upgrade_async(supplied, store.service_key_hash)
        if matched:
            opened = "specialist"
            if upgraded:
                store.service_key_hash = upgraded

    # Лицензионный ключ — тот же сервисный ключ, см. _license_key_matches.
    if opened is None and _license_key_matches(supplied, store.activation_key):
        opened = "specialist"
        if not store.service_key_hash:
            store.service_key_hash = hash_password(supplied)

    if opened is None:
        # Пароль владельца, а не пароль учётной записи. Это окно осталось ради
        # установок со старой сборкой интерфейса, но правило у него то же, что и
        # у отдельной двери: пароль входа не открывает финансы (см.
        # _owner_password_matches).
        matched, upgraded = await _owner_password_matches(store, supplied)
        if matched:
            opened = "owner"
            if upgraded:
                store.owner_password_hash = upgraded

    if opened is None:
        store.access_failed_attempts += 1
        attempts = store.access_failed_attempts
        if attempts >= ACCESS_MAX_ATTEMPTS:
            store.access_locked_until = now + timedelta(minutes=OWNER_LOCK_MINUTES)
            store.access_failed_attempts = 0
        await _write_audit(
            session,
            actor_kind="specialist",
            actor_name=current.username,
            action="access.denied",
            target="hidden_settings",
            new_value=f"попытка {attempts} из {ACCESS_MAX_ATTEMPTS}",
        )
        await session.commit()
        # Пауза после записи в журнал и до ответа: держать открытой транзакцию
        # всё это время незачем.
        await asyncio.sleep(access_delay_seconds(attempts))
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            # Ни слова о том, что именно не подошло: подсказка «это не ключ»
            # сама по себе сужает перебор вдвое.
            detail="Не подошло. Проверьте раскладку и регистр.",
        )

    store.access_failed_attempts = 0
    store.access_locked_until = None
    # Повышение выдаёт сервер и держит его у себя: интерфейс о правах только
    # рассказывает, решает всегда бэкенд (см. core/elevation.py).
    registry.grant(current.id, opened, ELEVATION_IDLE_MINUTES)
    await _write_audit(
        session,
        actor_kind=opened,
        actor_name=current.username,
        action="access.granted",
        target="hidden_settings",
    )
    await session.commit()
    return AccessOpenedResponse(door=opened, unlock_minutes=ELEVATION_IDLE_MINUTES)


class AccessStateResponse(BaseModel):
    """Что сейчас открыто. По этому интерфейс рисует плашку режима."""

    doors: list[str] = []
    expires_in_seconds: int = 0


@router.get("/access/state", response_model=AccessStateResponse)
async def access_state(current: User = Depends(get_current_user)) -> AccessStateResponse:
    """Открытые двери текущей сессии.

    Не продлевает окно бездействия: плашка опрашивает состояние по таймеру, и
    продлевай она сессию — та не закрылась бы никогда.
    """
    now = datetime.now(UTC)
    doors: list[str] = []
    longest = 0
    for door in DOORS:
        expires = registry.peek(current.id, door, now)
        if expires is None:
            continue
        doors.append(door)
        longest = max(longest, int((expires - now).total_seconds()))
    return AccessStateResponse(doors=doors, expires_in_seconds=longest)


@router.post("/access/leave", response_model=OkResponse)
async def access_leave(
    session: AsyncSession = Depends(get_db_session),
    current: User = Depends(get_current_user),
) -> OkResponse:
    """Выход из повышенного режима по кнопке.

    Закрывает обе двери разом: человек нажимает «Выйти из режима», а не
    «выйти из режима специалиста, оставив режим владельца».
    """
    opened = [door for door in DOORS if registry.peek(current.id, door) is not None]
    registry.revoke(current.id)
    for door in opened:
        await _write_audit(
            session,
            actor_kind=door,
            actor_name=current.username,
            action="access.left",
            target="hidden_settings",
        )
    if opened:
        await session.commit()
    return OkResponse()


class AuditRequest(BaseModel):
    actor_kind: str = Field(default="owner", pattern="^(owner|specialist)$")
    action: str = Field(min_length=1, max_length=64)
    target: str = Field(default="", max_length=128)
    old_value: str = Field(default="", max_length=2000)
    new_value: str = Field(default="", max_length=2000)


@router.post("/audit", response_model=OkResponse, status_code=status.HTTP_201_CREATED)
async def record_audit(
    payload: AuditRequest,
    session: AsyncSession = Depends(get_db_session),
    current: User = Depends(get_current_user),
) -> OkResponse:
    """Запись об изменении в скрытых настройках."""
    await _write_audit(
        session,
        actor_kind=payload.actor_kind,
        actor_name=current.username,
        action=payload.action,
        target=payload.target,
        old_value=payload.old_value,
        new_value=payload.new_value,
    )
    await session.commit()
    return OkResponse()


@router.get("/audit")
async def list_audit(
    limit: int = 200,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(require_roles("owner", "admin")),
) -> dict:
    rows = (
        (
            await session.execute(
                select(AuditEntry).order_by(AuditEntry.created_at.desc()).limit(max(1, min(1000, limit)))
            )
        )
        .scalars()
        .all()
    )
    return {
        "entries": [
            {
                "id": row.id,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "actor_kind": row.actor_kind,
                "actor_name": row.actor_name,
                "action": row.action,
                "target": row.target,
                "old_value": row.old_value,
                "new_value": row.new_value,
            }
            for row in rows
        ]
    }


@router.post("/pin/change", response_model=OkResponse)
async def pin_change(
    payload: PinChangeRequest,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(require_roles("owner")),
) -> OkResponse:
    store = await _get_store(session)
    if not await _service_pin_matches(session, store, payload.current_secret):
        await asyncio.sleep(_WRONG_PASSWORD_DELAY_SECONDS)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Неверный текущий PIN.")
    owner = await _get_owner(session)
    if owner is not None and verify_password(payload.new_pin, owner.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Сервисный PIN должен отличаться от пароля входа.",
        )
    store.service_pin_hash = hash_password(payload.new_pin)
    # Прежний мастер-пароль больше не действует — иначе у установки осталось бы
    # два рабочих секрета, и смена PIN ничего бы не закрывала.
    store.master_password_hash = ""
    await session.commit()
    return OkResponse()
