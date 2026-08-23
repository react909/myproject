/**
 * OnboardingData — единственный источник истины о магазине.
 *
 * Состав полей продиктован фискальным чеком: каждая строка чека берётся
 * отсюда, и наоборот — здесь нет полей, которые никуда не печатаются и ничего
 * не настраивают. Один и тот же тип используют мастер первого запуска,
 * раздел реквизитов в настройках и модуль печати чека; параллельных
 * интерфейсов для тех же данных заводить нельзя.
 *
 * Соответствие строк чека полям задано в fields.ts (свойство `receiptLine`),
 * чтобы связь была видна в коде, а не только в документации.
 */

import { DEFAULT_PRIMARY } from '../auth/applyTheme'
import type { ThemeMode } from '../auth/applyTheme'
import type { PaymentProviderConfig } from '../payments/types'
import { defaultProviderConfigs } from '../payments/types'
import type { IndustryId } from './industries'
import type { ThermalStyle } from './logoCanvas'

/**
 * Режим работы — дискриминант всего онбординга.
 *
 * `fiscal`: касса зарегистрирована в ГНС, чек фискальный. Нужны ИНН, СНО,
 * координаты и реквизиты ККМ.
 * `simple`: только учёт товара и продаж, печатается товарный чек. Ничего из
 * фискального блока не спрашивается и не печатается.
 *
 * От этого поля зависят и набор полей формы, и их проверки, и состав чека.
 * Разветвлений по режиму в коде экранов быть не должно: реестр полей
 * (fields.ts) отдаёт уже отфильтрованный набор, а чек собирается из него же.
 */
export type FiscalMode = 'fiscal' | 'simple'

export const FISCAL_MODES: {
  id: FiscalMode
  label: string
  summary: string
  /** Что именно придётся заполнить — на карточке выбора это главное. */
  needs: string
}[] = [
  {
    id: 'fiscal',
    label: 'С фискальной кассой',
    summary: 'Касса зарегистрирована в ГНС, печатаем фискальный чек с QR',
    needs: 'Нужно: ИНН, ЗН/РН ККМ, СНО, координаты',
  },
  {
    id: 'simple',
    label: 'Без фискальной кассы',
    summary: 'Только учёт товара и продаж, товарный чек без фискальных данных',
    needs: 'Нужно: название, адрес, телефон — и всё',
  },
]

/**
 * Тариф установки.
 *
 * Совпадает с тем, что понимает сервер (`edition` в /api/setup/init и
 * `license_plan` в базе): расходиться этим двум спискам нельзя, иначе касса
 * пообещает то, чего не включит.
 *
 * Что именно даёт «Стандарт», взято из проверки прав на сервере
 * (LicenseManager.has_feature): расширенные отчёты, финансы и несколько
 * рабочих мест. Цен и сроков в проекте нет, и выдумывать их здесь нечего —
 * подписи говорят только о составе.
 */
export type Edition = 'start' | 'standard'

export const EDITIONS: { id: Edition; label: string; note: string }[] = [
  {
    id: 'start',
    label: 'Старт',
    note: 'Продажи, товары, смены и чеки. Одно рабочее место',
  },
  {
    id: 'standard',
    label: 'Стандарт',
    note: 'Дополнительно: расширенные отчёты, финансы и несколько рабочих мест',
  },
]

/** Способы оплаты, которые печатаются в чеке и предлагаются на кассе. */
export type PaymentMethodId = 'cash' | 'card' | 'qr' | 'nfc'

export const PAYMENT_METHODS: { id: PaymentMethodId; label: string; hint: string }[] = [
  { id: 'cash', label: 'Наличные', hint: 'Всегда доступны' },
  { id: 'card', label: 'Банковская карта', hint: 'Через терминал эквайринга' },
  { id: 'qr', label: 'QR', hint: 'Оплата по QR-коду банка' },
  { id: 'nfc', label: 'NFC Pay', hint: 'Бесконтактная оплата' },
]

/*
 * Режима склада здесь больше нет.
 *
 * Остатки ведутся всегда: отчёт по остаткам нужен любому магазину, а точка,
 * выбравшая «без остатков», оставалась без него навсегда и узнавала об этом
 * через полгода работы. Выбор был ложным — он экономил одно поле в карточке
 * товара ценой целого раздела учёта.
 */

/**
 * Какая цифра на дашборде главная.
 *
 * Важно, чем это НЕ является: это не два способа вести учёт. Учёт в базе
 * одинаковый в обоих режимах — все продажи и все расходы пишутся всегда.
 * Разница только в том, что вынесено на первый план, поэтому переключение
 * ничего не пересчитывает и ничего не теряет.
 */
export type AnalyticsMode = 'revenue' | 'profit'

