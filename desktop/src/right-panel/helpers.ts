// src/right-panel/helpers.ts

export type DiscountMode = 'percent' | 'amount'
export type ProductType = 'weight' | 'piece'

/** Скидка на строку (при выборочной акции). `value`: % 0–100 или сумма в ₽ для этой позиции */
export type LineDiscount = {
  mode: DiscountMode
  value: number
}

export type CartItem = {
  lineId: string
  /** Строка-заголовок отложенного чека (имя клиента), без сумм */
  isGroupHeader?: boolean
  groupHeaderLabel?: string
  /** Доп. услуга с кассы (доставка и т.п.) — без товара из каталога */
  isAdHocService?: boolean
  productId: string
  name: string
  price: number
  purchasePrice?: number
  availableStock?: number
  type: ProductType
  quantity: number
  weightKg: number
  discount?: LineDiscount
}

export function isProductCartLine(item: CartItem): boolean {
  return !item.isGroupHeader
}

export function isAdHocServiceLine(item: CartItem): boolean {
  return Boolean(item.isAdHocService) || item.productId.startsWith('adhoc:')
}

export function createAdHocServiceCartItem(name: string, price: number): CartItem {
  const lineId = `adhoc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    lineId,
    isAdHocService: true,
    productId: `adhoc:${lineId}`,
    name: name.trim() || 'Услуга',
    price: roundMoney2(price),
    type: 'piece',
    quantity: 1,
    weightKg: 0,
  }
}

export type DeferredOrder = {
  id: string
  createdAt: string
  label: string
  items: CartItem[]
  discountMode: DiscountMode
  discountValue: string
}

export type SaleRecord = {
  id: string
  createdAt: string
  items: CartItem[]
  total: number
}

export type ShiftRecord = {
  openedAt: string
  closedAt?: string
  openCash: number
  closeCash?: number
  salesTotal: number
  /** ID смены в CRM (construction/shifts) */
  crmShiftId?: string
  cashboxId?: string
}

export type PaymentMethod = 'cash' | 'card' | 'mixed' | 'debt'

export type PaymentDetails = {
  method: PaymentMethod
  /** Через какой провайдер прошла безналичная оплата: 'qr-static-1', 'elqr'… */
  providerId?: string
  /** Название способа для чека: «MBank», «ELQR». */
  providerTitle?: string
  /** Референс платежа в банке — печатается в фискальном чеке. */
  paymentRef?: string
  /**
   * Кто подтвердил оплату. `manual` означает, что банк подтверждения не
   * присылал и кассир поверил экрану клиента — такие продажи владелец видит
   * отдельным отчётом.
   */
  paymentConfirmation?: 'auto' | 'manual'
  /** Наличные: сколько взяли у клиента (₽) */
  cashReceived?: number
  cardAmount?: number
  /** Сдача (₽) */
  change?: number
}

export type OfflineSale = {
  id: string
  createdAt: string
  items: CartItem[]
  total: number
  synced: boolean
  payment?: PaymentDetails
  discountMode?: DiscountMode
  discountValue?: string
  attempts?: number
  lastAttemptAt?: string | null
  syncing?: boolean
}

// ─── Pure math (копейки внутри сумм для точности) ─────

export function roundMoney2(value: number): number {
  return Math.round(value * 100) / 100
}

export function toKopecks(value: number): number {
  return Math.round(value * 100)
}

export function fromKopecks(kop: number): number {
  return kop / 100
}

/** Сумма строки без скидок (база) */
export function getLineGross(item: CartItem): number {
  if (item.isGroupHeader) return 0
  const raw =
    item.type === 'piece'
      ? item.price * item.quantity
      : item.price * item.weightKg
  return roundMoney2(raw)
}

/** Сумма скидки по строке (из line discount) */
export function getLineDiscountAmount(item: CartItem): number {
  if (item.isGroupHeader) return 0
  if (!item.discount) return 0
  const gross = getLineGross(item)
  const { mode, value } = item.discount
  if (!Number.isFinite(value) || value <= 0) return 0
  if (mode === 'percent') {
    const pct = Math.min(100, value)
    return roundMoney2(Math.min(gross, (gross * pct) / 100))
  }
  return roundMoney2(Math.min(gross, value))
}

/** Итог по строке после скидки */
export function getLineNetTotal(item: CartItem): number {
  return roundMoney2(Math.max(0, getLineGross(item) - getLineDiscountAmount(item)))
}

/** @deprecated используйте getLineGross / getLineNetTotal */
export function getLineTotal(item: CartItem): number {
  return getLineNetTotal(item)
}

export function hasAnyLineDiscount(items: CartItem[]): boolean {
  return items.some((i) => isProductCartLine(i) && i.discount != null)
}

export function sumGross(items: CartItem[]): number {
  return roundMoney2(items.reduce((s, i) => s + getLineGross(i), 0))
}

export function sumLineDiscounts(items: CartItem[]): number {
  return roundMoney2(items.reduce((s, i) => s + getLineDiscountAmount(i), 0))
}

export function getTotalWeight(items: CartItem[]): number {
  return items
    .filter((i) => isProductCartLine(i) && i.type === 'weight')
    .reduce((acc, i) => acc + i.weightKg, 0)
}

export function calcDiscount(
  subtotal: number,
  mode: DiscountMode,
  raw: string,
): number {
  const v = Number.parseFloat(raw.replace(',', '.'))
  if (!Number.isFinite(v) || v <= 0) return 0
  if (mode === 'percent') {
    return roundMoney2(Math.min(subtotal, (subtotal * Math.min(v, 100)) / 100))
  }
  return roundMoney2(Math.min(subtotal, v))
}

export type OrderTotals = {
  subtotalGross: number
  lineDiscounts: number
  orderDiscount: number
  discountTotal: number
  total: number
}

/** Скидка на чек действует только если нет позиционных скидок */
export function computeOrderTotals(
  items: CartItem[],
  orderMode: DiscountMode,
  orderValueRaw: string,
): OrderTotals {
  const subtotalGross = sumGross(items)
  const lineDiscounts = sumLineDiscounts(items)
  const hasLine = hasAnyLineDiscount(items)
  const orderDiscount = hasLine
    ? 0
    : calcDiscount(subtotalGross, orderMode, orderValueRaw)
  const discountTotal = roundMoney2(lineDiscounts + orderDiscount)
  const total = roundMoney2(Math.max(0, subtotalGross - discountTotal))
  return {
    subtotalGross,
    lineDiscounts,
    orderDiscount,
    discountTotal,
    total,
  }
}

/** Пропорционально распределить фикс. скидку (коп) по позициям */
export function distributeFixedDiscountKop(
  grossKops: number[],
  targetDiscountKop: number,
): number[] {
  const n = grossKops.length
  if (n === 0) return []
  const G = grossKops.reduce((a, b) => a + b, 0)
  if (G === 0) return grossKops.map(() => 0)
  const cap = Math.min(targetDiscountKop, G)
  const out: number[] = []
  let allocated = 0
  for (let i = 0; i < n; i++) {
    if (i < n - 1) {
      const share = Math.floor((cap * grossKops[i]) / G)
      out.push(share)
      allocated += share
    } else {
      out.push(Math.min(grossKops[i], cap - allocated))
    }
  }
  return out
}

export function hasDiscountInput(raw: string): boolean {
  const t = raw.replace(',', '.').trim()
  if (!t) return false
  const n = Number.parseFloat(t)
  return Number.isFinite(n) && n > 0
}

export function previewSelectiveDiscount(
  items: CartItem[],
  selectedIds: Set<string>,
  mode: DiscountMode,
  raw: string,
): number {
  if (selectedIds.size === 0) return 0
  const preview = buildVirtualCartForSelectivePreview(items, selectedIds, mode, raw)
  return computeOrderTotals(preview, 'percent', '0').discountTotal
}

/** Итог к оплате с учётом позиционных и скидки на чек. */
export function computeCartPayTotal(
  items: CartItem[],
  orderMode: DiscountMode,
  orderValueRaw: string,
): number {
  if (hasAnyLineDiscount(items)) {
    return computeOrderTotals(items, 'percent', '0').total
  }
  return computeOrderTotals(items, orderMode, orderValueRaw).total
}

export function clearLineDiscount(items: CartItem[], lineId: string): CartItem[] {
  return items.map((it) => {
    if (it.lineId !== lineId || !it.discount) return it
    const { discount: _d, ...rest } = it
    return { ...rest } as CartItem
  })
}

/**
 * Как в корзине будут суммы, если ввести скидку в панели на выбранные позиции
 * (еще не нажали «Применить») — для подвала «К оплате» / «Скидка».
 */
/** Записать скидку в корзину (после «Применить»). */
export function applyDiscountToCart(
  items: CartItem[],
  mode: DiscountMode,
  raw: string,
  selectedLineIds: string[] | null,
  splitFixedAmount = false,
): CartItem[] {
  if (!hasDiscountInput(raw)) {
    return items.map((it) => {
      if (!it.discount) return it
      const { discount: _d, ...rest } = it
      return { ...rest } as CartItem
    })
  }

  const targetIds =
    selectedLineIds && selectedLineIds.length > 0
      ? new Set(selectedLineIds)
      : new Set(items.filter(isProductCartLine).map((i) => i.lineId))

  if (targetIds.size === 0) return items

  return buildVirtualCartForSelectivePreview(items, targetIds, mode, raw, splitFixedAmount)
}

export function buildVirtualCartForSelectivePreview(
  items: CartItem[],
  selectedIds: Set<string>,
  mode: DiscountMode,
  raw: string,
  /** true только при «Применить» — сумма делится между выбранными; иначе каждая позиция получает полную сумму */
  splitFixedAmount = false,
): CartItem[] {
  if (selectedIds.size === 0) return items
  if (mode === 'percent') {
    const t = raw.replace(',', '.').trim()
    const pct =
      t === '' ? 0 : Math.min(100, Math.max(0, Number.parseFloat(t) || 0))
    return items.map((it) => {
      if (it.isGroupHeader || !selectedIds.has(it.lineId)) return it
      if (pct <= 0) {
        const { discount: _d, ...rest } = it
        return { ...rest } as CartItem
      }
      return { ...it, discount: { mode: 'percent' as const, value: pct } }
    })
  }
  const amount = Math.max(0, Number.parseFloat(raw.replace(',', '.')) || 0)
  const list = items.filter((i) => selectedIds.has(i.lineId) && isProductCartLine(i))
  if (list.length === 0) return items
  const want = roundMoney2(amount)
  if (want <= 0) {
    return items.map((it) => {
      if (it.isGroupHeader || !selectedIds.has(it.lineId)) return it
      const { discount: _d, ...rest } = it
      return { ...rest } as CartItem
    })
  }

  const discountsByLineId = new Map<string, number>()
  if (splitFixedAmount) {
    const discounts = distributeFixedDiscountKop(
      list.map((it) => toKopecks(getLineGross(it))),
      toKopecks(want),
    )
    list.forEach((it, idx) => {
      discountsByLineId.set(it.lineId, fromKopecks(discounts[idx] ?? 0))
    })
  } else {
    for (const it of list) {
      discountsByLineId.set(it.lineId, roundMoney2(Math.min(getLineGross(it), want)))
    }
  }

  return items.map((it) => {
    if (it.isGroupHeader || !selectedIds.has(it.lineId)) return it
    if (!isProductCartLine(it)) return it
    const value = roundMoney2(discountsByLineId.get(it.lineId) ?? 0)
    if (value <= 0) {
      const { discount: _d, ...rest } = it
      return { ...rest } as CartItem
    }
    return {
      ...it,
      discount: {
        mode: 'amount' as const,
        value,
      },
    }
  })
}

/** Корзина с превью скидки (до «Применить») — на выбранные или на весь чек. */
export function getDiscountPreviewCart(
  items: CartItem[],
  mode: DiscountMode,
  raw: string,
  selectionMode: boolean,
  selectedIds: Set<string>,
  skipPreviewLineIds?: Set<string>,
): CartItem[] {
  if (!hasDiscountInput(raw)) return items

  let targetIds: Set<string>
  if (selectionMode) {
    if (selectedIds.size === 0) return items
    targetIds = new Set(selectedIds)
  } else {
    targetIds = new Set(items.filter(isProductCartLine).map((i) => i.lineId))
    if (targetIds.size === 0) return items
  }

  if (skipPreviewLineIds?.size) {
    for (const id of skipPreviewLineIds) {
      targetIds.delete(id)
    }
    if (targetIds.size === 0) return items
  }

  const preview = buildVirtualCartForSelectivePreview(items, targetIds, mode, raw, false)
  if (!skipPreviewLineIds?.size) return preview

  return preview.map((it) => {
    if (!skipPreviewLineIds.has(it.lineId)) return it
    const orig = items.find((c) => c.lineId === it.lineId)
    return orig ?? it
  })
}

// ─── Formatters ──────────────────────────────────────

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatWeight(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value)
}

export function formatTimeShort(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDateTimeShort(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── Parsers ─────────────────────────────────────────

export function parsePieceQuantityInput(raw: string): number {
  const cleaned = raw.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '')
  const n = Math.floor(Number.parseFloat(cleaned))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(9999, n)
}

export function parseWeightInput(raw: string): number {
  const cleaned = raw.replace(',', '.').replace(/[^0-9.]/g, '')
  const parts = cleaned.split('.')
  const safe = parts.length > 2
    ? `${parts[0]}.${parts.slice(1).join('')}`
    : cleaned
  const parsed = Number.parseFloat(safe)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.round(parsed * 1000) / 1000
}

export function clampWeight(value: number): number {
  return Math.max(0.001, Math.round(value * 1000) / 1000)
}

export function parseMoneyInput(raw: string): number {
  const parsed = Number.parseFloat(raw.replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.round(parsed * 100) / 100
}

// ─── Utils ───────────────────────────────────────────

export function makeAutoLabel(): string {
  const t = new Date()
  const hh = String(t.getHours()).padStart(2, '0')
  const mm = String(t.getMinutes()).padStart(2, '0')
  const rand = Math.floor(10 + Math.random() * 89)
  return `Auto_${hh}:${mm}_${rand}`
}

/** Все названия товаров в одной строке (без обрезки) — для отложенных чеков. */
export function productNamesDeferFull(items: CartItem[]): string {
  const names = items
    .filter(isProductCartLine)
    .map((i) => i.name.trim())
    .filter(Boolean)
  return names.join(', ')
}

/** Короткая подпись (бейджи, подсказки). */
export function productNamesDeferPreview(items: CartItem[], maxNames = 4): string {
  const names = items
    .filter(isProductCartLine)
    .map((i) => i.name.trim())
    .filter(Boolean)
  if (names.length === 0) return ''
  const head = names.slice(0, maxNames)
  const extra = names.length > maxNames ? '…' : ''
  return `${head.join(', ')}${extra}`
}

/** Подпись от «Отложить» без имени клиента — только товары или служебная метка. */
export function isDeferLabelAutoProducts(label: string, items: CartItem[]): boolean {
  const t = label.trim()
  if (!t) return true
  const full = productNamesDeferFull(items)
  if (full && t === full) return true
  const count = items.filter(isProductCartLine).length
  for (let n = 1; n <= Math.max(4, count); n++) {
    if (t === productNamesDeferPreview(items, n)) return true
  }
  if (/^Auto_\d{2}:\d{2}_\d+$/.test(t)) return true
  if (/^Чек\s/.test(t)) return true
  return false
}

export type DeferredDisplay = {
  title: string
  goodsLine: string
  meta: string
}

/** Подпись жёлтого блока при восстановлении отложенного чека в корзину. */
export function deferredRestoreHeaderLabel(order: DeferredOrder): string {
  const label = order.label.trim()
  if (label && !isDeferLabelAutoProducts(label, order.items)) {
    return label
  }
  return label || productNamesDeferPreview(order.items, 4) || 'Отложено'
}

export function buildDeferredDisplay(order: DeferredOrder): DeferredDisplay {
  const goodsFull = productNamesDeferFull(order.items)
  const label = order.label.trim()
  const nPos = order.items.filter(isProductCartLine).length
  const meta = `${nPos} поз. · ${formatTimeShort(order.createdAt)}`

  if (label && !isDeferLabelAutoProducts(label, order.items)) {
    return { title: label, goodsLine: goodsFull, meta }
  }

  return {
    title: goodsFull || label || 'Отложено',
    goodsLine: '',
    meta,
  }
}

/** When the cart is auto-deferred (e.g. before restoring another check), use the first group title if any. */
export function labelForAutoDeferFromCart(items: CartItem[]): string {
  const h = items.find(
    (i) =>
      i.isGroupHeader &&
      typeof i.groupHeaderLabel === 'string' &&
      i.groupHeaderLabel.trim().length > 0,
  )
  if (h?.groupHeaderLabel) return h.groupHeaderLabel.trim()
  const fromGoods = productNamesDeferFull(items)
  if (fromGoods) return fromGoods
  return makeAutoLabel()
}

/** Drop group headers with no product lines under them; if nothing to sell remains, clear the cart. */
export function pruneOrphanGroupHeaders(items: CartItem[]): CartItem[] {
  if (items.length === 0) return items
  if (!items.some(isProductCartLine)) return []
  const out: CartItem[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!
    if (!it.isGroupHeader) {
      out.push(it)
      continue
    }
    let j = i + 1
    let hasProduct = false
    while (j < items.length && !items[j]!.isGroupHeader) {
      if (isProductCartLine(items[j]!)) hasProduct = true
      j++
    }
    if (hasProduct) out.push(it)
  }
  return out
}

export function removeGroupBlockByHeaderLineId(
  items: CartItem[],
  headerLineId: string,
): CartItem[] {
  const idx = items.findIndex(
    (i) => i.lineId === headerLineId && i.isGroupHeader,
  )
  if (idx < 0) return items
  const before = items.slice(0, idx)
  let j = idx + 1
  while (j < items.length && !items[j]!.isGroupHeader) {
    j++
  }
  return before.concat(items.slice(j))
}

export function collectProductLinesInGroupBlock(
  items: CartItem[],
  headerLineId: string,
): CartItem[] {
  const idx = items.findIndex(
    (i) => i.lineId === headerLineId && i.isGroupHeader,
  )
  if (idx < 0) return []
  const products: CartItem[] = []
  for (let j = idx + 1; j < items.length; j++) {
    const it = items[j]!
    if (it.isGroupHeader) break
    if (isProductCartLine(it)) products.push(it)
  }
  return products
}

export function wait(ms: number): Promise<void> {
  return new Promise((res) => window.setTimeout(res, ms))
}

// ─── Offline storage ─────────────────────────────────

const OFFLINE_KEY = 'pos_offline_sales'

export function loadOfflineSales(): OfflineSale[] {
  try {
    const raw = localStorage.getItem(OFFLINE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as OfflineSale[]
  } catch {
    return []
  }
}

export function saveOfflineSale(sale: OfflineSale): void {
  const current = loadOfflineSales()
  const updated = [sale, ...current]
  try {
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(updated))
  } catch {
    /* storage full – silently ignore */
  }
}

export function upsertOfflineSale(sale: OfflineSale): void {
  const current = loadOfflineSales()
  const updated = [sale, ...current.filter((s) => s.id !== sale.id)]
  try {
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(updated))
  } catch {
    /* storage full – silently ignore */
  }
}

export function removeOfflineSale(id: string): void {
  const current = loadOfflineSales().filter((s) => s.id !== id)
  try {
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(current))
  } catch {
    /* ignore */
  }
}

export function clearSyncedOfflineSales(): void {
  const current = loadOfflineSales().filter((s) => !s.synced)
  try {
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(current))
  } catch { /* ignore */ }
}
