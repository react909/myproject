import { apiGet, apiPost } from '../api/client'
import { humanizeApiError } from '../api/errors'
import { ensureCrmShiftOpen } from './posShift'
import { roundMoney2 } from '../right-panel/helpers'

export type DebtSource = 'pos_sale' | 'main_debt'

export type DebtSaleRow = {
  id: string
  source: DebtSource
  number: string
  total: number
  balance: number
  paidTotal: number
  clientName: string
  phone: string
  createdAt: string
}

export type PayDebtShift = {
  crmShiftId?: string
  cashboxId?: string
  openCash?: number
}

type ApiSale = {
  id: number
  doc_number: number
  status: string
  total: number
  debt_balance: number
  client_name: string
  client_phone: string
  created_at: string
}

export async function fetchOpenDebtSales(signal?: AbortSignal): Promise<DebtSaleRow[]> {
  const res = await apiGet('/api/debts', { signal })
  const list = Array.isArray(res.data) ? (res.data as ApiSale[]) : []
  return list
    .filter((s) => s.status === 'debt' && s.debt_balance > 0)
    .map((s) => ({
      id: String(s.id),
      source: 'pos_sale' as const,
      number: `#${s.doc_number}`,
      total: s.total,
      balance: s.debt_balance,
      paidTotal: Math.max(0, s.total - s.debt_balance),
      clientName: s.client_name || 'Клиент',
      phone: s.client_phone || '',
      createdAt: s.created_at || '',
    }))
}

export type PayDebtInput = {
  saleId: string
  source: DebtSource
  amount: number
  method: 'cash' | 'card'
  cashReceived?: number
  shift?: PayDebtShift
}

export async function payPosSaleDebt(input: PayDebtInput): Promise<unknown> {
  const amount = roundMoney2(input.amount)
  if (amount <= 0) throw new Error('Сумма должна быть больше 0')

  await ensureCrmShiftOpen(input.shift?.openCash ?? 0, {
    shiftId: input.shift?.crmShiftId,
    cashboxId: input.shift?.cashboxId,
  })

  try {
    const res = await apiPost(`/api/sales/${encodeURIComponent(input.saleId)}/pay-debt`, {
      amount,
      payment_method: input.method,
      cash_received: input.method === 'cash' ? (input.cashReceived ?? amount) : 0,
    })
    return res.data
  } catch (err) {
    throw new Error(humanizeApiError(err, 'Не удалось погасить долг'))
  }
}