export const ANALYTICS_MODES: {
  id: AnalyticsMode
  label: string
  /** Что становится главной цифрой. */
  hint: string
  /** Ради чего это выбирают — по этой строке человек узнаёт свой случай. */
  suits: string
}[] = [
  {
    id: 'revenue',
    label: 'Только продажи',
    hint: 'Главная цифра — выручка от продаж. Расходы записываются отдельно и на неё не влияют',
    suits: 'Проще, видно оборот магазина',
  },
  {
    id: 'profit',
    label: 'Выручка минус расходы',
    hint: 'Главная цифра — чистая прибыль. Закупка товара, налоги, аренда, свет, зарплата вычитаются из выручки',
    suits: 'Видно, сколько реально заработано',
  },
]

/** Система налогообложения — печатается в чеке строкой «СНО». */
export type TaxRegimeId = 'simplified_single' | 'general' | 'patent' | 'none'

export const TAX_REGIMES: {
  id: TaxRegimeId
  label: string
  receiptLabel: string
  /** Подсказка под полем: владелец магазина не обязан знать налоговый кодекс. */
  hint: string
}[] = [
  {
    id: 'simplified_single',
    label: 'Упрощённая (единый налог)',
    receiptLabel: 'Упрощённая система налогообложения на основе единого налога',
    hint: 'Торговля до 50 млн сом — 0,5%. Микробизнес до 8 млн с ККМ — 0%.',
  },
  {
    id: 'general',
    label: 'Общий режим',
    receiptLabel: 'Общий налоговый режим',
    hint: 'НДС обязателен при обороте свыше 30 млн сом в год.',
  },
  {
    id: 'patent',
    label: 'Патент',
    receiptLabel: 'Налог на основе патента',
    hint: 'Налог уплачен вперёд, в чеке ставки нулевые.',
  },
  {
    id: 'none',
    label: 'Без указания',
    receiptLabel: '',
    hint: 'Для нефискального режима.',
  },
]

/**
 * Ставки, которые подставляются при выборе режима.
 *
 * Смысл в том, чтобы человек не искал проценты в интернете: типовой набор
 * подставляется сам и остаётся редактируемым — у конкретного магазина ставки
 * могут отличаться, и спорить с ним программа не должна.
 */
export const TAX_PRESETS: Record<TaxRegimeId, Pick<TaxData, 'vatRate' | 'salesTaxRate' | 'singleTaxRate'>> = {
  // Общий режим: НДС 12%. НСП по безналу 0%, по наличным 1–2% — берём нижнюю
  // границу, точное значение владелец поправит под свой оборот.
  general: { vatRate: 12, salesTaxRate: 0, singleTaxRate: 0 },
  // Упрощённая: единый налог 0,5% для торговли, НДС и НСП нулевые.
  simplified_single: { vatRate: 0, salesTaxRate: 0, singleTaxRate: 0.5 },
  patent: { vatRate: 0, salesTaxRate: 0, singleTaxRate: 0 },
  none: { vatRate: 0, salesTaxRate: 0, singleTaxRate: 0 },
}

export function taxRegimeHint(regime: TaxRegimeId): string {
  return TAX_REGIMES.find((item) => item.id === regime)?.hint ?? ''
}

/** Как логотип попадает в шапку чека. */
export type LogoMode =
  /** Только картинка. */
  | 'image'
  /** Картинка и под ней подпись своим текстом. */
  | 'image_text'
  /** Монограмма из шаблона (без загрузки файла). */
  | 'monogram'
  /** Без логотипа — в шапке только название. */
  | 'none'

export type CompanyData = {
  /** Полное наименование субъекта: «Общество с ограниченной ответственностью "Бимар"». */
  legalName: string
  /** Краткое наименование для шапки чека: «ОсОО Бимар». */
  shortName: string
  /** ИНН, 14 цифр в КР. */
  inn: string
}

export type OutletData = {
  /** Место расчётов: «Магазин "Бимар"». */
  name: string
  postalCode: string
  city: string
  street: string
  building: string
  /** Координаты точки расчётов, печатаются в чеке. Пустая строка — не задано. */
  lat: string
  lon: string
}

export type TaxData = {
  regime: TaxRegimeId
  /** Ставка НДС в процентах. */
  vatRate: number
  /**
   * Ставка НСП (налог с продаж) в процентах. Отдельный от НДС налог: если
   * магазин не плательщик НДС — 2% для торговли и 3% для услуг; если
   * плательщик — 0% по безналу и 1–2% по наличным.
   */
  salesTaxRate: number
  /** Ставка единого налога на упрощённой системе, в процентах. */
  singleTaxRate: number
}

export type KkmData = {
  /** ЗН ККМ — заводской номер. */
  serialNumber: string
  /** РН ККМ — регистрационный номер. */
  registrationNumber: string
  /** ФМ — номер фискального модуля. */
  fiscalModule: string
  /** Версия ФФД — только чтение, задаётся прошивкой. */
  ffdVersion: string
  /** Версия ПО кассы — только чтение. */
  swVersion: string
  /** Номер кассы в магазине. */
  posNumber: string
}

