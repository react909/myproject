/**
 * Документ закупки: шапка, таблица ввода и проведение.
 *
 * Таблица строк работает как электронная таблица, и это главное требование к
 * ней: сюда вводят по сорок позиций подряд, глядя в бумажную накладную, а не в
 * экран. Отсюда всё устройство:
 *
 * • ЯЧЕЙКИ, А НЕ ФОРМА. Стрелки водят по ячейкам, Enter завершает строку и
 *   создаёт следующую, курсор встаёт в первую ячейку. Мышь не нужна ни разу.
 *
 * • СТРЕЛКИ ВЛЕВО-ВПРАВО РАБОТАЮТ ПО КРАЮ ТЕКСТА. Внутри ячейки они двигают
 *   курсор по цифрам, и только на краю переходят в соседнюю. Иначе поправить
 *   опечатку в середине цены было бы нельзя — стрелка выбрасывала бы из ячейки.
 *
 * • НАЦЕНКА И ЦЕНА СВЯЗАНЫ В ОБЕ СТОРОНЫ. Правишь наценку — пересчитывается
 *   цена, правишь цену — пересчитывается наценка. Обе считаются на месте, а не
 *   запросом к серверу: цифра, догоняющая ввод с задержкой, хуже отсутствующей.
 *
 * • ПОДСКАЗКА ПРОШЛОЙ ЦЕНЫ. Рядом с закупочной ценой видно, почём этот товар
 *   брали в прошлый раз и подорожал ли он. Это то, ради чего накладную и
 *   сверяют.
 *
 * Сумма строки и итог документа считаются ЗДЕСЬ только для показа. В базу
 * уходят цена и количество, а сумму пересчитывает сервер — иначе итог зависел
 * бы от того, как округлил браузер.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { isAbortError } from '../../../api/errors'
import { useNotifications } from '../../../components/notifications/NotificationProvider'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import {
  fetchLastCost,
  searchCatalog,
  type CatalogItem,
  type DocKind,
  type LineInput,
  type PurchaseDoc,
  type Settlement,
} from '../../../services/purchases'
import type { SupplierRow } from '../../../services/suppliers'
import {
  formatQty,
  formatTiyin,
  lineTotal,
  markupPercent,
  parseQty,
  parseTiyin,
  retailFromMarkup,
  tiyinToInput,
} from '../../../utils/money'
import { DeskConfirm } from '../DeskConfirm'
import { NewProductDialog } from './NewProductDialog'

/** Ячейки, по которым ходит курсор. Порядок — это порядок ввода. */
const CELLS = ['name', 'qty', 'cost', 'retail', 'markup'] as const
type Cell = (typeof CELLS)[number]

export type EditLine = {
  /** Свой ключ строки: id с сервера у строк, которых ещё нет, отсутствует. */
  key: number
  productId: number | null
  name: string
  barcode: string
  unit: string
  stockQty: number
  /** Тексты, а не числа: иначе курсор прыгает в конец при каждом нажатии. */
  qty: string
  cost: string
  retail: string
  markup: string
  /** Прошлая закупочная цена этого товара. `null` — берут впервые. */
  lastCostTiyin: number | null
}

let nextKey = 1

function blankLine(): EditLine {
  return {
    key: nextKey++,
    productId: null,
    name: '',
    barcode: '',
    unit: 'шт',
    stockQty: 0,
    qty: '1',
    cost: '',
    retail: '',
    markup: '',
    lastCostTiyin: null,
  }
}

function fromDoc(doc: PurchaseDoc): EditLine[] {
  const lines = doc.lines.map((line) => ({
    key: nextKey++,
    productId: line.productId,
    name: line.name,
    barcode: line.barcode,
    unit: line.unit,
    stockQty: line.stockQty,
    qty: formatQty(line.qty),
    cost: tiyinToInput(line.costTiyin),
    retail: line.retailTiyin ? tiyinToInput(line.retailTiyin) : '',
    markup: line.retailTiyin ? String(line.markupPercent) : '',
    lastCostTiyin: null,
  }))
  return lines.length > 0 ? lines : [blankLine()]
}

