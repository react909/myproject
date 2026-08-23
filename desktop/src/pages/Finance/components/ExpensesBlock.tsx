/**
 * Расходы магазина: ввод и расшифровка по категориям.
 *
 * Блок один на оба режима аналитики, и это принципиально. Учёт в базе
 * одинаковый: все продажи и все расходы пишутся всегда. Режим меняет только то,
 * какая цифра вынесена главной наверх, — здесь же разница сводится к одной
 * строке подписи. Строить два разных экрана под два режима значило бы строить
 * две системы учёта там, где она одна.
 *
 * Закупка товара сюда не вводится руками: она приходит автоматически при
 * оприходовании прихода на склад. Дублировать её вручную — верный способ
 * получить расхождение между складом и деньгами.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createExpense,
  createExpenseCategory,
  deleteExpense,
  deleteExpenseCategory,
  fetchExpenseCategories,
  fetchExpenses,
  fetchFinanceSummary,
  renameExpenseCategory,
} from '../../../services/expenses'
import type {
  Expense,
  ExpenseCategory,
  FinancePeriod,
  FinanceSummary,
} from '../../../services/expenses'
import type { AnalyticsMode } from '../../../onboarding/types'
import './ExpensesBlock.css'

type Props = {
  /** Период страницы «Финансы» — расходы считаются за него же. */
  period: FinancePeriod
  /** Какая цифра главная. Влияет только на подписи, не на данные. */
  analyticsMode: AnalyticsMode
}

