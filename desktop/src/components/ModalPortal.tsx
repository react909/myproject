import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/** Модалки поверх всего UI (панель с overflow/transform не обрезает). */
export function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}
