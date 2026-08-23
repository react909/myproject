/**
 * Раздел «Закупка»: запросы к серверу.
 *
 * Все суммы — целые тыйыны, и туда, и обратно. Ни одно число из этого файла не
 * делится на сто: перевод в сомы происходит только в момент отрисовки
 * (utils/money.ts).
 */

import { apiDelete, apiGet, apiPost, apiPut } from '../api/client'

export type DocStatus = 'draft' | 'posted' | 'canceled'
export type DocKind = 'purchase' | 'return'
export type Settlement = 'paid' | 'credit'

export type DocRow = {
  id: number
  number: number
  kind: DocKind
  docDate: string
  supplierId: number | null
  supplierName: string
  positionsCount: number
  totalTiyin: number
  status: DocStatus
  settlement: Settlement
  dueDate: string | null
  overdue: boolean
}

export type DocLine = {
  id: number
  productId: number | null
  name: string
  barcode: string
  unit: string
  qty: number
  costTiyin: number
  lineTotalTiyin: number
  retailTiyin: number
  markupPercent: number
  unitProfitTiyin: number
  stockQty: number
}

export type PurchaseDoc = {
  id: number
  number: number
  kind: DocKind
  docDate: string
  supplierId: number | null
  supplierName: string
  invoiceNumber: string
  comment: string
  settlement: Settlement
  dueDate: string | null
  status: DocStatus
  totalTiyin: number
  positionsCount: number
  totalQty: number
  postedAt: string | null
  sourceDocId: number | null
  lines: DocLine[]
  expectedProfitTiyin: number
}

export type DocSummary = {
  docsCount: number
  totalTiyin: number
  draftCount: number
  postedCount: number
  creditTiyin: number
}

export type DocFilters = {
  dateFrom?: string
  dateTo?: string
  supplierId?: number | null
  status?: DocStatus | ''
  kind?: DocKind | ''
}

export type LineInput = {
  productId: number | null
  name: string
  barcode: string
  unit: string
  qty: number
  costTiyin: number
  retailTiyin: number
}

export type DocInput = {
  supplierId: number | null
  docDate: string
  invoiceNumber: string
  comment: string
  settlement: Settlement
  dueDate: string | null
  kind: DocKind
  sourceDocId?: number | null
  lines: LineInput[]
}

function toRow(raw: any): DocRow {
  return {
    id: raw.id,
    number: raw.number,
    kind: raw.kind,
    docDate: raw.doc_date,
    supplierId: raw.supplier_id,
    supplierName: raw.supplier_name ?? '',
    positionsCount: raw.positions_count,
    totalTiyin: raw.total_tiyin,
    status: raw.status,
    settlement: raw.settlement,
    dueDate: raw.due_date,
    overdue: Boolean(raw.overdue),
  }
}

function toLine(raw: any): DocLine {
  return {
    id: raw.id,
    productId: raw.product_id,
    name: raw.name,
    barcode: raw.barcode,
    unit: raw.unit,
    qty: raw.qty,
    costTiyin: raw.cost_tiyin,
    lineTotalTiyin: raw.line_total_tiyin,
    retailTiyin: raw.retail_tiyin,
    markupPercent: raw.markup_percent,
    unitProfitTiyin: raw.unit_profit_tiyin,
    stockQty: raw.stock_qty,
  }
}

function toDoc(raw: any): PurchaseDoc {
  return {
    id: raw.id,
    number: raw.number,
    kind: raw.kind,
    docDate: raw.doc_date,
    supplierId: raw.supplier_id,
    supplierName: raw.supplier_name ?? '',
    invoiceNumber: raw.invoice_number ?? '',
    comment: raw.comment ?? '',
    settlement: raw.settlement,
    dueDate: raw.due_date,
    status: raw.status,
    totalTiyin: raw.total_tiyin,
    positionsCount: raw.positions_count,
    totalQty: raw.total_qty,
    postedAt: raw.posted_at,
    sourceDocId: raw.source_doc_id,
    lines: (raw.lines ?? []).map(toLine),
    expectedProfitTiyin: raw.expected_profit_tiyin ?? 0,
  }
}

function query(filters: DocFilters, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams()
  if (filters.dateFrom) params.set('date_from', filters.dateFrom)
  if (filters.dateTo) params.set('date_to', filters.dateTo)
  if (filters.supplierId) params.set('supplier_id', String(filters.supplierId))
  if (filters.status) params.set('status', filters.status)
  if (filters.kind) params.set('kind', filters.kind)
  for (const [key, value] of Object.entries(extra)) params.set(key, value)
  return params.toString()
}

export async function fetchDocs(
  filters: DocFilters,
  options: { cursor?: string; sort?: string; direction?: 'asc' | 'desc'; signal?: AbortSignal } = {},
): Promise<{ items: DocRow[]; nextCursor: string | null }> {
  const extra: Record<string, string> = { limit: '50' }
  if (options.cursor) extra.cursor = options.cursor
  if (options.sort) extra.sort = options.sort
  if (options.direction) extra.direction = options.direction
  const response = await apiGet(`/api/purchases?${query(filters, extra)}`, {
    signal: options.signal,
  })
  return {
    items: (response.data?.items ?? []).map(toRow),
    nextCursor: response.data?.next_cursor ?? null,
  }
}

export async function fetchDocSummary(
  filters: DocFilters,
  signal?: AbortSignal,
): Promise<DocSummary> {
  const response = await apiGet(`/api/purchases/summary?${query(filters)}`, { signal })
  return {
    docsCount: response.data.docs_count,
    totalTiyin: response.data.total_tiyin,
    draftCount: response.data.draft_count,
    postedCount: response.data.posted_count,
    creditTiyin: response.data.credit_tiyin,
  }
}

