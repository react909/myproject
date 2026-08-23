import type { PrinterSettings } from '../settings/appSettings'
import { readOnboardingCached } from '../onboarding/storage'
import type { OnboardingData } from '../onboarding/types'
import { fiscalBlocksCss, fiscalFooterHtml, fiscalHeaderHtml, receiptFooterText } from './fiscalBlocks'

/** Ширина raster для ESC/POS при 203 dpi (8 dots/mm). */
export const PAPER = {
  58: { width: 384, paddingX: 8, baseFont: 17, nameMax: 24, label: '58 мм' },
  80: { width: 576, paddingX: 12, baseFont: 19, nameMax: 36, label: '80 мм' },
} as const

export type ReceiptPaper = (typeof PAPER)[keyof typeof PAPER]

export type ReceiptRenderOpts = {
  fontScale?: number
  headerScale?: number
  lineSpacing?: number
  compactMode?: boolean
  bold?: boolean
  paperWidth?: '58' | '80' | number
  width?: number
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

export type ReceiptPrintLine = {
  name: string
  qty?: string
  unit?: string
  price?: string
  sum?: string
  discount?: string
}

export type ReceiptPrintPayload = {
  /** Реквизиты магазина — единый объект из онбординга. Шапка и подвал чека
   *  собираются только из него, отдельных storeName/address/inn больше нет. */
  fiscal?: OnboardingData
  receiptNumber?: string
  date?: string
  lines?: ReceiptPrintLine[]
  gross?: string
  discount?: string
  total?: string
  paymentMethod?: string
  cash?: string
  change?: string
  cashier?: string
  thankYou?: string
  /**
   * QR ГНС картинкой (data URL) — его отдаёт фискальный модуль после
   * регистрации чека. Приложение этот код не формирует: подделанный
   * фискальный QR хуже, чем его отсутствие.
   */
  fiscalQrImage?: string
  /** Референс платежа в банке — печатается в фискальном чеке. */
  paymentRef?: string
  /** Подтвердил ли оплату банк, а не кассир глазами. */
  paymentConfirmed?: boolean
  /** HTML для bitmap-печати (генерируется в renderer, main только растеризует). */
  bitmapHtml?: string
}

const DEFAULT_FONT = 'Arial, "Segoe UI", "Noto Sans", sans-serif'

function escHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function resolvePaper(options: ReceiptRenderOpts = {}): ReceiptPaper {
  if (options.paperWidth === '80' || options.paperWidth === 80) return PAPER[80]
  const w = Number(options.width)
  if (Number.isFinite(w) && w >= 560) return PAPER[80]
  return PAPER[58]
}

export function bitmapOptsFromPrinter(printerCfg: Partial<PrinterSettings> = {}): ReceiptRenderOpts & {
  width: number
  paperWidth: '58' | '80'
} {
  const paperWidth = printerCfg.paperWidth === '80' ? '80' : '58'
  const width = paperWidth === '80' ? 576 : 384
  return {
    width,
    paperWidth,
    fontScale: clampNum(printerCfg.fontScale, 0.65, 1.2, 0.92),
    headerScale: clampNum(printerCfg.headerScale, 0.7, 1.1, 0.88),
    lineSpacing: clampNum(printerCfg.lineSpacing, 0.9, 1.35, 1.1),
    compactMode: printerCfg.compactMode === true,
    bold: printerCfg.boldText !== false,
  }
}

export function wrapProductName(text: string, maxChars: number): string[] {
  const raw = String(text ?? '').trim()
  if (!raw) return ['']
  if (raw.length <= maxChars) return [raw]

  const words = raw.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''

  const pushLongToken = (token: string): string => {
    let rest = token
    while (rest.length > maxChars) {
      lines.push(rest.slice(0, maxChars))
      rest = rest.slice(maxChars)
    }
    return rest
  }

  for (const word of words) {
    if (word.length > maxChars) {
      if (line) {
        lines.push(line)
        line = ''
      }
      line = pushLongToken(word)
      continue
    }
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length <= maxChars) {
      line = candidate
    } else {
      if (line) lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : [raw.slice(0, maxChars)]
}

export function buildReceiptHtml(
  data: ReceiptPrintPayload,
  paper: ReceiptPaper,
  opts: ReceiptRenderOpts = {},
): string {
  const fontScale = clampNum(opts.fontScale, 0.65, 1.2, 0.92)
  const headerScale = clampNum(opts.headerScale, 0.7, 1.1, paper === PAPER[58] ? 0.88 : 1.0)
  const lineSpacing = clampNum(opts.lineSpacing, 0.9, 1.35, 1.1)
  const compact = opts.compactMode === true
  const bold = opts.bold !== false
  const width = paper.width
  const padX = paper.paddingX
  const base = Math.round(paper.baseFont * fontScale)
  const storeSize = Math.max(11, Math.round(base * headerScale))
  const totalSize = Math.max(12, Math.round(base * (compact ? 1.02 : 1.08)))
  const metaSize = compact ? 0.78 : 0.88
  let maxNameChars = Math.max(10, Math.floor(paper.nameMax / Math.max(0.75, fontScale)))
  if (compact) maxNameChars = Math.max(8, maxNameChars - 3)

  const wHead = bold ? 800 : 400
  const wTotal = bold ? 800 : 500
  const wName = bold ? 700 : 400
  const wSum = bold ? 700 : 500

  const padY = compact ? '4px' : '6px'
  const padBottom = compact ? '10px' : '14px'
  const itemMargin = compact ? '3px 0 4px' : '5px 0 7px'
  const hrMargin = compact ? '5px 0' : '8px 0'

  // Реквизиты берутся из кэша онбординга, если вызывающий их не передал, —
  // чек не должен остаться без шапки из-за забытого аргумента.
  const fiscal = data?.fiscal ?? readOnboardingCached()
  const lines = Array.isArray(data?.lines) ? data.lines : []
  const items = lines.map((line) => {
    const names = wrapProductName(line.name, maxNameChars)
    const qtyPart = [line.qty, line.unit].filter(Boolean).join(' ')
    const pricePart = line.price ? `${qtyPart} × ${line.price}` : qtyPart
    return `
      <div class="item">
        ${names.map((n, i) => `<div class="item-name${i > 0 ? ' item-name--cont' : ''}">${escHtml(n)}</div>`).join('')}
        <div class="item-meta">
          <span class="item-detail">${escHtml(pricePart)}</span>
          <span class="item-sum">${escHtml(line.sum ?? '')}</span>
        </div>
        ${line.discount ? `<div class="item-discount">Скидка: −${escHtml(line.discount)}</div>` : ''}
      </div>`
  }).join('')

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${width}, initial-scale=1" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: ${width}px;
      max-width: ${width}px;
      overflow: visible;
      background: #fff;
      color: #000;
    }
    body {
      font-family: ${DEFAULT_FONT};
      font-size: ${base}px;
      line-height: ${lineSpacing};
      -webkit-font-smoothing: antialiased;
      text-rendering: geometricPrecision;
    }
    .receipt {
      width: ${width}px;
      max-width: ${width}px;
      padding: ${padY} ${padX}px ${padBottom};
      background: #fff;
      overflow: visible;
    }
    .center { text-align: center; }
    .store {
      font-size: ${storeSize}px;
      font-weight: ${wHead};
      line-height: ${lineSpacing};
      margin: 2px 0 1px;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .small { font-size: ${Math.max(10, Math.round(base * 0.76))}px; line-height: ${lineSpacing}; margin-top: 1px; }
    .hr {
      border: 0;
      border-top: 1px dashed #000;
      margin: ${hrMargin};
      height: 0;
    }
    .hr-solid {
      border: 0;
      border-top: 2px solid #000;
      margin: ${hrMargin};
      height: 0;
    }
    .item { margin: ${itemMargin}; }
    .item-name {
      font-weight: ${wName};
      word-break: break-word;
      overflow-wrap: anywhere;
      hyphens: manual;
      line-height: ${lineSpacing};
    }
    .item-name--cont { margin-top: 1px; }
    .item-meta {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 4px;
      margin-top: 1px;
      font-size: ${metaSize}em;
      line-height: ${lineSpacing};
    }
    .item-detail {
      flex: 1 1 auto;
      min-width: 0;
      word-break: break-word;
    }
    .item-sum {
      flex: 0 0 auto;
      font-weight: ${wSum};
      white-space: nowrap;
      text-align: right;
    }
    .item-discount { font-size: 0.82em; margin-top: 2px; }
    .row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 6px;
      line-height: ${lineSpacing};
    }
    .row > span:first-child { flex: 1 1 auto; min-width: 0; }
    .row > span:last-child {
      flex: 0 0 auto;
      white-space: nowrap;
      text-align: right;
    }
    ${fiscalBlocksCss({ base, lineSpacing, bold })}
    .total-label { font-size: ${totalSize}px; font-weight: ${wTotal}; }
    .total-value { font-size: ${totalSize}px; font-weight: ${wTotal}; }
    .footer {
      margin-top: ${compact ? '6px' : '10px'};
      font-size: ${Math.max(11, Math.round(base * 0.9))}px;
      font-weight: ${wHead};
      text-align: center;
      line-height: ${lineSpacing};
    }
  </style>
</head>
<body>
  <div class="receipt" id="receipt">
    ${fiscalHeaderHtml(fiscal, { cashierName: data?.cashier })}
    <hr class="hr-solid" />
    ${data?.receiptNumber ? `<div class="center"><strong>ЧЕК № ${escHtml(data.receiptNumber)}</strong></div>` : ''}
    <div class="center small">${escHtml(data?.date || '')}</div>
    <hr class="hr" />
    ${items}
    <hr class="hr-solid" />
    ${data?.gross && data?.discount ? `<div class="row"><span>Сумма без скидки</span><span>${escHtml(data.gross)}</span></div><div class="row"><span>Скидка</span><span>−${escHtml(data.discount)}</span></div>` : ''}
    <div class="row"><span class="total-label">ИТОГО</span><span class="total-value">${escHtml(data?.total || '')}</span></div>
    <hr class="hr" />
    ${data?.cash ? `<div class="row"><span>Наличные</span><span>${escHtml(data.cash)}</span></div>` : ''}
    ${data?.change ? `<div class="row"><span>Сдача</span><span>${escHtml(data.change)}</span></div>` : ''}
    <hr class="hr" />
    ${fiscalFooterHtml(fiscal, {
      paymentMethod: data?.paymentMethod,
      fiscalQrImage: data?.fiscalQrImage,
      paymentRef: data?.paymentRef,
      paymentConfirmed: data?.paymentConfirmed,
    })}
    <div class="footer">${escHtml(data?.thankYou || receiptFooterText(fiscal))}</div>
  </div>
</body>
</html>`
}

export function buildPreviewSamplePayload(opts: {
  /** Реквизиты для шапки. Не передали — берём сохранённые. */
  fiscal?: OnboardingData
  cashier?: string
  thankYou?: string
} = {}): ReceiptPrintPayload {
  return {
    fiscal: opts.fiscal ?? readOnboardingCached(),
    receiptNumber: 'ПРЕВЬЮ-001',
    date: new Date().toLocaleString('ru-RU'),
    lines: [
      {
        name: 'Молоко пастеризованное 3.2%',
        qty: '2',
        unit: 'шт',
        price: '89.00',
        sum: '178.00',
      },
      {
        name: 'Хлеб бородинский нарезка тонкая свежий',
        qty: '1',
        unit: 'шт',
        price: '65.00',
        sum: '65.00',
      },
      {
        name: 'Яблоки Голден кг',
        qty: '0.542',
        unit: 'кг',
        price: '120.00',
        sum: '65.04',
      },
    ],
    gross: '318.04 сом',
    discount: '10.00 сом',
    total: '308.04 сом',
    paymentMethod: 'Наличные',
    cash: '350.00 сом',
    change: '41.96 сом',
    cashier: opts.cashier || 'Кассир POS',
    // Подпись не подставляем: пусть шаблон возьмёт её из реквизитов, иначе
    // превью покажет не тот текст, который выйдет на ленте.
    thankYou: opts.thankYou,
  }
}

export function buildPrinterPreviewPayload(
  _printer: PrinterSettings,
  fiscal?: OnboardingData,
): ReceiptPrintPayload {
  return buildPreviewSamplePayload({ fiscal, cashier: 'Кассир POS' })
}

export function buildReceiptBitmapHtml(
  data: ReceiptPrintPayload,
  printer: Partial<PrinterSettings>,
): string {
  const opts = bitmapOptsFromPrinter(printer)
  const paper = resolvePaper(opts)
  return buildReceiptHtml(data, paper, opts)
}
