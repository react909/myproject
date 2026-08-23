/**
 * Движок формы по реестру полей.
 *
 * Единственное место в проекте, где рисуется поле ввода реквизитов. Мастер
 * первого запуска и раздел реквизитов в настройках вызывают его с разным
 * набором полей — разметку не копируют. Какие поля вообще существуют в
 * текущем режиме работы, движок не решает: он рисует то, что ему дали.
 */

import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { readField, sectionMeta, validateField, writeField } from './fields'
import type { FieldDef } from './fields'
import { PhoneInput } from './PhoneInput'
import type { OnboardingData } from './types'
import './OnboardingForm.css'

type CommonProps = {
  data: OnboardingData
  /**
   * Правка данных — функцией от предыдущего значения.
   *
   * Готовый объект, собранный из пропса `data`, теряет соседнюю правку, если
   * обе попали в один кадр отрисовки: обе прочитали одно и то же состояние.
   * На форме реквизитов это выглядит как «поле иногда не сохраняется».
   */
  onChange: (update: (previous: OnboardingData) => OnboardingData) => void
  /** Ошибки показываются только после попытки идти дальше — иначе пустая
   *  форма встречает пользователя красным. */
  showErrors?: boolean
  /** Поле, к которому нужно проскроллить и поставить фокус (переход из сводки). */
  focusFieldId?: string
  /** Отрисовка полей с kind: 'custom' — их контролы живут в вызывающем экране. */
  renderCustom?: (field: FieldDef) => ReactNode
  /** Поля, заблокированные извне: например, считанные с кассы номера. */
  lockedFieldIds?: ReadonlySet<string>
}

export function OnboardingFields({
  fields,
  ...common
}: CommonProps & { fields: FieldDef[] }) {
  return (
    <div className="ob-grid">
      {fields.map((field) => (
        <OnboardingField key={field.id} field={field} {...common} />
      ))}
    </div>
  )
}

/**
 * Секция шага целиком: заголовок и поля.
 *
 * Свёрнутые секции — не украшение: блок кассы в фискальном режиме содержит
 * половину полей шага, и открывать его сразу значит вернуть ту самую стену
 * ввода, ради ухода от которой заведён режим работы.
 */
export function OnboardingSection({
  section,
  fields,
  /** Открыть свёрнутую секцию принудительно (в ней нашлась ошибка). */
  forceOpen = false,
  headExtra,
  ...common
}: CommonProps & {
  section: string
  fields: FieldDef[]
  forceOpen?: boolean
  headExtra?: ReactNode
}) {
  const meta = sectionMeta(section, common.data.fiscalMode)
  const [open, setOpen] = useState(!meta.collapsible)
  const bodyId = useId()

  // Ошибку нельзя спрятать под свёрнутый заголовок: человек увидит «заполните
  // поле» и не найдёт где.
  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])

  if (!meta.collapsible) {
    return (
      <div className="ob-section">
        <OnboardingSectionHead title={section} caption={meta.caption} />
        {headExtra}
        <OnboardingFields fields={fields} {...common} />
      </div>
    )
  }

  return (
    <div className={`ob-section ob-section--foldable${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="ob-fold"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="ob-fold__text">
          <strong>{section}</strong>
          {meta.caption && <small>{meta.caption}</small>}
        </span>
        <span className="ob-fold__mark" aria-hidden="true">
          {open ? 'Свернуть' : 'Развернуть'}
        </span>
      </button>
      {open && (
        <div id={bodyId} className="ob-fold__body">
          {headExtra}
          <OnboardingFields fields={fields} {...common} />
        </div>
      )}
    </div>
  )
}

export function OnboardingSectionHead({ title, caption }: { title: string; caption?: string }) {
  return (
    <div className="ob-section-head">
      <h2>{title}</h2>
      {caption && <p>{caption}</p>}
    </div>
  )
}

function OnboardingField({
  field,
  data,
  onChange,
  showErrors,
  focusFieldId,
  renderCustom,
  lockedFieldIds,
}: CommonProps & { field: FieldDef }) {
  const controlRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null)
  const value = readField(data, field)
  const error = showErrors ? validateField(field, data) : ''
  const locked = lockedFieldIds?.has(field.id) ?? false
  // Подсказка может зависеть от других ответов: под НСП стоит своя ставка для
  // услуг и своя для торговли, и считает её реестр, а не этот компонент.
  const hint = field.hintFor?.(data) ?? field.hint

  // Переход «Исправить» со сводки: поле должно оказаться на виду и под курсором,
  // иначе на длинном шаге человек не понимает, куда его отправили.
  useEffect(() => {
    if (focusFieldId !== field.id) return
    const control = controlRef.current
    if (!control) return
    control.scrollIntoView({ block: 'center', behavior: 'smooth' })
    control.focus({ preventScroll: true })
  }, [focusFieldId, field.id])

  if (field.kind === 'custom') {
    return (
      <div className="ob-field" style={{ '--span': field.span } as CSSProperties}>
        {renderCustom?.(field)}
      </div>
    )
  }

  const commit = (raw: string) => {
    const next = field.normalize ? field.normalize(raw) : raw
    // От предыдущего значения, а не от пропса `data`: две правки в одном кадре
    // иначе прочитали бы одно и то же состояние, и вторая затёрла бы первую.
    onChange((previous) => writeField(previous, field, next))
  }

  if (field.kind === 'toggle') {
    const checked = value === 'true'
    return (
      <label
        className={`ob-field ob-toggle${checked ? ' is-on' : ''}`}
        style={{ '--span': field.span } as CSSProperties}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => commit(String(event.target.checked))}
        />
        <span className="ob-toggle__text">
          <strong>{field.label}</strong>
          {hint && <small>{hint}</small>}
        </span>
      </label>
    )
  }

  return (
    <label className="ob-field" style={{ '--span': field.span } as CSSProperties}>
      <span className="ob-label">
        {field.label}
        {field.required && <b aria-hidden="true"> *</b>}
      </span>

      {field.kind === 'select' ? (
        <select
          ref={(element) => {
            controlRef.current = element
          }}
          className={`ob-control${error ? ' is-invalid' : ''}`}
          value={value}
          onChange={(event) => commit(event.target.value)}
        >
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.kind === 'readonly' ? (
        <output className="ob-control ob-control--readonly">{value || '—'}</output>
      ) : field.kind === 'phone' ? (
        <PhoneInput
          value={value}
          invalid={!!error}
          placeholder={field.placeholder}
          onChange={commit}
          inputRef={(element) => {
            controlRef.current = element
          }}
        />
      ) : (
        <input
          ref={(element) => {
            controlRef.current = element
          }}
          className={`ob-control${error ? ' is-invalid' : ''}`}
          type={field.kind === 'email' ? 'email' : field.kind === 'tel' ? 'tel' : 'text'}
          inputMode={field.kind === 'digits' || field.kind === 'decimal' ? 'decimal' : undefined}
          value={value}
          readOnly={locked}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => commit(event.target.value)}
        />
      )}

      {error ? (
        <small className="ob-hint is-invalid">{error}</small>
      ) : locked ? (
        <small className="ob-hint is-locked">Считано с кассы</small>
      ) : hint ? (
        <small className="ob-hint">{hint}</small>
      ) : null}
    </label>
  )
}
