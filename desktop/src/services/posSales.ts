import { apiPost } from '../api/client'
import {
  computeOrderTotals,
  getLineDiscountAmount,
  getLineNetTotal,
  isAdHocServiceLine,
  isProductCartLine,
  roundMoney2,
  type CartItem,
  type DiscountMode,
  type PaymentDetails,
} from '../right-panel/helpers'

export type SubmitPosSaleInput = {
  items: CartItem[]
  payment: PaymentDetails
  discountMode?: DiscountMode
  discountValue?: string
  shift?: {
    crmShiftId?: string
    cashboxId?: string
    openCash?: number
  }
  clientName?: string
  clientPhone?: string
}

export type SubmitPosSaleResult = {
  saleId: string
  checkout: unknown
  crmShift?: { shiftId: string; cashboxId: string }
  docNumber?: number
}

export function isPosFormatWarm(): boolean {
  return true
}

export async function warmupPosFormats(_probe?: unknown, _signal?: AbortSignal): Promise<void> {
  /* Local backend — no CRM format probing. */
}

export async function submitPosSale(input: SubmitPosSaleInput): Promise<SubmitPosSaleResult> {
  const lines = input.items.filter(isProductCartLine)
  if (lines.length === 0) throw new Error('Нет товаров для продажи')

  const totals = computeOrderTotals(
    lines,
    input.discountMode ?? 'percent',
    input.discountValue ?? '0',
  )

  const items = lines.map((line) => {
    const qty = line.type === 'weight' ? line.weightKg : line.quantity
    return {
      product_id: isAdHocServiceLine(line) ? null : Number.parseInt(line.productId, 10) || null,
      name: line.name,
      is_weight: line.type === 'weight',
      is_service: isAdHocServiceLine(line),
      quantity: qty,
      unit_price: roundMoney2(line.price),
      discount: getLineDiscountAmount(line),
      line_total: getLineNetTotal(line),
    }
  })

  const body = {
    items,
    payment_method: input.payment.method,
    subtotal: totals.subtotalGross,
    discount_total: totals.discountTotal,
    total: totals.total,
    cash_received: input.payment.cashReceived ?? 0,
    card_amount: input.payment.cardAmount ?? 0,
    change_amount: input.payment.change ?? 0,
    client_name: input.clientName ?? '',
    client_phone: input.clientPhone ?? '',
    // Через какой провайдер прошла оплата и кто её подтвердил. Ручные
    // подтверждения владелец потом смотрит отдельным отчётом.
    payment_provider: input.payment.providerId ?? '',
    payment_provider_title: input.payment.providerTitle ?? '',
    payment_ref: input.payment.paymentRef ?? '',
    payment_confirmation: input.payment.paymentConfirmation ?? 'manual',
  }

  const res = await apiPost('/api/sales', body)
  const sale = res.data as { id: number; doc_number: number; shift_id?: number }
  return {
    saleId: String(sale.id),
    checkout: res.data,
    docNumber: sale.doc_number,
    crmShift: sale.shift_id
      ? { shiftId: String(sale.shift_id), cashboxId: 'local' }
      : undefined,
  }
}

export async function ensurePosReady(signal?: AbortSignal): Promise<void> {
  void signal
}
