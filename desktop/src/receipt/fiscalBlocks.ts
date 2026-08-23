/**
 * Блоки чека — шапка и подвал.
 *
 * Собираются из OnboardingData и возвращают HTML. Тот же HTML показывает
 * предпросмотр в мастере и в настройках, поэтому «на экране одно, на ленте
 * другое» здесь невозможно по построению.
 *
 * Режим работы решает, какой это чек. В фискальном печатается всё, чего
 * требует ГНС: ИНН, СНО, номера ККМ, координаты и QR. В простом — товарный
 * чек: название, адрес, телефон и состав покупки. Разница описана здесь
 * один раз; экраны и печать про неё не знают и знать не должны.
 */

import { formatPhone } from '../onboarding/phone'
import {
  DEFAULT_RECEIPT_FOOTER,
  SIMPLE_RECEIPT_TITLE,
  formatCoordinates,
  formatOutletAddress,
  formatPaymentMethods,
  isFiscal,
  ownerFullName,
  receiptLogoSource,
  storeDisplayName,
  taxRegimeLabel,
} from '../onboarding/types'
import type { OnboardingData } from '../onboarding/types'

export function escHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Строка «Метка: значение», которая исчезает целиком, если значения нет. */
function metaRow(label: string, value: string): string {
  return value.trim() ? `<div class="fx-row"><span>${escHtml(label)}</span><span>${escHtml(value)}</span></div>` : ''
}

function centered(value: string, className = 'fx-center'): string {
  return value.trim() ? `<div class="${className}">${escHtml(value)}</div>` : ''
}

/**
 * Шапка чека.
 *
 * Фискальный режим: логотип, наименования, место и адрес расчётов,
 * координаты, ИНН, СНО и реквизиты ККМ — ровно то, что печатает касса до
 * списка товаров. Простой режим: название магазина, адрес, телефон и
 * заголовок «Товарный чек» — фискальных строк там нет, и их отсутствие не
 * ошибка, а суть режима.
 */
export type FiscalHeaderInput = {
  /** Кто фактически пробил чек. Пусто — печатаем кассира из регистрации. */
  cashierName?: string
}

export function fiscalHeaderHtml(data: OnboardingData, input: FiscalHeaderInput = {}): string {
  const { company, outlet, kkm, branding, owner, tax, contacts } = data
  // Печать логотипа — своя настройка, не связанная с тем, показан ли он в
  // шапке приложения: владелец может держать логотип на экране и не ставить
  // его на чеки, и наоборот. `mode: 'none'` здесь не проверяется намеренно —
  // это выбор источника интерфейсного знака, а у чека источник свой.
  const showLogo = branding.receiptLogo && branding.receiptHeader !== 'name'
  // На ленту уходит специально подготовленный 1-битный вариант под текущий
  // рулон: цветной PNG принтер отобразит полутонами, то есть грязью.
  const logoSource = receiptLogoSource(branding)
  const showName = branding.receiptHeader !== 'logo'
  // Название магазина одно на всё приложение и берётся из реквизитов. В
  // фискальном чеке краткое наименование печатается обязательной строкой ниже,
  // поэтому шапкой его не повторяем — иначе оно стояло бы дважды подряд.
  const caption = showName && !isFiscal(data) ? storeDisplayName(data) : ''
  // Смену может вести не владелец: за кассой сейчас может стоять кто угодно из
  // сотрудников, и в чеке должен стоять именно он. Код КТ при этом остаётся
  // кодом точки из регистрации.
  const name = input.cashierName?.trim() || ownerFullName(owner)
  const logo =
    showLogo && logoSource ? `<div class="fx-logo"><img src="${escHtml(logoSource)}" alt="" /></div>` : ''

  if (!isFiscal(data)) {
    return `
      ${logo}
      ${centered(caption, 'fx-caption')}
      ${caption ? '' : centered(company.shortName, 'fx-short')}
      ${centered(formatOutletAddress(outlet), 'fx-center fx-small')}
      ${centered(formatPhone(contacts.phone), 'fx-center fx-small')}
      <hr class="fx-hr" />
      ${centered(SIMPLE_RECEIPT_TITLE, 'fx-caption')}
      ${metaRow('Кассир', name)}
    `
  }

  const ffd = [kkm.ffdVersion, kkm.swVersion].filter(Boolean).join(' / ')
  const cashier = [name, owner.cashierCode].filter(Boolean).join(', ')

  return `
    ${logo}
    ${centered(caption, 'fx-caption')}
    ${centered(company.legalName, 'fx-legal')}
    ${centered(company.shortName, 'fx-short')}
    ${centered(outlet.name, 'fx-center')}
    ${centered(formatOutletAddress(outlet), 'fx-center fx-small')}
    ${centered(formatCoordinates(outlet), 'fx-center fx-small')}
    <hr class="fx-hr" />
    ${metaRow('ИНН', company.inn)}
    ${metaRow('СНО', taxRegimeLabel(tax.regime))}
    ${metaRow('ЗН ККМ', kkm.serialNumber)}
    ${metaRow('РН ККМ', kkm.registrationNumber)}
    ${metaRow('ФМ', kkm.fiscalModule)}
    ${metaRow('Версия ФФД / ПО', ffd)}
    ${metaRow('Касса №', kkm.posNumber)}
    ${metaRow('Кассир, КТ', cashier)}
  `
}

