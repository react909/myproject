import { useEffect, useRef, useState } from 'react'
import type { SalesPoint } from '../AnalyticsPage'

type Mode = 'line' | 'bar'

type Tip = {
  index: number
  point: SalesPoint
  side: 'left' | 'center' | 'right'
  xPct: number
  yPct: number
}

const FULL_DAY: Record<string, string> = {
  Пн: 'Понедельник', Вт: 'Вторник', Ср: 'Среда',
  Чт: 'Четверг',    Пт: 'Пятница', Сб: 'Суббота', Вс: 'Воскресенье',
}

const EMPTY_POINTS: SalesPoint[] = [{ label: 'Нет данных', sales: 0, orders: 0 }]

export function SalesChart({ data }: { data: SalesPoint[] }) {
  const [mode, setMode] = useState<Mode>('line')
  const [tip,  setTip]  = useState<Tip | null>(null)
  const points = data.length > 0 ? data : EMPTY_POINTS

  const maxSales  = Math.max(...points.map(d => d.sales), 1)
  const maxOrders = Math.max(...points.map(d => d.orders), 1)
  const total     = points.reduce((s, d) => s + d.sales, 0)
  const avg       = Math.round(total / Math.max(1, points.length))
  const peak      = points.reduce((a, b) => a.sales > b.sales ? a : b)
  const denom     = Math.max(1, points.length - 1)

  const barsRef = useRef<(HTMLDivElement | null)[]>([])
  const svgRef  = useRef<SVGSVGElement>(null)

  /* ── SVG viewport ── */
  const VW = 800
  const VH = 280
  const PL = 8   /* pad left  */
  const PR = 8   /* pad right */
  const PT = 24  /* pad top   */
  const PB = 0   /* pad bottom (метки снаружи) */

  /* Точки выручки */
  const salesPts = points.map((d, i) => [
    PL + (i / denom) * (VW - PL - PR),
    PT + (1 - d.sales  / maxSales)  * (VH - PT - PB),
  ] as [number, number])

  /* Точки заказов */
  const orderPts = points.map((d, i) => [
    PL + (i / denom) * (VW - PL - PR),
    PT + (1 - d.orders / maxOrders) * (VH - PT - PB),
  ] as [number, number])

  /* Сглаженный path */
  function smooth(pts: [number, number][]) {
    return pts.reduce((acc, [x, y], i) => {
      if (i === 0) return `M ${x} ${y}`
      const [px, py] = pts[i - 1]
      const cx = (px + x) / 2
      return `${acc} C ${cx} ${py} ${cx} ${y} ${x} ${y}`
    }, '')
  }

  const salesLine  = smooth(salesPts)
  const ordersLine = smooth(orderPts)
  const salesArea  = `${salesLine} L ${salesPts.at(-1)![0]} ${VH} L ${salesPts[0][0]} ${VH} Z`
  const ordersArea = `${ordersLine} L ${orderPts.at(-1)![0]} ${VH} L ${orderPts[0][0]} ${VH} Z`

  /* Анимация баров */
  useEffect(() => {
    if (mode !== 'bar') return
    barsRef.current.forEach((el, i) => {
      if (!el) return
      el.style.height  = '0%'
      el.style.opacity = '0'
      const pct = ((points[i]?.sales ?? 0) / maxSales * 100).toFixed(1)
      setTimeout(() => {
        el.style.transition =
          `height 420ms cubic-bezier(0.34,1.12,0.64,1) ${i * 45}ms,
           opacity 220ms ease ${i * 45}ms`
        el.style.height  = `${pct}%`
        el.style.opacity = '1'
      }, 60)
    })
    setTip(null)
  }, [mode, points, maxSales])

  /* Ховер на SVG */
  const handleSvgMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const xRel = (e.clientX - rect.left) / rect.width * VW
    let closest = 0
    let minDist = Infinity
    salesPts.forEach(([x], i) => {
      const d = Math.abs(x - xRel)
      if (d < minDist) { minDist = d; closest = i }
    })

    const [cx, cy] = salesPts[closest]
    const xPct = cx / VW * 100
    const yPct = cy / VH * 100
    const side = xPct < 22 ? 'left' : xPct > 78 ? 'right' : 'center'

    setTip({ index: closest, point: points[closest] ?? points[0], side, xPct, yPct })
  }

  /* Y-метки */
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map(t => ({
    val: Math.round(maxSales * t),
    y:   PT + (1 - t) * (VH - PT - PB),
  }))

  return (
    <section className="sc__card">

      {/* ── Шапка ── */}
      <div className="sc__head">
        <div className="sc__head-left">
          <h3 className="sc__title">Динамика продаж</h3>
          <div className="sc__stats">
            <span className="sc__stat">
              <span className="sc__stat-l">Итого</span>
              <span className="sc__stat-v">{total.toLocaleString('ru-RU')} сом</span>
            </span>
            <span className="sc__stat-sep">·</span>
            <span className="sc__stat">
              <span className="sc__stat-l">Среднее</span>
              <span className="sc__stat-v">{avg.toLocaleString('ru-RU')} сом</span>
            </span>
            <span className="sc__stat-sep">·</span>
            <span className="sc__stat">
              <span className="sc__stat-l">Пик</span>
              <span className="sc__stat-v sc__stat-v--gold">
                {FULL_DAY[peak.label] ?? peak.label}: {peak.sales.toLocaleString('ru-RU')} сом
              </span>
            </span>
          </div>
        </div>

        <div className="sc__head-right">
          <div className="sc__legend">
            <span className="sc__leg">
              <span className="sc__leg-dot sc__leg-dot--sales"/>Выручка
            </span>
            <span className="sc__leg">
              <span className="sc__leg-dot sc__leg-dot--orders"/>Заказы
            </span>
          </div>
          <div className="sc__modes">
            {(['line', 'bar'] as const).map(m => (
              <button
                key={m} type="button"
                className={`sc__mode-btn${mode === m ? ' sc__mode-btn--on' : ''}`}
                onClick={() => { setMode(m); setTip(null) }}
              >
                {m === 'line' ? 'Линия' : 'Столбцы'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Тело ── */}
      <div className="sc__body">

        {/* ═══ ЛИНЕЙНЫЙ РЕЖИМ ═══ */}
        {mode === 'line' && (
          <div className="sc__line-wrap">

            {/* Y-ось */}
            <div className="sc__yaxis">
              {yTicks.map(({ val, y }) => (
                <span
                  key={val}
                  className="sc__ylabel"
                  style={{ top: `${y / VH * 100}%` }}
                >
                  {val >= 1000 ? `${Math.round(val / 1000)}k` : val}
                </span>
              ))}
            </div>

            {/* SVG */}
            <div className="sc__svg-wrap">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${VW} ${VH}`}
                className="sc__svg"
                preserveAspectRatio="none"
                onMouseMove={handleSvgMove}
                onMouseLeave={() => setTip(null)}
              >
                <defs>
                  {/*
                    Выручка — главный ряд графика, и красится он фирменным
                    цветом магазина. Через style, а не через атрибут: так
                    значение точно проходит разбор как CSS, и var() в нём
                    работает одинаково во всех сборках.

                    Второй ряд (заказы) остаётся синим намеренно: два ряда на
                    одном поле должны различаться по оттенку, и привязать
                    второй к акценту значило бы слить их при синем фирменном
                    цвете.
                  */}
                  <linearGradient id="scg-sales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   style={{ stopColor: 'var(--accent)' }} stopOpacity="0.28"/>
                    <stop offset="85%"  style={{ stopColor: 'var(--accent)' }} stopOpacity="0.04"/>
                    <stop offset="100%" style={{ stopColor: 'var(--accent)' }} stopOpacity="0"/>
                  </linearGradient>
                  <linearGradient id="scg-orders" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#2e90fa" stopOpacity="0.16"/>
                    <stop offset="100%" stopColor="#2e90fa" stopOpacity="0"/>
                  </linearGradient>
                  <filter id="sc-glow">
                    <feGaussianBlur stdDeviation="3" result="blur"/>
                    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                  </filter>
                </defs>

                {/* Сетка */}
                {yTicks.map(({ y }) => (
                  <line key={y}
                    x1={PL} y1={y} x2={VW - PR} y2={y}
                    stroke="rgba(0,0,0,0.055)" strokeWidth="1"
                    strokeDasharray="4 5"
                  />
                ))}

                {/* Вертикальная линия активного столбца */}
                {tip && (
                  <line
                    x1={salesPts[tip.index][0]}
                    y1={PT}
                    x2={salesPts[tip.index][0]}
                    y2={VH}
                    stroke="rgba(0,0,0,0.10)"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                  />
                )}

                {/* Площадь заказов */}
                <path d={ordersArea} fill="url(#scg-orders)" stroke="none"/>
                {/* Линия заказов */}
                <path
                  d={ordersLine}
                  fill="none"
                  stroke="#2e90fa"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="6 4"
                  opacity="0.65"
                />

                {/* Площадь выручки */}
                <path d={salesArea} fill="url(#scg-sales)" stroke="none"/>
                {/* Линия выручки — фирменным цветом магазина */}
                <path
                  d={salesLine}
                  fill="none"
                  style={{ stroke: 'var(--accent)' }}
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter="url(#sc-glow)"
                />

                {/* Точки выручки */}
                {salesPts.map(([x, y], i) => {
                  const isActive = tip?.index === i
                  const isPeak   = (points[i]?.sales ?? 0) === peak.sales
                  return (
                    <g key={i}>
                      {/* Зона захвата */}
                      <circle cx={x} cy={y} r={16} fill="transparent"/>
                      {/* Внешний круг при активности */}
                      {(isActive || isPeak) && (
                        <circle cx={x} cy={y} r={10}
                          style={{
                            fill: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                            stroke: 'color-mix(in srgb, var(--accent) 30%, transparent)',
                          }}
                          strokeWidth="1"
                        />
                      )}
                      {/* Основная точка. Пик — тем же цветом на тон темнее:
                          выделять его вторым оттенком значило бы завести на
                          графике третий цвет ни за чем. */}
                      <circle
                        cx={x} cy={y}
                        r={isActive ? 6 : isPeak ? 5.5 : 4}
                        style={{
                          fill: isPeak ? 'var(--accent-active)' : 'var(--accent)',
                          stroke: 'var(--bg-surface)',
                          transition: 'r 100ms ease',
                        }}
                        strokeWidth="2.5"
                      />
                    </g>
                  )
                })}

                {/* Точки заказов (маленькие) */}
                {orderPts.map(([x, y], i) => (
                  <circle key={`o-${i}`}
                    cx={x} cy={y} r="3"
                    fill="#2e90fa" stroke="#fff" strokeWidth="1.5"
                    opacity="0.7"
                  />
                ))}
              </svg>

              {/* Тултип */}
              {tip && (
                <div
                  className={`sc__tip sc__tip--${tip.side}`}
                  style={{
                    left: `${tip.xPct}%`,
                    top:  `${tip.yPct}%`,
                  }}
                >
                  <div className="sc__tip-day">
                    {FULL_DAY[tip.point.label] ?? tip.point.label}
                  </div>

                  <div className="sc__tip-row">
                    <span className="sc__tip-dot sc__tip-dot--sales"/>
                    <span className="sc__tip-rl">Выручка</span>
                    <span className="sc__tip-rv">
                      {tip.point.sales.toLocaleString('ru-RU')} сом
                    </span>
                  </div>

                  <div className="sc__tip-row">
                    <span className="sc__tip-dot sc__tip-dot--orders"/>
                    <span className="sc__tip-rl">Заказы</span>
                    <span className="sc__tip-rv">{tip.point.orders} шт.</span>
                  </div>

                  <div className="sc__tip-hr"/>

                  <div className="sc__tip-row">
                    <span className="sc__tip-rl">Средний чек</span>
                    <span className="sc__tip-rv sc__tip-rv--gold">
                      {(tip.point.orders > 0 ? Math.round(tip.point.sales / tip.point.orders) : 0).toLocaleString('ru-RU')} сом
                    </span>
                  </div>

                  <div className="sc__tip-share">
                    <div
                      className="sc__tip-share-bar"
                      style={{ width: `${(total > 0 ? tip.point.sales / total * 100 : 0).toFixed(1)}%` }}
                    />
                    <span>{(total > 0 ? tip.point.sales / total * 100 : 0).toFixed(1)}% от периода</span>
                  </div>

                  <div className={`sc__tip-arrow sc__tip-arrow--${tip.side}`}/>
                </div>
              )}
            </div>

            {/* Подписи X */}
            <div className="sc__xlabels">
              {points.map((d, i) => (
                <span
                  key={`${d.label}-${i}`}
                  className={`sc__xlabel${d.label === peak.label ? ' sc__xlabel--peak' : ''}`}
                >
                  {d.label}
                </span>
              ))}
            </div>

          </div>
        )}

        {/* ═══ БАР РЕЖИМ ═══ */}
        {mode === 'bar' && (
          <div className="sc__bar-wrap">
            <div className="sc__bars">
              {points.map((d, i) => {
                const isPeak = d.sales === peak.sales
                const isHov  = tip?.index === i
                return (
                  <div
                    key={`${d.label}-${i}`}
                    className={`sc__bar-col${isHov ? ' sc__bar-col--hov' : ''}${isPeak ? ' sc__bar-col--peak' : ''}`}
                    onMouseEnter={() => setTip({
                      index: i, point: d, side: 'center', xPct: 0, yPct: 0,
                    })}
                    onMouseLeave={() => setTip(null)}
                  >
                    {/* Тултип для бара */}
                    {isHov && (
                      <div className="sc__bar-tip">
                        <div className="sc__tip-day">{FULL_DAY[d.label] ?? d.label}</div>
                        <div className="sc__tip-row">
                          <span className="sc__tip-dot sc__tip-dot--sales"/>
                          <span className="sc__tip-rl">Выручка</span>
                          <span className="sc__tip-rv">{d.sales.toLocaleString('ru-RU')} сом</span>
                        </div>
                        <div className="sc__tip-row">
                          <span className="sc__tip-dot sc__tip-dot--orders"/>
                          <span className="sc__tip-rl">Заказы</span>
                          <span className="sc__tip-rv">{d.orders} шт.</span>
                        </div>
                        <div className="sc__tip-hr"/>
                        <div className="sc__tip-row">
                          <span className="sc__tip-rl">Ср. чек</span>
                          <span className="sc__tip-rv sc__tip-rv--gold">
                            {(d.orders > 0 ? Math.round(d.sales / d.orders) : 0).toLocaleString('ru-RU')} сом
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Фоновая подсветка */}
                    <div className="sc__bar-bg"/>

                    <div className="sc__bar-inner">
                      <div
                        ref={el => { barsRef.current[i] = el }}
                        className={`sc__bar${isPeak ? ' sc__bar--peak' : ''}`}
                        style={{ height: '0%' }}
                      >
                        {/* Блик */}
                        <div className="sc__bar-shine"/>
                      </div>
                    </div>

                    <span className={`sc__bar-label${isPeak ? ' sc__bar-label--peak' : ''}`}>
                      {d.label}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Значения над барами */}
            <div className="sc__bar-vals">
              {points.map((d, i) => (
                <span key={`${d.label}-${i}`} className="sc__bar-val">
                  {d.sales >= 1000 ? `${(d.sales / 1000).toFixed(1)}k` : d.sales}
                </span>
              ))}
            </div>
          </div>
        )}

      </div>
    </section>
  )
}