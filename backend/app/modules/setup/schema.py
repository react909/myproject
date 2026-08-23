"""Схема данных онбординга — зеркало TypeScript-типа OnboardingData.

Один и тот же набор моделей обслуживает и первую установку (POST
/api/setup/init), и последующее редактирование реквизитов (GET/PATCH
/api/settings/store). Раскладка по колонкам store_settings описана здесь
единожды: параллельных отображений «поле → колонка» в проекте быть не должно,
иначе чек и настройки со временем разъедутся.

Имена полей camelCase — намеренно: они обязаны совпадать с фронтендовым
типом, чтобы данные не переименовывались на каждой границе.
"""

from __future__ import annotations

import json

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.db.models import StoreSettings
from app.modules.licensing.service import LicenseManager, LicensePlan
from app.modules.setup.images import (
    KIND_LOGO_RECEIPT,
    KIND_LOGO_UI,
    KIND_QR,
    SLOT_COMBINED,
    SLOT_MARK,
    SLOT_WORDMARK,
    ImageBag,
)

# Ключи в конфигурации провайдера, которых там быть не должно ни при каких
# условиях: онбординг кэшируется на стороне интерфейса, а секрет туда попасть
# не может даже случайно.
PROVIDER_SECRET_KEYS = ("apiKey", "api_key", "secret", "password")


def strip_provider_secrets(providers: list[dict]) -> list[dict]:
    """Выбрасывает секреты из конфигурации способов оплаты.

    Клиент их и не присылает, но полагаться на это нельзя: настройки приходят
    по открытому API, и один ошибочный вызов закрепил бы ключ там, откуда он
    уедет в браузерное хранилище кассы.
    """
    cleaned: list[dict] = []
    for provider in providers:
        if not isinstance(provider, dict):
            continue
        cleaned.append({k: v for k, v in provider.items() if k not in PROVIDER_SECRET_KEYS})
    return cleaned

TAX_REGIME_PATTERN = "^(simplified_single|general|patent|none)$"
FISCAL_MODE_PATTERN = "^(fiscal|simple)$"
LOGO_MODE_PATTERN = "^(image|image_text|monogram|none)$"
INDUSTRY_PATTERN = "^(clothing|shoes|cosmetics|grocery|electronics|pharmacy|cafe|services|other)$"
# Режима склада больше нет: остатки ведутся всегда. Вместо него — выбор
# главной цифры дашборда, который на состав записей в базе не влияет.
ANALYTICS_MODE_PATTERN = "^(revenue|profit)$"
# Шаблоны приведения логотипа к одному биту на точку — см. logoCanvas.ts.
THERMAL_STYLE_PATTERN = "^(standard|contrast|dither|outline)$"
# Тариф установки. Те же значения, что у LicensePlan в модуле лицензирования.
EDITION_PATTERN = "^(start|standard)$"
# Компоновка шапки приложения. Отдельная настройка от шапки чека: экран и лента
# — разные носители. Разбор значений — в миграции 0020 и в types.ts.
HEADER_LAYOUT_PATTERN = "^(combined|mark_left|mark_top|mark|wordmark)$"
# Форма знака. Круг запекается в PNG вместе с прозрачностью за границей.
LOGO_SHAPE_PATTERN = "^(square|circle)$"
VALID_PAYMENT_METHODS = ("cash", "card", "qr", "nfc")


