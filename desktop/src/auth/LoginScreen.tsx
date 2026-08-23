import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import client, { apiGet } from '../api/client'
import { prepareAccountSession } from '../services/accountSession'
import { loadSettings } from '../settings/appSettings'
import { resolveBrand } from '../brand/brand'
import { readOnboardingCached } from '../onboarding/storage'
import './LoginScreen.css'

export type LoginScreenHandle = {
  submit: () => void
  focusInput: () => void
}

type LoginScreenProps = {
  onSuccess: (username: string) => void
  onNotify: (message: string) => void
  activeInputRef?: React.RefObject<HTMLInputElement | null>
  version?: string
}

export const LoginScreen = forwardRef<LoginScreenHandle, LoginScreenProps>(
  function LoginScreen({ onSuccess, onNotify, activeInputRef, version }, ref) {
    // Deliberately not pre-filled from localStorage: leftover usernames
    // from a previous account (test data, a former cashier) showing up
    // here after logout was confusing and unwanted.
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [showPass, setShowPass] = useState(false)
    const [usernameFocused, setUsernameFocused] = useState(false)
    const [passwordFocused, setPasswordFocused] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [storeName, setStoreName] = useState('')
    const usernameInputRef = useRef<HTMLInputElement>(null)
    const resolvedVersion = version ?? loadSettings().updates.currentVersion

    /*
      Здесь читается только название магазина.

      Цвет отсюда уехал. Экран сам ходил за `primary_color` и клал его в
      собственную переменную `--ls-accent` — это был четвёртый параллельный
      источник акцента, со своим запросом и своим временем прибытия: пока он
      ехал, левая панель успевала мигнуть стандартным цветом. Теперь цвет
      применён ещё до первого кадра (main.tsx), а обновляет его один общий хук
      useStoreTheme, и экран входа просто берёт готовый `var(--accent)`.

      `/api/setup/status` не требует авторизации — до входа другого источника
      названия нет, и секретов в ответе тоже нет.
    */
    useEffect(() => {
      let cancelled = false
      void apiGet('/api/setup/status')
        .then((res) => {
          if (cancelled) return
          const name = res.data?.store_name
          if (typeof name === 'string' && name.trim()) setStoreName(name.trim())
        })
        .catch(() => { /* keep generic branding if this fails */ })
      return () => { cancelled = true }
    }, [])

    const handleSubmit = async () => {
      setError('')
      const trimmed = username.trim()
      if (!trimmed || !password) {
        setError('Введите email и пароль')
        return
      }

      setBusy(true)
      try {
        localStorage.setItem('nurcrm-api-url', 'http://127.0.0.1:8000')
        const res = await client.post('/api/auth/login', {
          username: trimmed,
          password,
        })

        const token = res.data?.access_token
        if (!token) throw new Error('Сервер не вернул токен')

        localStorage.setItem('nurcrm-token', token)
        localStorage.removeItem('nurcrm-refresh-token')
        if (res.data?.user) {
          try {
            localStorage.setItem('nurcrm-user', JSON.stringify(res.data.user))
          } catch {
            /* ignore */
          }
        }
        localStorage.setItem('nurcrm-user-email', trimmed)
        localStorage.setItem('nurcrm-last-username', trimmed)
        prepareAccountSession(trimmed)
        onNotify('Вход выполнен')
        onSuccess(trimmed)
      } catch (err: any) {
        const detail =
          err?.response?.data?.detail
          || err?.message
          || 'Ошибка входа'
        setError(typeof detail === 'string' ? detail : 'Ошибка входа')
        onNotify(typeof detail === 'string' ? detail : 'Ошибка входа')
      } finally {
        setBusy(false)
      }
    }

    useImperativeHandle(ref, () => ({
      submit: () => void handleSubmit(),
      focusInput: () => {
        const el = activeInputRef?.current ?? usernameInputRef.current
        el?.focus()
      },
    }))

    const usernameFilled = username.trim().length > 0
    const passwordFilled = password.length > 0

    /*
      Бренд для экрана входа.

      Из кэша, а не запросом: экран входа показывается до того, как появится
      токен, и сходить за реквизитами отсюда нечем. Кэш заполняется при прошлом
      входе и переживает перезапуск — знак и название на месте с первого кадра,
      без подмигивания заводским.

      Что показать, решает `resolveBrand` — то же самое место, что и для шапки.
      Своей копии этого правила здесь больше нет: пока она была, экран входа и
      шапка расходились при каждой правке одной из них.
    */
    const brand = resolveBrand(readOnboardingCached().branding)

    return (
      <div className="ls-root">
        <div className="ls-left">
          <div className="ls-left__circle ls-left__circle--lg" />
          <div className="ls-left__circle ls-left__circle--sm" />
          <div className="ls-brand">
            <div className="ls-logo-wrap">
              <img src={brand.mark} alt="" className="ls-logo" />
            </div>
            <div>
              {/* Название системы, а не магазина. Точка после него —
                  оформление логотипа, поэтому отдельным элементом. */}
              <div className="ls-brand__name">
                {brand.name}
                <span>.</span>
              </div>
              {/* Название магазина живёт здесь, подписью — это подсказка
                  кассиру, куда он входит, а не бренд программы. */}
              <div className="ls-brand__tagline">{storeName || 'Локальная касса без интернета'}</div>
            </div>
          </div>
          <div className="ls-divider" />
          <div className="ls-features">
            <div className="ls-feature">
              <div className="ls-feature__icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 8V21H3V8" />
                  <path d="M1 3h22v5H1z" />
                  <path d="M10 12h4" />
                </svg>
              </div>
              <div className="ls-feature__body">
                <div className="ls-feature__title">Товары и остатки</div>
       
                <div className="ls-feature__desc">На этом компьютере</div>
              </div>
            </div>
            <div className="ls-feature">
              <div className="ls-feature__icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2h9l3 3v17H6z" />
                  <path d="M9 8h6M9 12h6M9 16h3" />
                </svg>
              </div>
              <div className="ls-feature__body">
                <div className="ls-feature__title">Продажи и чеки</div>
                <div className="ls-feature__desc">Долги и смены</div>
              </div>
            </div>
            <div className="ls-feature">
              <div className="ls-feature__icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9V2h12v7" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <path d="M6 14h12v8H6z" />
                </svg>
              </div>
              <div className="ls-feature__body">
                <div className="ls-feature__title">Оборудование</div>
                <div className="ls-feature__desc">Принтер, весы, сканер</div>
              </div>
            </div>
          </div>
          <div className="ls-left__footer">
            <span className="ls-version">
              <span className="ls-version__dot" />
              <b>v{resolvedVersion}</b> · Offline
            </span>
          </div>
        </div>

        <div className="ls-right">
          <form
            className="ls-card"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault()
              void handleSubmit()
            }}
          >
            <div className="ls-card__accent" />
            <div className="ls-heading">
              <div className="ls-heading__title">Вход</div>
              <div className="ls-heading__sub">Локальный аккаунт магазина</div>
            </div>

            <div className="ls-form">
              <div className="ls-field-wrap">
                <label className="ls-label" htmlFor="kassir-login-field">Email</label>
                <div
                  className={
                    'ls-field'
                    + (usernameFocused ? ' ls-field--focused' : '')
                    + (usernameFilled ? ' ls-field--filled' : '')
                  }
                >
                  <span className="ls-field__icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </span>
                  <input
                    ref={(el) => {
                      usernameInputRef.current = el
                      if (activeInputRef && 'current' in activeInputRef) {
                        ;(activeInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el
                      }
                    }}
                    id="kassir-login-field"
                    className="ls-field__input"
                    type="email"
                    name="kassir-login-field"
                    placeholder="owner@example.kg"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onFocus={() => setUsernameFocused(true)}
                    onBlur={() => setUsernameFocused(false)}
                    disabled={busy}
                  />
                </div>
              </div>

              <div className="ls-field-wrap">
                <label className="ls-label" htmlFor="kassir-password-field">Пароль</label>
                <div
                  className={
                    'ls-field'
                    + (passwordFocused ? ' ls-field--focused' : '')
                    + (passwordFilled ? ' ls-field--filled' : '')
                  }
                >
                  <span className="ls-field__icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <input
                    id="kassir-password-field"
                    className="ls-field__input"
                    type={showPass ? 'text' : 'password'}
                    name="kassir-password-field"
                    autoComplete="off"
                    spellCheck={false}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setPasswordFocused(true)}
                    onBlur={() => setPasswordFocused(false)}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="ls-field__btn"
                    onClick={() => setShowPass((v) => !v)}
                    aria-label={showPass ? 'Скрыть пароль' : 'Показать пароль'}
                  >
                    {showPass ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.6 18.6 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.6 18.6 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <path d="M1 1l22 22" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {error && <div className="ls-error">{error}</div>}

              <button type="submit" className="ls-submit" disabled={busy}>
                <span className="ls-submit__inner">
                  {busy && (
                    <span className="ls-spinner">
                      <span className="ls-spinner__arc" />
                    </span>
                  )}
                  <span>{busy ? 'Вход…' : 'Войти'}</span>
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>
    )
  },
)
