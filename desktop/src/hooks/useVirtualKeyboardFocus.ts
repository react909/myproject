import { useEffect } from 'react'
import { loadSettings } from '../settings/appSettings'

/**
 * Открывает встроенную VirtualKeyboard при фокусе на поле ввода (без Windows OSK/TabTip).
 */
export function useVirtualKeyboardFocus(onOpenChange: (open: boolean) => void) {
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const settings = loadSettings()
      if (!settings.system.showKeyboardOnFocus) return

      const t = e.target
      if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return
      if (t.readOnly || t.disabled) return
      if (t.type === 'hidden' || t.type === 'file' || t.type === 'checkbox' || t.type === 'radio') {
        return
      }
      if (t.closest('[data-no-virtual-keyboard]')) return

      onOpenChange(true)
    }

    window.addEventListener('focusin', onFocusIn, true)
    return () => window.removeEventListener('focusin', onFocusIn, true)
  }, [onOpenChange])
}
