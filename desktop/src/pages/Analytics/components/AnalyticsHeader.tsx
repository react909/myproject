import { Link } from 'react-router-dom'

type Props = {
  onRefresh: () => void
  onExport: () => void
  onClear?: () => void
  isRefreshing: boolean
  embedded?: boolean
}

const IcArrow = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5m0 0 7 7m-7-7 7-7"/>
  </svg>
)
const IcRefresh = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 4v6h6M23 20v-6h-6"/>
    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/>
  </svg>
)
const IcExport = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
  </svg>
)

export function AnalyticsHeader({ onRefresh, onExport, onClear, isRefreshing, embedded }: Props) {
  return (
    <header className={`ah${embedded ? ' ah--embedded' : ''}`}>
      <div className="ah__left">
        {!embedded && (
          <Link to="/" className="ah__back">
            <IcArrow /> Касса
          </Link>
        )}
        <div className="ah__title-block">
          <h1 className="ah__title">Аналитика</h1>
          <p className="ah__sub">Глубокий анализ продаж · Поведение клиентов · Тренды</p>
        </div>
      </div>

      <div className="ah__actions">
        <button type="button" className="ah__btn" onClick={onExport}>
          <IcExport />
          <span>Экспорт CSV</span>
        </button>
        {onClear ? (
          <button type="button" className="ah__btn" onClick={onClear}>
            <span>Очистить</span>
          </button>
        ) : null}
        <button
          type="button"
          className={`ah__btn ah__btn--primary${isRefreshing ? ' ah__btn--spin' : ''}`}
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          <IcRefresh />
          <span>{isRefreshing ? 'Обновление...' : 'Обновить'}</span>
        </button>
      </div>
    </header>
  )
}