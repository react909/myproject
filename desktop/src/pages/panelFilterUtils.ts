import type { PanelProductKind } from './panel/PanelProductFilterContext'
import type { Receipt } from './Receipts/types'

export function filterProductsByKind<T extends { kind: 'weight' | 'piece' }>(
  products: T[],
  kind: PanelProductKind,
): T[] {
  if (kind === 'all') return products
  return products.filter((p) => p.kind === kind)
}

export function sumProductRevenue(products: { revenue: number }[]): number {
  return products.reduce((s, p) => s + p.revenue, 0)
}

export function receiptMatchesProductKind(
  receipt: Receipt,
  kind: PanelProductKind,
): boolean {
  if (kind === 'all') return true
  if (kind === 'weight') return receipt.items.some((i) => i.isWeight)
  return receipt.items.some((i) => !i.isWeight)
}

/** Выручка чека с учётом фильтра (только строки выбранного типа). */
export function receiptRevenueForKind(
  receipt: Receipt,
  kind: PanelProductKind,
): number {
  if (receipt.status !== 'completed') return 0
  if (kind === 'all') return receipt.total
  const items = receipt.items.filter((i) =>
    kind === 'weight' ? i.isWeight : !i.isWeight,
  )
  if (items.length === 0) return 0
  const itemSum = items.reduce((s, i) => s + i.total, 0)
  if (receipt.subtotal <= 0) return itemSum
  return Math.round(receipt.total * (itemSum / receipt.subtotal))
}
