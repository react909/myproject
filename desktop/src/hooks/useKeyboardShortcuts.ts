// src/hooks/useKeyboardShortcuts.ts

import { useEffect } from 'react'

type K = {
  onPay: () => void
  onDelLast: () => void
  onEsc: () => void
  /** Enter обрабатывают модалы оплаты / успеха */
  blockEnter?: boolean
  /** Рабочий стол кассы: Enter по выбранной строке — вместо оплаты */
  useEnterForLineAction?: boolean
  onEnterLineAction?: () => void
}

export function useKeyboardShortcuts({
  onPay,
  onDelLast,
  onEsc,
  blockEnter = false,
  useEnterForLineAction = false,
  onEnterLineAction,
}: K) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const editable = t instanceof HTMLInputElement
        || t instanceof HTMLTextAreaElement
        || t instanceof HTMLSelectElement
        || !!t?.isContentEditable
      if (e.key === 'Escape') { e.preventDefault(); onEsc(); return }
      if (editable) return
      if (e.key === 'Enter') {
        if (blockEnter) return
        e.preventDefault()
        if (useEnterForLineAction && onEnterLineAction) {
          onEnterLineAction()
          return
        }
        onPay()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onDelLast() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onPay, onDelLast, onEsc, blockEnter, useEnterForLineAction, onEnterLineAction])
}
