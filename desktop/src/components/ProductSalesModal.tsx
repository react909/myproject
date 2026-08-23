import { useEffect, useState } from 'react'
import { formatMoney } from '../catalog/mockProducts'
import { usePanelProductFilter } from '../pages/panel/PanelProductFilterContext'
import {
  fetchProductSaleLines,
  reportPeriodRange,
  type ProductReportPeriod,
  type ProductSaleLine,
} from '../services/productReport'
import '../pages/PanelProductReportPage.css'

type ProductSalesModalProps = {
  productName: string
  initialPeriod?: ProductReportPeriod
  onClose: () => void
}

export function ProductSalesModal({
  productName,
  initialPeriod = 'month',
  onClose,
}: ProductSalesModalProps) {
  const { productKind } = usePanelProductFilter()
  const [period, setPeriod] = useState<ProductReportPeriod>(initialPeriod)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [lines, setLines] = useState<ProductSaleLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const range = reportPeriodRange(period, from, to)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetchProductSaleLines(productName, range.from, range.to, productKind)
      .then((next) => {
        if (!cancelled) setLines(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Не удалось загрузить продажи')
          setLines([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [productName, range.from, range.to, productKind])

  const totals = lines.reduce(
    (acc, { item }) => {
      acc.qty += item.quantity
      acc.revenue += item.total
      return acc
    },
    { qty: 0, revenue: 0 },
  )

  const cashiers = [...new Set(lines.map((l) => l.receipt.cashier).filter(Boolean))]

  return (
    <div className="prp-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="prp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-sales-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="prp-modal__head">
          <div>
            <h3 id="product-sales-title" className="prp-modal__title">{productName}</h3>
            <p className="prp-modal__sub">
              Период: {range.from} — {range.to} · Продано: {totals.qty.toFixed(3)} · Выручка:{' '}
              {formatMoney(totals.revenue)} сом
            </p>
            {cashiers.length > 0 && (
              <p className="prp-modal__sub">Кассиры: {cashiers.join(', ')}</p>
            )}
          </div>
          <button type="button" className="prp-modal__close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>

        <div className="prp-modal__filters">
          {(['today', '7days', 'month', 'year'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={period === p ? 'is-on' : ''}
              onClick={() => setPeriod(p)}
            >
              {p === 'today' ? 'Сегодня' : p === '7days' ? '7 дней' : p === 'month' ? 'Месяц' : 'Год'}
            </button>
          ))}
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setPeriod('custom')
            }}
          />
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value)
              setPeriod('custom')
            }}
          />
        </div>

        {loading && <p className="prp__state">Загрузка продаж…</p>}
        {error && <p className="prp__error">{error}</p>}

        {!loading && !error && (
          <div className="prp-modal__table-wrap">
            <table className="prp-modal__table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Время</th>
                  <th>Кассир</th>
                  <th>Чек</th>
                  <th>Оплата</th>
                  <th>Кол-во</th>
                  <th>Цена</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={8}>Нет продаж за выбранный период</td>
                  </tr>
                ) : (
                  lines.map(({ receipt, item }) => (
                    <tr key={`${receipt.id}-${item.name}-${receipt.time}-${item.quantity}`}>
                      <td>{receipt.date}</td>
                      <td>{receipt.time}</td>
                      <td>{receipt.cashier}</td>
                      <td>{receipt.number}</td>
                      <td>{receipt.paymentMethod}</td>
                      <td>{item.isWeight ? `${item.quantity.toFixed(3)} кг` : `${item.quantity} шт`}</td>
                      <td>{formatMoney(item.price)}</td>
                      <td>{formatMoney(item.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
