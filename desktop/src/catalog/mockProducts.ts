export type ProductType = 'piece' | 'weight'

export type ProductKind = 'product' | 'service' | 'bundle'

export type Product = {
  id: string
  barcode: string
  name: string
  price: number
  wholesalePrice?: number
  purchasePrice?: number
  type: ProductType
  kind?: ProductKind
  extraBarcodes?: string[]
  image?: string
  quantity?: number
  stock?: number
  count?: number
  balance?: number
  available?: number
  sku?: string
  article?: string
}

/** Пустой список: каталог кассы загружается только из CRM API. */
export const MOCK_PRODUCTS: Product[] = []

export function findProductById(productId: string): Product | undefined {
  return MOCK_PRODUCTS.find((product) => product.id === productId)
}

export { findProductByBarcode } from './barcodeLookup'

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatAmount(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(value)
}

export function getProductStock(product: Product): number | undefined {
  return [
    product.quantity,
    product.stock,
    product.count,
    product.balance,
    product.available,
  ].find((v): v is number => typeof v === 'number' && Number.isFinite(v))
}

export function getProductStockLabel(product: Product): string {
  const qty = getProductStock(product)
  if (typeof qty !== 'number') return product.type === 'weight' ? '— кг' : '— шт'
  if (product.type === 'weight') return `${formatAmount(qty)} кг`
  return `${Math.floor(qty)} шт`
}
