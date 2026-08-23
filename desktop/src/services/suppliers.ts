/**
 * Раздел «Поставщики»: запросы к серверу.
 *
 * Оплата поставщику здесь есть, но её пропускает не этот файл, а сервер:
 * `POST /payments` требует открытой двери владельца и отклоняет прямой запрос
 * без неё. Прятать кнопку в интерфейсе — не защита, и на неё здесь ничего не
 * опирается.
 */

import { apiDelete, apiGet, apiPatch, apiPost } from '../api/client'

export type SupplierRow = {
  id: number
  name: string
  phone: string
  contactPerson: string
  purchasesCount: number
  purchasesTiyin: number
  debtTiyin: number
  lastDelivery: string | null
  /** Есть проведённая закупка в долг с истёкшим сроком оплаты. */
  overdue: boolean
}

export type SupplierCard = {
  id: number
  name: string
  contactPerson: string
  phone: string
  address: string
  comment: string
  isActive: boolean
  debtTiyin: number
  purchasesCount: number
  purchasesTiyin: number
  paidTiyin: number
  lastDelivery: string | null
}

export type SupplyRow = {
  id: number
  number: number
  kind: 'purchase' | 'return'
  docDate: string
  positionsCount: number
  totalTiyin: number
  status: 'draft' | 'posted' | 'canceled'
  settlement: 'paid' | 'credit'
  dueDate: string | null
  overdue: boolean
}

export type PaymentRow = {
  id: number
  amountTiyin: number
  paidAt: string
  method: string
  comment: string
  /** Остаток долга ПОСЛЕ этого платежа — считает сервер по всей истории. */
  balanceAfterTiyin: number
}

export type SupplierProductRow = {
  productId: number
  name: string
  lastCostTiyin: number
  prevCostTiyin: number | null
  /** Изменение цены с прошлой поставки. `null` — поставка была одна. */
  changePercent: number | null
  lastDate: string | null
  deliveries: number
}

export type SupplierSort = 'name' | 'phone' | 'debt' | 'purchases' | 'last'

function toCard(raw: any): SupplierCard {
  return {
    id: raw.id,
    name: raw.name,
    contactPerson: raw.contact_person ?? '',
    phone: raw.phone ?? '',
    address: raw.address ?? '',
    comment: raw.comment ?? '',
    isActive: raw.is_active,
    debtTiyin: raw.debt_tiyin,
    purchasesCount: raw.purchases_count,
    purchasesTiyin: raw.purchases_tiyin,
    paidTiyin: raw.paid_tiyin,
    lastDelivery: raw.last_delivery,
  }
}

export async function fetchSuppliers(
  options: { q?: string; sort?: SupplierSort; direction?: 'asc' | 'desc'; signal?: AbortSignal } = {},
): Promise<SupplierRow[]> {
  const params = new URLSearchParams({ limit: '200' })
  if (options.q) params.set('q', options.q)
  if (options.sort) params.set('sort', options.sort)
  if (options.direction) params.set('direction', options.direction)
  const response = await apiGet(`/api/suppliers?${params.toString()}`, { signal: options.signal })
  return (response.data?.items ?? []).map((raw: any) => ({
    id: raw.id,
    name: raw.name,
    phone: raw.phone ?? '',
    contactPerson: raw.contact_person ?? '',
    purchasesCount: raw.purchases_count,
    purchasesTiyin: raw.purchases_tiyin,
    debtTiyin: raw.debt_tiyin,
    lastDelivery: raw.last_delivery,
    overdue: Boolean(raw.overdue),
  }))
}

export async function fetchSupplier(id: number, signal?: AbortSignal): Promise<SupplierCard> {
  const response = await apiGet(`/api/suppliers/${id}`, { signal })
  return toCard(response.data)
}

export type SupplierInput = {
  name: string
  contactPerson: string
  phone: string
  address: string
  comment: string
}

function toBody(input: SupplierInput) {
  return {
    name: input.name,
    contact_person: input.contactPerson,
    phone: input.phone,
    address: input.address,
    comment: input.comment,
  }
}

export async function createSupplier(input: SupplierInput): Promise<SupplierCard> {
  const response = await apiPost('/api/suppliers', toBody(input))
  return toCard(response.data)
}

export async function updateSupplier(id: number, input: SupplierInput): Promise<SupplierCard> {
  const response = await apiPatch(`/api/suppliers/${id}`, toBody(input))
  return toCard(response.data)
}

/** Убрать из списка. Физически строка не удаляется — только помечается. */
export async function archiveSupplier(id: number): Promise<SupplierCard> {
  const response = await apiDelete(`/api/suppliers/${id}`)
  return toCard(response.data)
}

export async function fetchSupplierPurchases(
  id: number,
  signal?: AbortSignal,
): Promise<SupplyRow[]> {
  const response = await apiGet(`/api/suppliers/${id}/purchases`, { signal })
  return (response.data ?? []).map((raw: any) => ({
    id: raw.id,
    number: raw.number,
    kind: raw.kind,
    docDate: raw.doc_date,
    positionsCount: raw.positions_count,
    totalTiyin: raw.total_tiyin,
    status: raw.status,
    settlement: raw.settlement,
    dueDate: raw.due_date,
    overdue: Boolean(raw.overdue),
  }))
}

export async function fetchSupplierPayments(
  id: number,
  signal?: AbortSignal,
): Promise<PaymentRow[]> {
  const response = await apiGet(`/api/suppliers/${id}/payments`, { signal })
  return (response.data ?? []).map((raw: any) => ({
    id: raw.id,
    amountTiyin: raw.amount_tiyin,
    paidAt: raw.paid_at,
    method: raw.method,
    comment: raw.comment,
    balanceAfterTiyin: raw.balance_after_tiyin,
  }))
}

export async function fetchSupplierProducts(
  id: number,
  signal?: AbortSignal,
): Promise<SupplierProductRow[]> {
  const response = await apiGet(`/api/suppliers/${id}/products`, { signal })
  return (response.data ?? []).map((raw: any) => ({
    productId: raw.product_id,
    name: raw.name,
    lastCostTiyin: raw.last_cost_tiyin,
    prevCostTiyin: raw.prev_cost_tiyin,
    changePercent: raw.change_percent,
    lastDate: raw.last_date,
    deliveries: raw.deliveries,
  }))
}

/**
 * Внести оплату поставщику.
 *
 * Требует открытой двери владельца. Проверка на сервере; отказ приходит 403 и
 * показывается как есть — придумывать здесь «наверное, нужен пароль» не нужно.
 */
export async function paySupplier(
  id: number,
  input: { amountTiyin: number; method: string; comment: string; paidAt?: string },
): Promise<SupplierCard> {
  const response = await apiPost(`/api/suppliers/${id}/payments`, {
    amount_tiyin: input.amountTiyin,
    method: input.method,
    comment: input.comment,
    paid_at: input.paidAt ?? null,
  })
  return toCard(response.data)
}

