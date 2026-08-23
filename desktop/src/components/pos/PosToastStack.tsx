import { AnimatePresence, motion } from 'framer-motion'
import './PosToastStack.css'

export type ToastKind = 'info' | 'warn' | 'error'

export type PosToastItem = {
  id: string
  kind: ToastKind
  message: string
}

type PosToastStackProps = {
  items: PosToastItem[]
  onDismiss: (id: string) => void
}

export function PosToastStack({ items, onDismiss }: PosToastStackProps) {
  return (
    <div className="pos-toast-region" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.18 }}
            className={`pos-toast pos-toast--${t.kind}`}
          >
            <span className="pos-toast__text">{t.message}</span>
            <button type="button" className="pos-toast__close" onClick={() => onDismiss(t.id)} aria-label="Закрыть">
              ×
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
