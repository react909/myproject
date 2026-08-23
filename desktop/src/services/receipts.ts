import { apiGet, apiPost } from '../api/client'
import { invalidateMemoryCache } from './requestCache'
import type {
  PaymentMethod,
  Receipt,
  ReceiptItem,
  ReceiptStatus,
  RefundLineSelection,
} from '../pages/Receipts/types'

type ApiSaleItem = {
  id: number
  product_id: number | null
  name: string
  is_weight: boolean
  is_service: boolean
  quantity: number
  unit_price: number
  discount: number
  line_total: number
}

type ApiSale = {
  id: number
  doc_number: number
  status: string
  payment_method: string
  subtotal: number
  discount_total: number
  total: number
  cash_received: number
  card_amount: number
  change_amount: number
  debt_balance: number
  client_name: string
  cashier_name: string
  created_at: string
  paid_at: string | null
  items?: ApiSaleItem[]
}

function mapStatus(status: string): ReceiptStatus {
  if (status === 'debt') return 'debt'
  if (status === 'canceled') return 'canceled'
  if (status === 'refunded') return 'refunded'
  if (status === 'partial_refund') return 'partial_refund'
  return 'completed'
}

function mapPayment(method: string): PaymentMethod {
  if (method === 'card' || method === 'transfer') return 'card'
  if (method === 'mixed') return 'mixed'
  if (method === 'debt') return 'debt'
  return 'cash'
}

function mapSale(sale: ApiSale): Receipt {
  const created = sale.created_at ? new Date(sale.created_at) : new Date()
  const date = Number.isNaN(created.getTime())
    ? ''
    : created.toLocaleDateString('ru-RU')
  const time = Number.isNaN(created.getTime())
    ? ''
    : created.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

  const items: ReceiptItem[] = (sale.items ?? []).map((item) => ({
    id: String(item.id),
    name: item.name,
    quantity: item.quantity,
    price: item.unit_price,
    total: item.line_total,
    isWeight: item.is_weight,
  }))

  return {
    id: String(sale.id),
    number: String(sale.doc_number),
    date,
    time,
    cashier: sale.cashier_name || 'Кассир',
    items,
    subtotal: sale.subtotal,
    discount: sale.discount_total,
    total: sale.total,
    paymentMethod: mapPayment(sale.payment_method),
    status: mapStatus(sale.status),
    cashGiven: sale.cash_received || undefined,
    change: sale.change_amount || undefined,
    customerName: sale.client_name || undefined,
  }
}

export function invalidateReceiptsCache(): void {
  invalidateMemoryCache('receipts:')
}

/** Столько чеков отдаёт `/api/sales` за раз — жёсткий предел на сервере. */
export const RECEIPTS_MAX_LIMIT = 500

/**
 * Чеки списком. Необязательный период отсекается НА СЕРВЕРЕ.
 *
 * Почему предел зажат здесь. Отчёт товаров просил `limit=1000`, а
 * `/api/sales` объявлен как `Query(default=100, le=500)` — сервер отвечал 422,
 * и страница отчёта не открывалась вовсе: вместо таблицы крутился загрузчик с
 * подписью «Request failed with status code 422». Ошибка тихая: 422 приходил на
 * фоновой загрузке, и понять, что число в вызове больше серверного потолка,
 * можно было только заглянув в оба файла разом.
 *
 * Число теперь одно на обе стороны, и просить больше потолка нельзя по
 * построению. Поднимать потолок на сервере не стали: это чужая ручка кассы,
 * её трогать нельзя.
 *
 * Период передаём серверу, а не отбираем потом на своей стороне: иначе пятьсот
 * чеков набираются с конца всей истории, и на отчёт за прошлый месяц не
 * попадает ни одного.
 */
export async function fetchReceipts(
  limit = 200,
  signal?: AbortSignal,
  range?: { from: string; to: string },
): Promise<Receipt[]> {
  const params = new URLSearchParams({ limit: String(Math.min(limit, RECEIPTS_MAX_LIMIT)) })
  // Границы суток, а не голые даты: `date_to=2026-08-22` на сервере станет
  // полуночью, и весь сегодняшний день выпадет из отчёта.
  if (range?.from) params.set('date_from', `${range.from}T00:00:00`)
  if (range?.to) params.set('date_to', `${range.to}T23:59:59`)
  const res = await apiGet(`/api/sales?${params.toString()}`, { signal })
  const list = Array.isArray(res.data) ? (res.data as ApiSale[]) : []
  return list.map(mapSale)
}

export async function fetchReceiptDetails(receipt: Receipt, signal?: AbortSignal): Promise<Receipt> {
  if (receipt.items.length > 0) return receipt
  const res = await apiGet(`/api/sales/${encodeURIComponent(receipt.id)}`, { signal })
  return mapSale(res.data as ApiSale)
}

export async function refundReceipt(
  receipt: Receipt,
  lines: RefundLineSelection[],
  note = '',
): Promise<Receipt> {
  const res = await apiPost(`/api/sales/${encodeURIComponent(receipt.id)}/refund`, {
    items: lines.map((l) => ({
      sale_item_id: Number.parseInt(l.itemId, 10),
      quantity: l.quantity,
    })),
    note,
  })
  invalidateReceiptsCache()
  return mapSale(res.data as ApiSale)
}
