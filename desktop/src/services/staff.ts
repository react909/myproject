/**
 * Сотрудники магазина: кассиры, их PIN и права.
 *
 * PIN сюда приходит только на запись. Обратно сервер отдаёт лишь признак
 * `hasPin` — сам PIN не покидает базу даже в хэше, и показать его на экране
 * невозможно ни владельцу, ни специалисту. Забыли PIN — задают новый.
 */

import { apiDelete, apiGet, apiPatch, apiPost } from '../api/client'

export type StaffRole = 'owner' | 'admin' | 'cashier'

export type StaffPermission = string

export type StaffUser = {
  id: number
  username: string
  fullName: string
  role: StaffRole
  isActive: boolean
  /** Задан ли PIN. Сам PIN не отдаётся никогда. */
  hasPin: boolean
  permissions: StaffPermission[]
}

export type PermissionOption = {
  key: StaffPermission
  label: string
}

export const PIN_MIN_LENGTH = 4
export const PIN_MAX_LENGTH = 6

/** Очевидные PIN подбираются взглядом через плечо за одну смену. */
const WEAK_PINS = new Set(['1234', '0000', '1111', '4321', '123456', '654321', '000000', '111111'])

/**
 * Проверка PIN. Те же правила, что на сервере: расхождение здесь означало бы
 * форму, которая пропускает ввод, а потом получает отказ.
 */
export function pinProblem(pin: string): string {
  const value = pin.trim()
  if (!/^\d+$/.test(value)) return 'PIN состоит только из цифр.'
  if (value.length < PIN_MIN_LENGTH || value.length > PIN_MAX_LENGTH) {
    return `PIN кассира — от ${PIN_MIN_LENGTH} до ${PIN_MAX_LENGTH} цифр.`
  }
  if (WEAK_PINS.has(value) || new Set(value).size === 1) {
    return 'Такой PIN подбирается мгновенно — выберите другой.'
  }
  return ''
}

function toStaff(raw: Record<string, unknown>): StaffUser {
  return {
    id: Number(raw.id),
    username: String(raw.username ?? ''),
    fullName: String(raw.full_name ?? ''),
    role: (raw.role as StaffRole) ?? 'cashier',
    isActive: raw.is_active !== false,
    hasPin: Boolean(raw.has_pin),
    permissions: Array.isArray(raw.permissions) ? (raw.permissions as string[]) : [],
  }
}

export async function fetchPermissionOptions(): Promise<PermissionOption[]> {
  const res = await apiGet('/api/users/permissions')
  const rows = Array.isArray(res?.data) ? res.data : []
  return rows.map((row: Record<string, unknown>) => ({
    key: String(row.key ?? ''),
    label: String(row.label ?? ''),
  }))
}

export async function fetchStaff(): Promise<StaffUser[]> {
  const res = await apiGet('/api/users')
  const rows = Array.isArray(res?.data) ? res.data : []
  return rows.map(toStaff)
}

export type StaffDraft = {
  username: string
  fullName: string
  password: string
  role: 'admin' | 'cashier'
  /** Пусто — PIN не задаётся (при создании) и не меняется (при правке). */
  pin: string
  permissions: StaffPermission[]
}

export async function createStaff(draft: StaffDraft): Promise<StaffUser> {
  const res = await apiPost('/api/users', {
    username: draft.username.trim(),
    password: draft.password,
    full_name: draft.fullName.trim(),
    role: draft.role,
    pin: draft.pin.trim() || null,
    permissions: draft.permissions,
  })
  return toStaff(res.data)
}

/**
 * Правка сотрудника. Пароль и PIN отправляются, только если их действительно
 * меняли: пустое поле означает «оставить как было», а не «стереть».
 * Чтобы снять PIN, передаётся `clearPin`.
 */
export async function updateStaff(
  id: number,
  patch: {
    fullName?: string
    role?: 'admin' | 'cashier'
    isActive?: boolean
    password?: string
    pin?: string
    clearPin?: boolean
    permissions?: StaffPermission[]
  },
): Promise<StaffUser> {
  const body: Record<string, unknown> = {}
  if (patch.fullName !== undefined) body.full_name = patch.fullName.trim()
  if (patch.role !== undefined) body.role = patch.role
  if (patch.isActive !== undefined) body.is_active = patch.isActive
  if (patch.password) body.password = patch.password
  if (patch.clearPin) body.pin = ''
  else if (patch.pin) body.pin = patch.pin.trim()
  if (patch.permissions !== undefined) body.permissions = patch.permissions
  const res = await apiPatch(`/api/users/${id}`, body)
  return toStaff(res.data)
}

export async function deleteStaff(id: number, ownerPassword: string): Promise<void> {
  await apiDelete(`/api/users/${id}`, { password: ownerPassword })
}

export function staffErrorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (item as { msg?: unknown })?.msg)
      .filter((msg): msg is string => typeof msg === 'string')
      .map((msg) => msg.replace(/^Value error,\s*/, ''))
    if (messages.length) return messages.join(' ')
  }
  return fallback
}
