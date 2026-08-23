/**
 * Три ключа кассы. Их роли не пересекаются, и это главное.
 *
 * Раньше одна дверь — сервисный PIN — открывала и кассовые операции, и
 * финансы, и настройки оборудования. Так быть не должно: PIN короткий, его
 * набирают при покупателе по нескольку раз за смену, и охранять им удаление
 * базы бессмысленно.
 *
 * | Ключ              | Вид                  | Кто вводит | Что открывает                |
 * |-------------------|----------------------|------------|------------------------------|
 * | Пароль владельца  | 8+ символов          | владелец   | финансы, аналитика,          |
 * |                   |                      |            | сотрудники, удаление аккаунта|
 * | PIN кассира       | 4–6 цифр             | кассир     | смена, отмена позиции,       |
 * |                   |                      |            | возврат в пределах лимита    |
 * | Сервисный ключ    | 8+, буквы и цифры    | установщик | оборудование, режим работы,  |
 * |                   |                      |            | провайдеры оплаты, повторный |
 * |                   |                      |            | проход мастера регистрации   |
 *
 * Ограничение «шесть цифр» с сервисного ключа снято: шестизначный код
 * перебирается за минуты, а открывает он мастер регистрации, то есть всё
 * устройство. Теперь ключ задаёт владелец при установке.
 *
 * Срок разблокировки живёт в sessionStorage: закрыли приложение — доступ
 * закрылся, даже если смена не завершалась.
 */

import { apiGet, apiPost } from '../api/client'

export type AccessKind = 'owner' | 'cashier' | 'specialist'

type KeyDescriptor = {
  kind: AccessKind
  title: string
  /** Что именно вводят — подпись над полем. */
  fieldLabel: string
  /** Одна строка, чем этот ключ отличается от соседнего. */
  difference: string
  storageKey: string
  endpoint: string
  /** Имя поля в теле запроса. */
  field: string
  inputMode: 'text' | 'numeric'
  secret: boolean
}

export const ACCESS_KEYS: Record<AccessKind, KeyDescriptor> = {
  owner: {
    kind: 'owner',
    title: 'Кабинет владельца',
    fieldLabel: 'Пароль владельца',
    difference:
      'Отдельный пароль, заданный при установке, — не тот, которым входят в систему. Открывает аналитику, финансы и сотрудников. Пароль входа и PIN кассира сюда не подойдут.',
    storageKey: 'nurcrm-access-owner-until',
    endpoint: '/api/auth/owner/unlock',
    field: 'password',
    inputMode: 'text',
    secret: true,
  },
  cashier: {
    kind: 'cashier',
    title: 'Подтверждение кассира',
    fieldLabel: 'PIN кассира',
    difference:
      '4–6 цифр, их знает смена. Открывает только кассовые операции: смену, отмену позиции, возврат. Финансов и удаления не открывает.',
    storageKey: 'nurcrm-access-cashier-until',
    endpoint: '/api/auth/pin/unlock',
    field: 'pin',
    inputMode: 'numeric',
    secret: true,
  },
  specialist: {
    kind: 'specialist',
    title: 'Сервисный режим',
    fieldLabel: 'Лицензионный ключ',
    difference:
      'Ключ установки вида KASSIR-XXXX-XXXX-XXXX — тот же, что вводили при первом запуске. Возвращает в мастер настройки: оборудование, оформление, чек. Денег магазина не открывает.',
    storageKey: 'nurcrm-access-specialist-until',
    endpoint: '/api/auth/service-key/unlock',
    field: 'key',
    inputMode: 'text',
    // Ключ скрыт, как и пароль владельца.
    //
    // Раньше он показывался открыто: рассуждение было, что его всё равно
    // читают с наклейки и сверяют символ за символом. Но набирают его у кассы,
    // и рядом стоят люди — открытый на весь экран ключ от сервисного режима
    // видит кто угодно за спиной. Сверить набранное можно кнопкой «Показать»,
    // когда это действительно нужно.
    secret: true,
  },
}

const CHANGED_EVENT = 'nurcrm-access-changed'
const DEFAULT_UNLOCK_MINUTES = 15

function readUntil(kind: AccessKind): number {
  try {
    const raw = sessionStorage.getItem(ACCESS_KEYS[kind].storageKey)
    const value = raw ? Number(raw) : 0
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

function writeUntil(kind: AccessKind, timestamp: number): void {
  try {
    if (timestamp > 0) sessionStorage.setItem(ACCESS_KEYS[kind].storageKey, String(timestamp))
    else sessionStorage.removeItem(ACCESS_KEYS[kind].storageKey)
  } catch {
    /* приватный режим — тогда доступ просто не запоминается */
  }
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT))
}

export function isUnlocked(kind: AccessKind): boolean {
  return readUntil(kind) > Date.now()
}

export function unlockRemainingMs(kind: AccessKind): number {
  return Math.max(0, readUntil(kind) - Date.now())
}

