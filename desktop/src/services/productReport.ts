import { fetchReceiptDetails, fetchReceipts, RECEIPTS_MAX_LIMIT } from './receipts'
import { fetchProducts } from './products'
import { getProductStock, type Product } from '../catalog/mockProducts'
import type { PanelProductKind } from '../pages/panel/PanelProductFilterContext'
import type { Receipt, ReceiptItem } from '../pages/Receipts/types'

export type ProductReportPeriod = 'today' | '7days' | 'month' | 'year' | 'custom'

export type ProductReportRow = {
  name: string
  kind: 'weight' | 'piece'
  sold: number
  returned: number
  revenue: number
  refundAmount: number
  cost: number
  profit: number
  stock?: number
  cashiers: Set<string>
}

export type ProductSaleLine = {
  receipt: Receipt
  item: ReceiptItem
}

export async function mapLimited<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      out[index] = await mapper(items[index]!)
    }
  })
  await Promise.all(workers)
  return out
}

export function localDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function reportPeriodRange(
  period: ProductReportPeriod,
  from = '',
  to = '',
): { from: string; to: string } {
  const end = new Date()
  const start = new Date(end)
  if (period === 'today') start.setHours(0, 0, 0, 0)
  else if (period === '7days') {
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
  } else if (period === 'month') {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  } else if (period === 'year') {
    start.setFullYear(start.getFullYear() - 1)
    start.setHours(0, 0, 0, 0)
  } else {
    return { from: from || localDate(start), to: to || localDate(end) }
  }
  return { from: localDate(start), to: localDate(end) }
}

function receiptDate(receipt: Receipt): Date {
  const [day = '1', month = '1', year = '1970'] = receipt.date.split('.')
  const parsed = new Date(`${year}-${month}-${day}T${receipt.time || '00:00'}:00`)
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed
}

export function receiptInRange(receipt: Receipt, from: string, to: string): boolean {
  const d = receiptDate(receipt)
  return d >= new Date(`${from}T00:00:00`) && d <= new Date(`${to}T23:59:59`)
}

export async function fetchReceiptsInRange(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<Receipt[]> {
  // Период уходит на сервер; повторная проверка на своей стороне остаётся —
  // границы суток считаются по местному времени, и чек, попавший в выборку по
  // краю, здесь отсекается по тому же правилу, что и раньше.
  const list = await fetchReceipts(RECEIPTS_MAX_LIMIT, signal, { from, to })
  const inRange = list.filter((r) => receiptInRange(r, from, to))
  return mapLimited(inRange, 10, (r) =>
    r.items.length > 0 ? Promise.resolve(r) : fetchReceiptDetails(r),
  )
}

export function buildProductRows(
  products: Product[],
  receipts: Receipt[],
  kind: PanelProductKind,
  query = '',
): ProductReportRow[] {
  const productByName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]))
  const map = new Map<string, ProductReportRow>()

  for (const p of products) {
    if (kind !== 'all' && kind !== p.type) continue
    map.set(p.name.trim().toLowerCase(), {
      name: p.name,
      kind: p.type,
      sold: 0,
      returned: 0,
      revenue: 0,
      refundAmount: 0,
      cost: 0,
      profit: 0,
      stock: getProductStock(p),
      cashiers: new Set<string>(),
    })
  }

  for (const receipt of receipts) {
    for (const item of receipt.items) {
      const itemKind = item.isWeight ? 'weight' : 'piece'
      if (kind !== 'all' && kind !== itemKind) continue
      const key = item.name.trim().toLowerCase()
      const catalog = productByName.get(key)
      const row = map.get(key) ?? {
        name: item.name,
        kind: itemKind,
        sold: 0,
        returned: 0,
        revenue: 0,
        refundAmount: 0,
        cost: 0,
        profit: 0,
        stock: catalog ? getProductStock(catalog) : undefined,
        cashiers: new Set<string>(),
      }
      const cost = (item.purchasePrice ?? catalog?.purchasePrice ?? 0) * item.quantity
      const returnedQty =
        item.refundedQuantity ?? (item.refunded || receipt.status === 'refunded' ? item.quantity : 0)
      const returnedAmount =
        returnedQty > 0 ? (item.total / Math.max(item.quantity, 1)) * returnedQty : 0
      if (receipt.status === 'completed' || receipt.status === 'partial_refund') {
        row.sold = Math.round((row.sold + item.quantity) * 1000) / 1000
        row.revenue = Math.round(row.revenue + item.total)
        row.cost = Math.round(row.cost + cost)
      }
      if (returnedQty > 0 || receipt.status === 'refunded') {
        row.returned = Math.round((row.returned + returnedQty) * 1000) / 1000
        row.refundAmount = Math.round(row.refundAmount + returnedAmount)
      }
      row.profit = row.revenue - row.cost
      row.cashiers.add(receipt.cashier)
      map.set(key, row)
    }
  }

  const needle = query.trim().toLowerCase()
  return Array.from(map.values())
    .filter((r) => r.revenue > 0 || r.sold > 0)
    .filter((r) => !needle || r.name.toLowerCase().includes(needle))
    .sort((a, b) => b.revenue - a.revenue)
}

export async function fetchProductSaleLines(
  productName: string,
  from: string,
  to: string,
  kind: PanelProductKind,
  signal?: AbortSignal,
): Promise<ProductSaleLine[]> {
  const receipts = await fetchReceiptsInRange(from, to, signal)
  const needle = productName.trim().toLowerCase()
  const lines: ProductSaleLine[] = []
  for (const receipt of receipts) {
    for (const item of receipt.items) {
      const itemKind = item.isWeight ? 'weight' : 'piece'
      if (kind !== 'all' && kind !== itemKind) continue
      if (item.name.trim().toLowerCase() === needle) {
        lines.push({ receipt, item })
      }
    }
  }
  return lines.sort(
    (a, b) => receiptDate(b.receipt).getTime() - receiptDate(a.receipt).getTime(),
  )
}

export async function loadProductReport(
  period: ProductReportPeriod,
  kind: PanelProductKind,
  from = '',
  to = '',
  signal?: AbortSignal,
): Promise<{ rows: ProductReportRow[]; range: { from: string; to: string } }> {
  const range = reportPeriodRange(period, from, to)
  const [products, receipts] = await Promise.all([
    fetchProducts(signal),
    fetchReceiptsInRange(range.from, range.to, signal),
  ])
  return { rows: buildProductRows(products, receipts, kind), range }
}
