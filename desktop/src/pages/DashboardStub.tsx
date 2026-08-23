import { Link } from 'react-router-dom'

/**
 * Заглушка: в проекте отсутствует DashboardPage (экран кассы).
 * После восстановления замените маршрут «/» на <DashboardPage />.
 */
export function DashboardStub() {
  return (
    <div className="screen-shell" style={{ padding: 32, maxWidth: 520, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>Касса</h1>
      <p style={{ color: 'var(--fg-muted)', lineHeight: 1.5, marginBottom: 16 }}>
        Файл экрана кассы в репозитории не найден. Откройте панель управления или настройки.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Link
          to="/panel"
          style={{
            padding: '10px 18px',
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            borderRadius: 10,
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Панель управления
        </Link>
        <Link
          to="/settings"
          style={{
            padding: '10px 18px',
            border: '1px solid var(--border)',
            borderRadius: 10,
            fontWeight: 600,
            textDecoration: 'none',
            color: 'var(--fg)',
          }}
        >
          Настройки
        </Link>
      </div>
    </div>
  )
}
