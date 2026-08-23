/**
 * Журнал платёжных событий.
 *
 * Пишем то, чего не видно в самой продаже: отменённые и просроченные попытки
 * оплаты. Без этого отменённый QR не оставляет следа, и разобраться, почему
 * покупатель ушёл без чека, потом нечем.
 *
 * Запись — best effort: сорванная запись в журнал не должна ломать кассу
 * посреди смены.
 */

import { apiPost } from '../api/client'

export type PaymentEvent = {
  providerId: string
  orderId: string
  amount: number
  event: 'canceled' | 'timeout'
}

export async function reportPaymentEvent(payload: PaymentEvent): Promise<void> {
  try {
    await apiPost('/api/payments/events', {
      provider_id: payload.providerId,
      order_id: payload.orderId,
      amount: payload.amount,
      event: payload.event,
    })
  } catch {
    /* журнал не критичен для продажи */
  }
}
