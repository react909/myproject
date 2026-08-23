/**
 * Динамический QR через банк — основной уровень интеграции.
 *
 * Касса просит у банка платёж на конкретную сумму, получает payload, рисует
 * QR сама (см. qrcode.ts) и ждёт подтверждения. Клиент не может заплатить
 * меньше — сумма вшита в код; кассир ничего не подтверждает руками — статус
 * приходит от банка.
 *
 * Все банки обслуживаются этой одной реализацией: различия между ними —
 * адрес и ключ, а не логика, и живут в пресетах и конфигурации. Сам разговор
 * с банком ведёт локальный сервер, потому что мерчант-ключу не место в
 * интерфейсе.
 */

import { cancelIntent, createIntent, fetchIntentStatus } from '../client'
import type { PaymentIntent, PaymentProvider, PaymentProviderConfig, PaymentStatus } from '../types'

export function createDynamicQrProvider(config: PaymentProviderConfig): PaymentProvider {
  return {
    id: config.id,
    title: config.title,
    kind: 'qr-dynamic',
    // Подтверждает банк, а не кассир — ради этого уровень и нужен.
    confirmation: 'auto',

    async createPayment(amount: number, orderId: string): Promise<PaymentIntent> {
      return createIntent({ providerId: config.id, amount, orderId })
    },

    async getStatus(paymentId: string): Promise<PaymentStatus> {
      return fetchIntentStatus(paymentId)
    },

    async cancel(paymentId: string): Promise<void> {
      await cancelIntent(paymentId)
    },
  }
}
