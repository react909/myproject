from __future__ import annotations

import asyncio
import re
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access import require_owner
from app.core.config import get_settings
from app.core.security import (
    create_access_token,
    create_setup_token,
    require_roles,
    verify_password_async,
    verify_setup_token,
)
from app.db.database import get_db_session
from app.db.models import (
    AuditEntry,
    Category,
    DebtPayment,
    Expense,
    ExpenseCategory,
    OwnerEntryPhoto,
    PaymentEvent,
    PaymentIntent,
    PaymentSecret,
    Product,
    Sale,
    SaleCounter,
    SaleItem,
    Shift,
    StockMove,
    StoreImage,
    StoreSettings,
    SyncLogEntry,
    SyncPkMap,
    User,
)
from app.modules.licensing.activation import canonical_key, hardware_matches, hash_hardware_id, verify_key
from app.modules.licensing.service import LicensePlan
from app.modules.setup.repository import SetupRepository
from app.modules.setup.images import load_images
from app.modules.setup.schema import OnboardingData, from_store
from app.modules.setup.service import (
    Activation,
    OwnerAccount,
    SetupAlreadyCompletedError,
    SetupService,
)

router = APIRouter(prefix="/api/setup", tags=["setup"])
settings = get_settings()


class SetupStatusResponse(BaseModel):
    needs_setup: bool
    needs_reactivation: bool = False
    setup_version: int = 0
    database_ready: bool = True
    edition: str | None = None
    company_name: str | None = None
    store_name: str | None = None
    currency: str | None = None
    # Non-sensitive branding only — this endpoint is unauthenticated (called
    # before login) so the login screen itself can show the shop's own
    # accent color/name instead of generic placeholder branding.
    primary_color: str | None = None
    # Тема идёт рядом с цветом, потому что применяются они вместе: читаемый
    # текст на акценте считается относительно поверхности, а какая она —
    # знает только тема. Отдать одно без другого значит посчитать контраст
    # по светлой поверхности на тёмном экране.
    theme: str | None = None
    # Режим бренда. Без него клиент не сможет решить, применять ли сохранённый
    # цвет: магазин, вернувшийся к заводскому бренду, продолжает хранить
    # выбранный когда-то фиолетовый — и красился бы им, хотя на всех экранах
    # стоит Kassir ERP. Что показывать при каждом режиме, решает brand/resolve.
    use_factory_brand: bool = True
    # Название системы в интерфейсе. Не название магазина: store_name выше —
    # это реквизит, он печатается в чеке.
    brand_name: str | None = None


EMAIL_PATTERN = r"^[^\s@]+@[^\s@]+\.[^\s@]+$"


# Сервисный ключ: минимум 8 символов, обязательно и буква, и цифра.
#
# Прежнее ограничение «шесть цифр» снято. Шестизначный код перебирается за
# считанные минуты, а открывает он мастер регистрации и настройки специалиста —
# то есть всё устройство. Владелец задаёт ключ какой хочет, лишь бы он не был
# ни чистыми цифрами, ни чистыми буквами.
SERVICE_KEY_MIN_LENGTH = 8

# Пароль владельца: минимум восемь символов.
#
# Столько же, сколько у пароля входа, и не потому, что «пусть будет как там»:
# за этой дверью деньги магазина, а вводится она с экранной клавиатуры на
# моноблоке. Требовать здесь больше значит получить пароль, записанный на
# бумажке под монитором, — это хуже восьми символов, которые помнят.
OWNER_PASSWORD_MIN_LENGTH = 8

_HAS_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)
_HAS_DIGIT = re.compile(r"\d")


def validate_service_key(value: str) -> str:
    """Проверяет сервисный ключ. Регистр и пробелы по краям не значимы.

    Проверка написана кодом, а не регулярным выражением с lookahead: движок
    регулярных выражений pydantic v2 (Rust) их не поддерживает, и такой
    паттерн падает при импорте модуля, а не при вводе неверного ключа.
    """
    key = value.strip()
    if len(key) < SERVICE_KEY_MIN_LENGTH:
        raise ValueError(f"Сервисный ключ — минимум {SERVICE_KEY_MIN_LENGTH} символов.")
    if not _HAS_LETTER.search(key) or not _HAS_DIGIT.search(key):
        raise ValueError("В сервисном ключе должны быть и буквы, и цифры.")
    return key


