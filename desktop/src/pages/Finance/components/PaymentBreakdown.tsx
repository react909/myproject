import { useEffect, useRef } from 'react'
import type { Payment } from '../FinancePage'

const IcCard = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="3"/>
    <path d="M2 10h20"/>
  </svg>
)
const IcCash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="20" height="12" rx="2"/>
    <circle cx="12" cy="12" r="3"/>
    <path d="M6 12h.01M18 12h.01"/>
  </svg>
)

/* Кольцевая диаграмма SVG */
function DonutChart({ payments }: { payments: Payment[] }) {
  const total = payments.reduce((s, p) => s + p.amount, 0)
  const R = 52
  const C = 2 * Math.PI * R
  let offset = 0

  const segments = payments.map(p => {
    const pct = total > 0 ? p.amount / total : 0
    const seg = { color: p.color, dash: pct * C, off: offset, pct }
    offset += pct * C
    return seg
  })

  return (
    <div className="pb__donut-wrap">
      <svg width="130" height="130" viewBox="0 0 130 130" className="pb__donut">
        {/* Фон */}
        <circle cx="65" cy="65" r={R} fill="none"
          stroke="var(--surface-3)" strokeWidth="14"/>

        {segments.map((s, i) => (
          <circle key={i} cx="65" cy="65" r={R}
            fill="none"
            stroke={s.color}
            strokeWidth="14"
            strokeDasharray={`${s.dash} ${C - s.dash}`}
            strokeDashoffset={C / 4 - s.off}
            strokeLinecap="butt"
            style={{ transition: `stroke-dasharray 600ms cubic-bezier(0.34,1.2,0.64,1) ${i * 100}ms` }}
          />
        ))}

        {/* Центральный текст */}
        <text x="65" y="60" textAnchor="middle"
          fontSize="11" fill="var(--text-3)" fontFamily="Inter, sans-serif"
          fontWeight="500">
          Итого
        </text>
        <text x="65" y="76" textAnchor="middle"
          fontSize="13" fill="var(--text-1)" fontFamily="Inter, sans-serif"
          fontWeight="700">
          {Math.round(total / 1000)}k сом
        </text>
      </svg>
    </div>
  )
}

export function PaymentBreakdown({ payments }: { payments: Payment[] }) {
  const fillRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    fillRefs.current.forEach((el, i) => {
      if (!el) return
      el.style.width = '0%'
      setTimeout(() => {
        el.style.transition = `width 500ms cubic-bezier(0.34,1.1,0.64,1) ${i * 120}ms`
        el.style.width = `${payments[i]?.percent ?? 0}%`
      }, 120)
    })
  }, [payments])

  return (
    <section className="pb__card">
      <h3 className="pb__title">Разбивка оплат</h3>

      <DonutChart payments={payments} />

      <div className="pb__list">
        {payments.map((p, i) => (
          <div key={p.type} className="pb__item">
            <div className="pb__item-head">
              <span className="pb__item-icon" style={{ color: p.color, background: `${p.color}18` }}>
                {p.icon === 'card' ? <IcCard /> : <IcCash />}
              </span>
              <span className="pb__item-type">{p.type}</span>
              <span className="pb__item-pct">{p.percent.toFixed(1)}%</span>
            </div>
            <p className="pb__item-amount">
              {p.amount.toLocaleString('ru-RU')} сом
            </p>
            <div className="pb__bar">
              <div
                ref={el => { fillRefs.current[i] = el }}
                className="pb__bar-fill"
                style={{ background: p.color, width: '0%' }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}