export type AcquiringData = {
  /** Банк-эквайер: «Оптима Банк». */
  bank: string
  /** Идентификатор терминала: «PR900114». */
  terminalId: string
  methods: PaymentMethodId[]
  /** Через кого проходит оплата по QR: «Элсом», «О!Деньги», «MBank». */
  qrProvider: string
  /** Показывать покупателю второй экран с составом чека. */
  secondScreen: boolean
  /**
   * Настроенные способы безналичной оплаты. Секретов здесь нет: мерчант-ключи
   * живут только на локальном сервере, а это хранится в том числе в
   * localStorage, чтобы касса подняла экран оплаты без сети.
   */
  providers: PaymentProviderConfig[]
}

export type BusinessData = {
  /** Сфера. Определяет атрибуты товара, единицы и шаблон карточки — см. industries.ts. */
  industry: IndustryId
  /** Код валюты: KGS, KZT, … */
  currency: string
  /** Как валюта печатается в чеке: «сом». */
  currencyLabel: string
  /** Знаков после запятой в ценах и суммах: 0, 1 или 2. */
  decimals: number
  /**
   * Какая цифра главная на дашборде. Представление, а не способ учёта:
   * переключается в любой момент, данные не пересчитываются.
   */
  analyticsMode: AnalyticsMode
  timezone: string
  country: string
}

/**
 * Форма знака.
 *
 * Не косметика: круглая обрезка запекается в сам PNG вместе с прозрачностью за
 * границей круга, поэтому форма — свойство готовой картинки, а не стиль показа.
 * Хранится ещё и отдельным полем, потому что чек про альфа-канал ничего не
 * знает: перед переводом в один бит прозрачное надо залить белым, и для этого
 * печати нужно знать, что знак круглый.
 */
export type LogoShape = 'square' | 'circle'

export const LOGO_SHAPES: { id: LogoShape; label: string }[] = [
  { id: 'square', label: 'Квадрат' },
  { id: 'circle', label: 'Круг' },
]

/**
 * Компоновка шапки приложения — как знак и надпись стоят друг относительно
 * друга.
 *
 * Отдельная настройка от шапки чека, и это принципиально: экран и лента — два
 * разных носителя. Магазин вправе держать в шапке приложения только знак, а на
 * чеке печатать название, и наоборот.
 *
 * Надпись — картинка, а не текст. Раньше рядом со знаком печаталось название
 * из реквизитов обычным текстом, и в полосе сходились две разные типографики:
 * фирменный знак и подобранный настройками шрифт. Теперь надпись приходит
 * файлом от того же дизайнера, что рисовал знак.
 *
 * `combined` — случай, который встречается чаще всего: дизайнер присылает один
 * файл, где знак и надпись уже сведены (обычно знак, под ним текст). Резать
 * его на две части незачем, поэтому второго слота у этой компоновки нет.
 */
export type HeaderLayout = 'combined' | 'mark_left' | 'mark_top' | 'mark' | 'wordmark'

export const HEADER_LAYOUTS: { id: HeaderLayout; label: string; hint: string }[] = [
  {
    id: 'combined',
    label: 'Единая картинка',
    hint: 'Один файл, где знак и надпись уже вместе',
  },
  {
    id: 'mark_left',
    label: 'Знак слева, надпись справа',
    hint: 'Два файла в строку',
  },
  {
    id: 'mark_top',
    label: 'Знак сверху, надпись снизу',
    hint: 'Два файла столбиком',
  },
  { id: 'mark', label: 'Только знак', hint: 'Надпись не нужна' },
  { id: 'wordmark', label: 'Только надпись', hint: 'Знака нет — только название' },
]

/**
 * Из чего складывается шапка при выбранной компоновке.
 *
 * Одна функция на всё приложение: по ней и шапка решает, что рисовать, и
 * редактор — какие слоты загрузки показывать. Пока это условие писалось по
 * месту, шапка и настройка расходились: редактор просил файл, который шапка
 * уже не показывала.
 */
export function headerLayoutParts(layout: HeaderLayout): {
  /** Нужен знак. */
  mark: boolean
  /** Нужна надпись. */
  wordmark: boolean
  /** Единая картинка вместо знака и надписи. */
  combined: boolean
  /** Знак и надпись стоят столбиком, а не в строку. */
  stacked: boolean
} {
  return {
    mark: layout === 'mark' || layout === 'mark_left' || layout === 'mark_top',
    wordmark: layout === 'wordmark' || layout === 'mark_left' || layout === 'mark_top',
    combined: layout === 'combined',
    stacked: layout === 'mark_top',
  }
}

/**
 * Начертания названия магазина.
 *
 * Один список на всё приложение: им оформлено название и в шапке приложения, и
 * на экране покупателя. Произвольные шрифты не даём намеренно — подобрать
 * читаемый на глаз владелец магазина не обязан, а на чеке название печатает сам
 * принтер своим шрифтом.
 */
