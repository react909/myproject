/**
 * Декларативный реестр полей онбординга — дискриминированная схема по
 * `fiscalMode`.
 *
 * Это тот самый переиспользуемый конфиг: форма нигде не пишется руками — ни в
 * шаге мастера, ни в настройках. Оба экрана берут отсюда набор полей, их
 * подписи, маски ввода и правила проверки, поэтому поле физически не может
 * разойтись между двумя экранами или задвоиться.
 *
 * Режим работы задаёт не «ещё один флаг», а две разные схемы: у поля есть
 * `modes`, и всё остальное приложение спрашивает реестр, а не разветвляется
 * само. Скрытое поле не рисуется и не проверяется — за это отвечает
 * единственная функция `fieldApplies`, через которую проходят все выборки.
 * Когда одно и то же значение в двух режимах называется по-разному (в простом
 * режиме «Название магазина», в фискальном «Краткое наименование»), заводится
 * два определения с непересекающимися `modes` и одинаковыми group/key.
 *
 * `receiptLine` фиксирует, какую строку фискального чека питает поле. Если у
 * поля нет ни receiptLine, ни назначения в настройках кассы — его здесь быть
 * не должно.
 */

import { accentProblem } from '../auth/applyTheme'
import {
  COUNTRIES,
  CURRENCIES,
  TIMEZONES,
} from './dictionaries'
import { phoneProblem, phoneValue } from './phone'
import type { Edition, FiscalMode, OnboardingData, OnboardingGroup } from './types'
import { TAX_REGIMES, applyTaxRegime, taxRegimeHint } from './types'

export type FieldKind =
  | 'text'
  /** Только цифры, с ограничением длины. */
  | 'digits'
  /** Телефон с маской +996 XXX XXX XXX — рисуется PhoneInput. */
  | 'phone'
  | 'tel'
  | 'email'
  | 'select'
  /** Число с плавающей точкой (ставки, координаты). */
  | 'decimal'
  /** Да/нет — рисуется переключателем, хранится булевым. */
  | 'toggle'
  /** Значение задаётся прошивкой — показываем, но не даём править. */
  | 'readonly'
  /** Поле со своим контролом (карточки, пароли, логотип): рендерится вручную. */
  | 'custom'

export type FieldSpan = 2 | 3 | 4 | 5 | 6 | 8 | 12

export type FieldOption = { value: string; label: string }

/**
 * Группа значения. `'root'` — скаляр верхнего уровня OnboardingData; сейчас
 * это только сам дискриминант `fiscalMode`.
 */
export type FieldGroup = OnboardingGroup | 'root'

export type FieldDef = {
  /** Стабильный идентификатор — по нему сводка ставит фокус. */
  id: string
  group: FieldGroup
  key: string
  label: string
  kind: FieldKind
  span: FieldSpan
  /** Шаг мастера, на котором поле собирается. */
  step: number
  /** Заголовок секции внутри шага — поля с одинаковым section идут вместе. */
  section: string
  /**
   * В каких режимах поле существует. Не указано — существует в обоих.
   * Поля вне режима не рисуются и не проверяются.
   */
  modes?: FiscalMode[]
  /**
   * Дополнительное условие существования поля — для зависимостей внутри
   * режима (единый налог есть только на упрощённой системе). Как и `modes`,
   * скрытое условием поле не рисуется и не проверяется.
   */
  when?: (data: OnboardingData) => boolean
  hint?: string
  /** Подсказка, зависящая от других ответов. Имеет приоритет над `hint`. */
  hintFor?: (data: OnboardingData) => string
  /**
   * Что ещё меняется вместе с этим полем. Живёт в реестре, а не в экранах:
   * «выбор СНО подставляет ставки» — свойство схемы, и работать оно обязано
   * одинаково и в мастере, и в настройках.
   */
  afterWrite?: (data: OnboardingData) => OnboardingData
  placeholder?: string
  required?: boolean
  maxLength?: number
  options?: FieldOption[]
  /** Строка фискального чека, которую питает поле. */
  receiptLine?: string
  /**
   * Значение живёт вне OnboardingData (пароль, PIN) — реестр знает о поле
   * ради сводки и перехода «Изменить», но проверяет его вызывающий экран.
   */
  virtual?: boolean
  /**
   * Блок без собственного значения (превью чека, кнопка чтения с кассы).
   * Занимает место в раскладке, но не участвует ни в проверках, ни в сводке.
   */
  presentational?: boolean
  /** Приводит ввод к каноничному виду прямо во время набора. */
  normalize?: (raw: string) => string
  /** Возвращает текст ошибки или пустую строку. */
  validate?: (value: string, data: OnboardingData) => string
}

/* -------------------------------------------------------------------------- */
/* Маски и проверки                                                           */
/* -------------------------------------------------------------------------- */

const digitsOnly = (max: number) => (raw: string) => raw.replace(/\D/g, '').slice(0, max)

/* Маска телефона живёт в phone.ts: она нужна и полю ввода, и печати чека, и
   сводке — держать её здесь значило бы разойтись с ними при первой правке. */

/** Координата: цифры, одна точка, необязательный минус. */
export function normalizeCoordinate(raw: string): string {
  const cleaned = raw.replace(/,/g, '.').replace(/[^\d.-]/g, '')
  const negative = cleaned.startsWith('-')
  const body = cleaned.replace(/-/g, '')
  const [whole, ...rest] = body.split('.')
  const fraction = rest.join('')
  const joined = rest.length > 0 ? `${whole}.${fraction.slice(0, 6)}` : whole
  return (negative ? '-' : '') + joined
}