export type FiscalFooterInput = {
  /** Как фактически оплатили этот чек. Пусто — печатаем доступные способы. */
  paymentMethod?: string
  /**
   * Готовая картинка QR ГНС (data URL), которую отдал фискальный модуль после
   * регистрации чека. Формируется устройством, а не приложением: подделывать
   * фискальный QR нельзя, поэтому без ответа модуля блок не печатается.
   */
  fiscalQrImage?: string
  /** Референс платежа в банке — по нему платёж ищут в выписке. */
  paymentRef?: string
  /** Подтвердил ли оплату банк. Пусто — строка о завершении не печатается. */
  paymentConfirmed?: boolean
}

/** Подвал: ставки налогов, данные эквайринга и фискальный QR. */
export function fiscalFooterHtml(data: OnboardingData, input: FiscalFooterInput = {}): string {
  const { tax, acquiring } = data
  const terminal = [acquiring.bank, acquiring.terminalId].filter(Boolean).join(', ')
  const methods = input.paymentMethod?.trim() || formatPaymentMethods(acquiring.methods)
  const qrProvider = acquiring.qrProvider.trim()

  if (!isFiscal(data)) {
    // Товарный чек не подтверждает уплату налога — печатать ставки и QR ГНС
    // в нём значит вводить покупателя в заблуждение.
    return `
      ${metaRow('Способ оплаты', methods)}
      ${metaRow('Банк-эквайер', terminal)}
      ${metaRow('QR', qrProvider)}
      ${centered('Чек без фискальных данных', 'fx-center fx-small')}
    `
  }

  const rates = `${formatRate(tax.vatRate)} / ${formatRate(tax.salesTaxRate)}`

  return `
    ${metaRow('НДС % / НСП %', rates)}
    ${metaRow('Способ оплаты', methods)}
    ${metaRow('Банк-эквайер', terminal)}
    ${metaRow('QR', qrProvider)}
    ${metaRow('Референс', input.paymentRef ?? '')}
    ${input.paymentConfirmed ? centered('Успешно завершено', 'fx-center') : ''}
    ${
      input.fiscalQrImage
        ? `<div class="fx-qr"><img src="${escHtml(input.fiscalQrImage)}" alt="QR ГНС" /></div>`
        : ''
    }
  `
}

/** Подпись в конце чека: своя, если задана, иначе стандартная. */
export function receiptFooterText(data: OnboardingData): string {
  return data.branding.receiptFooter.trim() || DEFAULT_RECEIPT_FOOTER
}

function formatRate(rate: number): string {
  const value = Number.isFinite(rate) ? rate : 0
  return `${Number.isInteger(value) ? value : value.toFixed(2)}%`
}