export type LogoTextTemplate = 'strict' | 'round' | 'classic' | 'narrow'

export const LOGO_TEXT_TEMPLATES: {
  id: LogoTextTemplate
  label: string
  /** CSS-стек шрифта. Первый — желаемый, дальше то, что точно есть в системе. */
  family: string
  weight: number
}[] = [
  { id: 'strict', label: 'Строгий', family: 'Inter, "Segoe UI", system-ui, sans-serif', weight: 600 },
  { id: 'round', label: 'Округлый', family: 'Nunito, "Segoe UI", Verdana, sans-serif', weight: 700 },
  { id: 'classic', label: 'Классический', family: 'Georgia, "Times New Roman", serif', weight: 600 },
  {
    id: 'narrow',
    label: 'Узкий',
    family: '"Arial Narrow", "Segoe UI Semibold", "Liberation Sans Narrow", sans-serif',
    weight: 700,
  },
]

export type LogoTextSize = 's' | 'm' | 'l'

/** Что печатается в шапке чека. */
export type ReceiptHeaderMode = 'logo' | 'logo_name' | 'name'

/**
 * Ширина рулона. От неё зависит и ширина предпросмотра, и размер логотипа на
 * ленте: 80 мм по умолчанию, потому что именно такой рулон стоит в кассовых
 * принтерах чаще.
 */
export type RollWidth = '58' | '80'

export const ROLL_WIDTHS: { id: RollWidth; label: string; columns: ReceiptColumnCount }[] = [
  { id: '58', label: '58 мм · 32 символа', columns: 32 },
  { id: '80', label: '80 мм · 48 символов', columns: 48 },
]

/** Сколько символов помещается в строку на выбранной ленте. */
export type ReceiptColumnCount = 32 | 48

export function columnsForRoll(width: RollWidth): ReceiptColumnCount {
  return width === '80' ? 48 : 32
}

/**
 * Готовые размеры логотипа. Собираются один раз в редакторе, чтобы каждый
 * экран не пережимал картинку заново, а чек не получал полутонов.
 */
export type LogoVariants = {
  /** 512×512 — экраны и экран покупателя. */
  s512: string
  /** 128×128 — шапка приложения. */
  s128: string
  /** 64×64 — иконка окна Electron. */
  s64: string
  /**
   * Ширина 384, один бит на точку. Исторический чековый вариант: остаётся
   * запасным источником для установок, где чековый логотип ещё не обрезали
   * отдельно, — см. `receiptLogoVariants`.
   */
  receipt: string
}

/**
 * Чековый логотип в двух размерах — по одному на ширину рулона.
 *
 * Ширина логотипа меньше ширины печати намеренно: на ленте остаются поля, а
 * знак во всю ширину печатается впритык к краю и на части принтеров срезается.
 */
export type ReceiptLogoVariants = {
  /** Для рулона 80 мм. */
  w384: string
  /** Для рулона 58 мм. */
  w288: string
}

export function emptyReceiptLogoVariants(): ReceiptLogoVariants {
  return { w384: '', w288: '' }
}

/**
 * Оформление магазина.
 *
 * Логотип в интерфейсе и логотип в чеке — две независимые настройки, а не одна
 * на всё. Магазин может печатать знак на чеках и не показывать его в шапке, и
 * наоборот; пропорции у экрана и у ленты разные, поэтому и обрезка у каждого
 * своя. Поля интерфейсного логотипа идут первыми, чековые собраны ниже в свой
 * блок с префиксом `receipt`.
 *
 * Название в картинку не запекается. Раньше знак и надпись сводились на canvas
 * в один файл, а рядом в шапке приложение печатало название ещё раз — выходило
 * два названия подряд. Теперь загружается только знак, а название рисует само
 * приложение текстом, оформлением по шаблону (`logoTextTemplate`).
 */
