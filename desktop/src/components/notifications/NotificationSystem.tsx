// src/components/notifications/NotificationSystem.tsx

import { AnimatePresence, motion } from 'framer-motion'
import './NotificationSystem.css'

export type NoticeKind = 'info' | 'warn' | 'error' | 'success'

export type NoticeItem = {
  id: string
  kind: NoticeKind
  message: string
  title?: string
  dismissMs?: number
}

type NotificationSystemProps = {
  items: NoticeItem[]
  onDismiss: (id: string) => void
}

const KIND_CONFIG: Record<
  NoticeKind,
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
  warn: {
    icon: '⚠',
    gradient: 'linear-gradient(135deg, #ffd43b 0%, #fcc419 100%)',
    shadow: 'rgba(252, 196, 25, 0.25)',
  },
  error: {
    icon: '✕',
    gradient: 'linear-gradient(135deg, #ff6b6b 0%, #fa5252 100%)',
    shadow: 'rgba(250, 82, 82, 0.25)',
  },
}

export function NotificationSystem({ items, onDismiss }: NotificationSystemProps) {
  return (
    <div className="notification-stack" aria-live="polite">
      <AnimatePresence mode="popLayout">
        {items.map((item, index) => {
          const config = KIND_CONFIG[item.kind]
          return (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, x: 100, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 100, scale: 0.85, transition: { duration: 0.2 } }}
              transition={{
                type: 'spring',
                stiffness: 300,
                damping: 30,
                delay: index * 0.05,
              }}
              className={`notification-card notification-card--${item.kind}`}
              style={{
                '--notification-gradient': config.gradient,
                '--notification-shadow': config.shadow,
              } as React.CSSProperties}
              role="status"
              aria-atomic="true"
            >
              <div className="notification-card__icon-wrap">
                <div className="notification-card__icon">{config.icon}</div>
              </div>

              <div className="notification-card__body">
                {item.title && <h4 className="notification-card__title">{item.title}</h4>}
                <p className="notification-card__message">{item.message}</p>
              </div>

              <button
                type="button"
                className="notification-card__close"
                onClick={() => onDismiss(item.id)}
                aria-label="Закрыть уведомление"
              >
                <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              <div className="notification-card__progress" />
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}