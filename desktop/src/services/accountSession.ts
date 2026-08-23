import { lockPin } from '../auth/servicePin'
import { invalidatePanelDataCache } from '../hooks/usePanelAsyncLoad'
import { invalidateMemoryCache } from './requestCache'

const LAST_ACCOUNT_KEY = 'nurcrm-last-account'

/** Базы ключей localStorage, которые должны быть изолированы по аккаунту. */
export const ACCOUNT_SCOPED_STORAGE_BASES = [
  'nurcrm-products-cache-v1',
  'nurcrm-dashboard-state',
  'nurcrm-panel-demo-products',
  'nurcrm-cashbox-id',
] as const

export function normalizeAccountKey(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9@._-]+/gi, '_') || 'anonymous'
}

/** Текущий аккаунт по сохранённому email / профилю. */
export function getCurrentAccountKey(): string {
  const email = localStorage.getItem('nurcrm-user-email')
  if (email) return normalizeAccountKey(email)
  try {
    const raw = localStorage.getItem('nurcrm-user')
    if (raw) {
      const user = JSON.parse(raw) as { email?: string; id?: string | number }
      if (user.email) return normalizeAccountKey(String(user.email))
      if (user.id != null) return `id_${user.id}`
    }
  } catch {
    /* ignore */
  }
  return 'anonymous'
}

export function scopedStorageKey(base: string, accountKey = getCurrentAccountKey()): string {
  return `${base}:${accountKey}`
}

function removeStorageKeysMatching(base: string): void {
  const drop: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue
    if (key === base || key.startsWith(`${base}:`)) drop.push(key)
  }
  for (const key of drop) localStorage.removeItem(key)
}

/** Удаляет все локальные данные кассы (все аккаунты + legacy-ключи без суффикса). */
export function clearAllAccountLocalData(): void {
  for (const base of ACCOUNT_SCOPED_STORAGE_BASES) {
    removeStorageKeysMatching(base)
  }
}

/** Сброс in-memory кэшей и оповещение экранов перезагрузить данные. */
export function invalidateAllRuntimeCaches(): void {
  invalidateMemoryCache()
  invalidatePanelDataCache()
  window.dispatchEvent(new CustomEvent('nurcrm-account-changed'))
  window.dispatchEvent(new CustomEvent('nurcrm-data-invalidated'))
}

/** Вызывается сразу после успешного входа (до загрузки кассы). */
export function prepareAccountSession(email: string): boolean {
  const next = normalizeAccountKey(email)
  const prev = localStorage.getItem(LAST_ACCOUNT_KEY)
  const switched = Boolean(prev && prev !== next)

  // Кто бы ни зашёл — скрытые разделы начинают закрытыми. Иначе кассир,
  // сменивший владельца за кассой, унаследовал бы его открытый доступ.
  lockPin()

  // Legacy-ключи без суффикса аккаунта (старый баг — один кэш на всех).
  for (const base of ACCOUNT_SCOPED_STORAGE_BASES) {
    localStorage.removeItem(base)
  }

  if (switched) {
    clearAllAccountLocalData()
  }

  localStorage.setItem(LAST_ACCOUNT_KEY, next)
  invalidateAllRuntimeCaches()
  return switched
}

/** Полный выход: токены + локальные данные + runtime-кэши. */
export function clearAccountSession(): void {
  lockPin()
  clearAllAccountLocalData()
  localStorage.removeItem(LAST_ACCOUNT_KEY)
  localStorage.removeItem('nurcrm-token')
  localStorage.removeItem('nurcrm-refresh-token')
  localStorage.removeItem('nurcrm-user')
  localStorage.removeItem('nurcrm-user-email')
  localStorage.removeItem('nurcrm-last-username')
  try {
    sessionStorage.removeItem('nurcrm-pos-user')
  } catch {
    /* ignore */
  }
  invalidateAllRuntimeCaches()
}