export async function fetchDoc(id: number, signal?: AbortSignal): Promise<PurchaseDoc> {
  const response = await apiGet(`/api/purchases/${id}`, { signal })
  return toDoc(response.data)
}

function toBody(input: DocInput) {
  return {
    supplier_id: input.supplierId,
    doc_date: input.docDate,
    invoice_number: input.invoiceNumber,
    comment: input.comment,
    settlement: input.settlement,
    due_date: input.dueDate,
    kind: input.kind,
    source_doc_id: input.sourceDocId ?? null,
    lines: input.lines.map((line) => ({
      product_id: line.productId,
      name: line.name,
      barcode: line.barcode,
      unit: line.unit,
      qty: line.qty,
      cost_tiyin: line.costTiyin,
      retail_tiyin: line.retailTiyin,
    })),
  }
}

export async function createDoc(input: DocInput): Promise<PurchaseDoc> {
  const response = await apiPost('/api/purchases', toBody(input))
  return toDoc(response.data)
}

export async function saveDoc(id: number, input: DocInput): Promise<PurchaseDoc> {
  const response = await apiPut(`/api/purchases/${id}`, toBody(input))
  return toDoc(response.data)
}

export async function postDoc(id: number): Promise<PurchaseDoc> {
  const response = await apiPost(`/api/purchases/${id}/post`)
  return toDoc(response.data)
}

export async function unpostDoc(id: number): Promise<PurchaseDoc> {
  const response = await apiPost(`/api/purchases/${id}/unpost`)
  return toDoc(response.data)
}

export async function cancelDoc(id: number): Promise<PurchaseDoc> {
  const response = await apiDelete(`/api/purchases/${id}`)
  return toDoc(response.data)
}

export type SoldAfterRow = { productId: number; name: string; qty: number; receipts: number }

/** Что из документа успели продать. Спрашивается ПЕРЕД отменой проведения. */
export async function fetchSoldAfter(id: number): Promise<SoldAfterRow[]> {
  const response = await apiGet(`/api/purchases/${id}/sold-after`)
  return (response.data ?? []).map((raw: any) => ({
    productId: raw.product_id,
    name: raw.name,
    qty: raw.qty,
    receipts: raw.receipts,
  }))
}

export type LabelRow = {
  productId: number | null
  name: string
  barcode: string
  priceTiyin: number
  qty: number
  unit: string
}

export async function fetchLabels(id: number, lineIds?: number[]): Promise<LabelRow[]> {
  const suffix = lineIds && lineIds.length ? `?only=${lineIds.join(',')}` : ''
  const response = await apiGet(`/api/purchases/${id}/labels${suffix}`)
  return (response.data ?? []).map((raw: any) => ({
    productId: raw.product_id,
    name: raw.name,
    barcode: raw.barcode,
    priceTiyin: raw.price_tiyin,
    qty: raw.qty,
    unit: raw.unit,
  }))
}

export type LastCost = {
  costTiyin: number | null
  docDate: string | null
  supplierName: string
}

/** Последняя закупочная цена — чтобы сразу видеть, подорожало ли. */
export async function fetchLastCost(
  productId: number,
  supplierId: number | null,
  signal?: AbortSignal,
): Promise<LastCost> {
  const params = new URLSearchParams({ product_id: String(productId) })
  if (supplierId) params.set('supplier_id', String(supplierId))
  const response = await apiGet(`/api/purchases/last-cost?${params.toString()}`, { signal })
  return {
    costTiyin: response.data.cost_tiyin,
    docDate: response.data.doc_date,
    supplierName: response.data.supplier_name ?? '',
  }
}

export type CatalogItem = {
  id: number
  name: string
  barcode: string
  unit: string
  stockQty: number
  priceTiyin: number
  costTiyin: number
}

/**
 * Подсказка товаров при вводе накладной: поиск по первым буквам и по коду.
 *
 * Не привязана к поставщику: строку начинают вводить до того, как выбран
 * поставщик, и подсказка, требующая его заранее, ломала бы самый частый
 * порядок работы — считал код, подставился товар.
 */
export async function searchCatalog(q: string, signal?: AbortSignal): Promise<CatalogItem[]> {
  const params = new URLSearchParams({ q, limit: '20' })
  const response = await apiGet(`/api/purchases/catalog?${params.toString()}`, { signal })
  return (response.data ?? []).map((raw: any) => ({
    id: raw.id,
    name: raw.name,
    barcode: raw.barcode ?? '',
    unit: raw.unit ?? 'шт',
    stockQty: raw.stock_qty ?? 0,
    priceTiyin: raw.price_tiyin ?? 0,
    costTiyin: raw.cost_tiyin ?? 0,
  }))
}

export type PriceComparisonRow = {
  supplierId: number | null
  supplierName: string
  deliveries: number
  lastCostTiyin: number
  minCostTiyin: number
  maxCostTiyin: number
  lastDate: string | null
}

/** У кого и по какой цене закупался товар. Экран сравнения цен. */
export async function fetchPriceComparison(
  productId: number,
  signal?: AbortSignal,
): Promise<PriceComparisonRow[]> {
  const response = await apiGet(`/api/purchases/product/${productId}/suppliers`, { signal })
  return (response.data ?? []).map((raw: any) => ({
    supplierId: raw.supplier_id,
    supplierName: raw.supplier_name,
    deliveries: raw.deliveries,
    lastCostTiyin: raw.last_cost_tiyin,
    minCostTiyin: raw.min_cost_tiyin,
    maxCostTiyin: raw.max_cost_tiyin,
    lastDate: raw.last_date,
  }))
}
