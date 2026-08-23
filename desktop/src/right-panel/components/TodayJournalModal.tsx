import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { formatMoney } from '../helpers'
import { fetchReceiptDetails, fetchReceipts } from '../../services/receipts'
import { printDuplicateReceipt } from '../../services/receiptPrint'
import { useNotifications } from '../../components/notifications/NotificationProvider'
import { isReceiptToday } from '../../utils/today'
import type { Receipt } from '../../pages/Receipts/types'
import './TodayJournalModal.css'

type Props = {
  onClose: () => void
  onOpenFullJournal?: () => void
}

const PAY_LABEL: Record<string, string> = {
  cash: 'Наличные',
  card: 'Безнал',
  mixed: 'Смешанная',
  debt: 'В долг',
}

export const TodayJournalModal = memo(function TodayJournalModal({
  onClose,
  onOpenFullJournal,
}: Props) {
  const { push } = useNotifications()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Receipt[]>([])
  const [query, setQuery] = useState('')
  const [viewId, setViewId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Receipt | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [printId, setPrintId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchReceipts(400)
      .then((list) => {
        if (cancelled) return
        setRows(list.filter((r) => isReceiptToday(r.date)))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Не удалось загрузить чеки')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      r.number.toLowerCase().includes(q)
      || r.cashier.toLowerCase().includes(q)
      || (r.customerName ?? '').toLowerCase().includes(q)
      || r.items.some((item) => item.name.toLowerCase().includes(q)),
    )
  }, [query, rows])

  const totalSum = useMemo(
    () => filtered.reduce((sum, r) => sum + r.total, 0),
    [filtered],
  )

  const loadDetail = useCallback(async (receipt: Receipt) => {
    if (viewId === receipt.id) {
      setViewId(null)
      setDetail(null)
      return
    }
    setViewId(receipt.id)
    if (receipt.items.length > 0) {
      setDetail(receipt)
      return
    }
    setDetailLoading(true)
    try {
      const full = await fetchReceiptDetails(receipt)
      setDetail(full)
    } catch {
      setDetail(receipt)
    } finally {
      setDetailLoading(false)
    }
  }, [viewId])

  const handlePrint = useCallback(async (receipt: Receipt) => {
    setPrintId(receipt.id)
    try {
      const full = receipt.items.length > 0 ? receipt : await fetchReceiptDetails(receipt)
      const result = await printDuplicateReceipt(full)
      if (result?.ok) {
        push({ kind: 'success', title: 'Печать', message: `Дубликат #${full.number} отправлен`, dismissMs: 4000 })
      } else {
        push({
          kind: 'error',
          title: 'Принтер',
          message: result?.message ?? 'Не удалось напечатать',
          dismissMs: 7000,
        })
      }
    } finally {
      setPrintId(null)
    }
  }, [push])

  return (
    <div className="today-journal" role="dialog" aria-modal="true" aria-labelledby="today-journal-title">
      <button type="button" className="today-journal__backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="today-journal__card">
        <div className="today-journal__head">
          <div>
            <h2 id="today-journal-title">Чеки за сегодня</h2>
            <p>
              {filtered.length} чек(ов) · {formatMoney(totalSum)} сом
            </p>
          </div>
          <button type="button" className="today-journal__close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <input
          type="search"
          className="today-journal__search"
          placeholder="№ чека, клиент, товар…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {loading ? (
          <p className="today-journal__status">Загрузка…</p>
        ) : error ? (
          <p className="today-journal__error">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="today-journal__status">Сегодня продаж пока нет.</p>
        ) : (
          <div className="today-journal__list">
            {filtered.map((r) => {
              const open = viewId === r.id
              return (
                <div key={r.id} className={`today-journal__item${open ? ' is-open' : ''}`}>
                  <div className="today-journal__item-top">
                    <div className="today-journal__item-info">
                      <strong>{r.time}</strong>
                      <span>#{r.number}</span>
                      <span>{PAY_LABEL[r.paymentMethod] ?? r.paymentMethod}</span>
                    </div>
                    <strong className="today-journal__item-sum">{formatMoney(r.total)} сом</strong>
                  </div>
                  {(r.customerName || r.cashier) && (
                    <p className="today-journal__item-sub">
                      {[r.customerName, r.cashier !== 'Кассир' ? r.cashier : ''].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <div className="today-journal__item-actions">
                    <button
                      type="button"
                      className={`today-journal__btn today-journal__btn--view${open ? ' is-active' : ''}`}
                      onClick={() => void loadDetail(r)}
                    >
                      {open ? 'Скрыть' : 'Смотреть'}
                    </button>
                    <button
                      type="button"
                      className="today-journal__btn today-journal__btn--print"
                      disabled={printId === r.id}
                      onClick={() => void handlePrint(r)}
                    >
                      {printId === r.id ? '…' : 'Дубликат'}
                    </button>
                  </div>
                  {open && (
                    <div className="today-journal__detail">
                      {detailLoading ? (
                        <p className="today-journal__status">Загрузка позиций…</p>
                      ) : (detail?.items.length ?? 0) === 0 ? (
                        <p className="today-journal__status">Позиции не загрузились</p>
                      ) : (
                        <ul className="today-journal__lines">
                          {detail!.items.map((item) => (
                            <li key={item.id}>
                              <span className="today-journal__line-name">{item.name}</span>
                              <span className="today-journal__line-qty">
                                {item.isWeight ? `${item.quantity.toFixed(3)} кг` : `${Math.round(item.quantity)} шт`}
                              </span>
                              <span className="today-journal__line-sum">{formatMoney(item.total)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="today-journal__footer">
          {onOpenFullJournal && (
            <button type="button" className="today-journal__footer-btn" onClick={onOpenFullJournal}>
              Полный журнал
            </button>
          )}
          <button type="button" className="today-journal__footer-btn today-journal__footer-btn--primary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
})
