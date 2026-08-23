/**
 * Страница «Добавить товар»: товар, услуга или комплект.
 *
 * Главный сценарий — завести двадцать позиций подряд, глядя в накладную, а не
 * в экран. Из него следует почти всё устройство страницы:
 *
 * • ENTER СОХРАНЯЕТ И ОТКРЫВАЕТ СЛЕДУЮЩУЮ ПУСТУЮ ФОРМУ, курсор в названии.
 *   Не «сохранить и закрыть»: закрывать некуда, следующий товар уже ждёт.
 *
 * • СТРЕЛКИ ВОДЯТ ПО ПОЛЯМ ПО ГЕОМЕТРИИ, а не по порядку в разметке — иначе
 *   стрелка вниз уводила бы вправо (см. useFieldKeyboard).
 *
 * • ПОЛЯ В НЕСКОЛЬКО КОЛОНОК, блок «Дополнительно» свёрнут. В девяти случаях
 *   из десяти товар заводят по первым девяти полям, и пролистывать остальное
 *   каждый раз нельзя.
 *
 * • ПОДСКАЗКА ВНУТРИ КАЖДОГО ПОЛЯ. Подпись говорит, что это за поле, пример
 *   внутри — в каком виде его заполняют.
 *
 * Что не так очевидно: набор полей зависит от вида позиции. У услуги нет ни
 * остатка, ни срока годности, ни закупочной цены; у комплекта нет своего
 * остатка — он считается по составу. Поля не исчезают мгновенно: переключение
 * вида не должно выглядеть как поломка.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { isAbortError } from '../../../api/errors'
import { useNotifications } from '../../../components/notifications/NotificationProvider'
import { useFieldKeyboard } from '../../../hooks/useFieldKeyboard'
import { generateEan13Barcode } from '../../../catalog/barcodeGen'
import { fetchCategories } from '../../../services/products'
import { fetchSuppliers } from '../../../services/suppliers'
import type { SupplierRow } from '../../../services/suppliers'
import { checkBarcode, createCard, fetchCard, saveCard } from '../../../services/productCard'
import type { CardKind, ProductCard } from '../../../services/productCard'
import {
  formatTiyin,
  markupPercent,
  parseQty,
  parseTiyin,
  retailFromMarkup,
  tiyinToInput,
} from '../../../utils/money'
import { HotkeyBar } from '../HotkeyBar'
import { DeskConfirm } from '../DeskConfirm'
import { BundleComposer } from './BundleComposer'
import type { BundleRow } from './BundleComposer'
import { MediaBoard } from './MediaBoard'
import type { Slot } from './MediaBoard'
import '../deskCommon.css'
import './PanelProductPage.css'

type Category = { id: number; name: string }

const KINDS: { id: CardKind; label: string; hint: string }[] = [
  { id: 'piece', label: 'Товар', hint: 'есть остаток, списывается при продаже' },
  { id: 'service', label: 'Услуга', hint: 'остатка нет, продаётся неограниченно' },
  { id: 'bundle', label: 'Комплект', hint: 'списываются составляющие' },
]

const UNITS = ['шт', 'кг', 'л', 'уп', 'м']

function blankForm() {
  return {
    kind: 'piece' as CardKind,
    name: '',
    barcode: '',
    unit: 'шт',
    qty: '0',
    cost: '',
    price: '',
    wholesale: '',
    wholesaleFrom: '',
    markup: '',
    minStock: '',
    expires: '',
    supplierId: '',
    categoryId: '',
    categoryNew: '',
    brand: '',
    country: '',
    description: '',
  }
}

export function PanelProductPage() {
  const { push } = useNotifications()
  const formRef = useRef<HTMLFormElement | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const onFieldKey = useFieldKeyboard(formRef)

  const [form, setForm] = useState(blankForm)
  const [bundle, setBundle] = useState<BundleRow[]>([])
  const [bundleMode, setBundleMode] = useState<'own' | 'sum'>('own')
  const [slots, setSlots] = useState<Slot[]>([])
  const [extra, setExtra] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [created, setCreated] = useState<ProductCard[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [duplicate, setDuplicate] = useState<{ id: number; name: string } | null>(null)
  const [askOpen, setAskOpen] = useState<{ id: number; name: string } | null>(null)
  const [timing, setTiming] = useState<{ elapsedMs: number; onMainThread: boolean } | null>(null)
  /**
   * Правим существующую карточку, а не заводим новую.
   *
   * Появляется одним путём: совпал штрихкод, и человек согласился открыть
   * найденный товар вместо создания второго такого же.
   */
  const [editingId, setEditingId] = useState<number | null>(null)
  const [attached, setAttached] = useState<ProductCard['media']>([])

  /**
   * Ключ формы: один на открытие пустой формы.
   *
   * Второе нажатие «Сохранить» и повтор после обрыва вернут уже созданный
   * товар, а не заведут второй такой же. Меняется вместе со сбросом формы.
   */
  const tokenRef = useRef(crypto.randomUUID())

  const patch = useCallback((next: Partial<ReturnType<typeof blankForm>>) => {
    setForm((prev) => ({ ...prev, ...next }))
  }, [])

  /* Справочники — по одному разу на открытие страницы. */
  useEffect(() => {
    const controller = new AbortController()
    fetchSuppliers({ signal: controller.signal }).then(setSuppliers).catch(() => setSuppliers([]))
    fetchCategories(controller.signal)
      .then((rows: any[]) => setCategories(rows.map((row) => ({ id: row.id, name: row.name }))))
      .catch(() => setCategories([]))
    return () => controller.abort()
  }, [])

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const isService = form.kind === 'service'
  const isBundle = form.kind === 'bundle'
  const hasStock = !isService && !isBundle

  /* ── Связка цен ───────────────────────────────────────────────────────── */

  const costTiyin = parseTiyin(form.cost)
  const priceTiyin = isBundle && bundleMode === 'sum'
    ? bundle.reduce((sum, row) => sum + row.priceTiyin * row.qty, 0)
    : parseTiyin(form.price)
  const unitProfit = priceTiyin - costTiyin

  const setCost = useCallback(
    (text: string) => {
      const cost = parseTiyin(text)
      // Меняется закупочная — держим НАЦЕНКУ, пересчитывая цену продажи. Так
      // работает наценочная модель магазина: «беру с наценкой 35 %», а не
      // «продаю по 70, сколько бы ни стоило».
      const percent = Number(form.markup.replace(',', '.'))
      if (form.markup && Number.isFinite(percent) && cost > 0) {
        patch({ cost: text, price: tiyinToInput(retailFromMarkup(cost, percent)) })
      } else {
        patch({
          cost: text,
          markup: cost > 0 ? String(markupPercent(cost, parseTiyin(form.price))) : '',
        })
      }
    },
    [form.markup, form.price, patch],
  )

  const setPrice = useCallback(
    (text: string) => {
      const cost = parseTiyin(form.cost)
      patch({ price: text, markup: cost > 0 ? String(markupPercent(cost, parseTiyin(text))) : '' })
    },
    [form.cost, patch],
  )

  const setMarkup = useCallback(
    (text: string) => {
      const cost = parseTiyin(form.cost)
      const percent = Number(text.replace(',', '.'))
      patch({
        markup: text,
        price:
          cost > 0 && Number.isFinite(percent)
            ? tiyinToInput(retailFromMarkup(cost, percent))
            : form.price,
      })
    },
    [form.cost, form.price, patch],
  )

  /* ── Штрихкод: проверка занятости до сохранения ───────────────────────── */

  useEffect(() => {
    const code = form.barcode.trim()
    if (!code) {
      setDuplicate(null)
      return undefined
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      checkBarcode(code, undefined, controller.signal)
        .then((owner) => setDuplicate(owner.id ? { id: owner.id, name: owner.name } : null))
        .catch((err) => {
          if (!isAbortError(err)) setDuplicate(null)
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [form.barcode])

  /* ── Сохранение ───────────────────────────────────────────────────────── */

  const reset = useCallback(() => {
    setForm(blankForm())
    setBundle([])
    setBundleMode('own')
    for (const slot of slots) {
      if (slot.previewUrl.startsWith('blob:')) URL.revokeObjectURL(slot.previewUrl)
    }
    setSlots([])
    setAttached([])
    setEditingId(null)
    setExtra(false)
    setWarning('')
    setError('')
    setAskOpen(null)
    tokenRef.current = crypto.randomUUID()
    window.requestAnimationFrame(() => nameRef.current?.focus())
  }, [slots])

  /** Открыть найденный по штрихкоду товар вместо создания дубля. */
  const openExisting = useCallback(async (id: number) => {
    setAskOpen(null)
    setBusy(true)
    try {
      const card = await fetchCard(id)
      setEditingId(card.id)
      setAttached(card.media)
      setBundle(
        card.bundle.map((line) => ({
          productId: line.productId,
          name: line.name,
          qty: line.qty,
          unit: line.unit,
          stockQty: line.stockQty,
          priceTiyin: line.priceTiyin,
          isActive: line.isActive,
        })),
      )
      setBundleMode(card.bundlePriceMode)
      setForm({
        kind: card.kind,
        name: card.name,
        barcode: card.barcode,
        unit: card.unit,
        qty: String(card.stockQty),
        cost: card.costTiyin ? tiyinToInput(card.costTiyin) : '',
        price: card.priceTiyin ? tiyinToInput(card.priceTiyin) : '',
        wholesale: card.wholesaleTiyin ? tiyinToInput(card.wholesaleTiyin) : '',
        wholesaleFrom: card.wholesaleFromQty ? String(card.wholesaleFromQty) : '',
        markup: card.costTiyin ? String(card.markupPercent) : '',
        minStock: card.minStock ? String(card.minStock) : '',
        expires: card.expiresAt ? card.expiresAt.slice(0, 10) : '',
        supplierId: card.supplierId ? String(card.supplierId) : '',
        categoryId: card.categoryId ? String(card.categoryId) : '',
        categoryNew: '',
        brand: card.brand,
        country: card.country,
        description: card.description,
      })
      // Дополнительное раскрываем, если там что-то есть: иначе человек не
      // увидит, что у товара уже указан поставщик, и решит, что поле пустое.
      setExtra(Boolean(card.supplierId || card.categoryId || card.brand || card.country || card.description))
      setDuplicate(null)
      window.requestAnimationFrame(() => nameRef.current?.focus())
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? err?.message ?? 'Не удалось открыть карточку.')
    } finally {
      setBusy(false)
    }
  }, [])

  const save = useCallback(
    async (andNext: boolean) => {
      setError('')
      setWarning('')
      if (!form.name.trim()) {
        setError('Укажите название.')
        nameRef.current?.focus()
        return
      }
      if (isBundle && bundle.length === 0) {
        setError('Комплект без состава сохранить нельзя.')
        return
      }
      if (duplicate && duplicate.id !== editingId) {
        // Не просто отказ: предлагаем открыть найденный товар.
        setAskOpen(duplicate)
        return
      }
      if (slots.some((slot) => slot.busy)) {
        setError('Дождитесь загрузки фото.')
        return
      }

      setBusy(true)
      try {
        const input = {
          kind: form.kind,
          name: form.name.trim(),
          barcode: form.barcode.trim(),
          extraBarcodes: '',
          unit: form.unit,
          stockQty: hasStock ? parseQty(form.qty) : 0,
          costTiyin: isService ? 0 : costTiyin,
          priceTiyin,
          wholesaleTiyin: parseTiyin(form.wholesale),
          wholesaleFromQty: parseQty(form.wholesaleFrom),
          minStock: isService ? 0 : parseQty(form.minStock),
          expiresAt: hasStock && form.expires ? `${form.expires}T12:00:00` : null,
          supplierId: form.supplierId ? Number(form.supplierId) : null,
          categoryId: form.categoryId ? Number(form.categoryId) : null,
          categoryName: form.categoryNew.trim(),
          brand: form.brand.trim(),
          country: form.country.trim(),
          description: form.description.trim(),
          bundlePriceMode: isBundle ? bundleMode : 'own',
          bundle: bundle.map((row) => ({ productId: row.productId, qty: row.qty })),
          mediaTokens: slots
            .filter((slot) => Boolean(slot.token))
            .map((slot) => ({ token: slot.token as string, thumbToken: slot.thumbToken })),
          clientToken: tokenRef.current,
        }
        const card = editingId ? await saveCard(editingId, input) : await createCard(input)
        setCreated((prev) => [card, ...prev.filter((item) => item.id !== card.id)].slice(0, 12))

        /*
          Сообщаем кассе, что каталог изменился.

          На это событие подписаны `useProductsCatalog` и экран кассы: без него
          заведённый товар не появится на витрине до перезахода. Прежняя форма
          рассылала его, и потерять рассылку при переписывании страницы значило
          бы сломать то, ради чего товар и заводят.
        */
        window.dispatchEvent(new Event('nurcrm-panel-products'))
        push({
          kind: 'success',
          title: KINDS.find((item) => item.id === card.kind)?.label ?? 'Товар',
          message: editingId ? `«${card.name}» изменён.` : `«${card.name}» сохранён.`,
          dismissMs: 3000,
        })
        if (andNext) reset()
        else if (editingId) setAttached(card.media)
      } catch (err: any) {
        setError(err?.response?.data?.detail ?? err?.message ?? 'Не удалось сохранить.')
      } finally {
        setBusy(false)
      }
    },
    [
      form, isBundle, isService, hasStock, bundle, bundleMode, duplicate, slots,
      costTiyin, priceTiyin, push, reset, editingId,
    ],
  )

  /* Предупреждения — не запреты: продажа ниже закупки бывает осознанной. */
  useEffect(() => {
    if (isService || isBundle) return
    if (costTiyin > 0 && priceTiyin > 0 && priceTiyin < costTiyin) {
      setWarning('Цена продажи ниже закупочной — товар будет продаваться в убыток.')
      return
    }
    if (form.expires && new Date(form.expires) < new Date(new Date().toDateString())) {
      setWarning('Срок годности уже прошёл.')
      return
    }
    setWarning('')
  }, [costTiyin, priceTiyin, form.expires, isService, isBundle])

  const onSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      void save(true)
    },
    [save],
  )

  const hotkeys = useMemo(
    () => [
      { keys: 'Enter', action: 'Сохранить и следующий' },
      { keys: 'F2', action: 'Сохранить' },
      { keys: '↑↓←→', action: 'По полям' },
      { keys: 'Tab', action: 'По порядку' },
      { keys: 'Esc', action: 'Очистить форму' },
    ],
    [],
  )

  return (
    <div className="dsk ppg">
      <form
        className="ppg__form"
        ref={formRef}
        onSubmit={onSubmit}
        onKeyDown={(event) => {
          if (event.key === 'F2') {
            event.preventDefault()
            void save(false)
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            reset()
            return
          }
          if (event.key === 'Enter') {
            const target = event.target as HTMLElement
            // В многострочном поле и на кнопке Enter значит своё.
            if (target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) return
            event.preventDefault()
            void save(true)
            return
          }
          onFieldKey(event)
        }}
      >
        {/* ── Вид позиции ── */}
        <div className="ppg__kinds" role="radiogroup" aria-label="Что создаём">
          {KINDS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={form.kind === item.id}
              data-field={`kind-${item.id}`}
              className={`ppg__kind${form.kind === item.id ? ' ppg__kind--on' : ''}`}
              onClick={() => patch({ kind: item.id, unit: item.id === 'service' ? 'усл' : 'шт' })}
            >
              <span className="ppg__kind-label">{item.label}</span>
              <span className="ppg__kind-hint">{item.hint}</span>
            </button>
          ))}
        </div>

        {/* ── Основное ── */}
        {/*
          Порядок и ширины подобраны так, чтобы строки не разрывались по
          смыслу: «Количество» и «Единица» обязаны стоять рядом, три цены — в
          одну строку. Сетка на 12 колонок:

            строка 1: Название 4 · Штрихкод 4 · Количество 2 · Единица 2
            строка 2: Закупка 2 · Продажа 2 · Оптовая 2 · Опт от 2 · Наценка 2
            строка 3: Мин. остаток 2 · Срок годности 2

          У услуги и комплекта часть полей отсутствует, и оставшиеся просто
          подтягиваются — сетка не ломается.
        */}
        <div className="ppg__grid">
          <label className="dsk__label ppg__col-4">
            Название
            <input
              ref={nameRef}
              className="dsk__field"
              data-field="name"
              value={form.name}
              placeholder="Молоко 2,5 % 1 л"
              maxLength={200}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>

          <label className="dsk__label ppg__col-4">
            Штрихкод
            <span className="ppg__with-btn">
              <input
                className="dsk__field"
                data-field="barcode"
                inputMode="numeric"
                value={form.barcode}
                placeholder="сканируйте или введите"
                maxLength={64}
                onChange={(event) => patch({ barcode: event.target.value })}
              />
              {/* Для развеса и своей выпечки заводского кода не существует. */}
              <button
                type="button"
                className="dsk__btn ppg__gen"
                data-field="barcode-gen"
                onClick={() => patch({ barcode: generateEan13Barcode() })}
              >
                Сгенерировать
              </button>
            </span>
            {duplicate && (
              <span className="ppg__dup">
                Занят товаром «{duplicate.name}»
              </span>
            )}
          </label>

          {hasStock && (
            <>
              <label className="dsk__label ppg__col-2">
                Количество
                <input
                  className="dsk__field dsk__field--num"
                  data-field="qty"
                  inputMode="decimal"
                  value={form.qty}
                  placeholder="0"
                  onChange={(event) => patch({ qty: event.target.value })}
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <label className="dsk__label ppg__col-2">
                Единица
                <select
                  className="dsk__field"
                  data-field="unit"
                  value={form.unit}
                  onChange={(event) => patch({ unit: event.target.value })}
                >
                  {UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {/* У услуги закупочной цены нет. У комплекта она есть, но не своя —
              она складывается из составляющих, и вводить её руками значило бы
              завести второй ответ на тот же вопрос. */}
          {!isService && !isBundle && (
            <label className="dsk__label ppg__col-2">
              Цена закупки
              <input
                className="dsk__field dsk__field--num"
                data-field="cost"
                inputMode="decimal"
                value={form.cost}
                placeholder="0,00"
                onChange={(event) => setCost(event.target.value)}
                onFocus={(event) => event.target.select()}
              />
            </label>
          )}

          <label className="dsk__label ppg__col-2">
            Цена продажи
            <input
              className="dsk__field dsk__field--num"
              data-field="price"
              inputMode="decimal"
              value={isBundle && bundleMode === 'sum' ? tiyinToInput(priceTiyin) : form.price}
              readOnly={isBundle && bundleMode === 'sum'}
              placeholder="0,00"
              onChange={(event) => setPrice(event.target.value)}
              onFocus={(event) => event.target.select()}
            />
          </label>

          <label className="dsk__label ppg__col-2">
            Цена оптовая
            <input
              className="dsk__field dsk__field--num"
              data-field="wholesale"
              inputMode="decimal"
              value={form.wholesale}
              placeholder="не задана"
              onChange={(event) => patch({ wholesale: event.target.value })}
              onFocus={(event) => event.target.select()}
            />
          </label>

          <label className="dsk__label ppg__col-2">
            Опт от количества
            <input
              className="dsk__field dsk__field--num"
              data-field="wholesale-from"
              inputMode="decimal"
              value={form.wholesaleFrom}
              placeholder="без границы"
              onChange={(event) => patch({ wholesaleFrom: event.target.value })}
              onFocus={(event) => event.target.select()}
            />
          </label>

          {!isService && !isBundle && (
            <label className="dsk__label ppg__col-2">
              Наценка, %
              <input
                className="dsk__field dsk__field--num"
                data-field="markup"
                inputMode="decimal"
                value={form.markup}
                placeholder="0"
                onChange={(event) => setMarkup(event.target.value)}
                onFocus={(event) => event.target.select()}
              />
              {costTiyin > 0 && priceTiyin > 0 && (
                <span className="ppg__aside">
                  прибыль {formatTiyin(unitProfit)} с единицы
                </span>
              )}
            </label>
          )}

          {/* Порог есть и у комплекта: «предупреди, когда собрать можно меньше
              пяти» — обычный вопрос. Нет его только у услуги. */}
          {!isService && (
            <label className="dsk__label ppg__col-2">
              Минимальный остаток
              <input
                className="dsk__field dsk__field--num"
                data-field="min-stock"
                inputMode="decimal"
                value={form.minStock}
                placeholder="не следим"
                onChange={(event) => patch({ minStock: event.target.value })}
                onFocus={(event) => event.target.select()}
              />
            </label>
          )}

          {/* У комплекта срок свой не задаётся: он берётся по самому раннему в
              составе — комплект портится тогда, когда испортилась первая
              его часть. */}
          {hasStock && (
            <label className="dsk__label ppg__col-2">
              Срок годности
              <input
                className="dsk__field"
                data-field="expires"
                type="date"
                value={form.expires}
                onChange={(event) => patch({ expires: event.target.value })}
              />
            </label>
          )}
        </div>

        {/* ── Состав комплекта ── */}
        {isBundle && (
          <BundleComposer
            rows={bundle}
            onRows={setBundle}
            priceMode={bundleMode}
            onPriceMode={setBundleMode}
          />
        )}

        {/* ── Фото и видео ── */}
        <MediaBoard
          productId={editingId ?? undefined}
          slots={slots}
          attached={attached}
          onSlots={setSlots}
          onTiming={setTiming}
        />

        {/* ── Дополнительно ── */}
        <button
          type="button"
          className="ppg__more"
          data-field="more"
          aria-expanded={extra}
          onClick={() => setExtra((open) => !open)}
        >
          {extra ? '− ' : '+ '}Дополнительно: поставщик, категория, бренд, производство, описание
        </button>

        {extra && (
          <div className="ppg__grid">
            <label className="dsk__label ppg__col-3">
              Поставщик
              <select
                className="dsk__field"
                data-field="supplier"
                value={form.supplierId}
                onChange={(event) => patch({ supplierId: event.target.value })}
              >
                <option value="">— не указан —</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="dsk__label ppg__col-3">
              Категория
              <select
                className="dsk__field"
                data-field="category"
                value={form.categoryId}
                onChange={(event) => patch({ categoryId: event.target.value, categoryNew: '' })}
              >
                <option value="">— не указана —</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="dsk__label ppg__col-3">
              Или новая категория
              <input
                className="dsk__field"
                data-field="category-new"
                value={form.categoryNew}
                placeholder="создастся при сохранении"
                onChange={(event) => patch({ categoryNew: event.target.value, categoryId: '' })}
              />
            </label>

            <label className="dsk__label ppg__col-3">
              Бренд
              <input
                className="dsk__field"
                data-field="brand"
                value={form.brand}
                placeholder="например, «Умут»"
                onChange={(event) => patch({ brand: event.target.value })}
              />
            </label>

            <label className="dsk__label ppg__col-3">
              Производство
              <input
                className="dsk__field"
                data-field="country"
                value={form.country}
                placeholder="страна или город"
                onChange={(event) => patch({ country: event.target.value })}
              />
            </label>

            <label className="dsk__label ppg__col-9">
              Описание
              <textarea
                className="dsk__field ppg__area"
                data-field="description"
                rows={2}
                value={form.description}
                placeholder="состав, особенности хранения — то, что спрашивают покупатели"
                onChange={(event) => patch({ description: event.target.value })}
              />
            </label>
          </div>
        )}

        {warning && <p className="ppg__warn">{warning}</p>}
        {error && (
          <p className="dsk__error" role="alert">
            {error}
          </p>
        )}

        <div className="dsk__bar ppg__actions">
          {timing && (
            <span className="ppg__timing">
              обработка фото {timing.elapsedMs} мс
              {timing.onMainThread ? ' · в основном потоке' : ' · в отдельном потоке'}
            </span>
          )}
          <span className="dsk__spacer" />
          <button type="button" className="dsk__btn" onClick={reset}>
            Очистить
          </button>
          <button type="button" className="dsk__btn" onClick={() => void save(false)} disabled={busy}>
            Сохранить
          </button>
          <button type="submit" className="dsk__btn dsk__btn--primary" disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить и следующий'}
          </button>
        </div>
      </form>

      {/* ── Что завели в этом сеансе ── */}
      <aside className="ppg__recent">
        <h2 className="ppg__recent-title">Добавлено сейчас</h2>
        {created.length === 0 ? (
          <p className="ppg__recent-empty">
            Здесь появятся позиции, заведённые в этом сеансе, — чтобы видеть, что уже внесено, и
            не завести дубль.
          </p>
        ) : (
          <ul className="ppg__recent-list">
            {created.map((card) => (
              <li className="ppg__recent-row" key={card.id}>
                <span className="dsk__ellipsis">{card.name}</span>
                <span className="dsk__num dsk__muted">{formatTiyin(card.priceTiyin)}</span>
                <i className={`dsk__tag dsk__tag--${card.kind === 'bundle' ? 'credit' : 'posted'}`}>
                  {card.kind === 'service' ? 'услуга' : card.kind === 'bundle' ? 'комплект' : 'товар'}
                </i>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <HotkeyBar
        hotkeys={hotkeys}
        status={
          editingId
            ? `Правим карточку №${editingId}`
            : created.length > 0
              ? `Заведено в этом сеансе: ${created.length}`
              : undefined
        }
      />

      {/*
        Совпал штрихкод — предлагаем ОТКРЫТЬ существующий товар, а не просто
        сообщаем об ошибке. Дубль заводят не назло: чаще всего товар уже есть,
        а человек об этом не знает. Отправить его искать вручную — значит
        получить второй такой же товар через минуту.
      */}
      {askOpen && (
        <DeskConfirm
          title="Такой штрихкод уже есть"
          message={`Код ${form.barcode.trim()} стоит у товара «${askOpen.name}». Открыть его карточку и поправить вместо создания второго?`}
          confirmLabel="Открыть карточку"
          onConfirm={() => void openExisting(askOpen.id)}
          onClose={() => setAskOpen(null)}
        />
      )}
    </div>
  )
}
