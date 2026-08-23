import type { Sale } from '../FinancePage'

const IcCard = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>
  </svg>
)
const IcCash = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="20" height="12" rx="2"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
)

export function RecentSales({ sales }: { sales: Sale[] }) {
  return (
    <section className="rs__card">
      <h3 className="rs__title">Последние продажи</h3>
      <div className="rs__list">
        {sales.slice(0, 10).map((s) => (
          <div
            key={s.id}
            className="rs__row"
          >
            <div className="rs__left">
              <span
                className={`rs__method-icon rs__method-icon--${s.method}`}
              >
                {s.method === 'card' ? <IcCard /> : <IcCash />}
              </span>
              <div className="rs__meta">
                <span className="rs__time">{s.time}</span>
                <span className="rs__items">{s.items} позиц.</span>
              </div>
            </div>
            <div className="rs__right">
              <span className="rs__amount">
                {s.amount.toLocaleString('ru-RU')} сом
              </span>
              <span className={`rs__method-label rs__method-label--${s.method}`}>
                {s.method === 'card' ? 'Карта' : s.method === 'mixed' ? 'Смешанная' : 'Наличные'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}