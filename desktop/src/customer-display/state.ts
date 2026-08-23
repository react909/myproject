/**
 * Состояние экрана покупателя.
 *
 * Один тип на оба способа показа: отдельным окном на втором мониторе
 * моноблока и модалкой на основном, если второго монитора нет. Кассовая часть
 * публикует состояние и не знает, куда оно уйдёт.
 */

export type CustomerDisplayLine = {
  name: string
  /** Количество или вес, уже отформатированные для показа. */
  quantity: string
  price: number
  total: number
  discount?: number
}

export type CustomerDisplayState =
  /** Между чеками: логотип магазина. */
  | { screen: 'idle'; storeName: string; logo?: string }
  /** Кассир набирает корзину. */
  | {
      screen: 'cart'
      storeName: string
      lines: CustomerDisplayLine[]
      discountTotal: number
      total: number
    }
  /** Открыт экран оплаты, способ ещё не выбран. */
  | { screen: 'methods'; total: number; methods: string[] }
  /** Показываем QR и ждём оплату. */
  | {
      screen: 'qr'
      total: number
      providerTitle: string
      /** Готовая картинка (статический QR банка). */
      qrImageUrl?: string
      /** Payload, который мы рисуем сами (динамический QR). */
      qrPayload?: string
      /** Когда истекает платёж — ISO-строка, из неё считается таймер. */
      expiresAt: string
      /** Вшита ли сумма в код. От этого зависит текст для клиента. */
      amountEmbedded: boolean
    }
  | { screen: 'paid'; total: number; message: string }
  | { screen: 'error'; message: string }

export const CUSTOMER_DISPLAY_EVENT = 'nurcrm-customer-display'

export function idleState(storeName: string, logo?: string): CustomerDisplayState {
  return { screen: 'idle', storeName, logo }
}
