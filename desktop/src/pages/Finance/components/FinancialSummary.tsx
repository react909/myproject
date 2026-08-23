type Props = {
  revenue: number
  cost: number
  profit: number
  margin: number
  orders: number
  avgCheck: number
}

export function FinancialSummary({ revenue, cost, profit, margin, orders, avgCheck }: Props) {
  const profitPct = revenue > 0 ? (profit / revenue) * 100 : 0
  const costPct = revenue > 0 ? (cost / revenue) * 100 : 0

  return (
    <section className="fs__card">
      <h3 className="fs__title">Итоговая сводка</h3>

      {/* Визуальный стек-бар */}
      <div className="fs__stack-wrap">
        <div className="fs__stack">
          <div
            className="fs__stack-seg fs__stack-seg--profit"
            style={{ width: `${profitPct}%` }}
            title={`Прибыль ${profitPct.toFixed(1)}%`}
          />
          <div
            className="fs__stack-seg fs__stack-seg--cost"
            style={{ width: `${costPct}%` }}
            title={`Себестоимость ${costPct.toFixed(1)}%`}
          />
        </div>
        <div className="fs__stack-legend">
          <span className="fs__stack-dot fs__stack-dot--profit"/>
          <span className="fs__stack-lbl">Прибыль {profitPct.toFixed(0)}%</span>
          <span className="fs__stack-dot fs__stack-dot--cost" style={{ marginLeft: 12 }}/>
          <span className="fs__stack-lbl">Расходы {costPct.toFixed(0)}%</span>
        </div>
      </div>

      {/* Строки */}
      <div className="fs__rows">
        {[
          { label: 'Выручка',       value: `${revenue.toLocaleString('ru-RU')} сом`, cls: '' },
          { label: 'Себестоимость', value: `−${cost.toLocaleString('ru-RU')} сом`,   cls: 'fs__val--red' },
          { label: 'Прибыль',       value: `${profit.toLocaleString('ru-RU')} сом`,  cls: 'fs__val--green fs__row--major' },
          { label: 'Маржа',         value: `${margin.toFixed(1)}%`,                cls: '' },
          { label: 'Заказов',       value: orders.toString(),                       cls: '' },
          { label: 'Средний чек',   value: `${avgCheck.toLocaleString('ru-RU')} сом`, cls: '' },
        ].map(r => (
          <div key={r.label} className={`fs__row ${r.cls.includes('major') ? 'fs__row--major' : ''}`}>
            <span className="fs__lbl">{r.label}</span>
            <span className={`fs__val ${r.cls.replace('fs__row--major', '')}`}>
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}