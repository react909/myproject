/**
 * Оплата: отчёт по подтверждённым вручную платежам.
 *
 * Способы оплаты настраиваются в «Реквизитах» вместе с остальным, что видит
 * покупатель. Здесь остаётся то, ради чего раздел вообще нужен владельцу, —
 * список продаж, где оплату подтвердил кассир, а не банк.
 *
 * Это не подозрение в адрес кассира, а свойство статического QR: сумму вводит
 * клиент, подтверждения из банка не приходит, и отличить скриншот чужого
 * платежа в момент продажи нельзя. Пока такие продажи не собраны в одном
 * месте, разговор о переходе на динамический QR не на чем строить.
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '../../api/client'
import { SettingsHelpFooter } from '../SettingsHelpFooter'
import './PaymentSection.css'

type ManualSale = {
  id: number
  doc_number: number
  created_at: string | null
  cashier_name: string
  total: number
  provider: string
  payment_ref: string
}

type CanceledAttempt = {
  created_at: string | null
  provider_id: string
  order_id: string
  amount: number
  event: 'canceled' | 'timeout'
}

type Report = {
  count: number
  total: number
  sales: ManualSale[]
  canceled_attempts: CanceledAttempt[]
}

const PERIODS = [
  { days: 7, label: 'Неделя' },
  { days: 30, label: 'Месяц' },
  { days: 90, label: 'Квартал' },
]

function formatMoney(value: number): string {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('ru-RU')
}

export function PaymentSection() {
  const [days, setDays] = useState(30)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (period: number) => {
    setLoading(true)
    setError('')
    try {
      const res = await apiGet(`/api/payments/manual-confirmations?days=${period}`)
      setReport(res?.data as Report)
    } catch {
      setError('Не удалось загрузить отчёт — проверьте, что локальный сервер запущен.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(days)
  }, [days, load])

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Оплата</h2>
      <p className="settings-section__desc">
        Способы оплаты, банки и QR настраиваются в разделе{' '}
        <Link to="/settings/requisites">Реквизиты</Link>. Здесь — контроль за платежами, которые касса
        не смогла подтвердить сама.
      </p>

      <div className="pay-report">
        <div className="pay-report__periods" role="group" aria-label="Период отчёта">
          {PERIODS.map((period) => (
            <button
              key={period.days}
              type="button"
              className={`pay-report__period${days === period.days ? ' is-active' : ''}`}
              onClick={() => setDays(period.days)}
            >
              {period.label}
            </button>
          ))}
        </div>

        {error && <p className="pay-report__error">{error}</p>}
        {loading && <p className="pay-report__muted">Загрузка…</p>}

        {report && !loading && (
          <>
            <div className="pay-report__summary">
              <div>
                <span>Подтверждено вручную</span>
                <strong>{report.count}</strong>
              </div>
              <div>
                <span>На сумму</span>
                <strong>{formatMoney(report.total)} сом</strong>
              </div>
              <div>
                <span>Отменённых попыток</span>
                <strong>{report.canceled_attempts.length}</strong>
              </div>
            </div>

            {report.count === 0 ? (
              <p className="pay-report__ok">
                За период таких продаж нет — все безналичные платежи подтвердил банк.
              </p>
            ) : (
              <div className="pay-report__table-wrap">
                <table className="pay-report__table">
                  <thead>
                    <tr>
                      <th>Чек</th>
                      <th>Когда</th>
                      <th>Кассир</th>
                      <th>Способ</th>
                      <th className="is-num">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sales.map((sale) => (
                      <tr key={sale.id}>
                        <td>№ {sale.doc_number}</td>
                        <td>{formatDate(sale.created_at)}</td>
                        <td>{sale.cashier_name || '—'}</td>
                        <td>{sale.provider || 'Статический QR'}</td>
                        <td className="is-num">{formatMoney(sale.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {report.canceled_attempts.length > 0 && (
              <details className="pay-report__attempts">
                <summary>Отменённые и просроченные попытки оплаты</summary>
                <ul>
                  {report.canceled_attempts.map((attempt, index) => (
                    <li key={`${attempt.order_id}-${index}`}>
                      <span>{formatDate(attempt.created_at)}</span>
                      <span>{attempt.order_id}</span>
                      <span>{formatMoney(attempt.amount)} сом</span>
                      <span>{attempt.event === 'timeout' ? 'истекло время' : 'отменено кассиром'}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>

      <SettingsHelpFooter>
        <p>
          Статический QR — это картинка: сумму вводит клиент, а банк о платеже кассе не сообщает.
          Кассир вынужден верить экрану чужого телефона, и подделанный скриншот в этот момент не
          отличить. Динамический QR снимает и то и другое: сумма вшита в код, а подтверждение
          приходит от банка автоматически. Подключается в «Реквизитах».
        </p>
      </SettingsHelpFooter>
    </section>
  )
}
