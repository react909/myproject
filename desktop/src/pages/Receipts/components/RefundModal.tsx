import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { ModalPortal } from '../../../components/ModalPortal'
import type { Receipt, RefundLineSelection } from '../types'
// Стили — рядом с окном: страницы старого журнала, которая их подключала,
// больше нет. Он переписан заново как pages/panel/PanelJournal.
import './ReceiptModals.css'

type Props = {
  receipt: Receipt
  onConfirm: (items: RefundLineSelection[], reason: string) => void
  onCancel: () => void
}

const REASONS = [
  'Товар ненадлежащего качества',
  'Не подошёл размер / объём',
  'Ошибка кассира',
  'Клиент передумал',
  'Другое',
]

export function RefundModal({ receipt, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [customReason, setCustomReason] = useState('')

  const selectedCount = Object.keys(selected).length

  const maxReturnQty = (id: string) => {
    const item = receipt.items.find((line) => line.id === id)
    if (!item) return 0
    return Math.max(0, item.quantity - (item.refundedQuantity ?? 0))
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev[id] != null) {
        const { [id]: _removed, ...rest } = prev
        return rest
      }
      const max = maxReturnQty(id)
      return max > 0 ? { ...prev, [id]: max } : prev
    })
  }

  const selectAll = () => {
    const next: Record<string, number> = {}
    receipt.items.forEach((item) => {
      const max = Math.max(0, item.quantity - (item.refundedQuantity ?? 0))
      if (max > 0) next[item.id] = max
    })
    setSelected(next)
  }

  const setQty = (id: string, raw: string) => {
    const max = maxReturnQty(id)
    const parsed = Number.parseFloat(raw.replace(',', '.'))
    const nextQty = Number.isFinite(parsed) ? Math.min(max, Math.max(0, parsed)) : 0
    setSelected((prev) => {
      if (nextQty <= 0) {
        const { [id]: _removed, ...rest } = prev
        return rest
      }
      return { ...prev, [id]: nextQty }
    })
  }

  const refundAmount = useMemo(() => {
    return receipt.items
      .reduce((sum, item) => {
        const qty = selected[item.id] ?? 0
        if (qty <= 0) return sum
        return sum + (item.total / Math.max(item.quantity, 1)) * qty
      }, 0)
  }, [selected, receipt.items])

  const finalReason = reason === 'Другое' ? customReason : reason
  const selectedLines = useMemo<RefundLineSelection[]>(
    () =>
      Object.entries(selected)
        .map(([itemId, quantity]) => ({ itemId, quantity }))
        .filter((item) => item.quantity > 0),
    [selected],
  )

  return (
    <ModalPortal>
    <motion.div
      className="refund-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <motion.div
        className="refund-modal"
        initial={{ scale: 0.93, y: 24 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.93, y: 24 }}
        transition={{ type: 'spring', damping: 22, stiffness: 320 }}
      >
        <header className="refund-modal__header">
          <h2 className="refund-modal__title">Возврат · {receipt.number}</h2>
          <button type="button" className="refund-modal__close" onClick={onCancel}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </header>

        <div className="refund-modal__body">
          {/* Выбор товаров */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p className="refund-modal__hint">
              Выберите товары и количество для возврата ({selectedCount} / {receipt.items.length})
            </p>
            <button
              type="button"
              style={{
                fontSize: 12, fontWeight: 600, color: 'var(--blue)',
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              }}
              onClick={selectAll}
            >
              Выбрать все
            </button>
          </div>

          <div className="refund-items-list">
            {receipt.items.map(item => {
              const maxQty = Math.max(0, item.quantity - (item.refundedQuantity ?? 0))
              const isSelected = selected[item.id] != null
              return (
              <label key={item.id} className={`refund-item${maxQty <= 0 ? ' refund-item--disabled' : ''}`}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={maxQty <= 0}
                  onChange={() => toggle(item.id)}
                />
                <div className="refund-item__info">
                  <span className="refund-item__name">{item.name}</span>
                  <span className="refund-item__qty">
                    {item.quantity.toLocaleString('ru-RU', {
                      minimumFractionDigits: item.isWeight ? 3 : 0,
                      maximumFractionDigits: item.isWeight ? 3 : 0,
                    })} {item.isWeight ? 'кг' : 'шт'}
                    &nbsp;×&nbsp;{item.price.toLocaleString('ru-RU')} сом
                  </span>
                  {item.refundedQuantity ? (
                    <span className="refund-item__qty">
                      Уже возвращено: {item.refundedQuantity.toLocaleString('ru-RU')} {item.isWeight ? 'кг' : 'шт'}
                    </span>
                  ) : null}
                </div>
                {isSelected && (
                  <input
                    className="refund-item__qty-input"
                    type="number"
                    min="0"
                    max={maxQty}
                    step={item.isWeight ? '0.001' : '1'}
                    value={selected[item.id]}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setQty(item.id, e.target.value)}
                    aria-label={`Количество возврата ${item.name}`}
                  />
                )}
                <span className="refund-item__total">{item.total.toLocaleString('ru-RU')} сом</span>
              </label>
              )
            })}
          </div>

          {/* Причина */}
          <div className="refund-reason">
            <span className="refund-reason__label">Причина возврата</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {REASONS.map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  style={{
                    padding: '5px 11px',
                    borderRadius: 999,
                    border: `1.5px solid ${reason === r ? 'var(--red)' : 'var(--border)'}`,
                    background: reason === r ? 'var(--red-soft)' : 'var(--surface-2)',
                    color: reason === r ? 'var(--red)' : 'var(--text-2)',
                    fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                    transition: 'all 80ms ease',
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
            {reason === 'Другое' && (
              <textarea
                className="refund-reason__input"
                placeholder="Опишите причину..."
                value={customReason}
                onChange={e => setCustomReason(e.target.value)}
                rows={2}
              />
            )}
          </div>

          {/* Сводка */}
          {selectedCount > 0 && (
            <div className="refund-summary">
              <div>
                <p className="refund-summary__label">Сумма возврата</p>
                <p style={{ fontSize: 11, color: 'var(--red)', opacity: 0.7, marginTop: 2 }}>
                  {selectedCount} позиц. из {receipt.items.length}
                </p>
              </div>
              <p className="refund-summary__value">
                {refundAmount.toLocaleString('ru-RU')} сом
              </p>
            </div>
          )}
        </div>

        <footer className="refund-modal__footer">
          <button type="button" className="refund-modal__btn refund-modal__btn--cancel" onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            className="refund-modal__btn refund-modal__btn--confirm"
            onClick={() => onConfirm(selectedLines, finalReason)}
            disabled={selectedLines.length === 0 || !finalReason}
          >
            Оформить возврат · {refundAmount.toLocaleString('ru-RU')} сом
          </button>
        </footer>
      </motion.div>
    </motion.div>
    </ModalPortal>
  )
}