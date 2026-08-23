/**
 * Карточка товара: запросы к серверу.
 *
 * Отдельно от `services/products.ts`, который обслуживает КАССУ: тот говорит
 * на языке каталога (цены числом в сомах, кеш в localStorage), и трогать его —
 * значит трогать витрину и продажу. Здесь новый язык: целые тыйыны, состав
 * комплекта, файлы.
 */

import { apiDelete, apiGet, apiPost, apiPut, LOCAL_BACKEND_URL } from '../api/client'

export type CardKind = 'piece' | 'weight' | 'service' | 'bundle'

export type BundleLine = {
  productId: number
  name: string
  qty: number
  unit: string
  stockQty: number
  priceTiyin: number
  isActive: boolean
}

export type MediaItem = {
  id: number
  kind: 'photo' | 'video'
  sortOrder: number
  mime: string
  bytesSize: number
  width: number
  height: number
  durationMs: number
  url: string
  thumbUrl: string
}

export type ProductCard = {
  id: number
  kind: CardKind
  name: string
  barcode: string
  extraBarcodes: string
  unit: string
  stockQty: number
  costTiyin: number
  priceTiyin: number
  wholesaleTiyin: number
  wholesaleFromQty: number
  markupPercent: number
  minStock: number
  expiresAt: string | null
  supplierId: number | null
  supplierName: string
  categoryId: number | null
  categoryName: string
  brand: string
  country: string
  description: string
  bundlePriceMode: 'own' | 'sum'
  bundle: BundleLine[]
  /** Сколько комплектов можно собрать. У обычного товара — свой остаток. */
  available: number
  media: MediaItem[]
  isActive: boolean
}

export type CardInput = {
  kind: CardKind
  name: string
  barcode: string
  extraBarcodes: string
  unit: string
  stockQty: number
  costTiyin: number
  priceTiyin: number
  wholesaleTiyin: number
  wholesaleFromQty: number
  minStock: number
  expiresAt: string | null
  supplierId: number | null
  categoryId: number | null
  categoryName: string
  brand: string
  country: string
  description: string
  bundlePriceMode: 'own' | 'sum'
  bundle: { productId: number; qty: number }[]
  /** Файл и его уменьшенная копия. У видео копии нет. */
  mediaTokens: { token: string; thumbToken?: string }[]
  clientToken: string
}

function toCard(raw: any): ProductCard {
  return {
    id: raw.id,
    kind: raw.kind,
    name: raw.name,
    barcode: raw.barcode ?? '',
    extraBarcodes: raw.extra_barcodes ?? '',
    unit: raw.unit ?? 'шт',
    stockQty: raw.stock_qty ?? 0,
    costTiyin: raw.cost_tiyin ?? 0,
    priceTiyin: raw.price_tiyin ?? 0,
    wholesaleTiyin: raw.wholesale_tiyin ?? 0,
    wholesaleFromQty: raw.wholesale_from_qty ?? 0,
    markupPercent: raw.markup_percent ?? 0,
    minStock: raw.min_stock ?? 0,
    expiresAt: raw.expires_at ?? null,
    supplierId: raw.supplier_id ?? null,
    supplierName: raw.supplier_name ?? '',
    categoryId: raw.category_id ?? null,
    categoryName: raw.category_name ?? '',
    brand: raw.brand ?? '',
    country: raw.country ?? '',
    description: raw.description ?? '',
    bundlePriceMode: raw.bundle_price_mode ?? 'own',
    bundle: (raw.bundle ?? []).map((line: any) => ({
      productId: line.product_id,
      name: line.name,
      qty: line.qty,
      unit: line.unit,
      stockQty: line.stock_qty,
      priceTiyin: line.price_tiyin,
      isActive: line.is_active,
    })),
    available: raw.available ?? 0,
    media: (raw.media ?? []).map(toMedia),
    isActive: raw.is_active ?? true,
  }
}

function toMedia(raw: any): MediaItem {
  return {
    id: raw.id,
    kind: raw.kind,
    sortOrder: raw.sort_order,
    mime: raw.mime,
    bytesSize: raw.bytes_size,
    width: raw.width,
    height: raw.height,
    durationMs: raw.duration_ms,
    url: raw.url,
    thumbUrl: raw.thumb_url,
  }
}

function toBody(input: CardInput) {
  return {
    kind: input.kind,
    name: input.name,
    barcode: input.barcode,
    extra_barcodes: input.extraBarcodes,
    unit: input.unit,
    stock_qty: input.stockQty,
    cost_tiyin: input.costTiyin,
    price_tiyin: input.priceTiyin,
    wholesale_tiyin: input.wholesaleTiyin,
    wholesale_from_qty: input.wholesaleFromQty,
    min_stock: input.minStock,
    expires_at: input.expiresAt,
    supplier_id: input.supplierId,
    category_id: input.categoryId,
    category_name: input.categoryName,
    brand: input.brand,
    country: input.country,
    description: input.description,
    bundle_price_mode: input.bundlePriceMode,
    bundle: input.bundle.map((line) => ({ product_id: line.productId, qty: line.qty })),
    media_tokens: input.mediaTokens.map((item) => ({
      token: item.token,
      thumb_token: item.thumbToken ?? '',
    })),
    client_token: input.clientToken,
  }
}