export type BrandingData = {
  mode: LogoMode
  /**
   * Режим бренда интерфейса: заводской Kassir ERP или свой.
   *
   * Переключатель, а не команда «забудь настройки». Вернувшись к заводскому
   * бренду, магазин не теряет ни загруженный знак, ни название, ни цвет — они
   * остаются лежать в своих полях, и переключиться обратно можно одним
   * нажатием. Что именно показать при каждом режиме, решает `resolveBrand`
   * (brand/brand.ts) — единственное место, где это разветвление есть.
   */
  useFactoryBrand: boolean
  /**
   * Название системы в интерфейсе: шапка, экраны входа и активации.
   *
   * НЕ название магазина. Это разные вещи, и путать их нельзя: магазин
   * «Глобус» — это реквизит с первого шага, он печатается в чеке; а в шапке
   * стоит название программы, под которой магазин работает. Пока отдельного
   * поля не было, шапка брала название магазина из реквизитов, и касса
   * называлась именем торговой точки.
   *
   * Пусто — «Kassir ERP».
   */
  brandName: string
  /**
   * Показывать логотип в шапке приложения и на экране покупателя. Отдельно от
   * `receiptLogo`: это разные носители и разные решения владельца.
   */
  uiLogo: boolean
  /** Как знак и надпись стоят в шапке приложения. */
  headerLayout: HeaderLayout
  /**
   * PNG data URL знака для экранов. Это тот же знак, что и `logoMark`, только
   * приведённый к экранному размеру; надписи в нём нет и быть не должно.
   */
  logo: string
  /** Исходный знак после обрезки. Из него собираются все размеры и чековый вариант. */
  logoMark: string
  /**
   * Надпись с названием магазина картинкой. Пусто — название рисуется текстом
   * по шаблону (`logoTextTemplate`): пока своего файла нет, шапка выглядит так
   * же, как выглядела до появления этого слота.
   */
  logoWordmark: string
  /**
   * Единая картинка: знак и надпись в одном файле. Отдельная сущность, а не
   * размер знака, — это другой файл, и обрезан он под свою компоновку.
   * Показывается только компоновкой `combined`.
   */
  logoCombined: string
  /** Готовые размеры того же логотипа. Пустые строки — ещё не собраны. */
  logoVariants: LogoVariants
  /** Форма знака в интерфейсе: квадрат или круг с прозрачностью за границей. */
  logoShape: LogoShape
  /**
   * Объёмный вид бренда в шапке: фаска по контуру и мягкая тень под знаком.
   *
   * Оформление, а не свойство картинки. Рисуется по альфа-каналу средствами
   * интерфейса, поэтому работает на любой форме знака — круглой, квадратной и
   * произвольной — и снимается переключателем, ничего не пересобирая. В файл
   * не запекается намеренно: запечённую тень уже не убрать, а на светлом фоне
   * экрана покупателя она смотрелась бы грязью.
   */
  logoEmboss: boolean
  /** Начертание названия магазина на экранах. */
  logoTextTemplate: LogoTextTemplate
  /** Кегль названия в шапке: S/M/L. */
  logoTextSize: LogoTextSize
  /** Цвет названия. Пусто — берётся из темы. */
  logoTextColor: string
  primaryColor: string
  theme: ThemeMode

  /* ── Логотип в чеке: отдельная настройка со своей обрезкой ─────────────── */

  /**
   * Печатать ли логотип на чеке. Работает и под заводским брендом: магазин
   * вправе не ставить чужой знак на свои чеки, поэтому по умолчанию выключено.
   */
  receiptLogo: boolean
  /** Что стоит в шапке чека: знак, знак с названием или одно название. */
  receiptHeader: ReceiptHeaderMode
  /**
   * Отдельный файл, загруженный специально для чека. Пусто — берётся файл из
   * интерфейса.
   *
   * Нужен потому, что на чеке магазину часто нужен вовсе не тот знак: в шапке
   * приложения стоит цветной логотип с тонкими линиями, а на ленте в один бит
   * он рассыпается, и туда кладут упрощённый чёрно-белый вариант. Одной
   * переобрезкой это не решается — это другая картинка.
   */
  receiptLogoFile: string
  /**
   * Знак, обрезанный под чек. Пусто — берётся интерфейсный `logoMark`: пока
   * своего файла нет и обрезку не переделывали, чек печатает то же, что видно
   * в шапке.
   */
  receiptLogoMark: string
  /** Ч/б варианты чекового знака под обе ширины ленты. */
  receiptLogoVariants: ReceiptLogoVariants
  /**
   * Форма чекового знака. Круглая маска накладывается до перевода в один бит,
   * а прозрачное печать считает белым — иначе вокруг круга остался бы чёрный
   * квадрат во всю ширину знака.
   */
  receiptLogoShape: LogoShape
  /**
   * Шаблон приведения логотипа к одному биту на точку.
   *
   * Одного способа на все логотипы нет: светлый знак пропадает при обычном
   * пороге, а сплошная цветная заливка превращается в чёрный прямоугольник.
   * Разбор шаблонов — в logoCanvas.ts (THERMAL_STYLES).
   */
  receiptLogoStyle: ThermalStyle
  /** Порог ч/б, 0–255. Ручная подстройка поверх шаблона. */
  receiptLogoThreshold: number
  /** Ширина рулона. Определяет ширину предпросмотра и размер знака на ленте. */
  receiptRollWidth: RollWidth
  /** Последняя строка чека. Пусто — печатается «Спасибо за покупку!». */
  receiptFooter: string
  /**
   * Касса стоит на сенсорном моноблоке без физической клавиатуры.
   *
   * По нему окна ввода секретов решают, показывать ли собственную экранную
   * клавиатуру: на моноблоке без неё ключ не набрать вовсе, а на установке с
   * клавиатурой панель на пол-экрана только мешает.
   *
   * Живёт в оформлении не по смыслу, а по правам: группа `branding` закреплена
   * за специалистом и на сервере (field_access.py), а какое привезли железо —
   * ровно его дело, а не владельца магазина.
   */
  touchScreen: boolean
  /**
   * К кассе подключена камера.
   *
   * Отдельно от сенсорного экрана: одно про то, чем вводят, другое про то, есть
   * ли чем снимать. Разделы, которым нужна съёмка, без камеры не показываются —
   * предлагать снять лицо на устройстве без камеры хуже, чем не предлагать.
   */
  hasCamera: boolean
}

