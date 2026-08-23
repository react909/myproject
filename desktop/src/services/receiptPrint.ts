import { loadSettings } from '../settings/appSettings'
import { readOnboardingCached } from '../onboarding/storage'
import { printReceipt } from './devices/device.client'
import type { ReceiptPrintPayload as TemplatePayload } from '../receipt/receiptTemplate'
import type { Receipt } from '../pages/Receipts/types'
import type { CartItem } from '../right-panel/helpers'
import { formatMoney, getLineDiscountAmount, getLineNetTotal, isProductCartLine } from '../right-panel/helpers'
import type { CrmShiftSummary } from './posShift'

export type ReceiptPrintPayload = TemplatePayload

function paymentLabel(method?: string): string {
  if (method === 'card') return 'Карта'
  if (method === 'mixed') return 'Смешанная'
  if (method === 'debt') return 'В долг'
  return 'Наличные'
}

export function cartLinesToPrintPayload(
  lines: CartItem[],
  opts: {
    cashier: string
    total: number
    discountTotal?: number
    date?: string
    thankYou?: string
    paymentMethod?: string
    storeName?: string
    cashReceived?: number
    change?: number
    /** Референс платежа в банке — печатается в фискальном чеке. */
    paymentRef?: string
    /** Подтвердил ли оплату банк, а не кассир глазами. */
    paymentConfirmed?: boolean
  },
): ReceiptPrintPayload {
  const fiscal = readOnboardingCached()
  const products = lines.filter(isProductCartLine)
  const gross = products.reduce((s, l) => s + getLineGrossSafe(l), 0)
  const discountTotal = opts.discountTotal ?? 0
  const method = opts.paymentMethod ?? 'Наличные'
  const showCash = method.includes('Налич') || method === 'Смешанная'
  return {
    fiscal,
    lines: products.map((l) => {
      const lineDiscount = getLineDiscountAmount(l)
      const net = getLineNetTotal(l)
      return {
        name: l.name,
        qty: l.type === 'weight' ? l.weightKg.toFixed(3) : String(l.quantity),
        unit: l.type === 'weight' ? 'кг' : 'шт',
        price: formatMoney(l.price),
        sum: formatMoney(net),
        discount: lineDiscount > 0 ? `${formatMoney(lineDiscount)} сом` : undefined,
      }
    }),
    gross: discountTotal > 0 ? `${formatMoney(gross)} сом` : undefined,
    total: `${formatMoney(opts.total)} сом`,
    discount:
      discountTotal > 0 ? `${formatMoney(discountTotal)} сом` : undefined,
    paymentMethod: method,
    cash:
      showCash && opts.cashReceived != null && opts.cashReceived > 0
        ? `${formatMoney(opts.cashReceived)} сом`
        : undefined,
    change:
      showCash && opts.change != null && opts.change > 0
        ? `${formatMoney(opts.change)} сом`
        : undefined,
    cashier: opts.cashier,
    date: opts.date ?? new Date().toLocaleString('ru-RU'),
    paymentRef: opts.paymentRef,
    paymentConfirmed: opts.paymentConfirmed,
    // Подпись не подставляем: её задаёт владелец в реквизитах, и шаблон сам
    // возьмёт оттуда. Хардкод здесь перебивал бы настройку.
    thankYou: opts.thankYou,
  }
}

function getLineGrossSafe(l: CartItem): number {
  if (l.isGroupHeader) return 0
  const raw = l.type === 'piece' ? l.price * l.quantity : l.price * l.weightKg
  return Math.round(raw * 100) / 100
}