export async function createCard(input: CardInput): Promise<ProductCard> {
  const response = await apiPost('/api/products/card', toBody(input))
  return toCard(response.data)
}

export async function fetchCard(id: number, signal?: AbortSignal): Promise<ProductCard> {
  const response = await apiGet(`/api/products/${id}/card`, { signal })
  return toCard(response.data)
}

export async function saveCard(id: number, input: CardInput): Promise<ProductCard> {
  const response = await apiPut(`/api/products/${id}/card`, toBody(input))
  return toCard(response.data)
}

export type BarcodeOwner = { id: number | null; name: string; kind: string; priceTiyin: number }

/** Кто уже носит этот код. `id === null` — свободен. */
export async function checkBarcode(
  barcode: string,
  excludeId?: number,
  signal?: AbortSignal,
): Promise<BarcodeOwner> {
  const params = new URLSearchParams({ barcode })
  if (excludeId) params.set('exclude_id', String(excludeId))
  const response = await apiGet(`/api/products/barcode-owner?${params.toString()}`, { signal })
  return {
    id: response.data.id ?? null,
    name: response.data.name ?? '',
    kind: response.data.kind ?? '',
    priceTiyin: response.data.price_tiyin ?? 0,
  }
}

export type SearchRow = {
  id: number
  name: string
  barcode: string
  kind: CardKind
  unit: string
  priceTiyin: number
  stockQty: number
  minStock: number
  thumbUrl: string
  isActive: boolean
}

export type SearchQuery = {
  q?: string
  kind?: CardKind | ''
  supplierId?: number | null
  lowStock?: boolean
  expiringDays?: number | null
  cursor?: string
}

export async function searchProducts(
  query: SearchQuery,
  signal?: AbortSignal,
): Promise<{ items: SearchRow[]; nextCursor: string | null; total: number }> {
  const params = new URLSearchParams({ limit: '50' })
  if (query.q) params.set('q', query.q)
  if (query.kind) params.set('kind', query.kind)
  if (query.supplierId) params.set('supplier_id', String(query.supplierId))
  if (query.lowStock) params.set('low_stock', 'true')
  if (query.expiringDays != null) params.set('expiring_days', String(query.expiringDays))
  if (query.cursor) params.set('cursor', query.cursor)
  const response = await apiGet(`/api/products/search?${params.toString()}`, { signal })
  return {
    items: (response.data?.items ?? []).map((raw: any) => ({
      id: raw.id,
      name: raw.name,
      barcode: raw.barcode ?? '',
      kind: raw.kind,
      unit: raw.unit,
      priceTiyin: raw.price_tiyin,
      stockQty: raw.stock_qty,
      minStock: raw.min_stock,
      thumbUrl: raw.thumb_url ?? '',
      isActive: raw.is_active,
    })),
    nextCursor: response.data?.next_cursor ?? null,
    total: response.data?.total ?? 0,
  }
}

export type StagedMedia = {
  token: string
  kind: 'photo' | 'video'
  mime: string
  bytesSize: number
  width: number
  height: number
}

/**
 * Загрузить файл во временную папку и получить токен.
 *
 * Идёт МИМО `apiPost` намеренно: тот пакует тело в JSON, а здесь двоичные
 * данные — превращение их в base64 раздуло бы двадцатимегабайтное видео до
 * двадцати семи и заставило бы Python его декодировать.
 *
 * `fetch`, а не мост Electron: мост тоже возит строки. Сервер слушает
 * 127.0.0.1, поэтому прямой запрос работает и в приложении, и в браузере.
 */
export async function stageMedia(
  blob: Blob,
  kind: 'photo' | 'video',
  mime: string,
  durationMs = 0,
  signal?: AbortSignal,
): Promise<StagedMedia> {
  const token = localStorage.getItem('nurcrm-token') ?? ''
  const params = new URLSearchParams({ kind, mime, duration_ms: String(durationMs) })
  const response = await fetch(`${LOCAL_BACKEND_URL}/api/products/media/staged?${params}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: blob,
    signal,
  })
  if (!response.ok) {
    let detail = `Не удалось загрузить файл (${response.status}).`
    try {
      const body = await response.json()
      if (body?.detail) detail = String(body.detail)
    } catch {
      /* тело не JSON — оставляем общий текст */
    }
    throw new Error(detail)
  }
  const body = await response.json()
  return {
    token: body.token,
    kind: body.kind,
    mime: body.mime,
    bytesSize: body.bytes_size,
    width: body.width,
    height: body.height,
  }
}

export async function deleteMedia(productId: number, mediaId: number): Promise<void> {
  await apiDelete(`/api/products/${productId}/media/${mediaId}`)
}

export async function reorderMedia(productId: number, order: number[]): Promise<MediaItem[]> {
  const response = await apiPut(`/api/products/${productId}/media/order`, { order })
  return (response.data ?? []).map(toMedia)
}

/** Полный адрес файла: в `<img src>` относительный путь не сработает. */
export function mediaUrl(path: string): string {
  return path.startsWith('http') ? path : `${LOCAL_BACKEND_URL}${path}`
}
