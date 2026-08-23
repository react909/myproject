import { useCallback, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { loadSettings } from '../settings/appSettings'
import { isProductCartLine, type CartItem } from '../right-panel/helpers'

const SLASH_CODE = ['8', '5', '2', '0'] as const
const ARM_MS = 5500
const QUICK_CODE_MAX_GAP_MS = 450

function keyEventDigit(e: KeyboardEvent): string | null {
  if (/^[0-9]$/.test(e.key)) return e.key
  const numpadMatch = /^Numpad([0-9])$/.exec(e.code)
  if (numpadMatch) return numpadMatch[1]!
  const navKeyMap: Record<string, string> = {
    'End': '1', 'ArrowDown': '2', 'PageDown': '3',
    'ArrowLeft': '4', 'Clear': '5', 'ArrowRight': '6',
    'Home': '7', 'ArrowUp': '8', 'PageUp': '9', 'Insert': '0',
  }
  if (e.code.startsWith('Numpad') && navKeyMap[e.key]) {
    return navKeyMap[e.key]
  }
  return null
}

function isBlockedTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  if (t instanceof HTMLSelectElement) return true
  if (t.isContentEditable) return true
  if (t instanceof HTMLTextAreaElement) return true
  if (t instanceof HTMLInputElement) {
    const type = t.type
    if (type === 'password' || type === 'email' || type === 'number') return true
    if (t.closest('.settings-section, .modal-card, .pay-modal')) return true
    return false
  }
  return false
}

type Options = {
  enabled: boolean
  blocked: boolean
  cartItems: CartItem[]
  selectionMode: boolean
  selectedIds: Set<string>
  setSelectionMode: (v: boolean) => void
  setSelectedIds: (ids: Set<string>) => void
  onUpdateQuantity: (lineId: string, delta: number) => void
  clearSelection: () => void
  onStripeSelectArmed?: () => void
}

export function usePosCartKeyboard({
  enabled,
  blocked,
  cartItems,
  selectionMode,
  selectedIds,
  setSelectionMode,
  setSelectedIds,
  onUpdateQuantity,
  clearSelection,
}: Options) {
  const cartRef = useRef(cartItems)
  const selectionModeRef = useRef(selectionMode)
  const selectedIdsRef = useRef(selectedIds)
  const slashRef = useRef({ armed: false, step: 0, t: null as number | null })
  const quickRef = useRef({ step: 0, ts: 0 })

  cartRef.current = cartItems
  selectionModeRef.current = selectionMode
  selectedIdsRef.current = selectedIds

  const clearSlash = useCallback(() => {
    const r = slashRef.current
    if (r.t) window.clearTimeout(r.t)
    r.armed = false
    r.step = 0
    r.t = null
  }, [])

  const armSlash = useCallback(() => {
    const r = slashRef.current
    if (r.t) window.clearTimeout(r.t)
    r.armed = true
    r.step = 0
    r.t = window.setTimeout(clearSlash, ARM_MS)
  }, [clearSlash])

  const bumpSlash = useCallback(() => {
    const r = slashRef.current
    if (r.t) window.clearTimeout(r.t)
    r.t = window.setTimeout(clearSlash, ARM_MS)
  }, [clearSlash])

  const activateStripeSelectMode = useCallback(() => {
    const products = cartRef.current.filter(isProductCartLine)
    if (products.length === 0) return
    flushSync(() => {
      setSelectionMode(true)
      setSelectedIds(new Set(products.map((p) => p.lineId)))
    })
  }, [setSelectionMode, setSelectedIds])

  useEffect(() => {
    if (!enabled) return

    const onKey = (e: KeyboardEvent) => {
      if (blocked) return
      if (e.repeat && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return

      const products = cartRef.current.filter(isProductCartLine)
      const slashArmed = slashRef.current.armed
      const isSlash = e.code === 'Slash' || e.key === '/'
      const digit = keyEventDigit(e)

      const stripeCodeEnabled = loadSettings().system.showKeyboardOnFocus

      if (!stripeCodeEnabled) {
        quickRef.current.step = 0
      } else if (!isSlash && digit != null && !isBlockedTarget(e.target)) {
        const q = quickRef.current
        const now = Date.now()
        if (q.step > 0 && now - q.ts > QUICK_CODE_MAX_GAP_MS) q.step = 0
        if (digit === SLASH_CODE[q.step]) {
          q.step += 1
          q.ts = now
          if (q.step >= SLASH_CODE.length) {
            e.preventDefault()
            e.stopImmediatePropagation()
            activateStripeSelectMode()
            q.step = 0
            clearSlash()
            return
          }
        } else {
          q.step = digit === SLASH_CODE[0] ? 1 : 0
          q.ts = now
        }
      } else if (!isSlash) {
        quickRef.current.step = 0
      }

      if (!isSlash && !slashArmed && isBlockedTarget(e.target)) return

      if (isSlash) {
        if (!stripeCodeEnabled || products.length === 0) return
        e.preventDefault()
        e.stopImmediatePropagation()
        flushSync(() => setSelectionMode(true))
        armSlash()
        return
      }

      if (slashArmed && digit != null) {
        if (!stripeCodeEnabled) {
          clearSlash()
          return
        }
        e.preventDefault()
        e.stopImmediatePropagation()
        const r = slashRef.current
        if (digit === SLASH_CODE[r.step]) {
          r.step += 1
          if (r.step >= SLASH_CODE.length) {
            activateStripeSelectMode()
            clearSlash()
          } else {
            bumpSlash()
          }
        } else {
          clearSlash()
        }
        return
      }

      if (slashArmed && digit == null) {
        clearSlash()
      }

      if (isBlockedTarget(e.target)) return

      if (e.key === 'F1') {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (products.length === 0) return
        if (!selectionModeRef.current) {
          clearSlash()
          flushSync(() => {
            setSelectionMode(true)
            setSelectedIds(new Set([products[0]!.lineId]))
          })
          return
        }
        clearSelection()
        return
      }

      if (!selectionModeRef.current) return
      if (products.length === 0) return

      // FIX: если selection пуст после F1 clear, не обрабатывать +/-
      const hasSelection = products.some((p) => selectedIdsRef.current.has(p.lineId))
      if (!hasSelection) return

      const picked = products.find((p) => selectedIdsRef.current.has(p.lineId)) ?? products[0]!
      if (!picked) return

      const numpadPlus = e.code === 'NumpadAdd'
      const numpadMinus = e.code === 'NumpadSubtract'
      const mainPlus = e.key === '+' || (e.shiftKey && e.code === 'Equal')
      const mainMinus = e.key === '-' || e.code === 'Minus'

      if (picked.type === 'piece' && (numpadPlus || numpadMinus || mainPlus || mainMinus)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const delta = numpadPlus || mainPlus ? 1 : numpadMinus || mainMinus ? -1 : 0
        if (delta !== 0) onUpdateQuantity(picked.lineId, delta)
        return
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopImmediatePropagation()
        let idx = products.findIndex((p) => selectedIdsRef.current.has(p.lineId))
        if (idx < 0) idx = 0
        const next = e.key === 'ArrowUp' ? Math.max(0, idx - 1) : Math.min(products.length - 1, idx + 1)
        const line = products[next]
        if (line) flushSync(() => setSelectedIds(new Set([line.lineId])))
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      clearSlash()
    }
  }, [
    enabled, blocked, armSlash, bumpSlash, clearSlash,
    activateStripeSelectMode, clearSelection,
    setSelectionMode, setSelectedIds, onUpdateQuantity,
  ])

  return { activateStripeSelectMode }
}