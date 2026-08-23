import { invalidateAllRuntimeCaches } from './accountSession'
import { invalidateReceiptsCache } from './receipts'

/** Сброс клиентских кэшей после успешной синхронизации оффлайн-продаж. */
export function invalidateCrmDataCaches(): void {
  invalidateReceiptsCache()
  invalidateAllRuntimeCaches()
}