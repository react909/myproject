import { fetchCrmAnalytics } from './crmReports'
import type {
  Category,
  ComparisonRow,
  HourlyPoint,
  KPIItem,
  Period,
  Product,
  SalesPoint,
} from '../pages/Analytics/AnalyticsPage'
import type { PanelProductKind } from '../pages/panel/PanelProductFilterContext'

export type AnalyticsData = {
  kpis: KPIItem[]
  salesData: SalesPoint[]
  categories: Category[]
  hourlyData: HourlyPoint[]
  topProducts: Product[]
  worstProducts: Product[]
  comparisonRows: ComparisonRow[]
  avgCheck: number
  purchaseFrequency: number
  newCustomers: number
  returningCustomers: number
}

export async function fetchAnalytics(
  period: Period,
  productKind: PanelProductKind = 'all',
  signal?: AbortSignal,
): Promise<AnalyticsData> {
  return fetchCrmAnalytics(period, productKind, signal)
}
