import type { Product, ProductType } from './mockProducts'
import { normalizeBarcode } from './barcodeLookup'
import { scopedStorageKey } from '../services/accountSession'

export const PANEL_DEMO_PRODUCTS_LS_BASE = 'nurcrm-panel-demo-products'

export function panelDemoProductsStorageKey(): string {
  return scopedStorageKey(PANEL_DEMO_PRODUCTS_LS_BASE)
}

/** @deprecated используйте panelDemoProductsStorageKey() */
export const PANEL_DEMO_PRODUCTS_LS_KEY = PANEL_DEMO_PRODUCTS_LS_BASE

export type StoredPanelProduct = {
  id: string
  name: string
  priceRub: number
  wholesalePriceRub?: number
  purchasePriceRub?: number
  kind: ProductType
  /** product | service */
  productKind?: 'product' | 'service'
  /** Штрихкод с этикетки или со сканера; если пусто — временный код из id */
  barcode?: string
  extraBarcodes?: string[]
  category?: string
  brand?: string
  minimumQuantity?: number
  expiryDate?: string
  /** Горячая клавиша: F1..F12 */
  hotkeyGroup?: string
  imageDataUrl?: string
  createdAt: string
}

function parseStored(raw: string | null): StoredPanelProduct[] {
  if (!raw) return []
  try {
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return []
    return data.filter(
      (x): x is StoredPanelProduct =>
        typeof x === 'object' &&
        x !== null &&
        typeof (x as StoredPanelProduct).id === 'string' &&
        typeof (x as StoredPanelProduct).name === 'string' &&
        typeof (x as StoredPanelProduct).priceRub === 'number' &&
        ((x as StoredPanelProduct).kind === 'weight' ||
          (x as StoredPanelProduct).kind === 'piece'),
    )
  } catch {
    return []
  }
}

export function readPanelDemoProducts(): StoredPanelProduct[] {
  try {
    return parseStored(localStorage.getItem(panelDemoProductsStorageKey()))
  } catch {
    return []
  }
}

/** Товары из панели «Добавить товар» в формате каталога кассы. */
function fallbackBarcode(id: string): string {
  return `29${id.replace(/\D/g, '').slice(0, 11).padStart(11, '0')}`
}

export function panelStoredToCatalogProducts(stored: StoredPanelProduct[]): Product[] {
  return stored.map((p) => ({
    id: `panel-${p.id}`,
    barcode: normalizeBarcode(p.barcode ?? '') || fallbackBarcode(p.id),
    name: p.name.trim() || 'Товар',
    price: p.priceRub,
    wholesalePrice: p.wholesalePriceRub,
    purchasePrice: p.purchasePriceRub,
    type: p.kind,
    kind: p.productKind ?? 'product',
    extraBarcodes: p.extraBarcodes,
    image: p.imageDataUrl,
    quantity: p.kind === 'weight' ? 99 : 99,
  }))
}

export function getMergedCatalogProducts(mock: Product[]): Product[] {
  const extra = panelStoredToCatalogProducts(readPanelDemoProducts())
  return [...extra, ...mock]
}
