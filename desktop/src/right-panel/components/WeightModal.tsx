import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
  type MutableRefObject,
} from 'react'
import { motion } from 'framer-motion'
import { IcoClose, IcoScale } from '../icons'
import {
  formatMoney, formatWeight,
  parseWeightInput, clampWeight,
} from '../helpers'
import type { CartItem } from '../helpers'
import { ScaleWeightBlock } from '../../components/scale/ScaleWeightBlock'
import {
  formatScaleKgInput,
  pickScaleKg,
  requestScaleSnapshot,
} from '../../services/devices/scaleSnapshot'
import './WeightModal.css'

export type WeightModalMode = 'add' | 'update'

export type WeightModalPayload = {
  mode: WeightModalMode
  existingItem?: CartItem
  productId: string
  productName: string
  pricePerKg: number
  productImage?: string
}

type WeightModalProps = {
  payload: WeightModalPayload
  activeInputRef: MutableRefObject<HTMLInputElement | null>
  scaleDisplayKg?: number | null
  scaleWeightStable?: boolean
  onFixScaleWeight?: () => void
  onConfirm: (weightKg: number, mode: WeightModalMode) => void
  onClose: () => void
}

const BACKDROP_ANIM = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit:    { opacity: 0 },
  transition: { duration: 0.14 },
} as const

const CARD_ANIM = {
  initial: { opacity: 0, scale: 0.93, y: 12 },
  animate: { opacity: 1, scale: 1,    y: 0  },
  exit:    { opacity: 0, scale: 0.93, y: 12 },
  transition: { duration: 0.16, ease: [0.34, 1.3, 0.64, 1] },
} as const

function formatKgDisplay(kg: number): string {
  return kg.toFixed(3)
}