/**
 * Знак, который реально уйдёт на ленту.
 *
 * Порядок отката важен: сначала вариант под текущий рулон, затем прежний
 * общий чековый вариант, и только потом экранная композиция. Иначе установки,
 * настроенные до разделения логотипов, остались бы без картинки в чеке.
 *
 * Когда у чека свой файл, экранная композиция из отката исключается: показать
 * на ленте интерфейсный логотип вместо специально загруженного — то же самое,
 * что проигнорировать загрузку.
 */
export function receiptLogoSource(branding: BrandingData): string {
  const byRoll = branding.receiptRollWidth === '58'
    ? branding.receiptLogoVariants.w288
    : branding.receiptLogoVariants.w384
  if (byRoll) return byRoll
  if (branding.receiptLogoFile) return ''
  return branding.logoVariants.receipt || branding.logo
}

/** Есть ли у чека собственная картинка, не связанная с интерфейсной. */
export function usesOwnReceiptLogo(branding: BrandingData): boolean {
  return Boolean(branding.receiptLogoFile)
}

/**
 * Исходник для обрезки под чек.
 *
 * Именно исходник, а не уже обрезанный знак: обрезать повторно результат
 * прошлой обрезки значит терять качество на каждом заходе и не иметь
 * возможности вернуть срезанное.
 */
export function receiptCropSource(branding: BrandingData): string {
  return branding.receiptLogoFile || branding.logoMark || branding.logo
}

export function emptyLogoVariants(): LogoVariants {
  return { s512: '', s128: '', s64: '', receipt: '' }
}

export type OwnerData = {
  firstName: string
  lastName: string
  /** Email владельца — он же логин и способ восстановить доступ. */
  email: string
  /** Взять email компании с шага 1. Поле при этом блокируется, но в базе
   *  остаётся своим: у владельца и у компании адреса могут разойтись позже. */
  emailSameAsCompany: boolean
  /** КТ — код кассира для печати в чеке. Необязателен. */
  cashierCode: string
}

export type ContactsData = {
  phone: string
  /** Юридический email компании. Отдельное поле от owner.email. */
  email: string
}

export type OnboardingData = {
  /** Дискриминант: от него зависит и набор полей, и состав чека. */
  fiscalMode: FiscalMode
  /** Тариф установки. Уходит на сервер как `edition` и решает, что включено. */
  edition: Edition
  company: CompanyData
  outlet: OutletData
  tax: TaxData
  kkm: KkmData
  acquiring: AcquiringData
  business: BusinessData
  branding: BrandingData
  owner: OwnerData
  contacts: ContactsData
}

/**
 * Секреты владельца. Намеренно вне OnboardingData: онбординг кэшируется в
 * localStorage и уходит в настройки, а паролю и PIN там не место. Живут только
 * в состоянии мастера до отправки.
 */
/**
 * Секреты, которые задаются при установке.
 *
 * PIN кассира сюда не входит намеренно: на шаге регистрации кассиров ещё нет,
 * магазин только заводится. PIN задаётся при добавлении сотрудника в разделе
 * «Сотрудники», и у каждого он свой — иначе по журналу не сказать, кто именно
 * отменил чек.
 */
export type OwnerSecrets = {
  /**
   * Вход в систему. Обычный пароль обычной учётной записи: под ней работает вся
   * смена, и кассир его нередко знает. Кабинет владельца он не открывает.
   */
  password: string
  /**
   * Кабинет владельца: финансы, аналитика, сотрудники.
   *
   * Отдельный секрет, и в этом весь смысл поля. Пока дверь владельца
   * открывалась паролем входа, разделения ролей не существовало: владелец
   * диктует пароль входа по телефону, чтобы кассир пробил возврат, — и вместе с
   * возвратом отдаёт свои деньги. Минимум 8 символов.
   */
  ownerPassword: string
}

export const PASSWORD_MIN_LENGTH = 8
/** PIN кассира. Задаётся в разделе «Сотрудники», а не при установке. */
export const PIN_MIN_LENGTH = 4
export const PIN_MAX_LENGTH = 6
/** Пароль владельца — та же нижняя граница, что у пароля входа. */
export const OWNER_PASSWORD_MIN_LENGTH = 8