class AccountData(BaseModel):
    """Секреты, которые задаются на шаге «Учётная запись».

    * `password` — вход в систему. Обычный пароль обычного аккаунта: под ним
      работает смена, и кассир его нередко знает.
    * `owner_password` — кабинет владельца: финансы, аналитика, сотрудники.
      Отдельный секрет, и это главное в этом классе. Пока дверь владельца
      открывалась паролем входа, разделения ролей не существовало: владелец
      диктует пароль входа по телефону, чтобы кассир пробил возврат, — и вместе
      с возвратом отдаёт свои деньги.
    * `service_key` — устаревшее поле. Мастер его больше не собирает: сервисный
      режим открывает лицензионный ключ установки (KASSIR-XXXX-XXXX-XXXX),
      который специалист и так привозит с собой. Поле осталось необязательным
      ради установок и сборок интерфейса, которые ещё его присылают.

    PIN кассира здесь намеренно отсутствует. На этом шаге кассиров ещё нет —
    магазин только заводится. PIN задаётся при добавлении сотрудника в разделе
    «Сотрудники», и у каждого он свой: иначе по журналу не сказать, кто именно
    отменил чек.
    """

    email: str = Field(min_length=3, max_length=255, pattern=EMAIL_PATTERN)
    password: str = Field(min_length=8, max_length=128)
    owner_password: str = Field(min_length=OWNER_PASSWORD_MIN_LENGTH, max_length=128)
    service_key: str | None = Field(default=None, max_length=128)

    model_config = {"populate_by_name": True}

    @field_validator("service_key")
    @classmethod
    def _check_service_key(cls, value: str | None) -> str | None:
        # Пустую строку старые клиенты присылают наравне с отсутствием поля —
        # для них это «ключ не задан», а не «ключ длиной ноль».
        if value is None or not value.strip():
            return None
        return validate_service_key(value)


def _required_fields(onboarding: OnboardingData) -> dict[str, str]:
    """Обязательные реквизиты для выбранного режима работы.

    Режим — не флаг, а две разные схемы, и проверка обязана это учитывать.
    Раньше здесь стоял один безусловный список, и установка «без фискальной
    кассы» упиралась в требование ИНН, ЗН ККМ и ФМ — полей, которых в её форме
    нет вовсе. Человек видел ошибку про данные, которые ему негде ввести.

    Состав зеркалит реестр полей фронтенда (desktop/src/onboarding/fields.ts,
    свойство `modes`) — он там источник истины. При правке реестра поправить
    надо и здесь, иначе экран разрешит то, что сервер отвергнет.
    """
    common = {
        "город": onboarding.outlet.city,
        "телефон": onboarding.contacts.phone,
        "имя владельца": onboarding.owner.first_name,
        "фамилия владельца": onboarding.owner.last_name,
    }

    if onboarding.fiscal_mode != "fiscal":
        # Товарный чек: ни ИНН, ни реквизитов ККМ в нём нет и быть не может.
        # Адрес одной строкой — в простом режиме улица и дом вводятся вместе.
        return {
            **common,
            "название магазина": onboarding.company.short_name,
            "улица и дом": onboarding.outlet.street,
        }

    return {
        **common,
        "полное наименование субъекта": onboarding.company.legal_name,
        "краткое наименование": onboarding.company.short_name,
        "ИНН": onboarding.company.inn,
        "место расчётов": onboarding.outlet.name,
        "улица": onboarding.outlet.street,
        "дом": onboarding.outlet.building,
        "ЗН ККМ": onboarding.kkm.serial_number,
        "РН ККМ": onboarding.kkm.registration_number,
        "ФМ": onboarding.kkm.fiscal_module,
    }


