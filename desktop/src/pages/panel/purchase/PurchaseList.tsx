/**
 * Список документов закупки.
 *
 * Фильтры, сортировка и страницы — на сервере. Итоги над таблицей считаются
 * ТЕМ ЖЕ фильтром, что и список: пока их складывал фронт по загруженной
 * странице, сумма относилась не к фильтру, а к тому, что успело приехать, и
 * заметить это можно было только сложив столбец вручную.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { isAbortError } from '../../../api/errors'
import { useRowKeyboard } from '../../../hooks/useRowKeyboard'
import { fetchDocSummary, fetchDocs } from '../../../services/purchases'
import type { DocFilters, DocRow, DocStatus, DocSummary } from '../../../services/purchases'
import type { SupplierRow } from '../../../services/suppliers'
import { formatTiyin } from '../../../utils/money'

const ROW_HEIGHT = 30

const STATUS_LABELS: Record<DocStatus, string> = {
  draft: 'Черновик',
  posted: 'Проведён',
  canceled: 'Отменён',
}

function day(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('ru-RU')
}

type Props = {
  suppliers: SupplierRow[]
  /** Открыть документ. Список о том, что дальше, не знает. */
  onOpen: (id: number) => void
  onCreate: (kind: 'purchase' | 'return') => void
  /** Чтобы раздел мог перерисовать список после проведения. */
  reloadToken: number
  onSelectionChange?: (row: DocRow | null) => void
}