class OnboardingModel(BaseModel):
    """Общая настройка: наружу camelCase, внутрь можно и snake_case."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class CompanyData(OnboardingModel):
    legal_name: str = Field(default="", max_length=255)
    short_name: str = Field(default="", max_length=255)
    inn: str = Field(default="", max_length=32)


class OutletData(OnboardingModel):
    name: str = Field(default="", max_length=255)
    postal_code: str = Field(default="", max_length=16)
    city: str = Field(default="", max_length=128)
    street: str = Field(default="", max_length=255)
    building: str = Field(default="", max_length=64)
    lat: str = Field(default="", max_length=32)
    lon: str = Field(default="", max_length=32)


class TaxData(OnboardingModel):
    regime: str = Field(default="simplified_single", pattern=TAX_REGIME_PATTERN)
    vat_rate: float = Field(default=0, ge=0, le=100)
    sales_tax_rate: float = Field(default=0, ge=0, le=100)
    # Единый налог упрощённой системы. В чек не печатается — СНО в шапке уже
    # говорит о режиме, — но нужен владельцу для расчёта платежа.
    single_tax_rate: float = Field(default=0, ge=0, le=100)


class KkmData(OnboardingModel):
    serial_number: str = Field(default="", max_length=32)
    registration_number: str = Field(default="", max_length=32)
    fiscal_module: str = Field(default="", max_length=32)
    ffd_version: str = Field(default="1.0", max_length=16)
    sw_version: str = Field(default="NewCas-F 1.0", max_length=32)
    pos_number: str = Field(default="1", max_length=8)


class AcquiringData(OnboardingModel):
    bank: str = Field(default="", max_length=128)
    terminal_id: str = Field(default="", max_length=64)
    methods: list[str] = Field(default_factory=lambda: ["cash", "card"])
    qr_provider: str = Field(default="", max_length=64)
    second_screen: bool = False
    # Настроенные способы безналичной оплаты. Мерчант-ключей здесь нет: они
    # живут в payment_secrets и в интерфейс не возвращаются.
    providers: list[dict] = Field(default_factory=list)


class BusinessData(OnboardingModel):
    industry: str = Field(default="other", pattern=INDUSTRY_PATTERN)
    currency: str = Field(default="KGS", max_length=16)
    currency_label: str = Field(default="сом", max_length=32)
    decimals: int = Field(default=2, ge=0, le=2)
    # Какая цифра главная на дашборде. Не влияет на то, что пишется в базу.
    analytics_mode: str = Field(default="revenue", pattern=ANALYTICS_MODE_PATTERN)
    timezone: str = Field(default="Asia/Bishkek", max_length=64)
    country: str = Field(default="", max_length=128)


class LogoVariants(OnboardingModel):
    """Готовые размеры логотипа. Собираются в редакторе один раз."""

    s512: str = Field(default="", max_length=1_500_000)
    s128: str = Field(default="", max_length=400_000)
    s64: str = Field(default="", max_length=200_000)
    # Устаревший общий чековый вариант. Остаётся источником для установок,
    # сделанных до разделения логотипов, — см. ReceiptLogoVariants.
    receipt: str = Field(default="", max_length=400_000)


class ReceiptLogoVariants(OnboardingModel):
    """Чековый знак под обе ширины рулона. 1-bit, поэтому файлы небольшие."""

    # 80 мм — 384 точки в ширину.
    w384: str = Field(default="", max_length=400_000)
    # 58 мм — 288 точек.
    w288: str = Field(default="", max_length=400_000)


class BrandingData(OnboardingModel):
    mode: str = Field(default="monogram", pattern=LOGO_MODE_PATTERN)
    use_factory_brand: bool = True
    # Название системы в интерфейсе. Не название магазина — то живёт в
    # company_name и печатается в чеке. Пусто — заводское «Kassir ERP».
    brand_name: str = Field(default="", max_length=64)
    # Показывать логотип в шапке приложения. Отдельно от receipt_logo.
    ui_logo: bool = True
    # PNG в виде data URL. Ограничение по длине щедрое: логотип 512×512 в
    # base64 занимает порядка 200 КБ, а всё что крупнее термопринтер всё равно
    # не напечатает — там 384 точки на всю ширину ленты.
    logo: str = Field(default="", max_length=1_500_000)
    logo_mark: str = Field(default="", max_length=1_500_000)
    logo_variants: LogoVariants = Field(default_factory=LogoVariants)
    # Как знак и надпись стоят в шапке приложения. Пять компоновок, разбор —
    # в миграции 0020.
    header_layout: str = Field(default="mark_left", pattern=HEADER_LAYOUT_PATTERN)
    # Надпись с названием магазина — картинкой, а не текстом. Пусто: название
    # рисуется текстом по шаблону (logo_text_*), как и до появления слота.
    logo_wordmark: str = Field(default="", max_length=1_500_000)
    # Единая картинка, где знак и надпись уже сведены вместе. Используется
    # только компоновкой `combined` и живёт отдельно от знака: это другой файл,
    # а не другой размер того же.
    logo_combined: str = Field(default="", max_length=1_500_000)
    # Форма знака на экранах. Круг — с прозрачностью за границей.
    logo_shape: str = Field(default="square", pattern=LOGO_SHAPE_PATTERN)
    # Объёмный вид бренда в шапке. Оформление по альфа-каналу, а не свойство
    # файла: снимается переключателем и ничего не пересобирает.
    logo_emboss: bool = True
    logo_text_template: str = Field(default="strict", pattern="^(strict|round|classic|narrow)$")
    logo_text_size: str = Field(default="m", pattern="^(s|m|l)$")
    logo_text_color: str = Field(default="", max_length=16)
    primary_color: str = Field(default="#00f5bc", pattern="^#[0-9a-fA-F]{6}$")
    theme: str = Field(default="light", pattern="^(light|dark)$")
    receipt_logo: bool = True
    receipt_header: str = Field(default="logo_name", pattern="^(logo|logo_name|name)$")
    # Отдельная картинка для чека. Пусто — берётся файл из интерфейса.
    receipt_logo_file: str = Field(default="", max_length=1_500_000)
    # Своя обрезка под ленту. Пусто — берётся интерфейсный logo_mark.
    receipt_logo_mark: str = Field(default="", max_length=1_500_000)
    receipt_logo_variants: ReceiptLogoVariants = Field(default_factory=ReceiptLogoVariants)
    # Форма чекового знака. Круглая маска накладывается до перевода в один бит,
    # прозрачное печать считает белым — иначе вокруг круга был бы чёрный квадрат.
    receipt_logo_shape: str = Field(default="square", pattern=LOGO_SHAPE_PATTERN)
    # Шаблон обработки под термопечать и порог ч/б.
    receipt_logo_style: str = Field(default="standard", pattern=THERMAL_STYLE_PATTERN)
    receipt_logo_threshold: int = Field(default=176, ge=0, le=255)
    receipt_roll_width: str = Field(default="80", pattern="^(58|80)$")
    receipt_footer: str = Field(default="", max_length=128)
    # Касса стоит на сенсорном моноблоке без физической клавиатуры.
    #
    # Живёт в оформлении не по смыслу, а по правам: группа `branding` уже
    # закреплена за специалистом (см. field_access.py), а сенсорный экран —
    # ровно его епархия: владелец магазина не выбирает, какое железо привезли.
    # Заводить ради одного флага новую группу и новое правило доступа значило бы
    # умножать места, где право на поле можно однажды забыть проставить.
    touch_screen: bool = False
    # К кассе подключена камера. Живёт здесь по той же причине, что и сенсорный
    # экран: группа `branding` закреплена за специалистом, а какое привезли
    # железо — его дело, а не владельца магазина.
    has_camera: bool = False


class OwnerData(OnboardingModel):
    first_name: str = Field(default="", max_length=128)
    last_name: str = Field(default="", max_length=128)
    # Логин владельца. Хранится отдельно от email компании даже когда мастер
    # их связал: адреса расходятся, как только появляется бухгалтерия.
    email: str = Field(default="", max_length=255)
    email_same_as_company: bool = True
    cashier_code: str = Field(default="", max_length=32)


class ContactsData(OnboardingModel):
    phone: str = Field(default="", max_length=64)
    email: str = Field(default="", max_length=255)


class OnboardingData(OnboardingModel):
    # Дискриминант режима работы. Простой режим — значение по умолчанию: он
    # ничего не требует и ничего не обещает налоговой.
    fiscal_mode: str = Field(default="simple", pattern=FISCAL_MODE_PATTERN)
    # Тариф установки. Скаляр верхнего уровня, как и режим: он не свойство
    # оформления или магазина, а условие работы всей установки. Список значений
    # тот же, что понимает лицензирование (LicensePlan), — расходиться им
    # нельзя, иначе касса пообещает то, чего не включит.
    edition: str = Field(default="start", pattern=EDITION_PATTERN)
    company: CompanyData = Field(default_factory=CompanyData)
    outlet: OutletData = Field(default_factory=OutletData)
    tax: TaxData = Field(default_factory=TaxData)
    kkm: KkmData = Field(default_factory=KkmData)
    acquiring: AcquiringData = Field(default_factory=AcquiringData)
    business: BusinessData = Field(default_factory=BusinessData)
    branding: BrandingData = Field(default_factory=BrandingData)
    owner: OwnerData = Field(default_factory=OwnerData)
    contacts: ContactsData = Field(default_factory=ContactsData)


def normalize_methods(methods: list[str]) -> list[str]:
    """Оставляет известные способы оплаты, наличные — всегда доступны."""
    seen = [m for m in methods if m in VALID_PAYMENT_METHODS]
    if "cash" not in seen:
        seen.insert(0, "cash")
    # dict.fromkeys сохраняет порядок и убирает повторы.
    return list(dict.fromkeys(seen))


def _parse_providers(raw: str | None) -> list[dict]:
    """Читает список провайдеров. Битый JSON не должен ронять экран настроек."""
    try:
        parsed = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    return strip_provider_secrets(parsed) if isinstance(parsed, list) else []


def format_address(outlet: OutletData) -> str:
    """Адрес одной строкой — колонка address нужна старым экранам и отчётам."""
    city = f"г. {outlet.city.strip()}" if outlet.city.strip() else ""
    street = ", ".join(part for part in (outlet.street.strip(), outlet.building.strip()) if part)
    return ", ".join(part for part in (outlet.postal_code.strip(), city, street) if part)


def _put_branding_images(images: ImageBag, branding: BrandingData) -> None:
    """Складывает картинки оформления в хранилище.

    Имена слотов («main», «mark», «s128», «w384») — это и есть ссылка на
    картинку: по паре «вид + слот» она достаётся из store_images. Те же имена
    знает миграция 0019, которая переносила картинки из колонок, — менять их
    в одном месте нельзя.
    """
    images.set(KIND_LOGO_UI, "main", branding.logo)
    images.set(KIND_LOGO_UI, SLOT_MARK, branding.logo_mark)
    # Надпись и единая картинка — соседние слоты того же вида: это картинки
    # одной шапки, просто разные её части.
    images.set(KIND_LOGO_UI, SLOT_WORDMARK, branding.logo_wordmark)
    images.set(KIND_LOGO_UI, SLOT_COMBINED, branding.logo_combined)
    images.set(KIND_LOGO_UI, "s512", branding.logo_variants.s512)
    images.set(KIND_LOGO_UI, "s128", branding.logo_variants.s128)
    images.set(KIND_LOGO_UI, "s64", branding.logo_variants.s64)
    images.set(KIND_LOGO_UI, "receipt", branding.logo_variants.receipt)

    images.set(KIND_LOGO_RECEIPT, "file", branding.receipt_logo_file)
    images.set(KIND_LOGO_RECEIPT, "mark", branding.receipt_logo_mark)
    images.set(KIND_LOGO_RECEIPT, "w384", branding.receipt_logo_variants.w384)
    images.set(KIND_LOGO_RECEIPT, "w288", branding.receipt_logo_variants.w288)


def _take_branding_images(images: ImageBag) -> dict:
    """Достаёт картинки оформления обратно — в том же виде, в каком пришли."""
    return {
        "logo": images.get(KIND_LOGO_UI, "main"),
        "logo_mark": images.get(KIND_LOGO_UI, SLOT_MARK),
        "logo_wordmark": images.get(KIND_LOGO_UI, SLOT_WORDMARK),
        "logo_combined": images.get(KIND_LOGO_UI, SLOT_COMBINED),
        "logo_variants": LogoVariants(
            s512=images.get(KIND_LOGO_UI, "s512"),
            s128=images.get(KIND_LOGO_UI, "s128"),
            s64=images.get(KIND_LOGO_UI, "s64"),
            receipt=images.get(KIND_LOGO_UI, "receipt"),
        ),
        "receipt_logo_file": images.get(KIND_LOGO_RECEIPT, "file"),
        "receipt_logo_mark": images.get(KIND_LOGO_RECEIPT, "mark"),
        "receipt_logo_variants": ReceiptLogoVariants(
            w384=images.get(KIND_LOGO_RECEIPT, "w384"),
            w288=images.get(KIND_LOGO_RECEIPT, "w288"),
        ),
    }


def split_provider_images(providers: list[dict], images: ImageBag) -> list[dict]:
    """Выносит снимки QR из конфигурации способов оплаты в хранилище картинок.

    В JSON провайдеров картинка занимала больше, чем вся остальная настройка
    магазина вместе взятая: снимок экрана QR — это сотни килобайт base64 на
    каждый способ. Здесь остаётся только настройка, а картинка уезжает в
    таблицу под своим идентификатором способа.
    """
    cleaned: list[dict] = []
    seen: set[str] = set()
    for provider in providers:
        if not isinstance(provider, dict):
            continue
        item = dict(provider)
        provider_id = str(item.get("id") or "")
        image = item.pop("imageDataUrl", "")
        if provider_id:
            seen.add(provider_id)
            images.set(KIND_QR, provider_id, image if isinstance(image, str) else "")
        cleaned.append(item)

    # Способ удалили — его картинке в базе делать нечего.
    for slot in images.slots(KIND_QR):
        if slot not in seen:
            images.set(KIND_QR, slot, "")
    return cleaned


def merge_provider_images(providers: list[dict], images: ImageBag) -> list[dict]:
    """Возвращает снимки QR в конфигурацию — интерфейс ждёт их там же, где и раньше."""
    merged: list[dict] = []
    for provider in providers:
        if not isinstance(provider, dict):
            continue
        item = dict(provider)
        image = images.get(KIND_QR, str(item.get("id") or ""))
        if image:
            item["imageDataUrl"] = image
        merged.append(item)
    return merged


def apply_to_store(store: StoreSettings, data: OnboardingData, images: ImageBag) -> None:
    """Раскладывает онбординг по колонкам store_settings.

    Картинки в колонки не пишутся: они уезжают в `images` и оттуда — в таблицу
    store_images. Строка настроек должна оставаться строкой настроек, а не
    мегабайтом base64, который тянется на каждый запрос реквизитов.
    """
    store.fiscal_mode = data.fiscal_mode
    # Тариф меняем через менеджер лицензий, а не присваиванием: за право
    # работать отвечает license_plan, и разъехаться с edition ему нельзя.
    #
    # При первой установке тариф ставит SetupService из подтверждённого
    # лицензией токена — там он и есть последнее слово, и активировать его
    # здесь заранее значит записать лишнюю ревизию лицензии.
    if store.setup_completed and data.edition != store.edition:
        LicenseManager().activate(store, LicensePlan(data.edition))
    store.company_legal_name = data.company.legal_name.strip()
    store.company_name = data.company.short_name.strip()
    store.inn = data.company.inn.strip()

    store.store_name = data.outlet.name.strip()
    store.postal_code = data.outlet.postal_code.strip()
    store.city = data.outlet.city.strip()
    store.street = data.outlet.street.strip()
    store.building = data.outlet.building.strip()
    store.latitude = data.outlet.lat.strip()
    store.longitude = data.outlet.lon.strip()
    store.address = format_address(data.outlet)

    store.tax_regime = data.tax.regime
    store.vat_rate = data.tax.vat_rate
    store.sales_tax_rate = data.tax.sales_tax_rate
    store.single_tax_rate = data.tax.single_tax_rate

    store.kkm_serial_number = data.kkm.serial_number.strip()
    store.kkm_registration_number = data.kkm.registration_number.strip()
    store.kkm_fiscal_module = data.kkm.fiscal_module.strip()
    store.kkm_ffd_version = data.kkm.ffd_version.strip()
    store.kkm_sw_version = data.kkm.sw_version.strip()
    store.kkm_pos_number = data.kkm.pos_number.strip() or "1"

    store.acquiring_bank = data.acquiring.bank.strip()
    store.acquiring_terminal_id = data.acquiring.terminal_id.strip()
    store.payment_methods = ",".join(normalize_methods(data.acquiring.methods))
    store.acquiring_qr_provider = data.acquiring.qr_provider.strip()
    store.acquiring_second_screen = data.acquiring.second_screen
    store.payment_providers = json.dumps(
        split_provider_images(strip_provider_secrets(data.acquiring.providers), images),
        ensure_ascii=False,
    )

    store.industry = data.business.industry
    store.currency = data.business.currency.strip()
    store.currency_label = data.business.currency_label.strip()
    store.decimals = data.business.decimals
    store.analytics_mode = data.business.analytics_mode
    store.timezone = data.business.timezone.strip()
    store.country = data.business.country.strip()

    store.logo_mode = data.branding.mode
    store.use_factory_brand = data.branding.use_factory_brand
    store.brand_name = data.branding.brand_name.strip()
    store.ui_logo = data.branding.ui_logo
    _put_branding_images(images, data.branding)
    # Колонки картинок остались от прежнего хранения и чистятся здесь: держать
    # ту же картинку в двух местах — верный способ однажды напечатать старую.
    store.logo_image = ""
    store.logo_mark = ""
    store.logo_variants = "{}"
    store.header_layout = data.branding.header_layout
    store.logo_shape = data.branding.logo_shape
    store.logo_emboss = data.branding.logo_emboss
    store.logo_text_template = data.branding.logo_text_template
    store.logo_text_size = data.branding.logo_text_size
    store.logo_text_color = data.branding.logo_text_color.strip()
    store.primary_color = data.branding.primary_color
    store.theme = data.branding.theme
    store.receipt_logo = data.branding.receipt_logo
    store.receipt_header = data.branding.receipt_header
    store.receipt_logo_file = ""
    store.receipt_logo_mark = ""
    store.receipt_logo_variants = "{}"
    store.receipt_logo_shape = data.branding.receipt_logo_shape
    store.receipt_logo_style = data.branding.receipt_logo_style
    store.receipt_logo_threshold = data.branding.receipt_logo_threshold
    store.receipt_roll_width = data.branding.receipt_roll_width
    store.receipt_footer = data.branding.receipt_footer.strip()
    store.touch_screen = data.branding.touch_screen
    store.has_camera = data.branding.has_camera

    full_name = f"{data.owner.first_name.strip()} {data.owner.last_name.strip()}".strip()
    store.owner_first_name = data.owner.first_name.strip()
    store.owner_last_name = data.owner.last_name.strip()
    store.owner_email = data.owner.email.strip()
    store.owner_email_same_as_company = data.owner.email_same_as_company
    store.cashier_code = data.owner.cashier_code.strip()
    store.cashier_full_name = full_name
    # owner_name исторически используется отчётами и шапкой приложения.
    store.owner_name = full_name

    store.phone = data.contacts.phone.strip()
    store.email = data.contacts.email.strip()


def from_store(store: StoreSettings, images: ImageBag | None = None) -> OnboardingData:
    """Собирает онбординг обратно — обратная сторона apply_to_store.

    Картинки приходят отдельным хранилищем (см. images.py) и подставляются в
    те же поля, где интерфейс их и ждёт: наружу контракт не изменился, изменилось
    только место хранения.
    """
    bag = images if images is not None else ImageBag()
    branding_images = _take_branding_images(bag)
    methods = [m for m in (store.payment_methods or "").split(",") if m]
    return OnboardingData(
        fiscal_mode=store.fiscal_mode or "simple",
        edition=store.edition or "start",
        company=CompanyData(
            legal_name=store.company_legal_name,
            short_name=store.company_name,
            inn=store.inn,
        ),
        outlet=OutletData(
            name=store.store_name,
            postal_code=store.postal_code,
            city=store.city,
            street=store.street,
            building=store.building,
            lat=store.latitude,
            lon=store.longitude,
        ),
        tax=TaxData(
            regime=store.tax_regime or "simplified_single",
            vat_rate=store.vat_rate,
            sales_tax_rate=store.sales_tax_rate,
            single_tax_rate=store.single_tax_rate,
        ),
        kkm=KkmData(
            serial_number=store.kkm_serial_number,
            registration_number=store.kkm_registration_number,
            fiscal_module=store.kkm_fiscal_module,
            ffd_version=store.kkm_ffd_version,
            sw_version=store.kkm_sw_version,
            pos_number=store.kkm_pos_number or "1",
        ),
        acquiring=AcquiringData(
            bank=store.acquiring_bank,
            terminal_id=store.acquiring_terminal_id,
            methods=normalize_methods(methods),
            qr_provider=store.acquiring_qr_provider,
            second_screen=store.acquiring_second_screen,
            providers=merge_provider_images(_parse_providers(store.payment_providers), bag),
        ),
        business=BusinessData(
            industry=store.industry or "other",
            currency=store.currency,
            currency_label=store.currency_label,
            decimals=store.decimals,
            analytics_mode=store.analytics_mode or "revenue",
            timezone=store.timezone,
            country=store.country,
        ),
        branding=BrandingData(
            mode=store.logo_mode or "monogram",
            use_factory_brand=store.use_factory_brand,
            brand_name=store.brand_name or "",
            ui_logo=store.ui_logo,
            logo=branding_images["logo"],
            logo_mark=branding_images["logo_mark"],
            logo_wordmark=branding_images["logo_wordmark"],
            logo_combined=branding_images["logo_combined"],
            logo_variants=branding_images["logo_variants"],
            # Пустая колонка — база старше миграции 0020: читаем компоновкой по
            # умолчанию, а не падаем на проверке шаблона.
            header_layout=store.header_layout or "mark_left",
            logo_shape=store.logo_shape or "square",
            logo_emboss=store.logo_emboss,
            logo_text_template=store.logo_text_template or "strict",
            logo_text_size=store.logo_text_size or "m",
            logo_text_color=store.logo_text_color,
            primary_color=store.primary_color or "#00f5bc",
            theme=store.theme or "light",
            receipt_logo=store.receipt_logo,
            receipt_header=store.receipt_header or "logo_name",
            receipt_logo_file=branding_images["receipt_logo_file"],
            receipt_logo_mark=branding_images["receipt_logo_mark"],
            receipt_logo_variants=branding_images["receipt_logo_variants"],
            receipt_logo_shape=store.receipt_logo_shape or "square",
            receipt_logo_style=store.receipt_logo_style or "standard",
            receipt_logo_threshold=store.receipt_logo_threshold,
            receipt_roll_width=store.receipt_roll_width or "80",
            receipt_footer=store.receipt_footer,
            # Пустая колонка — база старше миграции 0023: сенсорного экрана нет,
            # пока специалист не отметит его в мастере.
            touch_screen=bool(store.touch_screen),
            has_camera=bool(store.has_camera),
        ),
        owner=OwnerData(
            first_name=store.owner_first_name,
            last_name=store.owner_last_name,
            email=store.owner_email,
            email_same_as_company=store.owner_email_same_as_company,
            cashier_code=store.cashier_code,
        ),
        contacts=ContactsData(phone=store.phone, email=store.email),
    )
