import { apiGet } from '../api/client'
import { fetchReceipts } from './receipts'
import type { AnalyticsData } from './analytics'
import type { Period } from '../pages/Analytics/AnalyticsPage'
import type { FinanceData } from '../pages/Finance/FinancePage'
import type { PanelProductKind } from '../pages/panel/PanelProductFilterContext'
import type { Receipt } from '../pages/Receipts/types'

/**
 * Палитра рядов отчёта.
 *
 * Единственное место во фронте, где цвет остался значением, и это осознанно.
 * Причин две.
 *
 * Первая — смысл. Цвет ряда работает тем, что отличается от соседнего:
 * «Выручка», «Чеки» и «Средний чек» узнаются в легенде именно по разнице
 * оттенков. Привяжи любой из них к фирменному цвету — и при синем акценте два
 * ряда сольются, то есть отчёт перестанет читаться. Это ровно тот случай, для
 * которого в задании оговорено «семантические цвета акцентом не управляются».
 *
 * Вторая — техническая. Значения уходят наружу как данные — их получает сборка
 * отчёта, а не таблица стилей, — и `var(--accent)` там не к чему разрешать.
 *
 * Собраны в одну константу, чтобы их было видно все сразу: россыпь по месту не
 * даёт заметить, что два ряда встали одного цвета.
 */
const SERIES_COLORS = {
  blue: '#3b82f6',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  purple: '#8b5cf6',
  cyan: '#06b6d4',
} as const

function periodToApi(period: string): string {
  if (period === 'today' || period === 'day' || period === 'yesterday') return 'today'
  if (period === 'week' || period === '7days') return 'week'
  return 'month'
}

function money(n: number): string {
  return `${Math.round(n).toLocaleString('ru-RU')} сом`
}

function emptySpark(): number[] {
  return [0, 0, 0, 0, 0, 0, 0]
}

function filterReceiptsByKind(receipts: Receipt[], productKind: PanelProductKind): Receipt[] {
  if (productKind === 'all') return receipts
  return receipts
    .map((r) => ({
      ...r,
      items: r.items.filter((item) =>
        productKind === 'weight' ? item.isWeight : !item.isWeight,
      ),
    }))
    .filter((r) => r.items.length > 0)
}

export async function fetchCrmAnalytics(
  period: Period | string = 'month',
  productKind: PanelProductKind = 'all',
  signal?: AbortSignal,
): Promise<AnalyticsData> {
  const p = periodToApi(String(period))
  const [summaryRes, productsRes, dailyRes, receiptsRaw] = await Promise.all([
    apiGet(`/api/analytics/summary?period=${p}`, { signal }),
    apiGet(`/api/analytics/products?period=${p}&limit=50`, { signal }),
    apiGet('/api/analytics/daily?days=14', { signal }),
    fetchReceipts(300, signal).catch(() => [] as Receipt[]),
  ])

  const summary = summaryRes.data ?? {}
  const products = Array.isArray(productsRes.data) ? productsRes.data : []
  const daily = Array.isArray(dailyRes.data) ? dailyRes.data : []
  const receipts = filterReceiptsByKind(receiptsRaw, productKind)

  const revenue = Number(summary.revenue) || 0
  const salesCount = Number(summary.sales_count) || 0
  const avgCheck = Number(summary.avg_check) || 0
  const soldQty = Number(summary.sold_qty) || 0

  const mappedProducts = products.map((row: any) => ({
    name: String(row.name ?? ''),
    sold: Number(row.sold_qty) || 0,
    revenue: Number(row.revenue) || 0,
    trend: 0,
    kind: 'piece' as const,
  }))

  const salesData = daily.map((row: any) => ({
    label: String(row.date ?? '').slice(5),
    sales: Number(row.revenue) || 0,
    orders: Number(row.sales_count) || 0,
  }))

  const hourlyBuckets = Array.from({ length: 24 }, (_, hour) => ({ hour, sales: 0 }))
  for (const r of receipts) {
    const h = Number.parseInt(String(r.time).slice(0, 2), 10)
    if (Number.isFinite(h) && h >= 0 && h < 24) {
      hourlyBuckets[h]!.sales += r.total
    }
  }

  const totalCat = mappedProducts.reduce((s: number, p: { revenue: number }) => s + p.revenue, 0) || 1
  const colors = Object.values(SERIES_COLORS)
  const categories = mappedProducts.slice(0, 6).map((p: { name: string; revenue: number }, i: number) => ({
    name: p.name,
    sales: p.revenue,
    percent: Math.round((p.revenue / totalCat) * 100),
    color: colors[i % colors.length]!,
  }))

  return {
    kpis: [
      {
        id: 'revenue',
        label: 'Выручка',
        value: money(revenue),
        trend: '',
        trendUp: true,
        color: SERIES_COLORS.blue,
        icon: 'revenue',
        sparkline: emptySpark(),
      },
      {
        id: 'orders',
        label: 'Чеки',
        value: String(salesCount),
        trend: '',
        trendUp: true,
        color: SERIES_COLORS.green,
        icon: 'orders',
        sparkline: emptySpark(),
      },
      {
        id: 'check',
        label: 'Средний чек',
        value: money(avgCheck),
        trend: '',
        trendUp: true,
        color: SERIES_COLORS.amber,
        icon: 'check',
        sparkline: emptySpark(),
      },
      {
        id: 'items',
        label: 'Продано',
        value: String(Math.round(soldQty * 1000) / 1000),
        trend: '',
        trendUp: true,
        color: SERIES_COLORS.purple,
        icon: 'items',
        sparkline: emptySpark(),
      },
    ],
    salesData,
    categories,
    hourlyData: hourlyBuckets,
    topProducts: mappedProducts.slice(0, 10),
    worstProducts: [...mappedProducts].reverse().slice(0, 10),
    comparisonRows: [
      {
        metric: 'Выручка',
        current: money(revenue),
        previous: '—',
        change: '—',
        changePositive: true,
      },
      {
        metric: 'Чеки',
        current: String(salesCount),
        previous: '—',
        change: '—',
        changePositive: true,
      },
    ],
    avgCheck,
    purchaseFrequency: salesCount,
    newCustomers: 0,
    returningCustomers: 0,
  }
}

