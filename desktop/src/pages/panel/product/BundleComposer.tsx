/**
 * Состав комплекта: из чего он собран и по сколько.
 *
 * Комплект — это набор уже существующих товаров («чай + пирожок»). Он ссылается
 * на них, а не хранит копию: цена и остаток составляющей меняются в её
 * собственной карточке, и комплект обязан видеть изменение сразу.
 *
 * Здесь же видно то, ради чего состав вообще смотрят: сколько комплектов можно
 * собрать из остатков. Это минимум по составляющим — комплект кончается, как
 * только кончилась любая из них.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { isAbortError } from '../../../api/errors'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import { searchCatalog } from '../../../services/purchases'
import type { CatalogItem } from '../../../services/purchases'
import { formatQty, formatTiyin, parseQty } from '../../../utils/money'

export type BundleRow = {
  productId: number
  name: string
  qty: number
  unit: string
  stockQty: number
  priceTiyin: number
  isActive: boolean
}

type Props = {
  rows: BundleRow[]
  onRows: (next: BundleRow[]) => void
  priceMode: 'own' | 'sum'
  onPriceMode: (mode: 'own' | 'sum') => void
}

export function BundleComposer({ rows, onRows, priceMode, onPriceMode }: Props) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<CatalogItem[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const term = useDebouncedValue(query, 160)

  useEffect(() => {
    if (term.trim().length < 1) {
      setFound([])
      setOpen(false)
      return undefined
    }
    const controller = new AbortController()
    searchCatalog(term.trim(), controller.signal)
      .then((items) => {
        setFound(items)
        setHighlight(0)
        setOpen(items.length > 0)
      })
      .catch((error) => {
        if (!isAbortError(error)) setOpen(false)
      })
    return () => controller.abort()
  }, [term])

  const add = useCallback(
    (item: CatalogItem) => {
      if (rows.some((row) => row.productId === item.id)) {
        // Повтор — это не новая строка, а увеличение количества: две строки
        // одного товара в составе означали бы два разных ответа на вопрос
        // «сколько его входит».
        onRows(
          rows.map((row) =>
            row.productId === item.id ? { ...row, qty: row.qty + 1 } : row,
          ),
        )
      } else {
        onRows([
          ...rows,
          {
            productId: item.id,
            name: item.name,
            qty: 1,
            unit: item.unit,
            stockQty: item.stockQty,
            priceTiyin: item.priceTiyin,
            isActive: true,
          },
        ])
      }
      setQuery('')
      setOpen(false)
    },
    [rows, onRows],
  )

  const totals = useMemo(() => {
    const sum = rows.reduce((acc, row) => acc + row.priceTiyin * row.qty, 0)
    // Сколько комплектов соберётся: минимум по составляющим.
    const possible = rows
      .filter((row) => row.qty > 0)
      .map((row) => Math.floor(row.stockQty / row.qty))
    return { sum, available: possible.length ? Math.max(0, Math.min(...possible)) : 0 }
  }, [rows])

  const broken = rows.filter((row) => !row.isActive)

  return (
    <div className="pbc">
      <div className="pbc__head">
        <label className="dsk__label pbc__search">
          Добавить в состав
          <input
            className="dsk__field"
            data-field="bundle-search"
            value={query}
            placeholder="название или штрихкод"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (!open) return
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setHighlight((index) => Math.min(found.length - 1, index + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlight((index) => Math.max(0, index - 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const picked = found[highlight]
                if (picked) add(picked)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setOpen(false)
              }
            }}
          />
          {open && (
            <ul className="ppu__suggest" role="listbox">
              {found.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlight}
                    className={`ppu__suggest-item${
                      index === highlight ? ' ppu__suggest-item--on' : ''
                    }`}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      add(item)
                    }}
                  >
                    <span className="ppu__suggest-name">{item.name}</span>
                    <span className="ppu__suggest-meta">
                      {formatTiyin(item.priceTiyin)} сом · остаток {formatQty(item.stockQty)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>

        <label className="dsk__label">
          Цена комплекта
          <select
            className="dsk__field"
            data-field="bundle-price-mode"
            value={priceMode}
            onChange={(event) => onPriceMode(event.target.value as 'own' | 'sum')}
          >
            <option value="own">Своя</option>
            <option value="sum">Сумма составляющих</option>
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="pbc__empty">
          Комплект без состава сохранить нельзя. Добавьте хотя бы один товар — при продаже
          спишутся именно они, а не сам комплект.
        </p>
      ) : (
        <div className="pbc__list">
          {rows.map((row) => (
            <div
              className={`pbc__row${!row.isActive ? ' pbc__row--broken' : ''}`}
              key={row.productId}
            >
              <span className="dsk__ellipsis">
                {row.name}
                {!row.isActive && <i className="pbc__flag">товар убран</i>}
              </span>
              <input
                className="dsk__field dsk__field--num pbc__qty"
                data-field={`bundle-qty-${row.productId}`}
                inputMode="decimal"
                value={String(row.qty)}
                onChange={(event) =>
                  onRows(
                    rows.map((item) =>
                      item.productId === row.productId
                        ? { ...item, qty: parseQty(event.target.value) }
                        : item,
                    ),
                  )
                }
                onFocus={(event) => event.target.select()}
              />
              <span className="dsk__muted">{row.unit}</span>
              <span className="dsk__num dsk__muted">{formatTiyin(row.priceTiyin * row.qty)}</span>
              <span className="dsk__num dsk__muted">ост. {formatQty(row.stockQty)}</span>
              <button
                type="button"
                className="pbc__drop"
                onClick={() => onRows(rows.filter((item) => item.productId !== row.productId))}
                aria-label={`Убрать ${row.name} из состава`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="pbc__totals">
          <span>
            Сумма составляющих <b>{formatTiyin(totals.sum)} сом</b>
          </span>
          <span>
            Можно собрать <b>{totals.available}</b>
          </span>
          {broken.length > 0 && (
            <span className="dsk__bad">
              Убранный товар в составе — комплект не продастся
            </span>
          )}
        </div>
      )}
    </div>
  )
}