/*
 * Проверки сервисного ключа здесь больше нет.
 *
 * Ключ владельца «для специалиста» мастер больше не собирает: сервисный режим
 * открывает лицензионный ключ установки вида KASSIR-XXXX-XXXX-XXXX, с которым
 * специалист и приезжает. Отдельный секрет терялся первым — заводил его
 * владелец при установке, а спрашивали его через полгода у приехавшего
 * установщика, и не находилось ни у кого.
 *
 * Сервер продолжает принимать уже заданный сервисный ключ (см. store_settings.
 * service_key_hash): установки, где владелец его завёл, не должны потерять
 * рабочий секрет из-за обновления.
 */

/**
 * Группы верхнего уровня — используются реестром полей и сводкой.
 * `fiscalMode` в них не входит: это не группа, а скаляр-дискриминант, и
 * реестр адресует его отдельной группой `'root'`.
 */
export type OnboardingGroup = Exclude<keyof OnboardingData, 'fiscalMode'>

/** Версия формата фискальных данных, поддерживаемая этой сборкой. */
export const FFD_VERSION = '1.0'
export const SW_VERSION = 'NewCas-F 1.0'

export const DEFAULT_ONBOARDING: OnboardingData = {
  // Режим по умолчанию — простой: он ничего не требует и ничего не обещает
  // налоговой. Фискальный выбирается осознанно на первом экране мастера.
  fiscalMode: 'simple',
  // Тариф по умолчанию — «Старт»: он не обещает того, за что не платили.
  edition: 'start',
  company: { legalName: '', shortName: '', inn: '' },
  outlet: { name: '', postalCode: '', city: '', street: '', building: '', lat: '', lon: '' },
  tax: { regime: 'simplified_single', vatRate: 0, salesTaxRate: 0, singleTaxRate: 0.5 },
  kkm: {
    serialNumber: '',
    registrationNumber: '',
    fiscalModule: '',
    ffdVersion: FFD_VERSION,
    swVersion: SW_VERSION,
    posNumber: '1',
  },
  acquiring: {
    bank: '',
    terminalId: '',
    methods: ['cash', 'card'],
    qrProvider: '',
    secondScreen: false,
    // Статический QR включён сразу: он работает без договора с банком, и
    // магазин может принимать безнал в первый же день.
    providers: defaultProviderConfigs(),
  },
  business: {
    industry: 'other',
    currency: 'KGS',
    currencyLabel: 'сом',
    decimals: 2,
    // «Только продажи» по умолчанию: оборот понятен без объяснений, а прибыль
    // требует, чтобы расходы уже кто-то заносил.
    analyticsMode: 'revenue',
    timezone: 'Asia/Bishkek',
    country: 'Кыргызстан',
  },
  branding: {
    mode: 'monogram',
    // Заводской бренд по умолчанию: мастер не должен требовать логотип от
    // точки, которой он не нужен. Пока его не сменили, вся система выглядит
    // как продукт Kassir ERP — независимо от того, как называется магазин.
    useFactoryBrand: true,
    brandName: '',
    uiLogo: true,
    headerLayout: 'mark_left',
    logo: '',
    logoMark: '',
    logoWordmark: '',
    logoCombined: '',
    logoVariants: emptyLogoVariants(),
    logoShape: 'square',
    // Объём включён по умолчанию: эффект мягкий, работает на любом знаке, а
    // выключить его дешевле, чем не заметить, что он вообще есть.
    logoEmboss: true,
    logoTextTemplate: 'strict',
    logoTextSize: 'm',
    logoTextColor: '',
    // Стандартный акцент системы приходит из applyTheme.ts, а не пишется
    // здесь ещё раз: второй записанный дефолт однажды разойдётся с первым.
    primaryColor: DEFAULT_PRIMARY,
    theme: 'light',
    // Печать логотипа выключена по умолчанию: под заводским брендом это был бы
    // чужой знак на чеках магазина, а под своим — лишний расход ленты, пока
    // владелец сам не решит иначе.
    receiptLogo: false,
    receiptHeader: 'logo_name',
    receiptLogoFile: '',
    receiptLogoMark: '',
    receiptLogoVariants: emptyReceiptLogoVariants(),
    receiptLogoShape: 'square',
    receiptLogoStyle: 'standard',
    receiptLogoThreshold: 176,
    receiptRollWidth: '80',
    receiptFooter: '',
    touchScreen: false,
    hasCamera: false,
  },
  owner: { firstName: '', lastName: '', email: '', emailSameAsCompany: true, cashierCode: '' },
  contacts: { phone: '', email: '' },
}

/** Работает ли установка с фискальной кассой. Одна проверка на всё приложение. */
export function isFiscal(data: OnboardingData): boolean {
  return data.fiscalMode === 'fiscal'
}

/**
 * Смена системы налогообложения: подставляет типовые ставки режима.
 *
 * Выбор СНО — это не подпись, а смена налогового контекста, поэтому ставки
 * пересчитываются целиком, а не «если пользователь их не трогал». Дальше он
 * правит их руками сколько угодно: поля остаются обычными.
 */
export function applyTaxRegime(data: OnboardingData, regime: TaxRegimeId): OnboardingData {
  return { ...data, tax: { regime, ...TAX_PRESETS[regime] } }
}