export function historyReceiptToPrintPayload(receipt: Receipt): ReceiptPrintPayload {
  const fiscal = readOnboardingCached()
  const method = paymentLabel(receipt.paymentMethod)
  const showCash = receipt.paymentMethod === 'cash' || receipt.paymentMethod === 'mixed'
  return {
    fiscal,
    lines: receipt.items.map((item) => ({
      name: item.name,
      qty: item.isWeight
        ? `${item.quantity.toFixed(3)}`
        : `${Math.round(item.quantity)}`,
      unit: item.isWeight ? 'кг' : 'шт',
      price: formatMoney(item.price),
      sum: formatMoney(item.total),
    })),
    total: `${formatMoney(receipt.total)} сом`,
    discount:
      receipt.discount > 0 ? `${formatMoney(receipt.discount)} сом` : undefined,
    paymentMethod: method,
    cash:
      showCash && receipt.cashGiven != null && receipt.cashGiven > 0
        ? `${formatMoney(receipt.cashGiven)} сом`
        : undefined,
    change:
      showCash && receipt.change != null && receipt.change > 0
        ? `${formatMoney(receipt.change)} сом`
        : undefined,
    cashier: receipt.cashier,
    date: `${receipt.date} ${receipt.time}`,
    thankYou: `Дубликат · ${receipt.number}`,
  }
}

export function buildShiftCloseReceiptPayload(
  summary: {
    cashier: string
    openedAt?: string
    closedAt: string
    openCash: number
    closeCash: number
    salesCount: number
    salesTotal: number
    cashboxName?: string
  },
): ReceiptPrintPayload {
  const fiscal = readOnboardingCached()
  const fmt = (n: number) => `${formatMoney(n)} сом`
  return {
    fiscal,
    receiptNumber: 'Z-ОТЧЁТ',
    date: new Date(summary.closedAt).toLocaleString('ru-RU'),
    lines: [
      { name: 'Открытие смены', sum: fmt(summary.openCash) },
      { name: 'Продаж (чеков)', sum: String(summary.salesCount) },
      { name: 'Выручка за смену', sum: fmt(summary.salesTotal) },
      { name: 'В кассе при закрытии', sum: fmt(summary.closeCash) },
      ...(summary.cashboxName
        ? [{ name: 'Касса', sum: summary.cashboxName }]
        : []),
    ],
    total: fmt(summary.salesTotal),
    paymentMethod: 'Закрытие смены',
    cashier: summary.cashier,
    thankYou: summary.openedAt
      ? `Смена: ${new Date(summary.openedAt).toLocaleString('ru-RU')}`
      : 'Смена закрыта',
  }
}

export function shiftSummaryToClosePayload(
  shift: CrmShiftSummary,
  cashier: string,
  closeCash: number,
  openedAt?: string,
  closedAt?: string,
): ReceiptPrintPayload {
  return buildShiftCloseReceiptPayload({
    cashier,
    openedAt,
    closedAt: closedAt ?? new Date().toISOString(),
    openCash: shift.openingCash,
    closeCash,
    salesCount: shift.salesCount,
    salesTotal: shift.salesTotal,
    cashboxName: shift.cashboxName,
  })
}

/**
 * Отчёт смены из раздела «Смена» — промежуточный (X) или итоговый (Z).
 *
 * Отдельно от `buildShiftCloseReceiptPayload`, который печатает касса: тот
 * знает четыре числа, а здесь их полтора десятка — разбивка по способам
 * оплаты, движения по ящику, сверка и расхождение. Дополнять кассовый payload
 * значило бы менять то, что печатается при закрытии смены с кассы.
 *
 * Суммы приходят целыми тыйынами и делятся на сто ровно здесь, в момент
 * печати. Внутрь раздела сомы не попадают.
 */