export async function fetchCrmFinance(
  period: 'day' | 'week' | 'month' | string = 'month',
  productKind: PanelProductKind = 'all',
  signal?: AbortSignal,
): Promise<FinanceData> {
  const p = periodToApi(String(period))
  const [summaryRes, productsRes, dailyRes, receiptsRaw] = await Promise.all([
    apiGet(`/api/analytics/summary?period=${p}`, { signal }),
    apiGet(`/api/analytics/products?period=${p}&limit=20`, { signal }),
    apiGet('/api/analytics/daily?days=14', { signal }),
    fetchReceipts(100, signal).catch(() => [] as Receipt[]),
  ])

  const summary = summaryRes.data ?? {}
  const products = Array.isArray(productsRes.data) ? productsRes.data : []
  const daily = Array.isArray(dailyRes.data) ? dailyRes.data : []
  const receipts = filterReceiptsByKind(receiptsRaw, productKind)

  const revenue = Number(summary.revenue) || 0
  const profit = Number(summary.profit) || 0
  const cost = Math.max(0, revenue - profit)
  const orders = Number(summary.sales_count) || 0
  const avgCheck = Number(summary.avg_check) || 0
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0

  const chartData = daily.map((row: any) => ({
    label: String(row.date ?? '').slice(5),
    value: Number(row.revenue) || 0,
  }))

  const methodTotals: Record<string, number> = { cash: 0, card: 0, mixed: 0, debt: 0 }
  for (const r of receipts) {
    methodTotals[r.paymentMethod] = (methodTotals[r.paymentMethod] ?? 0) + r.total
  }
  const paySum = Object.values(methodTotals).reduce((a, b) => a + b, 0) || 1
  const payments = [
    { type: 'Наличные', amount: methodTotals.cash, percent: Math.round((methodTotals.cash / paySum) * 100), color: SERIES_COLORS.green, icon: 'cash' },
    { type: 'Безнал', amount: methodTotals.card, percent: Math.round((methodTotals.card / paySum) * 100), color: SERIES_COLORS.blue, icon: 'card' },
    { type: 'Смешанная', amount: methodTotals.mixed, percent: Math.round((methodTotals.mixed / paySum) * 100), color: SERIES_COLORS.amber, icon: 'mixed' },
    { type: 'Долг', amount: methodTotals.debt, percent: Math.round((methodTotals.debt / paySum) * 100), color: SERIES_COLORS.red, icon: 'debt' },
  ].filter((p) => p.amount > 0)

  const mappedProducts = products.map((row: any) => ({
    name: String(row.name ?? ''),
    sold: Number(row.sold_qty) || 0,
    revenue: Number(row.revenue) || 0,
    cost: Math.max(0, Number(row.revenue) - Number(row.profit || 0)),
    trend: 0,
    kind: 'piece' as const,
  }))

  const sales = receipts.slice(0, 20).map((r) => ({
    id: r.id,
    time: `${r.date} ${r.time}`,
    amount: r.total,
    method: r.paymentMethod as 'card' | 'cash' | 'mixed' | 'debt',
    items: r.items.length,
  }))

  const metric = (
    id: string,
    label: string,
    value: string,
    rawValue: number,
    color: FinanceData['metrics'][number]['color'],
    icon: FinanceData['metrics'][number]['icon'],
  ) => ({
    id,
    label,
    value,
    rawValue,
    change: '',
    changePositive: true,
    color,
    icon,
    sparkline: emptySpark(),
  })

  return {
    revenue,
    cost,
    profit,
    margin,
    orders,
    avgCheck,
    revenueChange: '',
    revenuePositive: true,
    metrics: [
      metric('revenue', 'Выручка', money(revenue), revenue, 'blue', 'revenue'),
      metric('orders', 'Чеки', String(orders), orders, 'green', 'orders'),
      metric('check', 'Средний чек', money(avgCheck), avgCheck, 'yellow', 'check'),
      metric('profit', 'Прибыль', money(profit), profit, 'purple', 'profit'),
      metric('cost', 'Себестоимость', money(cost), cost, 'orange', 'cost'),
      metric('margin', 'Маржа', `${margin.toFixed(1)}%`, margin, 'red', 'margin'),
    ],
    chartData,
    chartPrevData: [],
    payments,
    products: mappedProducts,
    sales,
    hourlyData: Array.from({ length: 24 }, (_, i) => {
      const value = receipts
        .filter((r) => Number.parseInt(String(r.time).slice(0, 2), 10) === i)
        .reduce((s, r) => s + r.total, 0)
      return { label: `${i}:00`, value }
    }),
  }
}
