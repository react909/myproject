/**
 * Обмен онбордингом с локальным сервером и кэш для печати.
 *
 * Чек печатается синхронно, прямо в момент оплаты, — ждать сетевой ответ там
 * нельзя. Поэтому последний известный онбординг лежит в localStorage, а сервер
 * остаётся источником истины: кэш обновляется после установки, после входа и
 * после каждой правки реквизитов.
 */

import { apiGet, apiPatch, apiPost } from '../api/client'
import { loadSettings, saveSettings } from '../settings/appSettings'
import { DEFAULT_ONBOARDING, createOnboardingDraft, effectiveOwnerEmail } from './types'
import type { OnboardingData, OwnerSecrets } from './types'

const CACHE_KEY = 'nurcrm-onboarding'

/** Сообщает экранам, что реквизиты изменились (шапка, превью чека). */
export const ONBOARDING_CHANGED_EVENT = 'nurcrm-onboarding-changed'

/** Достраивает недостающие группы дефолтами — сервер новее/старее клиента. */
function hydrate(raw: unknown): OnboardingData {
  const base = createOnboardingDraft()
  if (!raw || typeof raw !== 'object') return base
  const source = raw as Partial<Record<keyof OnboardingData, unknown>>
  for (const key of Object.keys(base) as (keyof OnboardingData)[]) {
    const group = source[key]
    if (group && typeof group === 'object') {
      Object.assign(base[key] as object, group)
    }
  }

  // Дискриминант — скаляр, а не группа, поэтому цикл выше его не переносит.
  // Ответ без режима приходит от установок, сделанных до его появления: там
  // о фискальности говорят сами данные — заполненные ИНН и номер ККМ.
  const mode = source.fiscalMode
  if (mode === 'fiscal' || mode === 'simple') base.fiscalMode = mode
  else if (base.company.inn.trim() && base.kkm.serialNumber.trim()) base.fiscalMode = 'fiscal'

  // Тариф — такой же скаляр верхнего уровня. Ответ без него приходит от
  // установок, сделанных до появления выбора: им полагается «Старт».
  const edition = source.edition
  if (edition === 'start' || edition === 'standard') base.edition = edition

  return base
}

/**
 * Приводит локальные настройки принтера к ширине рулона из реквизитов.
 *
 * Ширина живёт в двух местах по необходимости: в реквизитах — как решение
 * владельца (от неё готовится логотип для чека), в локальных настройках — как
 * параметр печати ESC/POS. Переключатель один, но синхронизировать надо и при
 * загрузке: иначе касса, где реквизиты правили с другого рабочего места,
 * печатала бы чек одной ширины, а логотип готовила под другую.
 */
function syncPrinterRollWidth(data: OnboardingData): void {
  try {
    const settings = loadSettings()
    if (settings.printer.paperWidth === data.branding.receiptRollWidth) return
    saveSettings({
      ...settings,
      printer: { ...settings.printer, paperWidth: data.branding.receiptRollWidth },
    })
  } catch {
    /* настройки недоступны — печать возьмёт свои дефолты */
  }
}

export function cacheOnboarding(data: OnboardingData): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
  } catch {
    /* приватный режим — печать возьмёт дефолты */
  }
  syncPrinterRollWidth(data)
  window.dispatchEvent(new CustomEvent(ONBOARDING_CHANGED_EVENT))
}

/**
 * Синхронное чтение для модуля печати. Никогда не бросает и не возвращает
 * undefined: чек должен напечататься даже с неполными данными, иначе касса
 * встанет посреди смены.
 */
export function readOnboardingCached(): OnboardingData {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? hydrate(JSON.parse(raw)) : DEFAULT_ONBOARDING
  } catch {
    return DEFAULT_ONBOARDING
  }
}

export function clearOnboardingCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* ignore */
  }
}

/** Загружает реквизиты с сервера и обновляет кэш. */
export async function fetchOnboarding(): Promise<OnboardingData> {
  const res = await apiGet('/api/settings/store')
  const data = hydrate(res?.data?.onboarding)
  cacheOnboarding(data)
  return data
}

/** Сохраняет правки реквизитов из настроек. */
export async function saveOnboarding(data: OnboardingData): Promise<OnboardingData> {
  const res = await apiPatch('/api/settings/store', { onboarding: data })
  const saved = hydrate(res?.data?.onboarding)
  cacheOnboarding(saved)
  return saved
}

export type SetupResult = {
  accessToken: string
  user: { id: number; username: string; full_name: string; role: string }
  onboarding: OnboardingData
}

/** Завершает первую установку: создаёт базу, владельца и сессию. */
export async function submitSetup(
  setupToken: string,
  onboarding: OnboardingData,
  secrets: OwnerSecrets,
): Promise<SetupResult> {
  const res = await apiPost('/api/setup/init', {
    setup_token: setupToken,
    // Тариф выбирается на первом шаге мастера и лежит в тех же данных.
    edition: onboarding.edition,
    onboarding,
    // Логин — email владельца; секреты уходят отдельно от онбординга и в
    // локальный кэш не попадают. PIN кассира здесь не передаётся: кассиров на
    // этом шаге ещё нет, их заводят в разделе «Сотрудники».
    account: {
      email: effectiveOwnerEmail(onboarding),
      password: secrets.password,
      // Пароль владельца уходит отдельным полем и отдельным секретом: на
      // сервере он ложится в настройки магазина, а не в учётную запись, и
      // дверь кабинета проверяет только его.
      owner_password: secrets.ownerPassword,
      // Сервисный ключ мастер больше не собирает: сервисный режим открывает
      // лицензионный ключ установки. Поле на сервере необязательное.
    },
  })
  const accessToken = res?.data?.access_token
  if (!accessToken) throw new Error('Локальный сервер не создал сеанс владельца.')
  const saved = hydrate(res.data.onboarding)
  cacheOnboarding(saved)
  return { accessToken, user: res.data.user, onboarding: saved }
}

/** Текст ошибки от сервера — pydantic отдаёт detail списком. */
export function onboardingErrorText(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (item as { msg?: unknown })?.msg)
      .filter((msg): msg is string => typeof msg === 'string')
      .map((msg) => msg.replace(/^Value error,\s*/, ''))
    if (messages.length) return messages.join(' ')
  }
  const message = (error as { message?: unknown })?.message
  return typeof message === 'string' && message ? message : 'Не удалось сохранить данные.'
}
