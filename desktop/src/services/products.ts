import type { Product, ProductKind, ProductType } from '../catalog/mockProducts'
import { humanizeApiError } from '../api/errors'
import { apiDelete, apiGet, apiPatch, apiPost } from '../api/client'
import { scopedStorageKey } from './accountSession'

type ApiProduct = {
  id: number
  name: string
  barcode: string
  extra_barcodes?: string
  kind: string
  unit: string
  price: number
  wholesale_price: number
  cost_price: number
  stock_qty: number
  category_id: number | null
  category_name?: string | null
  image: string
  is_active: boolean
}

const CACHE_BASE = 'nurcrm-products-cache-v1'
export const PRODUCTS_CACHE_TTL_MS = 5 * 60 * 1000

function cacheKey(): string {
  return scopedStorageKey(CACHE_BASE)
}

function mapKind(kind: string): { type: ProductType; productKind: ProductKind } {
  if (kind === 'weight') return { type: 'weight', productKind: 'product' }
  if (kind === 'service') return { type: 'piece', productKind: 'service' }
  return { type: 'piece', productKind: 'product' }
}

export function mapApiProduct(p: ApiProduct): Product {
  const { type, productKind } = mapKind(p.kind)
  const extras = (p.extra_barcodes || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    id: String(p.id),
    barcode: p.barcode || '',
    name: p.name,
    price: Number(p.price) || 0,
    wholesalePrice: Number(p.wholesale_price) || 0,
    purchasePrice: Number(p.cost_price) || 0,
    type,
    kind: productKind,
    extraBarcodes: extras,
    image: p.image || undefined,
    stock: Number(p.stock_qty) || 0,
    quantity: Number(p.stock_qty) || 0,
  }
}

export function writeProductsCache(products: Product[]) {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify({ at: Date.now(), products }))
  } catch {
    /* ignore */
  }
}

export function readProductsCacheStaleOk(): Product[] {
  try {
    const raw = localStorage.getItem(cacheKey())
    if (!raw) return []
    const parsed = JSON.parse(raw) as { products?: Product[] }
    return Array.isArray(parsed.products) ? parsed.products : []
  } catch {
    return []
  }
}

export function readProductsCacheAge(): number | null {
  try {
    const raw = localStorage.getItem(cacheKey())
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at?: number }
    return typeof parsed.at === 'number' ? parsed.at : null
  } catch {
    return null
  }
}

export async function fetchProducts(signal?: AbortSignal): Promise<Product[]> {
  const res = await apiGet('/api/products?active_only=true', { signal })
  const list = Array.isArray(res.data) ? (res.data as ApiProduct[]) : []
  const products = list.map(mapApiProduct)
  writeProductsCache(products)
  return products
}

export async function refreshProductsFromNetwork(signal?: AbortSignal): Promise<Product[]> {
  return fetchProducts(signal)
}

export function extractApiError(err: unknown): string {
  return humanizeApiError(err, 'Ошибка сохранения')
}

export type CreateProductInput = {
  name: string
  barcode?: string
  extraBarcodes?: string[]
  kind?: 'piece' | 'weight' | 'service'
  price: number
  wholesalePrice?: number
  costPrice?: number
  stockQty?: number
  categoryId?: number | null
  image?: string
}

/** Совместимость с формой добавления товара в панели. */
export type LegacyCreateProductPayload = {
  kind?: 'product' | 'service'
  name: string
  barcode?: string
  code?: string
  article?: string
  price?: string | number
  wholesale_price?: string | number
  purchase_price?: string | number
  minimum_quantity?: string | number
  is_weight?: boolean
  category_name?: string
  brand_name?: string
  expiration_date?: string
  hotkey_group?: string
}

function num(v: string | number | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = Number.parseFloat(v.replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

export async function createProduct(
  input: LegacyCreateProductPayload | CreateProductInput,
): Promise<Product> {
  const legacy = input as LegacyCreateProductPayload
  const modern = input as CreateProductInput

  let kind: 'piece' | 'weight' | 'service' = modern.kind ?? 'piece'
  if ('is_weight' in legacy || 'kind' in legacy) {
    if (legacy.kind === 'service') kind = 'service'
    else if (legacy.is_weight) kind = 'weight'
    else kind = 'piece'
  }

  const extras: string[] = []
  if (legacy.code) extras.push(legacy.code)
  if (legacy.article) extras.push(...String(legacy.article).split(',').map((s) => s.trim()).filter(Boolean))
  if (modern.extraBarcodes) extras.push(...modern.extraBarcodes)

  const body = {
    name: modern.name ?? legacy.name,
    barcode: modern.barcode ?? legacy.barcode ?? '',
    extra_barcodes: extras.join(','),
    kind,
    unit: kind === 'weight' ? 'кг' : kind === 'service' ? 'усл' : 'шт',
    price: modern.price ?? num(legacy.price),
    wholesale_price: modern.wholesalePrice ?? num(legacy.wholesale_price),
    cost_price: modern.costPrice ?? num(legacy.purchase_price),
    stock_qty: modern.stockQty ?? num(legacy.minimum_quantity),
    category_id: modern.categoryId ?? null,
    image: modern.image ?? '',
  }

  // Ensure category by name if provided
  if (legacy.category_name?.trim()) {
    try {
      const cats = await fetchCategories()
      let cat = cats.find((c: any) => String(c.name).toLowerCase() === legacy.category_name!.trim().toLowerCase())
      if (!cat) {
        const created = await apiPost('/api/categories', { name: legacy.category_name.trim() })
        cat = created.data
      }
      if (cat?.id) body.category_id = cat.id
    } catch {
      /* ignore category errors */
    }
  }

  const res = await apiPost('/api/products', body)
  return mapApiProduct(res.data as ApiProduct)
}

export async function updateProduct(
  id: string,
  patch: Partial<CreateProductInput & { isActive?: boolean }>,
): Promise<Product> {
  const body: Record<string, unknown> = {}
  if (patch.name != null) body.name = patch.name
  if (patch.barcode != null) body.barcode = patch.barcode
  if (patch.extraBarcodes != null) body.extra_barcodes = patch.extraBarcodes.join(',')
  if (patch.kind != null) body.kind = patch.kind
  if (patch.price != null) body.price = patch.price
  if (patch.wholesalePrice != null) body.wholesale_price = patch.wholesalePrice
  if (patch.costPrice != null) body.cost_price = patch.costPrice
  if (patch.stockQty != null) body.stock_qty = patch.stockQty
  if (patch.categoryId !== undefined) body.category_id = patch.categoryId
  if (patch.image != null) body.image = patch.image
  if (patch.isActive != null) body.is_active = patch.isActive
  const res = await apiPatch(`/api/products/${encodeURIComponent(id)}`, body)
  return mapApiProduct(res.data as ApiProduct)
}

export async function deleteProduct(id: string): Promise<void> {
  await apiDelete(`/api/products/${encodeURIComponent(id)}`)
}

export async function fetchCategories(signal?: AbortSignal) {
  const res = await apiGet('/api/categories', { signal })
  return Array.isArray(res.data) ? res.data : []
}
