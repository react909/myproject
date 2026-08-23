/**
 * Раздел «Смена»: запросы к серверу.
 *
 * Отдельный файл от `posShift.ts`, и это не дублирование. `posShift.ts`
 * обслуживает КАССУ: он говорит на языке старых полей (`open_cash` в сомах,
 * `salesTotal` числом), и трогать его — значит трогать продажу. Здесь новый
 * язык: целые тыйыны и показатели смены, которых касса не знает.
 *
 * Оба ходят в один и тот же модуль сервера, и сервер отдаёт обоим их поля в
 * одном ответе — старые для кассы, новые для раздела.
 */

import { apiGet, apiPost } from '../api/client'

export type ShiftRow = {
  id: number
  number: number
  status: 'open' | 'closed'
  openedAt: string
  closedAt: string | null
  openedBy: string
  closedBy: string
  openCashTiyin: number
  countedCashTiyin: number
  expectedCashTiyin: number
  varianceTiyin: number
  varianceReason: string
  /** Была ли сверка. У смен, закрытых до появления раздела, её не было, и
   *  нулевое расхождение у них значит «не сверяли», а не «сошлось ровно». */
  reconciled: boolean
}

export type ShiftMetrics = {
  salesCount: number
  refundsCount: number
  revenueTiyin: number
  cashTiyin: number
  cardTiyin: number
  qrTiyin: number
  debtTiyin: number
  refundsTiyin: number
  discountsTiyin: number
  avgCheckTiyin: number
}

export type ShiftState = {
  shift: ShiftRow
  metrics: ShiftMetrics
  expectedCashTiyin: number
  depositsTiyin: number
  withdrawalsTiyin: number
  durationSeconds: number
}

export type MovementKind = 'deposit' | 'withdrawal' | 'refund' | 'debt_payment'

export type Movement = {
  id: number
  kind: MovementKind
  amountTiyin: number
  reason: string
  comment: string
  actorName: string
  createdAt: string
}

export type HistoryRow = {
  id: number
  number: number
  openedAt: string
  closedAt: string | null
  status: 'open' | 'closed'
  cashier: string
  revenueTiyin: number
  cashTiyin: number
  cashlessTiyin: number
  refundsTiyin: number
  varianceTiyin: number
  reconciled: boolean
}

function toShift(raw: any): ShiftRow {
  return {
    id: raw.id,
    number: raw.number,
    status: raw.status === 'open' ? 'open' : 'closed',
    openedAt: raw.opened_at ?? '',
    closedAt: raw.closed_at ?? null,
    openedBy: raw.opened_by_name ?? '',
    closedBy: raw.closed_by_name ?? '',
    openCashTiyin: raw.open_cash_tiyin ?? 0,
    countedCashTiyin: raw.counted_cash_tiyin ?? 0,
    expectedCashTiyin: raw.expected_cash_tiyin ?? 0,
    varianceTiyin: raw.variance_tiyin ?? 0,
    varianceReason: raw.variance_reason ?? '',
    reconciled: Boolean(raw.reconciled),
  }
}

function toMetrics(raw: any): ShiftMetrics {
  return {
    salesCount: raw.sales_count ?? 0,
    refundsCount: raw.refunds_count ?? 0,
    revenueTiyin: raw.revenue_tiyin ?? 0,
    cashTiyin: raw.cash_tiyin ?? 0,
    cardTiyin: raw.card_tiyin ?? 0,
    qrTiyin: raw.qr_tiyin ?? 0,
    debtTiyin: raw.debt_tiyin ?? 0,
    refundsTiyin: raw.refunds_tiyin ?? 0,
    discountsTiyin: raw.discounts_tiyin ?? 0,
    avgCheckTiyin: raw.avg_check_tiyin ?? 0,
  }
}

function toState(raw: any): ShiftState {
  return {
    shift: toShift(raw.shift),
    metrics: toMetrics(raw.metrics),
    expectedCashTiyin: raw.expected_cash_tiyin ?? 0,
    depositsTiyin: raw.deposits_tiyin ?? 0,
    withdrawalsTiyin: raw.withdrawals_tiyin ?? 0,
    durationSeconds: raw.duration_seconds ?? 0,
  }
}

