/**
 * Выбор режима работы — первый и главный вопрос мастера.
 *
 * Не форма, а две карточки: от ответа зависит, сколько полей человек увидит
 * дальше и что будет напечатано в чеке. Тот же контрол стоит в настройках,
 * потому что режим меняют и после установки — переустановка для этого не
 * нужна.
 */

import { FISCAL_MODES } from './types'
import type { FiscalMode } from './types'
import './FiscalModePicker.css'

type Props = {
  value: FiscalMode
  onChange: (mode: FiscalMode) => void
  disabled?: boolean
}

export function FiscalModePicker({ value, onChange, disabled = false }: Props) {
  return (
    <div className="fmode" role="radiogroup" aria-label="Режим работы кассы">
      {FISCAL_MODES.map((mode) => {
        const selected = value === mode.id
        return (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            className={`fmode__card${selected ? ' is-selected' : ''}`}
            onClick={() => onChange(mode.id)}
          >
            <span className="fmode__head">
              <strong>{mode.label}</strong>
              <span className="fmode__radio" aria-hidden="true">
                <i />
              </span>
            </span>
            <p className="fmode__summary">{mode.summary}</p>
            <p className="fmode__needs">{mode.needs}</p>
          </button>
        )
      })}
    </div>
  )
}
