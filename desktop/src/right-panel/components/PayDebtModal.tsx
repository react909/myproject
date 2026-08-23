import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { formatMoney, parseMoneyInput, roundMoney2 } from '../helpers'
import type { ShiftRecord } from '../helpers'
import { humanizeApiError } from '../../api/errors'
import { fetchOpenDebtSales, payPosSaleDebt, type DebtSaleRow } from '../../services/posDebt'
import { printDebtPaymentReceipt } from '../../services/receiptPrint'
import { loadSettings } from '../../settings/appSettings'
import './PayDebtModal.css'

type Props = {
  onClose: () => void
  onPaid?: () => void
  shiftOpen?: boolean
  shiftRecord?: ShiftRecord | null
  cashierName?: string
}

function formatDebtDate(raw: string): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function rowKey(row: DebtSaleRow): string {
  return `${row.source}:${row.id}`
}

export const PayDebtModal = memo(function PayDebtModal({
  onClose,
  onPaid,
  shiftOpen = true,
  shiftRecord = null,
  cashierName = 'Кассир',
}: Props) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<DebtSaleRow[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [method, setMethod] = useState<'cash' | 'card'>('cash')
  const [amountRaw, setAmountRaw] = useState('')
  const [receivedRaw, setReceivedRaw] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(
    () => rows.find((row) => rowKey(row) === selectedKey) ?? null,
    [rows, selectedKey],
  )

  const reloadDebts = useCallback(() => {
    setLoading(true)
    setError(null)
    void fetchOpenDebtSales()
      .then((list) => {
        setRows(list)
        setSelectedKey((prev) => {
          if (prev && list.some((row) => rowKey(row) === prev)) return prev
          return list[0] ? rowKey(list[0]) : null
        })
      })
      .catch((err: unknown) => {
        setError(humanizeApiError(err, 'Не удалось загрузить долги'))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    reloadDebts()
  }, [reloadDebts])

  useEffect(() => {
    if (!selected) return
    setAmountRaw(String(selected.balance))
    setReceivedRaw(String(selected.balance))
  }, [selected])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const payAmount = parseMoneyInput(amountRaw)
  const received = parseMoneyInput(receivedRaw)
  const maxDebt = selected?.balance ?? 0
  const remaining = roundMoney2(Math.max(0, maxDebt - payAmount))
  const isPartial = payAmount > 0 && payAmount < maxDebt - 0.01
  const isFull = payAmount >= maxDebt - 0.01 && maxDebt > 0

  const canPay = Boolean(selected)
    && shiftOpen
    && payAmount > 0
    && payAmount <= maxDebt + 0.01
    && (method === 'card' || received >= payAmount)

  const applyPreset = useCallback((value: number) => {
    const v = roundMoney2(value)
    setAmountRaw(String(v))
    setReceivedRaw(String(v))
  }, [])

  const handlePay = useCallback(async () => {
    if (!selected || !canPay || processing) return
    setProcessing(true)
    setError(null)
    try {
      await payPosSaleDebt({
        saleId: selected.id,
        source: selected.source,
        amount: payAmount,
        method,
        cashReceived: method === 'cash' ? received : undefined,
        shift: {
          crmShiftId: shiftRecord?.crmShiftId,
          cashboxId: shiftRecord?.cashboxId,
          openCash: shiftRecord?.openCash,
        },
      })

      const printerSettings = loadSettings()
      if (printerSettings.printer.enabled) {
        const printResult = await printDebtPaymentReceipt({
          clientName: selected.clientName,
          phone: selected.phone || undefined,
          debtNumber: selected.number,
          paidAmount: payAmount,
          remainingBalance: remaining,
          method,
          cashReceived: method === 'cash' ? received : undefined,
          change: method === 'cash' ? roundMoney2(Math.max(0, received - payAmount)) : undefined,
          cashier: cashierName,
        })
        if (!printResult?.ok && printResult?.message) {
          setError(`Оплата прошла, но печать: ${printResult.message}`)
          onPaid?.()
          return
        }
      }

      onPaid?.()
      onClose()
    } catch (err: unknown) {
      setError(humanizeApiError(err, 'CRM не приняла оплату'))
    } finally {
      setProcessing(false)
    }
  }, [canPay, cashierName, method, onClose, onPaid, payAmount, processing, received, remaining, selected, shiftRecord])

  const totalDebt = useMemo(
    () => rows.reduce((sum, row) => sum + row.balance, 0),
    [rows],
  )

  return (
    <div className="paydebt-modal" role="dialog" aria-modal="true" aria-labelledby="paydebt-title">
      <button type="button" className="paydebt-modal__backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="paydebt-modal__card">
        <h2 id="paydebt-title" className="paydebt-modal__title">Погасить долг</h2>
        <p className="paydebt-modal__hint">
          Выберите клиента, укажите сумму — можно оплатить частично или полностью.
        </p>

        {!shiftOpen && (
          <p className="paydebt-modal__warn">
            Сначала откройте смену на кассе — без этого CRM не примет оплату.
          </p>
        )}

        {loading ? (
          <p className="paydebt-modal__status">Загрузка долгов…</p>
        ) : rows.length === 0 ? (
          <div className="paydebt-modal__empty">
            <strong>Открытых долгов нет</strong>
            <span>Долг появляется после продажи с оплатой «В долг».</span>
          </div>
        ) : (
          <>
            <p className="paydebt-modal__step">1. Кто должен</p>
            <div className="paydebt-modal__list">
              {rows.map((row) => {
                const active = selectedKey === rowKey(row)
                return (
                  <button
                    key={rowKey(row)}
                    type="button"
                    className={`paydebt-modal__row${active ? ' is-active' : ''}`}
                    onClick={() => setSelectedKey(rowKey(row))}
                  >
                    <span className="paydebt-modal__row-name">{row.clientName}</span>
                    {row.phone && (
                      <span className="paydebt-modal__row-meta">{row.phone}</span>
                    )}
                    <span className="paydebt-modal__row-meta">
                      {row.number}
                      {row.createdAt ? ` · ${formatDebtDate(row.createdAt)}` : ''}
                    </span>
                    <span className="paydebt-modal__row-debt">
                      Долг: {formatMoney(row.balance)} сом
                    </span>
                    {row.paidTotal > 0 && (
                      <span className="paydebt-modal__row-meta">
                        Уже оплачено: {formatMoney(row.paidTotal)} сом
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {selected && (
              <>
                <div className="paydebt-modal__sum-box">
                  <span>Остаток долга</span>
                  <strong>{formatMoney(selected.balance)} сом</strong>
                </div>

                <p className="paydebt-modal__step">2. Сколько погасить</p>
                <div className="paydebt-modal__presets">
                  <button
                    type="button"
                    className={`paydebt-modal__preset${isFull ? ' is-active' : ''}`}
                    onClick={() => applyPreset(selected.balance)}
                  >
                    Весь долг
                    <span>{formatMoney(selected.balance)} сом</span>
                  </button>
                  <button
                    type="button"
                    className="paydebt-modal__preset"
                    onClick={() => applyPreset(roundMoney2(selected.balance / 2))}
                  >
                    Половина
                    <span>{formatMoney(roundMoney2(selected.balance / 2))} сом</span>
                  </button>
                </div>

                <label className="paydebt-modal__field">
                  <span>Своя сумма, сом</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amountRaw}
                    onChange={(e) => setAmountRaw(e.target.value)}
                  />
                </label>

                {payAmount > 0 && (
                  <p className={`paydebt-modal__remain${isPartial ? '' : ' paydebt-modal__remain--ok'}`}>
                    {isPartial
                      ? `После оплаты останется долг: ${formatMoney(remaining)} сом`
                      : 'Долг будет погашен полностью'}
                  </p>
                )}

                <p className="paydebt-modal__step">3. Способ оплаты</p>
                <div className="paydebt-modal__methods">
                  <button
                    type="button"
                    className={`paydebt-modal__method${method === 'cash' ? ' is-active' : ''}`}
                    onClick={() => setMethod('cash')}
                  >
                    Наличные
                  </button>
                  <button
                    type="button"
                    className={`paydebt-modal__method${method === 'card' ? ' is-active' : ''}`}
                    onClick={() => setMethod('card')}
                  >
                    Безнал
                  </button>
                </div>

                {method === 'cash' && (
                  <label className="paydebt-modal__field">
                    <span>Получено от клиента, сом</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={receivedRaw}
                      onChange={(e) => setReceivedRaw(e.target.value)}
                    />
                  </label>
                )}

                {method === 'cash' && received >= payAmount && payAmount > 0 && (
                  <p className="paydebt-modal__change">
                    Сдача: {formatMoney(roundMoney2(received - payAmount))} сом
                  </p>
                )}
              </>
            )}

            <p className="paydebt-modal__total-line">
              Всего открытых долгов: {rows.length} · на сумму {formatMoney(totalDebt)} сом
            </p>
          </>
        )}

        {error && <p className="paydebt-modal__error">{error}</p>}

        <div className="paydebt-modal__actions">
          <button type="button" className="paydebt-modal__btn paydebt-modal__btn--ghost" onClick={onClose}>
            Отмена
          </button>
          {rows.length > 0 && (
            <button type="button" className="paydebt-modal__btn paydebt-modal__btn--ghost" onClick={reloadDebts}>
              Обновить
            </button>
          )}
          <button
            type="button"
            className="paydebt-modal__btn paydebt-modal__btn--primary"
            disabled={!canPay || processing || rows.length === 0}
            onClick={() => void handlePay()}
          >
            {processing ? 'Отправка…' : `Оплатить ${payAmount > 0 ? formatMoney(payAmount) : ''} сом`}
          </button>
        </div>
      </div>
    </div>
  )
})