class SetupInitRequest(BaseModel):
    """Приходит ровно тот же объект, что живёт на фронтенде как OnboardingData,
    плюс токен установки и учётная запись владельца."""

    setup_token: str = Field(min_length=1)
    edition: str = Field(default="start", pattern="^(start|standard)$")
    onboarding: OnboardingData
    account: AccountData

    @model_validator(mode="after")
    def _validate(self) -> "SetupInitRequest":
        # Секреты обязаны различаться: совпадение стирает разделение ролей, ради
        # которого их и завели. Проверка здесь, а не на фронтенде, потому что
        # это правило установки, а не подсказка в форме.
        if self.account.owner_password == self.account.password:
            raise ValueError("Пароль владельца должен отличаться от пароля входа.")
        if self.account.service_key and self.account.service_key == self.account.password:
            raise ValueError("Сервисный ключ должен отличаться от пароля входа.")
        if self.account.service_key and self.account.service_key == self.account.owner_password:
            raise ValueError("Сервисный ключ должен отличаться от пароля владельца.")
        missing = [label for label, value in _required_fields(self.onboarding).items() if not value.strip()]
        if missing:
            raise ValueError("Для печати чека не хватает данных: " + ", ".join(missing) + ".")
        return self


class SetupInitResponse(BaseModel):
    ok: bool = True
    access_token: str
    token_type: str = "bearer"
    user: dict
    onboarding: dict
    store: dict


class ActivationRequest(BaseModel):
    license_key: str = Field(min_length=1, max_length=64)


class ActivationResponse(BaseModel):
    setup_token: str
    expires_in_minutes: int = 30


class ReactivateRequest(BaseModel):
    license_key: str = Field(min_length=1, max_length=64)


class ReactivateResponse(BaseModel):
    ok: bool = True


@router.get("/status", response_model=SetupStatusResponse)
async def setup_status(session: AsyncSession = Depends(get_db_session)) -> SetupStatusResponse:
    needs_setup, store = await SetupService(SetupRepository(session)).needs_setup()
    if needs_setup or store is None:
        return SetupStatusResponse(needs_setup=True)
    return SetupStatusResponse(
        needs_setup=False,
        needs_reactivation=not hardware_matches(store.hardware_id),
        setup_version=store.setup_version, edition=store.edition,
        company_name=store.company_name, store_name=store.store_name, currency=store.currency,
        primary_color=store.primary_color or None,
        theme=store.theme or None,
        use_factory_brand=bool(store.use_factory_brand),
        brand_name=store.brand_name or None,
    )


@router.post("/activate", response_model=ActivationResponse)
async def activate(payload: ActivationRequest) -> ActivationResponse:
    if not verify_key(payload.license_key, settings.license_hmac_secret):
        await asyncio.sleep(0.4)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный лицензионный ключ.")
    token = create_setup_token(
        extra={
            "license_key": canonical_key(payload.license_key),
            "hardware_id": hash_hardware_id(),
        }
    )
    return ActivationResponse(setup_token=token)


@router.post("/reactivate", response_model=ReactivateResponse)
async def reactivate(
    payload: ReactivateRequest, session: AsyncSession = Depends(get_db_session)
) -> ReactivateResponse:
    if not verify_key(payload.license_key, settings.license_hmac_secret):
        await asyncio.sleep(0.4)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный лицензионный ключ.")
    repo = SetupRepository(session)
    store = await repo.get_store()
    if store is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Установка ещё не выполнена.")
    store.activation_key = canonical_key(payload.license_key) or store.activation_key
    store.hardware_id = hash_hardware_id()
    store.activated_at = datetime.now(UTC)
    await repo.save()
    return ReactivateResponse()


