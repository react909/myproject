import {
  computeOrderTotals,
  isProductCartLine,
  type CartItem,
  type DiscountMode,
  type PaymentDetails,
} from '../right-panel/helpers'
import type { Receipt } from '../pages/Receipts/types'

const LOCAL_SALES_KEY = 'nurcrm-local-sales'

function makeId(): string {
  return crypto.randomUUID?.() ?? `local-${Date.now()}`
}

export function loadLocalReceipts(): Receipt[] {
  try {
    const raw = localStorage.getItem(LOCAL_SALES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as Receipt[] : []
  } catch {
    return []
  }
}

export function clearLocalReceipts(): void {
  localStorage.removeItem(LOCAL_SALES_KEY)
  window.dispatchEvent(new CustomEvent('nurcrm-local-sales'))
}

export function refundLocalReceipt(receiptId: string, itemIds: string[]): boolean {
  const receipts = loadLocalReceipts()
  const index = receipts.findIndex((receipt) => receipt.id === receiptId)
  if (index < 0) return false
  const receipt = receipts[index]!
  const all = itemIds.length === receipt.items.length
  receipts[index] = {
    ...receipt,
    status: all ? 'refunded' : 'partial_refund',
    items: receipt.items.map((item) =>
      itemIds.includes(item.id) ? { ...item, refunded: true } : item,
    ),
  }
  localStorage.setItem(LOCAL_SALES_KEY, JSON.stringify(receipts))
  window.dispatchEvent(new CustomEvent('nurcrm-local-sales'))
  return true
}

export function saveLocalReceipt(
  items: CartItem[],
  payment: PaymentDetails,
  cashier: string,
  discountMode: DiscountMode,
  discountValue: string,
): Receipt {
  const lines = items.filter(isProductCartLine)
  const totals = computeOrderTotals(lines, discountMode, discountValue)
  const now = new Date()
  const receipt: Receipt = {
    id: makeId(),
    number: `LOCAL-${now.getTime()}`,
    date: now.toLocaleDateString('ru-RU'),
    time: now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    cashier,
    items: lines.map((line) => {
      const quantity = line.type === 'weight' ? line.weightKg : line.quantity
      const total = line.type === 'weight' ? line.price * line.weightKg : line.price * line.quantity
      return {
        id: line.lineId,
        name: line.name,
        quantity,
        price: line.price,
        purchasePrice: line.purchasePrice,
        total: Math.round(total * 100) / 100,
        isWeight: line.type === 'weight',
      }
    }),
    subtotal: totals.subtotalGross,
    discount: totals.discountTotal,
    total: totals.total,
    paymentMethod: payment.method,
    status: 'completed',
    cashGiven: payment.cashReceived,
    change: payment.change,
  }
  const next = [receipt, ...loadLocalReceipts()].slice(0, 1000)
  localStorage.setItem(LOCAL_SALES_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('nurcrm-local-sales'))
  return receipt
}