export function WeightModal({
  payload,
  activeInputRef,
  scaleDisplayKg = null,
  scaleWeightStable = false,
  onFixScaleWeight,
  onConfirm,
  onClose,
}: WeightModalProps) {
  const { mode, existingItem, productName, pricePerKg, productImage } = payload
  const userEditedRef = useRef(false)
  const [rawInput, setRawInput] = useState(() => {
    if (mode === 'update' && existingItem) return formatKgDisplay(existingItem.weightKg)
    return formatScaleKgInput(scaleDisplayKg)
  })
  const [applyMode, setApplyMode] = useState<'set' | 'add'>('set')
  const [scaleLoading, setScaleLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useLayoutEffect(() => {
    userEditedRef.current = false
    setApplyMode('set')
    setScaleLoading(false)
    const seed =
      mode === 'update' && existingItem
        ? existingItem.weightKg
        : scaleDisplayKg != null && scaleDisplayKg > 0
          ? scaleDisplayKg
          : null
    setRawInput(seed != null && seed > 0 ? formatKgDisplay(seed) : '')

    void requestScaleSnapshot().then((snapshot) => {
      if (userEditedRef.current) return
      const next = pickScaleKg(snapshot, scaleDisplayKg)
      if (next == null) {
        if (mode !== 'update') setRawInput('')
        return
      }
      setRawInput(formatKgDisplay(next))
    })

    const t = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(t)
  }, [payload.productId, mode, existingItem?.lineId])

  useEffect(() => {
    if (userEditedRef.current) return
    if (scaleDisplayKg != null && scaleDisplayKg > 0) {
      setRawInput(formatKgDisplay(scaleDisplayKg))
    } else if (mode !== 'update') {
      setRawInput('')
    }
  }, [scaleDisplayKg, mode])

  const parsedKg = parseWeightInput(rawInput)
  const previewWeight =
    mode === 'update' && existingItem && applyMode === 'add'
      ? clampWeight((existingItem.weightKg ?? 0) + parsedKg)
      : parsedKg > 0 ? clampWeight(parsedKg) : 0
  const previewTotal = previewWeight * pricePerKg

  const displayKg = parsedKg > 0 ? parsedKg : (scaleDisplayKg ?? 0)
  const displayInt = (rawInput || formatKgDisplay(displayKg)).split('.')[0] || '0'
  const decPart = (rawInput || formatKgDisplay(displayKg)).includes('.')
    ? '.' + ((rawInput || formatKgDisplay(displayKg)).split('.')[1] ?? '')
    : ''

  const handleScaleGet = useCallback(async () => {
    setScaleLoading(true)
    try {
      const r = await requestScaleSnapshot()
      if (r.kg != null && Number.isFinite(r.kg) && r.kg > 0) {
        userEditedRef.current = false
        setRawInput(formatKgDisplay(r.kg))
      }
    } finally {
      setScaleLoading(false)
      inputRef.current?.focus()
    }
  }, [])

  const handleConfirm = useCallback(() => {
    if (previewWeight <= 0) return
    onConfirm(previewWeight, mode)
  }, [previewWeight, mode, onConfirm])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm()
    if (e.key === 'Escape') onClose()
  }, [handleConfirm, onClose])

  return (
    <motion.div
      className="modal-backdrop"
      {...BACKDROP_ANIM}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div className="modal-card wmc-card" {...CARD_ANIM}>
        <div className="modal-hd">
          <div className="modal-hd__left">
            {productImage ? (
              <img src={productImage} alt="" className="wmc-product-img" />
            ) : (
              <div className="modal-hd__icon">
                <IcoScale />
              </div>
            )}
            <div className="modal-hd__info">
              <span className="modal-hd__title">{productName}</span>
              <span className="modal-hd__sub">{formatMoney(pricePerKg)}&nbsp;сом&nbsp;/&nbsp;кг</span>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
            <IcoClose />
          </button>
        </div>

        <div className="modal-body">
          {onFixScaleWeight && (
            <ScaleWeightBlock
              compact
              displayKg={scaleDisplayKg}
              isStable={scaleWeightStable}
              onFix={() => {
                onFixScaleWeight()
                if (scaleDisplayKg != null && scaleDisplayKg > 0) {
                  userEditedRef.current = false
                  setRawInput(formatKgDisplay(scaleDisplayKg))
                }
              }}
            />
          )}

          {mode === 'update' && existingItem && (
            <div className="modal-current">
              <span>Текущий вес</span>
              <strong>{formatWeight(existingItem.weightKg)}&nbsp;кг</strong>
            </div>
          )}

          {mode === 'update' && (
            <div className="modal-modes">
              <button
                type="button"
                className={`modal-mode-btn${applyMode === 'set' ? ' is-active' : ''}`}
                onClick={() => setApplyMode('set')}
              >
                Заменить
              </button>
              <button
                type="button"
                className={`modal-mode-btn${applyMode === 'add' ? ' is-active' : ''}`}
                onClick={() => setApplyMode('add')}
              >
                Прибавить
              </button>
            </div>
          )}

          <div className="wmc-display">
            <div className="wmc-display__weight">
              <span className="wmc-display__int">{displayInt}</span>
              {decPart && <span className="wmc-display__dec">{decPart}</span>}
              <span className="wmc-display__unit">кг</span>
            </div>
            <div className="wmc-display__pay">
              <span className="wmc-display__pay-label">К оплате</span>
              <span className="wmc-display__pay-value">
                {previewWeight > 0 ? `${formatMoney(previewTotal)} сом` : '—'}
              </span>
            </div>
          </div>

          <div className="modal-field">
            <span className="modal-field__label">
              {mode === 'update' && applyMode === 'add' ? 'Прибавить (кг)' : 'Вес (кг)'}
            </span>
            <input
              ref={(el) => {
                inputRef.current = el
                if (el) activeInputRef.current = el
              }}
              className="modal-input"
              type="text"
              inputMode="decimal"
              value={rawInput}
              placeholder="0.000"
              onChange={(e) => {
                userEditedRef.current = true
                const v = e.target.value
                if (/^[0-9]*[.,]?[0-9]*$/.test(v) || v === '') setRawInput(v)
              }}
              onKeyDown={handleKeyDown}
              autoComplete="off"
            />
          </div>

          <div className="modal-presets">
            {[0.1, 0.25, 0.5, 1.0].map((val) => (
              <button
                key={val}
                type="button"
                className="modal-preset"
                onClick={() => {
                  userEditedRef.current = true
                  setRawInput(val.toFixed(3))
                }}
              >
                {val < 1 ? `${val * 1000}г` : `${val}кг`}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="modal-scale-btn"
            onClick={handleScaleGet}
            disabled={scaleLoading}
          >
            {scaleLoading ? (
              <>
                <div className="modal-spinner" />
                <span>Получаю с весов…</span>
              </>
            ) : (
              <>
                <IcoScale />
                <span>Получить с весов</span>
              </>
            )}
          </button>
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="modal-btn modal-btn--primary"
            onClick={handleConfirm}
            disabled={previewWeight <= 0}
          >
            {mode === 'update' ? 'Обновить вес' : 'Добавить в чек'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
