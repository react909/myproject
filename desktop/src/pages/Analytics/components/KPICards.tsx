import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react'
import type { KPIItem } from '../AnalyticsPage'

const ICONS: Record<KPIItem['icon'], ReactElement> = {
  revenue: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h4"/>
    </svg>
  ),
  orders: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
      <line x1="3" y1="6" x2="21" y2="6"/>
      <path d="M16 10a4 4 0 0 1-8 0"/>
    </svg>
  ),
  check: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  conversion: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
  ),
  items: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    </svg>
  ),
  returns: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10"/>
      <path d="M3.51 15a9 9 0 1 0 .49-3.96"/>
    </svg>
  ),
}

function Spark({ data, color }: { data: number[]; color: string }) {
  const values = data.length > 0 ? data : [0]
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const W = 120; const H = 36

  const denom = Math.max(values.length - 1, 1)
  const pts = values.map((v, i) => [
    (i / denom) * W,
    H - ((v - min) / range) * (H - 4) - 2,
  ] as [number, number])

  const pathD = pts.reduce((acc, [x, y], i) => {
    if (i === 0) return `M ${x},${y}`
    const [px, py] = pts[i - 1]
    const cx = (px + x) / 2
    return `${acc} C ${cx},${py} ${cx},${y} ${x},${y}`
  }, '')

  const fillD = `${pathD} L ${W},${H} L 0,${H} Z`
  const id = `ksp-${color.replace('#', '')}`

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}
      className="kpi__spark" aria-hidden preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.28"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#${id})`}/>
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function KPICards({ kpis }: { kpis: KPIItem[] }) {
  const refs = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    refs.current.forEach((el, i) => {
      if (!el) return
      el.style.opacity = '0'
      el.style.transform = 'translateY(18px)'
      setTimeout(() => {
        el.style.transition = 'opacity 300ms ease, transform 420ms cubic-bezier(0.34,1.3,0.64,1)'
        el.style.opacity = '1'
        el.style.transform = 'translateY(0)'
      }, i * 60)
    })
  }, [kpis])

  return (
    <div className="kpi__grid">
      {kpis.map((k, i) => (
        <article
          key={k.id}
          ref={el => { refs.current[i] = el }}
          className="kpi__card"
          style={{ '--kc': k.color } as CSSProperties}
        >
          <div className="kpi__top">
            <span className="kpi__icon">{ICONS[k.icon]}</span>
            <span className={`kpi__badge${k.trendUp ? ' kpi__badge--up' : ' kpi__badge--dn'}`}>
              {k.trendUp ? '↑' : '↓'} {k.trend}
            </span>
          </div>
          <div className="kpi__mid">
            <p className="kpi__value">{k.value}</p>
            <p className="kpi__label">{k.label}</p>
          </div>
          <div className="kpi__spark-wrap">
            <Spark data={k.sparkline} color={k.color} />
          </div>
        </article>
      ))}
    </div>
  )
}