import type { NotificationItem } from './notification.types'
import './NotificationCenter.css'

type Props = {
  open: boolean
  items: NotificationItem[]
  onClose: () => void
  onMarkAllRead: () => void
  onDismiss: (id: string) => void
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export function NotificationCenter({
  open,
  items,
  onClose,
  onMarkAllRead,
  onDismiss,
}: Props) {
  const sorted = [...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  if (!open) return null

  return (
    <>
      <button
        type="button"
        className="nc-backdrop"
        aria-label="Закрыть центр уведомлений"
        onClick={onClose}
      />
      <aside
        className="nc-panel"
        role="dialog"
        aria-label="Центр уведомлений"
      >
        <header className="nc-panel__hd">
          <h2>Уведомления</h2>
          <button type="button" className="nc-panel__mark" onClick={onMarkAllRead}>
            Прочитать все
          </button>
          <button type="button" className="nc-panel__close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>
        <div className="nc-panel__list">
          {sorted.length === 0 ? (
            <p className="nc-panel__empty">Нет уведомлений</p>
          ) : (
            sorted.map((n) => (
              <article
                key={n.id}
                className={`nc-item nc-item--${n.kind}${n.read ? ' nc-item--read' : ''}`}
              >
                <span className="nc-item__dot" aria-hidden />
                <div className="nc-item__body">
                  {n.title ? <strong>{n.title}</strong> : null}
                  <p>{n.message}</p>
                  <time>{formatTime(n.createdAt)}</time>
                </div>
                <button type="button" onClick={() => onDismiss(n.id)} aria-label="Удалить">
                  ×
                </button>
              </article>
            ))
          )}
        </div>
      </aside>
    </>
  )
}