/**
 * Сколько символов в пароле владельца. `null` — сервер не знает.
 *
 * По этому окно понимает, когда пароль дописан, и отправляет его ровно на
 * последнем символе — как ввод кода на телефоне. Без этого пришлось бы ждать
 * паузу (медленно) или слать каждый набранный символ (одна проверка на сервере
 * стоит 120 мс и 64 МБ — так уже вешали машину).
 *
 * Ошибку глотаем: не ответил сервер — окно просто вернётся к работе по паузе.
 * Ронять единственный путь к настройкам из-за подсказки нельзя.
 */
export async function fetchOwnerPasswordLength(): Promise<number | null> {
  try {
    const res = await apiGet('/api/auth/owner/hint')
    const length = Number(res?.data?.length)
    return Number.isFinite(length) && length > 0 ? length : null
  } catch {
    return null
  }
}

/**
 * Снимает блокировку двери владельца паролем учётной записи.
 *
 * Только снимает таймер — внутрь не пускает. Владелец, промахнувшийся
 * раскладкой у кассы с очередью, подтверждает паролем от аккаунта, что это он,
 * и пробует снова сразу, не дожидаясь конца блокировки. Кабинет после этого
 * по-прежнему открывает только пароль владельца.
 */
export async function liftOwnerLockout(accountPassword: string): Promise<void> {
  await apiPost('/api/auth/owner/lockout/lift', { password: accountPassword })
}

/** Дверь закрыта по числу попыток — сервер отвечает 429. */
export function isLockedOut(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 429
}

/** Проверяет ключ на сервере и открывает соответствующую дверь. */
export async function unlockAccess(kind: AccessKind, secret: string): Promise<void> {
  const descriptor = ACCESS_KEYS[kind]
  const res = await apiPost(descriptor.endpoint, { [descriptor.field]: secret })
  const minutes = Number(res?.data?.unlock_minutes) || DEFAULT_UNLOCK_MINUTES
  writeUntil(kind, Date.now() + minutes * 60_000)
}

/*
 * Функции «попробовать секрет в обе двери сразу» здесь больше нет.
 *
 * Она обслуживала общее окно, где поле одно, а ролей две. Удобно, но счётчик
 * неудач на сервере у такого окна общий: пять опечаток владельца закрывали
 * заодно и дверь специалиста, которой человек не касался. Теперь у каждой роли
 * своё окно и свой счётчик — см. OwnerAccessDialog и SpecialistAccessDialog.
 *
 * Сам маршрут `/api/auth/access/unlock` на сервере остался: он ничем не
 * навредит, а установки со старой сборкой интерфейса могут в него ходить.
 */

/**
 * Закрывает дверь — и здесь, и на сервере.
 *
 * Одной записи в sessionStorage мало: она убирает разделы с экрана, а
 * повышенная сессия на сервере живёт своим сроком бездействия и ещё десять
 * минут пускает любой прямой запрос. «Выйти из режима» обязано закрывать
 * именно дверь, а не вид на неё.
 *
 * Запрос без ожидания и без разбора ошибок: локальную часть откладывать нельзя
 * (человек уже нажал «выйти»), а если сервер не ответил — дверь всё равно
 * закроется сама по бездействию. Маршрут закрывает обе двери разом: нажимают
 * «выйти из режима», а не «выйти из режима специалиста, оставив владельца».
 */
function leaveServerSide(): void {
  void apiPost('/api/auth/access/leave', {}).catch(() => undefined)
}

export function lockAccess(kind?: AccessKind): void {
  leaveServerSide()
  if (kind) {
    writeUntil(kind, 0)
    return
  }
  for (const item of Object.keys(ACCESS_KEYS) as AccessKind[]) writeUntil(item, 0)
}

export function subscribeAccess(listener: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, listener)
  return () => window.removeEventListener(CHANGED_EVENT, listener)
}

/** Текст ошибки от сервера: 403 здесь значит «неверный ключ», а не «нет прав». */
export function accessErrorText(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  return 'Не удалось проверить ключ. Проверьте, что локальный сервер запущен.'
}

/*
 * Различения «сервер отверг» и «сервер не ответил» здесь больше нет.
 *
 * Оно обслуживало автоматический вход: отвергнутые значения запоминались, а
 * сбои связи — нет, чтобы верный ключ не переставал приниматься из-за одного
 * обрыва. На деле получилось наоборот: при блокировке двери (429) и при любом
 * сбое значение оставалось «готовым к отправке», проверка запускалась снова и
 * снова — окно уходило в бесконечный цикл запросов и переставало отзываться.
 *
 * Теперь окно запоминает всё, что отправляло, с любым исходом (см. AccessDialog),
 * а повторить осознанно можно клавишей ⏎ — она отправляет и уже пробованное.
 */

/**
 * Запись в журнал скрытых настроек. Пишем всё, что меняют за закрытой дверью:
 * иначе спор «настройки поменялись сами» разрешить нечем.
 */
export async function recordAudit(entry: {
  actorKind: AccessKind extends 'cashier' ? never : 'owner' | 'specialist'
  action: string
  target?: string
  oldValue?: string
  newValue?: string
}): Promise<void> {
  try {
    await apiPost('/api/auth/audit', {
      actor_kind: entry.actorKind,
      action: entry.action,
      target: entry.target ?? '',
      old_value: entry.oldValue ?? '',
      new_value: entry.newValue ?? '',
    })
  } catch {
    /* журнал не должен ломать работу настроек */
  }
}
