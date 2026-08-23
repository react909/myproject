/**
 * Экранная клавиатура для ввода ключа.
 *
 * Встроена прямо в окно диалога, а не вызывает системную. Причина простая: на
 * кассовом моноблоке физической клавиатуры нет, а системная клавиатура Windows
 * открывается поверх окна, перекрывает поле ввода и на части сборок вовсе не
 * поднимается в полноэкранном режиме. Полагаться на неё в единственном пути к
 * настройкам нельзя.
 *
 * Раскладки берутся из общего модуля (virtual-keyboard/layouts) — те же, что у
 * плавающей клавиатуры. Пока набор был свой, здесь были только латиница и
 * цифры: ключ с русской буквой на моноблоке было не набрать вовсе.
 *
 * Клавиши крупные (минимум 44×44) — по ним попадают пальцем, часто в перчатке.
 */

import { useState } from 'react'
import {
  DIGITS_ROW,
  LAYOUT_LABELS,
  nextLayout,
  rowsFor,
} from '../virtual-keyboard/layouts'
import type { KeyboardLayout } from '../virtual-keyboard/layouts'
import './AccessKeypad.css'

type Props = {
  /** Верхний регистр залипает: ключи часто записывают заглавными. */
  shift: boolean
  onShiftChange: (value: boolean) => void
  onKey: (character: string) => void
  onBackspace: () => void
  onClear: () => void
  reveal: boolean
  onRevealChange: (value: boolean) => void
  /**
   * Есть ли что скрывать. У лицензионного ключа переключателя нет: он и так
   * виден — его читают с наклейки и сверяют символ за символом, — а мёртвая
   * кнопка «Показать» рядом с уже видимым полем сбивает с толку.
   */
  revealable: boolean
  onCancel: () => void
  /** ⏎ — отправить набранное, не дожидаясь паузы. */
  onSubmit: () => void
  /** Набранного уже хватает на проверку: ⏎ активен. */
  canSubmit: boolean
  /** Проверка идёт — на ⏎ крутится индикатор. */
  busy: boolean
  /**
   * С какой раскладки начинать.
   *
   * Не мелочь. Лицензионный ключ состоит из латиницы и цифр, и маска
   * выбрасывает всё остальное. Пока клавиатура открывалась на русской, набор
   * ключа не работал вовсе: человек нажимал буквы, а поле оставалось пустым —
   * со стороны это выглядело как «сюда нельзя написать».
   */
  initialLayout?: KeyboardLayout
}

/*
 * Кнопки «Войти» здесь нет и не будет: вход происходит сам, как только
 * набранное похоже на законченный секрет (см. AccessDialog).
 *
 * ⏎ — не она. Это обычная клавиша обычной клавиатуры, такая же, как Enter на
 * физической: она ничего не решает, а только избавляет от ожидания паузы для
 * тех, кто уже дописал. Без неё на моноблоке, где физической клавиатуры нет,
 * сказать «я закончил» было нечем — оставалось ждать.
 */

export function AccessKeypad({
  shift,
  onShiftChange,
  onKey,
  onBackspace,
  onClear,
  reveal,
  onRevealChange,
  revealable,
  onCancel,
  onSubmit,
  canSubmit,
  busy,
  initialLayout = 'russian',
}: Props) {
  // Раскладку задаёт вызывающий: у пароля владельца русская уместна, у
  // лицензионного ключа — только латиница, иначе набирать его нечем.
  const [layout, setLayout] = useState<KeyboardLayout>(initialLayout)
  const rows = rowsFor(layout, shift)
  // У символов верхнего регистра нет — переключать там нечего.
  const shiftable = layout === 'russian' || layout === 'english'

  return (
    <div className="akb" role="group" aria-label="Экранная клавиатура">
      <div className="akb__row">
        {DIGITS_ROW.map((digit) => (
          <button key={digit} type="button" className="akb__key" onClick={() => onKey(digit)}>
            {digit}
          </button>
        ))}
      </div>

      {rows.map((row, index) => (
        <div key={`${layout}-${index}`} className="akb__row">
          {index === rows.length - 1 && (
            <button
              type="button"
              className={`akb__key akb__key--wide${shift ? ' is-active' : ''}`}
              onClick={() => onShiftChange(!shift)}
              disabled={!shiftable}
              aria-pressed={shift}
              aria-label="Верхний регистр"
            >
              ⇧
            </button>
          )}
          {row.map((value) => (
            <button
              key={value}
              type="button"
              className="akb__key"
              onClick={() => onKey(value)}
            >
              {value}
            </button>
          ))}
          {index === rows.length - 1 && (
            <button
              type="button"
              className="akb__key akb__key--wide"
              onClick={onBackspace}
              aria-label="Стереть символ"
            >
              ⌫
            </button>
          )}
        </div>
      ))}

      <div className="akb__row akb__row--actions">
        {/* Переключатель раскладки: русская → латиница → символы → ещё символы.
            Подпись показывает текущую, а не следующую: так понятнее, что ты
            сейчас набираешь. */}
        <button
          type="button"
          className="akb__action akb__action--layout"
          onClick={() => {
            setLayout(nextLayout(layout))
            onShiftChange(false)
          }}
          aria-label="Сменить раскладку"
        >
          {LAYOUT_LABELS[layout]}
        </button>
        {/*
          Клавиши пробела здесь нет намеренно.

          Пробел в поле, где вместо символов кружки, — ловушка: он ничем не
          отличается от буквы на вид, а промах по нему замечают только когда
          секрет не подошёл. В самих секретах его при этом не бывает: ключ
          установки состоит из букв и цифр, а пароль владельца задают в мастере,
          где по нему точно так же нечем отличить пробел от опечатки.

          Набрать пробел всё же можно — с физической клавиатуры, если он
          действительно есть в старом пароле. Отсюда убрана только клавиша,
          сам символ поле принимает.
        */}
        <button type="button" className="akb__action" onClick={onClear}>
          Очистить
        </button>
        {revealable && (
          <button
            type="button"
            className="akb__action"
            onClick={() => onRevealChange(!reveal)}
            aria-pressed={reveal}
          >
            {reveal ? 'Скрыть' : 'Показать'}
          </button>
        )}
        <button type="button" className="akb__action akb__action--cancel" onClick={onCancel}>
          Отмена
        </button>
        {/* ⏎ последним и заметным: это конец набора, и глаз ищет его справа —
            там же, где он стоит на любой клавиатуре. */}
        <button
          type="button"
          className={`akb__action akb__action--enter${busy ? ' is-busy' : ''}`}
          onClick={onSubmit}
          disabled={!canSubmit || busy}
          aria-label={busy ? 'Проверяем' : 'Готово, проверить'}
        >
          {busy ? <span className="akb__spinner" aria-hidden="true" /> : '⏎'}
        </button>
      </div>
    </div>
  )
}
