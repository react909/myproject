import { isProductCartLine, type CartItem } from './helpers'

/** Порядок товарных строк в чеке (без заголовков групп). */
export function getProductLineIds(items: CartItem[]): string[] {
  return items.filter(isProductCartLine).map((i) => i.lineId)
}

/** Диапазон lineId от якоря до текущей строки (включительно). */
export function selectionRangeIds(
  order: string[],
  anchorId: string,
  currentId: string,
): string[] {
  const a = order.indexOf(anchorId)
  const b = order.indexOf(currentId)
  if (a < 0 || b < 0) return []
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return order.slice(lo, hi + 1)
}

export function lineIdFromPoint(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY)
  if (!el) return null
  const row = el.closest('[data-cart-line]')
  return row?.getAttribute('data-cart-line') ?? null
}