export function buildShiftDeskReportPayload(report: {
  kind: 'x' | 'z'
  number: number
  cashier: string
  openedAt: string
  closedAt: string | null
  openCashTiyin: number
  expectedCashTiyin: number
  countedCashTiyin: number
  varianceTiyin: number
  varianceReason: string
  reconciled: boolean
  salesCount: number
  refundsCount: number
  revenueTiyin: number
  cashTiyin: number
  cardTiyin: number
  qrTiyin: number
  debtTiyin: number
  refundsTiyin: number
  discountsTiyin: number
  depositsTiyin: number
  withdrawalsTiyin: number
  printedAt: string
  printedBy: string
}): ReceiptPrintPayload {
  const fiscal = readOnboardingCached()
  const fmt = (tiyin: number) => `${formatMoney(tiyin / 100)} сом`
  const lines: { name: string; sum: string }[] = [
    { name: 'Смена №', sum: String(report.number) },
    { name: 'Кассир', sum: report.cashier || '—' },
    { name: 'Открыта', sum: new Date(report.openedAt).toLocaleString('ru-RU') },
    { name: 'Размен', sum: fmt(report.openCashTiyin) },
    { name: '— Продажи —', sum: '' },
    { name: 'Чеков продажи', sum: String(report.salesCount) },
    { name: 'Чеков возврата', sum: String(report.refundsCount) },
    { name: 'Выручка', sum: fmt(report.revenueTiyin) },
    { name: 'Наличные', sum: fmt(report.cashTiyin) },
    { name: 'Карта', sum: fmt(report.cardTiyin) },
    { name: 'QR', sum: fmt(report.qrTiyin) },
    { name: 'В долг', sum: fmt(report.debtTiyin) },
    { name: 'Возвраты', sum: fmt(report.refundsTiyin) },
  ]
  // Скидки печатаются, только если они были: строка «Скидки 0,00 сом» в
  // отчёте — это шум, за которым теряются числа, которые смотрят.
  if (report.discountsTiyin > 0) {
    lines.push({ name: 'Скидки', sum: fmt(report.discountsTiyin) })
  }
  lines.push({ name: '— Ящик —', sum: '' })
  lines.push({ name: 'Внесения', sum: fmt(report.depositsTiyin) })
  lines.push({ name: 'Изъятия', sum: fmt(report.withdrawalsTiyin) })
  lines.push({ name: 'Расчётный остаток', sum: fmt(report.expectedCashTiyin) })

  if (report.kind === 'z' && report.reconciled) {
    lines.push({ name: '— Сверка —', sum: '' })
    lines.push({ name: 'Фактически', sum: fmt(report.countedCashTiyin) })
    lines.push({
      name: report.varianceTiyin < 0 ? 'НЕДОСТАЧА' : report.varianceTiyin > 0 ? 'ИЗЛИШЕК' : 'Расхождение',
      sum: fmt(Math.abs(report.varianceTiyin)),
    })
    if (report.varianceReason) {
      lines.push({ name: 'Причина', sum: report.varianceReason })
    }
  }

  return {
    fiscal,
    receiptNumber: report.kind === 'z' ? 'Z-ОТЧЁТ' : 'X-ОТЧЁТ',
    date: new Date(report.printedAt).toLocaleString('ru-RU'),
    lines,
    total: fmt(report.revenueTiyin),
    paymentMethod: report.kind === 'z' ? 'Закрытие смены' : 'Промежуточный отчёт',
    cashier: report.printedBy,
    thankYou:
      report.kind === 'z'
        ? `Смена закрыта ${report.closedAt ? new Date(report.closedAt).toLocaleString('ru-RU') : ''}`
        : 'Смена продолжается',
  }
}

/**
 * Чек на внесение или изъятие наличных.
 *
 * Печатается сразу после операции, если печать включена: деньги вынули из
 * ящика, и бумажный след этого — единственное, что отличает инкассацию от
 * пропажи.
 */
