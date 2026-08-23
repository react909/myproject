/**
 * Журнал чеков панели.
 *
 * Написан заново вместе с панелью. Что изменилось по сути, а не по виду:
 *
 * • Фильтры уехали на сервер целиком. Прежний журнал тянул триста последних
 *   чеков и фильтровал их в браузере — чек полугодовой давности найти было
 *   нельзя ни одним фильтром, его просто не было среди загруженных.
 *
 * • Показатели считает сервер одним агрегатом по тем же фильтрам, что и
 *   таблица. Раньше их складывал фронт по загруженному массиву, и цифры
 *   относились не к фильтру, а к тому, что успело приехать.
 *
 * • Список догружается порциями по курсору и виртуализирован: в разметке живут
 *   только видимые строки.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useVirtualRows } from '../../hooks/useVirtualRows'
import { useNotifications } from '../../components/notifications/NotificationProvider'
import { ReceiptDetailsModal } from '../Receipts/components/ReceiptDetailsModal'
import { RefundModal } from '../Receipts/components/RefundModal'
import { printDuplicateReceipt } from '../../services/receiptPrint'
import { refundReceipt } from '../../services/receipts'
import {
  exportPanelReceipts,
  fetchPanelCashiers,
  fetchPanelReceiptDetails,
  fetchPanelReceipts,
  fetchPanelSummary,
  toLegacyReceipt,
} from '../../services/panelReceipts'
import type {
  PanelReceiptRow,
  PanelReceiptsQuery,
  PanelReceiptsSummary,
} from '../../services/panelReceipts'
import type { Receipt as LegacyReceipt, RefundLineSelection } from '../Receipts/types'
import './PanelJournal.css'

/** Высота строки таблицы. Обязана совпадать с --pj-row в PanelJournal.css. */
const ROW_HEIGHT = 38

/** Размер порции. Столько же стоит потолком у сервера по умолчанию. */
const PAGE_SIZE = 50

const STATUS_LABELS: Record<string, string> = {
  paid: 'Оплачен',
  debt: 'Долг',
  canceled: 'Отменён',
  refunded: 'Возврат',
  partial_refund: 'Частичный возврат',
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  mixed: 'Смешанная',
  debt: 'В долг',
}

