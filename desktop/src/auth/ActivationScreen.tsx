import { useState } from 'react'
import { apiPost } from '../api/client'
import { resolveBrand } from '../brand/brand'
import { readOnboardingCached } from '../onboarding/storage'
import {
  LICENSE_KEY_LENGTH,
  LICENSE_KEY_PLACEHOLDER,
  formatLicenseKeyInput,
} from './licenseKey'
import './ActivationScreen.css'

type Props =
  | {
      mode: 'activate'
      onActivated: (setupToken: string) => void
      onReactivated?: never
      onNotify?: (message: string) => void
    }
  | {
      mode: 'reactivate'
      onReactivated: () => void
      onActivated?: never
      onNotify?: (message: string) => void
    }

/* Маска ключа живёт в licenseKey.ts: её же использует окно специалиста, куда
   тот же ключ вводят при каждом приезде. Две копии однажды разошлись бы. */

export function ActivationScreen(props: Props) {
  const { mode, onNotify } = props
  const [licenseKey, setLicenseKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!licenseKey.trim()) {
      setError('Введите лицензионный ключ')
      return
    }

    setBusy(true)
    setError('')
    try {
      if (mode === 'activate') {
        const response = await apiPost('/api/setup/activate', { license_key: licenseKey })
        const token = response.data?.setup_token
        if (!token) throw new Error('Локальный сервер не подтвердил ключ')
        // Уведомления об успешной активации нет намеренно: следом сразу
        // открывается мастер установки, и это само по себе означает, что ключ
        // принят. Всплывающая плашка поверх первого шага только мешает.
        props.onActivated(token)
      } else {
        await apiPost('/api/setup/reactivate', { license_key: licenseKey })
        onNotify?.('Установка повторно активирована')
        props.onReactivated()
      }
    } catch (caught: unknown) {
      const err = caught as { response?: { data?: { detail?: string } }; message?: string }
      setError(err.response?.data?.detail ?? err.message ?? 'Не удалось проверить лицензионный ключ')
    } finally {
      setBusy(false)
    }
  }

  const brand = resolveBrand(readOnboardingCached().branding)

  return (
    <main className="activation-screen" data-no-virtual-keyboard>
      <section className="activation-screen__card">
        {/* Бренд из общего источника. При первой установке кэш пуст, и
            resolveBrand отдаёт заводской Kassir ERP; при повторной активации
            магазин уже заведён, и экран встречает его собственным знаком —
            своей копии этого правила здесь больше нет. */}
        <div className="activation-screen__brand">
          <img src={brand.mark} alt="" />
          <div>
            <strong>{brand.name}</strong>
            <span>{mode === 'activate' ? 'Первоначальная установка' : 'Повторная активация'}</span>
          </div>
        </div>

        <div className="activation-screen__lock" aria-hidden="true">⌁</div>
        <span className="activation-screen__eyebrow">Защищённая настройка</span>
        <h1>{mode === 'activate' ? 'Введите лицензионный ключ' : 'Требуется повторная активация'}</h1>
        <p>
          {mode === 'activate'
            ? 'Ключ вида KASSIR-XXXX-XXXX-XXXX выдаётся при покупке. Проверка выполняется только на этом компьютере, без интернета.'
            : 'Это программное обеспечение уже активировано на другом компьютере или диске. Введите тот же лицензионный ключ, чтобы продолжить работу здесь.'}
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <label>
            <span>Лицензионный ключ</span>
            <input
              autoFocus
              value={licenseKey}
              onChange={(event) => setLicenseKey(formatLicenseKeyInput(event.target.value))}
              autoComplete="off"
              spellCheck={false}
              placeholder={LICENSE_KEY_PLACEHOLDER}
              maxLength={LICENSE_KEY_LENGTH}
              disabled={busy}
            />
          </label>

          {error && <div className="activation-screen__error" role="alert">{error}</div>}

          <button type="submit" disabled={busy}>
            {busy ? 'Проверка…' : mode === 'activate' ? 'Продолжить настройку' : 'Активировать заново'}
          </button>
        </form>

        <small>Ключ проверяется локальным сервером Kassir ERP.</small>
      </section>
    </main>
  )
}
