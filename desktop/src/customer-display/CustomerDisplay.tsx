/**
 * Экран покупателя.
 *
 * Одна вёрстка на два способа показа: отдельным окном на втором мониторе
 * моноблока и модалкой на основном, когда монитор один. Всё крупное — читают
 * его через прилавок, стоя, часто в очках или без них.
 */

import { useEffect, useMemo, useState } from 'react'
import { FACTORY_NAME } from '../brand/resolve'
import { qrToSvg } from '../payments/qrcode'
import { CUSTOMER_DISPLAY_EVENT, idleState } from './state'
import type { CustomerDisplayState } from './state'
import './CustomerDisplay.css'

function formatSum(value: number): string {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

/** Подписка на состояние: событие внутри страницы или IPC во втором окне. */
export function useCustomerDisplayState(initial?: CustomerDisplayState): CustomerDisplayState {
  /* Заводское название до первого состояния от кассы — из общего источника, а
     не строкой по месту: третья копия названия системы однажды разойдётся с
     двумя первыми. Настоящее название приезжает вместе с состоянием. */
  const [state, setState] = useState<CustomerDisplayState>(initial ?? idleState(FACTORY_NAME))

  useEffect(() => {
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<CustomerDisplayState>).detail
      if (detail) setState(detail)
    }
    window.addEventListener(CUSTOMER_DISPLAY_EVENT, onEvent)
    const unsubscribe = window.customerDisplayAPI?.onState?.(setState)
    return () => {
      window.removeEventListener(CUSTOMER_DISPLAY_EVENT, onEvent)
      unsubscribe?.()
    }
  }, [])

  return state
}

/** Обратный отсчёт до конца платежа — клиент должен видеть, сколько осталось. */
function useCountdown(expiresAt: string): number {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000)))

  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000)))
    tick()
    const timer = window.setInterval(tick, 500)
    return () => window.clearInterval(timer)
  }, [expiresAt])

  return left
}

export function CustomerDisplay({ state }: { state: CustomerDisplayState }) {
  return (
    <div className={`cd cd--${state.screen}`}>
      {state.screen === 'idle' && (
        <div className="cd__idle">
          {state.logo ? (
            <img className="cd__logo" src={state.logo} alt="" />
          ) : (
            <div className="cd__logo-text">{state.storeName}</div>
          )}
          <p className="cd__welcome">Добро пожаловать</p>
        </div>
      )}

      {state.screen === 'cart' && (
        <div className="cd__cart">
          <header className="cd__head">
            <span>{state.storeName}</span>
            <span>{state.lines.length} поз.</span>
          </header>
          <ul className="cd__lines">
            {state.lines.map((line, index) => (
              <li key={`${line.name}-${index}`} className="cd__line">
                <div className="cd__line-main">
                  <span className="cd__line-name">{line.name}</span>
                  <span className="cd__line-total">{formatSum(line.total)}</span>
                </div>
                <div className="cd__line-meta">
                  <span>
                    {line.quantity} × {formatSum(line.price)}
                  </span>
                  {line.discount ? <span className="cd__line-discount">−{formatSum(line.discount)}</span> : null}
                </div>
              </li>
            ))}
          </ul>
          <footer className="cd__totals">
            {state.discountTotal > 0 && (
              <div className="cd__discount">
                <span>Скидка</span>
                <strong>−{formatSum(state.discountTotal)}</strong>
              </div>
            )}
            <div className="cd__total">
              <span>Итого</span>
              <strong>{formatSum(state.total)} сом</strong>
            </div>
          </footer>
        </div>
      )}

      {state.screen === 'methods' && (
        <div className="cd__center">
          <p className="cd__caption">К оплате</p>
          <p className="cd__amount">{formatSum(state.total)} сом</p>
          <ul className="cd__methods">
            {state.methods.map((method) => (
              <li key={method}>{method}</li>
            ))}
          </ul>
          <p className="cd__hint">Выберите способ оплаты у кассира</p>
        </div>
      )}

      {state.screen === 'qr' && <QrScreen state={state} />}

      {state.screen === 'paid' && (
        <div className="cd__center cd__center--ok">
          <div className="cd__check" aria-hidden="true">
            <svg viewBox="0 0 52 52">
              <circle cx="26" cy="26" r="24" fill="none" strokeWidth="3" />
              <path d="M14 27l8 8 16-16" fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="cd__amount">{formatSum(state.total)} сом</p>
          <p className="cd__caption">{state.message}</p>
        </div>
      )}

      {state.screen === 'error' && (
        <div className="cd__center cd__center--error">
          <p className="cd__caption">Оплата не прошла</p>
          <p className="cd__error">{state.message}</p>
          <p className="cd__hint">Обратитесь к кассиру</p>
        </div>
      )}
    </div>
  )
}

function QrScreen({ state }: { state: Extract<CustomerDisplayState, { screen: 'qr' }> }) {
  const left = useCountdown(state.expiresAt)
  const minutes = Math.floor(left / 60)
  const seconds = String(left % 60).padStart(2, '0')

  // Рисуем сами и только из payload — картинку банка показываем как есть.
  const svg = useMemo(() => {
    if (!state.qrPayload) return ''
    try {
      return qrToSvg(state.qrPayload)
    } catch {
      return ''
    }
  }, [state.qrPayload])

  return (
    <div className="cd__qr">
      <p className="cd__provider">{state.providerTitle}</p>
      <div className="cd__qr-frame">
        {state.qrImageUrl ? (
          <img src={state.qrImageUrl} alt="QR для оплаты" />
        ) : svg ? (
          <div className="cd__qr-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <p className="cd__error">QR недоступен — обратитесь к кассиру</p>
        )}
      </div>
      <p className="cd__amount">{formatSum(state.total)} сом</p>
      <p className="cd__hint">
        {state.amountEmbedded
          ? 'Отсканируйте камерой банковского приложения — сумма уже в коде'
          : 'Отсканируйте камерой банковского приложения и введите сумму вручную'}
      </p>
      <p className={`cd__timer${left <= 30 ? ' is-urgent' : ''}`}>
        {minutes}:{seconds}
      </p>
    </div>
  )
}

/** Точка входа отдельного окна на втором мониторе. */
export function CustomerDisplayApp() {
  const state = useCustomerDisplayState()
  return <CustomerDisplay state={state} />
}
