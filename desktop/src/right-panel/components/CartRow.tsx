import {
  memo, useState, useEffect, useCallback, useRef,
  type MutableRefObject,
} from 'react'
import {
  getLineGross,
  getLineNetTotal,
  getLineDiscountAmount,
  formatMoney,
  parseWeightInput,
  parsePieceQuantityInput,
  clampWeight,
} from '../helpers'
import { IcoPlus, IcoMinus, IcoTrash, IcoCheck } from '../icons'
import type { CartItem } from '../helpers'

type Props = {
  item: CartItem
  image?: string
  index: number
  isNew: boolean
  selectionMode: boolean
  selected: boolean
  onUpdateQuantity: (lineId: string, delta: number) => void
  onUpdatePieceQuantity: (lineId: string, raw: string) => void
  onUpdateWeight: (lineId: string, raw: string) => void
  onAdjustWeight: (lineId: string, delta: number) => void
  onRemoveItem: (lineId: string) => void
  onClearLineDiscount?: (lineId: string) => void
  onOpenWeightEdit: (lineId: string) => void
  activeInputRef: MutableRefObject<HTMLInputElement | null>
}

export const CartRow = memo(function CartRow({
  item, image, index, isNew,
  selectionMode, selected,
  onUpdateQuantity,
  onUpdatePieceQuantity,
  onUpdateWeight, onAdjustWeight,
  onRemoveItem, onClearLineDiscount, onOpenWeightEdit,
  activeInputRef,
}: Props) {
  const [wRaw, setWRaw] = useState(item.weightKg.toFixed(3))
  const [qRaw, setQRaw] = useState(String(item.quantity))
  const prevW = useRef(item.weightKg)
  const prevQ = useRef(item.quantity)

  useEffect(() => {
    if (prevW.current !== item.weightKg) {
      setWRaw(item.weightKg.toFixed(3))
      prevW.current = item.weightKg
    }
  }, [item.weightKg])

  useEffect(() => {
    if (prevQ.current !== item.quantity) {
      setQRaw(String(item.quantity))
      prevQ.current = item.quantity
    }
  }, [item.quantity])

  const commitWeight = useCallback(() => {
    const kg = clampWeight(parseWeightInput(wRaw))
    setWRaw(kg.toFixed(3))
    onUpdateWeight(item.lineId, String(kg))
  }, [wRaw, item.lineId, onUpdateWeight])

  const commitQuantity = useCallback(() => {
    const qty = parsePieceQuantityInput(qRaw)
    setQRaw(String(qty))
    onUpdatePieceQuantity(item.lineId, String(qty))
  }, [qRaw, item.lineId, onUpdatePieceQuantity])

  const gross = getLineGross(item)
  const disc = getLineDiscountAmount(item)
  const net = getLineNetTotal(item)
  const isWeight = item.type === 'weight'

  return (
    <div
      className={[
        'cr',
        index % 2 === 1 ? 'cr--alt' : '',
        selectionMode ? 'cr--sel-mode' : '',
        selected ? 'cr--selected' : '',
        isNew ? 'cr--new' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className={`cr__stripe cr__stripe--${item.type}`} />

      {selectionMode && (
        <div className="cr__sel-cell">
          <div className={`cr__check ${selected ? 'is-on' : ''}`} aria-hidden>
            {selected && <IcoCheck />}
          </div>
        </div>
      )}

      <div className="cr__pic" aria-hidden>
        {image ? (
          <img className="cr__pic-img" src={image} alt="" loading="lazy" />
        ) : (
          <div className="cr__pic-ph" />
        )}
      </div>

      <div className="cr__main">
        <div
          className="cr__info"
          onClick={(e) => {
            if (!selectionMode && isWeight) {
              e.stopPropagation()
              onOpenWeightEdit(item.lineId)
            }
          }}
        >
          <p className="cr__name">{item.name}</p>
          <div className="cr__meta">
            <span className={`cr__tag cr__tag--${item.type}`}>
              {isWeight ? 'Весовой' : 'Штучный'}
            </span>
            <span className="cr__price">
              {formatMoney(item.price)}&nbsp;сом{isWeight ? '/кг' : ''}
            </span>
          </div>
        </div>
      </div>

      <div className="cr__controls" onClick={(e) => e.stopPropagation()}>
        {!isWeight ? (
          <div className="cr__stepper">
            <button
              type="button"
              className="cr__step"
              onClick={() => onUpdateQuantity(item.lineId, -1)}
              aria-label="Убрать 1"
            >
              <IcoMinus />
            </button>
            <input
              className="cr__qty-input"
              type="text"
              inputMode="numeric"
              value={qRaw}
              onChange={(e) => {
                const v = e.target.value
                if (/^\d*$/.test(v)) setQRaw(v)
              }}
              onBlur={commitQuantity}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitQuantity()
                  e.currentTarget.blur()
                }
              }}
              onFocus={(e) => {
                activeInputRef.current = e.currentTarget
                e.currentTarget.select()
              }}
              aria-label="Количество шт"
            />
            <button
              type="button"
              className="cr__step"
              onClick={() => onUpdateQuantity(item.lineId, 1)}
              aria-label="Добавить 1"
            >
              <IcoPlus />
            </button>
          </div>
        ) : (
          <div className="cr__weight">
            <button
              type="button"
              className="cr__step"
              onClick={() => onAdjustWeight(item.lineId, -0.05)}
              aria-label="-50г"
            >
              <IcoMinus />
            </button>
            <input
              className="cr__w-input"
              type="text"
              inputMode="decimal"
              value={wRaw}
              onChange={(e) => {
                const v = e.target.value
                if (/^[0-9]*[.,]?[0-9]*$/.test(v) || v === '') setWRaw(v)
              }}
              onBlur={commitWeight}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { commitWeight(); e.currentTarget.blur() }
              }}
              onFocus={(e) => {
                activeInputRef.current = e.currentTarget
                e.currentTarget.select()
              }}
              aria-label="Вес кг"
            />
            <span className="cr__w-unit">кг</span>
            <button
              type="button"
              className="cr__step"
              onClick={() => onAdjustWeight(item.lineId, 0.05)}
              aria-label="+50г"
            >
              <IcoPlus />
            </button>
          </div>
        )}

        <div className="cr__line-sum">
          {disc > 0 && onClearLineDiscount && (
            <button
              type="button"
              className="cr__disc-pill"
              title="Снять скидку с позиции"
              aria-label="Снять скидку"
              onClick={(e) => {
                e.stopPropagation()
                onClearLineDiscount(item.lineId)
              }}
            >
              <svg viewBox="0 0 16 16" fill="none" className="cr__disc-ico" aria-hidden>
                <path
                  d="M7 2L3 4v4.5c0 2.1 1.3 3.6 3.5 4.4a.8.8 0 0 0 .5 0C9.2 12.1 10.5 10.5 10.5 8.5V4L7 2Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            </button>
          )}
          <span className="cr__total">
            {disc > 0 && (
              <s className="cr__gross" aria-label="Без скидки">
                {formatMoney(gross)}&nbsp;сом
              </s>
            )}{' '}
            <strong className="cr__net">{formatMoney(net)}&nbsp;сом</strong>
          </span>
        </div>
      </div>

      <button
        type="button"
        className="cr__del"
        onClick={(e) => { e.stopPropagation(); onRemoveItem(item.lineId) }}
        aria-label="Удалить товар"
      >
        <IcoTrash />
      </button>
    </div>
  )
})
