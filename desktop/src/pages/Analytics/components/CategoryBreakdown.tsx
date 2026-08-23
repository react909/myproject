import { useEffect, useRef } from 'react'
import type { Category } from '../AnalyticsPage'

export function CategoryBreakdown({ categories }: { categories: Category[] }) {
  const total = categories.reduce((s, c) => s + c.sales, 0)
  const segsRef = useRef<(SVGCircleElement | null)[]>([])

  const R = 72; const C = 2 * Math.PI * R

  useEffect(() => {
    segsRef.current.forEach((el, i) => {
      if (!el) return
      el.style.strokeDasharray = `0 ${C}`
      setTimeout(() => {
        el.style.transition = `stroke-dasharray 500ms cubic-bezier(0.34,1.1,0.64,1) ${i * 100}ms`
        const pct = total > 0 ? categories[i].sales / total : 0
        el.style.strokeDasharray = `${pct * C} ${C}`
      }, 100)
    })
  }, [categories, total, C])

  let offset = 0

  return (
    <section className="cb__card">
      <h3 className="cb__title">Продажи по категориям</h3>

      <div className="cb__body">
        {/* Кольцо */}
        <div className="cb__donut-wrap">
          <svg width="180" height="180" viewBox="0 0 180 180" className="cb__donut">
            {/* Фон */}
            <circle cx="90" cy="90" r={R} fill="none"
              stroke="var(--surface-3)" strokeWidth="20"/>

            {categories.map((c, i) => {
              const pct = total > 0 ? c.sales / total : 0
              const dashOffset = -(offset) * C - C / 4
              offset += pct
              return (
                <circle key={`${c.name}-${i}`}
                  ref={el => { segsRef.current[i] = el }}
                  cx="90" cy="90" r={R}
                  fill="none" stroke={c.color} strokeWidth="20"
                  strokeDasharray={`0 ${C}`}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="butt"
                  style={{ transformOrigin: 'center' }}
                />
              )
            })}

            <text x="90" y="85" textAnchor="middle"
              fontSize="10" fill="var(--text-3)" fontFamily="Inter,sans-serif" fontWeight="600">
              Итого
            </text>
            <text x="90" y="102" textAnchor="middle"
              fontSize="14" fill="var(--text-1)" fontFamily="Inter,sans-serif" fontWeight="800">
              {Math.round(total / 1000)}k сом
            </text>
          </svg>
        </div>

        {/* Список */}
        <div className="cb__list">
          {categories.length === 0 ? (
            <div className="cb__item">
              <span className="cb__name">Нет продаж за период</span>
            </div>
          ) : categories.map((c, i) => (
            <div key={`${c.name}-${i}`} className="cb__item">
              <span className="cb__dot" style={{ background: c.color }}/>
              <span className="cb__name">{c.name}</span>
              <div className="cb__bar-wrap">
                <div className="cb__bar-fill"
                  style={{ width: `${c.percent}%`, background: c.color }}/>
              </div>
              <span className="cb__pct">{c.percent.toFixed(1)}%</span>
              <span className="cb__sales">{c.sales.toLocaleString('ru-RU')} сом</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}