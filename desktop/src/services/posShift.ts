import { apiGet, apiPost } from '../api/client'
import type { ShiftRecord } from '../right-panel/helpers'

export type CrmShiftSummary = {
  shiftId: string
  cashboxId: string
  cashboxName?: string
  openingCash: number
  salesCount: number
  salesTotal: number
  status: 'open' | 'closed'
  openedAt?: string
  closedAt?: string
}

type ApiShift = {
  id: number
  status: string
  opened_at: string
  closed_at: string | null
  open_cash: number
  close_cash: number
  sales_count: number
  sales_total: number
  cashbox_name: string
}

function mapShift(s: ApiShift): CrmShiftSummary {
  return {
    shiftId: String(s.id),
    cashboxId: 'local',
    cashboxName: s.cashbox_name,
    openingCash: s.open_cash,
    salesCount: s.sales_count,
    salesTotal: s.sales_total,
    status: s.status === 'open' ? 'open' : 'closed',
    openedAt: s.opened_at,
    closedAt: s.closed_at ?? undefined,
  }
}

export function isShiftRequiredError(err: unknown): boolean {
  const msg = String((err as any)?.response?.data?.detail ?? (err as any)?.message ?? '').toLowerCase()
  return msg.includes('смен') || msg.includes('shift')
}

export async function openCrmShift(openCash = 0, _cashboxId?: string): Promise<{ shiftId: string; cashboxId: string }> {
  const res = await apiPost('/api/shifts/open', { open_cash: openCash, cashbox_name: 'Основная' })
  const s = mapShift(res.data as ApiShift)
  return { shiftId: s.shiftId, cashboxId: s.cashboxId }
}

export async function ensureCrmShiftOpen(
  openCash = 0,
  opts?: { shiftId?: string; cashboxId?: string },
  _signal?: AbortSignal,
): Promise<{ shiftId: string; cashboxId: string }> {
  const current = await fetchOpenCrmShiftSummary()
  if (current) return { shiftId: current.shiftId, cashboxId: current.cashboxId }
  void opts
  return openCrmShift(openCash)
}

export async function fetchOpenCrmShiftSummary(_cashboxId?: string): Promise<CrmShiftSummary | null> {
  const res = await apiGet('/api/shifts/current')
  if (!res.data) return null
  return mapShift(res.data as ApiShift)
}

export async function fetchCrmShiftById(shiftId: string): Promise<CrmShiftSummary | null> {
  const current = await fetchOpenCrmShiftSummary()
  if (current && current.shiftId === shiftId) return current
  const res = await apiGet('/api/shifts?limit=50')
  const list = Array.isArray(res.data) ? (res.data as ApiShift[]) : []
  const found = list.find((s) => String(s.id) === shiftId)
  return found ? mapShift(found) : null
}

export async function closeCrmShift(shiftId: string, closeCash: number): Promise<CrmShiftSummary> {
  const res = await apiPost(`/api/shifts/${encodeURIComponent(shiftId)}/close`, { close_cash: closeCash })
  return mapShift(res.data as ApiShift)
}

export type ShiftSyncResult = {
  record: ShiftRecord | null
  summary: CrmShiftSummary | null
  synced?: boolean
  message?: string
}

export async function reconcilePosShiftWithCrm(
  record: ShiftRecord | null,
): Promise<ShiftSyncResult> {
  const open = await fetchOpenCrmShiftSummary()
  if (!open) {
    if (record && !record.closedAt) {
      return {
        record: { ...record, closedAt: new Date().toISOString() },
        summary: null,
        synced: true,
        message: 'Смена закрыта локально',
      }
    }
    return { record, summary: null, synced: true }
  }
  return {
    record: {
      openedAt: open.openedAt ?? record?.openedAt ?? new Date().toISOString(),
      openCash: open.openingCash,
      salesTotal: open.salesTotal,
      crmShiftId: open.shiftId,
      cashboxId: open.cashboxId,
    },
    summary: open,
    synced: true,
  }
}

export async function resolveCashboxId(): Promise<string> {
  return 'local'
}
