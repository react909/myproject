/**
 * Приём безналичной оплаты.
 *
 * Модалка работает с интерфейсом PaymentProvider и не знает ни одного банка
 * поимённо. Отсюда и разница в поведении: там, где провайдер подтверждает
 * оплату сам (динамический QR, терминал), касса опрашивает статус и закрывает
 * чек автоматически; там, где подтверждения нет (статический QR), кнопку
 * «Оплата получена» жмёт кассир, и это отдельно помечается в журнале.
 *
 * QR рисуется на месте из payload — наружу за картинкой не ходим: касса
 * офлайновая, а payload содержит сумму и счёт мерчанта.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ModalPortal } from '../../components/ModalPortal'
import { CustomerDisplay } from '../../customer-display/CustomerDisplay'
import { publishCustomerDisplay } from '../../customer-display/customerDisplay.client'
import type { CustomerDisplayState } from '../../customer-display/state'
import { qrToSvg } from '../../payments/qrcode'
import { reportPaymentEvent } from '../../payments/journal'
import { PAYMENT_POLL_INTERVAL_MS, PAYMENT_TIMEOUT_SECONDS } from '../../payments/types'
import type { PaymentIntent, PaymentProvider } from '../../payments/types'
import { formatMoney } from '../helpers'
import './QrPaymentModal.css'

/** Чем закончилась оплата — уходит в продажу и в чек. */
export type PaymentOutcome = {
  providerId: string
  providerTitle: string
  paymentId: string
  reference?: string
  confirmation: 'auto' | 'manual'
}

type Props = {
  providers: PaymentProvider[]
  total: number
  orderId: string
  storeName?: string
  cashierName?: string
  /** Показывать состояние покупателю на этом же экране (второго монитора нет). */
  mirrorOnScreen: boolean
  onPaid: (outcome: PaymentOutcome) => void
  onClose: () => void
}

type Phase =
  | { kind: 'picking' }
  | { kind: 'creating'; provider: PaymentProvider }
  | { kind: 'waiting'; provider: PaymentProvider; intent: PaymentIntent; expiresAt: number }
  | { kind: 'error'; message: string; provider?: PaymentProvider }

