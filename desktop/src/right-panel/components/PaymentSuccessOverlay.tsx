import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { IcoCheck } from '../icons'
import { formatMoney } from '../helpers'

export type SuccessSummary = {
  total: number
  methodLabel: string
  change?: number
  discountTotal: number
  lines: { name: string; total: number }[]
}

type Props = { summary: SuccessSummary; onDone: () => void }

const AUTO_MS = 2200

export function PaymentSuccessOverlay({ summary, onDone }: Props) {
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    const t = window.setTimeout(() => onDoneRef.current(), AUTO_MS)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.repeat) {
        e.preventDefault()
        e.stopImmediatePropagation()
        onDoneRef.current()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onDoneRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <motion.div
      className="suc-overlay"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.06 }}
      onClick={() => onDoneRef.current()}
    >
      <motion.div
        className="suc-card suc-card--wide"
        initial={{ scale: 0.96, y: 6 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.98, opacity: 0 }}
        transition={{ duration: 0.08, ease: 'easeOut' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="suc-icon suc-icon--pop">
          <IcoCheck />
        </div>
        <strong className="suc-title">Оплата принята</strong>
        <div className="suc-brief">
          <div className="suc-brief__row">
            <span>К оплате</span>
            <span className="suc-brief__amt">{formatMoney(summary.total)}&nbsp;сом</span>
          </div>
          {summary.discountTotal > 0 && (
            <div className="suc-brief__row suc-brief__row--muted">
              <span>Скидка</span>
              <span>−{formatMoney(summary.discountTotal)}&nbsp;сом</span>
            </div>
          )}
          <div className="suc-brief__row">
            <span>Способ</span>
            <span>{summary.methodLabel}</span>
          </div>
          {summary.change != null && summary.change > 0 && (
            <div className="suc-brief__row suc-brief__row--change">
              <span>Сдача</span>
              <span>{formatMoney(summary.change)}&nbsp;сом</span>
            </div>
          )}
        </div>
        <ul className="suc-items">
          {summary.lines.map((l, idx) => (
            <li key={`${l.name}-${idx}-${l.total}`}>
              <span className="suc-items__name">{l.name}</span>
              <span className="suc-items__sum">{formatMoney(l.total)}&nbsp;сом</span>
            </li>
          ))}
        </ul>
        <button type="button" className="suc-next" onClick={onDone}>
          Следующий клиент · Enter
        </button>
      </motion.div>
    </motion.div>
  )
}