export function PurchaseList({
  suppliers,
  onOpen,
  onCreate,
  reloadToken,
  onSelectionChange,
}: Props) {
  const [filters, setFilters] = useState<DocFilters>({})
  const [rows, setRows] = useState<DocRow[]>([])
  const [summary, setSummary] = useState<DocSummary | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  /* Запрос собирается один на список и на итоги — разойтись им нечем. */
  const query = useMemo<DocFilters>(() => ({ ...filters }), [filters])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    /*
      Список и итоги — параллельно, а не последовательно.

      Друг от друга они не зависят, и ждать один ради другого незачем: на
      большой базе сводка считается дольше списка, и последовательный запуск
      сложил бы эти времена.
    */
    Promise.all([
      fetchDocs(query, { signal: controller.signal }),
      fetchDocSummary(query, controller.signal),
    ])
      .then(([page, totals]) => {
        setRows(page.items)
        setCursor(page.nextCursor)
        setSummary(totals)
      })
      .catch((err: any) => {
        if (isAbortError(err)) return
        setError(err?.response?.data?.detail ?? err?.message ?? 'Не удалось загрузить документы.')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [query, reloadToken])

  const loadMore = useCallback(() => {
    if (!cursor) return
    void fetchDocs(query, { cursor }).then((page) => {
      setRows((prev) => [...prev, ...page.items])
      setCursor(page.nextCursor)
    })
  }, [cursor, query])

  const keys = useRowKeyboard({
    count: rows.length,
    rowHeight: ROW_HEIGHT,
    rowClass: 'dsk__row ppu__list-row',
    selectedClass: 'dsk__row--on',
    onEnter: (index) => {
      const row = rows[index]
      if (row) onOpen(row.id)
    },
  })

  const selectedRow = keys.index >= 0 ? (rows[keys.index] ?? null) : null

  useEffect(() => {
    onSelectionChange?.(selectedRow)
  }, [selectedRow, onSelectionChange])

  const patch = (next: Partial<DocFilters>) => setFilters((prev) => ({ ...prev, ...next }))

  return (
    <>
      <div className="dsk__bar">
        <button type="button" className="dsk__btn dsk__btn--primary" onClick={() => onCreate('purchase')}>
          Новая закупка
        </button>
        {/* Подпись меняется по выбранной строке: возврат из выбранного прихода
            — самый частый путь, и о нём надо сказать до нажатия, а не после. */}
        <button
          type="button"
          className="dsk__btn"
          onClick={() => onCreate('return')}
          title={
            selectedRow?.status === 'posted' && selectedRow.kind === 'purchase'
              ? `Заполнить из прихода №${selectedRow.number}`
              : 'Выберите проведённый приход, чтобы заполнить возврат из него'
          }
        >
          {selectedRow?.status === 'posted' && selectedRow.kind === 'purchase'
            ? `Возврат из №${selectedRow.number}`
            : 'Возврат поставщику'}
        </button>

        <span className="ppu__divider" />

        <input
          type="date"
          className="dsk__field"
          aria-label="Дата с"
          value={filters.dateFrom ?? ''}
          onChange={(event) => patch({ dateFrom: event.target.value || undefined })}
        />
        <input
          type="date"
          className="dsk__field"
          aria-label="Дата по"
          value={filters.dateTo ?? ''}
          onChange={(event) => patch({ dateTo: event.target.value || undefined })}
        />
        <select
          className="dsk__field"
          aria-label="Поставщик"
          value={filters.supplierId ?? ''}
          onChange={(event) =>
            patch({ supplierId: event.target.value ? Number(event.target.value) : null })
          }
        >
          <option value="">Все поставщики</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
        <select
          className="dsk__field"
          aria-label="Состояние"
          value={filters.status ?? ''}
          onChange={(event) => patch({ status: event.target.value as DocStatus | '' })}
        >
          <option value="">Любое состояние</option>
          <option value="draft">Черновики</option>
          <option value="posted">Проведённые</option>
          <option value="canceled">Отменённые</option>
        </select>
        <button type="button" className="dsk__btn" onClick={() => setFilters({})}>
          Сброс
        </button>
      </div>

      <div className="dsk__stats">
        <Stat label="Документов" value={summary && String(summary.docsCount)} />
        <Stat label="На сумму" value={summary && formatTiyin(summary.totalTiyin)} unit="сом" />
        <Stat label="Черновиков" value={summary && String(summary.draftCount)} />
        <Stat label="Проведено" value={summary && String(summary.postedCount)} />
        <Stat
          label="В долг"
          value={summary && formatTiyin(summary.creditTiyin)}
          unit="сом"
          tone={summary && summary.creditTiyin > 0 ? 'warn' : undefined}
        />
      </div>

      {error && (
        <p className="dsk__error" role="alert">
          {error}
        </p>
      )}

      <div className="dsk__table">
        <div className="dsk__head ppu__list-row" role="row">
          <span>№</span>
          <span>Дата</span>
          <span>Поставщик</span>
          <span className="dsk__num">Позиций</span>
          <span className="dsk__num">Сумма</span>
          <span>Состояние</span>
          <span>Оплата</span>
        </div>

        <div
          className="dsk__scroll"
          ref={keys.scrollRef}
          tabIndex={0}
          onKeyDown={keys.onKeyDown}
          onScroll={(event) => {
            const node = event.currentTarget
            if (node.scrollTop + node.clientHeight >= node.scrollHeight - 40) loadMore()
          }}
          role="grid"
          aria-label="Документы закупки"
        >
          {loading ? (
            <SkeletonRows />
          ) : rows.length === 0 ? (
            <div className="dsk__empty">
              <strong>Документов нет</strong>
              <span>
                Здесь появятся накладные прихода. Нажмите «Новая закупка», чтобы завести первую, —
                черновик не тронет ни остатки, ни цены, пока его не провести.
              </span>
            </div>
          ) : (
            rows.map((row, index) => (
              <div
                key={row.id}
                {...keys.rowProps(index)}
                className={`${keys.rowProps(index).className}${row.overdue ? ' dsk__row--alert' : ''}`}
                role="row"
                onClick={() => keys.setIndex(index)}
                onDoubleClick={() => onOpen(row.id)}
              >
                <span className="dsk__num">
                  {row.number}
                  {row.kind === 'return' && <i className="ppu__kind">возврат</i>}
                </span>
                <span className="dsk__muted">{day(row.docDate)}</span>
                <span className="dsk__ellipsis">{row.supplierName || '—'}</span>
                <span className="dsk__num">{row.positionsCount}</span>
                <span className="dsk__num">{formatTiyin(row.totalTiyin)}</span>
                <span>
                  <i className={`dsk__tag dsk__tag--${row.status}`}>{STATUS_LABELS[row.status]}</i>
                </span>
                <span>
                  {row.settlement === 'credit' ? (
                    <i className="dsk__tag dsk__tag--credit">
                      {row.overdue ? 'просрочен' : 'в долг'}
                    </i>
                  ) : (
                    <i className="dsk__tag dsk__tag--paid">оплачен</i>
                  )}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}

function Stat({
  label,
  value,
  unit,
  tone,
}: {
  label: string
  value: string | null | undefined
  unit?: string
  tone?: 'bad' | 'warn' | 'good'
}) {
  return (
    <div className="dsk__stat">
      <span className="dsk__stat-label">{label}</span>
      {value == null ? (
        <span className="dsk__skeleton" aria-hidden="true" />
      ) : (
        <strong className={`dsk__stat-value${tone ? ` dsk__stat-value--${tone}` : ''}`}>
          {value}
          {unit && <i className="dsk__stat-unit">{unit}</i>}
        </strong>
      )}
    </div>
  )
}

function SkeletonRows() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 10 }, (_, index) => (
        <div className="dsk__row ppu__list-row" key={index}>
          {Array.from({ length: 7 }, (_, cell) => (
            <span className="dsk__skeleton" style={{ width: '70%' }} key={cell} />
          ))}
        </div>
      ))}
    </div>
  )
}
