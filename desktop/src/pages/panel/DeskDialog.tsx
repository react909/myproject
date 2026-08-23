/**
 * Окно ввода для разделов рабочего места.
 *
 * Одно на все три раздела: открытие смены, внесение, изъятие, закрытие,
 * оплата поставщику, карточка поставщика. Три похожих окна в трёх файлах
 * разошлись бы поведением клавиш — а клавиши здесь и есть главное.
 *
 * Что оно делает, кроме рамки:
 *
 *   Esc      закрывает. Всегда, из любого поля;
 *   Enter    подтверждает — но НЕ из многострочного поля и не когда фокус на
 *            кнопке «Отмена»: там Enter означает то, на чём стоишь;
 *   Tab      ходит по полям и не выпускает фокус из окна. Без этого Tab уводит
 *            за окно в таблицу под ним, и человек продолжает печатать туда;
 *   фокус    при открытии встаёт в первое поле, а при закрытии возвращается
 *            туда, откуда окно открыли.
 *
 * Вид тот же терминальный: прямоугольник, скругление 4, граница в пиксель, без
 * теней и градиентов.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { ModalPortal } from '../../components/ModalPortal'

type Props = {
  title: string
  /** Подзаголовок: чем это окно отличается от соседнего. */
  subtitle?: string
  children: ReactNode
  confirmLabel: string
  /** Заблокировать подтверждение — например, пока не введена сумма. */
  confirmDisabled?: boolean
  danger?: boolean
  busy?: boolean
  error?: string
  onConfirm: () => void
  onClose: () => void
  /** Подсказка клавиш в подвале окна — тот же приём, что у полосы внизу. */
  hint?: string
}

const FOCUSABLE =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function DeskDialog({
  title,
  subtitle,
  children,
  confirmLabel,
  confirmDisabled = false,
  danger = false,
  busy = false,
  error,
  onConfirm,
  onClose,
  hint,
}: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const returnRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    // Куда вернуть фокус после закрытия. Снимается ДО того, как окно его
    // заберёт: иначе вернём фокус самому себе.
    returnRef.current = document.activeElement as HTMLElement | null
    const first = cardRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    // Кадр задержки: окно появляется с анимацией, и элемент до неё ещё не
    // расставлен — фокус ушёл бы в никуда.
    const timer = window.setTimeout(() => first?.focus(), 40)
    return () => {
      window.clearTimeout(timer)
      returnRef.current?.focus?.()
    }
  }, [])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }

      if (event.key === 'Tab') {
        // Ловушка фокуса. Список пересобирается на каждое нажатие: поля в окне
        // появляются и исчезают (срок оплаты только при расчёте в долг), и
        // список, снятый один раз при открытии, устарел бы сразу.
        const nodes = Array.from(
          cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
        ).filter((node) => node.offsetParent !== null)
        if (nodes.length === 0) return
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        const active = document.activeElement
        if (event.shiftKey && active === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
        return
      }

      if (event.key === 'Enter') {
        const target = event.target as HTMLElement
        // В многострочном поле Enter — это перевод строки. И на кнопке Enter
        // нажимает ту кнопку, на которой стоишь, а не подтверждает окно.
        if (target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) return
        event.preventDefault()
        if (!confirmDisabled && !busy) onConfirm()
      }
    },
    [confirmDisabled, busy, onConfirm, onClose],
  )

  return (
    <ModalPortal>
      <div
        className="dlg"
        role="presentation"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div className="dlg__card" ref={cardRef} role="dialog" aria-modal="true" aria-label={title}>
          <div className="dlg__head">
            <strong className="dlg__title">{title}</strong>
            {subtitle && <span className="dlg__subtitle">{subtitle}</span>}
          </div>

          <div className="dlg__body">{children}</div>

          {error && (
            <p className="dsk__error" role="alert">
              {error}
            </p>
          )}

          <div className="dlg__foot">
            {hint && <span className="dlg__hint">{hint}</span>}
            <span className="dsk__spacer" />
            <button type="button" className="dsk__btn" onClick={onClose}>
              Отмена
            </button>
            <button
              type="button"
              className={`dsk__btn ${danger ? 'dsk__btn--danger' : 'dsk__btn--primary'}`}
              onClick={onConfirm}
              disabled={confirmDisabled || busy}
            >
              {busy ? 'Подождите…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
