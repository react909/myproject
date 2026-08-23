import { getCurrentAccountKey } from '../services/accountSession'
import { useMemo, useState } from 'react'
import { formatAmount, formatMoney } from '../catalog/mockProducts'
import { usePanelAsyncLoad } from '../hooks/usePanelAsyncLoad'
import { usePanelProductFilter } from './panel/PanelProductFilterContext'
import { useProductReportModal } from '../context/ProductReportModalProvider'
import {
  loadProductReport,
  reportPeriodRange,
  type ProductReportPeriod,
  type ProductReportRow,
} from '../services/productReport'
import { LoadingScreen } from './LoadingScreen'
import { PanelFetchOverlay } from './PanelFetchOverlay'
import './PanelProductReportPage.css'

type PeriodKey = ProductReportPeriod

function downloadCsv(rows: ProductReportRow[]) {
  const header = ['Товар', 'Тип', 'Продано', 'Возврат', 'Выручка', 'Сумма возврата', 'Себестоимость', 'Прибыль', 'Остаток', 'Кассиры']
  const body = rows.map((r) => [
    r.name,
    r.kind === 'weight' ? 'Весовой' : 'Штучный',
    String(r.sold),
    String(r.returned),
    String(r.revenue),
    String(r.refundAmount),
    String(r.cost),
    String(r.profit),
    r.stock == null ? '' : String(r.stock),
    Array.from(r.cashiers).join(', '),
  ])
  const csv = [header, ...body]
    .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    .join('\n')
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `products-report-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** Виды товара для фильтра страницы. Тот же набор, что был в боковой колонке. */
const KIND_OPTIONS = [
  { id: 'all', label: 'Все товары' },
  { id: 'weight', label: 'Весовые' },
  { id: 'piece', label: 'Штучные' },
] as const

type ProductReportProps = {
  active?: boolean
  /** Текущий вид товара. Приходит сверху: значение общее для панели. */
  productKind?: 'all' | 'weight' | 'piece'
  /** Смена вида. Не задана — переключатель не рисуется. */
  onProductKind?: (kind: 'all' | 'weight' | 'piece') => void
}

export function PanelProductReportPage({
  active = true,
  productKind: productKindProp,
  onProductKind,
}: ProductReportProps) {
  const { productKind: productKindContext } = usePanelProductFilter()
  const productKind = productKindProp ?? productKindContext
  const { openProductReport } = useProductReportModal()
  const [period, setPeriod] = useState<PeriodKey>('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [query, setQuery] = useState('')

  const range = reportPeriodRange(period, from, to)

  const { data, isLoading, isRefreshing, error, hasData } = usePanelAsyncLoad(
    (signal) => loadProductReport(period, productKind, from, to, signal),
    [period, productKind, from, to],
    active,
    `panel:product-report:${getCurrentAccountKey()}:${period}:${productKind}:${from}:${to}`,
  )

  const rows = useMemo(() => {
    const base = data?.rows ?? []
    const needle = query.trim().toLowerCase()
    if (!needle) return base
    return base.filter((r) => r.name.toLowerCase().includes(needle))
  }, [data?.rows, query])

  const totals = useMemo(() => ({
    revenue: rows.reduce((sum, r) => sum + r.revenue, 0),
    sold: rows.reduce((sum, r) => sum + r.sold, 0),
    returned: rows.reduce((sum, r) => sum + r.returned, 0),
    refunds: rows.reduce((sum, r) => sum + r.refundAmount, 0),
  }), [rows])

  const { revenue: total, sold, returned, refunds } = totals
  const displayRange = data?.range ?? range

  if (!hasData && isLoading) {
    return (
      <LoadingScreen
        title="Загрузка отчёта товаров..."
        subtitle="Берём товары, остатки и продажи из CRM"
      />
    )
  }

  if (!hasData) {
    return (
      <LoadingScreen
        title="Загрузка отчёта товаров..."
        subtitle={error ?? 'Берём товары, остатки и продажи из CRM'}
      />
    )
  }

  return (
    <div className="prp panel-fetch-shell">
      {isRefreshing && hasData ? <PanelFetchOverlay label="Обновление отчёта…" /> : null}
      {/*
        Своего заголовка у страницы больше нет.

        Он был третьим подряд: название раздела уже стоит в шапке панели, и
        под ним шёл ещё один — «Отчёт по товарам» со своей подписью. Три
        страницы панели должны выглядеть одной системой, поэтому заголовок
        один на всех и живёт в оболочке (PanelPage), а страница начинается
        сразу с фильтров.
      */}
      <section className="prp__filters">
        {(['today', '7days', 'month', 'year'] as const).map((p) => (
          <button key={p} type="button" className={period === p ? 'is-on' : ''} onClick={() => setPeriod(p)}>
            {p === 'today' ? 'Сегодня' : p === '7days' ? '7 дней' : p === 'month' ? 'Месяц' : 'Год'}
          </button>
        ))}
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPeriod('custom') }} />
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPeriod('custom') }} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск товара" />

        {/*
          Вид товара — здесь, среди фильтров страницы, а не колонкой справа.

          Это фильтр отчёта по товарам и только его: чеки на весовые и штучные
          не делятся. Пока он висел отдельной колонкой, он показывался и на
          журнале чеков, где не значил ничего.
        */}
        <div className="prp__kind" role="radiogroup" aria-label="Тип товаров">
          {KIND_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={productKind === option.id}
              className={productKind === option.id ? 'is-on' : ''}
              onClick={() => onProductKind?.(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button className="prp__export" type="button" onClick={() => downloadCsv(rows)} disabled={rows.length === 0}>
          Экспорт
        </button>
      </section>

      <section className="prp__summary">
        <span>Период: {displayRange.from} - {displayRange.to}</span>
        <strong>Выручка: {formatMoney(total)} сом</strong>
        <strong>Продано: {formatAmount(sold)}</strong>
        <strong>Возврат: {formatAmount(returned)} / {formatMoney(refunds)} сом</strong>
      </section>

      {isRefreshing && <p className="prp__state">Обновление отчёта...</p>}
      {error && <p className="prp__error">{error}</p>}

      <div className="prp__table-wrap">
        <table className="prp__table">
          <thead>
            <tr>
              <th>Товар</th>
              <th>Тип</th>
              <th>Продано</th>
              <th>Возврат</th>
              <th>Выручка</th>
              <th>Сумма возврата</th>
              <th>Себестоимость</th>
              <th>Прибыль</th>
              <th>Остаток</th>
              <th>Кассиры</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.name}
                className="prp__row-click"
                onClick={() => openProductReport(r.name, period)}
              >
                <td>
                  <button type="button" className="prp__product-btn">
                    {r.name}
                  </button>
                </td>
                <td>{r.kind === 'weight' ? 'Весовой' : 'Штучный'}</td>
                <td>{formatAmount(r.sold)}</td>
                <td>{formatAmount(r.returned)}</td>
                <td>{formatMoney(r.revenue)} сом</td>
                <td>{formatMoney(r.refundAmount)} сом</td>
                <td>{formatMoney(r.cost)} сом</td>
                <td>{formatMoney(r.profit)} сом</td>
                <td>{r.stock == null ? '—' : `${formatAmount(r.stock)} ${r.kind === 'weight' ? 'кг' : 'шт'}`}</td>
                <td>{Array.from(r.cashiers).join(', ') || '—'}</td>
              </tr>
            ))}
            {!isRefreshing && rows.length === 0 && (
              <tr><td colSpan={10}>Нет продаж за выбранный период.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