export function buildCashMovementPayload(movement: {
  kind: 'deposit' | 'withdrawal'
  amountTiyin: number
  reason: string
  comment: string
  actorName: string
  cashier: string
  shiftNumber: number
  balanceTiyin: number
}): ReceiptPrintPayload {
  const fiscal = readOnboardingCached()
  const fmt = (tiyin: number) => `${formatMoney(tiyin / 100)} сом`
  const deposit = movement.kind === 'deposit'
  return {
    fiscal,
    receiptNumber: deposit ? 'ВНЕСЕНИЕ' : 'ИЗЪЯТИЕ',
    date: new Date().toLocaleString('ru-RU'),
    lines: [
      { name: 'Смена №', sum: String(movement.shiftNumber) },
      { name: 'Сумма', sum: fmt(movement.amountTiyin) },
      { name: 'Причина', sum: movement.reason || '—' },
      ...(movement.comment ? [{ name: 'Комментарий', sum: movement.comment }] : []),
      ...(movement.actorName ? [{ name: 'Принял', sum: movement.actorName }] : []),
      { name: 'Остаток в ящике', sum: fmt(movement.balanceTiyin) },
    ],
    total: fmt(movement.amountTiyin),
    paymentMethod: deposit ? 'Внесение наличных' : 'Изъятие наличных',
    cashier: movement.cashier,
    thankYou: deposit ? 'Внесено в кассу' : 'Изъято из кассы',
  }
}

export async function printShiftCloseReceipt(payload: ReceiptPrintPayload) {
  const settings = loadSettings()
  if (!settings.printer.enabled) {
    return { ok: false, message: 'Принтер отключён' }
  }
  try {
    return await printReceipt(payload, settings)
  } catch (err: any) {
    return { ok: false, message: err?.message ?? 'Ошибка печати Z-отчёта' }
  }
}

export async function printDuplicateReceipt(receipt: Receipt) {
  const settings = loadSettings()
  if (!settings.printer.enabled) {
    return { ok: false, message: 'Включите принтер в Настройках → Печать чеков' }
  }
  try {
    return await printReceipt(historyReceiptToPrintPayload(receipt), settings)
  } catch (err: any) {
    return { ok: false, message: err?.message ?? 'Ошибка печати' }
  }
}

export async function printCartReceipt(
  lines: CartItem[],
  opts: {
    cashier: string
    total: number
    discountTotal?: number
    paymentMethod?: string
    cashReceived?: number
    change?: number
  },
) {
  const settings = loadSettings()
  if (!settings.printer.enabled) {
    return { ok: false, message: 'Принтер отключён в настройках' }
  }
  try {
    return await printReceipt(cartLinesToPrintPayload(lines, opts), settings)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Ошибка печати'
    return { ok: false, message: msg }
  }
}

export async function printDebtPaymentReceipt(opts: {
  clientName: string
  phone?: string
  debtNumber: string
  paidAmount: number
  remainingBalance: number
  method: 'cash' | 'card'
  cashReceived?: number
  change?: number
  cashier: string
}) {
  const settings = loadSettings()
  if (!settings.printer.enabled) {
    return { ok: false, message: 'Принтер отключён в настройках' }
  }
    const fiscal = readOnboardingCached()
  const methodLabel = opts.method === 'card' ? 'Безнал' : 'Наличные'
  const payload: ReceiptPrintPayload = {
    fiscal,
    receiptNumber: `ДОЛГ ${opts.debtNumber}`,
    date: new Date().toLocaleString('ru-RU'),
    lines: [
      {
        name: `Погашение долга · ${opts.clientName}`,
        sum: `${formatMoney(opts.paidAmount)} сом`,
      },
      ...(opts.phone ? [{ name: `Телефон: ${opts.phone}`, sum: '' }] : []),
      ...(opts.remainingBalance > 0.01
        ? [{ name: 'Остаток долга', sum: `${formatMoney(opts.remainingBalance)} сом` }]
        : []),
    ],
    total: `${formatMoney(opts.paidAmount)} сом`,
    paymentMethod: methodLabel,
    cash:
      opts.method === 'cash' && opts.cashReceived != null && opts.cashReceived > 0
        ? `${formatMoney(opts.cashReceived)} сом`
        : undefined,
    change:
      opts.method === 'cash' && opts.change != null && opts.change > 0
        ? `${formatMoney(opts.change)} сом`
        : undefined,
    cashier: opts.cashier,
    thankYou: opts.remainingBalance > 0.01 ? 'Частичное погашение долга' : 'Долг погашен полностью',
  }
  try {
    return await printReceipt(payload, settings)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Ошибка печати'
    return { ok: false, message: msg }
  }
}
