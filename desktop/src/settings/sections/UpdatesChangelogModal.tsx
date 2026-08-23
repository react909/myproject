import { useEffect } from 'react'
import './UpdatesChangelogModal.css'

export type ChangelogEntry = {
  version: string
  releaseDate?: string
  sizeMb?: number
  features?: string[]
  fixes?: string[]
}

type Props = {
  open: boolean
  changelog: ChangelogEntry | null
  onClose: () => void
  onInstall: () => void
  installing: boolean
  canInstall: boolean
}

export function UpdatesChangelogModal({
  open,
  changelog,
  onClose,
  onInstall,
  installing,
  canInstall,
}: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !changelog) return null

  return (
    <div className="upd-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="upd-modal"
        role="dialog"
        aria-labelledby="upd-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="upd-modal__head">
          <div>
            <h2 id="upd-modal-title" className="upd-modal__title">
              Что нового в v{changelog.version}
            </h2>
            {changelog.releaseDate && (
              <p className="upd-modal__date">{changelog.releaseDate}</p>
            )}
          </div>
          <button type="button" className="upd-modal__close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>

        <div className="upd-modal__body">
          {changelog.features?.length ? (
            <section>
              <h3>Новые функции</h3>
              <ul>
                {changelog.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {changelog.fixes?.length ? (
            <section>
              <h3>Исправления и улучшения</h3>
              <ul>
                {changelog.fixes.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="upd-modal__note">
            <p>Поддержка принтера ESC/POS, весов COM, офлайн-очередь чеков, ускорение кассы.</p>
          </section>
        </div>

        <footer className="upd-modal__foot">
          <button type="button" className="upd-btn upd-btn--ghost" onClick={onClose}>
            Закрыть
          </button>
          {canInstall && (
            <button
              type="button"
              className="upd-btn upd-btn--install"
              onClick={onInstall}
              disabled={installing}
            >
              {installing ? 'Загрузка…' : 'Установить обновление'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
