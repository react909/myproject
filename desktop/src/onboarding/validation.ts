/**
 * Проверки, которых нет в реестре полей.
 *
 * Пароль и сервисный ключ не входят в OnboardingData (он кэшируется и уходит
 * в настройки), поэтому их правила живут здесь, но возвращаются в том же виде
 * FieldProblem — сводке и рельсу всё равно, откуда пришла проблема.
 */

import { fieldById } from './fields'
import type { FieldProblem } from './fields'
import { OWNER_PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH, effectiveOwnerEmail } from './types'
import type { OnboardingData, OwnerSecrets } from './types'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Проверки секретов установки: email, пароль владельца, сервисный ключ.
 *
 * PIN кассира здесь не проверяется — его на этом шаге не спрашивают. Правила
 * PIN живут рядом с формой сотрудника, в разделе «Сотрудники».
 */
export function secretProblems(
  data: OnboardingData,
  secrets: OwnerSecrets,
  passwordConfirm: string,
): FieldProblem[] {
  const problems: FieldProblem[] = []
  const emailField = fieldById('owner.email')!
  const passwordField = fieldById('owner.password')!
  const ownerPasswordField = fieldById('owner.ownerPassword')!

  const email = effectiveOwnerEmail(data)
  if (!email) {
    problems.push({ field: emailField, message: 'Укажите email владельца — это логин для входа.' })
  } else if (!EMAIL_PATTERN.test(email)) {
    problems.push({ field: emailField, message: 'Проверьте email владельца.' })
  }

  if (secrets.password.length < PASSWORD_MIN_LENGTH) {
    problems.push({
      field: passwordField,
      message: `Пароль должен содержать минимум ${PASSWORD_MIN_LENGTH} символов.`,
    })
  } else if (!/[A-Za-zА-Яа-я]/.test(secrets.password) || !/\d/.test(secrets.password)) {
    // Требование не косметическое: без него пароль вырождается либо в набор
    // цифр, либо в словарное слово, и длина перестаёт что-либо значить.
    problems.push({ field: passwordField, message: 'В пароле должны быть и буквы, и цифры.' })
  } else if (secrets.password !== passwordConfirm) {
    problems.push({ field: passwordField, message: 'Пароли не совпадают.' })
  }

  if (secrets.ownerPassword.length < OWNER_PASSWORD_MIN_LENGTH) {
    problems.push({
      field: ownerPasswordField,
      message: `Пароль владельца — минимум ${OWNER_PASSWORD_MIN_LENGTH} символов.`,
    })
  } else if (secrets.ownerPassword === secrets.password) {
    // Совпадение стирает разделение ролей, ради которого второй пароль и завели:
    // под учётной записью работает смена, и один пароль на оба входа означает,
    // что кабинет с деньгами открывает любой, кому владелец продиктовал вход.
    problems.push({
      field: ownerPasswordField,
      message: 'Пароль владельца должен отличаться от пароля входа.',
    })
  }

  return problems
}
