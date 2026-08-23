/** Генерация EAN-13 для новых товаров (префикс 29 — внутренний ассортимент). */
export function generateEan13Barcode(): string {
  const base = `29${String(Date.now()).slice(-9)}${Math.floor(Math.random() * 10)}`
  const digits = base.padStart(12, '0').slice(0, 12)
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const d = Number(digits[i])
    sum += i % 2 === 0 ? d : d * 3
  }
  const check = (10 - (sum % 10)) % 10
  return `${digits}${check}`
}

export function parseExtraBarcodes(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}
