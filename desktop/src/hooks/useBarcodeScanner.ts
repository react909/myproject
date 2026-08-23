import { useEffect, useRef } from 'react'

const CHAR_GAP_MS = 80
const SCAN_FINISH_MS = 280
const DEFAULT_MIN_LEN = 4
const DEFAULT_MAX_LEN = 32

function isPrintableBarcodeChar(key: string): boolean {
  return key.length === 1 && /^[0-9A-Za-z\-_.]$/.test(key)
}

function isBlockedScanTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  if (t.isContentEditable) return true
  if (t instanceof HTMLTextAreaElement) return true
  if (t instanceof HTMLSelectElement) return true
  if (t instanceof HTMLInputElement) {
    return true
  }
  return false
}

type Options = {
  enabled: boolean
  blocked?: boolean
  onBarcode: (code: string) => void
  minLength?: number
  maxLength?: number
}

/**
 * HID-сканер: быстрый ввод символов + Enter.
 * Работает без фокуса на поле поиска; медленный ручной ввод в input не перехватывается.
 */
export function useBarcodeScanner({
  enabled,
  blocked = false,
  onBarcode,
  minLength = DEFAULT_MIN_LEN,
  maxLength = DEFAULT_MAX_LEN,
}: Options) {
  const onBarcodeRef = useRef(onBarcode)
  onBarcodeRef.current = onBarcode

  useEffect(() => {
    if (!enabled) return

    let buffer = ''
    let lastCharAt = 0

    const reset = () => {
      buffer = ''
      lastCharAt = 0
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (blocked) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.repeat) return

      const now = Date.now()

      if (e.key === 'Escape' && buffer.length > 0) {
        reset()
        return
      }

      if (e.key === 'Enter') {
        const code = buffer.trim()
        const fresh = code.length >= minLength && now - lastCharAt <= SCAN_FINISH_MS
        if (fresh) {
          e.preventDefault()
          e.stopImmediatePropagation()
          onBarcodeRef.current(code)
        }
        reset()
        return
      }

      if (!isPrintableBarcodeChar(e.key)) {
        if (buffer.length > 0 && now - lastCharAt > CHAR_GAP_MS) reset()
        return
      }

      const gap = buffer.length > 0 ? now - lastCharAt : 0
      const fastBurst = buffer.length === 0 || gap <= CHAR_GAP_MS
      const target = e.target
      const inField = isBlockedScanTarget(target)

      if (inField && buffer.length === 0) return

      if (!fastBurst && buffer.length > 0) reset()

      e.preventDefault()
      e.stopImmediatePropagation()

      if (buffer.length === 0) lastCharAt = now
      buffer += e.key
      lastCharAt = now

      if (buffer.length > maxLength) reset()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      reset()
    }
  }, [enabled, blocked, minLength, maxLength])
}
