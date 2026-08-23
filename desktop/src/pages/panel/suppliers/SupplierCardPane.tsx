/**
 * Карточка поставщика: реквизиты, сальдо и три вкладки.
 *
 * Вкладки грузятся ЛЕНИВО — каждая ходит за своими данными в момент, когда её
 * открыли, и не раньше. Три запроса на каждое переключение строки в списке
 * означали бы, что проход по списку стрелками бьёт по базе трижды на строку.
 */

import { useEffect, useState } from 'react'
import {
  fetchSupplierPayments,
  fetchSupplierProducts,
  fetchSupplierPurchases,
} from '../../../services/suppliers'
import type {
  PaymentRow,
  SupplierCard,
  SupplierProductRow,
  SupplyRow,
} from '../../../services/suppliers'
import { formatTiyin } from '../../../utils/money'

type Tab = 'supplies' | 'payments' | 'products'

const METHOD_LABELS: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  transfer: 'Перевод',
}

function day(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('ru-RU')
}

export function SupplierCardPane({
  card,
  onEdit,
  onPay,
  onArchive,
  onClose,
}: {
  card: SupplierCard
  onEdit: () => void
  onPay: () => void
  onArchive: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('supplies')
  const [supplies, setSupplies] = useState<SupplyRow[] | null>(null)
  const [payments, setPayments] = useState<PaymentRow[] | null>(null)
  const [products, setProducts] = useState<SupplierProductRow[] | null>(null)

  /* Смена поставщика сбрасывает загруженное: иначе на карточке нового
     поставщика секунду висели бы чужие поставки. */
  useEffect(() => {
    setSupplies(null)
    setPayments(null)
    setProducts(null)
    setTab('supplies')
  }, [card.id])

  useEffect(() => {
    const controller = new AbortController()
    if (tab === 'supplies' && supplies === null) {
      fetchSupplierPurchases(card.id, controller.signal).then(setSupplies).catch(() => setSupplies([]))
    }
    if (tab === 'payments' && payments === null) {
      fetchSupplierPayments(card.id, controller.signal).then(setPayments).catch(() => setPayments([]))
    }
    if (tab === 'products' && products === null) {
      fetchSupplierProducts(card.id, controller.signal).then(setProducts).catch(() => setProducts([]))
    }
    return () => controller.abort()
  }, [tab, card.id, supplies, payments, products])

  return (
    <div className="dsk__card psu__card">
      <div className="dsk__bar">
        <strong className="dsk__card-title">{card.name}</strong>
        <span className="dsk__spacer" />
        <button type="button" className="dsk__btn" onClick={onEdit}>
          Изменить
        </button>
        {/*
          Кнопка видна всем намеренно. Скрывать её значило бы делать вид, что
          оплаты не существует; пропускает или не пропускает — сервер, и отказ
          придёт оттуда.
        */}
        <button type="button" className="dsk__btn dsk__btn--primary" onClick={onPay}>
          Внести оплату
        </button>
        <button type="button" className="dsk__btn" onClick={onClose} aria-label="Закрыть карточку">
          ✕
        </button>
      </div>

      <div className="psu__requisites">
        {card.contactPerson && <span>{card.contactPerson}</span>}
        {card.phone && <span>{card.phone}</span>}
        {card.address && <span className="dsk__ellipsis">{card.address}</span>}
        {card.comment && <span className="dsk__muted dsk__ellipsis">{card.comment}</span>}
      </div>

      {/* Сальдо расчётов — главное число карточки. */}
      <div className="dsk__stats">
        <div className="dsk__stat">
          <span className="dsk__stat-label">Должны сейчас</span>
          <strong
            className={`dsk__stat-value${card.debtTiyin > 0 ? ' dsk__stat-value--warn' : ''}`}
          >
            {formatTiyin(card.debtTiyin)}
            <i className="dsk__stat-unit">сом</i>
          </strong>
        </div>
        <div className="dsk__stat">
          <span className="dsk__stat-label">Закупок</span>
          <strong className="dsk__stat-value">{card.purchasesCount}</strong>
        </div>
        <div className="dsk__stat">
          <span className="dsk__stat-label">На сумму</span>
          <strong className="dsk__stat-value">
            {formatTiyin(card.purchasesTiyin)}
            <i className="dsk__stat-unit">сом</i>
          </strong>
        </div>
        <div className="dsk__stat">
          <span className="dsk__stat-label">Оплачено</span>
          <strong className="dsk__stat-value">
            {formatTiyin(card.paidTiyin)}
            <i className="dsk__stat-unit">сом</i>
          </strong>
        </div>
      </div>

      <div className="dsk__tabs" role="tablist">
        <Tab id="supplies" tab={tab} setTab={setTab} label="Поставки" />
        <Tab id="payments" tab={tab} setTab={setTab} label="Оплаты" />
        <Tab id="products" tab={tab} setTab={setTab} label="Товары" />
      </div>

      <div className="psu__tabbody">
        {tab === 'supplies' && (
          <TabTable
            head={['№', 'Дата', 'Позиций', 'Сумма', 'Состояние']}
            rowClass="psu__supply-row"
            loading={supplies === null}
            empty={{
              title: 'Поставок не было',
              hint: 'Проведённые накладные от этого поставщика появятся здесь.',
            }}
            rows={supplies?.map((row) => (
              <div
                className={`dsk__row psu__supply-row${row.overdue ? ' dsk__row--alert' : ''}`}
                key={row.id}
                role="row"
              >
                <span className="dsk__num">{row.number}</span>
                <span className="dsk__muted">{day(row.docDate)}</span>
                <span className="dsk__num">{row.positionsCount}</span>
                <span className="dsk__num">{formatTiyin(row.totalTiyin)}</span>
                <span>
                  <i className={`dsk__tag dsk__tag--${row.status}`}>
                    {row.status === 'posted' ? 'проведён' : row.status === 'draft' ? 'черновик' : 'отменён'}
                  </i>
                  {row.settlement === 'credit' && (
                    <i className="dsk__tag dsk__tag--credit">{row.overdue ? 'просрочен' : 'долг'}</i>
                  )}
                </span>
              </div>
            ))}
          />
        )}

        {tab === 'payments' && (
          <TabTable
            head={['Дата', 'Способ', 'Комментарий', 'Сумма', 'Остаток долга']}
            rowClass="psu__payment-row"
            loading={payments === null}
            empty={{
              title: 'Оплат не было',
              hint: 'История платежей появится здесь после первой оплаты.',
            }}
            rows={payments?.map((row) => (
              <div className="dsk__row psu__payment-row" key={row.id} role="row">
                <span className="dsk__muted">{day(row.paidAt)}</span>
                <span>{METHOD_LABELS[row.method] ?? row.method}</span>
                <span className="dsk__ellipsis dsk__muted">{row.comment || '—'}</span>
                <span className="dsk__num dsk__good">{formatTiyin(row.amountTiyin)}</span>
                <span className="dsk__num">{formatTiyin(row.balanceAfterTiyin)}</span>
              </div>
            ))}
          />
        )}

        {tab === 'products' && (
          <TabTable
            head={['Товар', 'Последняя цена', 'Изменение', 'Поставок', 'Последняя']}
            rowClass="psu__product-row"
            loading={products === null}
            empty={{
              title: 'Товаров нет',
              hint: 'Здесь появятся товары из проведённых накладных этого поставщика.',
            }}
            rows={products?.map((row) => (
              <div className="dsk__row psu__product-row" key={row.productId} role="row">
                <span className="dsk__ellipsis">{row.name}</span>
                <span className="dsk__num">{formatTiyin(row.lastCostTiyin)}</span>
                <span className="dsk__num">
                  {row.changePercent == null ? (
                    <span className="dsk__muted">—</span>
                  ) : (
                    /* Цвет здесь — значение: подорожало плохо, подешевело
                       хорошо. Ровно ноль остаётся нейтральным. */
                    <span
                      className={
                        row.changePercent > 0
                          ? 'dsk__bad'
                          : row.changePercent < 0
                            ? 'dsk__good'
                            : 'dsk__muted'
                      }
                    >
                      {row.changePercent > 0 ? '+' : ''}
                      {row.changePercent}%
                    </span>
                  )}
                </span>
                <span className="dsk__num">{row.deliveries}</span>
                <span className="dsk__muted">{day(row.lastDate)}</span>
              </div>
            ))}
          />
        )}
      </div>

      <div className="dsk__bar">
        <span className="dsk__spacer" />
        <button type="button" className="dsk__btn dsk__btn--danger" onClick={onArchive}>
          Убрать из списка
        </button>
      </div>
    </div>
  )
}

function Tab({
  id,
  tab,
  setTab,
  label,
}: {
  id: Tab
  tab: Tab
  setTab: (next: Tab) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={`dsk__tab${tab === id ? ' dsk__tab--on' : ''}`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  )
}

function TabTable({
  head,
  rowClass,
  rows,
  loading,
  empty,
}: {
  head: string[]
  rowClass: string
  rows: React.ReactNode[] | undefined
  loading: boolean
  empty: { title: string; hint: string }
}) {
  return (
    <div className="dsk__table">
      <div className={`dsk__head ${rowClass}`} role="row">
        {head.map((title, index) => (
          <span key={title} className={index >= 1 && index <= 3 ? 'dsk__num' : undefined}>
            {title}
          </span>
        ))}
      </div>
      <div className="dsk__scroll" role="grid">
        {loading ? (
          <div aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => (
              <div className={`dsk__row ${rowClass}`} key={index}>
                {head.map((_, cell) => (
                  <span className="dsk__skeleton" style={{ width: '70%' }} key={cell} />
                ))}
              </div>
            ))}
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="dsk__empty">
            <strong>{empty.title}</strong>
            <span>{empty.hint}</span>
          </div>
        ) : (
          rows
        )}
      </div>
    </div>
  )
}
