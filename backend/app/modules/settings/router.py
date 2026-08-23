from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import sync
from app.core.access import open_doors, require_requisites
from app.core.audit import diff_fields, write_audit
from app.core.security import get_current_user
from app.modules.settings.field_access import changed_groups, denial_text, forbidden_groups
from app.db.database import current_db_mode, get_db_session
from app.db.models import StoreSettings, User
from app.modules.setup.images import ImageBag, load_images, save_images
from app.modules.setup.schema import OnboardingData, apply_to_store, from_store

router = APIRouter(prefix="/api/settings", tags=["settings"])


class StoreSettingsOut(BaseModel):
    installation_id: str
    edition: str
    setup_completed: bool
    # Реквизиты отдаются тем же объектом, что собирает мастер установки, —
    # экран настроек рисует их тем же реестром полей и той же формой.
    onboarding: dict


class StoreSettingsUpdate(BaseModel):
    # Edition is stored locally now. Future license activation may update it
    # through a dedicated service without changing the store-settings contract.
    edition: str | None = Field(default=None, pattern="^(start|standard)$")
    onboarding: OnboardingData | None = None


async def _get_or_create(session: AsyncSession) -> StoreSettings:
    row = (await session.execute(select(StoreSettings).limit(1))).scalar_one_or_none()
    if row is None:
        row = StoreSettings()
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


def _out(row: StoreSettings, images: ImageBag) -> StoreSettingsOut:
    return StoreSettingsOut(
        installation_id=row.installation_id,
        edition=row.edition,
        setup_completed=row.setup_completed,
        # Картинки лежат в своей таблице, но наружу уходят там же, где и
        # раньше: печать чека синхронна, ходить за логотипом отдельным
        # запросом в момент оплаты нельзя.
        onboarding=from_store(row, images).model_dump(by_alias=True),
    )


@router.get("/store", response_model=StoreSettingsOut)
async def get_store_settings(
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> StoreSettingsOut:
    row = await _get_or_create(session)
    return _out(row, await load_images(session))


# Поля, изменения которых пишутся в журнал. Здесь не всё подряд: логотип это
# data URL на сотни килобайт, и складывать его в «было/стало» на каждую правку
# значит сделать журнал нечитаемым и раздуть базу. Оставлены реквизиты, по
# которым возникают споры, — то, что печатается в чеке и влияет на деньги.
_AUDITED_FIELDS = (
    "company_legal_name",
    "company_name",
    "inn",
    "store_name",
    "address",
    "phone",
    "email",
    "tax_regime",
    "vat_rate",
    "sales_tax_rate",
    "single_tax_rate",
    "kkm_serial_number",
    "kkm_registration_number",
    "kkm_fiscal_module",
    "fiscal_mode",
    "analytics_mode",
    "currency",
    "receipt_logo",
    "receipt_header",
    "receipt_roll_width",
    "receipt_footer",
    "ui_logo",
    "use_factory_brand",
)


def _snapshot(row: StoreSettings) -> dict[str, object]:
    return {name: getattr(row, name, None) for name in _AUDITED_FIELDS}


@router.patch("/store", response_model=StoreSettingsOut)
async def update_store_settings(
    payload: StoreSettingsUpdate,
    session: AsyncSession = Depends(get_db_session),
    current: User = Depends(require_requisites),
) -> StoreSettingsOut:
    """Правка реквизитов. Маршрут один, набор полей зависит от двери.

    Роли аккаунта здесь недостаточно: на кассе залогинен владелец, а за
    клавиатурой стоит кассир. Нужна открытая сессия — владельца или
    специалиста.

    Дальше решают поля, а не маршрут. Владелец меняет своё: наименования,
    адрес, телефон, налоги — переезд магазина или новый номер не должны ждать
    приезда установщика. Логотипы, ККМ, эквайринг и режим работы остаются за
    специалистом (разбор — в field_access.py). Чужое поле отвергается явно:
    тихо проигнорировать правку хуже отказа, человек уйдёт уверенным, что
    сохранил.

    Чтение (`GET /store`) остаётся общим: из этих же данных печатается чек, и
    закрыть их значит остановить кассу.

    Пишется в журнал: реквизиты печатаются в каждом чеке, и спор «ИНН
    поменялся сам» разрешить нечем, если не видно, кто и когда его правил.
    Запись входит в ту же транзакцию — иначе возможен худший случай: правка
    откатилась, а запись о ней осталась.
    """
    row = await _get_or_create(session)
    before = _snapshot(row)
    images = await load_images(session)
    doors = open_doors(current.id)

    # Что именно меняет эта правка — сравнением с тем, что лежит в базе:
    # интерфейс присылает объект целиком, и «поле пришло» не значит «изменили».
    touched: set[str] = set()
    if payload.onboarding is not None:
        touched |= changed_groups(from_store(row, images), payload.onboarding)
    if payload.edition is not None and payload.edition != row.edition:
        touched.add("edition")

    forbidden = forbidden_groups(touched, doors)
    if forbidden:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=denial_text(forbidden))

    if payload.edition is not None:
        row.edition = payload.edition
    if payload.onboarding is not None:
        apply_to_store(row, payload.onboarding, images)
        await save_images(session, images)

    old_value, new_value = diff_fields(before, _snapshot(row))
    if old_value or new_value:
        await write_audit(
            session,
            actor=current,
            action="requisites.updated",
            target="реквизиты магазина",
            old_value=old_value,
            new_value=new_value,
        )

    await session.commit()
    await session.refresh(row)
    return _out(row, await load_images(session))


@router.get("/capabilities")
async def get_capabilities(
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> dict:
    store = await _get_or_create(session)
    mode = current_db_mode()
    return {
        "edition": store.edition,
        "mode": mode,
        "db_mode": mode,
        "sync_pending_count": await sync.pending_count(),
        "sync_last_success_at": await sync.last_success_at(),
        "installation_id": store.installation_id,
        # Contract reserved for future local-license and Cloud adapters.
        "license_activation_available": False,
        "cloud_migration_available": False,
        "custom_update_server_configured": False,
    }
