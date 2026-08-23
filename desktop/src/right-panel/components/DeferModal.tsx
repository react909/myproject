import {
  useCallback, useEffect, useRef, useState,
  type MutableRefObject,
} from 'react'
import { motion } from 'framer-motion'
import { IcoClose, IcoHold } from '../icons'
import { formatTimeShort } from '../helpers'

type Props = {
  selectionMode: boolean
  selectedCount: number
  totalCount: number
  /** Если имя не введено — подставляется в подпись отложенного (товары в чеке). */
  defaultProductLabel: string
  activeInputRef: MutableRefObject<HTMLInputElement | null>
  onClose: () => void
  onSubmit: (payload: { label: string; mode: 'all' | 'selected' }) => void
}

const BACKDROP = {
  initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 },
  transition: { duration: 0.14 },
} as const

const CARD = {
  initial: { opacity: 0, scale: 0.93, y: 12 },
  animate: { opacity: 1, scale: 1,    y: 0  },
  exit:    { opacity: 0, scale: 0.93, y: 12 },
  transition: { duration: 0.16, ease: [0.34, 1.3, 0.64, 1] },
} as const

export function DeferModal({
  selectionMode, selectedCount, totalCount,
  defaultProductLabel,
  activeInputRef, onClose, onSubmit,
}: Props) {
  const [label, setLabel] = useState('')
  const [mode, setMode] = useState<'all' | 'selected'>(
    selectionMode && selectedCount > 0 ? 'selected' : 'all',
  )
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 70)
    return () => window.clearTimeout(t)
  }, [])

  const submit = useCallback(() => {
    const fromGoods = defaultProductLabel.trim()
    onSubmit({
      label:
        label.trim() ||
        fromGoods ||
        `Чек ${formatTimeShort(new Date().toISOString())}`,
      mode,
    })
  }, [label, mode, onSubmit, defaultProductLabel])

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
              <IcoHold />
            </div>
            <div className="modal-hd__info">
              <span className="modal-hd__title">Отложить чек</span>
              <span className="modal-hd__sub">Чек можно восстановить позже</span>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
            <IcoClose />
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-modes">
            <button
              type="button"
              className={`modal-mode-btn${mode === 'all' ? ' is-active' : ''}`}
              onClick={() => setMode('all')}
            >
              Весь чек ({totalCount})
            </button>
            <button
              type="button"
              className={`modal-mode-btn${mode === 'selected' ? ' is-active' : ''}`}
              onClick={() => setMode('selected')}
              disabled={selectedCount === 0}
            >
              Выбранные ({selectedCount})
            </button>
          </div>

          <div className="modal-field">
            <span className="modal-field__label">Имя клиента / комментарий</span>
            <input
              ref={(el) => {
                inputRef.current = el
                if (el) activeInputRef.current = el
              }}
              className="defer-input"
              type="text"
              value={label}
              placeholder="Иван, стол 4, самовывоз…"
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              onFocus={(e) => { activeInputRef.current = e.currentTarget }}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="modal-btn modal-btn--primary" onClick={submit}>
            Отложить
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}