/**
 * Раздел «Поставщики».
 *
 * Список слева, карточка справа — а не список, из которого карточка
 * открывается окном поверх. Разница практическая: долг сверяют, переводя взгляд
 * между строкой списка и историей оплат, и окно закрывало бы как раз ту строку,
 * с которой сверяются.
 *
 * ОПЛАТА ПОСТАВЩИКУ — это выдача денег, и её пропускает не этот файл, а
 * сервер: `POST /payments` требует открытой двери владельца. Кнопка здесь
 * видима всем намеренно: скрытая кнопка защитой не считается, а кассир должен
 * знать, что оплата существует и что делает её владелец. Отказ приходит с
 * сервера и показывается как есть.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { HotkeyBar } from '../HotkeyBar'
import type { Hotkey } from '../HotkeyBar'
import { isAbortError } from '../../../api/errors'
import { useRowKeyboard } from '../../../hooks/useRowKeyboard'
import { useNotifications } from '../../../components/notifications/NotificationProvider'
import {
  archiveSupplier,
  createSupplier,
  fetchSupplier,
  fetchSuppliers,
  updateSupplier,
} from '../../../services/suppliers'
import type { SupplierCard, SupplierRow, SupplierSort } from '../../../services/suppliers'
import { formatTiyin } from '../../../utils/money'
import { DeskConfirm } from '../DeskConfirm'
import { SupplierCardPane } from './SupplierCardPane'
import { SupplierDialog, PaymentDialog } from './SupplierDialogs'
import { PriceCompare } from './PriceCompare'
import '../deskCommon.css'
import './PanelSuppliers.css'

const ROW_HEIGHT = 30

function day(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('ru-RU')
}

type Dialog = { kind: 'new' } | { kind: 'edit'; card: SupplierCard } | { kind: 'pay'; card: SupplierCard } | null

export function PanelSuppliers() {
  const { push } = useNotifications()
  const [rows, setRows] = useState<SupplierRow[]>([])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SupplierSort>('name')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openedId, setOpenedId] = useState<number | null>(null)
  const [card, setCard] = useState<SupplierCard | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [compare, setCompare] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  /** Кого убираем из списка. `null` — никого. */
  const [archiving, setArchiving] = useState<SupplierCard | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetchSuppliers({ q: search, sort, direction, signal: controller.signal })
      .then(setRows)
      .catch((err: any) => {
        if (isAbortError(err)) return
        setError(err?.response?.data?.detail ?? err?.message ?? 'Не удалось загрузить поставщиков.')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [search, sort, direction, reloadToken])

  /* Карточка догружается отдельно: в списке нет ни адреса, ни оплат. */
  useEffect(() => {
    if (openedId == null) {
      setCard(null)
      return undefined
    }
    const controller = new AbortController()
    fetchSupplier(openedId, controller.signal)
      .then(setCard)
      .catch((err: any) => {
        if (!isAbortError(err)) setCard(null)
      })
    return () => controller.abort()
  }, [openedId, reloadToken])

  const keys = useRowKeyboard({
    count: rows.length,
    rowHeight: ROW_HEIGHT,
    rowClass: 'dsk__row psu__row',
    selectedClass: 'dsk__row--on',
    onEnter: (index) => setOpenedId(rows[index]?.id ?? null),
    onEscape: () => setOpenedId(null),
  })

  const toggleSort = useCallback(
    (column: SupplierSort) => {
      if (sort === column) setDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      else {
        setSort(column)
        // Числовые столбцы разумно смотреть от большего: «кто больше должен» —
        // самый частый вопрос к этому списку.
        setDirection(column === 'name' || column === 'phone' ? 'asc' : 'desc')
      }
    },
    [sort],
  )

  const totals = useMemo(
    () => ({
      count: rows.length,
      debt: rows.reduce((sum, row) => sum + Math.max(0, row.debtTiyin), 0),
      overdue: rows.filter((row) => row.overdue).length,
    }),
    [rows],
  )

  /* ── Действия ────────────────────────────────────────────────────────── */

  const saveSupplier = useCallback(
    async (input: Parameters<typeof createSupplier>[0], id?: number) => {
      setBusy(true)
      setDialogError('')
      try {
        const saved = id ? await updateSupplier(id, input) : await createSupplier(input)
        setDialog(null)
        setReloadToken((token) => token + 1)
        setOpenedId(saved.id)
      } catch (err: any) {
        setDialogError(err?.response?.data?.detail ?? err?.message ?? 'Не удалось сохранить.')
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const archive = useCallback(
    async (target: SupplierCard) => {
      try {
        await archiveSupplier(target.id)
        setOpenedId(null)
        setReloadToken((token) => token + 1)
        push({ kind: 'success', title: 'Поставщики', message: 'Убран из списка', dismissMs: 4000 })
      } catch (err: any) {
        push({
          kind: 'error',
          title: 'Поставщики',
          message: err?.response?.data?.detail ?? 'Не удалось убрать поставщика.',
          dismissMs: 7000,
        })
      } finally {
        setArchiving(null)
      }
    },
    [push],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (dialog) return
      if (event.key === 'F5') {
        event.preventDefault()
        setReloadToken((token) => token + 1)
      } else if (event.key === 'Insert') {
        event.preventDefault()
        setDialog({ kind: 'new' })
      } else if (event.key === 'F3') {
        event.preventDefault()
        setCompare((prev) => !prev)
      }
    },
    [dialog],
  )

  const hotkeys: Hotkey[] = compare
    ? [
        { keys: 'F3', action: 'Назад к списку' },
        { keys: '↑↓', action: 'По товарам' },
        { keys: 'Esc', action: 'Закрыть' },
      ]
    : [
        { keys: '↑↓', action: 'По поставщикам' },
        { keys: 'Enter', action: 'Открыть карточку' },
        { keys: 'Ins', action: 'Новый поставщик' },
        { keys: 'F3', action: 'Сравнение цен' },
        { keys: 'F5', action: 'Обновить' },
        { keys: 'Esc', action: 'Закрыть карточку' },
      ]

  if (compare) {
    return (
      <div className="dsk psu" onKeyDown={onKeyDown}>
        <div className="dsk__bar">
          <button type="button" className="dsk__btn" onClick={() => setCompare(false)}>
            ← К поставщикам
          </button>
        </div>
        <PriceCompare />
        <HotkeyBar hotkeys={hotkeys} status="Сравнение цен по поставщикам" />
      </div>
    )
  }

  return (
    <div className="dsk psu" onKeyDown={onKeyDown}>
      <div className="dsk__bar">
        <button
          type="button"
          className="dsk__btn dsk__btn--primary"
          onClick={() => setDialog({ kind: 'new' })}
        >
          Новый поставщик
        </button>
        <input
          className="dsk__field dsk__field--wide"
          placeholder="Поиск по названию или телефону"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Поиск поставщика"
        />
        <button type="button" className="dsk__btn" onClick={() => setCompare(true)}>
          Сравнение цен
        </button>
        <span className="dsk__spacer" />
        <button
          type="button"
          className="dsk__btn"
          onClick={() => setReloadToken((token) => token + 1)}
        >
          Обновить
        </button>
      </div>

      <div className="dsk__stats">
        <Stat label="Поставщиков" value={loading ? null : String(totals.count)} />
        <Stat
          label="Общий долг"
          value={loading ? null : formatTiyin(totals.debt)}
          unit="сом"
          tone={totals.debt > 0 ? 'warn' : undefined}
        />
        <Stat
          label="С просрочкой"
          value={loading ? null : String(totals.overdue)}
          tone={totals.overdue > 0 ? 'bad' : undefined}
        />
      </div>

      {error && (
        <p className="dsk__error" role="alert">
          {error}
        </p>
      )}

      <div className="dsk__split">
        <div className="dsk__pane">
          <div className="dsk__table">
            <div className="dsk__head psu__row" role="row">
              <SortHead label="Название" column="name" sort={sort} direction={direction} onSort={toggleSort} />
              <SortHead label="Телефон" column="phone" sort={sort} direction={direction} onSort={toggleSort} />
              <SortHead
                label="Закупок"
                column="purchases"
                sort={sort}
                direction={direction}
                onSort={toggleSort}
                numeric
              />
              <SortHead
                label="Долг"
                column="debt"
                sort={sort}
                direction={direction}
                onSort={toggleSort}
                numeric
              />
              <SortHead
                label="Последняя"
                column="last"
                sort={sort}
                direction={direction}
                onSort={toggleSort}
              />
            </div>

            <div
              className="dsk__scroll"
              ref={keys.scrollRef}
              tabIndex={0}
              onKeyDown={keys.onKeyDown}
              role="grid"
              aria-label="Поставщики"
            >
              {loading ? (
                <SkeletonRows />
              ) : rows.length === 0 ? (
                <div className="dsk__empty">
                  <strong>{search ? 'Никого не нашлось' : 'Поставщиков ещё нет'}</strong>
                  <span>
                    {search
                      ? 'Проверьте название или телефон — поиск идёт по обоим.'
                      : 'Заведите первого: без поставщика накладную прихода не провести.'}
                  </span>
                </div>
              ) : (
                rows.map((row, index) => (
                  <div
                    key={row.id}
                    {...keys.rowProps(index)}
                    className={`${keys.rowProps(index).className}${
                      row.overdue ? ' dsk__row--alert' : ''
                    }${row.id === openedId ? ' psu__row--opened' : ''}`}
                    role="row"
                    onClick={() => {
                      keys.setIndex(index)
                      setOpenedId(row.id)
                    }}
                  >
                    {/* Название и пометка — два элемента, а не один с
                        `text-overflow`. Пока они были одним, обрезка съедала
                        как раз пометку: она стоит после названия, и клип
                        доходил до неё первым. */}
                    <span className="psu__name">
                      <span className="dsk__ellipsis">{row.name}</span>
                      {row.overdue && <i className="psu__overdue">просрочен платёж</i>}
                    </span>
                    <span className="dsk__ellipsis dsk__muted">{row.phone || '—'}</span>
                    <span className="dsk__num">{row.purchasesCount}</span>
                    <span className={`dsk__num${row.debtTiyin > 0 ? ' dsk__warn' : ''}`}>
                      {row.debtTiyin > 0 ? formatTiyin(row.debtTiyin) : '—'}
                    </span>
                    <span className="dsk__muted">{day(row.lastDelivery)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="dsk__pane">
          {card ? (
            <SupplierCardPane
              card={card}
              onEdit={() => setDialog({ kind: 'edit', card })}
              onPay={() => setDialog({ kind: 'pay', card })}
              onArchive={() => setArchiving(card)}
              onClose={() => setOpenedId(null)}
            />
          ) : (
            <div className="dsk__table">
              <div className="dsk__empty">
                <strong>Поставщик не выбран</strong>
                <span>
                  Выберите строку слева — стрелками или мышью — и нажмите Enter. В карточке видны
                  поставки, оплаты и товары с их ценами.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <HotkeyBar
        hotkeys={hotkeys}
        status={card ? `${card.name} · долг ${formatTiyin(card.debtTiyin)} сом` : undefined}
      />

      {(dialog?.kind === 'new' || dialog?.kind === 'edit') && (
        <SupplierDialog
          card={dialog.kind === 'edit' ? dialog.card : null}
          busy={busy}
          error={dialogError}
          onConfirm={(input) =>
            void saveSupplier(input, dialog.kind === 'edit' ? dialog.card.id : undefined)
          }
          onClose={() => {
            setDialog(null)
            setDialogError('')
          }}
        />
      )}

      {dialog?.kind === 'pay' && (
        <PaymentDialog
          card={dialog.card}
          onDone={() => {
            setDialog(null)
            setReloadToken((token) => token + 1)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {archiving && (
        <DeskConfirm
          title="Убрать из списка"
          message={`«${archiving.name}» пропадёт из справочника, но останется во всех накладных и в истории расчётов. Физически поставщик не удаляется — вернуть его можно.`}
          confirmLabel="Убрать"
          danger
          onConfirm={() => void archive(archiving)}
          onClose={() => setArchiving(null)}
        />
      )}
    </div>
  )
}

function SortHead({
  label,
  column,
  sort,
  direction,
  onSort,
  numeric = false,
}: {
  label: string
  column: SupplierSort
  sort: SupplierSort
  direction: 'asc' | 'desc'
  onSort: (column: SupplierSort) => void
  numeric?: boolean
}) {
  const on = sort === column
  return (
    <span className={numeric ? 'dsk__num' : undefined}>
      <button
        type="button"
        className={`dsk__sort${on ? ' dsk__sort--on' : ''}`}
        onClick={() => onSort(column)}
        aria-sort={on ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        {on && <i aria-hidden="true">{direction === 'asc' ? '▲' : '▼'}</i>}
      </button>
    </span>
  )
}

function Stat({
  label,
  value,
  unit,
  tone,
}: {
  label: string
  value: string | null
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
        <div className="dsk__row psu__row" key={index}>
          {Array.from({ length: 5 }, (_, cell) => (
            <span className="dsk__skeleton" style={{ width: '70%' }} key={cell} />
          ))}
        </div>
      ))}
    </div>
  )
}
