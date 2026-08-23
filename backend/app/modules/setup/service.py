from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from app.core.security import hash_password
from app.db.models import StoreSettings, User
from app.modules.licensing.service import LicenseManager, LicensePlan
from app.modules.setup.images import ImageBag, load_images, save_images
from app.modules.setup.repository import SetupRepository
from app.modules.setup.schema import OnboardingData, apply_to_store

# Поднимается, когда мастер начинает собирать данные, без которых предыдущие
# установки обойтись могли, а новые — уже нет (сейчас: реквизиты для чека).
CURRENT_SETUP_VERSION = 4


@dataclass(frozen=True)
class OwnerAccount:
    """Секреты, которые задаются при установке.

    `password` — вход в систему, `owner_password` — кабинет владельца.
    Разные секреты и разные двери: под учётной записью владельца работает вся
    смена, и открывать ею финансы значит не разделять роли вовсе.

    `service_key` — устаревший: сервисный режим открывает лицензионный ключ
    установки. Остаётся необязательным ради установок, которые его уже задали.

    PIN кассира сюда не входит: на этом шаге кассиров ещё нет, их заводят
    позже в разделе «Сотрудники», и PIN у каждого свой.
    """

    email: str
    password: str
    owner_password: str
    service_key: str | None = None


@dataclass(frozen=True)
class Activation:
    plan: LicensePlan
    key: str = ""
    hardware_id: str = ""
    activated_at: datetime | None = None


class SetupAlreadyCompletedError(Exception):
    pass


class SetupService:
    def __init__(self, repository: SetupRepository, licenses: LicenseManager | None = None) -> None:
        self._repository = repository
        self._licenses = licenses or LicenseManager()

    async def needs_setup(self) -> tuple[bool, StoreSettings | None]:
        store = await self._repository.get_store()
        administrator = await self._repository.get_administrator()
        return (
            store is None
            or not store.setup_completed
            or store.setup_version < CURRENT_SETUP_VERSION
            or administrator is None
        ), store

    async def complete(
        self,
        onboarding: OnboardingData,
        account: OwnerAccount,
        activation: Activation,
    ) -> tuple[StoreSettings, User]:
        needs_setup, store = await self.needs_setup()
        if not needs_setup:
            raise SetupAlreadyCompletedError

        # Картинки читаем до того, как в сессию попадут новые строки: любой
        # запрос к базе сбрасывает в неё всё накопленное, а владелец в этот
        # момент ещё без пароля — вставка упала бы на NOT NULL.
        images: ImageBag = await load_images(self._repository.session)

        # Логин хранится в колонке username — это email владельца, приведённый
        # к нижнему регистру, чтобы «Owner@…» и «owner@…» были одним аккаунтом.
        username = account.email.strip().lower()
        user = await self._repository.get_user_by_username(username)
        if store is None:
            store = StoreSettings()
            self._repository.add_store(store)
        if user is None:
            user = User(username=username)
            self._repository.add_user(user)

        # Единственное место, где онбординг раскладывается по колонкам.
        # Картинки при этом уезжают в свою таблицу: строка настроек не должна
        # быть мегабайтом base64 — см. images.py.
        apply_to_store(store, onboarding, images)

        store.activation_key = activation.key
        store.hardware_id = activation.hardware_id
        store.activated_at = activation.activated_at
        store.setup_completed = True
        store.setup_version = CURRENT_SETUP_VERSION
        # Хранятся только хэши (argon2id) — восстановление невозможно, система
        # офлайн.
        #
        # Пароль владельца живёт в настройках магазина, а не в учётной записи, и
        # это не деталь хранения: дверь владельца не должна зависеть от того,
        # под кем сейчас вошли. Смена откроет её тем же паролем, даже если за
        # кассой работает кассир под своим аккаунтом.
        store.owner_password_hash = hash_password(account.owner_password)
        # Длина — чтобы дверь отсекала заведомо не подходящее без argon2.
        # Разбор, почему это не утечка, — в миграции 0024.
        store.owner_password_length = len(account.owner_password)
        # Сервисный ключ — только если его прислали. Мастер этого больше не
        # делает: сервисный режим открывает лицензионный ключ установки, с
        # которым специалист и приезжает. Затирать уже заданный ключ пустым
        # значением нельзя — установка потеряла бы рабочий секрет.
        if account.service_key and account.service_key.strip():
            store.service_key_hash = hash_password(account.service_key.strip())
        # Общий PIN установки больше не заводится: PIN у каждого кассира свой
        # и задаётся в разделе «Сотрудники». Колонка остаётся ради установок,
        # которые обновились со старой версии и ещё не завели сотрудников.
        # Мастер-пароль больше не задаётся: его роль перешла к PIN. Чистим,
        # чтобы у установки не осталось двух работающих секретов сразу.
        store.master_password_hash = ""
        self._licenses.activate(store, activation.plan)

        user.username = username
        user.full_name = f"{onboarding.owner.first_name.strip()} {onboarding.owner.last_name.strip()}".strip()
        user.hashed_password = hash_password(account.password)
        user.role = "owner"
        user.is_active = True

        # Картинки пишем последними — когда владелец уже заполнен целиком и
        # сброс сессии в базу безопасен. Всё уходит одной транзакцией: логотип
        # без реквизитов (или наоборот) не должен пережить сбой на середине.
        await save_images(self._repository.session, images)

        await self._repository.save()
        await self._repository.refresh(store)
        await self._repository.refresh(user)
        return store, user
