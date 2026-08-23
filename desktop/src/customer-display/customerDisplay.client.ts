/**
 * Публикация состояния на экран покупателя.
 *
 * Кассовая часть вызывает `publishCustomerDisplay` и не думает о том, есть ли
 * второй монитор. Состояние всегда уходит обоими путями: в окно на внешнем
 * дисплее — через IPC, и событием внутри страницы — для модалки на основном
 * мониторе. Кто из них реально показан, решает `useCustomerDisplayTarget`.
 */

import { CUSTOMER_DISPLAY_EVENT } from './state'
import type { CustomerDisplayState } from './state'

let lastState: CustomerDisplayState | null = null

export function publishCustomerDisplay(state: CustomerDisplayState): void {
  lastState = state
  window.dispatchEvent(new CustomEvent(CUSTOMER_DISPLAY_EVENT, { detail: state }))
  void window.customerDisplayAPI?.push(state)
}

/** Последнее состояние — окно покупателя запрашивает его при открытии. */
export function readLastCustomerState(): CustomerDisplayState | null {
  return lastState
}

/**
 * Поднимает окно на внешнем мониторе, если он есть.
 *
 * Возвращает `attached: false`, когда монитор один — тогда интерфейс кассы
 * показывает то же самое модалкой. Разной вёрстки под эти два случая нет.
 */
export async function attachCustomerDisplay(): Promise<{ attached: boolean; reason?: string }> {
  const api = window.customerDisplayAPI
  if (!api) return { attached: false, reason: 'Второй экран доступен только в приложении Kassir ERP' }
  try {
    return await api.open()
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Не удалось открыть второй экран'
    return { attached: false, reason }
  }
}

export async function detachCustomerDisplay(): Promise<void> {
  await window.customerDisplayAPI?.close()
}
