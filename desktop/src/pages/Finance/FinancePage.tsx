import { useCallback, useEffect, useState } from 'react'
import { getCurrentAccountKey } from '../../services/accountSession'
import { usePanelProductFilter } from '../panel/PanelProductFilterContext'
import { useProductReportModal } from '../../context/ProductReportModalProvider'
import { usePanelAsyncLoad } from '../../hooks/usePanelAsyncLoad'
import { HeavyPageGate } from '../HeavyPageGate'
import { fetchCrmFinance } from '../../services/crmReports'
import { FinanceHeader } from './components/FinanceHeader'
import { FinanceMetrics } from './components/FinanceMetrics'
import { RevenueChart } from './components/RevenueChart'
import { PaymentBreakdown } from './components/PaymentBreakdown'
import { TopProducts } from './components/TopProducts'
import { RecentSales } from './components/RecentSales'
import { FinancialSummary } from './components/FinancialSummary'
import { ExpensesBlock } from './components/ExpensesBlock'
import { useOnboarding } from '../../onboarding/useOnboarding'
import { LoadingScreen } from '../LoadingScreen'
import { PanelFetchOverlay } from '../PanelFetchOverlay'
import './FinancePage.css'

export type FinanceData = {
  revenue: number
  cost: number
  profit: number
  margin: number
  orders: number
  avgCheck: number
  revenueChange: string
  revenuePositive: boolean
  metrics: Metric[]
  chartData: ChartPoint[]
  chartPrevData: ChartPoint[]
  payments: Payment[]
  products: Product[]
  sales: Sale[]
  hourlyData: ChartPoint[]
}

export type Metric = {
  id: string
  label: string
  value: string
  rawValue: number
  change: string
  changePositive: boolean
  color: 'blue' | 'green' | 'purple' | 'yellow' | 'red' | 'orange'
  icon: 'revenue' | 'orders' | 'check' | 'profit' | 'cost' | 'margin'
  sparkline: number[]
}

export type ChartPoint = { label: string; value: number }
export type Payment = { type: string; amount: number; percent: number; color: string; icon: string }
export type ProductKind = 'weight' | 'piece'
export type Product = {
  name: string
  sold: number
  revenue: number
  cost: number
  trend: number
  kind: ProductKind
}
export type Sale = { id: string; time: string; amount: number; method: 'card' | 'cash' | 'mixed' | 'debt'; items: number }

export type FinancePageProps = { embedded?: boolean; active?: boolean }

export function FinancePage({ embedded = false, active = true }: FinancePageProps) {
  const { productKind } = usePanelProductFilter()
  const { openProductReport } = useProductReportModal()
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('month')
  const reportPeriod = period === 'day' ? 'today' : period === 'week' ? '7days' : 'month'
  const [chartMode, setChartMode] = useState<'week' | 'hour'>('week')
  // Режим аналитики решает, какая цифра главная. Данные при этом одни и те же:
  // продажи и расходы считаются одинаково, меняется только подача.
  const analyticsMode = useOnboarding({ refresh: false }).business.analyticsMode
  const expensePeriod = period === 'day' ? 'today' : period === 'week' ? 'week' : 'month'

  const { data, isLoading, isRefreshing, hasData, reload } = usePanelAsyncLoad<FinanceData>(
    (signal) => fetchCrmFinance(period, productKind, signal),
    [period, productKind],
    active,
    `panel:finance:${getCurrentAccountKey()}:${period}:${productKind}`,
  )

  useEffect(() => {
    const onInvalidate = () => {
      if (active) reload()
    }
    window.addEventListener('nurcrm-data-invalidated', onInvalidate)
    return () => window.removeEventListener('nurcrm-data-invalidated', onInvalidate)
  }, [active, reload])

  const handleExport = useCallback(() => {
    if (!data) return
    const rows = [
      ['Раздел', 'Показатель', 'Значение', 'Дополнительно'],
      ...data.metrics.map((m) => ['Метрики', m.label, m.value, '']),
      ...data.payments.map((p) => ['Разбивка оплат', p.type, String(p.amount), `${Math.round(p.percent)}%`]),
      ...data.products.map((p) => ['Товары', p.name, String(p.revenue), `Продано: ${p.sold}; Себестоимость: ${p.cost}`]),
      ...data.sales.map((s) => ['Продажи', s.id, String(s.amount), `${s.time}; ${s.method}; позиций: ${s.items}`]),
      ...data.chartData.map((p) => ['Динамика', p.label, String(p.value), '']),
    ]
    const csv = rows.map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `finance-${period}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [data, period])

  if (!hasData && isLoading) {
    return (
      <LoadingScreen
        title="Загрузка финансов..."
        subtitle="Собираем выручку, оплаты, товары и последние продажи из CRM"
      />
    )
  }

  if (!data) {
    return (
      <LoadingScreen
        title="Загрузка финансов..."
        subtitle="Собираем выручку, оплаты, товары и последние продажи из CRM"
      />
    )
  }

  const inner = (
    <div className={`fp panel-fetch-shell${embedded ? ' fp--embedded' : ''}`}>
      {isRefreshing && hasData ? <PanelFetchOverlay label="Обновление финансов…" /> : null}

      <FinanceHeader
        period={period}
        onPeriodChange={setPeriod}
        onRefresh={reload}
        onExport={handleExport}
        isRefreshing={isRefreshing}
        embedded={embedded}
        revenue={data.revenue}
        profit={data.profit}
        analyticsMode={analyticsMode}
        revenueChange={data.revenueChange}
        revenuePositive={data.revenuePositive}
      />

      <div className="fp__body">
        <FinanceMetrics metrics={data.metrics} />

        {/* Расходы стоят высоко в обоих режимах: в «прибыли» из них считается
            главная цифра, в «продажах» они и есть тот самый отдельный блок,
            который на выручку не влияет. */}
        <ExpensesBlock period={expensePeriod} analyticsMode={analyticsMode} />

        <div className="fp__row">
          {active ? (
            <RevenueChart
              data={chartMode === 'week' ? data.chartData : data.hourlyData}
              prevData={chartMode === 'week' ? data.chartPrevData : undefined}
              mode={chartMode}
              onModeChange={setChartMode}
            />
          ) : null}
          <PaymentBreakdown payments={data.payments} />
        </div>

        <div className="fp__row fp__row--3">
          <TopProducts
            products={data.products}
            externalKind={productKind !== 'all' ? productKind : undefined}
            onProductClick={(name) => openProductReport(name, reportPeriod)}
          />
          <RecentSales sales={data.sales} />
          <FinancialSummary
            revenue={data.revenue}
            cost={data.cost}
            profit={data.profit}
            margin={data.margin}
            orders={data.orders}
            avgCheck={data.avgCheck}
          />
        </div>
      </div>
    </div>
  )

  if (embedded) return inner

  return (
    <HeavyPageGate
      loadingTitle="Загрузка финансов..."
      loadingSubtitle="Подготовка метрик и аналитики"
    >
      {inner}
    </HeavyPageGate>
  )
}