function money(value: number): string {
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} сом`
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

export function ExpensesBlock({ period, analyticsMode }: Props) {
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Справочник правят редко — он свёрнут, чтобы не мешать ежедневному вводу.
  const [editingCategories, setEditingCategories] = useState(false)
  const [newCategory, setNewCategory] = useState('')

  const reload = useCallback(async () => {
    const [cats, rows, totals] = await Promise.all([
      fetchExpenseCategories(),
      fetchExpenses(period),
      fetchFinanceSummary(period),
    ])
    setCategories(cats)
    setExpenses(rows)
    setSummary(totals)
    // Первая категория подставляется сама: пустой селект заставил бы выбирать
    // её при каждом вводе, а расход заносят по нескольку штук подряд.
    setCategoryId((prev) => prev ?? cats[0]?.id ?? null)
  }, [period])

  useEffect(() => {
    let cancelled = false
    void reload().catch(() => {
      if (!cancelled) setError('Не удалось загрузить расходы.')
    })
    return () => {
      cancelled = true
    }
  }, [reload])

  const parsedAmount = useMemo(() => Number(amount.replace(',', '.')), [amount])
  const canSubmit = Number.isFinite(parsedAmount) && parsedAmount > 0 && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError('')
    try {
      await createExpense({ categoryId, amount: parsedAmount, note: note.trim() })
      setAmount('')
      setNote('')
      await reload()
    } catch {
      setError('Не удалось сохранить расход.')
    } finally {
      setBusy(false)
    }
  }

  /** Общая обёртка для правок справочника: один busy, одна обработка ошибки. */
  const runCategoryEdit = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await reload()
    } catch {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }

  const addCategory = async () => {
    const name = newCategory.trim()
    if (!name) return
    await runCategoryEdit(
      () => createExpenseCategory(name, categories.length),
      'Не удалось добавить категорию. Возможно, такая уже есть.',
    )
    setNewCategory('')
  }

  const remove = async (expense: Expense) => {
    if (expense.source !== 'manual') return
    setBusy(true)
    setError('')
    try {
      await deleteExpense(expense.id)
      await reload()
    } catch {
      setError('Не удалось удалить расход.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="exp">
      <header className="exp__head">
        <div className="exp__head-text">
          <h3 className="exp__title">Расходы</h3>
          <p className="exp__sub">
            {analyticsMode === 'profit'
              ? 'Вычитаются из выручки — из них складывается чистая прибыль'
              : 'Записываются отдельно и на главную цифру выручки не влияют'}
          </p>
        </div>
        <button
          type="button"
          className="exp__cats-toggle"
          onClick={() => setEditingCategories((value) => !value)}
        >
          {editingCategories ? 'Готово' : 'Категории'}
        </button>
      </header>

      {/*
        Справочник редактируемый: стартовый набор покрывает типовой магазин, но
        у каждого находится своё — маркетинг, ремонт, доставка. Свёрнут по
        умолчанию: правят его редко, а расход заносят каждый день.
      */}
      {editingCategories && (
        <div className="exp__cats">
          <ul className="exp__cats-list">
            {categories.map((category) => (
              <li key={category.id}>
                <input
                  defaultValue={category.name}
                  maxLength={128}
                  disabled={busy}
                  onBlur={(event) => {
                    const name = event.target.value.trim()
                    if (!name || name === category.name) {
                      event.target.value = category.name
                      return
                    }
                    void runCategoryEdit(
                      () => renameExpenseCategory(category, name),
                      'Не удалось переименовать категорию.',
                    )
                  }}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void runCategoryEdit(
                      () => deleteExpenseCategory(category.id),
                      'Не удалось удалить категорию.',
                    )
                  }
                  title="Удалить категорию"
                  aria-label={`Удалить категорию ${category.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="exp__cats-add">
            <input
              value={newCategory}
              maxLength={128}
              placeholder="Новая категория"
              disabled={busy}
              onChange={(event) => setNewCategory(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                void addCategory()
              }}
            />
            <button type="button" onClick={() => void addCategory()} disabled={busy || !newCategory.trim()}>
              Добавить
            </button>
          </div>
          <p className="exp__cats-note">
            Категория, по которой уже есть расходы, не удаляется, а скрывается: иначе суммы прошлых
            месяцев перестали бы сходиться.
          </p>
        </div>
      )}

      {summary && (
        <div className="exp__totals">
          <div className="exp__total">
            <span>Выручка</span>
            <b>{money(summary.revenue)}</b>
          </div>
          <div className="exp__total">
            <span>Расходы</span>
            <b>{money(summary.expenses)}</b>
          </div>
          <div
            className={`exp__total exp__total--profit${summary.profit < 0 ? ' is-negative' : ''}`}
          >
            <span>Прибыль</span>
            <b>{money(summary.profit)}</b>
          </div>
        </div>
      )}

      <form
        className="exp__form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <label className="exp__field exp__field--cat">
          <span>Категория</span>
          <select
            value={categoryId ?? ''}
            onChange={(event) => setCategoryId(event.target.value ? Number(event.target.value) : null)}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label className="exp__field exp__field--sum">
          <span>Сумма</span>
          <input
            inputMode="decimal"
            value={amount}
            placeholder="0"
            onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, ''))}
          />
        </label>

        <label className="exp__field exp__field--note">
          <span>Комментарий</span>
          <input
            value={note}
            maxLength={200}
            placeholder="Аренда за август"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        <button type="submit" className="exp__add" disabled={!canSubmit}>
          Добавить
        </button>
      </form>

      {error && (
        <p className="exp__error" role="alert">
          {error}
        </p>
      )}

      {summary && summary.byCategory.length > 0 && (
        <ul className="exp__breakdown">
          {summary.byCategory.map((row) => (
            <li key={row.categoryId ?? row.name}>
              <span>{row.name}</span>
              <b>{money(row.amount)}</b>
            </li>
          ))}
        </ul>
      )}

      <ul className="exp__list">
        {expenses.length === 0 && <li className="exp__empty">За период расходов нет</li>}
        {expenses.map((expense) => (
          <li key={expense.id} className="exp__row">
            <span className="exp__row-date">{formatDate(expense.spentAt)}</span>
            <span className="exp__row-cat">{expense.categoryName}</span>
            <span className="exp__row-note">{expense.note}</span>
            <b className="exp__row-sum">{money(expense.amount)}</b>
            {expense.source === 'manual' ? (
              <button
                type="button"
                className="exp__row-del"
                onClick={() => void remove(expense)}
                disabled={busy}
                title="Удалить расход"
                aria-label="Удалить расход"
              >
                ✕
              </button>
            ) : (
              // Закупка — обратная сторона прихода на склад. Удалять её отдельно
              // нельзя: товар на полке остался бы, а расхода на него нет.
              <span className="exp__row-auto" title="Создан приходом на склад">
                приход
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
