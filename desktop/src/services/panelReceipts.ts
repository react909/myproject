/**
 * Журнал чеков панели — обмен с сервером.
 *
 * Фильтрация, сортировка и разбиение на страницы здесь не делаются вовсе: всё
 * это на сервере. Прежний журнал тянул триста последних чеков и фильтровал их
 * в браузере — и цифры над таблицей относились не к фильтру, а к тому, что
 * успело приехать. Найти чек полугодовой давности было нельзя ни одним
 * фильтром: его просто не было в загруженных трёхстах.
 */

import { apiGet } from '../api/client'
import type { Receipt as LegacyReceipt } from '../pages/Receipts/types'

export type PanelReceiptStatus = 'paid' | 'debt' | 'canceled' | 'refunded' | 'partial_refund'
export type PanelPaymentMethod = 'cash' | 'card' | 'mixed' | 'debt'
export type PanelProductKind = 'all' | 'weight' | 'piece'
export type PanelSort = 'created_at' | 'doc_number' | 'total'

/** Строка журнала. Позиции сюда не входят — они приезжают в карточке чека. */
export type PanelReceiptRow = {
  id: number
  docNumber: number
  status: PanelReceiptStatus
  paymentMethod: PanelPaymentMethod
  total: number
  discountTotal: number
  debtBalance: number
  clientName: string
  cashierName: string
  createdAt: Date
}

export type PanelReceiptItem = {
  id: number
  name: string
  isWeight: boolean
  quantity: number
  unitPrice: number
  discount: number
  lineTotal: number
}

export type PanelReceiptDetails = PanelReceiptRow & {
  subtotal: number
  cashReceived: number
  cardAmount: number
  changeAmount: number
  clientPhone: string
  paidAt: Date | null
  items: PanelReceiptItem[]
}

export type PanelReceiptsSummary = {
  receiptsCount: number
  revenue: number
  refunds: number
  avgCheck: number
}

/**
 * Фильтры журнала.
 *
 * Ровно те же поля, что понимает сервер. Промежуточного слоя, который бы
 * что-то досчитывал на клиенте, нет и быть не должно: разойдясь, они дали бы
 * таблицу по одному условию и сумму по другому.
 */
export type PanelReceiptsQuery = {
  dateFrom?: string
  dateTo?: string
  docNumber?: string
  client?: string
  product?: string
  cashier?: string
  status?: PanelReceiptStatus | ''
  paymentMethod?: PanelPaymentMethod | ''
  productKind?: PanelProductKind
  sort?: PanelSort
  direction?: 'asc' | 'desc'
}

type ApiRow = {
  id: number
  doc_number: number
  status: string
  payment_method: string
  total: number
  discount_total: number
  debt_balance: number
  client_name: string
  cashier_name: string
  created_at: string
}

function mapRow(row: ApiRow): PanelReceiptRow {
  return {
    id: row.id,
    docNumber: row.doc_number,
    status: row.status as PanelReceiptStatus,
    paymentMethod: row.payment_method as PanelPaymentMethod,
    total: row.total,
    discountTotal: row.discount_total,
    debtBalance: row.debt_balance,
    clientName: row.client_name,
    cashierName: row.cashier_name,
    createdAt: new Date(row.created_at),
  }
}

/** Непустые фильтры в параметры запроса. Пустые не отправляются вовсе. */
function toParams(query: PanelReceiptsQuery): URLSearchParams {
  const params = new URLSearchParams()
  const pairs: [string, string | undefined][] = [
    ['date_from', query.dateFrom],
    ['date_to', query.dateTo],
    ['doc_number', query.docNumber],
    ['client', query.client],
    ['product', query.product],
    ['cashier', query.cashier],
    ['status', query.status],
    ['payment_method', query.paymentMethod],
  ]
  for (const [key, value] of pairs) {
    if (value) params.set(key, value)
  }
  if (query.productKind && query.productKind !== 'all') {
    params.set('product_kind', query.productKind)
  }
  if (query.sort) params.set('sort', query.sort)
  if (query.direction) params.set('direction', query.direction)
  return params
}

export type PanelReceiptsPage = {
  rows: PanelReceiptRow[]
  /** Передаётся в следующий запрос. `null` — список кончился. */
  nextCursor: string | null
}

export async function fetchPanelReceipts(
  query: PanelReceiptsQuery,
  options: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {},
): Promise<PanelReceiptsPage> {
  const params = toParams(query)
  if (options.cursor) params.set('cursor', options.cursor)
  params.set('limit', String(options.limit ?? 50))

  const res = await apiGet(`/api/panel/receipts?${params.toString()}`, { signal: options.signal })
  const rows: ApiRow[] = Array.isArray(res.data?.rows) ? res.data.rows : []
  return { rows: rows.map(mapRow), nextCursor: res.data?.next_cursor ?? null }
}

