import {
  useCallback, useEffect, useRef, useState,
  type MutableRefObject,
} from 'react'
import { motion } from 'framer-motion'
import { IcoClose, IcoShiftOpen, IcoShiftClose } from '../icons'
import { formatMoney, parseMoneyInput } from '../helpers'

export type ShiftModalType = 'open' | 'close'

type ShiftModalProps = {
  type: ShiftModalType
  salesTotal: number
  /** Число заказов за смену (показывается при закрытии) */
  ordersCount?: number
  activeInputRef: MutableRefObject<HTMLInputElement | null>
  onConfirm: (cashAmount: number) => void
  onClose: () => void
}

const BACKDROP = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit:    { opacity: 0 },
  transition: { duration: 0.14 },
} as const

const CARD = {
  initial: { opacity: 0, scale: 0.93, y: 12 },
  animate: { opacity: 1, scale: 1,    y: 0  },
  exit:    { opacity: 0, scale: 0.93, y: 12 },
  transition: { duration: 0.16, ease: [0.34, 1.3, 0.64, 1] },
} as const

export function ShiftModal({
  type, salesTotal, ordersCount, activeInputRef, onConfirm, onClose,
}: ShiftModalProps) {
  const [rawValue, setRawValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 70)
    return () => window.clearTimeout(t)
  }, [])

  const amount = parseMoneyInput(rawValue)
  const diff = type === 'close' && amount > 0 ? amount - salesTotal : null
  const diffLabel = diff !== null
    ? diff > 0 ? `+${formatMoney(diff)} сом (излишек)` : diff < 0 ? `${formatMoney(diff)} сом (недостача)` : 'Точное совпадение'
    : null

  const handleConfirm = useCallback(async () => {
    if (submitting) return
    setSubmitting(true)
    await new Promise((r) => setTimeout(r, 80))
    onConfirm(amount)
    setSubmitting(false)
  }, [amount, onConfirm, submitting])

  return (
    <motion.div
      className="modal-backdrop"
      {...BACKDROP}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div className="modal-card" {...CARD}>
        <div className="modal-hd">
          <div className="modal-hd__left">
            <div className="modal-hd__icon">
              {type === 'open' ? <IcoShiftOpen /> : <IcoShiftClose />}
            </div>
            <div className="modal-hd__info">
              <span className="modal-hd__title">
                {type === 'open' ? 'Открытие смены' : 'Закрытие смены'}
              </span>
              <span className="modal-hd__sub">
                {type === 'open' ? 'Укажите начальный капитал' : 'Пересчитайте кассу'}
              </span>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
            <IcoClose />
          </button>
        </div>

        <div className="modal-body">
          {type === 'close' && ordersCount != null && (
            <div className="modal-info-row">
              <span>Заказов за смену</span>
              <strong>{ordersCount}</strong>
            </div>
          )}

          {type === 'close' && (
            <div className="modal-info-row">
              <span>Итого выручка</span>
              <strong>{formatMoney(salesTotal)}&nbsp;сом</strong>
            </div>
          )}

          <div className="modal-field">
            <span className="modal-field__label">
              {type === 'open' ? 'Наличных в кассе' : 'Итоговая сумма наличных'}
            </span>
            <div className="modal-input-wrap">
              <input
                ref={(el) => {
                  inputRef.current = el
                  if (el) activeInputRef.current = el
                }}
                className="modal-input"
                type="text"
                inputMode="decimal"
                value={rawValue}
                placeholder="0.00"
                onChange={(e) => {
                  const v = e.target.value
                  if (/^[0-9]*[.,]?[0-9]*$/.test(v) || v === '') setRawValue(v)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirm()
                  if (e.key === 'Escape') onClose()
                }}
              />
              <span className="modal-input-currency">сом</span>
            </div>
          </div>

          <div className="modal-presets">
            {[1000, 3000, 5000, 10000].map((v) => (
              <button
                key={v}
                type="button"
                className="modal-preset"
                onClick={() => setRawValue(String(v))}
              >
                {v.toLocaleString('ru-RU')}&nbsp;сом
              </button>
            ))}
          </div>

          {type === 'close' && diff !== null && (
            <div className={`modal-diff ${diff > 0 ? 'is-surplus' : diff < 0 ? 'is-shortage' : 'is-exact'}`}>
              <span>Сравнение с расчётом</span>
              <strong>{diffLabel}</strong>
            </div>
          )}

          <p className="modal-hint">
            {type === 'open'
              ? 'Укажите сумму наличных в кассе перед началом смены.'
              : 'Пересчитайте наличные и введите фактическую сумму.'}
          </p>
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="modal-btn modal-btn--primary"
            onClick={handleConfirm}
            disabled={submitting}
          >
            {type === 'open' ? 'Открыть смену' : 'Закрыть смену'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}