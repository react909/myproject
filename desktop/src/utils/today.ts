export function todayIsoDate(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** dd.mm.yyyy → yyyy-mm-dd */
export function receiptRuDateToIso(ruDate: string): string | null {
  const parts = ruDate.trim().split('.')
  if (parts.length !== 3) return null
  const [d, m, y] = parts
  if (!d || !m || !y) return null
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

export function isReceiptOnIsoDate(receiptRuDate: string, isoDate: string): boolean {
  return receiptRuDateToIso(receiptRuDate) === isoDate
}

export function isReceiptToday(receiptRuDate: string): boolean {
  return isReceiptOnIsoDate(receiptRuDate, todayIsoDate())
}
