import { motion } from 'framer-motion'

export type ConfirmModalProps = {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Отмена',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <motion.div
      className="confirm-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.13 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <motion.div
        className="confirm-card"
        initial={{ scale: 0.93, y: 10, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.93, y: 10, opacity: 0 }}
        transition={{ duration: 0.15, ease: [0.34, 1.4, 0.64, 1] }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cm-title"
      >
        <p className="confirm-card__title" id="cm-title">
          {title}
        </p>
        <p className="confirm-card__message">{message}</p>
        <div className="confirm-card__actions">
          <button type="button" className="confirm-card__cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-card__confirm${danger ? ' confirm-card__confirm--danger' : ''}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
