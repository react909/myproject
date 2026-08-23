import type { PanelProductKind } from './PanelProductFilterContext'
import './PanelKindFilter.css'

const OPTIONS: { id: PanelProductKind; label: string; hint: string }[] = [
  { id: 'all', label: 'Все товары', hint: 'Полная картина' },
  { id: 'weight', label: 'Весовые', hint: 'Килограммы' },
  { id: 'piece', label: 'Штучные', hint: 'Поштучно' },
]

type Props = {
  value: PanelProductKind
  onChange: (k: PanelProductKind) => void
}

export function PanelKindFilter({ value, onChange }: Props) {
  return (
    <div className="pp-kind" role="group" aria-label="Тип товаров">
      {OPTIONS.map(({ id, label, hint }) => (
        <button
          key={id}
          type="button"
          className={`pp-kind__btn${value === id ? ' pp-kind__btn--on' : ''}`}
          onClick={() => onChange(id)}
          aria-pressed={value === id}
        >
          <span className="pp-kind__label">{label}</span>
          <span className="pp-kind__hint">{hint}</span>
        </button>
      ))}
    </div>
  )
}
