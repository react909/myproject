import type { ReactElement } from 'react'
import './FilterTabs.css'

export type ProductFilter = 'weight' | 'piece'

type FilterTabsProps = {
  value: ProductFilter
  onChange: (value: ProductFilter) => void
  counts: Record<ProductFilter, number>
}

function IconWeight() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M6 6.5A3 3 0 0 1 12 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5 8h8l1.6 6.8A1.5 1.5 0 0 1 13.15 16H4.85A1.5 1.5 0 0 1 3.4 14.8L5 8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="9" cy="11.5" r="1" fill="currentColor" />
    </svg>
  )
}

function IconPiece() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 2.5L14.5 5.5L9 8.5L3.5 5.5L9 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M14.5 5.5v5.5L9 14l-5.5-3V5.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 8.5V14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

const TABS: { key: ProductFilter; label: string; Icon: () => ReactElement }[] = [
  { key: 'weight', label: 'Весовые', Icon: IconWeight },
  { key: 'piece', label: 'Штучные', Icon: IconPiece },
]

export function FilterTabs({ value, onChange, counts }: FilterTabsProps) {
  return (
    <div className="filter-tabs" role="tablist" aria-label="Фильтр товаров">
      {TABS.map(({ key, label, Icon }) => (
        <button
          key={key}
          className={`filter-tabs__tab${value === key ? ' is-active' : ''}`}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
        >
          <Icon />
          <span className="filter-tabs__label">{label}</span>
          <span className="filter-tabs__count">{counts[key]}</span>
        </button>
      ))}
    </div>
  )
}