/* -------------------------------------------------------------------------- */
/* Текстовый чек: проверка раскладки по символам                              */
/* -------------------------------------------------------------------------- */

/** Ширина ленты в символах: 58 мм ≈ 32, 80 мм ≈ 48. */
export type ReceiptColumns = 32 | 48

/** Переносит по словам, длинные слова рубит — как это сделает принтер. */
function wrap(text: string, width: number): string[] {
  const source = text.trim()
  if (!source) return []
  const lines: string[] = []
  let line = ''
  for (const word of source.split(/\s+/)) {
    if (word.length > width) {
      if (line) {
        lines.push(line)
        line = ''
      }
      let rest = word
      while (rest.length > width) {
        lines.push(rest.slice(0, width))
        rest = rest.slice(width)
      }
      line = rest
      continue
    }
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length <= width) line = candidate
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

function center(text: string, width: number): string[] {
  return wrap(text, width).map((line) => {
    const pad = Math.max(0, Math.floor((width - line.length) / 2))
    return ' '.repeat(pad) + line
  })
}

/** «Метка ....... значение» с точечным заполнением до правого края. */
function pair(label: string, value: string, width: number): string[] {
  if (!value.trim()) return []
  const left = label.trim()
  const right = value.trim()
  if (left.length + right.length + 1 <= width) {
    return [left + ' '.repeat(width - left.length - right.length) + right]
  }
  // Не влезло в строку — значение уходит на следующую, прижатое вправо.
  return [left, ...wrap(right, width).map((line) => line.padStart(width))]
}

/**
 * Чек как последовательность строк фиксированной ширины.
 *
 * Это проверочный вид: он показывает ровно то, что физически поместится на
 * ленте, поэтому кривой адрес или слишком длинное название видно сразу. Данные
 * и форматирование берутся из тех же функций, что и HTML-версия, — расходиться
 * им не на чем.
 */
export function receiptTextLines(data: OnboardingData, columns: ReceiptColumns): string[] {
  const { company, outlet, kkm, branding, owner, tax, acquiring, business, contacts } = data
  const w = columns
  const rule = '-'.repeat(w)
  const fiscal = isFiscal(data)
  const lines: string[] = []

  const printLogo = branding.receiptLogo && branding.receiptHeader !== 'name'
  if (printLogo && receiptLogoSource(branding)) {
    lines.push(...center('[ ЛОГОТИП ]', w))
  }
  // То же правило, что и в HTML-версии: в фискальном чеке краткое наименование
  // печатается обязательной строкой ниже, и дублировать его шапкой незачем.
  const headerName = branding.receiptHeader !== 'logo' && !fiscal ? storeDisplayName(data) : ''
  if (headerName) {
    lines.push(...center(headerName.toUpperCase(), w))
  }

  if (fiscal) {
    lines.push(...center(company.legalName, w))
    lines.push(...center(company.shortName, w))
    lines.push(...center(outlet.name, w))
    lines.push(...center(formatOutletAddress(outlet), w))
    lines.push(...center(formatCoordinates(outlet), w))
    lines.push(rule)
    lines.push(...pair('ИНН', company.inn, w))
    lines.push(...pair('СНО', taxRegimeLabel(tax.regime), w))
    lines.push(...pair('ЗН ККМ', kkm.serialNumber, w))
    lines.push(...pair('РН ККМ', kkm.registrationNumber, w))
    lines.push(...pair('ФМ', kkm.fiscalModule, w))
    lines.push(...pair('ФФД / ПО', [kkm.ffdVersion, kkm.swVersion].filter(Boolean).join(' / '), w))
    lines.push(...pair('Касса №', kkm.posNumber, w))
    lines.push(...pair('Кассир, КТ', [ownerFullName(owner), owner.cashierCode].filter(Boolean).join(', '), w))
  } else {
    lines.push(...center(company.shortName, w))
    lines.push(...center(formatOutletAddress(outlet), w))
    lines.push(...center(formatPhone(contacts.phone), w))
    lines.push(rule)
    lines.push(...center(SIMPLE_RECEIPT_TITLE, w))
    lines.push(...pair('Кассир', ownerFullName(owner), w))
  }
  lines.push(rule)

  const currency = business.currencyLabel || 'сом'
  const money = (value: number) => value.toFixed(Math.max(0, Math.min(2, business.decimals)))
  for (const item of DEMO_ITEMS) {
    lines.push(...wrap(item.name, w))
    lines.push(...pair(`  ${item.qty} x ${money(item.price)}`, money(item.qty * item.price), w))
  }

  lines.push(rule)
  const total = DEMO_ITEMS.reduce((sum, item) => sum + item.qty * item.price, 0)
  lines.push(...pair('ИТОГО', `${money(total)} ${currency}`, w))
  if (fiscal) {
    lines.push(...pair('НДС % / НСП %', `${formatRate(tax.vatRate)} / ${formatRate(tax.salesTaxRate)}`, w))
  }
  lines.push(...pair('Оплата', formatPaymentMethods(acquiring.methods), w))
  lines.push(...pair('Эквайер', [acquiring.bank, acquiring.terminalId].filter(Boolean).join(', '), w))
  lines.push(...pair('QR', acquiring.qrProvider, w))
  if (fiscal) {
    // Настоящий QR формирует фискальный модуль после регистрации чека —
    // в предпросмотре честно показываем только зарезервированное под него место.
    lines.push(rule)
    lines.push(...center('[ QR ГНС ]', w))
    lines.push(...center('печатается фискальным модулем', w))
  } else {
    lines.push(...center('Чек без фискальных данных', w))
  }
  lines.push(rule)
  lines.push(...center(receiptFooterText(data), w))

  return lines
}

/** Демо-позиции для проверочного чека — одинаковые во всех предпросмотрах. */
const DEMO_ITEMS = [
  { name: 'Молоко пастеризованное 3.2%', qty: 2, price: 89 },
  { name: 'Яблоки Голден', qty: 0.542, price: 120 },
]

/**
 * Стили фискальных блоков. Вынесены строкой, потому что нужны и внутри
 * автономного HTML для растеризации, и в предпросмотре на экране.
 */
export function fiscalBlocksCss(options: { base: number; lineSpacing: number; bold: boolean }): string {
  const { base, lineSpacing, bold } = options
  const small = Math.max(9, Math.round(base * 0.74))
  return `
    .fx-logo { text-align: center; margin: 0 0 4px; }
    .fx-logo img { width: ${Math.round(base * 4.2)}px; height: auto; max-width: 60%; }
    .fx-caption {
      text-align: center;
      font-size: ${Math.round(base * 1.05)}px;
      font-weight: ${bold ? 800 : 600};
      letter-spacing: 0.03em;
      margin-bottom: 3px;
      word-break: break-word;
    }
    .fx-legal {
      text-align: center;
      font-size: ${small}px;
      line-height: ${lineSpacing};
      word-break: break-word;
    }
    .fx-short {
      text-align: center;
      font-size: ${Math.round(base * 0.96)}px;
      font-weight: ${bold ? 700 : 500};
      margin-top: 1px;
      word-break: break-word;
    }
    .fx-center {
      text-align: center;
      font-size: ${Math.round(base * 0.86)}px;
      line-height: ${lineSpacing};
      margin-top: 1px;
      word-break: break-word;
    }
    .fx-small { font-size: ${small}px; }
    .fx-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 6px;
      font-size: ${small}px;
      line-height: ${lineSpacing};
    }
    .fx-row > span:first-child { flex: 0 0 auto; }
    .fx-row > span:last-child {
      flex: 1 1 auto;
      text-align: right;
      word-break: break-word;
    }
    .fx-hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; height: 0; }
    .fx-qr { text-align: center; margin: 6px 0 2px; }
    .fx-qr img {
      width: ${Math.round(base * 8)}px;
      height: auto;
      max-width: 70%;
      image-rendering: pixelated;
    }
  `
}
