import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChartPoint } from '../FinancePage'

type Props = {
  data: ChartPoint[]          // выручка
  prevData?: ChartPoint[]     // прошлый период (кол-во продаж)
  mode: 'week' | 'hour'
  onModeChange: (m: 'week' | 'hour') => void
}

type Tip = {
  colIndex: number
  colRect: DOMRect
  chartRect: DOMRect
  point: ChartPoint
  prev?: ChartPoint
  pct: number
  diffAbs: number
  shareOfTotal: number
}

export function RevenueChart({ data, prevData, mode, onModeChange }: Props) {
  const points = data.length > 0 ? data : [{ label: 'Нет данных', value: 0 }]
  const previousPoints = prevData?.length ? prevData : undefined
  const maxRev  = Math.max(...points.map(d => d.value), 1)
  const maxPrev = previousPoints ? Math.max(...previousPoints.map(d => d.value), 1) : 1

  const total   = points.reduce((s, d) => s + d.value, 0)
  const avg     = Math.round(total / points.length)
  const peak    = points.reduce((a, b) => a.value > b.value ? a : b)

  const revBarsRef  = useRef<(HTMLDivElement | null)[]>([])
  const prevBarsRef = useRef<(HTMLDivElement | null)[]>([])
  const chartRef    = useRef<HTMLDivElement>(null)
  const wrapRef     = useRef<HTMLDivElement>(null)

  const [tip, setTip]     = useState<Tip | null>(null)
  const [tipSide, setTipSide] = useState<'left' | 'right' | 'center'>('center')

  /* Анимация баров */
  useEffect(() => {
    revBarsRef.current.forEach((el, i) => {
      if (!el) return
      el.style.height = '0%'
      el.style.opacity = '0'
      const pct = (points[i]?.value ?? 0) / maxRev * 100
      setTimeout(() => {
        el.style.transition =
          `height 420ms cubic-bezier(0.34,1.12,0.64,1) ${i * 40}ms,
           opacity 220ms ease ${i * 40}ms`
        el.style.height = `${pct.toFixed(1)}%`
        el.style.opacity = '1'
      }, 60)
    })

    prevBarsRef.current.forEach((el, i) => {
      if (!el) return
      el.style.height = '0%'
      const pct = previousPoints?.[i]?.value ? (previousPoints[i].value / maxPrev * 100) : 0
      setTimeout(() => {
        el.style.transition =
          `height 380ms cubic-bezier(0.34,1.12,0.64,1) ${i * 40 + 100}ms`
        el.style.height = `${pct.toFixed(1)}%`
      }, 60)
    })

    setTip(null)
  }, [points, previousPoints, maxRev, maxPrev])

  /* Позиция тултипа: не обрезается */
  useLayoutEffect(() => {
    if (!tip || !wrapRef.current) return
    const wrapRect = wrapRef.current.getBoundingClientRect()
    const colCenterX = tip.colRect.left - tip.chartRect.left + tip.colRect.width / 2
    const third = wrapRect.width / 3
    if (colCenterX < third)            setTipSide('left')
    else if (colCenterX > third * 2)   setTipSide('right')
    else                               setTipSide('center')
  }, [tip])

  const handleEnter = (e: React.MouseEvent<HTMLDivElement>, i: number) => {
    if (!chartRef.current) return
    const colRect   = e.currentTarget.getBoundingClientRect()
    const chartRect = chartRef.current.getBoundingClientRect()
    const prev      = previousPoints?.[i]
    const point     = points[i] ?? points[0]
    const diffAbs   = prev ? point.value - prev.value : 0
    const pct       = prev ? (diffAbs / prev.value) * 100 : 0
    setTip({
      colIndex: i,
      colRect, chartRect,
      point, prev,
      pct, diffAbs,
      shareOfTotal: total > 0 ? point.value / total * 100 : 0,
    })
  }

  /* Y-ось — 5 засечек */
  const yTicks = [maxRev, maxRev * 0.75, maxRev * 0.5, maxRev * 0.25, 0].map(Math.round)

  /* Полные названия дней */
  const fullDayMap: Record<string, string> = {
    Пн: 'Понедельник', Вт: 'Вторник', Ср: 'Среда',
    Чт: 'Четверг', Пт: 'Пятница', Сб: 'Суббота', Вс: 'Воскресенье',
  }

  return (
    <section className="rc__card">
      {/* Шапка */}
      <div className="rc__head">
        <div className="rc__head-left">
          <h3 className="rc__title">Динамика выручки</h3>
          <div className="rc__stats">
            <span className="rc__stat">
              <span className="rc__stat-l">Итого</span>
              <span className="rc__stat-v">{total.toLocaleString('ru-RU')} сом</span>
            </span>
            <span className="rc__stat-sep">·</span>
            <span className="rc__stat">
              <span className="rc__stat-l">Среднее</span>
              <span className="rc__stat-v">{avg.toLocaleString('ru-RU')} сом</span>
            </span>
            <span className="rc__stat-sep">·</span>
            <span className="rc__stat">
              <span className="rc__stat-l">Пик</span>
              <span className="rc__stat-v rc__stat-v--gold">
                {fullDayMap[peak.label] ?? peak.label}: {peak.value.toLocaleString('ru-RU')} сом
              </span>
            </span>
          </div>
        </div>

        <div className="rc__head-right">
          {/* Легенда */}
          <div className="rc__legend">
            <span className="rc__leg">
              <span className="rc__leg-dot rc__leg-dot--rev"/>
              Выручка
            </span>
            {previousPoints && (
              <span className="rc__leg">
                <span className="rc__leg-dot rc__leg-dot--qty"/>
                Продажи
              </span>
            )}
          </div>

          {/* Режимы */}
          <div className="rc__modes">
            {(['week', 'hour'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                className={`rc__mode-btn${mode === m ? ' rc__mode-btn--on' : ''}`}
              >
                {m === 'week' ? 'Неделя' : 'По часам'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Тело */}
      <div className="rc__body" ref={chartRef}>
        <div className="rc__chart-wrap" ref={wrapRef}>

          {/* Y-ось */}
          <div className="rc__yaxis">
            {yTicks.map((v, i) => (
              <div key={i} className="rc__ytick">
                <span className="rc__ylabel">
                  {v >= 1000 ? `${Math.round(v / 1000)}k` : v}
                </span>
                <div className="rc__ygrid"/>
              </div>
            ))}
          </div>

          {/* Бары */}
          <div className="rc__bars-wrap">
            {points.map((d, i) => {
              const isPeak = d.value === peak.value
              const isHov  = tip?.colIndex === i

              return (
                <div
                  key={`col-${i}`}
                  className={`rc__col${isHov ? ' rc__col--hov' : ''}${isPeak ? ' rc__col--peak' : ''}`}
                  onMouseEnter={e => handleEnter(e, i)}
                  onMouseLeave={() => setTip(null)}
                >
                  {/* Подсветка колонки при ховере */}
                  <div className="rc__col-highlight"/>

                  <div className="rc__bars-inner">
                    {/* Серый бар — продажи (prevData) */}
                    {previousPoints && (
                      <div className="rc__bar-track rc__bar-track--qty">
                        <div
                          ref={el => { prevBarsRef.current[i] = el }}
                          className="rc__bar rc__bar--qty"
                          style={{ height: '0%' }}
                        />
                      </div>
                    )}
                    {/* Золотой бар — выручка */}
                    <div className="rc__bar-track rc__bar-track--rev">
                      <div
                        ref={el => { revBarsRef.current[i] = el }}
                        className={`rc__bar rc__bar--rev${isPeak ? ' rc__bar--peak' : ''}`}
                        style={{ height: '0%' }}
                      />
                    </div>
                  </div>

                  {/* Метка дня */}
                  <span className="rc__col-label" title={fullDayMap[d.label] ?? d.label}>
                    {d.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Тултип — рендерится внутри rc__body, z-index поверх всего */}
        {tip && (() => {
          const colCenter = tip.colRect.left - tip.chartRect.left + tip.colRect.width / 2
          const topPos    = tip.colRect.top  - tip.chartRect.top

          /* Сдвигаем тултип чтобы не обрезался */
          let transformX = '-50%'
          if (tipSide === 'left')  transformX = '0%'
          if (tipSide === 'right') transformX = '-100%'

          return (
            <div
              className="rc__tip"
              style={{
                left:      colCenter,
                top:       topPos,
                transform: `translateX(${transformX}) translateY(calc(-100% - 12px))`,
              }}
            >
              {/* День */}
              <div className="rc__tip-header">
                <span className="rc__tip-day">
                  {fullDayMap[tip.point.label] ?? tip.point.label}
                </span>
              </div>

              {/* Выручка */}
              <div className="rc__tip-row">
                <span className="rc__tip-dot rc__tip-dot--rev"/>
                <span className="rc__tip-rl">Выручка</span>
                <span className="rc__tip-rv">
                  {tip.point.value.toLocaleString('ru-RU')} сом
                </span>
              </div>

              {/* Продажи */}
              {tip.prev && (
                <div className="rc__tip-row">
                  <span className="rc__tip-dot rc__tip-dot--qty"/>
                  <span className="rc__tip-rl">Продажи</span>
                  <span className="rc__tip-rv rc__tip-rv--dim">
                    {tip.prev.value.toLocaleString('ru-RU')} сом
                  </span>
                </div>
              )}

              {/* Разделитель */}
              <div className="rc__tip-hr"/>

              {/* Динамика */}
              {tip.prev && (
                <div className={`rc__tip-diff${tip.pct >= 0 ? ' rc__tip-diff--up' : ' rc__tip-diff--dn'}`}>
                  <span className="rc__tip-diff-pct">
                    {tip.pct >= 0 ? '↑' : '↓'} {Math.abs(tip.pct).toFixed(1)}%
                  </span>
                  <span className="rc__tip-diff-abs">
                    {tip.diffAbs >= 0 ? '+' : '−'}{Math.abs(tip.diffAbs).toLocaleString('ru-RU')} сом
                  </span>
                </div>
              )}

              {/* Доля */}
              <div className="rc__tip-share">
                <div
                  className="rc__tip-share-bar"
                  style={{ width: `${tip.shareOfTotal}%` }}
                />
                <span>{tip.shareOfTotal.toFixed(1)}% от периода</span>
              </div>

              {/* Стрелка */}
              <div className={`rc__tip-arrow rc__tip-arrow--${tipSide}`}/>
            </div>
          )
        })()}
      </div>
    </section>
  )
}