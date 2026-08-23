// src/right-panel/components/PaymentModal.tsx

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { PaymentProvider } from '../../payments/types'
import { formatMoney, parseMoneyInput, roundMoney2, type PaymentMethod } from '../helpers'
import { QrPaymentModal, type PaymentOutcome } from './QrPaymentModal'
import './PaymentModal.css'

export type PaymentExtra = {
  cashReceived?: number
  cardAmount?: number
  change?: number
  /** Чем закончилась безналичная оплата — попадёт в продажу и в чек. */
  outcome?: PaymentOutcome
}

type Props = {
  total: number
  cashierName?: string
  storeName?: string
  /** Настроенные способы безналичной оплаты. Пусто — только наличные и долг. */
  providers: PaymentProvider[]
  /** Номер заказа для банка — он же попадёт в референс платежа. */
  orderId: string
  /** Второго монитора нет: экран покупателя показываем на этом же. */
  mirrorCustomerScreen: boolean
  processing?: boolean
  onConfirm: (method: PaymentMethod, extra: PaymentExtra) => void
  onClose: () => void
}

const QUICK_NOTES = [100, 500, 1000, 5000] as const

function initialReceivedString(totalVal: number): string {
  if (totalVal <= 0) return ''
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(totalVal)
    .replace(/\s/g, '')
    .replace(/\u00a0/g, '')
}

