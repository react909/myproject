/**
 * Сравнение цен: у кого этот товар дешевле.
 *
 * Отдельный простой экран, а не вкладка в карточке поставщика, и это не
 * оформление. Вопрос здесь задаётся ОТ ТОВАРА («почём этот сахар у всех?»), а
 * карточка отвечает от поставщика («что везёт этот?»). Внутри карточки такой
 * вопрос задать нельзя — там уже выбран один поставщик.
 */

import { useEffect, useState } from 'react'
import { isAbortError } from '../../../api/errors'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import { useRowKeyboard } from '../../../hooks/useRowKeyboard'
import { fetchPriceComparison, searchCatalog } from '../../../services/purchases'
import type { CatalogItem, PriceComparisonRow } from '../../../services/purchases'
import { formatTiyin } from '../../../utils/money'

const ROW_HEIGHT = 30

function day(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('ru-RU')
}

export function PriceCompare() {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<CatalogItem[]>([])
  const [picked, setPicked] = useState<CatalogItem | null>(null)
  const [rows, setRows] = useState<PriceComparisonRow[] | null>(null)

  const term = useDebouncedValue(query, 180)

  useEffect(() => {
    const controller = new AbortController()
    searchCatalog(term.trim(), controller.signal)
      .then(setItems)
      .catch((err: any) => {
        if (!isAbortError(err)) setItems([])
      })
    return () => controller.abort()
  }, [term])

  useEffect(() => {
    if (!picked) {
      setRows(null)
      return undefined
    }
    const controller = new AbortController()
    setRows(null)
    fetchPriceComparison(picked.id, controller.signal)
      .then(setRows)
      .catch((err: any) => {
        if (!isAbortError(err)) setRows([])
      })
    return () => controller.abort()
  }, [picked])

  const keys = useRowKeyboard({
    count: items.length,
    rowHeight: ROW_HEIGHT,
    rowClass: 'dsk__row psu__pick-row',
    selectedClass: 'dsk__row--on',
    onEnter: (index) => setPicked(items[index] ?? null),
  })

  /* Самая низкая последняя цена — её и подсвечиваем: это и есть ответ на
     вопрос, ради которого экран открыли. */
  const cheapest =
    rows && rows.length > 1 ? Math.min(...rows.map((row) => row.lastCostTiyin)) : null

  return (
    <div className="dsk__split psu__compare">
      <div className="dsk__pane">
        <input
          className="dsk__field"
          placeholder="Товар: название или штрихкод"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Поиск товара"
        />
        <div className="dsk__table">
          <div className="dsk__head psu__pick-row" role="row">
            <span>Товар</span>
            <span className="dsk__num">Остаток</span>
          </div>
          <div
            className="dsk__scroll"
            ref={keys.scrollRef}
            tabIndex={0}
            onKeyDown={keys.onKeyDown}
            role="grid"
            aria-label="Товары"
          >
            {items.length === 0 ? (
              <div className="dsk__empty">
                <strong>Ничего не нашлось</strong>
                <span>Начните вводить название товара или считайте штрихкод.</span>
              </div>
            ) : (
              items.map((item, index) => (
                <div
                  key={item.id}
                  {...keys.rowProps(index)}
                  role="row"
                  onClick={() => {
                    keys.setIndex(index)
                    setPicked(item)
                  }}
                >
                  <span className="dsk__ellipsis">{item.name}</span>
                  <span className="dsk__num dsk__muted">{item.stockQty}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="dsk__pane">
        <div className="dsk__table">
          <div className="dsk__head psu__compare-row" role="row">
            <span>Поставщик</span>
            <span className="dsk__num">Последняя цена</span>
            <span className="dsk__num">Мин.</span>
            <span className="dsk__num">Макс.</span>
            <span className="dsk__num">Поставок</span>
            <span>Последняя</span>
          </div>
          <div className="dsk__scroll" role="grid" aria-label="Цены по поставщикам">
            {!picked ? (
              <div className="dsk__empty">
                <strong>Товар не выбран</strong>
                <span>
                  Найдите товар слева и нажмите Enter — справа появится, у кого он закупался и
                  почём.
                </span>
              </div>
            ) : rows === null ? (
              <div aria-hidden="true">
                {Array.from({ length: 4 }, (_, index) => (
                  <div className="dsk__row psu__compare-row" key={index}>
                    {Array.from({ length: 6 }, (_, cell) => (
                      <span className="dsk__skeleton" style={{ width: '70%' }} key={cell} />
                    ))}
                  </div>
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="dsk__empty">
                <strong>Закупок не было</strong>
                <span>
                  «{picked.name}» ещё ни разу не приходил по проведённой накладной — сравнивать
                  не с чем.
                </span>
              </div>
            ) : (
              rows.map((row) => (
                <div
                  className={`dsk__row psu__compare-row${
                    cheapest != null && row.lastCostTiyin === cheapest ? ' psu__cheapest' : ''
                  }`}
                  key={`${row.supplierId}`}
                  role="row"
                >
                  <span className="dsk__ellipsis">{row.supplierName}</span>
                  <span className="dsk__num">
                    <b>{formatTiyin(row.lastCostTiyin)}</b>
                  </span>
                  <span className="dsk__num dsk__muted">{formatTiyin(row.minCostTiyin)}</span>
                  <span className="dsk__num dsk__muted">{formatTiyin(row.maxCostTiyin)}</span>
                  <span className="dsk__num">{row.deliveries}</span>
                  <span className="dsk__muted">{day(row.lastDate)}</span>
                </div>
              ))
            )}
          </div>
        </div>
        {cheapest != null && rows && rows.length > 1 && (
          <p className="psu__hint">
            Полосой отмечен поставщик с самой низкой последней ценой. Цена — не единственное:
            смотрите и на дату — прошлогодняя цена ни о чём не говорит.
          </p>
        )}
      </div>
    </div>
  )
}
