/**
 * Наличные.
 *
 * Провайдер без интеграции: деньги уже в ящике, подтверждает кассир. Он есть
 * в реестре не ради симметрии — так экран оплаты обходится одним кодом для
 * всех способов, вместо «если наличные, то по-другому».
 */

import type { PaymentIntent, PaymentProvider, PaymentStatus } from '../types'

export function createCashProvider(): PaymentProvider {
  return {
    id: 'cash',
    title: 'Наличные',
    kind: 'cash',
    // Кассир видит деньги в руках — это подтверждение, а не доверие экрану.
    confirmation: 'manual',

    async createPayment(_amount: number, orderId: string): Promise<PaymentIntent> {
      return { paymentId: `cash-${orderId}` }
    },

    async getStatus(): Promise<PaymentStatus> {
      // Само по себе ничего не происходит: статус меняет кассир кнопкой.
      return 'pending'
    },

    async cancel(): Promise<void> {
      /* отменять нечего — платёж нигде не зарегистрирован */
    },
  }
}
