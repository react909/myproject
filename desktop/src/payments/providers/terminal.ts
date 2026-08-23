/**
 * Платёжный терминал банка — третий уровень интеграции.
 *
 * Нужен там, где у магазина уже стоит банковский POS: касса отдаёт ему сумму,
 * а он сам показывает QR или ждёт карту и возвращает результат. Разговор с
 * железом ведёт main-процесс Electron — из renderer COM-порта не видно.
 *
 * Протокол конкретного терминала подключается в electron/devices/pos-terminal.cjs.
 * Пока банк не выдал спецификацию, провайдер честно сообщает, что терминал не
 * ответил, и кассир уходит на другой способ оплаты. Выдумывать ответ терминала
 * нельзя: это означало бы закрытый чек без денег.
 */

import type { PaymentIntent, PaymentProvider, PaymentProviderConfig, PaymentStatus } from '../types'

function bridge() {
  return window.devicesAPI
}

export function createTerminalProvider(config: PaymentProviderConfig): PaymentProvider {
  return {
    id: config.id,
    title: config.title,
    kind: 'terminal',
    confirmation: 'auto',

    async createPayment(amount: number, orderId: string): Promise<PaymentIntent> {
      const start = bridge()?.startTerminalPayment
      if (!start) {
        throw new Error('Работа с терминалом доступна только в приложении Kassir ERP.')
      }
      const result = await start({
        providerId: config.id,
        amount,
        orderId,
        transport: config.transport ?? 'com',
        comPort: config.comPort,
        baudRate: config.baudRate,
        host: config.host,
        tcpPort: config.tcpPort,
      })
      if (!result.ok) throw new Error(result.message)
      return {
        paymentId: result.paymentId,
        qrPayload: result.qrPayload,
        reference: result.reference,
      }
    },

    async getStatus(paymentId: string): Promise<PaymentStatus> {
      const poll = bridge()?.getTerminalPaymentStatus
      if (!poll) return 'failed'
      const result = await poll(paymentId)
      return result.status
    },

    async cancel(paymentId: string): Promise<void> {
      await bridge()?.cancelTerminalPayment?.(paymentId)
    },
  }
}
