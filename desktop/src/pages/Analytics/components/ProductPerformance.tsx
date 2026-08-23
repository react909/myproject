import { memo, useMemo, useState } from 'react'
import type { Product, ProductKind } from '../AnalyticsPage'

const MEDALS = ['🥇', '🥈', '🥉']

export const ProductPerformance = memo(function ProductPerformance({
  top,
  worst,
  externalKind,
  onProductClick,
}: {
  top: Product[]
  worst: Product[]
  externalKind?: ProductKind
  onProductClick?: (name: string) => void
}) {
  const [kind, setKind] = useState<'all' | ProductKind>('all')
  const activeKind = externalKind ?? kind
  const topF = useMemo(
    () => (activeKind === 'all' ? top : top.filter((p) => p.kind === activeKind)),
    [top, activeKind],
  )
  const worstF = useMemo(
    () => (activeKind === 'all' ? worst : worst.filter((p) => p.kind === activeKind)),
    [worst, activeKind],
  )
  const maxRev = Math.max(...topF.map((p) => p.revenue), 1)
  const maxWorstRev = Math.max(...worstF.map((p) => p.revenue), 1)

  return (
    <section className="pp2__card">
      <div className="pp2__head pp2__head--filter">
        <h3 className="pp2__title">Производительность товаров</h3>
        {!externalKind && (
          <div className="pp2__seg" role="group" aria-label="Тип товара">
            {(['all', 'weight', 'piece'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`pp2__seg-btn${kind === k ? ' pp2__seg-btn--on' : ''}`}
                onClick={() => setKind(k)}
              >
                {k === 'all' ? 'Все' : k === 'weight' ? 'Весовые' : 'Штучные'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pp2__grid">
        {/* Топ */}
        <div className="pp2__block">
          <div className="pp2__block-head pp2__block-head--top">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
              <polyline points="17 6 23 6 23 12"/>
            </svg>
            Топ товаров
          </div>
          <div className="pp2__list">
            {topF.length === 0 ? (
              <div className="pp2__empty">Нет товаров в категории</div>
            ) : (
              topF.map((p, i) => (
              <div
                key={`${p.name}-${i}`}
                className={`pp2__row${onProductClick ? ' pp2__row--click' : ''}`}
                onClick={onProductClick ? () => onProductClick(p.name) : undefined}
                role={onProductClick ? 'button' : undefined}
                tabIndex={onProductClick ? 0 : undefined}
              >
                <span className="pp2__rank">{i < 3 ? MEDALS[i] : `#${i + 1}`}</span>
                <div className="pp2__info">
                  <div className="pp2__name-row">
                    <span className="pp2__name">{p.name}</span>
                    <span className="pp2__trend pp2__trend--up">↑ {p.trend}%</span>
                  </div>
                  <div className="pp2__bar-wrap">
                    <div className="pp2__bar-fill pp2__bar-fill--top"
                      style={{ width: `${(p.revenue / maxRev) * 100}%` }}/>
                  </div>
                  <div className="pp2__meta">
                    <span className="pp2__sold">
                      {p.kind === 'weight' ? `${p.sold} кг` : `${p.sold} шт.`}
                    </span>
                    <span className="pp2__rev">{p.revenue.toLocaleString('ru-RU')} сом</span>
                  </div>
                </div>
              </div>
              ))
            )}
          </div>
        </div>

        {/* Мало продаются */}
        <div className="pp2__block">
          <div className="pp2__block-head pp2__block-head--worst">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/>
              <polyline points="17 18 23 18 23 12"/>
            </svg>
            Мало продаются
          </div>
          <div className="pp2__list">
            {worstF.length === 0 ? (
              <div className="pp2__empty">Нет товаров в категории</div>
            ) : (
              worstF.map((p, i) => (
              <div
                key={`${p.name}-${i}`}
                className={`pp2__row${onProductClick ? ' pp2__row--click' : ''}`}
                onClick={onProductClick ? () => onProductClick(p.name) : undefined}
                role={onProductClick ? 'button' : undefined}
                tabIndex={onProductClick ? 0 : undefined}
              >
                <span className="pp2__rank pp2__rank--worst">#{i + 1}</span>
                <div className="pp2__info">
                  <div className="pp2__name-row">
                    <span className="pp2__name">{p.name}</span>
                    <span className="pp2__trend pp2__trend--dn">↓ {Math.abs(p.trend)}%</span>
                  </div>
                  <div className="pp2__bar-wrap">
                    <div className="pp2__bar-fill pp2__bar-fill--worst"
                      style={{ width: `${(p.revenue / maxWorstRev) * 100}%` }}/>
                  </div>
                  <div className="pp2__meta">
                    <span className="pp2__sold">
                      {p.kind === 'weight' ? `${p.sold} кг` : `${p.sold} шт.`}
                    </span>
                    <span className="pp2__rev">{p.revenue.toLocaleString('ru-RU')} сом</span>
                  </div>
                </div>
              </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  )
})