export const QrPaymentModal = memo(function QrPaymentModal({
  providers,
  total,
  orderId,
  storeName = 'Магазин',
  cashierName = 'Кассир',
  mirrorOnScreen,
  onPaid,
  onClose,
}: Props) {
  // Один настроенный способ — выбирать не из чего, начинаем сразу с него.
  const [phase, setPhase] = useState<Phase>(() =>
    providers.length === 1 ? { kind: 'creating', provider: providers[0] } : { kind: 'picking' },
  )
  const [secondsLeft, setSecondsLeft] = useState(PAYMENT_TIMEOUT_SECONDS)
  const [busy, setBusy] = useState(false)
  const settledRef = useRef(false)

  const start = useCallback(
    async (provider: PaymentProvider) => {
      setPhase({ kind: 'creating', provider })
      try {
        const intent = await provider.createPayment(total, orderId)
        const seconds = intent.expiresInSeconds ?? PAYMENT_TIMEOUT_SECONDS
        setPhase({ kind: 'waiting', provider, intent, expiresAt: Date.now() + seconds * 1000 })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Не удалось создать платёж.'
        setPhase({ kind: 'error', message, provider })
      }
    },
    [total, orderId],
  )

  // Единственный провайдер запускается сам, без лишнего касания экрана.
  useEffect(() => {
    if (phase.kind === 'creating' && !busy) void start(phase.provider)
    // start меняется только вместе с суммой и заказом — перезапуск не нужен.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* --- Состояние для покупателя ----------------------------------------- */

  const customerState: CustomerDisplayState = useMemo(() => {
    if (phase.kind === 'waiting') {
      return {
        screen: 'qr',
        total,
        providerTitle: phase.provider.title,
        qrImageUrl: phase.intent.qrImageUrl,
        qrPayload: phase.intent.qrPayload,
        expiresAt: new Date(phase.expiresAt).toISOString(),
        // В статический QR сумма не вшивается — клиент вводит её сам.
        amountEmbedded: phase.provider.kind !== 'qr-static',
      }
    }
    if (phase.kind === 'error') return { screen: 'error', message: phase.message }
    return { screen: 'methods', total, methods: providers.map((item) => item.title) }
  }, [phase, total, providers])

  useEffect(() => {
    publishCustomerDisplay(customerState)
  }, [customerState])

  /* --- Отсчёт и опрос статуса ------------------------------------------- */

  useEffect(() => {
    if (phase.kind !== 'waiting') return
    const tick = () => setSecondsLeft(Math.max(0, Math.round((phase.expiresAt - Date.now()) / 1000)))
    tick()
    const timer = window.setInterval(tick, 500)
    return () => window.clearInterval(timer)
  }, [phase])

  const settle = useCallback(
    (provider: PaymentProvider, intent: PaymentIntent, confirmation: 'auto' | 'manual') => {
      if (settledRef.current) return
      settledRef.current = true
      publishCustomerDisplay({ screen: 'paid', total, message: 'Спасибо за покупку' })
      onPaid({
        providerId: provider.id,
        providerTitle: provider.title,
        paymentId: intent.paymentId,
        reference: intent.reference,
        confirmation,
      })
    },
    [onPaid, total],
  )

  useEffect(() => {
    if (phase.kind !== 'waiting' || phase.provider.confirmation !== 'auto') return
    let stopped = false

    const poll = async () => {
      if (stopped || settledRef.current) return
      try {
        const status = await phase.provider.getStatus(phase.intent.paymentId)
        if (stopped) return
        if (status === 'paid') {
          settle(phase.provider, phase.intent, 'auto')
          return
        }
        if (status === 'failed' || status === 'canceled') {
          setPhase({
            kind: 'error',
            message: status === 'failed' ? 'Банк отклонил платёж.' : 'Платёж отменён.',
            provider: phase.provider,
          })
        }
      } catch {
        // Разрыв связи с банком не означает неуспех: продолжаем опрашивать до
        // таймаута, иначе касса закроет чек по случайному сбою сети.
      }
    }

    const timer = window.setInterval(() => void poll(), PAYMENT_POLL_INTERVAL_MS)
    void poll()
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [phase, settle])

  /* --- Отмена ------------------------------------------------------------ */

  const cancel = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      if (phase.kind === 'waiting') {
        await phase.provider.cancel(phase.intent.paymentId).catch(() => undefined)
        // Отмена — событие для владельца, а не тихий выход из модалки.
        void reportPaymentEvent({
          providerId: phase.provider.id,
          orderId,
          amount: total,
          event: secondsLeft <= 0 ? 'timeout' : 'canceled',
        })
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }, [busy, phase, onClose, orderId, total, secondsLeft])

  const confirmManually = useCallback(() => {
    if (phase.kind !== 'waiting') return
    settle(phase.provider, phase.intent, 'manual')
  }, [phase, settle])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        void cancel()
        return
      }
      if (event.key === 'Enter' && !event.repeat) {
        event.preventDefault()
        event.stopImmediatePropagation()
        // Enter подтверждает только там, где подтверждение вообще за кассиром.
        if (phase.kind === 'waiting' && phase.provider.confirmation === 'manual') confirmManually()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [cancel, confirmManually, phase])

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = String(secondsLeft % 60).padStart(2, '0')
  const expired = phase.kind === 'waiting' && secondsLeft <= 0

  const qrSvg = useMemo(() => {
    if (phase.kind !== 'waiting' || !phase.intent.qrPayload) return ''
    try {
      return qrToSvg(phase.intent.qrPayload)
    } catch {
      return ''
    }
  }, [phase])

  return (
    <ModalPortal>
      <motion.div
        className="qrpay-overlay qrpay-overlay--fullscreen"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="qrpay-panel qrpay-panel--fullscreen"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Безналичная оплата"
        >
          <header className="qrpay-meta">
            <p className="qrpay-store">{storeName}</p>
            <p className="qrpay-sum">{formatMoney(total)} сом</p>
            <p className="qrpay-cashier">Кассир: {cashierName}</p>
          </header>

          {phase.kind === 'picking' && (
            <div className="qrpay-picker">
              <p className="qrpay-hint">Выберите банк</p>
              <div className="qrpay-banks">
                {providers.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    className="qrpay-bank"
                    onClick={() => void start(provider)}
                  >
                    <strong>{provider.title}</strong>
                    <small>
                      {provider.confirmation === 'auto'
                        ? 'Подтверждение придёт от банка'
                        : 'Подтверждает кассир'}
                    </small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {phase.kind === 'creating' && (
            <div className="qrpay-frame">
              <p className="qrpay-placeholder">Запрашиваем платёж у банка…</p>
            </div>
          )}

          {phase.kind === 'error' && (
            <div className="qrpay-frame">
              <p className="qrpay-error">{phase.message}</p>
            </div>
          )}

          {phase.kind === 'waiting' && (
            <>
              <p className="qrpay-hint">
                {phase.provider.confirmation === 'auto'
                  ? `${phase.provider.title} · ждём подтверждения от банка`
                  : `${phase.provider.title} · клиент вводит сумму сам`}
              </p>

              <div className="qrpay-frame">
                {phase.intent.qrImageUrl ? (
                  <img src={phase.intent.qrImageUrl} alt="QR для оплаты" className="qrpay-img" />
                ) : qrSvg ? (
                  <div className="qrpay-img" dangerouslySetInnerHTML={{ __html: qrSvg }} />
                ) : (
                  <p className="qrpay-placeholder">QR недоступен — выберите другой способ оплаты</p>
                )}
              </div>

              <p className={`qrpay-timer${secondsLeft <= 30 ? ' is-urgent' : ''}`}>
                {expired ? 'Время вышло' : `${minutes}:${seconds}`}
              </p>
            </>
          )}

          {mirrorOnScreen && phase.kind === 'waiting' && (
            <p className="qrpay-mirror-note">
              Второго монитора нет — покажите этот экран покупателю
            </p>
          )}

          <div className="qrpay-actions">
            <button
              type="button"
              className="qrpay-btn qrpay-btn--ghost"
              onClick={() => void cancel()}
              disabled={busy}
            >
              Отменить
            </button>
            {phase.kind === 'error' && phase.provider && (
              <button
                type="button"
                className="qrpay-btn qrpay-btn--ok"
                onClick={() => void start(phase.provider!)}
              >
                Повторить
              </button>
            )}
            {phase.kind === 'waiting' && phase.provider.confirmation === 'manual' && (
              <button type="button" className="qrpay-btn qrpay-btn--ok" onClick={confirmManually}>
                Оплата получена
              </button>
            )}
          </div>
        </motion.div>

        {/* Второго монитора нет — показываем покупателю то же самое здесь. */}
        {mirrorOnScreen && (
          <div className="qrpay-mirror">
            <CustomerDisplay state={customerState} />
          </div>
        )}
      </motion.div>
    </ModalPortal>
  )
})
