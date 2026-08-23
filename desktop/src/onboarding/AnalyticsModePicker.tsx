/**
 * Выбор главной цифры дашборда.
 *
 * Стоит на месте бывшего «режима склада» и намеренно в том же виде: карточка
 * с радио-точкой, объяснением и строкой «кому это подходит».
 *
 * Разница по существу в том, что этот выбор ничего не отключает. Учёт в базе
 * одинаковый в обоих режимах: все продажи и все расходы пишутся всегда, и
 * переключение меняет только то, какая цифра вынесена на первый план. Поэтому
 * его и можно менять в любой момент — пересчитывать нечего, терять нечего.
 *
 * Компонент общий для мастера первого запуска и настроек владельца: заводить
 * второй такой же экран значило бы завести и второе поведение.
 */

import { ANALYTICS_MODES } from './types'
import type { AnalyticsMode } from './types'

export function AnalyticsModePicker({
  value,
  onChange,
}: {
  value: AnalyticsMode
  onChange: (mode: AnalyticsMode) => void
}) {
  return (
    <div className="ow__cards ow__cards--wide" role="radiogroup" aria-label="Как считать аналитику">
      {ANALYTICS_MODES.map((mode) => {
        const selected = value === mode.id
        return (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`ow__card${selected ? ' is-selected' : ''}`}
            onClick={() => onChange(mode.id)}
          >
            <span className="ow__card-head">
              <strong>{mode.label}</strong>
              <span className="ow__radio" aria-hidden="true">
                <i />
              </span>
            </span>
            <p>{mode.hint}</p>
            {/* Ради чего это выбирают — по этой строке человек и узнаёт свой случай. */}
            <small>{mode.suits}</small>
          </button>
        )
      })}
    </div>
  )
}