/** Состояние открытой смены. `null` — смены нет, и это нормальное состояние. */
export async function fetchShiftState(signal?: AbortSignal): Promise<ShiftState | null> {
  const response = await apiGet('/api/shifts/state', { signal })
  return response.data ? toState(response.data) : null
}

export async function fetchShiftCard(id: number, signal?: AbortSignal): Promise<ShiftState> {
  const response = await apiGet(`/api/shifts/${id}`, { signal })
  return toState(response.data)
}

export async function openShift(input: {
  openCashTiyin: number
  cashierName: string
}): Promise<ShiftRow> {
  const response = await apiPost('/api/shifts/open', {
    open_cash_tiyin: input.openCashTiyin,
    cashier_name: input.cashierName,
  })
  return toShift(response.data)
}

export async function closeShift(
  id: number,
  input: { countedCashTiyin: number; varianceReason: string },
): Promise<ShiftRow> {
  const response = await apiPost(`/api/shifts/${id}/close`, {
    counted_cash_tiyin: input.countedCashTiyin,
    variance_reason: input.varianceReason,
  })
  return toShift(response.data)
}

export async function addCashMovement(
  id: number,
  input: {
    kind: 'deposit' | 'withdrawal'
    amountTiyin: number
    reason: string
    comment: string
    actorName: string
  },
): Promise<ShiftState> {
  const response = await apiPost(`/api/shifts/${id}/cash`, {
    kind: input.kind,
    amount_tiyin: input.amountTiyin,
    reason: input.reason,
    comment: input.comment,
    actor_name: input.actorName,
  })
  return toState(response.data)
}

export async function fetchMovements(
  id: number,
  signal?: AbortSignal,
): Promise<Movement[]> {
  const response = await apiGet(`/api/shifts/${id}/movements?limit=200`, { signal })
  return (response.data?.items ?? []).map((raw: any) => ({
    id: raw.id,
    kind: raw.kind,
    amountTiyin: raw.amount_tiyin,
    reason: raw.reason,
    comment: raw.comment,
    actorName: raw.actor_name,
    createdAt: raw.created_at,
  }))
}

export type ShiftReport = {
  kind: 'x' | 'z'
  shift: ShiftRow
  metrics: ShiftMetrics
  expectedCashTiyin: number
  depositsTiyin: number
  withdrawalsTiyin: number
  printedAt: string
  printedBy: string
}

export async function fetchShiftReport(id: number, kind: 'x' | 'z'): Promise<ShiftReport> {
  const response = await apiGet(`/api/shifts/${id}/report?kind=${kind}`)
  const raw = response.data
  return {
    kind,
    shift: toShift(raw.shift),
    metrics: toMetrics(raw.metrics),
    expectedCashTiyin: raw.expected_cash_tiyin,
    depositsTiyin: raw.deposits_tiyin,
    withdrawalsTiyin: raw.withdrawals_tiyin,
    printedAt: raw.printed_at,
    printedBy: raw.printed_by,
  }
}

export async function fetchShiftHistory(
  query: { dateFrom?: string; dateTo?: string; cashier?: string; cursor?: string },
  signal?: AbortSignal,
): Promise<{ items: HistoryRow[]; nextCursor: string | null }> {
  const params = new URLSearchParams()
  if (query.dateFrom) params.set('date_from', query.dateFrom)
  if (query.dateTo) params.set('date_to', query.dateTo)
  if (query.cashier) params.set('cashier', query.cashier)
  if (query.cursor) params.set('cursor', query.cursor)
  params.set('limit', '50')
  const response = await apiGet(`/api/shifts/history?${params.toString()}`, { signal })
  return {
    items: (response.data?.items ?? []).map((raw: any) => ({
      id: raw.id,
      number: raw.number,
      openedAt: raw.opened_at,
      closedAt: raw.closed_at,
      status: raw.status,
      cashier: raw.cashier,
      revenueTiyin: raw.revenue_tiyin,
      cashTiyin: raw.cash_tiyin,
      cashlessTiyin: raw.cashless_tiyin,
      refundsTiyin: raw.refunds_tiyin,
      varianceTiyin: raw.variance_tiyin,
      reconciled: raw.reconciled,
    })),
    nextCursor: response.data?.next_cursor ?? null,
  }
}