export const PaymentModal = memo(function PaymentModal({
  total,
  cashierName = 'Кассир',
  storeName = 'NurCRM Manablock',
  providers,
  orderId,
  mirrorCustomerScreen,
  processing = false,
  onConfirm,
  onClose,
}: Props) {
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [showQr, setShowQr] = useState(false)
  const [receivedRaw, setReceivedRaw] = useState(() => initialReceivedString(total))
  const [cardRaw, setCardRaw] = useState('')
  // Безналичный способ доступен, только если хоть один провайдер донастроен.
  const hasQr = providers.length > 0
  const receivedInputRef = useRef<HTMLInputElement>(null)

  const received = useMemo(() => parseMoneyInput(receivedRaw), [receivedRaw])
  const cardAmount = useMemo(() => parseMoneyInput(cardRaw), [cardRaw])
  const mixedTotal = received + cardAmount
  const change = useMemo(() => {
    if (method === 'card') return 0
    return roundMoney2(Math.max(0, mixedTotal - total))
  }, [method, mixedTotal, total])

  const cashOk =
    method === 'debt'
    || method === 'card'
    || (method === 'cash' && received >= total && total > 0)
    || (method === 'mixed' && mixedTotal >= total && received > 0 && cardAmount > 0)

  const openQrIfCard = useCallback(() => {
    if (hasQr) setShowQr(true)
  }, [hasQr])

  const selectCard = useCallback(() => {
    setMethod('card')
    if (hasQr) setShowQr(true)
  }, [hasQr])

  const selectMixed = useCallback(() => {
    setMethod('mixed')
    setShowQr(false)
    const half = roundMoney2(total / 2)
    setReceivedRaw(String(half))
    setCardRaw(String(roundMoney2(total - half)))
  }, [total])

  const selectDebt = useCallback(() => {
    setMethod('debt')
    setShowQr(false)
  }, [])

  const prevMethodRef = useRef<PaymentMethod | null>(null)
  useEffect(() => {
    if (
      method === 'cash'
      && total > 0
      && prevMethodRef.current === 'card'
    ) {
      setReceivedRaw(initialReceivedString(total))
      setShowQr(false)
    }
    prevMethodRef.current = method
  }, [method, total])

  const focusAndSelectAll = useCallback(() => {
    const el = receivedInputRef.current
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(0, len)
  }, [])

  const selectCash = useCallback(() => {
    setMethod('cash')
    setShowQr(false)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => focusAndSelectAll())
    })
  }, [focusAndSelectAll])

  useLayoutEffect(() => {
    if (method !== 'cash') return
    let raf1 = 0
    let raf2 = 0
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        focusAndSelectAll()
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [method, total, focusAndSelectAll])

  const addQuick = useCallback(
    (add: number) => {
      setReceivedRaw((prev) => {
        const base = parseMoneyInput(prev)
        return String(roundMoney2(base + add))
      })
    },
    [],
  )

  const handleConfirm = useCallback(() => {
    if (processing) return
    if (!cashOk) return
    if (method === 'card' && hasQr) {
      setShowQr(true)
      return
    }
    if (method === 'card') {
      onConfirm('card', {})
      return
    }
    if (method === 'mixed') {
      onConfirm('mixed', { cashReceived: received, cardAmount, change })
      return
    }
    if (method === 'debt') {
      onConfirm('debt', {})
      return
    }
    onConfirm('cash', { cashReceived: received, change })
  }, [processing, cashOk, method, onConfirm, received, cardAmount, change, hasQr])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (processing) return
        if (showQr) {
          setShowQr(false)
          return
        }
        onClose()
        return
      }

      if (e.key === 'Enter' && !e.repeat && cashOk && !processing) {
        e.preventDefault()
        if (method === 'card' && hasQr) {
          setShowQr(true)
          return
        }
        handleConfirm()
        return
      }

      if (e.key === 'F1') {
        e.preventDefault()
        e.stopImmediatePropagation()
        selectCash()
        return
      }
      if (e.key === 'F2') {
        e.preventDefault()
        e.stopImmediatePropagation()
        selectCard()
        return
      }
      if (e.key === 'F3') {
        e.preventDefault()
        e.stopImmediatePropagation()
        selectMixed()
        return
      }
      if (e.key === 'F4') {
        e.preventDefault()
        e.stopImmediatePropagation()
        selectDebt()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, cashOk, handleConfirm, method, showQr, hasQr, selectCard, selectCash, selectMixed, selectDebt, processing])

  if (showQr) {
    return (
      <QrPaymentModal
        providers={providers}
        total={total}
        orderId={orderId}
        storeName={storeName}
        cashierName={cashierName}
        mirrorOnScreen={mirrorCustomerScreen}
        onClose={() => setShowQr(false)}
        // Чек печатается только после подтверждения оплаты — сюда мы попадаем
        // именно в этот момент, и не раньше.
        onPaid={(outcome) => {
          setShowQr(false)
          onConfirm('card', { outcome })
        }}
      />
    )
  }

  return (
    <motion.div
      className="paym-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="paym-panel"
        initial={{ opacity: 0, scale: 0.98, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 6 }}
        transition={{ duration: 0.14, ease: [0.25, 0.8, 0.25, 1] }}
        role="dialog"
        aria-modal="true"
        aria-label="Оплата"
      >
        {processing ? (
          <div className="paym-processing" aria-live="polite">
            <div className="paym-processing__ring" aria-hidden="true" />
            <div>
              <h2 className="paym-processing__title">Обработка оплаты</h2>
              <p className="paym-processing__text">
                Фиксируем продажу в CRM...
              </p>
            </div>
            <div className="paym-processing__steps">
              <span>CRM</span>
              <span>Склад</span>
              <span>Чек</span>
            </div>
            <div className="paym-processing__bar" aria-hidden="true" />
          </div>
        ) : (
          <>
        <div className="paym__header">
          <h2 className="paym__title">Оплата</h2>
          <p className="paym__due">
            К оплате
            <strong className="paym__due-sum">{formatMoney(total)}&nbsp;сом</strong>
          </p>
        </div>

        <div className="paym__methods">
          <button
            type="button"
            className={`paym__method${method === 'cash' ? ' is-active' : ''}`}
            onClick={selectCash}
          >
            Наличные
            <span className="paym__kbd">F1</span>
          </button>
          <button
            type="button"
            className={`paym__method${method === 'card' ? ' is-active' : ''}`}
            onClick={selectCard}
          >
            Карта
            <span className="paym__kbd">F2</span>
          </button>
          <button
            type="button"
            className={`paym__method${method === 'mixed' ? ' is-active' : ''}`}
            onClick={selectMixed}
          >
            Смешанная
            <span className="paym__kbd">F3</span>
          </button>
          <button
            type="button"
            className={`paym__method paym__method--debt${method === 'debt' ? ' is-active' : ''}`}
            onClick={selectDebt}
          >
            В долг
            <span className="paym__kbd">F4</span>
          </button>
        </div>

        {method === 'debt' && (
          <p className="paym__debt-hint">Сумма будет записана как долг клиента в CRM.</p>
        )}

        {(method === 'cash' || method === 'mixed') && (
          <div className="paym__cash">
            <label className="paym__label" htmlFor="paym-received">
              {method === 'mixed' ? 'Наличными' : 'Получено от клиента'}
            </label>
            <input
              ref={receivedInputRef}
              id="paym-received"
              className="paym__input"
              value={receivedRaw}
              onChange={(e) => setReceivedRaw(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
            />
            {method === 'mixed' && (
              <>
                <label className="paym__label" htmlFor="paym-card">
                  Картой
                </label>
                <input
                  id="paym-card"
                  className="paym__input"
                  value={cardRaw}
                  onChange={(e) => setCardRaw(e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                />
              </>
            )}
            <div className="paym__quick" role="group" aria-label="Быстрый ввод">
              {QUICK_NOTES.map((n) => (
                <button key={n} type="button" className="paym__chip" onClick={() => addQuick(n)}>
                  +{n}
                </button>
              ))}
              <button
                type="button"
                className="paym__chip paym__chip--fill"
                onClick={() =>
                  setReceivedRaw(
                    new Intl.NumberFormat('ru-RU', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                      .format(total)
                      .replace(/\s/g, '')
                      .replace(/\u00a0/g, ''),
                  )
                }
              >
                Ровно {formatMoney(total)}&nbsp;сом
              </button>
            </div>
            <div className="paym__change">
              <span>Сдача</span>
              <strong className={change >= 0 && (method === 'mixed' ? mixedTotal >= total : received >= total) ? 'is-ok' : 'is-bad'}>
                {formatMoney(change)}&nbsp;сом
              </strong>
            </div>
            {method === 'cash' && received > 0 && received < total && (
              <p className="paym__warn">Сумма меньше к оплате</p>
            )}
            {method === 'mixed' && mixedTotal > 0 && mixedTotal < total && (
              <p className="paym__warn">Сумма наличными + картой меньше к оплате</p>
            )}
          </div>
        )}

        {method === 'card' && (
          <p className="paym__card-note">
            {hasQr
              ? 'F2 — QR для клиента · Enter — подтвердить в окне QR'
              : 'F2 — карта · Enter — подтвердить'}
          </p>
        )}

        {method === 'cash' && (
          <p className="paym__card-note">F1 — наличные · Enter — подтвердить оплату</p>
        )}
        {method === 'mixed' && (
          <p className="paym__card-note">F3 — смешанная · укажите наличные и карту</p>
        )}

        {method === 'card' && hasQr && (
          <button type="button" className="paym__btn paym__btn--ghost" onClick={openQrIfCard}>
            Показать QR снова
          </button>
        )}

        <div className="paym__actions">
          <button type="button" className="paym__btn paym__btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="paym__btn paym__btn--ok"
            disabled={!cashOk || total <= 0}
            onClick={handleConfirm}
          >
            {method === 'card' && hasQr ? 'Показать QR' : 'Подтвердить оплату'}
          </button>
        </div>
          </>
        )}
      </motion.div>
    </motion.div>
  )
})
