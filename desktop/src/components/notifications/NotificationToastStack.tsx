import type { CSSProperties } from 'react'
import type { NotificationItem } from './notification.types'
import './NotificationSystem.css'

const KIND_CONFIG: Record<
  NotificationItem['kind'],
  { icon: string; gradient: string; shadow: string }
> = {
  success: {
    icon: '✓',
    gradient: 'linear-gradient(135deg, #51cf66 0%, #37b24d 100%)',
    shadow: 'rgba(55, 178, 77, 0.25)',
  },
  info: {
    icon: 'ℹ',
    gradient: 'linear-gradient(135deg, #74c0fc 0%, #339af0 100%)',
    shadow: 'rgba(51, 154, 240, 0.25)',
  },
  warning: {
    icon: '⚠',
    gradient: 'linear-gradient(135deg, #ffd43b 0%, #fcc419 100%)',
    shadow: 'rgba(252, 196, 25, 0.25)',
  },
  error: {
    icon: '✕',
    gradient: 'linear-gradient(135deg, #ff6b6b 0%, #fa5252 100%)',
    shadow: 'rgba(250, 82, 82, 0.25)',
  },
  update: {
    icon: '↑',
    gradient: 'linear-gradient(135deg, #ff4d4d 0%, #f97316 55%, #ea580c 100%)',
    shadow: 'rgba(239, 68, 68, 0.45)',
  },
}

type Props = {
  items: NotificationItem[]
  onDismiss: (id: string) => void
}

export function NotificationToastStack({ items, onDismiss }: Props) {
  const visible = items.filter((i) => !i.read).slice(-5)

  return (
    <div className="notification-stack" aria-live="polite">
      {visible.map((item) => {
        const config = KIND_CONFIG[item.kind]
        const durationSec = (item.dismissMs ?? 6000) / 1000
        return (
          <div
            key={item.id}
            className={`notification-card notification-card--${item.kind}`}
            style={
              {
                '--notification-gradient': config.gradient,
                '--notification-shadow': config.shadow,
                '--notification-duration': `${durationSec}s`,
              } as CSSProperties
            }
            role="status"
          >
            <div className="notification-card__icon-wrap">
              <div className="notification-card__icon">{config.icon}</div>
            </div>
            <div className="notification-card__body">
              {item.title ? <h4 className="notification-card__title">{item.title}</h4> : null}
              <p className="notification-card__message">{item.message}</p>
            </div>
            <button
              type="button"
              className="notification-card__close"
              onClick={() => onDismiss(item.id)}
              aria-label="Закрыть"
            >
              ×
            </button>
            <div className="notification-card__progress" />
          </div>
        )
      })}
    </div>
  )
}
