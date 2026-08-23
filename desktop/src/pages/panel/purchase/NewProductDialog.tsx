/**
 * Создание товара прямо из накладной.
 *
 * Нужно ровно в одном случае, и он частый: считали код, а товара такого в базе
 * нет. Уйти в «Добавить товар», завести карточку и вернуться значит потерять
 * набранную накладную — поэтому карточка заводится здесь, минимальным набором
 * полей, и строка сразу подхватывает её.
 *
 * Минимальный — это название, штрихкод и единица. Цены не спрашиваются: они
 * тут же вводятся в самой накладной, и спрашивать их дважды значит гарантировать
 * расхождение.
 */

import { useMemo, useState } from 'react'
import { DeskDialog } from '../DeskDialog'
import { createProduct } from '../../../services/products'
import type { CatalogItem } from '../../../services/purchases'

const UNITS = ['шт', 'кг', 'л', 'уп', 'м']

export function NewProductDialog({
  query,
  onCreated,
  onClose,
}: {
  /** То, что было набрано в ячейке: код со сканера или название. */
  query: string
  onCreated: (item: CatalogItem) => void
  onClose: () => void
}) {
  /* Если набранное похоже на штрихкод — это код, а не название. Сканер
     печатает цифры, человек печатает буквы, и различить их можно без вопросов. */
  const looksLikeBarcode = useMemo(() => /^\d{6,}$/.test(query.trim()), [query])

  const [name, setName] = useState(looksLikeBarcode ? '' : query.trim())
  const [barcode, setBarcode] = useState(looksLikeBarcode ? query.trim() : '')
  const [unit, setUnit] = useState('шт')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      const created = await createProduct({
        name: name.trim(),
        barcode: barcode.trim(),
        // Весовой товар определяется единицей: килограммы — значит вес.
        kind: unit === 'кг' ? 'weight' : 'piece',
        // Цены нулевые намеренно: их вводят в самой накладной, и проведение
        // поставит их карточке. Спрашивать здесь значит спросить дважды.
        price: 0,
        costPrice: 0,
        stockQty: 0,
      })
      onCreated({
        id: Number(created.id),
        name: created.name,
        barcode: barcode.trim(),
        unit,
        stockQty: 0,
        priceTiyin: 0,
        costTiyin: 0,
      })
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? err?.message ?? 'Не удалось создать товар.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DeskDialog
      title="Новый товар"
      subtitle="Такого товара в базе нет — заведём карточку, не уходя из накладной"
      confirmLabel="Создать и подставить"
      confirmDisabled={!name.trim()}
      busy={busy}
      error={error}
      hint="Enter — создать, Esc — отмена"
      onConfirm={() => void create()}
      onClose={onClose}
    >
      <label className="dsk__label dlg__wide">
        Название
        <input
          className="dsk__field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={200}
        />
      </label>
      <div className="dlg__grid">
        <label className="dsk__label">
          Штрихкод
          <input
            className="dsk__field"
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            maxLength={64}
          />
        </label>
        <label className="dsk__label">
          Единица
          <select
            className="dsk__field"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
          >
            {UNITS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="dlg__hint">
        Цены здесь не спрашиваются: закупочную и розничную вы вводите в строке
        накладной, и проведение поставит их карточке.
      </p>
    </DeskDialog>
  )
}
