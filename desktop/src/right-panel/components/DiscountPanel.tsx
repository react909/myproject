// src/right-panel/components/DiscountPanel.tsx

import { memo, type MutableRefObject } from 'react'
import { formatMoney, type DiscountMode } from '../helpers'

type Props = {
  mode: DiscountMode
  value: string
  previewAmount: number
  selectionMode: boolean
  selectedCount: number
  onModeChange: (mode: DiscountMode) => void
  onValueChange: (value: string) => void
  onApply: () => void
  activeInputRef: MutableRefObject<HTMLInputElement | null>
}

export const DiscountPanel = memo(function DiscountPanel({
  mode,
  value,
  previewAmount,
  selectionMode,
  selectedCount,
  onModeChange,
  onValueChange,
  onApply,
  activeInputRef,
}: Props) {
  const targetHint =
    selectionMode && selectedCount > 0
      ? `Скидка на ${selectedCount} выбр. поз.`
      : 'Скидка на весь чек'

  return (
    <div className="discount-panel">
      <p className="discount-panel__hint">{targetHint}</p>
      <div className="discount-panel__row">
        <div className="discount-panel__modes">
          <button
            type="button"
            className={`discount-panel__mode-btn ${mode === 'amount' ? 'is-active' : ''}`}
            onClick={() => onModeChange('amount')}
          >
            Сом
          </button>
          <button
            type="button"
            className={`discount-panel__mode-btn ${mode === 'percent' ? 'is-active' : ''}`}
            onClick={() => onModeChange('percent')}
          >
            %
          </button>
        </div>
        <input
          className="discount-panel__input"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onFocus={(e) => {
            activeInputRef.current = e.currentTarget
          }}
          inputMode="decimal"
          autoComplete="off"
          placeholder={mode === 'percent' ? '0' : '0.00'}
          aria-label={mode === 'percent' ? 'Процент скидки' : 'Скидка в сомах'}
        />
      </div>
      {mode === 'amount' && (
        <p className="discount-panel__hint discount-panel__hint--sub">
          Без «Применить» — каждая позиция получает полную сумму. С «Применить» — сумма делится между выбранными.
        </p>
      )}
      {previewAmount > 0 && (
        <p className="discount-panel__preview">
          Списание: <strong>−{formatMoney(previewAmount)} сом</strong>
        </p>
      )}
      <button type="button" className="discount-panel__apply" onClick={onApply}>
        Применить
      </button>
    </div>
  )
})
