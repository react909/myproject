import { useCallback, useEffect, useMemo, useState } from 'react'
import { getCurrentAccountKey } from '../../services/accountSession'
import { usePanelProductFilter } from '../panel/PanelProductFilterContext'
import { useProductReportModal } from '../../context/ProductReportModalProvider'
import { filterProductsByKind } from '../panelFilterUtils'
import { usePanelAsyncLoad } from '../../hooks/usePanelAsyncLoad'
import { HeavyPageGate } from '../HeavyPageGate'
import { fetchAnalytics, type AnalyticsData } from '../../services/analytics'
import { AnalyticsHeader } from './components/AnalyticsHeader'
import { PeriodSelector } from './components/PeriodSelector'
import { KPICards } from './components/KPICards'
import { SalesChart } from './components/SalesChart'
import { CategoryBreakdown } from './components/CategoryBreakdown'
import { HourlyHeatmap } from './components/HourlyHeatmap'
import { ProductPerformance } from './components/ProductPerformance'
import { CustomerInsights } from './components/CustomerInsights'
import { ComparisonTable } from './components/ComparisonTable'
import { LoadingScreen } from '../LoadingScreen'
import { PanelFetchOverlay } from '../PanelFetchOverlay'
import './AnalyticsPage.css'

export type Period = 'today' | 'yesterday' | '7days' | '30days' | 'custom'

export type KPIItem = {
  id: string
  label: string
  value: string
  trend: string
  trendUp: boolean
  color: string
  icon: 'revenue' | 'orders' | 'check' | 'conversion' | 'items' | 'returns'
  sparkline: number[]
}

export type SalesPoint = {
  label: string
  sales: number
  orders: number
}

export type Category = {
  name: string
  sales: number
  percent: number
  color: string
}

export type HourlyPoint = {
  hour: number
  sales: number
}

export type ProductKind = 'weight' | 'piece'

export type Product = {
  name: string
  sold: number
  revenue: number
  trend: number
  kind: ProductKind
}

export type ComparisonRow = {
  metric: string
  current: string
  previous: string
  change: string
  changePositive: boolean
}

export type AnalyticsPageProps = { embedded?: boolean; active?: boolean }

export function AnalyticsPage({ embedded = false, active = true }: AnalyticsPageProps) {
  const { productKind } = usePanelProductFilter()
  const { openProductReport } = useProductReportModal()
  const [period, setPeriod] = useState<Period>('30days')

  const { data, isLoading, isRefreshing, error, hasData, reload } = usePanelAsyncLoad<AnalyticsData>(
    (signal) => fetchAnalytics(period, productKind, signal),
    [period, productKind],
    active,
    `panel:analytics:${getCurrentAccountKey()}:${period}:${productKind}`,
  )

  useEffect(() => {
    const onInvalidate = () => {
      if (active) reload()
    }
    window.addEventListener('nurcrm-data-invalidated', onInvalidate)
    return () => window.removeEventListener('nurcrm-data-invalidated', onInvalidate)
  }, [active, reload])

  const topProducts = useMemo(
    () => filterProductsByKind(data?.topProducts ?? [], productKind),
    [data?.topProducts, productKind],
  )
  const worstProducts = useMemo(
    () => filterProductsByKind(data?.worstProducts ?? [], productKind),
    [data?.worstProducts, productKind],
  )

  const handleExport = useCallback(() => {
    if (!data) return
    const rows = [
      ['Раздел', 'Показатель', 'Значение', 'Дополнительно'],
      ...data.kpis.map((k) => ['KPI', k.label, k.value, k.trend]),
      ...data.salesData.map((p) => ['Динамика продаж', p.label, String(p.sales), `Заказы: ${p.orders}`]),
      ...data.categories.map((c) => ['Категории', c.name, String(c.sales), `${c.percent}%`]),
      ...data.hourlyData.map((h) => ['Продажи по часам', `${h.hour}:00`, String(h.sales), '']),
      ...topProducts.map((p) => ['Топ товаров', p.name, String(p.revenue), `Продано: ${p.sold}`]),
    ]
    const csv = [
      ...rows.map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')),
    ].join('\n')
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `analytics-${period}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [data, period, topProducts])

  if (!hasData && isLoading) {
    return (
      <LoadingScreen
        title="Загрузка аналитики..."
        subtitle="Собираем выручку, прибыль, категории и товары из CRM"
      />
    )
  }

  if (!data) {
    return (
      <LoadingScreen
        title="Загрузка аналитики..."
        subtitle={error ?? 'Собираем выручку, прибыль, категории и товары из CRM'}
      />
    )
  }

  const inner = (
    <div className={`ap panel-fetch-shell${embedded ? ' ap--embedded' : ''}`}>
      {isRefreshing && hasData ? <PanelFetchOverlay label="Обновление аналитики…" /> : null}

      <AnalyticsHeader
        onRefresh={reload}
        onExport={handleExport}
        isRefreshing={isRefreshing}
        embedded={embedded}
      />

      <div className="ap__body">
        <PeriodSelector period={period} onPeriodChange={setPeriod} />

        {error ? <div className="ap__error">{error}</div> : null}

        <KPICards kpis={data.kpis} />

        {active ? <SalesChart data={data.salesData} /> : null}

        <div className="ap__row ap__row--2">
          <CategoryBreakdown categories={data.categories} />
          {active ? <HourlyHeatmap data={data.hourlyData} /> : null}
        </div>

        <ProductPerformance
          top={topProducts}
          worst={worstProducts}
          externalKind={productKind !== 'all' ? productKind : undefined}
          onProductClick={(name) => openProductReport(name, period === '7days' ? '7days' : period === 'today' ? 'today' : period === 'yesterday' ? 'today' : 'month')}
        />

        {(data.newCustomers > 0 || data.returningCustomers > 0 || data.comparisonRows.length > 0) && (
          <div className="ap__row ap__row--2">
            {(data.newCustomers > 0 || data.returningCustomers > 0) && (
              <CustomerInsights
                avgCheck={data.avgCheck}
                frequency={data.purchaseFrequency}
                newCustomers={data.newCustomers}
                returningCustomers={data.returningCustomers}
              />
            )}
            {data.comparisonRows.length > 0 && <ComparisonTable rows={data.comparisonRows} />}
          </div>
        )}
      </div>
    </div>
  )

  if (embedded) return inner
  return (
    <HeavyPageGate
      loadingTitle="Загрузка аналитики..."
      loadingSubtitle="Обработка данных и построение графиков"
    >
      {inner}
    </HeavyPageGate>
  )
}
