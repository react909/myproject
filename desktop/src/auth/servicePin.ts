/**
 * Сервисный PIN владельца: закрывает настройки, аналитику и финансы.
 *
 * PIN проверяет сервер (POST /api/auth/pin/unlock) — здесь хранится только
 * срок, до которого разделы считаются открытыми. Срок живёт в sessionStorage,
 * а не в localStorage: закрыли приложение — доступ закрылся, даже если смена
 * не завершалась.
 *
 * Это защита от посторонних за прилавком, а не от того, кто умеет открыть
 * инструменты разработчика: сами API отчётов дополнительной проверки не
 * требуют, экран — единственная дверь.
 */

import { apiGet, apiPost } from '../api/client'

const UNLOCK_UNTIL_KEY = 'nurcrm-pin-unlock-until'
const UNLOCK_EVENT = 'nurcrm-pin-lock-changed'

/** Запас на случай, если сервер вернёт неожиданное значение. */
const DEFAULT_UNLOCK_MINUTES = 15

function readUnlockUntil(): number {
  try {
    const raw = sessionStorage.getItem(UNLOCK_UNTIL_KEY)
    const value = raw ? Number(raw) : 0
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

function writeUnlockUntil(timestamp: number): void {
  try {
    if (timestamp > 0) sessionStorage.setItem(UNLOCK_UNTIL_KEY, String(timestamp))
    else sessionStorage.removeItem(UNLOCK_UNTIL_KEY)
  } catch {
    /* приватный режим — тогда доступ просто не запоминается */
  }
  window.dispatchEvent(new CustomEvent(UNLOCK_EVENT))
}

export function isPinUnlocked(): boolean {
  return readUnlockUntil() > Date.now()
}

/** Сколько миллисекунд осталось до автоблокировки (0 — уже закрыто). */
export function pinUnlockRemainingMs(): number {
  return Math.max(0, readUnlockUntil() - Date.now())
}

/** Проверяет PIN на сервере и открывает разделы. Бросает исключение с текстом ошибки. */
export async function unlockWithPin(pin: string): Promise<void> {
  const res = await apiPost('/api/auth/pin/unlock', { pin })
  const minutes = Number(res?.data?.unlock_minutes) || DEFAULT_UNLOCK_MINUTES
  writeUnlockUntil(Date.now() + minutes * 60_000)
}

/** Закрывает разделы вручную — при выходе из аккаунта и по кнопке «Закрыть доступ». */
export function lockPin(): void {
  writeUnlockUntil(0)
}

/** Задан ли PIN вообще (установки со старых версий могут его не иметь). */
export async function isPinConfigured(): Promise<boolean> {
  try {
    const res = await apiGet('/api/auth/pin/status')
    return Boolean(res?.data?.configured)
  } catch {
    // Недоступность статуса не должна открывать двери: считаем, что PIN есть.
    return true
  }
}

export function subscribePinLock(listener: () => void): () => void {
  window.addEventListener(UNLOCK_EVENT, listener)
  return () => window.removeEventListener(UNLOCK_EVENT, listener)
}

/** Текст ошибки из ответа сервера — 403 здесь означает «неверный PIN», а не «нет прав». */
export function pinErrorText(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  return 'Не удалось проверить PIN. Проверьте, что локальный сервер запущен.'
}