/**
 * Смена режима работы. Единственное место, где описаны его последствия.
 *
 * Простому режиму не нужны ни налоги, ни юридический email компании: чек
 * нефискальный, ставки в нём не печатаются, а связка «email владельца = email
 * компании» заперла бы пустое поле логина. Фискальные реквизиты при этом не
 * стираются — обратное переключение не должно требовать повторного ввода
 * номеров ККМ.
 */
export function applyFiscalMode(data: OnboardingData, fiscalMode: FiscalMode): OnboardingData {
  if (fiscalMode === 'fiscal') return { ...data, fiscalMode }
  return {
    ...data,
    fiscalMode,
    tax: { regime: 'none', ...TAX_PRESETS.none },
    owner: { ...data.owner, emailSameAsCompany: false },
  }
}

export const DEFAULT_RECEIPT_FOOTER = 'Спасибо за покупку!'

/** Заголовок чека: фискальный чек его не печатает, товарный — обязан. */
export const SIMPLE_RECEIPT_TITLE = 'ТОВАРНЫЙ ЧЕК'

/** Глубокая копия дефолтов — состояние мастера всегда начинается с неё. */
export function createOnboardingDraft(): OnboardingData {
  return structuredClone(DEFAULT_ONBOARDING)
}

/**
 * Название магазина для экранов и шапки чека.
 *
 * Одно место на всё приложение и один источник — данные организации с первого
 * шага. Отдельного поля «название для шапки» нет намеренно: пока оно было,
 * магазин заводил его второй раз, оно расходилось с реквизитами, и в чеке с
 * экраном стояли разные названия.
 */
export function storeDisplayName(data: OnboardingData): string {
  return (
    data.company.shortName.trim() ||
    data.outlet.name.trim() ||
    data.company.legalName.trim()
  )
}

/**
 * Кегль названия в шапке приложения, в пикселях.
 *
 * Название рисуется текстом, а не картинкой, поэтому размер задаётся здесь, а
 * не долей стороны холста: на 4K-моноблоке доля от картинки давала нечитаемую
 * надпись, а тексту достаточно кегля.
 */
export const NAME_SIZES: Record<LogoTextSize, number> = { s: 14, m: 17, l: 21 }

/** ФИО владельца одной строкой — так кассир печатается в чеке. */
export function ownerFullName(owner: OwnerData): string {
  return `${owner.firstName.trim()} ${owner.lastName.trim()}`.trim()
}

/**
 * Действует ли сейчас связка «email владельца совпадает с email компании».
 *
 * Двух условий, а не одного: галка стоит И режим фискальный. В простом режиме
 * юридический email компании вообще не спрашивается, поэтому связывать не с
 * чем, и галка там не показывается.
 *
 * Проверка вынесена сюда именно потому, что забыть вторую половину условия
 * легко: пока её не хватало в одном месте, поле email владельца в простом
 * режиме стиралось на каждой набранной букве — эффект зеркалил в него пустой
 * адрес компании, считая связку включённой.
 */
export function isOwnerEmailLinked(data: OnboardingData): boolean {
  return data.fiscalMode === 'fiscal' && data.owner.emailSameAsCompany
}

/** Email, который реально используется как логин, с учётом связки с компанией. */
export function effectiveOwnerEmail(data: OnboardingData): string {
  return (isOwnerEmailLinked(data) ? data.contacts.email : data.owner.email).trim()
}

/* -------------------------------------------------------------------------- */
/* Производные значения — считаются из данных, а не хранятся отдельно          */
/* -------------------------------------------------------------------------- */

/** Адрес расчётов одной строкой: «720007, г. Бишкек, ул. Льва Толстого, 19/5». */
export function formatOutletAddress(outlet: OutletData): string {
  const cityPart = outlet.city.trim() ? `г. ${outlet.city.trim()}` : ''
  const streetPart = [outlet.street.trim(), outlet.building.trim()].filter(Boolean).join(', ')
  return [outlet.postalCode.trim(), cityPart, streetPart].filter(Boolean).join(', ')
}

/** Координаты для чека: «42.86622, 74.56862». Пусто, если задана не вся пара. */
export function formatCoordinates(outlet: OutletData): string {
  const lat = outlet.lat.trim()
  const lon = outlet.lon.trim()
  return lat && lon ? `${lat}, ${lon}` : ''
}

export function taxRegimeLabel(regime: TaxRegimeId): string {
  return TAX_REGIMES.find((item) => item.id === regime)?.receiptLabel ?? ''
}

export function paymentMethodLabel(id: PaymentMethodId): string {
  return PAYMENT_METHODS.find((item) => item.id === id)?.label ?? id
}

/** Способы оплаты через запятую — строка «QR, NFC Pay, наличные» в чеке. */
export function formatPaymentMethods(methods: PaymentMethodId[]): string {
  return methods.map(paymentMethodLabel).join(', ')
}
