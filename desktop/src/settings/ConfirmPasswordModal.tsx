import { useState } from 'react'
import './ConfirmPasswordModal.css'

type ConfirmPasswordModalProps = {
  title: string
  description: string
  confirmLabel: string
  /** Чей пароль просят. По умолчанию — владельца; при выходе это пароль
   *  того, кто сейчас за кассой, и подпись должна это отражать. */
  fieldLabel?: string
  danger?: boolean
  busy?: boolean
  error?: string
  onConfirm: (password: string) => void
  onCancel: () => void
}

export function ConfirmPasswordModal({
  title,
  description,
  confirmLabel,
  fieldLabel = 'Пароль владельца',
  danger,
  busy,
  error,
  onConfirm,
  onCancel,
}: ConfirmPasswordModalProps) {
  const [password, setPassword] = useState('')

  return (
    <div className="confirm-pw-modal" role="dialog" aria-modal="true">
      <button type="button" className="confirm-pw-modal__backdrop" onClick={onCancel} aria-label="Закрыть" />
      <form
        className={`confirm-pw-modal__card${danger ? ' confirm-pw-modal__card--danger' : ''}`}
        onSubmit={(e) => {
          e.preventDefault()
          if (password) onConfirm(password)
        }}
      >
        <h2 className="confirm-pw-modal__title">{title}</h2>
        <p className="confirm-pw-modal__desc">{description}</p>

        <label className="confirm-pw-modal__field">
          <span>{fieldLabel}</span>
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </label>

        {error && <p className="confirm-pw-modal__error">{error}</p>}

        <div className="confirm-pw-modal__actions">
          <button type="button" className="confirm-pw-modal__btn confirm-pw-modal__btn--ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </button>
          <button
            type="submit"
            className={`confirm-pw-modal__btn${danger ? ' confirm-pw-modal__btn--danger' : ' confirm-pw-modal__btn--primary'}`}
            disabled={busy || !password}
          >
            {busy ? 'Подождите…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
