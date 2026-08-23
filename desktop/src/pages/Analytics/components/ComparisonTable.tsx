import type { ComparisonRow } from '../AnalyticsPage'

export function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  return (
    <section className="ct__card">
      <h3 className="ct__title">Сравнение периодов</h3>
      <div className="ct__table-wrap">
        <table className="ct__table">
          <thead>
            <tr>
              <th className="ct__th">Метрика</th>
              <th className="ct__th ct__th--num">Текущий</th>
              <th className="ct__th ct__th--num">Прошлый</th>
              <th className="ct__th ct__th--num">Динамика</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="ct__row">
                <td className="ct__td ct__empty" colSpan={4}>
                  Пока нет данных для сравнения
                </td>
              </tr>
            ) : rows.map((r) => (
              <tr key={r.metric} className="ct__row">
                <td className="ct__td ct__td--metric">{r.metric}</td>
                <td className="ct__td ct__td--cur">{r.current}</td>
                <td className="ct__td ct__td--prev">{r.previous}</td>
                <td className="ct__td">
                  <span className={`ct__change${r.changePositive ? ' ct__change--up' : ' ct__change--dn'}`}>
                    {r.changePositive ? '↑' : '↓'} {r.change}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}