/**
 * Обращения к платёжной части локального сервера.
 *
 * Динамический QR идёт через backend, а не напрямую из интерфейса, по трём
 * причинам: мерчант-ключ не должен попадать в renderer и в localStorage;
 * банковский API не разрешает запросы с file://; и статус платежа надо
 * опрашивать даже когда экран оплаты закрыли.
 *
 * Наличные и статический QR сюда не ходят — они работают целиком офлайн.
 */

import { apiGet, apiPost, apiPut } from '../api/client'
import type { PaymentIntent, PaymentStatus } from './types'

export type CreateIntentInput = {
  providerId: string
  amount: number
  orderId: string
}

export async function createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
  const res = await apiPost('/api/payments/intents', {
    provider_id: input.providerId,
    amount: input.amount,
    order_id: input.orderId,
  })
  const data = res?.data as {
    payment_id: string
    qr_payload?: string
    deeplink?: string
    reference?: string
    expires_in_seconds?: number
  }
  if (!data?.payment_id) throw new Error('Банк не вернул идентификатор платежа.')
  return {
    paymentId: data.payment_id,
    qrPayload: data.qr_payload,
    deeplink: data.deeplink,
    reference: data.reference,
    expiresInSeconds: data.expires_in_seconds,
  }
}

export async function fetchIntentStatus(paymentId: string): Promise<PaymentStatus> {
  const res = await apiGet(`/api/payments/intents/${encodeURIComponent(paymentId)}`)
  const status = (res?.data as { status?: string })?.status
  return status === 'paid' || status === 'failed' || status === 'canceled' ? status : 'pending'
}

export async function cancelIntent(paymentId: string): Promise<void> {
  await apiPost(`/api/payments/intents/${encodeURIComponent(paymentId)}/cancel`)
}

/**
 * Мерчант-ключ уходит на сервер и обратно уже не возвращается — интерфейс
 * узнаёт только сам факт, что ключ задан.
 */
export async function saveProviderSecret(providerId: string, apiKey: string): Promise<void> {
  await apiPut(`/api/payments/providers/${encodeURIComponent(providerId)}/secret`, { api_key: apiKey })
}

export async function fetchProviderSecretFlags(): Promise<Record<string, boolean>> {
  const res = await apiGet('/api/payments/providers/secrets')
  const data = (res?.data as { secrets?: Record<string, boolean> })?.secrets
  return data ?? {}
}
