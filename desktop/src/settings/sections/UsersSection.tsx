/**
 * Сотрудники магазина.
 *
 * Здесь заводят кассиров: имя, PIN и права. PIN не спрашивается при установке
 * — на том шаге кассиров ещё нет, а PIN, заданный заранее, к появлению первого
 * кассира знают все, кто стоял рядом. И PIN у каждого свой: общий не давал бы
 * понять по журналу, кто именно отменил чек.
 *
 * Форма добавления и форма правки — один компонент (StaffForm). Два разных
 * экрана под одно и то же означали бы два набора правил, которые со временем
 * разойдутся.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNotifications } from '../../components/notifications/NotificationProvider'
import {
  createStaff,
  deleteStaff,
  fetchPermissionOptions,
  fetchStaff,
  staffErrorText,
  updateStaff,
} from '../../services/staff'
import type { PermissionOption, StaffUser } from '../../services/staff'
import { ConfirmPasswordModal } from '../ConfirmPasswordModal'
import { SettingsHelpFooter } from '../SettingsHelpFooter'
import { StaffForm } from './StaffForm'
import type { StaffFormValues } from './StaffForm'
import './UsersSection.css'

const ROLE_LABELS: Record<StaffUser['role'], string> = {
  owner: 'Владелец',
  admin: 'Администратор',
  cashier: 'Кассир',
}

const ROLE_FILTERS: Array<{ value: 'all' | StaffUser['role']; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'owner', label: 'Владелец' },
  { value: 'admin', label: 'Администраторы' },
  { value: 'cashier', label: 'Кассиры' },
]

export function UsersSection() {
  const { push } = useNotifications()
  const [users, setUsers] = useState<StaffUser[]>([])
  const [permissionOptions, setPermissionOptions] = useState<PermissionOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | StaffUser['role']>('all')

  // null — форма закрыта; 'new' — добавление; объект — правка этого сотрудника.
  const [formTarget, setFormTarget] = useState<'new' | StaffUser | null>(null)
  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState('')

  const [deleteTarget, setDeleteTarget] = useState<StaffUser | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [staff, options] = await Promise.all([fetchStaff(), fetchPermissionOptions()])
      setUsers(staff)
      setPermissionOptions(options)
    } catch (error) {
      setLoadError(staffErrorText(error, 'Не удалось загрузить список сотрудников.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (!q) return true
      return u.username.toLowerCase().includes(q) || u.fullName.toLowerCase().includes(q)
    })
  }, [users, query, roleFilter])

  const submitForm = async (values: StaffFormValues) => {
    setFormBusy(true)
    setFormError('')
    try {
      if (formTarget === 'new') {
        await createStaff({
          username: values.username,
          fullName: values.fullName,
          password: values.password,
          role: values.role,
          pin: values.pin,
          permissions: values.permissions,
        })
        push({ kind: 'success', message: 'Сотрудник добавлен', dismissMs: 3000 })
      } else if (formTarget) {
        await updateStaff(formTarget.id, {
          fullName: values.fullName,
          role: values.role,
          password: values.password || undefined,
          pin: values.pin || undefined,
          clearPin: values.clearPin,
          permissions: values.permissions,
        })
        push({ kind: 'success', message: 'Изменения сохранены', dismissMs: 3000 })
      }
      setFormTarget(null)
      await load()
    } catch (error) {
      setFormError(staffErrorText(error, 'Не удалось сохранить сотрудника.'))
    } finally {
      setFormBusy(false)
    }
  }

  const toggleActive = async (user: StaffUser) => {
    try {
      const saved = await updateStaff(user.id, { isActive: !user.isActive })
      setUsers((prev) => prev.map((u) => (u.id === user.id ? saved : u)))
    } catch (error) {
      push({
        kind: 'error',
        title: 'Сотрудники',
        message: staffErrorText(error, 'Не удалось изменить статус.'),
      })
    }
  }

  const confirmDelete = async (password: string) => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await deleteStaff(deleteTarget.id, password)
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id))
      push({ kind: 'success', message: `Аккаунт «${deleteTarget.username}» удалён`, dismissMs: 3000 })
      setDeleteTarget(null)
    } catch (error) {
      setDeleteError(staffErrorText(error, 'Не удалось удалить аккаунт.'))
    } finally {
      setDeleteBusy(false)
    }
  }

  const permissionLabel = (key: string) =>
    permissionOptions.find((option) => option.key === key)?.label ?? key

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Сотрудники</h2>
      <p className="settings-section__desc">
        Кассиры, их PIN и права. Владелец и администраторы — здесь же.
      </p>

      <div className="users-toolbar">
        <input
          className="settings-field__input users-toolbar__search"
          placeholder="Поиск по логину или имени…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="users-toolbar__filters">
          {ROLE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`users-filter-chip${roleFilter === f.value ? ' users-filter-chip--active' : ''}`}
              onClick={() => setRoleFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="settings-btn settings-btn--primary users-toolbar__add"
          onClick={() => {
            setFormError('')
            setFormTarget((prev) => (prev === 'new' ? null : 'new'))
          }}
        >
          {formTarget === 'new' ? 'Отмена' : '+ Сотрудник'}
        </button>
      </div>

      {formTarget !== null && (
        <StaffForm
          editing={formTarget === 'new' ? null : formTarget}
          permissionOptions={permissionOptions}
          busy={formBusy}
          error={formError}
          onSubmit={(values) => void submitForm(values)}
          onCancel={() => {
            setFormTarget(null)
            setFormError('')
          }}
        />
      )}

      <div className="users-list">
        {loading && <p className="settings-section__desc--muted">Загрузка…</p>}
        {loadError && (
          <p className="settings-test-result" role="alert">
            {loadError}{' '}
            <button type="button" className="users-row__retry" onClick={() => void load()}>
              Повторить
            </button>
          </p>
        )}
        {!loading && !loadError && filtered.length === 0 && (
          <p className="settings-section__desc--muted">
            {users.length === 0
              ? 'Сотрудников пока нет. Добавьте кассира — без PIN он не сможет подтвердить возврат.'
              : 'Никого не найдено.'}
          </p>
        )}
        {filtered.map((u) => (
          <div key={u.id} className={`users-row${u.isActive ? '' : ' users-row--inactive'}`}>
            <div className="users-row__info">
              <span className={`users-row__role users-row__role--${u.role}`}>{ROLE_LABELS[u.role]}</span>
              <div>
                <div className="users-row__name">{u.fullName || u.username}</div>
                <div className="users-row__username">{u.username}</div>
                <div className="users-row__meta">
                  <span className={`users-row__pin${u.hasPin ? ' is-set' : ''}`}>
                    {u.hasPin ? 'PIN задан' : 'PIN не задан'}
                  </span>
                  {u.permissions.length > 0 && (
                    <span className="users-row__perms">
                      {u.permissions.map(permissionLabel).join(' · ')}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="users-row__actions">
              {u.role !== 'owner' && (
                <button
                  type="button"
                  className="settings-btn settings-btn--secondary"
                  onClick={() => {
                    setFormError('')
                    setFormTarget(u)
                  }}
                >
                  Изменить
                </button>
              )}
              {u.role !== 'owner' && (
                <button
                  type="button"
                  className="settings-btn settings-btn--secondary"
                  onClick={() => void toggleActive(u)}
                >
                  {u.isActive ? 'Деактивировать' : 'Активировать'}
                </button>
              )}
              {u.role !== 'owner' ? (
                <button
                  type="button"
                  className="users-row__delete"
                  onClick={() => {
                    setDeleteError('')
                    setDeleteTarget(u)
                  }}
                >
                  Удалить
                </button>
              ) : (
                <span className="users-row__owner-hint">Сброс кассы — в разделе «Система»</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <SettingsHelpFooter title="Как это работает">
        <p>
          <strong>PIN</strong> подтверждает кассовые операции прямо у кассы: смену, отмену позиции,
          возврат. Он короткий, потому что его набирают часто и при покупателе. Деньги и настройки им
          не открываются — для этого есть пароль владельца.
        </p>
        <ul>
          <li>PIN у каждого сотрудника свой: только так в журнале видно, кто именно отменил чек.</li>
          <li>Один и тот же PIN двум сотрудникам задать нельзя — их стало бы не различить.</li>
          <li>Забытый PIN не восстанавливается, а задаётся заново: в базе лежит только хэш.</li>
          <li>Сотрудника с чеками или сменами удалить нельзя — только деактивировать.</li>
          <li>Удаление аккаунта требует пароль владельца, даже если вы уже вошли владельцем.</li>
        </ul>
      </SettingsHelpFooter>

      {deleteTarget && (
        <ConfirmPasswordModal
          title={`Удалить «${deleteTarget.username}»?`}
          description="Аккаунт будет удалён без возможности восстановления. Введите пароль владельца, чтобы подтвердить."
          confirmLabel="Удалить"
          danger
          busy={deleteBusy}
          error={deleteError}
          onConfirm={(password) => void confirmDelete(password)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </section>
  )
}