type Props = {
  doc: PurchaseDoc
  suppliers: SupplierRow[]
  /** Сохранить черновик. Возвращает документ, каким его увидел сервер. */
  onSave: (input: {
    supplierId: number | null
    docDate: string
    invoiceNumber: string
    comment: string
    settlement: Settlement
    dueDate: string | null
    kind: DocKind
    lines: LineInput[]
  }) => Promise<PurchaseDoc | null>
  onPost: () => void
  onUnpost: () => void
  onPrintLabels: () => void
  onClose: () => void
  busy: boolean
  /** Сколько строк изменено с последнего сохранения — для полосы подсказок. */
  onDirtyChange: (dirty: boolean) => void
}

export function PurchaseDocEditor({
  doc,
  suppliers,
  onSave,
  onPost,
  onUnpost,
  onPrintLabels,
  onClose,
  busy,
  onDirtyChange,
}: Props) {
  const { push } = useNotifications()
  const readOnly = doc.status !== 'draft'

  const [supplierId, setSupplierId] = useState<number | null>(doc.supplierId)
  const [docDate, setDocDate] = useState(doc.docDate.slice(0, 10))
  const [invoice, setInvoice] = useState(doc.invoiceNumber)
  const [comment, setComment] = useState(doc.comment)
  const [settlement, setSettlement] = useState<Settlement>(doc.settlement)
  const [dueDate, setDueDate] = useState(doc.dueDate ? doc.dueDate.slice(0, 10) : '')
  const [lines, setLines] = useState<EditLine[]>(() => fromDoc(doc))
  const [dirty, setDirty] = useState(false)

  /** Где стоит курсор: строка и ячейка. */
  const [cursor, setCursor] = useState<{ row: number; cell: Cell }>({ row: 0, cell: 'name' })
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map())

  /* Подсказки товара для ячейки «Товар». */
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<CatalogItem[]>([])
  const [suggestIndex, setSuggestIndex] = useState(0)
  const [newProductFor, setNewProductFor] = useState<{ row: number; query: string } | null>(null)
  /** Какую строку удаляем. `null` — ничего не удаляем. */
  const [deleteRow, setDeleteRow] = useState<number | null>(null)

  const searchTerm = useDebouncedValue(
    cursor.cell === 'name' ? (lines[cursor.row]?.name ?? '') : '',
    160,
  )

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    if (readOnly || cursor.cell !== 'name' || searchTerm.trim().length < 1) {
      setSuggestions([])
      setSuggestOpen(false)
      return undefined
    }
    const controller = new AbortController()
    searchCatalog(searchTerm.trim(), controller.signal)
      .then((items) => {
        setSuggestions(items)
        setSuggestIndex(0)
        setSuggestOpen(items.length > 0)
      })
      .catch((err: any) => {
        if (!isAbortError(err)) setSuggestOpen(false)
      })
    return () => controller.abort()
  }, [searchTerm, cursor.cell, cursor.row, readOnly])

  /* ── Работа со строками ──────────────────────────────────────────────── */

  const patchLine = useCallback((row: number, patch: Partial<EditLine>) => {
    setDirty(true)
    setLines((prev) => prev.map((line, index) => (index === row ? { ...line, ...patch } : line)))
  }, [])

  const focusCell = useCallback((row: number, cell: Cell) => {
    setCursor({ row, cell })
    // Кадр задержки: строка могла появиться только что, и её поля ещё не в
    // разметке.
    window.requestAnimationFrame(() => {
      const node = inputs.current.get(`${row}:${cell}`)
      node?.focus()
      node?.select()
    })
  }, [])

  const addLine = useCallback(
    (after: number) => {
      setDirty(true)
      setLines((prev) => {
        const next = [...prev]
        next.splice(after + 1, 0, blankLine())
        return next
      })
      focusCell(after + 1, 'name')
    },
    [focusCell],
  )

  const removeLine = useCallback(
    (row: number) => {
      setLines((prev) => {
        if (prev.length <= 1) return [blankLine()]
        return prev.filter((_, index) => index !== row)
      })
      setDirty(true)
      focusCell(Math.max(0, row - 1), 'name')
    },
    [focusCell],
  )

  /** Подставить товар в строку и увести курсор на количество. */
  const applyProduct = useCallback(
    (row: number, item: CatalogItem) => {
      patchLine(row, {
        productId: item.id,
        name: item.name,
        barcode: item.barcode,
        unit: item.unit,
        stockQty: item.stockQty,
        // Цены подставляются из карточки как отправная точка: чаще всего товар
        // приходит по той же цене, и переписывать её не приходится.
        cost: item.costTiyin ? tiyinToInput(item.costTiyin) : '',
        retail: item.priceTiyin ? tiyinToInput(item.priceTiyin) : '',
        markup:
          item.costTiyin && item.priceTiyin
            ? String(markupPercent(item.costTiyin, item.priceTiyin))
            : '',
      })
      setSuggestOpen(false)
      focusCell(row, 'qty')

      // Прошлая цена — отдельным запросом, потому что она зависит от
      // поставщика, а он мог быть выбран уже после начала ввода.
      void fetchLastCost(item.id, supplierId)
        .then((last) => {
          if (last.costTiyin != null) patchLine(row, { lastCostTiyin: last.costTiyin })
        })
        .catch(() => {
          /* подсказка не приехала — строка от этого не ломается */
        })
    },
    [patchLine, focusCell, supplierId],
  )

  /* ── Связка «наценка ↔ розничная цена» ───────────────────────────────── */

  const setCost = useCallback(
    (row: number, text: string) => {
      const costTiyin = parseTiyin(text)
      const line = lines[row]
      // Меняется закупочная — держим НАЦЕНКУ, пересчитывая розничную. Так
      // работает наценочная модель магазина: «беру с наценкой 35%», а не
      // «продаю по 70 сомов, сколько бы ни стоило».
      const percent = Number(line?.markup ?? '')
      const patch: Partial<EditLine> = { cost: text }
      if (line?.markup && Number.isFinite(percent) && costTiyin > 0) {
        patch.retail = tiyinToInput(retailFromMarkup(costTiyin, percent))
      } else {
        patch.markup = costTiyin > 0 ? String(markupPercent(costTiyin, parseTiyin(line?.retail ?? ''))) : ''
      }
      patchLine(row, patch)
    },
    [lines, patchLine],
  )

  const setRetail = useCallback(
    (row: number, text: string) => {
      const costTiyin = parseTiyin(lines[row]?.cost ?? '')
      patchLine(row, {
        retail: text,
        markup: costTiyin > 0 ? String(markupPercent(costTiyin, parseTiyin(text))) : '',
      })
    },
    [lines, patchLine],
  )

  const setMarkup = useCallback(
    (row: number, text: string) => {
      const costTiyin = parseTiyin(lines[row]?.cost ?? '')
      const percent = Number(text.replace(',', '.'))
      patchLine(row, {
        markup: text,
        retail:
          costTiyin > 0 && Number.isFinite(percent)
            ? tiyinToInput(retailFromMarkup(costTiyin, percent))
            : (lines[row]?.retail ?? ''),
      })
    },
    [lines, patchLine],
  )

  /* ── Клавиатура таблицы ──────────────────────────────────────────────── */

  const onCellKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>, row: number, cell: Cell) => {
      const input = event.currentTarget
      const cellIndex = CELLS.indexOf(cell)

      // Подсказки товара забирают стрелки себе, пока открыты: список — это то,
      // по чему сейчас ходят.
      if (suggestOpen && cell === 'name') {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSuggestIndex((index) => Math.min(suggestions.length - 1, index + 1))
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSuggestIndex((index) => Math.max(0, index - 1))
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          setSuggestOpen(false)
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          const picked = suggestions[suggestIndex]
          if (picked) applyProduct(row, picked)
          return
        }
      }

      switch (event.key) {
        case 'Enter': {
          event.preventDefault()
          /*
            Enter в ячейке товара — это ещё и приём сканера.

            Сканер печатает код в поле и жмёт Enter сам. Точное совпадение по
            штрихкоду ищется первым: набранный руками кусок названия так не
            совпадёт, а код совпадёт всегда.
          */
          if (cell === 'name') {
            const text = lines[row]?.name.trim() ?? ''
            const exact = suggestions.find(
              (item) => item.barcode && item.barcode === text,
            )
            if (exact) {
              applyProduct(row, exact)
              return
            }
            if (text && !lines[row]?.productId) {
              // Код или название неизвестны — предлагаем завести товар прямо
              // здесь, не уходя со страницы и не теряя набранную накладную.
              setNewProductFor({ row, query: text })
              return
            }
          }
          // Последняя строка — Enter создаёт следующую. Не последняя —
          // переходит к следующей, ничего не создавая.
          if (row === lines.length - 1) addLine(row)
          else focusCell(row + 1, 'name')
          return
        }
        case 'ArrowDown':
          event.preventDefault()
          return focusCell(Math.min(lines.length - 1, row + 1), cell)
        case 'ArrowUp':
          event.preventDefault()
          return focusCell(Math.max(0, row - 1), cell)
        case 'ArrowRight': {
          // Только с КРАЯ текста: внутри ячейки стрелка двигает курсор по
          // цифрам, и без этого исправить опечатку в середине цены нельзя.
          if (input.selectionStart !== input.value.length || input.selectionEnd !== input.value.length) return
          event.preventDefault()
          if (cellIndex < CELLS.length - 1) return focusCell(row, CELLS[cellIndex + 1])
          if (row < lines.length - 1) return focusCell(row + 1, CELLS[0])
          return
        }
        case 'ArrowLeft': {
          if (input.selectionStart !== 0 || input.selectionEnd !== 0) return
          event.preventDefault()
          if (cellIndex > 0) return focusCell(row, CELLS[cellIndex - 1])
          if (row > 0) return focusCell(row - 1, CELLS[CELLS.length - 1])
          return
        }
        case 'Insert':
          event.preventDefault()
          return addLine(row)
        case 'Delete':
          // Del очищает текст внутри ячейки, если он есть, и удаляет строку,
          // только когда удалять внутри нечего. Иначе Del в середине цены
          // сносил бы всю строку.
          if (input.value.length > 0 && input.selectionStart !== input.value.length) return
          event.preventDefault()
          setDeleteRow(row)
          return
        case 'Escape':
          event.preventDefault()
          setSuggestOpen(false)
          return
        default:
      }
    },
    [suggestOpen, suggestions, suggestIndex, lines, applyProduct, addLine, focusCell, removeLine],
  )

  /* ── Итоги ───────────────────────────────────────────────────────────── */

  const totals = useMemo(() => {
    let positions = 0
    let quantity = 0
    let sum = 0
    let profit = 0
    for (const line of lines) {
      const qty = parseQty(line.qty)
      const costTiyin = parseTiyin(line.cost)
      const retailTiyin = parseTiyin(line.retail)
      if (!line.productId || qty <= 0) continue
      positions += 1
      quantity += qty
      sum += lineTotal(costTiyin, qty)
      if (retailTiyin > 0) profit += lineTotal(retailTiyin - costTiyin, qty)
    }
    return { positions, quantity, sum, profit }
  }, [lines])

  /* ── Сохранение ──────────────────────────────────────────────────────── */

  const collect = useCallback(
    (): LineInput[] =>
      lines
        .filter((line) => line.productId && parseQty(line.qty) > 0)
        .map((line) => ({
          productId: line.productId,
          name: line.name,
          barcode: line.barcode,
          unit: line.unit,
          qty: parseQty(line.qty),
          costTiyin: parseTiyin(line.cost),
          retailTiyin: parseTiyin(line.retail),
        })),
    [lines],
  )

  const save = useCallback(async () => {
    const saved = await onSave({
      supplierId,
      docDate: new Date(`${docDate}T12:00:00`).toISOString(),
      invoiceNumber: invoice,
      comment,
      settlement,
      dueDate: settlement === 'credit' && dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : null,
      kind: doc.kind,
      lines: collect(),
    })
    if (saved) {
      setDirty(false)
      push({ kind: 'success', title: 'Закупка', message: 'Черновик сохранён', dismissMs: 3000 })
    }
    return saved
  }, [onSave, supplierId, docDate, invoice, comment, settlement, dueDate, doc.kind, collect, push])

  /**
   * Провести — это всегда «сохранить, потом провести».
   *
   * Иначе провелось бы то, что лежит на сервере, а не то, что человек видит на
   * экране: последние введённые строки остались бы в браузере, а на склад ушла
   * бы предыдущая версия накладной. Заметить такое можно только по остаткам
   * через день.
   */
  const saveAndPost = useCallback(async () => {
    const saved = await save()
    if (saved) onPost()
  }, [save, onPost])

  /*
    Функциональные клавиши документа.

    Висят на самом документе, а не на окне: пока открыт диалог создания товара,
    F2 не должен сохранять накладную из-под него.
  */
  const onDocKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      // Пока открыто окно, функциональные клавиши документа молчат: F2 не
      // должен сохранять накладную из-под чужого диалога.
      if (newProductFor || deleteRow !== null) return
      if (event.key === 'F2' && !readOnly) {
        event.preventDefault()
        void save()
      } else if (event.key === 'F4' && !readOnly) {
        event.preventDefault()
        void saveAndPost()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    },
    [newProductFor, deleteRow, readOnly, save, saveAndPost, onClose],
  )

  const supplierName = suppliers.find((item) => item.id === supplierId)?.name ?? ''

  return (
    <div className="ppu__doc" onKeyDown={onDocKeyDown}>
      {/* ── Шапка документа ── */}
      <div className="ppu__header">
        <label className="dsk__label">
          Поставщик
          <select
            className="dsk__field"
            value={supplierId ?? ''}
            disabled={readOnly}
            onChange={(event) => {
              setSupplierId(event.target.value ? Number(event.target.value) : null)
              setDirty(true)
            }}
          >
            <option value="">— выберите —</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>

        <label className="dsk__label">
          Дата документа
          <input
            type="date"
            className="dsk__field"
            value={docDate}
            disabled={readOnly}
            onChange={(event) => {
              setDocDate(event.target.value)
              setDirty(true)
            }}
          />
        </label>

        <label className="dsk__label">
          Накладная поставщика
          <input
            className="dsk__field"
            value={invoice}
            disabled={readOnly}
            placeholder="НК-1234"
            onChange={(event) => {
              setInvoice(event.target.value)
              setDirty(true)
            }}
          />
        </label>

        <label className="dsk__label">
          Расчёт
          <select
            className="dsk__field"
            value={settlement}
            disabled={readOnly}
            onChange={(event) => {
              setSettlement(event.target.value as Settlement)
              setDirty(true)
            }}
          >
            <option value="paid">Оплачено сразу</option>
            <option value="credit">В долг</option>
          </select>
        </label>

        {/* Срок оплаты — только при расчёте в долг: у оплаченной сразу накладной
            он ничего не значит и только занимал бы место. */}
        {settlement === 'credit' && (
          <label className="dsk__label">
            Оплатить до
            <input
              type="date"
              className="dsk__field"
              value={dueDate}
              disabled={readOnly}
              onChange={(event) => {
                setDueDate(event.target.value)
                setDirty(true)
              }}
            />
          </label>
        )}

        <label className="dsk__label ppu__header-wide">
          Комментарий
          <input
            className="dsk__field"
            value={comment}
            disabled={readOnly}
            onChange={(event) => {
              setComment(event.target.value)
              setDirty(true)
            }}
          />
        </label>
      </div>

      {/* ── Таблица строк ── */}
      <div className="dsk__table ppu__grid-wrap">
        <div className="dsk__head ppu__grid-row" role="row">
          <span>Товар</span>
          <span>Штрихкод</span>
          <span className="dsk__num">Кол-во</span>
          <span>Ед.</span>
          <span className="dsk__num">Закуп. цена</span>
          <span className="dsk__num">Сумма</span>
          <span className="dsk__num">Розн. цена</span>
          <span className="dsk__num">Наценка %</span>
          <span className="dsk__num">Прибыль с ед.</span>
        </div>

        <div className="dsk__scroll" role="grid" aria-label="Строки документа">
          {lines.map((line, row) => {
            const qty = parseQty(line.qty)
            const costTiyin = parseTiyin(line.cost)
            const retailTiyin = parseTiyin(line.retail)
            const sum = lineTotal(costTiyin, qty)
            const unitProfit = retailTiyin > 0 ? retailTiyin - costTiyin : 0
            /* Подорожал ли товар с прошлой поставки. Показывается только когда
               есть с чем сравнивать и разница заметна. */
            const drift =
              line.lastCostTiyin != null && line.lastCostTiyin > 0 && costTiyin > 0
                ? Math.round(((costTiyin - line.lastCostTiyin) * 1000) / line.lastCostTiyin) / 10
                : null

            return (
              <div
                className={`dsk__row ppu__grid-row${cursor.row === row ? ' dsk__row--on' : ''}`}
                key={line.key}
                role="row"
              >
                <span className="ppu__cell ppu__cell--name">
                  <input
                    ref={(node) => {
                      if (node) inputs.current.set(`${row}:name`, node)
                      else inputs.current.delete(`${row}:name`)
                    }}
                    className="ppu__input"
                    value={line.name}
                    disabled={readOnly}
                    placeholder="название или штрихкод"
                    onFocus={() => setCursor({ row, cell: 'name' })}
                    onChange={(event) => {
                      // Правка названия отвязывает строку от карточки: иначе
                      // осталась бы ссылка на товар, которого в поле уже нет.
                      patchLine(row, {
                        name: event.target.value,
                        productId: null,
                        lastCostTiyin: null,
                      })
                    }}
                    onKeyDown={(event) => onCellKeyDown(event, row, 'name')}
                  />
                  {/* Подсказки: список под ячейкой, выбор стрелками. */}
                  {suggestOpen && cursor.row === row && cursor.cell === 'name' && (
                    <ul className="ppu__suggest" role="listbox">
                      {suggestions.map((item, index) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={index === suggestIndex}
                            className={`ppu__suggest-item${
                              index === suggestIndex ? ' ppu__suggest-item--on' : ''
                            }`}
                            onMouseDown={(event) => {
                              // mousedown, а не click: click приходит после
                              // blur, и ячейка успевает потерять фокус.
                              event.preventDefault()
                              applyProduct(row, item)
                            }}
                          >
                            <span className="ppu__suggest-name">{item.name}</span>
                            <span className="ppu__suggest-meta">
                              {item.barcode || '—'} · остаток {formatQty(item.stockQty)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </span>

                <span className="dsk__ellipsis dsk__muted ppu__readonly">{line.barcode || '—'}</span>

                <span className="ppu__cell">
                  <input
                    ref={(node) => {
                      if (node) inputs.current.set(`${row}:qty`, node)
                      else inputs.current.delete(`${row}:qty`)
                    }}
                    className="ppu__input dsk__num"
                    inputMode="decimal"
                    value={line.qty}
                    disabled={readOnly}
                    onFocus={() => setCursor({ row, cell: 'qty' })}
                    onChange={(event) => patchLine(row, { qty: event.target.value })}
                    onKeyDown={(event) => onCellKeyDown(event, row, 'qty')}
                  />
                </span>

                <span className="dsk__muted ppu__readonly">{line.unit}</span>

                <span className="ppu__cell">
                  <input
                    ref={(node) => {
                      if (node) inputs.current.set(`${row}:cost`, node)
                      else inputs.current.delete(`${row}:cost`)
                    }}
                    className="ppu__input dsk__num"
                    inputMode="decimal"
                    value={line.cost}
                    disabled={readOnly}
                    onFocus={() => setCursor({ row, cell: 'cost' })}
                    onChange={(event) => setCost(row, event.target.value)}
                    onKeyDown={(event) => onCellKeyDown(event, row, 'cost')}
                  />
                  {/* Прошлая цена и изменение — под ценой, мелким. Это
                      единственное место в строке, где появляется цвет: он
                      значит «подорожало», а не оформление. */}
                  {drift != null && drift !== 0 && (
                    <i className={`ppu__drift${drift > 0 ? ' ppu__drift--up' : ' ppu__drift--down'}`}>
                      {drift > 0 ? '+' : ''}
                      {drift}% к {formatTiyin(line.lastCostTiyin ?? 0)}
                    </i>
                  )}
                </span>

                <span className="dsk__num ppu__readonly">{formatTiyin(sum)}</span>

                <span className="ppu__cell">
                  <input
                    ref={(node) => {
                      if (node) inputs.current.set(`${row}:retail`, node)
                      else inputs.current.delete(`${row}:retail`)
                    }}
                    className="ppu__input dsk__num"
                    inputMode="decimal"
                    value={line.retail}
                    disabled={readOnly}
                    onFocus={() => setCursor({ row, cell: 'retail' })}
                    onChange={(event) => setRetail(row, event.target.value)}
                    onKeyDown={(event) => onCellKeyDown(event, row, 'retail')}
                  />
                </span>

                <span className="ppu__cell">
                  <input
                    ref={(node) => {
                      if (node) inputs.current.set(`${row}:markup`, node)
                      else inputs.current.delete(`${row}:markup`)
                    }}
                    className="ppu__input dsk__num"
                    inputMode="decimal"
                    value={line.markup}
                    disabled={readOnly}
                    onFocus={() => setCursor({ row, cell: 'markup' })}
                    onChange={(event) => setMarkup(row, event.target.value)}
                    onKeyDown={(event) => onCellKeyDown(event, row, 'markup')}
                  />
                </span>

                <span className="dsk__num ppu__readonly">
                  {retailTiyin > 0 ? formatTiyin(unitProfit) : '—'}
                </span>
              </div>
            )
          })}
        </div>

        {/* ── Итоги документа ── */}
        <div className="ppu__totals">
          <span>
            Позиций <b>{totals.positions}</b>
          </span>
          <span>
            Общее количество <b>{formatQty(totals.quantity)}</b>
          </span>
          <span className="dsk__spacer" />
          <span>
            Сумма закупки <b>{formatTiyin(totals.sum)} сом</b>
          </span>
          {/*
            Ожидаемая прибыль ПО ЭТОМУ ДОКУМЕНТУ, а не по магазину. Прибыль
            магазина за период — это кабинет владельца, и её здесь нет.
          */}
          <span>
            Ожидаемая прибыль <b>{formatTiyin(totals.profit)} сом</b>
          </span>
        </div>
      </div>

      {deleteRow !== null && (
        <DeskConfirm
          title="Удалить строку"
          message={`«${lines[deleteRow]?.name || 'Строка без товара'}» будет убрана из документа. Документ при этом не сохраняется — до сохранения строку ещё можно вернуть, выйдя без сохранения.`}
          confirmLabel="Удалить"
          danger
          onConfirm={() => {
            removeLine(deleteRow)
            setDeleteRow(null)
          }}
          onClose={() => setDeleteRow(null)}
        />
      )}

      {newProductFor && (
        <NewProductDialog
          query={newProductFor.query}
          onCreated={(item) => {
            applyProduct(newProductFor.row, item)
            setNewProductFor(null)
          }}
          onClose={() => setNewProductFor(null)}
        />
      )}

      {/* ── Действия документа ── */}
      <div className="dsk__bar ppu__actions">
        <button type="button" className="dsk__btn" onClick={onClose}>
          К списку
        </button>
        <span className="dsk__spacer" />
        {readOnly ? (
          <>
            <button type="button" className="dsk__btn" onClick={onPrintLabels}>
              Печать ценников
            </button>
            {doc.status === 'posted' && (
              <button
                type="button"
                className="dsk__btn dsk__btn--danger"
                onClick={onUnpost}
                disabled={busy}
              >
                Отменить проведение
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" className="dsk__btn" onClick={() => void addLine(lines.length - 1)}>
              Добавить строку
            </button>
            <button type="button" className="dsk__btn" onClick={() => void save()} disabled={busy}>
              Сохранить
            </button>
            <button
              type="button"
              className="dsk__btn dsk__btn--primary"
              onClick={() => void saveAndPost()}
              disabled={busy || totals.positions === 0 || !supplierName}
              title={
                !supplierName
                  ? 'Выберите поставщика'
                  : totals.positions === 0
                    ? 'В документе нет строк'
                    : undefined
              }
            >
              Провести
            </button>
          </>
        )}
      </div>
    </div>
  )
}
