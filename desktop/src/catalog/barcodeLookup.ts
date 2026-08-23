import type { Product } from './mockProducts'

export function normalizeBarcode(raw: string): string {
  return raw.trim().replace(/\s/g, '')
}

function productBarcodes(p: Product): string[] {
  return [p.barcode, ...(p.extraBarcodes ?? []), p.sku, p.article]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => normalizeBarcode(v))
}

/** Все товары с этим штрихкодом (несколько вкусов). */
export function findProductsByBarcode(products: Product[], barcode: string): Product[] {
  const code = normalizeBarcode(barcode)
  if (!code) return []
  return products.filter((p) => productBarcodes(p).includes(code))
}

/** Первый товар или undefined */
export function findProductByBarcode(
  products: Product[],
  barcode: string,
): Product | undefined {
  return findProductsByBarcode(products, barcode)[0]
}
