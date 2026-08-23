import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  isPinConfigured,
  isPinUnlocked,
  lockPin,
  pinErrorText,
  pinUnlockRemainingMs,
  subscribePinLock,
  unlockWithPin,
} from './servicePin'
import './ServicePinGate.css'

type Props = {
  /** Что закрываем — попадает в заголовок замка: «Аналитика», «Настройки». */
  title: string
  caption?: string
  /** Куда уйти по кнопке «Назад». По умолчанию — история браузера. */
  onCancel?: () => void
  /** Замок внутри уже открытого экрана (вкладка панели), а не на весь экран. */
  inline?: boolean
  children: ReactNode
}

/** Открыт ли доступ сейчас; пересчитывается по событию и по истечении срока. */
export function usePinUnlocked(): boolean {
  const [unlocked, setUnlocked] = useState(isPinUnlocked)

  useEffect(() => {
    const sync = () => setUnlocked(isPinUnlocked())
    const stop = subscribePinLock(sync)
    // Доступ истекает молча, без события, — поэтому ещё и таймер. Он ставится
    // ровно на момент истечения, а не тикает каждую секунду впустую.
    const remaining = pinUnlockRemainingMs()
    const timer = remaining > 0 ? window.setTimeout(sync, remaining + 250) : undefined
    return () => {
      stop()
      if (timer) window.clearTimeout(timer)
    }
  }, [unlocked])

  return unlocked
}

/**
 * Показывает содержимое только после ввода сервисного PIN. Пока доступ не
 * открыт, дочерние компоненты не монтируются вовсе — так они не успевают
 * запросить у сервера ни выручку, ни себестоимость.
 */
export function ServicePinGate({ title, caption, onCancel, inline, children }: Props) {
  const unlocked = usePinUnlocked()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /**
   * На кассах, установленных до появления PIN, секретом остаётся прежний
   * «Пароль доступа» — сервер его принимает. Поле обязано это учитывать:
   * иначе оно вырезает буквы, длину режет до шести символов, и владелец
   * не может ввести собственный пароль, то есть заперт в своей же кассе.
   * null — статус ещё не получен.
   */
  const [pinConfigured, setPinConfigured] = useState<boolean | null>(null)
  const legacySecret = pinConfigured === false

  useEffect(() => {
    if (unlocked) return
    let cancelled = false
    void isPinConfigured().then((configured) => {
      if (!cancelled) setPinConfigured(configured)
    })
    return () => {
      cancelled = true
    }
  }, [unlocked])

  const minLength = legacySecret ? 1 : 4

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      if (pin.length < minLength || busy) return
      setBusy(true)
      setError('')
      try {
        await unlockWithPin(pin)
        setPin('')
      } catch (caught) {
        setError(pinErrorText(caught))
      } finally {
        setBusy(false)
      }
    },
    [busy, pin, minLength],
  )

  if (unlocked) return <>{children}</>

  return (
    <main className={`mpg${inline ? ' mpg--inline' : ''}`}>
      <form className="mpg__card" onSubmit={(event) => void submit(event)}>
        <span className="mpg__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <rect x="4" y="10" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="15.5" r="1.6" fill="currentColor" />
          </svg>
        </span>

        <h1 className="mpg__title">{title}</h1>
        <p className="mpg__caption">{caption ?? 'Раздел закрыт сервисным PIN владельца.'}</p>

        <label className="mpg__field">
          <span className="mpg__label">{legacySecret ? 'Пароль доступа' : 'Сервисный PIN'}</span>
          <input
            autoFocus
            className={legacySecret ? 'mpg__secret' : 'mpg__pin'}
            type="password"
            inputMode={legacySecret ? 'text' : 'numeric'}
            value={pin}
            maxLength={legacySecret ? 128 : 6}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            onChange={(event) =>
              setPin(legacySecret ? event.target.value : event.target.value.replace(/\D/g, '').slice(0, 6))
            }
          />
        </label>

        {error && (
          <p className="mpg__error" role="alert">
            {error}
          </p>
        )}

        <div className="mpg__actions">
          <button
            type="button"
            className="mpg__btn mpg__btn--ghost"
            onClick={() => (onCancel ? onCancel() : window.history.back())}
            disabled={busy}
          >
            Назад
          </button>
          <button
            type="submit"
            className="mpg__btn mpg__btn--primary"
            disabled={busy || pin.length < minLength}
          >
            {busy ? 'Проверка…' : 'Открыть'}
          </button>
        </div>

        <p className="mpg__note">
          {legacySecret
            ? 'Эта касса настроена до появления сервисного PIN — введите «Пароль доступа», который вы задавали при регистрации. Задать PIN можно будет в настройках.'
            : 'Это не пароль входа. PIN знает только владелец — он открывает настройки, аналитику и финансы и подтверждает возвраты и отмены чеков.'}
        </p>
      </form>
    </main>
  )
}

/** Кнопка «закрыть доступ обратно» — для шапки закрытых разделов. */
export function ServiceLockButton({ className }: { className?: string }) {
  const unlocked = usePinUnlocked()
  if (!unlocked) return null
  return (
    <button type="button" className={className} onClick={lockPin} title="Закрыть доступ к разделам">
      Закрыть доступ
    </button>
  )
}
