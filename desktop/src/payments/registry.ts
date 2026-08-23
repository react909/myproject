/**
 * Реестр провайдеров оплаты.
 *
 * Единственное место, где вид провайдера превращается в реализацию. Экран
 * оплаты вызывает `availableProviders()` и дальше работает с интерфейсом —
 * ему всё равно, статический это QR, ELQR или терминал.
 */

import { readOnboardingCached } from '../onboarding/storage'
import { loadSettings } from '../settings/appSettings'
import { createCashProvider } from './providers/cash'
import { createDynamicQrProvider } from './providers/dynamicQr'
import { createStaticQrProvider } from './providers/staticQr'
import { createTerminalProvider } from './providers/terminal'
import { providerReadiness } from './types'
import type { PaymentProvider, PaymentProviderConfig } from './types'

export function createProvider(config: PaymentProviderConfig): PaymentProvider | null {
  switch (config.kind) {
    case 'qr-static':
      return createStaticQrProvider(config)
    case 'qr-dynamic':
      return createDynamicQrProvider(config)
    case 'terminal':
      return createTerminalProvider(config)
    case 'cash':
      return createCashProvider()
    default:
      return null
  }
}

/**
 * Провайдеры, готовые принять оплату прямо сейчас.
 *
 * Недонастроенные отсеиваются здесь, а не в интерфейсе: показать кассиру
 * кнопку банка без ключа значит подвести его при живом покупателе.
 */
export function availableProviders(configs: PaymentProviderConfig[]): PaymentProvider[] {
  return configs
    .filter((config) => config.enabled && providerReadiness(config).ready)
    .map(createProvider)
    .filter((provider): provider is PaymentProvider => provider !== null)
}

/**
 * До появления списка провайдеров картинка QR лежала одна на всю установку, в
 * локальных настройках. Подставляем её первому статическому провайдеру, у
 * которого своей картинки ещё нет: иначе после обновления магазин, годами
 * принимавший QR, обнаружил бы, что безнал с кассы пропал.
 */
function withLegacyQrImage(configs: PaymentProviderConfig[]): PaymentProviderConfig[] {
  const legacy = loadSettings().paymentQr.imageDataUrl
  if (!legacy) return configs
  let used = false
  return configs.map((config) => {
    if (used || config.kind !== 'qr-static' || config.imageDataUrl) return config
    used = true
    return { ...config, imageDataUrl: legacy }
  })
}

/** Настроенные провайдеры безналичной оплаты для текущей установки. */
export function providersFromSettings(): PaymentProvider[] {
  return availableProviders(withLegacyQrImage(readOnboardingCached().acquiring.providers))
}

export function providerById(id: string): PaymentProvider | null {
  const config = readOnboardingCached().acquiring.providers.find((item) => item.id === id)
  return config ? createProvider(config) : null
}
