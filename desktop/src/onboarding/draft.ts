/**
 * Черновик мастера первого запуска.
 *
 * Мастер — это двадцать с лишним полей: реквизиты, адрес, номера ККМ с
 * шильдика. Закрыть его на середине легко: не нашёлся ИНН, позвонили,
 * выключился моноблок. Раньше в этот момент терялось всё, и человек начинал
 * заново — с того же шага, на котором прервался в прошлый раз.
 *
 * Секреты сюда не пишутся никогда. Пароль владельца и сервисный ключ живут
 * только в состоянии формы: черновик лежит в localStorage, а это обычный файл
 * профиля, и класть туда пароль в открытом виде нельзя. Их придётся ввести
 * заново — это две строки против двадцати.
 */

import { createOnboardingDraft } from './types'
import type { OnboardingData } from './types'

const DRAFT_KEY = 'nurcrm-onboarding-draft'

/**
 * Черновик старше этого срока не предлагается. Месяц — это уже не «меня
 * прервали», а другая установка или другой магазин, и подставлять его данные
 * значит подсунуть чужие реквизиты в чек.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export type OnboardingDraft = {
  data: OnboardingData
  /** Шаг, на котором прервались. */
  step: number
  /** Когда сохранён — по нему считается устаревание. */
  savedAt: number
}

export function saveDraft(data: OnboardingData, step: number): void {
  try {
    const draft: OnboardingDraft = { data, step, savedAt: Date.now() }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // Приватный режим или переполненное хранилище. Мастер обязан продолжать
    // работать: черновик — удобство, а не условие установки.
  }
}

/**
 * Читает черновик. Возвращает null, если его нет, он испорчен или устарел —
 * во всех этих случаях мастер просто начинается с чистого листа.
 */
export function readDraft(): OnboardingDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<OnboardingDraft>
    if (!parsed || typeof parsed !== 'object' || !parsed.data) return null
    const savedAt = Number(parsed.savedAt) || 0
    if (!savedAt || Date.now() - savedAt > MAX_AGE_MS) {
      clearDraft()
      return null
    }
    // Достраиваем дефолтами: черновик мог быть сохранён сборкой, где полей
    // было меньше, и без этого мастер упал бы на чтении отсутствующей группы.
    const base = createOnboardingDraft()
    const source = parsed.data as Partial<Record<keyof OnboardingData, unknown>>
    for (const key of Object.keys(base) as (keyof OnboardingData)[]) {
      const group = source[key]
      if (group && typeof group === 'object') Object.assign(base[key] as object, group)
    }
    // Скаляры верхнего уровня цикл выше не переносит — только группы.
    if (source.fiscalMode === 'fiscal' || source.fiscalMode === 'simple') {
      base.fiscalMode = source.fiscalMode
    }
    if (source.edition === 'start' || source.edition === 'standard') {
      base.edition = source.edition
    }
    const step = Number(parsed.step)
    return {
      data: base,
      step: Number.isFinite(step) && step >= 0 ? step : 0,
      savedAt,
    }
  } catch {
    return null
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* ignore */
  }
}

/** Есть ли в черновике хоть что-то, ради чего его стоит предлагать. */
export function draftHasContent(draft: OnboardingDraft): boolean {
  const { company, outlet, contacts, owner } = draft.data
  return Boolean(
    company.legalName.trim() ||
      company.shortName.trim() ||
      company.inn.trim() ||
      outlet.name.trim() ||
      outlet.city.trim() ||
      contacts.phone.trim() ||
      owner.firstName.trim() ||
      owner.lastName.trim(),
  )
}

/** «5 минут назад», «вчера» — человеку важно, насколько черновик свежий. */
export function draftAgeLabel(savedAt: number): string {
  const minutes = Math.floor((Date.now() - savedAt) / 60000)
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин. назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч. назад`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'вчера' : `${days} дн. назад`
}
