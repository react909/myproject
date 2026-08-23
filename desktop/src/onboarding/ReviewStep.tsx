/**
 * Шаг «Проверка и запуск».
 *
 * Сводка карточками по каждому шагу: ключевые значения, статус и переход к
 * конкретному полю, а не к началу шага. Справа — чек моноширинным шрифтом в
 * реальной ширине ленты: это самая честная проверка, кривой адрес или пустое
 * название видно сразу. В простом режиме и сводка, и чек короче — показывать
 * там фискальные строки было бы враньём.
 */

import { ReceiptPreview } from './ReceiptPreview'
import { ACCOUNT_STEP, STEPS, optionalGapsForStep, problemsForStep } from './fields'
import type { FieldDef, FieldProblem } from './fields'
import { industryById } from './industries'
import { formatPhone } from './phone'
import {
  HEADER_LAYOUTS,
  EDITIONS,
  FISCAL_MODES,
  ANALYTICS_MODES,
  formatOutletAddress,
  formatPaymentMethods,
  effectiveOwnerEmail,
  isFiscal,
  ownerFullName,
  taxRegimeLabel,
} from './types'
import type { OnboardingData } from './types'

type Status = 'ok' | 'warn' | 'error'

const BADGE: Record<Status, { mark: string; label: string }> = {
  ok: { mark: '✓', label: 'Заполнено' },
  warn: { mark: '⚠', label: 'Есть необязательные' },
  error: { mark: '✕', label: 'Нужно заполнить' },
}

type SummaryRow = { label: string; value: string }

type Props = {
  data: OnboardingData
  /** Проблемы паролей и PIN — они живут вне OnboardingData. */
  secretIssues: FieldProblem[]
  onFix: (field: FieldDef) => void
  onEditStep: (step: number) => void
}