const money = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatMoment(value: Date): string {
  if (Number.isNaN(value.getTime())) return '—'
  return `${value.toLocaleDateString('ru-RU')} ${value.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

/**
 * Журнал не принимает фильтр вида товара.
 *
 * Он висел справа отдельной колонкой на всех разделах панели, включая этот, и
 * здесь не значил ничего: чеки не делятся на весовые и штучные — делятся
 * товары. Фильтр переехал внутрь отчёта товаров, которому и принадлежит.
 */
export function PanelJournal() {
  // Уведомления нужны и выгрузке, и возврату — берём один раз наверху, чтобы
  // обработчики ниже не оказались объявлены раньше того, чем пользуются.
  const { push } = useNotifications()
  const [filters, setFilters] = useState<PanelReceiptsQuery>({})
  const [rows, setRows] = useState<PanelReceiptRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [summary, setSummary] = useState<PanelReceiptsSummary | null>(null)
  const [cashiers, setCashiers] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [appending, setAppending] = useState(false)
  const [error, setError] = useState('')

  /*
    Запрос собирается один на список, показатели и выгрузку.

    В useMemo, чтобы эффект ниже перезапускался на смену значений, а не на
    каждую отрисовку.
  */
  const query = useMemo<PanelReceiptsQuery>(() => ({ ...filters }), [filters])

  /** Первая страница и показатели — на каждую смену фильтров. */
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')

    /*
      Два запроса параллельно, а не последовательно.

      Список и показатели друг от друга не зависят, и ждать один ради другого
      незачем: на большой базе сводка считается дольше списка, и
      последовательный запуск сложил бы эти времена.
    */
    Promise.all([
      fetchPanelReceipts(query, { limit: PAGE_SIZE, signal: controller.signal }),
      fetchPanelSummary(query, controller.signal),
    ])
      .then(([page, totals]) => {
        if (controller.signal.aborted) return
        setRows(page.rows)
        setCursor(page.nextCursor)
        setSummary(totals)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'Не удалось загрузить журнал.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [query])

  /* Кассиры — один раз: список меняется не чаще, чем нанимают людей. */
  useEffect(() => {
    const controller = new AbortController()
    void fetchPanelCashiers(controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setCashiers(list)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  /** Догрузка следующей порции при подходе к концу списка. */
  const appendingRef = useRef(false)
  const loadMore = useCallback(() => {
    if (!cursor || appendingRef.current) return
    appendingRef.current = true
    setAppending(true)
    void fetchPanelReceipts(query, { cursor, limit: PAGE_SIZE })
      .then((page) => {
        setRows((previous) => [...previous, ...page.rows])
        setCursor(page.nextCursor)
      })
      .catch(() => {
        /* Не догрузилось — оставляем что есть; повторит следующая прокрутка. */
      })
      .finally(() => {
        appendingRef.current = false
        setAppending(false)
      })
  }, [cursor, query])

  const { scrollRef, window: view } = useVirtualRows(rows.length, ROW_HEIGHT)

  /*
    Догружаем, когда до конца осталось меньше страницы.

    По окну виртуализации, а не по событию прокрутки: окно уже посчитано, и
    второй слушатель на том же контейнере был бы лишней работой на каждый кадр.
  */
  useEffect(() => {
    if (view.end >= rows.length - PAGE_SIZE / 2 && rows.length > 0) loadMore()
  }, [view.end, rows.length, loadMore])

  const patch = useCallback((change: Partial<PanelReceiptsQuery>) => {
    setFilters((previous) => ({ ...previous, ...change }))
  }, [])

  /*
    Выгрузка. Собирает файл сервер по тем же фильтрам, что и таблица.

    Кнопка блокируется на время выгрузки — не ради «занятости», а чтобы второй
    щелчок не запустил второй такой же поток: на годовом журнале это лишние
    десятки тысяч строк из базы, за которыми в очереди стоит касса.
  */
  const [exporting, setExporting] = useState(false)
  const runExport = useCallback(() => {
    if (exporting) return
    setExporting(true)
    void exportPanelReceipts(query)
      .then(({ fileName, bytes }) => {
        push({
          kind: 'success',
          title: 'Экспорт',
          message: `${fileName} — ${(bytes / 1024).toFixed(0)} КБ. Открывается в Excel.`,
        })
      })
      .catch((caught: unknown) => {
        push({
          kind: 'error',
          title: 'Экспорт',
          message: caught instanceof Error ? caught.message : 'Не удалось выгрузить журнал.',
        })
      })
      .finally(() => setExporting(false))
  }, [exporting, query, push])

  /*
    Карточка чека, возврат и печать дубликата.

    Окна взяты те же, что были у прежнего журнала: они общие с кассой и умеют
    печатать и возвращать. Переписывать их под новый тип строки значило бы
    переписать заодно печать и возврат — работающие вещи, к скорости журнала
    отношения не имеющие. Переходник один, в services/panelReceipts.

    Позиции чека приезжают только здесь: в списке их нет, и на странице в
    полсотни чеков это сотни лишних строк в каждом ответе.
  */
  const [opened, setOpened] = useState<LegacyReceipt | null>(null)
  const [refunding, setRefunding] = useState<LegacyReceipt | null>(null)

  const openReceipt = useCallback(
    (id: number) => {
      void fetchPanelReceiptDetails(id)
        .then((details) => setOpened(toLegacyReceipt(details)))
        .catch(() => push({ kind: 'error', title: 'Чек', message: 'Не удалось открыть чек.' }))
    },
    [push],
  )

  const applyRefund = useCallback(
    (receipt: LegacyReceipt, lines: RefundLineSelection[], reason: string) => {
      void refundReceipt(receipt, lines, reason)
        .then(() => {
          setRefunding(null)
          setOpened(null)
          push({ kind: 'success', title: 'Возврат', message: `Чек №${receipt.number} — возврат оформлен.` })
          // Перечитываем страницу и показатели: у чека сменился статус, а
          // сумма возвратов над таблицей обязана сойтись с ним сразу.
          setFilters((previous) => ({ ...previous }))
        })
        .catch((caught: unknown) => {
          push({
            kind: 'error',
            title: 'Возврат',
            message: caught instanceof Error ? caught.message : 'Не удалось оформить возврат.',
          })
        })
    },
    [push],
  )

  const visible = rows.slice(view.start, view.end)

  return (
    <section className="pj">
      {/* ── Фильтры ── */}
      <div className="pj__filters">
        <input
          className="pj__field pj__field--num"
          placeholder="№ документа"
          inputMode="numeric"
          value={filters.docNumber ?? ''}
          onChange={(event) => patch({ docNumber: event.target.value })}
        />
        <input
          className="pj__field"
          placeholder="Клиент или телефон"
          value={filters.client ?? ''}
          onChange={(event) => patch({ client: event.target.value })}
        />
        <input
          className="pj__field"
          placeholder="Товар в чеке"
          value={filters.product ?? ''}
          onChange={(event) => patch({ product: event.target.value })}
        />
        <input
          className="pj__field pj__field--date"
          type="date"
          aria-label="Дата с"
          value={filters.dateFrom ?? ''}
          onChange={(event) => patch({ dateFrom: event.target.value })}
        />
        <input
          className="pj__field pj__field--date"
          type="date"
          aria-label="Дата по"
          value={filters.dateTo ?? ''}
          onChange={(event) => patch({ dateTo: event.target.value })}
        />
        <select
          className="pj__field pj__field--select"
          aria-label="Кассир"
          value={filters.cashier ?? ''}
          onChange={(event) => patch({ cashier: event.target.value })}
        >
          <option value="">Все кассиры</option>
          {cashiers.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select
          className="pj__field pj__field--select"
          aria-label="Статус"
          value={filters.status ?? ''}
          onChange={(event) => patch({ status: event.target.value as PanelReceiptsQuery['status'] })}
        >
          <option value="">Все статусы</option>
          {Object.entries(STATUS_LABELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <select
          className="pj__field pj__field--select"
          aria-label="Оплата"
          value={filters.paymentMethod ?? ''}
          onChange={(event) =>
            patch({ paymentMethod: event.target.value as PanelReceiptsQuery['paymentMethod'] })
          }
        >
          <option value="">Любая оплата</option>
          {Object.entries(PAYMENT_LABELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        {/* «Сброс» и «Экспорт» — в конце ряда, вместе: оба действуют на весь
            набор фильтров, а не на отдельное поле. */}
        <div className="pj__filters-actions">
          <button type="button" className="pj__reset" onClick={() => setFilters({})}>
            Сброс
          </button>
          <button
            type="button"
            className="pj__export"
            onClick={runExport}
            disabled={exporting}
            title="Выгрузить журнал по текущим фильтрам"
          >
            {exporting ? 'Выгрузка…' : 'Экспорт'}
          </button>
        </div>
      </div>

      {/*
        Показатели — одна плотная полоса, а не четыре карточки.

        Цветных полос сверху здесь нет намеренно: приём стоит в каждом втором
        сгенерированном интерфейсе, и система должна выглядеть своей. Ячейки
        разделены тонкими линиями, рамок, теней и скруглений у каждой нет.

        Цвет — на одном числе и только там, где несёт смысл: сумма возвратов
        красная, когда возвраты были, и обычная, когда их ноль. Красный ноль
        сообщал бы о беде, которой не случилось.

        Скелетоны той же высоты, что цифры: появление данных не должно сдвигать
        таблицу под полосой.
      */}
      <div className="pj__stats">
        <Stat label="Всего чеков" value={summary && String(summary.receiptsCount)} />
        <Stat label="Выручка" value={summary && money.format(summary.revenue)} unit="сом" />
        <Stat
          label="Возвраты"
          value={summary && money.format(summary.refunds)}
          unit="сом"
          alert={Boolean(summary && summary.refunds > 0)}
        />
        <Stat label="Средний чек" value={summary && money.format(summary.avgCheck)} unit="сом" />
      </div>

      {error && <p className="pj__error" role="alert">{error}</p>}

      {/* ── Таблица ── */}
      <div className="pj__table">
        <div className="pj__head" role="row">
          <span>№</span>
          <span>Дата и время</span>
          <span>Клиент</span>
          <span>Кассир</span>
          <span>Оплата</span>
          <span>Статус</span>
          <span className="pj__num">Сумма</span>
        </div>

        <div className="pj__scroll" ref={scrollRef}>
          {loading ? (
            <SkeletonRows />
          ) : rows.length === 0 ? (
            <div className="pj__empty">
              <strong>Чеков нет</strong>
              <span>По выбранным фильтрам ничего не найдено. Снимите часть условий.</span>
            </div>
          ) : (
            /* Распорка высотой во весь список держит полосу прокрутки на
               месте, хотя строк в разметке всего пара десятков. */
            <div className="pj__spacer" style={{ height: view.totalHeight }}>
              <div
                className="pj__rows"
                style={{ transform: `translateY(${view.offsetTop}px)` }}
              >
                {visible.map((row) => (
                  <div
                    className="pj__row"
                    role="row"
                    key={row.id}
                    tabIndex={0}
                    onClick={() => openReceipt(row.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openReceipt(row.id)
                      }
                    }}
                  >
                    <span className="pj__num">{row.docNumber}</span>
                    <span>{formatMoment(row.createdAt)}</span>
                    <span className="pj__ellipsis">{row.clientName || '—'}</span>
                    <span className="pj__ellipsis">{row.cashierName || '—'}</span>
                    <span>{PAYMENT_LABELS[row.paymentMethod] ?? row.paymentMethod}</span>
                    <span>
                      <i className={`pj__status pj__status--${row.status}`}>
                        {STATUS_LABELS[row.status] ?? row.status}
                      </i>
                    </span>
                    <span className="pj__num pj__total">{money.format(row.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {appending && <div className="pj__more">Загружаем ещё…</div>}
      </div>

      <AnimatePresence>
        {opened && (
          <ReceiptDetailsModal
            receipt={opened}
            onClose={() => setOpened(null)}
            onPrint={() => void printDuplicateReceipt(opened)}
            onRefund={() => setRefunding(opened)}
          />
        )}
      </AnimatePresence>

      {refunding && (
        <RefundModal
          receipt={refunding}
          onConfirm={(lines, reason) => applyRefund(refunding, lines, reason)}
          onCancel={() => setRefunding(null)}
        />
      )}
    </section>
  )
}

/**
 * Ячейка полосы показателей.
 *
 * Ни рамки, ни тени, ни цветной полосы — только подпись прописными и число под
 * ней. Единственный цвет — красный на сумме возвратов, и только когда возвраты
 * действительно были.
 */
function Stat({
  label,
  value,
  unit,
  alert = false,
}: {
  label: string
  /** `null` — данные ещё не пришли, показываем скелетон. */
  value: string | null
  unit?: string
  /** Число значимо и должно бросаться в глаза. Сейчас это только возвраты. */
  alert?: boolean
}) {
  return (
    <div className="pj__stat">
      <span className="pj__stat-label">{label}</span>
      {value === null ? (
        <span className="pj__stat-skeleton" aria-hidden="true" />
      ) : (
        <strong className={`pj__stat-value${alert ? ' pj__stat-value--alert' : ''}`}>
          {value}
          {unit && <i className="pj__stat-unit">{unit}</i>}
        </strong>
      )}
    </div>
  )
}

/** Скелетон таблицы: строки нужной высоты, чтобы содержимое не прыгало. */
function SkeletonRows() {
  return (
    <div className="pj__rows" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => (
        <div className="pj__row pj__row--skeleton" key={index}>
          <span /><span /><span /><span /><span /><span /><span />
        </div>
      ))}
    </div>
  )
}
