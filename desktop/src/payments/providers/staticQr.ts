/**
 * Статический QR банка — нулевой уровень интеграции.
 *
 * Владелец загрузил картинку своего QR, клиент её сканирует и сам вводит
 * сумму. Работает в первый же день, без договоров и ключей, и потому включён
 * по умолчанию.
 *
 * Слабое место известно и не скрывается: сумму вводит клиент, а подтверждения
 * из банка не приходит — кассир верит экрану чужого телефона. Поэтому такие
 * оплаты помечаются `confirmation: 'manual'` и попадают в отдельный отчёт
 * владельцу. Это же и есть аргумент за переход на динамический QR.
 */

import type { PaymentIntent, PaymentProvider, PaymentStatus } from '../types'
import type { PaymentProviderConfig } from '../types'

export function createStaticQrProvider(config: PaymentProviderConfig): PaymentProvider {
  return {
    id: config.id,
    title: config.title,
    kind: 'qr-static',
    confirmation: 'manual',

    async createPayment(_amount: number, orderId: string): Promise<PaymentIntent> {
      if (!config.imageDataUrl) {
        throw new Error(`«${config.title}»: не загружена картинка QR. Загрузите её в настройках оплаты.`)
      }
      // Сумма в статический QR не вшивается — её клиент вводит сам, а касса
      // показывает крупным текстом рядом с кодом.
      return { paymentId: `static-${config.id}-${orderId}`, qrImageUrl: config.imageDataUrl }
    },

    async getStatus(): Promise<PaymentStatus> {
      // Банк о таком платеже не знает: ждём кассира.
      return 'pending'
    },

    async cancel(): Promise<void> {
      /* платёж нигде не зарегистрирован */
    },
  }
}