export function ReviewStep({ data, secretIssues, onFix, onEditStep }: Props) {
  const cards = STEPS.slice(0, STEPS.length - 1).map((step, index) => {
    const problems =
      index === ACCOUNT_STEP
        ? [...problemsForStep(ACCOUNT_STEP, data), ...secretIssues]
        : problemsForStep(index, data)
    const gaps = optionalGapsForStep(index, data)
    const status: Status = problems.length > 0 ? 'error' : gaps.length > 0 ? 'warn' : 'ok'
    return { step: index, title: step.title, rows: summaryRows(index, data), problems, gaps, status }
  })

  const blocking = cards.flatMap((card) => card.problems)

  return (
    <section className="ow__section ow__review">
      <div className="ow__review-main">
        {blocking.length > 0 && (
          <p className="ow__review-lead ow__review-lead--error">
            Запуск заблокирован: {blocking.length === 1 ? 'не заполнено 1 поле' : `не заполнено полей: ${blocking.length}`}.
            Нажмите «Исправить» — откроется нужное поле.
          </p>
        )}

        <div className="ow__summary">
          {cards.map((card) => (
            <article key={card.title} className={`ow__sum ow__sum--${card.status}`}>
              <header>
                <span className={`ow__badge ow__badge--${card.status}`} title={BADGE[card.status].label}>
                  {BADGE[card.status].mark}
                </span>
                <h3>{card.title}</h3>
                <button type="button" className="ow__sum-edit" onClick={() => onEditStep(card.step)}>
                  Изменить
                </button>
              </header>

              <dl>
                {card.rows.map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd className={row.value ? undefined : 'is-empty'}>{row.value || 'не указано'}</dd>
                  </div>
                ))}
              </dl>

              {card.problems.length > 0 && (
                <ul className="ow__sum-problems">
                  {card.problems.map((problem) => (
                    <li key={problem.field.id}>
                      <span>{problem.message}</span>
                      <button type="button" className="ow__fix" onClick={() => onFix(problem.field)}>
                        Исправить
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {card.problems.length === 0 && card.gaps.length > 0 && (
                <p className="ow__sum-gaps">
                  Необязательные поля пустые: {card.gaps.map((field) => field.label).join(', ')}.
                  <button type="button" className="ow__fix ow__fix--quiet" onClick={() => onFix(card.gaps[0])}>
                    Заполнить
                  </button>
                </p>
              )}
            </article>
          ))}
        </div>
      </div>

      <div className="ow__review-preview">
        <span className="ob-label">
          {isFiscal(data) ? 'Фискальный чек как он выйдет на ленте' : 'Товарный чек как он выйдет на ленте'}
        </span>
        <ReceiptPreview data={data} />
      </div>
    </section>
  )
}

/** 3–5 ключевых значений на карточку — не весь шаг, а то, по чему его узнают. */
function summaryRows(step: number, data: OnboardingData): SummaryRow[] {
  const { company, outlet, kkm, business, tax, acquiring, branding, owner } = data
  const fiscal = isFiscal(data)

  if (step === 0) {
    const modeLabel = FISCAL_MODES.find((mode) => mode.id === data.fiscalMode)?.label ?? ''
    const rows: SummaryRow[] = [
      { label: 'Режим', value: modeLabel },
      // Тариф — часть решения о установке, и увидеть его перед запуском надо
      // здесь: после создания базы он меняется уже не мастером.
      { label: 'Тариф', value: EDITIONS.find((item) => item.id === data.edition)?.label ?? '' },
      { label: 'Магазин', value: company.shortName },
      { label: 'Адрес', value: formatOutletAddress(outlet) },
      { label: 'Телефон', value: formatPhone(data.contacts.phone) },
    ]
    if (!fiscal) return rows
    return [
      ...rows,
      { label: 'ИНН', value: company.inn },
      { label: 'Координаты', value: [outlet.lat, outlet.lon].filter(Boolean).join(', ') },
      { label: 'ЗН ККМ', value: kkm.serialNumber },
    ]
  }

  if (step === 1) {
    const preset = industryById(business.industry)
    const rows: SummaryRow[] = [
      { label: 'Сфера', value: preset.title },
      { label: 'Валюта', value: `${business.currency} · ${business.decimals} зн.` },
      {
        label: 'Аналитика',
        value: ANALYTICS_MODES.find((mode) => mode.id === business.analyticsMode)?.label ?? '',
      },
    ]
    if (!fiscal) return rows
    const single = tax.regime === 'simplified_single' ? ` · единый ${tax.singleTaxRate}%` : ''
    return [
      ...rows,
      {
        label: 'Налоги',
        value: `${taxRegimeLabel(tax.regime) || '—'} · НДС ${tax.vatRate}% / НСП ${tax.salesTaxRate}%${single}`,
      },
    ]
  }

  if (step === 2) {
    return [
      { label: 'Оплата', value: formatPaymentMethods(acquiring.methods) },
      { label: 'Эквайер', value: [acquiring.bank, acquiring.terminalId].filter(Boolean).join(', ') },
      { label: 'QR', value: acquiring.qrProvider },
      { label: 'Второй экран', value: acquiring.secondScreen ? 'Включён' : 'Выключен' },
    ]
  }

  if (step === 3) {
    const logoLabel =
      branding.mode === 'none'
        ? 'Без логотипа'
        : branding.mode === 'monogram'
          ? 'Монограмма'
          : 'Свой файл'
    const shapeLabel = branding.logoShape === 'circle' ? 'круг' : 'квадрат'
    return [
      { label: 'Логотип', value: branding.mode === 'none' ? logoLabel : `${logoLabel} · ${shapeLabel}` },
      {
        label: 'Шапка приложения',
        value: HEADER_LAYOUTS.find((item) => item.id === branding.headerLayout)?.label ?? '',
      },
      { label: 'Акцент', value: branding.primaryColor.toUpperCase() },
      { label: 'Тема', value: branding.theme === 'light' ? 'Светлая' : 'Тёмная' },
      { label: 'Подвал чека', value: branding.receiptFooter },
    ]
  }

  const rows: SummaryRow[] = [
    { label: 'Владелец', value: ownerFullName(owner) },
    { label: 'Email (логин)', value: effectiveOwnerEmail(data) },
  ]
  return fiscal ? [...rows, { label: 'Код кассира', value: owner.cashierCode }] : rows
}
