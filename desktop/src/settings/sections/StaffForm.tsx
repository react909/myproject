/**
 * Форма сотрудника — одна и та же для добавления и для редактирования.
 *
 * Два разных экрана под одно и то же означали бы два набора правил проверки,
 * которые со временем разойдутся: где-то PIN уже нельзя «1234», а где-то ещё
 * можно. Разница между режимами сведена к трём вещам: логин при правке не
 * меняется (по нему сотрудник входит), пароль и PIN пустыми означают «оставить
 * как было», а не «стереть».
 */

import { useEffect, useMemo, useState } from 'react'
import { PIN_MAX_LENGTH, pinProblem } from '../../services/staff'
import type { PermissionOption, StaffUser } from '../../services/staff'
import './StaffForm.css'

export type StaffFormValues = {
  username: string
  fullName: string
  password: string
  role: 'admin' | 'cashier'
  pin: string
  clearPin: boolean
  permissions: string[]
}

type Props = {
  /** Пусто — добавление нового. Иначе правка этого сотрудника. */
  editing: StaffUser | null
  permissionOptions: PermissionOption[]
  busy: boolean
  error: string
  onSubmit: (values: StaffFormValues) => void
  onCancel: () => void
}

const MIN_PASSWORD = 4

export function StaffForm({ editing, permissionOptions, busy, error, onSubmit, onCancel }: Props) {
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'cashier'>('cashier')
  const [pin, setPin] = useState('')
  const [clearPin, setClearPin] = useState(false)
  const [permissions, setPermissions] = useState<string[]>([])
  const [touched, setTouched] = useState(false)

  /* Форма перезаполняется при смене сотрудника: без этого правка второго
     подряд открывалась бы с данными первого. */
  useEffect(() => {
    setUsername(editing?.username ?? '')
    setFullName(editing?.fullName ?? '')
    setRole(editing && editing.role !== 'owner' ? editing.role : 'cashier')
    setPermissions(editing?.permissions ?? ['sell'])
    setPassword('')
    setPin('')
    setClearPin(false)
    setTouched(false)
  }, [editing])

  const isEdit = editing !== null

  const problems = useMemo(() => {
    const list: string[] = []
    if (!isEdit && username.trim().length < 2) list.push('Логин — минимум 2 символа.')
    if (!fullName.trim()) list.push('Укажите имя сотрудника — оно печатается в чеке.')
    if (!isEdit && password.length < MIN_PASSWORD) {
      list.push(`Пароль — минимум ${MIN_PASSWORD} символа.`)
    }
    if (isEdit && password && password.length < MIN_PASSWORD) {
      list.push(`Новый пароль — минимум ${MIN_PASSWORD} символа.`)
    }
    if (pin && !clearPin) {
      const issue = pinProblem(pin)
      if (issue) list.push(issue)
    }
    if (permissions.length === 0) {
      list.push('Отметьте хотя бы одно право — иначе сотрудник не сможет ничего сделать за кассой.')
    }
    return list
  }, [isEdit, username, fullName, password, pin, clearPin, permissions])

  const togglePermission = (key: string) => {
    setPermissions((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]))
  }

  const submit = () => {
    setTouched(true)
    if (problems.length > 0 || busy) return
    onSubmit({ username, fullName, password, role, pin, clearPin, permissions })
  }

  const showProblems = touched && problems.length > 0

  return (
    <form
      className="staff-form"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <h3 className="staff-form__title">
        {isEdit ? `Сотрудник: ${editing?.fullName || editing?.username}` : 'Новый сотрудник'}
      </h3>

      <div className="staff-form__grid">
        <label className="settings-field">
          <span className="settings-field__label">Имя</span>
          <input
            className="settings-field__input"
            value={fullName}
            maxLength={255}
            placeholder="Айгуль Масалбекова"
            disabled={busy}
            onChange={(event) => setFullName(event.target.value)}
          />
          <small className="staff-form__hint">Печатается в чеке как кассир</small>
        </label>

        <label className="settings-field">
          <span className="settings-field__label">Логин</span>
          <input
            className="settings-field__input"
            value={username}
            maxLength={255}
            placeholder="aigul"
            // Логин — то, по чему сотрудник входит. Смена логина у работающего
            // человека ломает ему вход, поэтому при правке он только читается.
            disabled={busy || isEdit}
            onChange={(event) => setUsername(event.target.value)}
          />
          <small className="staff-form__hint">
            {isEdit ? 'Логин не меняется' : 'По нему сотрудник входит в приложение'}
          </small>
        </label>

        <label className="settings-field">
          <span className="settings-field__label">{isEdit ? 'Новый пароль' : 'Пароль'}</span>
          <input
            className="settings-field__input"
            type="password"
            value={password}
            autoComplete="new-password"
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
          <small className="staff-form__hint">
            {isEdit ? 'Пусто — пароль остаётся прежним' : `Минимум ${MIN_PASSWORD} символа`}
          </small>
        </label>

        <label className="settings-field">
          <span className="settings-field__label">Роль</span>
          <select
            className="settings-field__select"
            value={role}
            disabled={busy}
            onChange={(event) => setRole(event.target.value as 'admin' | 'cashier')}
          >
            <option value="cashier">Кассир</option>
            <option value="admin">Администратор</option>
          </select>
        </label>

        <label className="settings-field">
          <span className="settings-field__label">PIN кассира</span>
          <input
            className="settings-field__input staff-form__pin"
            inputMode="numeric"
            value={pin}
            maxLength={PIN_MAX_LENGTH}
            placeholder="4–6 цифр"
            disabled={busy || clearPin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH))}
          />
          <small className="staff-form__hint">
            {isEdit
              ? editing?.hasPin
                ? 'PIN задан. Пусто — остаётся прежним; ввод заменяет его'
                : 'PIN не задан — сотрудник не сможет подтвердить возврат'
              : 'Подтверждает смену, отмену позиции и возврат прямо у кассы'}
          </small>
        </label>

        {isEdit && editing?.hasPin && (
          <label className="staff-form__check staff-form__check--clear">
            <input
              type="checkbox"
              checked={clearPin}
              disabled={busy}
              onChange={(event) => {
                setClearPin(event.target.checked)
                if (event.target.checked) setPin('')
              }}
            />
            <span>Снять PIN — сотрудник перестанет подтверждать кассовые операции</span>
          </label>
        )}
      </div>

      <fieldset className="staff-form__perms">
        <legend>Права за кассой</legend>
        <div className="staff-form__perms-grid">
          {permissionOptions.map((option) => (
            <label key={option.key} className="staff-form__check">
              <input
                type="checkbox"
                checked={permissions.includes(option.key)}
                disabled={busy}
                onChange={() => togglePermission(option.key)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <p className="staff-form__hint">
          Права отвечают за кассовые операции. Финансы, аналитика и настройки открываются паролем
          владельца и сюда не входят.
        </p>
      </fieldset>

      {showProblems && (
        <ul className="staff-form__problems" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {error && (
        <p className="staff-form__error" role="alert">
          {error}
        </p>
      )}

      <div className="staff-form__actions">
        <button type="button" className="settings-btn settings-btn--secondary" onClick={onCancel} disabled={busy}>
          Отмена
        </button>
        <button type="submit" className="settings-btn settings-btn--cta" disabled={busy}>
          {busy ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Добавить сотрудника'}
        </button>
      </div>
    </form>
  )
}
