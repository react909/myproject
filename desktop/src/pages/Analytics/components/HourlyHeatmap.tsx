import { useState } from 'react'
import type { HourlyPoint } from '../AnalyticsPage'

export function HourlyHeatmap({ data }: { data: HourlyPoint[] }) {
  const points = data.length > 0 ? data : Array.from({ length: 24 }, (_, hour) => ({ hour, sales: 0 }))
  const max = Math.max(...points.map(d => d.sales), 1)
  const [hov, setHov] = useState<number | null>(null)

  /*
    Ступени тепла — прозрачность фирменного цвета, а не отдельная палитра.

    Шкала одноцветная намеренно: она показывает одну величину (продажи за час),
    и различать ступени надо по насыщенности, а не по оттенку. Поэтому здесь
    именно акцент — карта окрашена цветом магазина и меняется вместе с ним.

    Текст на плотных ступенях — --accent-fg, а не белый. На светлом фирменном
    цвете белые цифры в самых горячих клетках пропадали бы совсем, то есть
    ровно там, где карту и читают.
  */
  const getColor = (sales: number) => {
    const t = sales / max
    const heat = (percent: number) => `color-mix(in srgb, var(--accent) ${percent}%, transparent)`
    if (t < 0.2)  return { bg: heat(8),  text: 'var(--text-3)' }
    if (t < 0.45) return { bg: heat(22), text: 'var(--text-2)' }
    if (t < 0.70) return { bg: heat(50), text: 'var(--text-1)' }
    if (t < 0.88) return { bg: heat(75), text: 'var(--accent-fg)' }
    return               { bg: 'var(--accent-active)', text: 'var(--accent-fg)' }
  }

  const peak = points.reduce((a, b) => a.sales > b.sales ? a : b)

  return (
    <section className="hm__card">
      <div className="hm__head">
        <h3 className="hm__title">Продажи по часам</h3>
        <div className="hm__peak">
          Пик: <strong>{peak.hour}:00</strong> — {peak.sales.toLocaleString('ru-RU')} сом
        </div>
      </div>

      {/* Тепловая карта */}
      <div className="hm__grid">
        {points.map(({ hour, sales }) => {
          const { bg, text } = getColor(sales)
          const isHov = hov === hour
          return (
            <div
              key={hour}
              className={`hm__cell${isHov ? ' hm__cell--hov' : ''}`}
              style={{ background: bg, color: text }}
              onMouseEnter={() => setHov(hour)}
              onMouseLeave={() => setHov(null)}
            >
              <span className="hm__cell-hour">{hour}</span>
              <span className="hm__cell-val">
                {sales >= 1000 ? `${(sales / 1000).toFixed(1)}k` : sales || '—'}
              </span>

              {isHov && (
                <div className="hm__cell-tip">
                  <strong>{hour}:00 – {hour + 1}:00</strong>
                  <span>{sales.toLocaleString('ru-RU')} сом</span>
                  <span>{(sales / max * 100).toFixed(0)}% от пика</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Легенда */}
      <div className="hm__legend">
        <span className="hm__leg-label">Мало</span>
        <div className="hm__leg-scale">
          {[8, 22, 45, 70, 92].map(percent => (
            <div key={percent} className="hm__leg-seg"
              style={{ background: `color-mix(in srgb, var(--accent) ${percent}%, transparent)` }}/>
          ))}
        </div>
        <span className="hm__leg-label">Много</span>
      </div>
    </section>
  )
}