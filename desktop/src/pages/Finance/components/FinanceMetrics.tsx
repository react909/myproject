import { useEffect, useId, useRef, type ReactElement } from 'react'
import type { Metric } from '../FinancePage'

const ICONS: Record<Metric['icon'], ReactElement> = {
  revenue: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="3"/>
      <path d="M2 10h20M6 15h4"/>
    </svg>
  ),
  orders: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
      <line x1="3" y1="6" x2="21" y2="6"/>
      <path d="M16 10a4 4 0 0 1-8 0"/>
    </svg>
  ),
  check: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  profit: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  ),
  cost: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
    </svg>
  ),
  margin: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="5" x2="5" y2="19"/>
      <circle cx="6.5" cy="6.5" r="2.5"/>
      <circle cx="17.5" cy="17.5" r="2.5"/>
    </svg>
  ),
}

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const uid = useId().replace(/:/g, '')
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const W = 200
  const H = 52

  const denom = Math.max(data.length - 1, 1)
  const pts = data.map((v, i) => {
    const x = (i / denom) * W
    const y = H - ((v - min) / range) * (H - 6) - 3
    return [x, y] as [number, number]
  })

  const pathD = pts.reduce((acc, [x, y], i) => {
    if (i === 0) return `M ${x},${y}`
    const [px, py] = pts[i - 1]
    const cpx = (px + x) / 2
    return `${acc} C ${cpx},${py} ${cpx},${y} ${x},${y}`
  }, '')

  const fillD = `${pathD} L ${W},${H} L 0,${H} Z`
  const color = positive ? '#12b76a' : '#f04438'
  const gradId = `spg-${positive ? 'up' : 'dn'}-${uid}`

  return (
    <svg
      width={W} height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="fm__spark"
      aria-hidden
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.30"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#${gradId})`}/>
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function FinanceMetrics({ metrics }: { metrics: Metric[] }) {
  const refs = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    refs.current.forEach((el, i) => {
      if (!el) return
      el.style.opacity = '0'
      el.style.transform = 'translateY(20px)'
      setTimeout(() => {
        el.style.transition =
          `opacity 300ms ease, transform 420ms cubic-bezier(0.34,1.3,0.64,1)`
        el.style.opacity = '1'
        el.style.transform = 'translateY(0)'
      }, i * 65)
    })
  }, [metrics])

  return (
    <div className="fm__grid">
      {metrics.map((m, i) => (
        <article
          key={m.id}
          ref={el => { refs.current[i] = el }}
          className={`fm__card fm__card--${m.color}`}
        >
          {/* Верх: иконка + бейдж */}
          <div className="fm__top">
            <span className="fm__icon">{ICONS[m.icon]}</span>
            <span className={`fm__badge fm__badge--${m.changePositive ? 'up' : 'dn'}`}>
              {m.changePositive ? '↑' : '↓'} {m.change}
            </span>
          </div>

          {/* Значение крупно */}
          <div className="fm__mid">
            <p className="fm__value">{m.value}</p>
            <p className="fm__label">{m.label}</p>
          </div>

          {/* Спарклайн — во всю ширину */}
          <div className="fm__spark-wrap">
            <Sparkline data={m.sparkline} positive={m.changePositive} />
          </div>
        </article>
      ))}
    </div>
  )
}