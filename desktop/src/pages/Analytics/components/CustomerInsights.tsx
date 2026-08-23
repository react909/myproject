type Props = {
  avgCheck: number
  avgCheckTrend?: number
  frequency: number
  frequencyTrend?: number
  newCustomers: number
  returningCustomers: number
}

export function CustomerInsights({
  avgCheck, avgCheckTrend,
  frequency, frequencyTrend,
  newCustomers, returningCustomers,
}: Props) {
  const total = newCustomers + returningCustomers
  const newPct = total > 0 ? (newCustomers / total * 100).toFixed(0) : '0'
  const retPct = total > 0 ? (returningCustomers / total * 100).toFixed(0) : '0'

  return (
    <section className="ci__card">
      <h3 className="ci__title">Поведение клиентов</h3>

      {/* Метрики */}
      <div className="ci__metrics">
        <div className="ci__metric">
          <span className="ci__metric-label">Средний чек</span>
          <p className="ci__metric-value">{avgCheck.toLocaleString('ru-RU')} сом</p>
          {avgCheckTrend != null && (
            <span className={`ci__trend${avgCheckTrend > 0 ? ' ci__trend--up' : ' ci__trend--dn'}`}>
              {avgCheckTrend > 0 ? '↑' : '↓'} {Math.abs(avgCheckTrend).toFixed(1)}%
            </span>
          )}
        </div>
        <div className="ci__metric-sep"/>
        <div className="ci__metric">
          <span className="ci__metric-label">Частота покупок</span>
          <p className="ci__metric-value">{frequency.toFixed(1)} <span className="ci__metric-unit">раз/нед</span></p>
          {frequencyTrend != null && (
            <span className={`ci__trend${frequencyTrend > 0 ? ' ci__trend--up' : ' ci__trend--dn'}`}>
              {frequencyTrend > 0 ? '↑' : '↓'} {Math.abs(frequencyTrend).toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      {/* Стек новые/постоянные */}
      <div className="ci__split-wrap">
        <div className="ci__split-head">
          <span className="ci__split-label">Структура клиентов</span>
          <span className="ci__split-total">{total} всего</span>
        </div>

        <div className="ci__split-bar">
          <div className="ci__split-seg ci__split-seg--new"
            style={{ width: `${newPct}%` }}
            title={`Новые: ${newCustomers}`}/>
          <div className="ci__split-seg ci__split-seg--ret"
            style={{ width: `${retPct}%` }}
            title={`Постоянные: ${returningCustomers}`}/>
        </div>

        <div className="ci__split-legend">
          <div className="ci__split-item">
            <span className="ci__split-dot ci__split-dot--new"/>
            <span className="ci__split-name">Новые</span>
            <span className="ci__split-count">{newCustomers}</span>
            <span className="ci__split-pct">{newPct}%</span>
          </div>
          <div className="ci__split-item">
            <span className="ci__split-dot ci__split-dot--ret"/>
            <span className="ci__split-name">Постоянные</span>
            <span className="ci__split-count">{returningCustomers}</span>
            <span className="ci__split-pct">{retPct}%</span>
          </div>
        </div>
      </div>
    </section>
  )
}