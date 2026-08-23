/**
 * Поле телефона с маской `+996 XXX XXX XXX`.
 *
 * Один компонент на все экраны, где спрашивают телефон магазина: он рисуется
 * движком формы по реестру полей (kind: 'phone'), поэтому и мастер первого
 * запуска, и раздел реквизитов в настройках получают одну и ту же маску без
 * копирования разметки.
 *
 * Что делает маска, кроме пробелов:
 *  — не даёт ввести больше девяти цифр после кода страны;
 *  — приводит вставку из буфера к одному виду: 0555123456, 996555123456 и
 *    «+996 555 12-34-56» дают один и тот же номер;
 *  — держит курсор на месте при правке середины номера;
 *  — не даёт стереть код страны.
 */

import { useLayoutEffect, useRef } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import {
  PHONE_COUNTRY_CODE,
  caretAfterDigits,
  digitsBefore,
  formatPhoneInput,
  phoneValue,
} from './phone'

type Props = {
  /** Каноничное значение из данных: `+996XXXXXXXXX` или пусто. */
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  placeholder?: string
  inputRef?: (element: HTMLInputElement | null) => void
}

/** Длина неудаляемой части: «+996 ». */
const PREFIX_LENGTH = PHONE_COUNTRY_CODE.length + 2

export function PhoneInput({ value, onChange, invalid = false, placeholder, inputRef }: Props) {
  const elementRef = useRef<HTMLInputElement | null>(null)
  /* Куда вернуть курсор после перерисовки. Маска переписывает строку целиком,
     и без этого курсор уезжал бы в конец на каждой набранной цифре. */
  const caretRef = useRef<number | null>(null)

  const display = formatPhoneInput(value)

  useLayoutEffect(() => {
    const element = elementRef.current
    if (!element || caretRef.current === null) return
    const position = Math.min(caretRef.current, element.value.length)
    element.setSelectionRange(position, position)
    caretRef.current = null
  })

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value
    const caret = event.target.selectionStart ?? raw.length
    // Цифры кода страны в счёт не идут: курсор считается по национальной части.
    const typed = Math.max(0, digitsBefore(raw, caret) - PHONE_COUNTRY_CODE.length)
    caretRef.current = caretAfterDigits(typed)
    onChange(phoneValue(raw))
  }

  /**
   * Backspace через пробел.
   *
   * Пробелы ставит маска, и удаление пробела не меняет ни одной цифры: строка
   * перерисовывается прежней, и человек видит, что клавиша «не работает».
   * Поэтому перед удалением переносим курсор за ближайшую цифру. Заодно
   * запрещаем стирать код страны.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const element = event.currentTarget
    const start = element.selectionStart ?? 0
    const end = element.selectionEnd ?? 0
    if (event.key !== 'Backspace' || start !== end) return
    if (start <= PREFIX_LENGTH) {
      // Внутри «+996 » стирать нечего.
      event.preventDefault()
      return
    }
    if (!/\d/.test(element.value[start - 1] ?? '')) {
      event.preventDefault()
      const target = start - 1
      element.setSelectionRange(target, target)
    }
  }

  return (
    <input
      ref={(element) => {
        elementRef.current = element
        inputRef?.(element)
      }}
      className={`ob-control${invalid ? ' is-invalid' : ''}`}
      type="tel"
      inputMode="tel"
      autoComplete="off"
      spellCheck={false}
      value={display}
      placeholder={placeholder}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      /* Клик по коду страны ставит курсор в начало, и следующая цифра ушла бы
         перед кодом. Возвращаем курсор за него. */
      onFocus={(event) => {
        if ((event.currentTarget.selectionStart ?? 0) < PREFIX_LENGTH) {
          event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)
        }
      }}
      onClick={(event) => {
        const element = event.currentTarget
        if ((element.selectionStart ?? 0) < PREFIX_LENGTH) {
          element.setSelectionRange(PREFIX_LENGTH, PREFIX_LENGTH)
        }
      }}
    />
  )
}
