import { useState } from 'react'
import type { Period } from '../AnalyticsPage'

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today',     label: 'Сегодня'  },
  { id: 'yesterday', label: 'Вчера'    },
  { id: '7days',     label: '7 дней'   },
  { id: '30days',    label: 'Месяц'    },
]

type Props = {
  period: Period
  onPeriodChange: (p: Period) => void
}

export function PeriodSelector({ period, onPeriodChange }: Props) {
  const [from, setFrom] = useState('')
  const [to,   setTo]   = useState('')

  return (
    <div className="ps__wrap">
      <div className="ps__pills">
        {PERIODS.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPeriodChange(p.id)}
            className={`ps__pill${period === p.id ? ' ps__pill--on' : ''}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="ps__custom">
        <div className="ps__field">
          <span className="ps__field-label">От</span>
          <input
            type="date"
            className="ps__input"
            value={from}
            onChange={e => setFrom(e.target.value)}
          />
        </div>
        <div className="ps__sep">—</div>
        <div className="ps__field">
          <span className="ps__field-label">До</span>
          <input
            type="date"
            className="ps__input"
            value={to}
            onChange={e => setTo(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="ps__apply"
          disabled={!from || !to}
          onClick={() => { if (from && to) onPeriodChange('custom') }}
        >
          Применить
        </button>
      </div>
    </div>
  )
}