export async function fetchPanelSummary(
  query: PanelReceiptsQuery,
  signal?: AbortSignal,
): Promise<PanelReceiptsSummary> {
  const res = await apiGet(`/api/panel/receipts/summary?${toParams(query).toString()}`, { signal })
  const data = res.data ?? {}
  return {
    receiptsCount: Number(data.receipts_count) || 0,
    revenue: Number(data.revenue) || 0,
    refunds: Number(data.refunds) || 0,
    avgCheck: Number(data.avg_check) || 0,
  }
}

/**
 * Выгрузка журнала в файл, который открывает Excel.
 *
 * Через обычный `fetch`, а не через apiGet: тот разбирает ответ как JSON, а
 * здесь приезжает CSV потоком в несколько мегабайт. Разбирать его в объект
 * незачем — он сразу уходит в файл.
 *
 * Сборка файла идёт на сервере по тем же фильтрам, что и таблица (см.
 * /api/panel/receipts/export). Выгружать то, что лежит на фронте, было бы
 * враньём: там полсотни строк, а выгружают обычно месяц.
 *
 * Касса при этом продолжает работать: запрос асинхронный, сервер отдаёт поток
 * порциями и между ними отпускает базу.
 */
export async function exportPanelReceipts(
  query: PanelReceiptsQuery,
  signal?: AbortSignal,
): Promise<{ fileName: string; bytes: number }> {
  const token = localStorage.getItem('nurcrm-token')
  const response = await fetch(
    `http://127.0.0.1:8000/api/panel/receipts/export?${toParams(query).toString()}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal,
    },
  )
  if (!response.ok) throw new Error(`Сервер ответил ${response.status}`)

  const blob = await response.blob()
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')
  const fileName = `Журнал чеков ${stamp}.csv`

  // Отдаём файл ссылкой на blob: и в Electron, и в обычном браузере это
  // единственный путь, не требующий диалога сохранения из главного процесса.
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Освобождаем сразу после клика: браузер уже забрал содержимое, а ссылка на
  // несколько мегабайт иначе висела бы до перезагрузки окна.
  URL.revokeObjectURL(url)

  return { fileName, bytes: blob.size }
}

/** Кассиры для фильтра — из базы, а не из загруженной страницы. */
export async function fetchPanelCashiers(signal?: AbortSignal): Promise<string[]> {
  const res = await apiGet('/api/panel/cashiers', { signal })
  return Array.isArray(res.data) ? res.data.filter((name: unknown) => typeof name === 'string') : []
}

/**
 * Чек панели в общий тип `Receipt`.
 *
 * Нужен ради окон, которые старше панели и общие с кассой: карточка чека,
 * возврат, печать дубликата. Переписывать их под новый тип значило бы
 * переписать заодно печать и возвраты — работающие вещи, к скорости журнала
 * отношения не имеющие.
 *
 * Статусы у двух типов почти совпадают, кроме одного: на сервере оплаченный
 * чек называется `paid`, в общем типе — `completed`. Перевод здесь, в одном
 * месте, а не по месту использования.
 */
export function toLegacyReceipt(details: PanelReceiptDetails): LegacyReceipt {
  return {
    id: String(details.id),
    number: String(details.docNumber),
    date: details.createdAt.toLocaleDateString('ru-RU'),
    time: details.createdAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    cashier: details.cashierName || 'Кассир',
    items: details.items.map((item) => ({
      id: String(item.id),
      name: item.name,
      quantity: item.quantity,
      price: item.unitPrice,
      total: item.lineTotal,
      isWeight: item.isWeight,
    })),
    subtotal: details.subtotal,
    discount: details.discountTotal,
    total: details.total,
    paymentMethod: details.paymentMethod,
    status: details.status === 'paid' ? 'completed' : details.status,
    cashGiven: details.cashReceived,
    change: details.changeAmount,
    customerName: details.clientName,
  }
}

export async function fetchPanelReceiptDetails(
  id: number,
  signal?: AbortSignal,
): Promise<PanelReceiptDetails> {
  const res = await apiGet(`/api/panel/receipts/${id}`, { signal })
  const data = res.data
  return {
    ...mapRow(data),
    subtotal: Number(data.subtotal) || 0,
    cashReceived: Number(data.cash_received) || 0,
    cardAmount: Number(data.card_amount) || 0,
    changeAmount: Number(data.change_amount) || 0,
    clientPhone: String(data.client_phone ?? ''),
    paidAt: data.paid_at ? new Date(data.paid_at) : null,
    items: Array.isArray(data.items)
      ? data.items.map((item: Record<string, unknown>) => ({
          id: Number(item.id),
          name: String(item.name ?? ''),
          isWeight: Boolean(item.is_weight),
          quantity: Number(item.quantity) || 0,
          unitPrice: Number(item.unit_price) || 0,
          discount: Number(item.discount) || 0,
          lineTotal: Number(item.line_total) || 0,
        }))
      : [],
  }
}
