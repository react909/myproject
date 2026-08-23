/**
 * Отменённый запрос — это не ошибка, и показывать его нельзя.
 *
 * Отмена случается штатно и постоянно: сменили фильтр, ушли с раздела,
 * перерисовался эффект — предыдущий запрос обрывается через `AbortController`.
 * Ловить её приходится по ТРЁМ признакам, и это не перестраховка:
 *
 *   AbortError    — `fetch` и наш собственный `throwIfAborted`;
 *   CanceledError — axios, которым идут запросы вне Electron;
 *   ERR_CANCELED  — код того же axios; имя в старых версиях другое.
 *
 * Проверка ровно по одному имени уже стоила ошибки: раздел «Смена» показывал
 * красную полосу с текстом «canceled» при каждом открытии — второй запрос
 * строгого режима обрывал первый, и обрыв доезжал до экрана как поломка.
 */
export function isAbortError(err: unknown): boolean {
  const anyErr = err as { name?: string; code?: string } | null
  if (!anyErr) return false
  return (
    anyErr.name === 'AbortError' ||
    anyErr.name === 'CanceledError' ||
    anyErr.code === 'ERR_CANCELED'
  )
}

/** Человекочитаемая ошибка CRM без HTML-простыни. */
export function humanizeApiError(err: unknown, fallback = 'Запрос не выполнен'): string {
  const anyErr = err as { response?: { status?: number; data?: unknown }; message?: string }
  const status = anyErr?.response?.status
  const data = anyErr?.response?.data

  if (typeof data === 'string') {
    const text = stripHtml(data).trim()
    if (text) return truncate(text, 240)
  }

  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (obj.detail != null) return truncate(String(obj.detail), 240)
    const parts: string[] = []
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) parts.push(`${key}: ${value.join(', ')}`)
      else if (value != null) parts.push(`${key}: ${String(value)}`)
    }
    if (parts.length > 0) return truncate(parts.join('; '), 240)
  }

  if (status === 404) return 'CRM: операция не найдена (404). Проверьте, что продажа ещё в долгу.'
  if (status === 401 || status === 403) return 'Нет доступа к CRM. Выйдите и войдите снова.'
  if (status === 500) return 'Ошибка сервера CRM (500). Попробуйте позже или другую сумму.'

  const msg = anyErr?.message
  if (msg && !msg.startsWith('HTTP')) return truncate(stripHtml(msg), 240)
  if (status) return `CRM ответила ошибкой (${status})`
  return fallback
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
