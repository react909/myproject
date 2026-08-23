/**
 * Подтверждение опасного действия — своим окном, а не `window.confirm`.
 *
 * Системное окно браузера здесь не годится по двум причинам, и обе
 * практические, а не про красоту:
 *
 * 1. Оно выглядит чужим. Система собрана так, чтобы не походить на страницу в
 *    браузере, а `confirm` приносит ровно её — с заголовком «127.0.0.1:5173»
 *    и кнопками «ОК / Отмена» системным шрифтом.
 *
 * 2. Оно НЕ УМЕЕТ показывать список. Перед отменой проведения надо показать,
 *    что из документа успели продать, — это несколько строк с количествами.
 *    В `confirm` они уезжают в одну простыню без выравнивания, а на длинном
 *    списке просто обрезаются.
 *
 * Клавиши и фокус берутся у DeskDialog: Enter подтверждает, Esc отменяет,
 * фокус не выходит за окно и возвращается туда, откуда пришёл.
 */

import type { ReactNode } from 'react'
import { DeskDialog } from './DeskDialog'

export function DeskConfirm({
  title,
  message,
  details,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string
  message: string
  /** Подробности: список того, что затронет действие. */
  details?: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <DeskDialog
      title={title}
      confirmLabel={confirmLabel}
      danger={danger}
      busy={busy}
      hint="Enter — подтвердить, Esc — отмена"
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p className="dcf__message">{message}</p>
      {details}
    </DeskDialog>
  )
}
