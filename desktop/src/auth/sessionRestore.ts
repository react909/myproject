import { normalizeAccountKey } from '../services/accountSession'

const LAST_ACCOUNT_KEY = 'nurcrm-last-account'

export function readStoredUsername(): string | null {
  const email = localStorage.getItem('nurcrm-user-email')
  if (email?.trim()) return email.trim()
  try {
    const raw = localStorage.getItem('nurcrm-user')
    if (!raw) return null
    const user = JSON.parse(raw) as { email?: string; username?: string }
    if (user.email?.trim()) return user.email.trim()
    if (user.username?.trim()) return user.username.trim()
  } catch {
    /* ignore */
  }
  return null
}

export function hasStoredAuthToken(): boolean {
  return Boolean(localStorage.getItem('nurcrm-token')?.trim())
}

/** Восстановить сессию после перезапуска приложения (токен уже в localStorage). */
export function restoreStoredSession(): { username: string } | null {
  if (!hasStoredAuthToken()) return null
  const username = readStoredUsername()
  if (!username) return null
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, normalizeAccountKey(username))
  } catch {
    /* ignore */
  }
  return { username }
}
