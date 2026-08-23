/**
 * Ходьба по строкам списка или таблицы с клавиатуры.
 *
 * Один хук на все три новых раздела, потому что правила везде одни и повторять
 * их трижды значило бы получить три чуть разных поведения: где-то PageDown
 * прыгает на десять строк, где-то на пятнадцать, а где-то не работает вовсе.
 *
 * Что делает:
 *
 *   ↑ / ↓            строка выше и ниже;
 *   Home / End       первая и последняя;
 *   PageUp / PageDown страница — столько строк, сколько видно;
 *   Enter            открыть выбранную;
 *   Esc              снять выбор (или то, что решит вызывающий).
 *
 * Чего НЕ делает: не listens на window. Слушатель на всё окно перехватывал бы
 * стрелки у полей ввода, у выпадающих списков и у соседнего раздела. События
 * приходят от контейнера, на котором висит `onKeyDown`, и работают только пока
 * фокус внутри него.
 *
 * Выбранная строка сама подкручивается в видимую область — иначе ходьба вниз
 * через двадцатую строку уводит выбор за край экрана, и человек ведёт его
 * вслепую.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

export type RowKeyboard = {
  /** Индекс выбранной строки. −1 — не выбрано ничего. */
  index: number
  setIndex: (next: number) => void
  /** Вешается на контейнер таблицы. */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
  /** Вешается на прокручиваемую область — по ней считается размер страницы. */
  scrollRef: RefObject<HTMLDivElement | null>
  /** Ставится атрибутом на строку: по нему её находит подкрутка. */
  rowProps: (position: number) => {
    'data-row': number
    'aria-selected': boolean
    className: string
  }
}

type Options = {
  /** Сколько строк всего. Меняется — выбор поджимается к последней. */
  count: number
  /** Enter по выбранной строке. */
  onEnter?: (index: number) => void
  /** Esc. Пусто — событие не перехватывается и уходит выше. */
  onEscape?: () => void
  /** Высота строки в пикселях: по ней считается шаг PageUp/PageDown. */
  rowHeight: number
  /** Класс выбранной строки — у каждой таблицы свой префикс. */
  selectedClass: string
  /** Базовый класс строки. */
  rowClass: string
}

export function useRowKeyboard({
  count,
  onEnter,
  onEscape,
  rowHeight,
  selectedClass,
  rowClass,
}: Options): RowKeyboard {
  const [index, setIndexRaw] = useState(-1)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  /*
    Выбор не должен пережить исчезновение строк.

    Сменили фильтр, список стал короче — выбранная двадцатая строка перестала
    существовать, но индекс остался, и Enter открыл бы то, чего нет. Поджимаем
    к последней; пустой список снимает выбор совсем.
  */
  useEffect(() => {
    setIndexRaw((current) => {
      if (count === 0) return -1
      if (current >= count) return count - 1
      return current
    })
  }, [count])

  /** Подкрутить строку в видимую область. */
  const reveal = useCallback((position: number) => {
    const scroll = scrollRef.current
    if (!scroll) return
    const row = scroll.querySelector<HTMLElement>(`[data-row="${position}"]`)
    // `block: 'nearest'` — строка подъезжает к ближайшему краю, а не
    // выпрыгивает в середину: при ходьбе вниз список должен ползти на строку,
    // а не прыгать на пол-экрана.
    row?.scrollIntoView({ block: 'nearest' })
  }, [])

  const setIndex = useCallback(
    (next: number) => {
      const clamped = count === 0 ? -1 : Math.max(0, Math.min(count - 1, next))
      setIndexRaw(clamped)
      if (clamped >= 0) {
        // Подкрутка после отрисовки: строки может ещё не быть в разметке —
        // список виртуализирован и рисует только видимое.
        window.requestAnimationFrame(() => reveal(clamped))
      }
    },
    [count, reveal],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (count === 0 && event.key !== 'Escape') return

      /*
        Стрелки не отбираются у полей ввода.

        Внутри таблицы бывают поля фильтров, и в них стрелка обязана двигать
        курсор по тексту, а не строку по списку. Проверяется цель события, а не
        флаг «мы в режиме ввода»: флаг рано или поздно разойдётся с тем, где
        на самом деле стоит фокус.
      */
      const target = event.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      if (typing && event.key !== 'Escape') return

      // Сколько строк помещается в видимую часть. Минимум одна: на крошечном
      // окне PageDown иначе не двигался бы вовсе.
      const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / rowHeight) - 1)

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          return setIndex(index < 0 ? 0 : index + 1)
        case 'ArrowUp':
          event.preventDefault()
          return setIndex(index < 0 ? 0 : index - 1)
        case 'PageDown':
          event.preventDefault()
          return setIndex(index < 0 ? 0 : index + page)
        case 'PageUp':
          event.preventDefault()
          return setIndex(index < 0 ? 0 : index - page)
        case 'Home':
          event.preventDefault()
          return setIndex(0)
        case 'End':
          event.preventDefault()
          return setIndex(count - 1)
        case 'Enter':
          if (index >= 0 && onEnter) {
            event.preventDefault()
            onEnter(index)
          }
          return
        case 'Escape':
          if (onEscape) {
            event.preventDefault()
            onEscape()
          }
          return
        default:
      }
    },
    [count, index, onEnter, onEscape, rowHeight, setIndex],
  )

  const rowProps = useCallback(
    (position: number) => ({
      'data-row': position,
      'aria-selected': position === index,
      className: `${rowClass}${position === index ? ` ${selectedClass}` : ''}`,
    }),
    [index, rowClass, selectedClass],
  )

  return { index, setIndex, onKeyDown, scrollRef, rowProps }
}
