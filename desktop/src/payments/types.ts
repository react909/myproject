/**
 * Единый интерфейс приёма оплаты.
 *
 * Экран оплаты знает только этот интерфейс и ничего не знает ни про банки, ни
 * про терминалы. Добавить новый банк — значит добавить пресет и, если у него
 * свой формат, одну реализацию; правок в UI при этом ноль. Ради этого всё и
 * затевалось: иначе каждый банк тянул бы за собой ветку в модалке оплаты.
 *
 * Три уровня интеграции описаны видом провайдера:
 *
 * - `qr-static` — картинка QR банка. Работает сразу, без договоров, но сумму
 *   вводит клиент, а подтверждает оплату кассир глазами. Такие оплаты
 *   помечаются `confirmation: 'manual'` — см. журнал ручных подтверждений.
 * - `qr-dynamic` — касса запрашивает у банка QR с уже вшитой суммой и сама
 *   узнаёт о факте оплаты. Клиент не может заплатить меньше, кассир ничего не
 *   подтверждает руками.
 * - `terminal` — команда банковскому POS-терминалу, результат возвращает он.
 */

export type PaymentKind = 'cash' | 'card' | 'qr-static' | 'qr-dynamic' | 'terminal'

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'canceled'

/**
 * Кто подтверждает факт оплаты. Не косметика: `manual` попадает в отдельный
 * отчёт владельцу, потому что кассир там верит экрану телефона клиента.
 */
export type PaymentConfirmation = 'auto' | 'manual'

export type PaymentIntent = {
  paymentId: string
  /** Строка для генерации QR на нашей стороне. */
  qrPayload?: string
  /** Готовая картинка QR — для статического режима. */
  qrImageUrl?: string
  deeplink?: string
  /** Ссылка на платёж в банке — печатается в чеке строкой «Референс». */
  reference?: string
  /** Сколько секунд платёж действителен. Пусто — берётся общий таймаут. */
  expiresInSeconds?: number
}

export interface PaymentProvider {
  id: string
  title: string
  kind: PaymentKind
  /** Требует ли способ ручного подтверждения кассиром. */
  confirmation: PaymentConfirmation
  createPayment(amount: number, orderId: string): Promise<PaymentIntent>
  getStatus(paymentId: string): Promise<PaymentStatus>
  cancel(paymentId: string): Promise<void>
}

/** Сколько ждём оплату по умолчанию, прежде чем предложить отмену. */
export const PAYMENT_TIMEOUT_SECONDS = 180

/** Как часто опрашиваем статус динамического платежа. */
export const PAYMENT_POLL_INTERVAL_MS = 2000

/* -------------------------------------------------------------------------- */
/* Настройка провайдеров                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Конфигурация провайдера — то, что владелец задаёт на шаге «Оплата».
 *
 * Секретов здесь нет намеренно: мерчант-ключ живёт только на локальном
 * сервере, а этот объект кэшируется в localStorage ради работы кассы офлайн.
 * Ключ задаётся отдельно и отдельным запросом.
 */
export type PaymentProviderConfig = {
  /** Стабильный идентификатор внутри установки. */
  id: string
  kind: PaymentKind
  title: string
  enabled: boolean
  /** Пресет банка для динамического QR — см. presets.ts. */
  preset?: string
  /** Картинка QR для статического режима (data URL). */
  imageDataUrl?: string
  /** Базовый адрес API банка для динамического QR. */
  baseUrl?: string
  /** Идентификатор мерчанта у банка. */
  merchantId?: string
  /** Задан ли на сервере мерчант-ключ. Только чтение, приходит с сервера. */
  secretSet?: boolean
  /** Транспорт до платёжного терминала. */
  transport?: 'com' | 'tcp'
  /** COM-порт терминала. */
  comPort?: string
  baudRate?: number
  /** Адрес терминала при работе по сети. */
  host?: string
  tcpPort?: number
}

/** Наличные есть всегда и настройки не требуют — в конфиге их нет. */
export const CASH_PROVIDER_ID = 'cash'

/** Провайдеры, включённые в новой установке: работают без единого договора. */
export function defaultProviderConfigs(): PaymentProviderConfig[] {
  return [
    {
      id: 'qr-static-1',
      kind: 'qr-static',
      title: 'QR банка',
      enabled: true,
    },
  ]
}

export function providerConfigLabel(config: PaymentProviderConfig): string {
  return config.title.trim() || 'Без названия'
}

/** Готов ли провайдер к работе или его ещё донастраивают. */
export function providerReadiness(config: PaymentProviderConfig): {
  ready: boolean
  reason: string
} {
  if (config.kind === 'qr-static') {
    return config.imageDataUrl
      ? { ready: true, reason: '' }
      : { ready: false, reason: 'Не загружена картинка QR' }
  }
  if (config.kind === 'qr-dynamic') {
    if (!config.baseUrl?.trim()) return { ready: false, reason: 'Не указан адрес API банка' }
    if (!config.merchantId?.trim()) return { ready: false, reason: 'Не указан идентификатор мерчанта' }
    if (!config.secretSet) return { ready: false, reason: 'Не задан мерчант-ключ' }
    return { ready: true, reason: '' }
  }
  if (config.kind === 'terminal') {
    if (config.transport === 'tcp') {
      return config.host?.trim()
        ? { ready: true, reason: '' }
        : { ready: false, reason: 'Не указан адрес терминала' }
    }
    return config.comPort?.trim()
      ? { ready: true, reason: '' }
      : { ready: false, reason: 'Не указан COM-порт терминала' }
  }
  return { ready: true, reason: '' }
}
