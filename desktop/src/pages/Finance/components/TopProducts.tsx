import { useMemo, useState } from 'react'
import type { Product, ProductKind } from '../FinancePage'

const MEDALS = ['🥇', '🥈', '🥉']

export function TopProducts({
  products,
  externalKind,
  onProductClick,
}: {
  products: Product[]
  /** Глобальный фильтр панели — скрывает локальные переключатели */
  externalKind?: ProductKind
  onProductClick?: (name: string) => void
}) {
  const [kind, setKind] = useState<'all' | ProductKind>('all')
  const activeKind = externalKind ?? kind
  const filtered = useMemo(
    () =>
      activeKind === 'all' ? products : products.filter((p) => p.kind === activeKind),
    [products, activeKind],
  )
  const maxRev = Math.max(...filtered.map((p) => p.revenue), 1)

  return (
    <section className="tp__card">
      <div className="tp__head">
        <h3 className="tp__title">Топ товаров</h3>
        {!externalKind && (
          <div className="tp__seg" role="group" aria-label="Тип товара">
            {(['all', 'weight', 'piece'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`tp__seg-btn${kind === k ? ' tp__seg-btn--on' : ''}`}
                onClick={() => setKind(k)}
              >
                {k === 'all' ? 'Все' : k === 'weight' ? 'Весовые' : 'Штучные'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="tp__list">
        {filtered.length === 0 ? (
          <div className="tp__empty">Нет товаров в выбранной категории</div>
        ) : (
          filtered.map((p, i) => (
          <div
            key={`${p.name}-${i}`}
            className={`tp__row${onProductClick ? ' tp__row--click' : ''}`}
            onClick={onProductClick ? () => onProductClick(p.name) : undefined}
            onKeyDown={onProductClick ? (e) => e.key === 'Enter' && onProductClick(p.name) : undefined}
            role={onProductClick ? 'button' : undefined}
            tabIndex={onProductClick ? 0 : undefined}
          >
            <span className="tp__rank">
              {i < 3 ? MEDALS[i] : `#${i + 1}`}
            </span>

            <div className="tp__info">
              <div className="tp__name-row">
                <span className="tp__name">{p.name}</span>
                <span className={`tp__trend${p.trend >= 0 ? ' tp__trend--up' : ' tp__trend--down'}`}>
                  {p.trend >= 0 ? '↑' : '↓'} {Math.abs(p.trend)}%
                </span>
              </div>
              <div className="tp__bar-wrap">
                <div
                  className="tp__bar-fill"
                  style={{ width: `${(p.revenue / maxRev) * 100}%` }}
                />
              </div>
              <div className="tp__meta">
                <span className="tp__sold">
                  {p.kind === 'weight' ? `${p.sold} кг` : `${p.sold} шт.`}
                </span>
                <span className="tp__revenue">
                  {p.revenue.toLocaleString('ru-RU')} сом
                </span>
              </div>
            </div>
          </div>
          ))
        )}
      </div>
    </section>
  )
}