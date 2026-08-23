/**
 * Расходы магазина и их категории.
 *
 * Расходы пишутся всегда, независимо от режима аналитики: режим определяет
 * только то, какая цифра главная на дашборде, а не то, что попадает в базу.
 * Поэтому здесь нет ни одного разветвления по режиму — сервер отдаёт выручку,
 * расходы и прибыль одним ответом, а какая из цифр главная, решает экран.
 */

import { apiDelete, apiGet, apiPatch, apiPost } from '../api/client'

export type ExpenseCategory = {
  id: number
  name: string
  /** Заполнен у категорий из стартового набора. Пусто — завёл владелец. */
  slug: string
  sortOrder: number
  isActive: boolean
}

export type Expense = {
  id: number
  categoryId: number | null
  categoryName: string
  amount: number
  note: string
  /** manual — занёс владелец; purchase — приход на склад. */
  source: 'manual' | 'purchase'
  spentAt: string
}

export type ExpenseCategoryTotal = {
  categoryId: number | null
  name: string
  amount: number
}

export type FinanceSummary = {
  revenue: number
  expenses: number
  profit: number
  byCategory: ExpenseCategoryTotal[]
}

/** Периоды здесь те же, что в аналитике: цифры обязаны совпадать. */
export type FinancePeriod = 'today' | 'week' | 'month' | 'all'

function toCategory(raw: Record<string, unknown>): ExpenseCategory {
  return {
    id: Number(raw.id),
    name: String(raw.name ?? ''),
    slug: String(raw.slug ?? ''),
    sortOrder: Number(raw.sort_order ?? 0),
    isActive: raw.is_active !== false,
  }
}

function toExpense(raw: Record<string, unknown>): Expense {
  return {
    id: Number(raw.id),
    categoryId: raw.category_id == null ? null : Number(raw.category_id),
    categoryName: String(raw.category_name ?? 'Без категории'),
    amount: Number(raw.amount ?? 0),
    note: String(raw.note ?? ''),
    source: raw.source === 'purchase' ? 'purchase' : 'manual',
    spentAt: String(raw.spent_at ?? ''),
  }
}

export async function fetchExpenseCategories(includeHidden = false): Promise<ExpenseCategory[]> {
  const res = await apiGet(`/api/finance/expense-categories?include_hidden=${includeHidden}`)
  const rows = Array.isArray(res?.data) ? res.data : []
  return rows.map(toCategory)
}

export async function createExpenseCategory(name: string, sortOrder = 0): Promise<ExpenseCategory> {
  const res = await apiPost('/api/finance/expense-categories', {
    name,
    sort_order: sortOrder,
    is_active: true,
  })
  return toCategory(res.data)
}

export async function renameExpenseCategory(
  category: ExpenseCategory,
  name: string,
): Promise<ExpenseCategory> {
  const res = await apiPatch(`/api/finance/expense-categories/${category.id}`, {
    name,
    sort_order: category.sortOrder,
    is_active: category.isActive,
  })
  return toCategory(res.data)
}

/**
 * Удаляет категорию. Если по ней уже есть расходы, сервер её прячет, а не
 * стирает: иначе суммы прошлых месяцев перестали бы сходиться.
 */
export async function deleteExpenseCategory(id: number): Promise<{ hidden: boolean }> {
  const res = await apiDelete(`/api/finance/expense-categories/${id}`)
  return { hidden: Boolean(res?.data?.hidden) }
}

export async function fetchExpenses(period: FinancePeriod): Promise<Expense[]> {
  const res = await apiGet(`/api/finance/expenses?period=${period}`)
  const rows = Array.isArray(res?.data) ? res.data : []
  return rows.map(toExpense)
}

export async function createExpense(input: {
  categoryId: number | null
  amount: number
  note: string
  /** ISO-дата. Пусто — сегодня. */
  spentAt?: string
}): Promise<Expense> {
  const res = await apiPost('/api/finance/expenses', {
    category_id: input.categoryId,
    amount: input.amount,
    note: input.note,
    spent_at: input.spentAt ?? '',
  })
  return toExpense(res.data)
}

export async function deleteExpense(id: number): Promise<void> {
  await apiDelete(`/api/finance/expenses/${id}`)
}

export async function fetchFinanceSummary(period: FinancePeriod): Promise<FinanceSummary> {
  const res = await apiGet(`/api/finance/summary?period=${period}`)
  const data = res?.data ?? {}
  const rows = Array.isArray(data.by_category) ? data.by_category : []
  return {
    revenue: Number(data.revenue ?? 0),
    expenses: Number(data.expenses ?? 0),
    profit: Number(data.profit ?? 0),
    byCategory: rows.map((row: Record<string, unknown>) => ({
      categoryId: row.category_id == null ? null : Number(row.category_id),
      name: String(row.name ?? 'Без категории'),
      amount: Number(row.amount ?? 0),
    })),
  }
}