@router.post("/init", response_model=SetupInitResponse, status_code=status.HTTP_201_CREATED)
async def setup_init(payload: SetupInitRequest, session: AsyncSession = Depends(get_db_session)) -> SetupInitResponse:
    setup_claims = verify_setup_token(payload.setup_token)
    if setup_claims is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Лицензионный ключ должен быть подтверждён заново."
        )

    # Лицензионный ключ открывает сервисный режим, и совпасть с паролем
    # владельца он не должен: иначе специалист, приехавший поменять логотип,
    # заодно получал бы кабинет с деньгами. Ключ виден только здесь — в теле
    # запроса его нет, поэтому и проверка стоит после разбора токена, а не в
    # валидаторе модели.
    license_key = setup_claims.get("license_key") or ""
    if license_key and canonical_key(payload.account.owner_password) == license_key:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Пароль владельца должен отличаться от лицензионного ключа.",
        )

    try:
        store, user = await SetupService(SetupRepository(session)).complete(
            payload.onboarding,
            OwnerAccount(
                email=payload.account.email,
                password=payload.account.password,
                owner_password=payload.account.owner_password,
                service_key=payload.account.service_key,
            ),
            Activation(
                plan=LicensePlan(payload.edition),
                key=license_key,
                hardware_id=setup_claims.get("hardware_id") or "",
                activated_at=datetime.now(UTC),
            ),
        )
    except SetupAlreadyCompletedError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="System is already configured.") from exc
    return SetupInitResponse(
        access_token=create_access_token(user),
        user={"id": user.id, "username": user.username, "full_name": user.full_name, "role": user.role},
        # Возвращаем онбординг целиком, вместе с картинками: фронтенд кладёт
        # его в кэш и печатает чеки из него же, не собирая объект заново из
        # плоских полей и не ходя за логотипом отдельным запросом.
        onboarding=from_store(store, await load_images(session)).model_dump(by_alias=True),
        store={
            "installation_id": store.installation_id,
            "edition": store.edition,
        },
    )


class FactoryResetRequest(BaseModel):
    # Re-confirms it's really the owner, typed at the moment of the action —
    # not just "someone with an unlocked session". This wipes everything.
    password: str = Field(min_length=1, max_length=128)


@router.post("/factory-reset", status_code=status.HTTP_204_NO_CONTENT)
async def factory_reset(
    payload: FactoryResetRequest,
    session: AsyncSession = Depends(get_db_session),
    current: User = Depends(require_owner),
) -> None:
    """Wipes every table so /api/setup/status reports needs_setup again.

    За дверью владельца и с повторным вводом пароля: роли аккаунта здесь мало,
    на кассе она почти всегда владельческая.

    Deletes children before parents to satisfy foreign keys. sync_log /
    sync_pk_map carry no FKs and are cleared last for good measure — a fresh
    install should not try to replay stale offline writes into Postgres.
    """
    if not await verify_password_async(payload.password, current.hashed_password):
        # 403, а не 401, и это не косметика.
        #
        # Клиент трактует любой 401 как протухшую сессию: стирает токен и
        # разлогинивает (см. api/client.ts). Из-за этого неверный пароль при
        # удалении аккаунта выбрасывал человека на экран входа, а сам аккаунт
        # оставался на месте — выглядело как «удаление не работает», хотя оно
        # даже не начиналось. Отказ в подтверждении — это «не хватает прав на
        # действие», а не «вы больше не вошли».
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Неверный пароль владельца."
        )

    # Порядок: дети раньше родителей — внешние ключи в SQLite включены
    # (PRAGMA foreign_keys=ON), и удаление пользователя, на которого кто-то
    # ссылается, обрывается ошибкой целостности.
    #
    # Расходы и намерения оплаты раньше в списке отсутствовали, а ссылка на
    # users у них есть. На пустой демо-базе это не проявлялось, на живом
    # магазине с первым же занесённым расходом удаление аккаунта падало бы.
    for model in (
        SaleItem,
        DebtPayment,
        StockMove,
        Sale,
        Shift,
        Expense,
        ExpenseCategory,
        PaymentEvent,
        PaymentIntent,
        PaymentSecret,
        Product,
        Category,
        SaleCounter,
        AuditEntry,
        # Снимки входов — тоже данные магазина, и при сбросе кассы они обязаны
        # уйти вместе с журналом: это лица людей, а не служебные записи.
        OwnerEntryPhoto,
        User,
        StoreImage,
        StoreSettings,
        SyncLogEntry,
        SyncPkMap,
    ):
        await session.execute(delete(model))
    await session.commit()
