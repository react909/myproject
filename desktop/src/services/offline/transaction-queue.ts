/**
 * Offline queue stub — all sales go directly to local FastAPI/SQLite.
 * Kept for import compatibility with DashboardPage.
 */
import type { CartItem, DiscountMode, PaymentDetails } from '../../right-panel/helpers'

export type QueuedTransaction = {
  id: string
  createdAt: string
  items: CartItem[]
  total: number
  synced: boolean
  payment?: PaymentDetails
  discountMode?: DiscountMode
  discountValue?: string
}

export function enqueueOfflineSale(
  _items: CartItem[],
  _total: number,
  _payment?: PaymentDetails,
  _discount?: { discountMode?: DiscountMode; discountValue?: string },
): QueuedTransaction {
  throw new Error('Офлайн-очередь не используется: сохраняйте продажи в локальный сервер')
}

export function getOfflinePendingCount(): number {
  return 0
}

export function startOfflineQueueWorker(): () => void {
  return () => {}
}

export function startOfflineRetryLoop(): void {
  /* no-op */
}

export function stopOfflineRetryLoop(): void {
  /* no-op */
}
