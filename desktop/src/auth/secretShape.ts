/**
 * Чем ключ отличается от пароля с точки зрения ввода.
 *
 * Вынесено из окна отдельно и без React намеренно: это правила про то, когда
 * набранное считается законченным, а от них зависит автоматический вход. Их
 * надо проверять тестом, а не набирая пароль руками и глядя, войдёт или нет.
 *
 * Разница между двумя секретами тут сводится к одному: у ключа длина известна
 * заранее, у пароля — нет. Поэтому ключ уходит на проверку ровно в тот момент,
 * когда набран последний символ, а пароль — по паузе.
 */

import {
  LICENSE_KEY_LENGTH,
  LICENSE_KEY_PLACEHOLDER,
  formatLicenseKeyInput,
  isCompleteLicenseKey,
} from './licenseKey'
import { OWNER_PASSWORD_MIN_LENGTH } from '../onboarding/types'

export type SecretKind = 'owner' | 'specialist'

/**
 * Запасная пауза для установок, где длина пароля ещё неизвестна.
 *
 * Пауза нужна ровно тогда, когда неизвестно, дописал человек пароль или ещё
 * набирает. Это единственный оставшийся такой случай: касса обновилась со
 * старой версии, длину сервер пока не знает и проставит её при первом успешном
 * входе (см. миграцию 0024). После этого пауза не используется вовсе.
 *
 * Треть секунды: промежуток между нажатиями даже при медленном наборе на
 * экранной клавиатуре короче, поэтому во время набора проверка не запускается.
 *
 * Ноль здесь был бы ошибкой, и она уже была допущена: без паузы и без известной
 * длины запрос уходил на каждую букву, а каждая проверка стоит 120 мс и 64 МБ —
 * машина уходила в своп.
 */
export const PASSWORD_SETTLE_MS = 350

/**
 * Когда длина известна, ждать нечего: проверка запускается ровно на последнем
 * символе — ни раньше, ни позже. Так же ведёт себя ввод кода на телефоне, и
 * именно поэтому там вход кажется мгновенным.
 */
export const EXACT_SETTLE_MS = 0

/** У ключа длина известна всегда — она задана его форматом. */
export const KEY_SETTLE_MS = 0

export type SecretShape = {
  /** Приводит набранное к своему виду прямо во время ввода. */
  mask: (raw: string) => string
  placeholder?: string
  maxLength: number
  /** Ключ показывается моноширинным: его сверяют с наклейкой символ за символом. */
  mono?: boolean
}

const SHAPES: Record<SecretKind, SecretShape> = {
  owner: {
    // Пароль не размечают: любая «помощь» здесь испортит секрет, который
    // человек помнит посимвольно.
    mask: (raw) => raw,
    maxLength: 128,
  },
  specialist: {
    mask: formatLicenseKeyInput,
    placeholder: LICENSE_KEY_PLACEHOLDER,
    maxLength: LICENSE_KEY_LENGTH,
    mono: true,
  },
}

export function shapeFor(kind: SecretKind): SecretShape {
  return SHAPES[kind]
}

/**
 * Сколько символов в секрете, если это известно заранее.
 *
 * У ключа — всегда: длина задана его форматом. У пароля — когда сервер сообщил
 * её (`GET /api/auth/owner/hint`); `null` до ответа и на установках, где длина
 * ещё не проставлена.
 */
export function expectedLengthFor(kind: SecretKind, ownerLength: number | null): number | null {
  return kind === 'specialist' ? LICENSE_KEY_LENGTH : ownerLength
}

/**
 * Пора ли отправлять набранное на проверку.
 *
 * Когда длина известна — ровно на последнем символе, как при вводе кода на
 * телефоне. Это и делает вход мгновенным: ждать нечего, а на сервере
 * запускается ровно одна дорогая проверка, а не по одной на каждый набранный
 * символ.
 *
 * Когда неизвестна — по нижней границе длины и по паузе. Так остаётся только у
 * установок, обновившихся со старой версии, и только до первого входа.
 */
export function readyToSend(
  kind: SecretKind,
  value: string,
  expectedLength: number | null,
): boolean {
  if (kind === 'specialist') return isCompleteLicenseKey(value)
  if (expectedLength) return value.length === expectedLength
  return value.length >= OWNER_PASSWORD_MIN_LENGTH
}

/** Сколько ждать после последнего символа перед проверкой. */
export function settleMsFor(kind: SecretKind, expectedLength: number | null): number {
  if (kind === 'specialist') return KEY_SETTLE_MS
  return expectedLength ? EXACT_SETTLE_MS : PASSWORD_SETTLE_MS
}

/**
 * Пора ли отправлять набранное на проверку.
 *
 * Единственное место, где принимается это решение, — и окно ввода, и тест
 * спрашивают именно его. Пока условие жило внутри эффекта React, проверить его
 * можно было только руками.
 *
 * `rejected` — значения, которые сервер уже отверг. Ради них автоматический
 * вход вообще возможен: без такого набора каждая следующая буква пароля
 * уходила бы на проверку отдельной попыткой, и лимит из пяти съедался бы одним
 * словом. С ним попытка тратится ровно на каждое законченное значение —
 * столько же, сколько тратила бы кнопка «Войти».
 */
export function shouldAttempt(
  kind: SecretKind,
  value: string,
  rejected: ReadonlySet<string>,
  busy: boolean,
  expectedLength: number | null = null,
): boolean {
  if (busy) return false
  const candidate = value.trim()
  if (!candidate) return false
  if (rejected.has(candidate)) return false
  return readyToSend(kind, candidate, expectedLength)
}
