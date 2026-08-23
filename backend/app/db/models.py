from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class StoreSettings(Base):
    __tablename__ = "store_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Stable local identifier allows a future Cloud migration without
    # replacing local primary keys or losing offline data.
    installation_id: Mapped[str] = mapped_column(
        String(36), nullable=False, default=lambda: str(uuid4()), unique=True
    )
    edition: Mapped[str] = mapped_column(String(16), nullable=False, default="start")
    # fiscal | simple — режим работы кассы. Дискриминант всего онбординга:
    # определяет, какие реквизиты собираются мастером и что печатается в чеке.
    # В простом режиме фискальные колонки ниже остаются пустыми и в чек не
    # попадают, но не удаляются: обратное переключение не должно требовать
    # повторного ввода номеров ККМ.
    fiscal_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="simple")
    # Kept separate from UI settings: editions can be upgraded locally without
    # changing company data or reinstalling the application.
    license_plan: Mapped[str] = mapped_column(String(16), nullable=False, default="start")
    license_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # Краткое наименование («ОсОО Бимар») — шапка чека и заголовки отчётов.
    company_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Полное наименование субъекта из свидетельства о регистрации — печатается
    # в чеке отдельной строкой целиком.
    company_legal_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Устарело: заменено парой company_legal_name / company_name. Колонка
    # оставлена, чтобы не ломать установки, где она уже заполнена.
    legal_form: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    # Место расчётов («Магазин "Бимар"»).
    store_name: Mapped[str] = mapped_column(String(255), nullable=False, default="Мой магазин")
    owner_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    inn: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    currency: Mapped[str] = mapped_column(String(16), nullable=False, default="KGS")
    currency_label: Mapped[str] = mapped_column(String(32), nullable=False, default="сом")
    address: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    phone: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    owner_first_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    owner_last_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    city: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    country: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Bishkek")

    # --- Адрес расчётов по частям -------------------------------------- #
    # Хранится разобранным, а не одной строкой: чек печатает адрес целиком, а
    # налоговая отчётность и будущая выгрузка требуют город и индекс отдельно.
    # Поле address остаётся собранной строкой для совместимости.
    postal_code: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    street: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    building: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    # Координаты точки расчётов. Строками, а не числами: в чек они попадают
    # ровно в том виде, в каком заданы, без потерь на округлении float.
    latitude: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    longitude: Mapped[str] = mapped_column(String(32), nullable=False, default="")

    # --- Налогообложение ------------------------------------------------ #
    tax_regime: Mapped[str] = mapped_column(String(32), nullable=False, default="simplified_single")
    vat_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    sales_tax_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    # Ставка единого налога на упрощённой системе. В чек не печатается: СНО в
    # шапке уже описывает режим, а платёж владелец считает по этой ставке сам.
    single_tax_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0)

    # --- Контрольно-кассовая машина ------------------------------------- #
    kkm_serial_number: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    kkm_registration_number: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    kkm_fiscal_module: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    kkm_ffd_version: Mapped[str] = mapped_column(String(16), nullable=False, default="1.0")
    kkm_sw_version: Mapped[str] = mapped_column(String(32), nullable=False, default="NewCas-F 1.0")
    kkm_pos_number: Mapped[str] = mapped_column(String(8), nullable=False, default="1")

    # --- Эквайринг и способы оплаты ------------------------------------- #
    acquiring_bank: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    acquiring_terminal_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    # Список через запятую: cash,card,qr,nfc,debt. Отдельная таблица для пяти
    # флагов не оправдана, а JSON усложнил бы репликацию в Postgres.
    payment_methods: Mapped[str] = mapped_column(String(128), nullable=False, default="cash,card")
    # Через кого проходит оплата по QR: «MBank», «О!Деньги», «Элсом».
    acquiring_qr_provider: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    # Показывать ли покупателю второй экран с составом чека и QR.
    acquiring_second_screen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Настроенные способы безналичной оплаты, JSON-массив. Секретов здесь нет:
    # мерчант-ключи лежат в payment_secrets и наружу не отдаются.
    payment_providers: Mapped[str] = mapped_column(Text, nullable=False, default="[]")

    # --- Владелец -------------------------------------------------------- #
    # Юридический email компании и email владельца — разные поля: адреса
    # расходятся, как только у магазина появляется бухгалтерия.
    owner_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Была ли при установке отмечена связка «совпадает с email компании».
    owner_email_same_as_company: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    cashier_full_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    cashier_code: Mapped[str] = mapped_column(String(32), nullable=False, default="")

    # Устарело: путь к файлу ломался при переустановке и не попадал в бэкап.
    logo_path: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    # Готовый PNG как data URL — ровно то, что уходит в шапку чека. Хранится в
    # базе, а не файлом: логотип переживает переустановку, уезжает вместе с
    # бэкапом и реплицируется в Postgres без отдельной синхронизации файлов.
    logo_image: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # image | image_text | monogram | none — как логотип собран в редакторе.
    logo_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="monogram")
    # Работать под заводским брендом Kassir ERP: точке, которой логотип не
    # нужен, мастер не должен его навязывать.
    use_factory_brand: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Название системы в интерфейсе: шапка, экран входа, экран активации.
    #
    # НЕ название магазина. Это разные вещи: company_name — реквизит, он
    # печатается в чеке и в документах; brand_name — то, как называется сама
    # программа. Пока отдельной колонки не было, шапка брала название магазина
    # из реквизитов, и касса подписывалась именем торговой точки.
    #
    # Пусто — заводское «Kassir ERP». См. миграцию 0028.
    brand_name: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    # Показывать ли логотип в шапке приложения и на экране покупателя. Отдельно
    # от receipt_logo: экран и лента — разные носители и разные решения.
    ui_logo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Исходный знак без подписи. Хранится отдельно от composed-логотипа, потому
    # что композиция пересобирается при каждой правке текста.
    logo_mark: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Готовые размеры логотипа (512/128/64 и чековый 1-bit), JSON-объект.
    logo_variants: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    # --- Название магазина на экранах -------------------------------------- #
    # Компоновка шапки приложения. Отдельно от receipt_header: экран и лента —
    # разные носители и разные решения владельца.
    #
    #   combined   — знак и надпись одной картинкой (logo_ui/combined)
    #   mark_left  — знак слева, надпись справа
    #   mark_top   — знак сверху, надпись снизу
    #   mark       — только знак
    #   wordmark   — только надпись
    #
    # Само название магазина здесь не хранится: оно берётся из реквизитов
    # (company_name) и рисуется текстом, когда картинки надписи ещё нет.
    header_layout: Mapped[str] = mapped_column(String(16), nullable=False, default="mark_left")
    # Прежний режим шапки (logo | logo_name | name). Колонка осталась ради
    # старых баз: миграция 0021 разложила её значения по header_layout, и
    # больше отсюда никто не читает. Удалять её в SQLite — пересборка таблицы.
    app_header: Mapped[str] = mapped_column(String(16), nullable=False, default="logo_name")
    # square | circle — форма знака на экранах. Круг запекается в PNG вместе с
    # прозрачностью за границей.
    logo_shape: Mapped[str] = mapped_column(String(8), nullable=False, default="square")
    # Объёмный вид бренда в шапке: фаска по контуру и мягкая тень под знаком.
    # Оформление, а не свойство файла: рисуется по альфа-каналу средствами
    # интерфейса и снимается одним переключателем, ничего не пересобирая.
    logo_emboss: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    logo_text: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    logo_text_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    logo_text_position: Mapped[str] = mapped_column(String(16), nullable=False, default="below")
    # strict | round | classic | narrow — начертание названия на экранах.
    logo_text_template: Mapped[str] = mapped_column(String(16), nullable=False, default="strict")
    # s | m | l
    logo_text_size: Mapped[str] = mapped_column(String(4), nullable=False, default="m")
    # Пусто — цвет берётся из темы.
    logo_text_color: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    # --- Логотип в чеке: настраивается отдельно от интерфейсного ------------ #
    # Печатать ли знак на ленте. Не связано с ui_logo: магазин может печатать
    # логотип и не показывать его в шапке, и наоборот.
    receipt_logo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # logo | logo_name | name
    receipt_header: Mapped[str] = mapped_column(String(16), nullable=False, default="logo_name")
    # Отдельная картинка, загруженная специально для чека. Пусто — берётся
    # файл из интерфейса.
    #
    # Нужна потому, что на ленте магазину часто требуется вовсе не тот знак:
    # цветной логотип с тонкими линиями в один бит рассыпается, и туда кладут
    # упрощённый чёрно-белый вариант. Переобрезкой это не решается — это
    # другая картинка.
    receipt_logo_file: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Знак, обрезанный под чек. Пусто — берётся интерфейсный logo_mark.
    receipt_logo_mark: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Ч/б варианты под обе ширины ленты (384 и 288 точек), JSON-объект.
    receipt_logo_variants: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    # square | circle — форма чекового знака. Круглая маска накладывается до
    # перевода в один бит, прозрачное печать заливает белым: иначе вокруг круга
    # печатался бы чёрный квадрат во всю ширину знака.
    receipt_logo_shape: Mapped[str] = mapped_column(String(8), nullable=False, default="square")
    # Касса стоит на сенсорном моноблоке без физической клавиатуры.
    #
    # Свойство железа, а не вкуса, поэтому задаётся специалистом при установке и
    # живёт рядом с остальным оформлением: окна ввода секретов рисуют по нему
    # собственную экранную клавиатуру. Системная клавиатура Windows здесь не
    # годится — она перекрывает окно и в полноэкранном режиме поднимается не
    # всегда, а окно ключа это единственный путь к настройкам.
    #
    # По умолчанию выключено: на установке с клавиатурой лишняя панель на
    # пол-экрана мешает, а включить её специалист может в любой момент.
    touch_screen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # К кассе подключена камера. Отдельно от сенсорного экрана: одно про то, чем
    # вводят, другое — есть ли чем снимать. По нему интерфейс решает, показывать
    # ли разделы, которым нужна съёмка.
    has_camera: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # --- Перебор в окне «Служебный доступ» --------------------------------- #
    #
    # Счётчик общий на окно, а не на дверь, и это не мелочь. В окне одно поле:
    # введённое пробуется и как сервисный ключ, и как пароль владельца. Пока
    # счётчики были раздельными, один неверный ввод засчитывался обеим дверям
    # сразу — пять опечаток закрывали и настройку кассы, и финансы. Здесь
    # неудача засчитывается один раз и только тогда, когда не подошло ничего.
    access_failed_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    access_locked_until: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Шаблон приведения к одному биту: standard | contrast | dither | outline.
    # Одного способа на все логотипы нет — светлый знак пропадает при обычном
    # пороге, а сплошная заливка выходит чёрным прямоугольником.
    receipt_logo_style: Mapped[str] = mapped_column(String(16), nullable=False, default="standard")
    # Порог ч/б, 0–255. Ручная подстройка поверх шаблона.
    receipt_logo_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=176)
    # 58 | 80 — ширина рулона. Определяет и размер знака, и число символов
    # в строке (32 или 48).
    receipt_roll_width: Mapped[str] = mapped_column(String(4), nullable=False, default="80")
    # Стандартный акцент системы. Совпадает с --accent в styles/tokens.css и с
    # DEFAULT_PRIMARY во фронте: расходиться этим трём нельзя, иначе касса,
    # заведённая без прохода по шагу оформления, получит один цвет, а
    # нарисуется другим. См. миграцию 0027.
    primary_color: Mapped[str] = mapped_column(String(16), nullable=False, default="#00f5bc")
    theme: Mapped[str] = mapped_column(String(16), nullable=False, default="light")
    # Последняя строка чека. Пусто — печатается «Спасибо за покупку!».
    receipt_footer: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    # Устарело: заменено на industry с расширенным списком сфер.
    business_type: Mapped[str] = mapped_column(String(32), nullable=False, default="universal")
    # Сфера бизнеса. Задаёт пресет каталога: атрибуты товара, единицы
    # измерения и шаблон карточки (см. desktop/src/onboarding/industries.ts).
    industry: Mapped[str] = mapped_column(String(32), nullable=False, default="other")
    # Знаков после запятой в ценах и суммах.
    decimals: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    # revenue | profit — какая цифра главная на дашборде.
    #
    # Это представление, а не способ учёта: продажи и расходы пишутся в базу
    # одинаково в обоих режимах. Двух систем учёта здесь нет и быть не должно —
    # переключение меняет только то, что вынесено на первый план, поэтому
    # ничего не пересчитывается и ничего не теряется.
    #
    # Прежнее stock_mode удалено: остатки ведутся всегда.
    analytics_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="revenue")
    # License activation (see app/modules/licensing/activation.py). Empty
    # hardware_id means "not yet bound" and is treated as a match.
    activation_key: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    # Хэш сервисного ключа: сам ключ в открытом виде не хранится. Колонка
    # activation_key оставлена для показа маски и переноса лицензии.
    service_key_hash: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    hardware_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    activated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Устарело: заменён сервисным PIN. Колонка оставлена, чтобы установки с
    # уже заданным мастер-паролем продолжали открываться, пока владелец не
    # задаст PIN.
    master_password_hash: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Сервисный PIN (4–6 цифр): подтверждает опасные действия у кассы —
    # отмену чека, возврат, доступ к финансам, удаление данных. Живёт здесь, а
    # не в users, потому что он один на установку и не зависит от смены.
    service_pin_hash: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Пароль владельца — отдельный секрет, а не пароль входа.
    #
    # Раньше дверь владельца открывал пароль учётной записи, и это было ошибкой
    # разделения ролей. На кассе почти всегда залогинен аккаунт владельца, а за
    # клавиатурой стоит кассир: пароль, который владелец диктует по телефону
    # («зайди под моим, пробей возврат»), открывал заодно финансы, аналитику и
    # сотрудников. Теперь это два независимых секрета, и смена одного не меняет
    # другой. Хранится хэшем (argon2id), как и остальные.
    owner_password_hash: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Длина пароля владельца. Ноль — неизвестна (установка старше миграции 0024).
    #
    # Нужна, чтобы отсекать заведомо не подходящее до дорогой проверки: одна
    # argon2id стоит 120 мс и 64 МБ, и запускать её на каждый набранный кусок
    # пароля — верный способ занять машину целиком. Разбор, почему хранить длину
    # не опасно, — в самой миграции 0024.
    owner_password_length: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # --- Защита пароля владельца от перебора ----------------------------- #
    # Счётчик и блокировка живут в базе, а не в памяти процесса: перезапуск
    # приложения не должен обнулять попытки — иначе защита обходится
    # выключением питания.
    owner_failed_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    owner_locked_until: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # То же для сервисного ключа. Счётчик отдельный: блокировка одной двери не
    # должна закрывать другую — иначе кассир, трижды промахнувшийся мимо своей,
    # запирает владельца снаружи собственных финансов.
    service_failed_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    service_locked_until: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    setup_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    setup_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class StoreImage(Base):
    """Картинки установки: логотипы и снимки QR.

    Отдельная таблица, а не колонки в store_settings, и это не вкусовщина.
    Картинки лежали в реквизитах строками base64: один логотип 512×512 — это
    порядка 200 КБ текста, а их набирается с десяток. Строка настроек
    раздувалась до мегабайтов, и её тянул каждый запрос реквизитов — включая
    те, где нужен один телефон. Здесь картинка лежит байтами (BLOB), рядом с
    ней только тип содержимого, а в реквизитах остаётся ссылка вида «вид +
    слот».

    Байтами, а не файлами на диске: файл ломается при переустановке, не
    попадает в бэкап базы и не реплицируется на вторую кассу — ровно те
    грабли, из-за которых поле logo_path когда-то и стало ненужным.

    Три независимые сущности задаются полем `kind`:
      * `logo_ui` — знак для экранов и его готовые размеры;
      * `logo_receipt` — знак для ленты со своей обрезкой и ч/б вариантами;
      * `qr` — снимок QR, у каждого способа оплаты свой.

    `slot` различает картинки внутри вида: размер логотипа (`s128`, `w384`)
    или идентификатор способа оплаты для QR.
    """

    __tablename__ = "store_images"
    __table_args__ = (UniqueConstraint("kind", "slot", name="uq_store_images_kind_slot"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # logo_ui | logo_receipt | qr
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    slot: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    # image/png, image/jpeg, image/svg+xml — нужен, чтобы собрать data URL обратно.
    mime: Mapped[str] = mapped_column(String(64), nullable=False, default="image/png")
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class User(Base):
    """Владелец и сотрудники магазина.

    PIN живёт здесь, а не в store_settings, и это существенно: PIN у каждого
    кассира свой. Общий PIN на установку означал, что по журналу нельзя
    сказать, кто именно отменил чек, — а именно для этого журнал и нужен.

    PIN не заводится при установке: на этом шаге кассиров ещё нет. Их
    добавляют позже, в разделе «Сотрудники» скрытых настроек владельца.
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="cashier")  # owner|admin|cashier
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Хэш PIN кассира (4–6 цифр), argon2id. Пусто — PIN не задан, кассовые
    # операции этот сотрудник подтвердить не может.
    pin_hash: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Права через запятую: sell,refund,discount,shift. Хранятся строкой, а не
    # отдельной таблицей: набор фиксированный и короткий, а join ради четырёх
    # флагов на каждой проверке прав — лишняя работа на слабой машине.
    permissions: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    products: Mapped[list["Product"]] = relationship(back_populates="category")


class Product(Base):
    """Позиция каталога: товар, услуга или комплект.

    ЦЕНЫ ЗДЕСЬ ВО FLOAT, и это осознанное ограничение, а не недосмотр. На этих
    трёх колонках стоит вся касса: витрина, чек, возврат, закупка, отчёты.
    Перевести их в тыйыны значит переписать продажу целиком. Поэтому граница
    проходит по API: наружу и внутрь новые разделы говорят целыми тыйынами, а
    перевод делается ровно один раз, функциями из app/core/money.py.

    `kind` различает три вида позиции, и от него зависит почти всё:

        piece / weight — товар. Есть остаток, списывается при продаже.
        service        — услуга. Остатка нет, не списывается, продаётся
                         неограниченно.
        bundle         — комплект. Своего остатка НЕТ: при продаже списываются
                         составляющие (product_bundle_items). Остаток комплекта
                         считается как минимум по составу.
    """

    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    barcode: Mapped[str] = mapped_column(String(64), nullable=False, default="", index=True)
    extra_barcodes: Mapped[str] = mapped_column(Text, nullable=False, default="")  # comma-separated
    # piece|weight|service|bundle
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="piece")
    unit: Mapped[str] = mapped_column(String(16), nullable=False, default="шт")
    price: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    wholesale_price: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    cost_price: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    stock_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id"), nullable=True)
    image: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # ── Добавлено миграцией 0031 ─────────────────────────────────────────────

    # При каком остатке товар считается заканчивающимся. Ноль — не следим.
    min_stock: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    # Срок годности. Дата, а не строка: по ней строится список «истекает».
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    brand: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    country: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # Поставщик — ССЫЛКА на справочник, а не текст. Текстовое поле означало бы
    # три написания одного поставщика и невозможность спросить «что он возит».
    supplier_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("suppliers.id"), nullable=True, index=True
    )

    # С какого количества действует оптовая цена. Ноль — опт не ограничен.
    wholesale_from_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0)

    # Комплект: своя цена или сумма составляющих.
    bundle_price_mode: Mapped[str] = mapped_column(String(8), nullable=False, default="own")

    # Ключ формы, приславшей товар.
    #
    # Защита от дубля при повторной отправке: интерфейс генерирует его один раз
    # на открытие формы, сервер держит по нему уникальный индекс. Второе
    # нажатие «Сохранить» и повторный запрос после обрыва сети возвращают уже
    # созданный товар, а не заводят второй такой же.
    client_token: Mapped[str] = mapped_column(String(64), nullable=False, default="")

    category: Mapped[Optional[Category]] = relationship(back_populates="products")
    stock_moves: Mapped[list["StockMove"]] = relationship(back_populates="product")
    media: Mapped[list["ProductMedia"]] = relationship(
        back_populates="product", cascade="all, delete-orphan"
    )


class ProductMedia(Base):
    """Фото и видео товара. САМИ ФАЙЛЫ ЛЕЖАТ НА ДИСКЕ, здесь только ссылка.

    Почему не в базе. Пять фото и видео на товар при двадцати тысячах товаров —
    это десятки гигабайт в одном файле SQLite. Он копируется целиком при каждой
    резервной копии, читается при каждом запросе к товару и переносится при
    восстановлении. Касса при этом обязана отвечать мгновенно.

    Файлы лежат РЯДОМ с базой (`<папка базы>/media/products`) — специально,
    чтобы попадать в ту же резервную копию: разнесённые по разным местам база и
    картинки рано или поздно разъезжаются, и товар остаётся без фото.

    Уменьшенная копия (`thumb_name`) обязательна для фото: в списке товаров и
    на витрине кассы показывается только она. Оригинал открывается по нажатию.
    """

    __tablename__ = "product_media"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(8), nullable=False, default="photo")  # photo|video
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    file_name: Mapped[str] = mapped_column(String(128), nullable=False)
    thumb_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    mime: Mapped[str] = mapped_column(String(64), nullable=False, default="image/jpeg")
    bytes_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    width: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    height: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    product: Mapped[Product] = relationship(back_populates="media")


class ProductBundleItem(Base):
    """Строка состава комплекта: какой товар и сколько его входит.

    Комплект ссылается на обычные товары, а не хранит их копию: цена и остаток
    составляющей меняются в её собственной карточке, и комплект обязан видеть
    изменение сразу.

    Вложенных комплектов нет намеренно. Комплект из комплектов даёт рекурсию
    при списании: на кассе, в горячем пути продажи, разворачивать дерево
    неизвестной глубины нельзя, а ограничивать глубину числом — значит однажды
    в это число упереться. Один уровень покрывает то, ради чего комплекты
    заводят: «чай + пирожок».
    """

    __tablename__ = "product_bundle_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bundle_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    qty: Mapped[float] = mapped_column(Float, nullable=False, default=1)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class StockMove(Base):
    __tablename__ = "stock_moves"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    qty_delta: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[str] = mapped_column(String(64), nullable=False)  # sale|purchase|adjust|return
    ref_type: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    ref_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    note: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)

    product: Mapped[Product] = relationship(back_populates="stock_moves")


class ExpenseCategory(Base):
    """Справочник категорий расходов.

    Редактируемый: набор по умолчанию покрывает типовой магазин, но у каждого
    магазина находится своё — маркетинг, ремонт, доставка. Заводить категории
    константами в коде значило бы требовать пересборку ради строки в списке.

    `slug` заполнен только у категорий, заведённых при установке: по нему код
    находит «Закупку товара», куда автоматически падает оприходование прихода.
    У категорий, созданных владельцем вручную, slug пустой.
    """

    __tablename__ = "expense_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    # Пустой у пользовательских категорий. Уникальность обеспечивается кодом
    # засева: делать колонку unique нельзя — пустых строк будет много.
    slug: Mapped[str] = mapped_column(String(32), nullable=False, default="", index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Скрытая категория не предлагается при вводе, но прошлые расходы с ней
    # остаются: удалять её вместе с историей нельзя.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    expenses: Mapped[list["Expense"]] = relationship(back_populates="category")


class Expense(Base):
    """Расход магазина.

    Пишется всегда, независимо от режима аналитики: режим определяет только
    то, какая цифра на дашборде главная, а не то, что попадает в базу. Иначе
    переключение режима означало бы дыру в истории.

    Два источника. Ручной — владелец заносит аренду, налоги, зарплату в
    разделе «Финансы». Автоматический — оприходование прихода на склад: закупка
    товара это расход, и требовать, чтобы владелец продублировал её руками,
    значит гарантированно получить расхождение.
    """

    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    category_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("expense_categories.id"), nullable=True, index=True
    )
    amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    note: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    # manual — занёс владелец; purchase — приход на склад.
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    # На что ссылается автоматический расход: тип и идентификатор документа.
    # По ним расход находят обратно, а не ищут по сумме и дате.
    ref_type: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    ref_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    # Дата расхода. Отдельно от created_at: аренду за прошлый месяц заносят
    # сегодня, и в отчёт она должна попасть прошлым месяцем.
    spent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)

    category: Mapped[Optional[ExpenseCategory]] = relationship(back_populates="expenses")


class Shift(Base):
    """Кассовая смена.

    Таблица старая, но половина колонок новая, и они живут по разным правилам —
    это надо знать, прежде чем что-то здесь править.

    СТАРЫЕ колонки во float (`open_cash`, `close_cash`, `sales_total`) остаются
    и продолжают заполняться. На них стоит касса: `services/posShift.ts`,
    `ShiftModal`, витрина смены в правой панели. Убрать их значило бы
    переписывать продажу ради чужой задачи.

    НОВЫЕ колонки — в тыйынах, целыми (`*_tiyin`). Все расчёты смены, сверка и
    расхождение считаются ТОЛЬКО по ним: копейка, потерянная на округлении
    float, в сверке наличных превращается в недостачу, которой не было.

    Обе половины пишет одно место — `app/modules/shifts/service.py`, — и
    разойтись им негде.
    """

    __tablename__ = "shifts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    open_cash: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    close_cash: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    sales_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sales_total: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")  # open|closed
    cashbox_name: Mapped[str] = mapped_column(String(128), nullable=False, default="Основная")

    # ── Ниже — то, что добавила миграция 0030 ────────────────────────────────

    # Номер смены. Отдельно от `id`, потому что в отчёте кассир называет именно
    # номер, а id — это ключ строки: он может разъехаться при переносе базы.
    number: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)

    # Размен на начало смены, целыми тыйынами. Дубль `open_cash`, и это
    # осознанно: см. шапку класса.
    open_cash_tiyin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Что кассир НАСЧИТАЛ в ящике при закрытии. Ноль у открытой смены.
    counted_cash_tiyin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Что должно быть в ящике по расчёту системы — снимок на момент закрытия.
    # Хранится, а не пересчитывается при каждом открытии карточки: закрытую
    # смену менять нельзя, и её расчётная сумма обязана остаться той, по
    # которой сверялись, даже если завтра поменяется формула.
    expected_cash_tiyin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Расхождение: насчитано минус расчётное. Отрицательное — недостача.
    variance_tiyin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # ── Снимок показателей на момент закрытия ────────────────────────────────
    #
    # Дублируют то, что считается агрегатом по чекам смены, и это не лень, а
    # замер. История смен показывает пять чисел на строку; страница в 50 смен
    # на базе с двумя годами торговли — это 12 000 чеков, которые пришлось бы
    # обходить агрегатом на каждое открытие раздела. Замер: 64 мс, и индекс
    # тут не помогает — при такой доле выборки полный проход и есть правильный
    # план.
    #
    # У ЗАКРЫТОЙ смены эти числа неизменны по определению: закрытую смену
    # править нельзя, а её чеки уже не меняются. Поэтому они пишутся один раз
    # при закрытии и дальше читаются как есть. У открытой смены снимка нет —
    # её показатели считаются вживую.
    revenue_tiyin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cash_tiyin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cashless_tiyin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    refunds_tiyin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Чем объяснили расхождение. Пусто у смены, закрытой ровно.
    variance_reason: Mapped[str] = mapped_column(String(512), nullable=False, default="")

    # Кто открыл и кто закрыл. Имя снимком, а не только ссылкой на users:
    # сотрудника могут переименовать или деактивировать, а отчёт смены обязан
    # остаться тем, что напечатали при закрытии.
    opened_by_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    closed_by_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    closed_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)


class Sale(Base):
    __tablename__ = "sales"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doc_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="paid")  # paid|debt|canceled|refunded|partial_refund
    payment_method: Mapped[str] = mapped_column(String(32), nullable=False, default="cash")
    subtotal: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    discount_total: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    total: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    cash_received: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    card_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    change_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    debt_balance: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    client_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    client_phone: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    shift_id: Mapped[Optional[int]] = mapped_column(ForeignKey("shifts.id"), nullable=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    cashier_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str] = mapped_column(String(512), nullable=False, default="")

    # --- Как именно приняли безнал --------------------------------------- #
    # Идентификатор и название провайдера: в выписке банка платёж ищут по ним.
    payment_provider: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    payment_provider_title: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    # Референс платежа в банке — печатается в фискальном чеке.
    payment_ref: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    # auto — подтвердил банк или терминал; manual — кассир глазами.
    # Ручные подтверждения владелец смотрит отдельным отчётом: именно там
    # прячется приём скриншота чужого платежа.
    payment_confirmation: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")

    items: Mapped[list["SaleItem"]] = relationship(back_populates="sale", cascade="all, delete-orphan")
    payments: Mapped[list["DebtPayment"]] = relationship(back_populates="sale", cascade="all, delete-orphan")


class AuditEntry(Base):
    """Журнал изменений в скрытых настройках.

    Пишется всё, что меняют за закрытой дверью: кто, когда, что и во что. Без
    этого спор «настройки поменялись сами» разрешить нечем, а специалист и
    владелец ходят в одни и те же разделы.
    """

    __tablename__ = "audit_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # owner | specialist — за каким ключом вошли.
    actor_kind: Mapped[str] = mapped_column(String(16), nullable=False, default="owner")
    actor_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Что произошло: 'settings.change', 'access.granted', 'access.denied'…
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Что именно изменили: 'branding.primaryColor', 'fiscalMode'…
    target: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    old_value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    new_value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class OwnerEntryPhoto(Base):
    """Снимок того, кто открыл кабинет владельца.

    Не распознавание и не защита: дверь по-прежнему открывает только пароль
    владельца. Это след — владелец видит, кто именно заходил в его финансы.
    Для магазина, где деньги смотрит один человек, а за кассой стоит смена, след
    работает не хуже замка: подобрать пароль незаметно больше нельзя.

    Отдельная таблица, а не колонка в журнале: снимок это десятки килобайт, и
    держать их в audit_entries значило бы раздуть таблицу, которую читают
    постранично ради текста. Запись в журнале при этом всё равно появляется —
    здесь лежит только картинка, и по времени они сходятся.

    Старые снимки удаляются при вставке новых (см. KEEP_LAST в роутере): база
    ездит в резервных копиях, и расти ей от этого бесконечно нельзя.
    """

    __tablename__ = "owner_entry_photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Под какой учётной записью была касса в момент входа. Не «кто на снимке»:
    # кто на снимке, решает глазами владелец, а не программа.
    actor_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # JPEG в виде data URL. Кадр маленький (320×240): его задача — узнать
    # человека в лицо, а не разглядеть, а место в резервной копии не бесконечно.
    image: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class PaymentSecret(Base):
    """Мерчант-ключ банка.

    Отдельная таблица, а не колонка в настройках: ключ не должен уезжать в
    интерфейс вместе с остальными реквизитами, которые кассовая часть
    кэширует в браузерном хранилище.
    """

    __tablename__ = "payment_secrets"

    provider_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    api_key: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class PaymentIntent(Base):
    """Платёж, заведённый в банке под конкретный чек."""

    __tablename__ = "payment_intents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    payment_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    provider_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    order_id: Mapped[str] = mapped_column(String(64), nullable=False, default="", index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    # pending | paid | failed | canceled
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    reference: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    settled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class PaymentEvent(Base):
    """Отменённые и просроченные попытки оплаты.

    Продажи после них не остаётся, и без этой записи причина, по которой
    покупатель ушёл без чека, нигде не видна.
    """

    __tablename__ = "payment_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    provider_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    order_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    # canceled | timeout
    event: Mapped[str] = mapped_column(String(16), nullable=False, default="canceled")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class SaleItem(Base):
    __tablename__ = "sale_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sales.id"), nullable=False, index=True)
    product_id: Mapped[Optional[int]] = mapped_column(ForeignKey("products.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_weight: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_service: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False, default=1)
    unit_price: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    discount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    line_total: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    cost_price: Mapped[float] = mapped_column(Float, nullable=False, default=0)

    sale: Mapped[Sale] = relationship(back_populates="items")


class DebtPayment(Base):
    __tablename__ = "debt_payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sales.id"), nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    payment_method: Mapped[str] = mapped_column(String(32), nullable=False, default="cash")
    cash_received: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    change_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    note: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    sale: Mapped[Sale] = relationship(back_populates="payments")


class SaleCounter(Base):
    """Singleton for sale document numbers."""

    __tablename__ = "sale_counters"
    __table_args__ = (UniqueConstraint("id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    last_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class CashMovement(Base):
    """Движение наличных в ящике, зафиксированное отдельной записью.

    Здесь лежит НЕ ВСЁ движение денег, и это главное про эту таблицу.

    Продажи наличными сюда не пишутся. Продажа — горячий путь кассы, и вешать
    на неё лишнюю вставку ради отчёта, который открывают раз в смену, нельзя:
    сумма наличных по продажам считается агрегатом из `sales`
    (`cash_received - change_amount`) одним запросом. Поле выбрано намеренно —
    возврат его не меняет, поэтому возвраты не вычитаются дважды.

    Пишется сюда то, чего в `sales` нет вовсе:

      deposit      внесение — кассир доложил наличные в ящик;
      withdrawal   изъятие (инкассация) — наличные забрали;
      refund       возврат наличными: `sales` хранит только новый итог чека,
                   а сколько денег вынули из ящика — только здесь;
      debt_payment погашение долга наличными. Это тоже деньги в ящик, и без
                   них расчётная сумма занижена, то есть касса показывает
                   недостачу там, где её нет.

    Сумма ЗНАКОВАЯ и в целых тыйынах: внесение положительное, изъятие и
    возврат отрицательные. Знак в данных, а не в коде отчёта, — иначе каждое
    место, которое складывает движения, обязано помнить таблицу знаков.
    """

    __tablename__ = "cash_movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    shift_id: Mapped[int] = mapped_column(ForeignKey("shifts.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    amount_tiyin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reason: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    comment: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    # Кто забрал деньги при изъятии. Отдельно от `user_id`: инкассацию делает
    # не тот, кто стоит за кассой, а тот, кому её отдали.
    actor_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    ref_type: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    ref_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class Supplier(Base):
    """Поставщик.

    Физически не удаляется никогда — только `is_active = False`. За поставщиком
    стоят документы прихода и история расчётов, и удалить строку значит
    оставить их без имени: отчёт за прошлый год превратился бы в список
    «поставщик №14».
    """

    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    contact_person: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    phone: Mapped[str] = mapped_column(String(64), nullable=False, default="", index=True)
    address: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    comment: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PurchaseDoc(Base):
    """Документ закупки — приход товара от поставщика.

    Одна таблица на приход и на возврат поставщику (`kind`), а не две. Возврат
    — это тот же документ с теми же строками, только при проведении остаток
    уменьшается, а не растёт. Второй таблицей пришлось бы дублировать список,
    фильтры, проведение и отмену проведения целиком.

    Состояния: draft → posted → canceled. Черновик не влияет ни на остатки, ни
    на цены, ни на долг. Отменённый документ остаётся в базе с пометкой —
    физически документы не удаляются.
    """

    __tablename__ = "purchase_docs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    number: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="purchase")  # purchase|return
    supplier_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("suppliers.id"), nullable=True, index=True
    )
    # Дата документа — та, что стоит на накладной, а не время создания записи.
    # Накладную часто заводят на следующий день, и приход обязан лечь в тот
    # день, когда товар пришёл.
    doc_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    invoice_number: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    comment: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    # Как рассчитались: оплачено сразу или в долг. При долге растёт
    # задолженность перед поставщиком, и тогда же значим `due_date`.
    settlement: Mapped[str] = mapped_column(String(16), nullable=False, default="paid")  # paid|credit
    due_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", index=True)

    # Итоги документа — снимок, посчитанный при сохранении строк. Хранится, а
    # не считается на лету: список документов иначе тянул бы SUM по строкам на
    # каждую страницу, а это тот самый запрос в цикле.
    total_tiyin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    positions_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0)

    posted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    posted_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    # Для возврата — на какой приход он ссылается. У обычной закупки пусто.
    source_doc_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("purchase_docs.id"), nullable=True
    )
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    lines: Mapped[list["PurchaseLine"]] = relationship(
        back_populates="doc", cascade="all, delete-orphan"
    )


class PurchaseLine(Base):
    """Строка документа закупки.

    Три колонки `before_*` — это снимок карточки товара НА МОМЕНТ ПРОВЕДЕНИЯ, и
    без них отмена проведения работать не может.

    Себестоимость пересчитывается средневзвешенной, а такой пересчёт
    необратим: из новой средней и цены прихода нельзя восстановить старую
    среднюю, если между приходом и отменой была продажа — остаток уже другой.
    Поэтому «отменить проведение» не считает обратную формулу, а возвращает
    ровно те значения, которые стояли до него.
    """

    __tablename__ = "purchase_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doc_id: Mapped[int] = mapped_column(ForeignKey("purchase_docs.id"), nullable=False, index=True)
    product_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("products.id"), nullable=True, index=True
    )
    # Название и штрихкод снимком: товар могут переименовать, а накладная
    # обязана остаться такой, какой её провели.
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    barcode: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    unit: Mapped[str] = mapped_column(String(16), nullable=False, default="шт")
    qty: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    # Закупочная цена за единицу и сумма строки — целыми тыйынами.
    cost_tiyin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    line_total_tiyin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Розничная цена, которую проведение поставит товару. Наценка не хранится:
    # она однозначно считается из этих двух чисел, а два источника одной
    # величины рано или поздно разойдутся.
    retail_tiyin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    before_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    before_cost_tiyin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    before_retail_tiyin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    doc: Mapped[PurchaseDoc] = relationship(back_populates="lines")


class SupplierPayment(Base):
    """Оплата поставщику.

    Выдача денег, поэтому заводится только за дверью владельца — проверка
    стоит на сервере (`require_owner`), а не в интерфейсе.
    """

    __tablename__ = "supplier_payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), nullable=False, index=True)
    amount_tiyin: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    paid_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    method: Mapped[str] = mapped_column(String(16), nullable=False, default="cash")
    comment: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PurchaseCounter(Base):
    """Счётчик номеров документов закупки. Устроен как `sale_counters`."""

    __tablename__ = "purchase_counters"
    __table_args__ = (UniqueConstraint("id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    last_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ShiftCounter(Base):
    """Счётчик номеров смен. Отдельный от `id` — см. `Shift.number`."""

    __tablename__ = "shift_counters"
    __table_args__ = (UniqueConstraint("id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    last_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SyncLogEntry(Base):
    """Outbox of changes made while running on the SQLite fallback engine.

    Drained by app/core/sync.py back into Postgres once it is reachable
    again. `target` distinguishes future consumers (e.g. a later cloud push)
    from today's only consumer, local Postgres reconciliation, without
    needing a schema change when that consumer is added.
    """

    __tablename__ = "sync_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    table_name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    row_pk: Mapped[str] = mapped_column(String(64), nullable=False)
    operation: Mapped[str] = mapped_column(String(16), nullable=False)  # insert|update|delete
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    target: Mapped[str] = mapped_column(String(24), nullable=False, default="postgres_reconcile")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)
    # pending|syncing|synced|failed_retryable|failed_permanent
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    origin_engine: Mapped[str] = mapped_column(String(16), nullable=False, default="sqlite")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class SyncPkMap(Base):
    """Maps a row's SQLite-assigned PK to the PK Postgres assigned it on replay.

    SQLite and Postgres each hand out their own autoincrement integers
    independently, so a row created offline needs its dependents' foreign
    keys rewritten to the Postgres-side id once it's been replayed.
    """

    __tablename__ = "sync_pk_map"
    __table_args__ = (UniqueConstraint("table_name", "sqlite_pk"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    table_name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    sqlite_pk: Mapped[str] = mapped_column(String(64), nullable=False)
    postgres_pk: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