/** Проверка одной координаты. Пустая строка допустима — её ловит `required`. */
function coordinateError(value: string, limit: number, name: string): string {
  if (!value.trim()) return ''
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return `${name}: нужно число, например 42.86622.`
  if (Math.abs(parsed) > limit) return `${name} должна быть в пределах ±${limit}.`
  return ''
}

function rateValidator(label: string) {
  return (value: string): string => {
    if (!value.trim()) return ''
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return `${label}: нужно число.`
    if (parsed < 0 || parsed > 100) return `${label} указывается в процентах, от 0 до 100.`
    return ''
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Сферы, где продают время и работу, а не товар: у них своя ставка НСП. */
const SERVICE_INDUSTRIES = new Set(['services', 'cafe'])

/**
 * НСП зависит не от режима, а от того, платит ли магазин НДС и чем торгует.
 * Подсказка считает это за пользователя вместо ссылки на кодекс.
 */
function salesTaxHint(data: OnboardingData): string {
  if (data.tax.vatRate > 0) {
    return 'Вы плательщик НДС: по безналу 0%, по наличным 1–2%'
  }
  return SERVICE_INDUSTRIES.has(data.business.industry)
    ? 'Не плательщик НДС, услуги — обычно 3%'
    : 'Не плательщик НДС, торговля — обычно 2%'
}

/* -------------------------------------------------------------------------- */
/* Шаги                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Активация лицензии сюда не входит: она проходит до мастера, отдельным
 * экраном, и переигрывать её внутри формы нечем.
 */
export const STEPS = [
  { title: 'Магазин и касса', caption: 'Режим работы, название, адрес, реквизиты кассы' },
  { title: 'Бизнес и налоги', caption: 'Сфера, валюта, налоги, аналитика' },
  { title: 'Оплата', caption: 'Способы расчёта, эквайринг, QR' },
  { title: 'Оформление', caption: 'Логотип, цвета, вид чека' },
  { title: 'Учётная запись', caption: 'Владелец и доступ к кассе' },
  { title: 'Проверка и запуск', caption: 'Сводка и превью чека' },
] as const

export const LAST_STEP = STEPS.length - 1

/** Сколько шагов считается «шагами» в счётчике: проверка в их число не входит. */
export const FORM_STEPS = LAST_STEP

/* -------------------------------------------------------------------------- */
/* Секции                                                                     */
/* -------------------------------------------------------------------------- */

export type SectionMeta = {
  caption?: string
  /** Подпись, зависящая от режима. Имеет приоритет над `caption`. */
  captionFor?: Partial<Record<FiscalMode, string>>
  /**
   * В каких режимах секция свёрнута по умолчанию. `true` — во всех.
   * Свёрнутая секция всё равно раскроется сама, если в ней найдётся ошибка.
   */
  collapsedIn?: FiscalMode[] | true
}

/**
 * Подписи секций и то, какие из них свёрнуты. Лежат рядом с реестром, потому
 * что это часть описания формы, а не оформление конкретного экрана.
 */
export const SECTION_META: Record<string, SectionMeta> = {
  'Режим работы': {
    caption: 'Определяет, какие данные понадобятся дальше и что будет напечатано в чеке',
  },
  Тариф: { caption: 'Что включено в программе. К режиму работы и к чеку отношения не имеет' },
  Магазин: { caption: 'Печатается в шапке каждого чека' },
  Координаты: {
    caption: 'Место расчётов на карте — обязательная часть фискального чека',
  },
  Касса: {
    caption: 'Номера с шильдика кассы и из регистрации в налоговой',
    collapsedIn: true,
  },
  Оборудование: {
    caption: 'На чём стоит касса. Определяет, чем на ней вводят ключи и пароли',
  },
  Сфера: { caption: 'Определяет атрибуты товара, единицы измерения и вид карточки товара' },
  Локализация: { caption: 'Валюта, точность сумм, часовой пояс' },
  Налогообложение: {
    captionFor: {
      fiscal: 'Режим и ставки печатаются в чеке. При выборе СНО ставки подставляются сами',
      simple: 'Чек нефискальный — ставки нулевые и в него не печатаются',
    },
    // В простом режиме налоги не нужны, но и прятать их совсем нечестно:
    // человек должен видеть, что они нулевые, а не гадать.
    collapsedIn: ['simple'],
  },
  'Как считать аналитику': {
    caption:
      'Какая цифра будет главной на дашборде. Учёт от этого не меняется — продажи и расходы пишутся всегда, и переключить можно в любой момент',
  },
  'Способы оплаты': { caption: 'Появятся кнопками на экране оплаты' },
  Эквайринг: { caption: 'Нужен, только если принимаете карты' },
  'Оплата по QR': { caption: 'Через кого проходит платёж и что видит покупатель' },
  Бренд: { caption: 'Под каким именем работает касса — заводским или вашим' },
  // Два блока логотипа настраиваются раздельно: у экрана и у ленты разные
  // пропорции, и магазин вправе печатать знак, не показывая его в шапке.
  'Логотип в интерфейсе': { caption: 'Шапка приложения и экран покупателя' },
  'Логотип в чеке': { caption: 'Что печатается на ленте: своя обрезка, своё превью, свой тумблер' },
  'Тема интерфейса': {},
  Цвета: { caption: 'Акцент кнопок. Цвет текста на них подбирается по контрасту сам' },
  Владелец: { caption: 'Имя и фамилия печатаются в чеке как кассир' },
  'Вход в систему': {
    caption:
      'Email вместо логина и два разных пароля: один для входа в систему, второй — только для кабинета владельца с деньгами. Кассиров и их PIN заводят позже, в разделе «Сотрудники»',
  },
}

/** Разрешённая под режим подпись и признак «свёрнута по умолчанию». */
export function sectionMeta(
  section: string,
  mode: FiscalMode,
): { caption?: string; collapsible: boolean } {
  const meta = SECTION_META[section] ?? {}
  const collapsedIn = meta.collapsedIn
  return {
    caption: meta.captionFor?.[mode] ?? meta.caption,
    collapsible: collapsedIn === true || (Array.isArray(collapsedIn) && collapsedIn.includes(mode)),
  }
}

/* -------------------------------------------------------------------------- */
/* Реестр                                                                     */
/* -------------------------------------------------------------------------- */

const FISCAL_ONLY: FiscalMode[] = ['fiscal']
const SIMPLE_ONLY: FiscalMode[] = ['simple']

export const FIELDS: FieldDef[] = [
  /* ── Шаг 1: режим работы ─────────────────────────────────────────────── */
  {
    id: 'fiscalMode',
    group: 'root',
    key: 'fiscalMode',
    label: 'Режим работы',
    kind: 'custom',
    span: 12,
    step: 0,
    section: 'Режим работы',
    required: true,
  },

  /* ── Шаг 1: тариф ────────────────────────────────────────────────────── */
  // Отдельной секцией, а не внутри карточек режима работы: это разные решения.
  // Режим определяет, какой печатается чек, тариф — что включено в программе.
  {
    id: 'edition',
    group: 'root',
    key: 'edition',
    label: 'Тариф',
    kind: 'custom',
    span: 12,
    step: 0,
    section: 'Тариф',
  },

  /* ── Шаг 1: магазин ──────────────────────────────────────────────────── */
  // Одно и то же значение под двумя именами: в простом режиме это просто
  // название магазина, в фискальном — краткое наименование субъекта.
  {
    id: 'company.shortName.simple',
    group: 'company',
    key: 'shortName',
    label: 'Название магазина',
    kind: 'text',
    span: 12,
    step: 0,
    section: 'Магазин',
    modes: SIMPLE_ONLY,
    required: true,
    maxLength: 255,
    placeholder: 'Магазин «Бимар»',
    hint: 'Печатается в шапке чека',
    receiptLine: 'Название магазина',
  },
  {
    id: 'company.legalName',
    group: 'company',
    key: 'legalName',
    label: 'Полное наименование субъекта',
    kind: 'text',
    span: 12,
    step: 0,
    section: 'Магазин',
    modes: FISCAL_ONLY,
    required: true,
    maxLength: 255,
    placeholder: 'Общество с ограниченной ответственностью "Бимар"',
    hint: 'Как в свидетельстве о регистрации — печатается в чеке целиком',
    receiptLine: 'Наименование субъекта',
  },
  {
    id: 'company.shortName',
    group: 'company',
    key: 'shortName',
    label: 'Краткое наименование',
    kind: 'text',
    span: 6,
    step: 0,
    section: 'Магазин',
    modes: FISCAL_ONLY,
    required: true,
    maxLength: 255,
    placeholder: 'ОсОО Бимар',
    hint: 'Шапка чека и заголовки отчётов',
    receiptLine: 'Краткое наименование',
  },
  {
    id: 'company.inn',
    group: 'company',
    key: 'inn',
    label: 'ИНН',
    kind: 'digits',
    span: 6,
    step: 0,
    section: 'Магазин',
    modes: FISCAL_ONLY,
    required: true,
    maxLength: 14,
    placeholder: '02105201810071',
    hint: '14 цифр',
    receiptLine: 'ИНН',
    normalize: digitsOnly(14),
    validate: (value) => (/^\d{14}$/.test(value) ? '' : 'ИНН — это ровно 14 цифр.'),
  },
  {
    id: 'outlet.name',
    group: 'outlet',
    key: 'name',
    label: 'Место расчётов',
    kind: 'text',
    span: 12,
    step: 0,
    section: 'Магазин',
    modes: FISCAL_ONLY,
    required: true,
    maxLength: 255,
    placeholder: 'Магазин "Бимар"',
    hint: 'Название точки так, как оно должно стоять в чеке',
    receiptLine: 'Место расчётов',
  },
  {
    id: 'outlet.city',
    group: 'outlet',
    key: 'city',
    label: 'Город',
    kind: 'text',
    span: 4,
    step: 0,
    section: 'Магазин',
    required: true,
    maxLength: 128,
    placeholder: 'Бишкек',
    receiptLine: 'Адрес расчётов',
  },
  // В простом режиме дом отдельным полем не спрашиваем — он пишется здесь же.
  {
    id: 'outlet.street.simple',
    group: 'outlet',
    key: 'street',
    label: 'Улица и дом',
    kind: 'text',
    span: 8,
    step: 0,
    section: 'Магазин',
    modes: SIMPLE_ONLY,
    required: true,
    maxLength: 255,
    placeholder: 'ул. Льва Толстого, 19/5',
    receiptLine: 'Адрес',
  },
  {
    id: 'outlet.street',
    group: 'outlet',
    key: 'street',
    label: 'Улица',
    kind: 'text',
    span: 6,
    step: 0,
    section: 'Магазин',
    modes: FISCAL_ONLY,
    required: true,
    maxLength: 255,
    placeholder: 'ул. Льва Толстого',
    receiptLine: 'Адрес расчётов',
  },
  {
    id: 'outlet.building',
    group: 'outlet',
    key: 'building',
    label: 'Дом / помещение',
    kind: 'text',
    span: 4,
    step: 0,
    section: 'Магазин',
    modes: FISCAL_ONLY,
    required: true,
    maxLength: 64,
    placeholder: '19/5',
    receiptLine: 'Адрес расчётов',
  },
  {
    id: 'outlet.postalCode',
    group: 'outlet',
    key: 'postalCode',
    label: 'Индекс',
    kind: 'digits',
    span: 2,
    step: 0,
    section: 'Магазин',
    modes: FISCAL_ONLY,
    maxLength: 6,
    placeholder: '720007',
    receiptLine: 'Адрес расчётов',
    normalize: digitsOnly(6),
  },
  {
    id: 'contacts.phone',
    group: 'contacts',
    key: 'phone',
    label: 'Телефон',
    kind: 'phone',
    span: 6,
    step: 0,
    section: 'Магазин',
    required: true,
    placeholder: '+996 555 123 456',
    hint: 'Печатается в чеке — по нему покупатель находит магазин',
    receiptLine: 'Телефон',
    // В данных лежит каноничный +996XXXXXXXXX, пробелы — только оформление.
    normalize: phoneValue,
    validate: (value) => phoneProblem(value),
  },
  {
    id: 'contacts.email',
    group: 'contacts',
    key: 'email',
    label: 'Email компании',
    kind: 'email',
    span: 6,
    step: 0,
    section: 'Магазин',
    modes: FISCAL_ONLY,
    maxLength: 255,
    placeholder: 'shop@example.kg',
    hint: 'Юридический контакт компании. Email владельца задаётся на шаге 5',
    validate: (value) => (!value.trim() || EMAIL_PATTERN.test(value.trim()) ? '' : 'Проверьте адрес email.'),
  },

  /* ── Шаг 1: координаты ───────────────────────────────────────────────── */
  // Одно поле на пару широта/долгота: цифры здесь не набирают, их определяют
  // по адресу или ставят меткой на карте. Ручной ввод — запасной путь внутри
  // самого контрола.
  {
    id: 'outlet.coords',
    group: 'outlet',
    key: 'lat',
    label: 'Координаты точки',
    kind: 'custom',
    span: 12,
    step: 0,
    section: 'Координаты',
    modes: FISCAL_ONLY,
    required: true,
    receiptLine: 'Координаты',
    validate: (value, data) => {
      const latError = coordinateError(value, 90, 'Широта')
      if (latError) return latError
      const lon = data.outlet.lon
      if (!lon.trim()) return 'Долгота не определена — нажмите «Определить по адресу».'
      return coordinateError(lon, 180, 'Долгота')
    },
  },

  /* ── Шаг 1: ККМ ──────────────────────────────────────────────────────── */
  // Блок чтения с кассы стоит первым: половина полей секции заполняется
  // одной кнопкой, и предлагать её после ручного ввода поздно.
  {
    id: 'kkm.reader',
    group: 'kkm',
    key: 'serialNumber',
    label: 'Информация о кассе',
    kind: 'custom',
    span: 12,
    step: 0,
    section: 'Касса',
    modes: FISCAL_ONLY,
    presentational: true,
  },
  {
    id: 'kkm.serialNumber',
    group: 'kkm',
    key: 'serialNumber',
    label: 'ЗН ККМ',
    kind: 'digits',
    span: 4,
    step: 0,
    section: 'Касса',
    modes: FISCAL_ONLY,
    required: true,
    maxLength: 20,
    placeholder: '4884830117185135',
    hint: 'Заводской номер с шильдика кассы',
    receiptLine: 'ЗН ККМ',
    normalize: digitsOnly(20),
  },
  {
    id: 'kkm.registrationNumber',
    group: 'kkm',
    key: 'registrationNumber',
    label: 'РН ККМ',
    kind: 'digits',
    span: 4,
    step: 0,
    section: 'Касса',
    modes: FISCAL_ONLY,
    required: true,
    maxLength: 20,
    placeholder: '0000000000237210',
    hint: 'Регистрационный номер из налоговой',
    receiptLine: 'РН ККМ',
    normalize: digitsOnly(20),
  },
  {
    id: 'kkm.fiscalModule',
    group: 'kkm',
    key: 'fiscalModule',
    label: 'ФМ',
    kind: 'digits',
    span: 4,
    step: 0,
    section: 'Касса',
    modes: FISCAL_ONLY,
    required: true,
    maxLength: 20,
    placeholder: '0000000002374110',
    hint: 'Номер фискального модуля',
    receiptLine: 'ФМ',
    normalize: digitsOnly(20),
  },
  {
    id: 'kkm.posNumber',
    group: 'kkm',
    key: 'posNumber',
    label: 'Касса №',
    kind: 'digits',
    span: 4,
    step: 0,
    section: 'Касса',
    modes: FISCAL_ONLY,
    required: true,
    maxLength: 3,
    placeholder: '1',
    hint: 'Номер этой кассы в магазине',
    receiptLine: 'Касса №',
    normalize: digitsOnly(3),
  },
  // Версии ФФД и ПО в реестре отсутствуют намеренно: это свойства прошивки
  // кассы, руками их не вводят. Их показывает блок «Информация о кассе».

  /* ── Шаг 1: оборудование ─────────────────────────────────────────────── */
  // Своя секция, а не «Касса»: та существует только в фискальном режиме и
  // свёрнута по умолчанию, а этот вопрос задают на любой установке и прятать
  // его под складку нельзя — от ответа зависит, сможет ли специалист вообще
  // набрать ключ на этом устройстве.
  //
  // Значение живёт в группе `branding`: она уже закреплена за специалистом и на
  // сервере, и правку сенсорного экрана владельцем сервер отвергнет сам.
  {
    id: 'branding.touchScreen',
    group: 'branding',
    key: 'touchScreen',
    label: 'Сенсорный экран',
    kind: 'toggle',
    span: 12,
    step: 0,
    section: 'Оборудование',
    hint: 'Моноблок без физической клавиатуры. В окнах ввода ключа появится экранная клавиатура',
  },
  // Камера — не у всякой кассы. Отдельная галочка нужна затем, чтобы всё, что
  // от камеры зависит, не показывалось там, где её нет: предлагать снять лицо
  // на устройстве без камеры хуже, чем не предлагать вовсе.
  {
    id: 'branding.hasCamera',
    group: 'branding',
    key: 'hasCamera',
    label: 'Камера',
    kind: 'toggle',
    span: 12,
    step: 0,
    section: 'Оборудование',
    hint: 'К кассе подключена камера. Без неё разделы, которым нужна съёмка, не показываются',
  },

  /* ── Шаг 2: сфера, локализация, налоги, склад ────────────────────────── */
  {
    id: 'business.industry',
    group: 'business',
    key: 'industry',
    label: 'Сфера',
    kind: 'custom',
    span: 12,
    step: 1,
    section: 'Сфера',
    required: true,
  },
  {
    id: 'business.currency',
    group: 'business',
    key: 'currency',
    label: 'Валюта',
    kind: 'select',
    span: 4,
    step: 1,
    section: 'Локализация',
    required: true,
    receiptLine: 'Валюта',
    options: CURRENCIES.map((item) => ({
      value: item.code,
      label: `${item.code} — ${item.label} (${item.symbol})`,
    })),
  },
  {
    id: 'business.decimals',
    group: 'business',
    key: 'decimals',
    label: 'Знаков после запятой',
    kind: 'select',
    span: 2,
    step: 1,
    section: 'Локализация',
    required: true,
    hint: 'Точность цен и сумм',
    options: [
      { value: '0', label: '0 — 250 сом' },
      { value: '1', label: '1 — 250,5 сом' },
      { value: '2', label: '2 — 250,50 сом' },
    ],
  },
  {
    id: 'business.timezone',
    group: 'business',
    key: 'timezone',
    label: 'Часовой пояс',
    kind: 'select',
    span: 6,
    step: 1,
    section: 'Локализация',
    required: true,
    hint: 'Определяет дату и время в чеке',
    options: TIMEZONES.map((item) => ({ value: item.value, label: item.label })),
  },
  {
    id: 'business.country',
    group: 'business',
    key: 'country',
    label: 'Страна',
    kind: 'select',
    span: 6,
    step: 1,
    section: 'Локализация',
    required: true,
    options: COUNTRIES.map((item) => ({ value: item, label: item })),
  },
  // Налоги. Владелец магазина не обязан знать налоговый кодекс, поэтому
  // выбор режима подставляет типовые ставки, а под каждым полем стоит
  // подсказка. Ставки при этом остаются обычными полями и правятся руками.
  {
    id: 'tax.regime',
    group: 'tax',
    key: 'regime',
    label: 'Система налогообложения',
    kind: 'select',
    span: 12,
    step: 1,
    section: 'Налогообложение',
    modes: FISCAL_ONLY,
    required: true,
    receiptLine: 'СНО',
    options: TAX_REGIMES.map((item) => ({ value: item.id, label: item.label })),
    hintFor: (data) => `${taxRegimeHint(data.tax.regime)} Ставки подставлены автоматически — поправьте, если у вас иначе.`,
    afterWrite: (data) => applyTaxRegime(data, data.tax.regime),
  },
  {
    id: 'tax.singleTaxRate',
    group: 'tax',
    key: 'singleTaxRate',
    label: 'Единый налог, %',
    kind: 'decimal',
    span: 3,
    step: 1,
    section: 'Налогообложение',
    modes: FISCAL_ONLY,
    // Единый налог существует только на упрощённой системе — на общем режиме
    // и патенте такого поля просто нет.
    when: (data) => data.tax.regime === 'simplified_single',
    placeholder: '0.5',
    hint: 'Торговля — 0,5%. С ККМ и оборотом до 8 млн — 0%',
    normalize: (raw) => raw.replace(/,/g, '.').replace(/[^\d.]/g, '').slice(0, 5),
    validate: rateValidator('Единый налог'),
  },
  {
    id: 'tax.vatRate',
    group: 'tax',
    key: 'vatRate',
    label: 'НДС, %',
    kind: 'decimal',
    span: 3,
    step: 1,
    section: 'Налогообложение',
    modes: FISCAL_ONLY,
    placeholder: '0',
    receiptLine: 'НДС %',
    hintFor: (data) =>
      data.tax.regime === 'general'
        ? 'НДС обязателен при обороте свыше 30 млн сом в год'
        : 'На этом режиме НДС не начисляется',
    normalize: (raw) => raw.replace(/,/g, '.').replace(/[^\d.]/g, '').slice(0, 5),
    validate: rateValidator('НДС'),
  },
  {
    id: 'tax.salesTaxRate',
    group: 'tax',
    key: 'salesTaxRate',
    label: 'НСП, %',
    kind: 'decimal',
    span: 3,
    step: 1,
    section: 'Налогообложение',
    modes: FISCAL_ONLY,
    placeholder: '0',
    receiptLine: 'НСП %',
    hintFor: salesTaxHint,
    normalize: (raw) => raw.replace(/,/g, '.').replace(/[^\d.]/g, '').slice(0, 5),
    validate: rateValidator('НСП'),
  },
  {
    id: 'tax.note',
    group: 'tax',
    key: 'regime',
    label: 'Про налоги',
    kind: 'custom',
    span: 12,
    step: 1,
    section: 'Налогообложение',
    presentational: true,
  },
  // Режима склада здесь больше нет: остатки ведутся всегда. На его месте —
  // выбор главной цифры дашборда. Учёт от этого не меняется, см. types.ts.
  {
    id: 'business.analyticsMode',
    group: 'business',
    key: 'analyticsMode',
    label: 'Как считать аналитику',
    kind: 'custom',
    span: 12,
    step: 1,
    section: 'Как считать аналитику',
    required: true,
  },

  /* ── Шаг 3: оплата ───────────────────────────────────────────────────── */
  {
    id: 'acquiring.methods',
    group: 'acquiring',
    key: 'methods',
    label: 'Способы оплаты',
    kind: 'custom',
    span: 12,
    step: 2,
    section: 'Способы оплаты',
    required: true,
    receiptLine: 'Способы оплаты',
  },
  {
    id: 'acquiring.bank',
    group: 'acquiring',
    key: 'bank',
    label: 'Банк-эквайер',
    kind: 'text',
    span: 6,
    step: 2,
    section: 'Эквайринг',
    maxLength: 128,
    placeholder: 'Оптима Банк',
    hint: 'Печатается в слипе по карточной оплате',
    receiptLine: 'Банк-эквайер',
  },
  {
    id: 'acquiring.terminalId',
    group: 'acquiring',
    key: 'terminalId',
    label: 'Терминал ID',
    kind: 'text',
    span: 6,
    step: 2,
    section: 'Эквайринг',
    maxLength: 64,
    placeholder: 'PR900114',
    receiptLine: 'Терминал ID',
    normalize: (raw) => raw.toUpperCase().replace(/\s/g, ''),
  },
  {
    id: 'acquiring.providers',
    group: 'acquiring',
    key: 'providers',
    label: 'Способы безналичной оплаты',
    kind: 'custom',
    span: 12,
    step: 2,
    section: 'Оплата по QR',
    receiptLine: 'Способ оплаты',
  },
  {
    id: 'acquiring.qrProvider',
    group: 'acquiring',
    key: 'qrProvider',
    label: 'QR-провайдер в чеке',
    kind: 'text',
    span: 6,
    step: 2,
    section: 'Оплата по QR',
    maxLength: 64,
    placeholder: 'MBank / О!Деньги / Элсом',
    hint: 'Название, которое печатается в чеке строкой «QR»',
    receiptLine: 'QR-провайдер',
  },
  {
    id: 'acquiring.secondScreen',
    group: 'acquiring',
    key: 'secondScreen',
    label: 'Второй экран покупателя',
    kind: 'toggle',
    span: 6,
    step: 2,
    section: 'Оплата по QR',
    hint: 'Показывать состав чека и QR на экране, повёрнутом к покупателю',
  },

  /* ── Шаг 4: оформление ───────────────────────────────────────────────── --

     Шаг устроен как один выбор и его последствия.

     Первым идёт режим бренда, и у большинства точек он же и последний: шаг
     проходится нажатием «Далее», система остаётся под брендом Kassir ERP.
     Всё, что касается внешнего вида, собрано в одной секции ниже и появляется
     только у тех, кто выбрал свой бренд.

     Раньше это лежало четырьмя отдельными секциями — «Бренд», «Логотип в
     интерфейсе», «Тема интерфейса», «Цвета», — причём две последние
     показывались независимо от режима. Получалось, что магазин под заводским
     брендом всё равно настраивал цвет системы, а «оформление» было размазано
     по шагу так, что собрать его в голове было нельзя. */
  {
    id: 'branding.factoryBrand',
    group: 'branding',
    key: 'useFactoryBrand',
    label: 'Бренд системы',
    kind: 'custom',
    span: 12,
    step: 3,
    section: 'Бренд системы',
  },
  {
    /*
      Название системы в интерфейсе — НЕ название магазина.

      Стоит первым в блоке своего бренда намеренно: это то, ради чего блок
      чаще всего и открывают, и одновременно то, что чаще всего путают с
      реквизитами. Подпись под полем говорит про разницу прямо.
    */
    id: 'branding.brandName',
    group: 'branding',
    key: 'brandName',
    label: 'Название в интерфейсе',
    kind: 'text',
    span: 12,
    step: 3,
    section: 'Свой бренд',
    maxLength: 64,
    placeholder: 'Kassir ERP',
    hint: 'Стоит в шапке и на экране входа. Это название программы, а не магазина — название магазина с первого шага печатается в чеке',
    when: (data) => !data.branding.useFactoryBrand,
  },
  {
    id: 'branding.logo',
    group: 'branding',
    key: 'logo',
    label: 'Логотип в интерфейсе',
    kind: 'custom',
    span: 12,
    step: 3,
    section: 'Свой бренд',
    // Заводской бренд ничего не спрашивает — редактор просто не существует.
    when: (data) => !data.branding.useFactoryBrand,
  },
  {
    // Компоновка шапки: как стоят знак и надпись. Знак здесь не загружается —
    // он в блоке выше; название приходит из поля `brandName`.
    id: 'branding.logoTextEditor',
    group: 'branding',
    key: 'headerLayout',
    label: 'Шапка приложения',
    kind: 'custom',
    span: 12,
    step: 3,
    section: 'Свой бренд',
    when: (data) => !data.branding.useFactoryBrand,
  },
  {
    id: 'branding.theme',
    group: 'branding',
    key: 'theme',
    label: 'Тема интерфейса',
    kind: 'custom',
    span: 12,
    step: 3,
    section: 'Свой бренд',
    when: (data) => !data.branding.useFactoryBrand,
  },
  {
    id: 'branding.primaryColor',
    group: 'branding',
    key: 'primaryColor',
    label: 'Основной цвет системы',
    kind: 'custom',
    span: 12,
    step: 3,
    section: 'Свой бренд',
    when: (data) => !data.branding.useFactoryBrand,
    /*
      Нечитаемый цвет дальше этого шага не проходит.

      Проверка живёт в реестре, а не в самом контроле, и это принципиально:
      отсюда её видят и «Продолжить» (problemsForStep), и сводка перед
      запуском (allBlocking). Спрятать предупреждение в контроле значило бы
      показать его на шаге и всё равно пустить дальше.

      Под заводским брендом поля не существует, и проверять нечего: цвет там
      всегда стандартный мятный.
    */
    validate: (value, data) => accentProblem(value, data.branding.theme),
  },
  {
    // Логотип для чека. Внутри своего бренда, а не отдельным блоком: под
    // заводским на ленту идёт стандартный знак, и спрашивать не о чем.
    // Термопечать при этом требует своего файла — цветной знак с тонкими
    // линиями на ленте в один бит рассыпается, — поэтому редактор отдельный.
    id: 'branding.receiptLook',
    group: 'branding',
    key: 'receiptHeader',
    label: 'Логотип в чеке',
    kind: 'custom',
    span: 12,
    step: 3,
    section: 'Свой бренд',
    receiptLine: 'Логотип в шапке',
    when: (data) => !data.branding.useFactoryBrand,
  },
  {
    /*
      Нижняя строка чека остаётся в обоих режимах.

      Это не бренд, а текст на ленте: телефон, Instagram, «Спасибо за
      покупку». Спрятать его внутрь своего бренда значило бы отнять его у всех
      точек под заводским — то есть у большинства.
    */
    id: 'branding.receiptFooter',
    group: 'branding',
    key: 'receiptFooter',
    label: 'Нижняя строка чека',
    kind: 'text',
    span: 12,
    step: 3,
    section: 'Чек',
    maxLength: 128,
    placeholder: 'Спасибо за покупку!',
    hint: 'Пусто — напечатается «Спасибо за покупку!». Сюда же ставят телефон или Instagram',
    receiptLine: 'Подвал чека',
  },
  {
    id: 'branding.receiptPreview',
    group: 'branding',
    key: 'logo',
    label: 'Как чек выйдет на ленте',
    kind: 'custom',
    span: 12,
    step: 3,
    section: 'Чек',
    presentational: true,
  },

  /* ── Шаг 5: учётная запись ───────────────────────────────────────────── */
  {
    id: 'owner.firstName',
    group: 'owner',
    key: 'firstName',
    label: 'Имя',
    kind: 'text',
    span: 6,
    step: 4,
    section: 'Владелец',
    required: true,
    maxLength: 128,
    placeholder: 'Айгуль',
    receiptLine: 'Кассир',
  },
  {
    id: 'owner.lastName',
    group: 'owner',
    key: 'lastName',
    label: 'Фамилия',
    kind: 'text',
    span: 6,
    step: 4,
    section: 'Владелец',
    required: true,
    maxLength: 128,
    placeholder: 'Масалбекова',
    receiptLine: 'Кассир',
  },
  {
    id: 'owner.email',
    group: 'owner',
    key: 'email',
    label: 'Email владельца',
    kind: 'custom',
    span: 12,
    step: 4,
    section: 'Вход в систему',
    required: true,
  },
  {
    id: 'owner.password',
    group: 'owner',
    key: 'password',
    label: 'Пароль',
    kind: 'custom',
    span: 6,
    step: 4,
    section: 'Вход в систему',
    required: true,
    virtual: true,
  },
  // Второй секрет владельца — отдельным полем, а не «тем же паролем».
  //
  // Под учётной записью выше работает вся смена: её логин это email установки,
  // и пароль от неё владелец диктует кассиру по телефону, чтобы тот пробил
  // возврат. Пока кабинет открывался тем же паролем, вместе с возвратом человек
  // отдавал выручку, себестоимость и сотрудников.
  //
  // Сервисного ключа здесь больше нет: сервисный режим открывает лицензионный
  // ключ установки (KASSIR-XXXX-XXXX-XXXX), с которым специалист и приезжает.
  // Отдельный ключ «на всякий случай» терялся первым — заводил его владелец
  // полгода назад, а спрашивают его у приехавшего установщика.
  {
    id: 'owner.ownerPassword',
    group: 'owner',
    key: 'ownerPassword',
    label: 'Пароль владельца',
    kind: 'custom',
    span: 6,
    step: 4,
    section: 'Вход в систему',
    required: true,
    virtual: true,
  },
  // PIN кассира здесь отсутствует намеренно: на этом шаге кассиров ещё нет.
  // Он задаётся при добавлении сотрудника в разделе «Сотрудники», и у каждого
  // свой — общий PIN не давал бы понять по журналу, кто отменил чек.
  {
    id: 'owner.cashierCode',
    group: 'owner',
    key: 'cashierCode',
    label: 'Код кассира (КТ)',
    kind: 'digits',
    span: 6,
    step: 4,
    section: 'Вход в систему',
    modes: FISCAL_ONLY,
    maxLength: 14,
    placeholder: '53011090',
    hint: 'Печатается в фискальном чеке. Можно оставить пустым и заполнить позже',
    receiptLine: 'КТ',
    normalize: digitsOnly(14),
  },
]

/* -------------------------------------------------------------------------- */
/* Доступ к значениям и проверки                                              */
/* -------------------------------------------------------------------------- */

const FIELD_BY_ID = new Map(FIELDS.map((field) => [field.id, field]))

export function fieldById(id: string): FieldDef | undefined {
  return FIELD_BY_ID.get(id)
}

/**
 * Существует ли поле при текущих ответах. Единственная проверка условий
 * видимости в проекте: и режим работы, и зависимости вроде «единый налог
 * только на упрощённой» проходят здесь.
 */
export function fieldApplies(field: FieldDef, data: OnboardingData): boolean {
  if (field.modes && !field.modes.includes(data.fiscalMode)) return false
  return field.when?.(data) ?? true
}

/** Скаляры верхнего уровня OnboardingData: режим работы и тариф. */
type RootKey = 'fiscalMode' | 'edition'

/** Значение поля в виде строки — реестр работает со строками, тип хранит числа. */
export function readField(data: OnboardingData, field: FieldDef): string {
  if (field.group === 'root') return String(data[field.key as RootKey])
  const group = data[field.group] as Record<string, unknown>
  const value = group[field.key]
  if (value == null) return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

/** Возвращает копию данных с новым значением поля, приводя тип к исходному. */
export function writeField(data: OnboardingData, field: FieldDef, raw: string): OnboardingData {
  if (field.group === 'root') {
    return field.key === 'edition'
      ? { ...data, edition: raw as Edition }
      : { ...data, fiscalMode: raw as FiscalMode }
  }
  const group = data[field.group] as Record<string, unknown>
  const previous = group[field.key]
  let next: unknown = raw
  if (typeof previous === 'boolean') next = raw === 'true'
  else if (field.kind === 'decimal' && typeof previous === 'number') next = toNumber(raw)
  const written: OnboardingData = {
    ...data,
    [field.group]: { ...group, [field.key]: next },
  }
  return field.afterWrite ? field.afterWrite(written) : written
}

function toNumber(raw: string): number {
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Ошибка конкретного поля: сначала обязательность, затем своя проверка. */
export function validateField(field: FieldDef, data: OnboardingData): string {
  // readonly приходит из прошивки, virtual (пароль, PIN) проверяет экран, а
  // presentational вообще не хранит значения — в данных их нет, и readField
  // вернул бы пустую строку.
  if (field.kind === 'readonly' || field.virtual || field.presentational) return ''
  // Поле, которого при текущих ответах не существует, спрашивать нельзя —
  // значит и требовать нечего.
  if (!fieldApplies(field, data)) return ''
  const value = readField(data, field)
  if (field.required && !value.trim()) return `Заполните поле «${field.label}».`
  return field.validate?.(value, data) ?? ''
}

/** Поля шага при текущих ответах — в порядке объявления. */
export function fieldsForStep(step: number, data: OnboardingData): FieldDef[] {
  return FIELDS.filter((field) => field.step === step && fieldApplies(field, data))
}

/** Секции шага в порядке объявления полей. */
export function sectionsForStep(
  step: number,
  data: OnboardingData,
): { section: string; fields: FieldDef[] }[] {
  return groupBySection(fieldsForStep(step, data))
}

/** Раскладка полей по секциям с сохранением порядка объявления. */
export function groupBySection(fields: FieldDef[]): { section: string; fields: FieldDef[] }[] {
  const order: string[] = []
  const bySection = new Map<string, FieldDef[]>()
  for (const field of fields) {
    if (!bySection.has(field.section)) {
      bySection.set(field.section, [])
      order.push(field.section)
    }
    bySection.get(field.section)!.push(field)
  }
  return order.map((section) => ({ section, fields: bySection.get(section)! }))
}

export type FieldProblem = { field: FieldDef; message: string }

/** Все незаполненные и неверные поля шага — сводка показывает их списком. */
export function problemsForStep(step: number, data: OnboardingData): FieldProblem[] {
  const problems: FieldProblem[] = []
  for (const field of fieldsForStep(step, data)) {
    const message = validateField(field, data)
    if (message) problems.push({ field, message })
  }
  return problems
}

/*
 * Сброса полей шага к значениям по умолчанию здесь больше нет.
 *
 * Он существовал ради кнопки «Стандарт» в подвале мастера, а кнопку убрали:
 * рядом с «Продолжить» она читалась как выбор тарифа, а не как отмена правок,
 * и нажималась по ошибке — вместе с потерей заполненного шага. Тариф теперь
 * выбирается своим блоком на первом шаге (поле `edition`).
 */

/** Незаполненные необязательные поля — статус «⚠» в сводке, а не ошибка. */
export function optionalGapsForStep(step: number, data: OnboardingData): FieldDef[] {
  return fieldsForStep(step, data).filter(
    (field) =>
      !field.required &&
      !field.virtual &&
      !field.presentational &&
      field.kind !== 'readonly' &&
      field.kind !== 'toggle' &&
      !readField(data, field).trim(),
  )
}

/**
 * Шаг, на котором собираются пароль и PIN. Берётся из реестра, а не пишется
 * числом: секреты живут вне OnboardingData, и экраны добавляют их проблемы
 * вручную — при перестановке шагов эта пара разъехалась бы молча.
 *
 * Функции «проблемы по всем шагам» здесь нет намеренно: она не видит секретов
 * и потому всегда врала бы на последнем шаге. Сводит их вызывающий экран.
 */
export const ACCOUNT_STEP = FIELDS.find((field) => field.id === 'owner.password')!.step
