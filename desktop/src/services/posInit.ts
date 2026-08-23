import type { Product } from '../catalog/mockProducts'
import { apiGet } from '../api/client'
import { applyDeviceSettings } from './devices/device.client'
import { fetchProducts, readProductsCacheStaleOk } from './products'
import { loadSettings } from '../settings/appSettings'

export type PosInitProgress = {
  phase: 'auth' | 'catalog' | 'pos' | 'devices' | 'done'
  message: string
}

export type PosInitResult = {
  products: Product[]
  warnings: string[]
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; code?: string }
  return e.name === 'AbortError' || e.name === 'CanceledError' || e.code === 'ERR_CANCELED'
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

export async function runPosInit(
  onProgress?: (progress: PosInitProgress) => void,
  signal?: AbortSignal,
): Promise<PosInitResult> {
  const warnings: string[] = []
  const report = (phase: PosInitProgress['phase'], message: string) => {
    onProgress?.({ phase, message })
  }

  report('auth', 'Проверка локального сервера…')
  try {
    await apiGet('/api/auth/me', { signal })
  } catch (err: unknown) {
    if (isAbortError(err)) throw err
    // setup may be incomplete or token expired — still try catalog
    try {
      await apiGet('/health', { signal })
    } catch {
      throw new Error('Локальный сервер не запущен. Перезапустите приложение.')
    }
  }

  report('catalog', 'Загрузка каталога…')
  let products: Product[] = []
  try {
    products = await fetchProducts(signal)
  } catch {
    products = readProductsCacheStaleOk()
  }
  if (products.length === 0) {
    warnings.push('Каталог пуст — добавьте товары в панели управления.')
  } else {
    report('catalog', `Каталог: ${products.length} товаров`)
  }

  report('pos', 'Локальная касса готова')

  report('devices', 'Подключение весов и принтера…')
  try {
    const settings = loadSettings()
    await applyDeviceSettings(settings)
  } catch {
    warnings.push('Устройства подключены частично. Проверьте настройки.')
  }

  throwIfAborted(signal)
  void window.nurcrm?.markReady()

  report('done', 'Касса готова')
  return { products, warnings }
}
