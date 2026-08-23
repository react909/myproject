import { Link } from 'react-router-dom'
import type { AnalyticsMode } from '../../../onboarding/types'

type Props = {
  period: 'day' | 'week' | 'month'
  onPeriodChange: (p: 'day' | 'week' | 'month') => void
  onRefresh: () => void
  onExport?: () => void
  onClear?: () => void
  isRefreshing: boolean
  embedded?: boolean
  revenue: number
  /** Выручка минус себестоимость проданного. */
  profit?: number
  /**
   * Какая цифра идёт главной. Единственное, на что режим влияет здесь: обе
   * цифры считаются всегда, меняется только то, какая стоит крупно первой.
   */
  analyticsMode?: AnalyticsMode
  revenueChange: string
  revenuePositive: boolean
}

const PERIODS = [
  { id: 'day'   as const, label: 'День'    },
  { id: 'week'  as const, label: 'Неделя'  },
  { id: 'month' as const, label: 'Месяц'   },
]

export function FinanceHeader({
  period, onPeriodChange, onRefresh, onExport, onClear,
  isRefreshing, embedded, revenue, profit = 0, analyticsMode = 'revenue',
  revenueChange, revenuePositive,
}: Props) {
  // Главная цифра и её расшифровка. Считаются обе всегда — режим только
  // меняет, какая из них стоит крупно, а какая уходит подписью ниже.
  const profitMode = analyticsMode === 'profit'
  const mainLabel = profitMode ? 'Прибыль за период' : 'Выручка за период'
  const mainValue = profitMode ? profit : revenue
  const subLine = profitMode
    ? `Выручка ${revenue.toLocaleString('ru-RU')} · расходы ${Math.max(0, revenue - profit).toLocaleString('ru-RU')}`
    : ''

  return (
    <header className={`fh${embedded ? ' fh--embedded' : ''}`}>
      <div className="fh__top">
        {!embedded && (
          <Link to="/" className="fh__back">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5m0 0 7 7m-7-7 7-7"/>
            </svg>
            Касса
          </Link>
        )}

        <div className="fh__title-block">
          <h1 className="fh__title">Финансы</h1>
          <p className="fh__sub">Полный финансовый обзор</p>
        </div>

        <div className="fh__actions">
          {/* Переключатель периода */}
          <div className="fh__periods">
            {PERIODS.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPeriodChange(p.id)}
                className={`fh__period-btn${period === p.id ? ' fh__period-btn--on' : ''}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {onExport ? (
            <button
              type="button"
              onClick={onExport}
              className="fh__export"
              title="Скачать отчёт CSV"
            >
              CSV
            </button>
          ) : null}

          {/* Кнопка обновить */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className={`fh__refresh${isRefreshing ? ' fh__refresh--spin' : ''}`}
            title="Обновить"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v6h6M23 20v-6h-6"/>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
          </button>
          {onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="fh__refresh"
              title="Очистить локальную статистику"
            >
              0
            </button>
          ) : null}
        </div>
      </div>

      {/* Быстрая плашка с главной метрикой */}
      <div className="fh__kpi-strip">
        <div className="fh__kpi">
          <span className="fh__kpi-label">{mainLabel}</span>
          <div className="fh__kpi-row">
            <span className="fh__kpi-value">
              {mainValue.toLocaleString('ru-RU')} сом
            </span>
            <span className={`fh__kpi-badge${revenuePositive ? ' fh__kpi-badge--up' : ' fh__kpi-badge--down'}`}>
              {revenuePositive ? '↑' : '↓'} {revenueChange}
            </span>
          </div>
          {/* Расшифровка: в режиме прибыли выручка и расходы не прячутся,
              а уходят строкой ниже — иначе главную цифру не проверить. */}
          {subLine && <span className="fh__kpi-sub">{subLine}</span>}
        </div>

        <div className="fh__kpi-divider" />

        <div className="fh__kpi">
          <span className="fh__kpi-label">Статус смены</span>
          <div className="fh__kpi-row">
            <span className="fh__kpi-status">
              <span className="fh__kpi-dot" />
              Открыта
            </span>
          </div>
        </div>

        <div className="fh__kpi-divider" />

        <div className="fh__kpi">
          <span className="fh__kpi-label">Последнее обновление</span>
          <span className="fh__kpi-time">
            {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </header>
  )
}