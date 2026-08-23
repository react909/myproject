/**
 * Ходьба стрелками по полям формы.
 *
 * ПО ГЕОМЕТРИИ, А НЕ ПО ПОРЯДКУ В РАЗМЕТКЕ. Это главное решение здесь, и вот
 * почему. Форма товара разложена в несколько колонок: «Количество» и «Единица»
 * стоят рядом, три цены — в одну строку. В порядке разметки следующее поле
 * после «Количества» — это «Единица», то есть СПРАВА. Нажав стрелку вниз,
 * человек попал бы вправо, и работа с клавиатуры сразу перестала бы быть
 * предсказуемой.
 *
 * Поэтому направление считается по экранным координатам: вниз — ближайшее поле
 * ниже с наибольшим перекрытием по горизонтали, вправо — ближайшее правее в
 * той же строке. Ровно то, что человек видит.
 *
 * Влево и вправо срабатывают ТОЛЬКО НА КРАЮ ТЕКСТА. Внутри поля стрелка
 * двигает курсор по символам — иначе нельзя поправить середину названия, и
 * форма становится непригодной для правки.
 */

import { useCallback } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

/** Поля помечаются этим атрибутом. Скрытые в разметке не считаются. */
const FIELD_SELECTOR = '[data-field]:not([disabled])'

type Rect = { node: HTMLElement; left: number; right: number; top: number; bottom: number }

function visibleFields(root: HTMLElement): Rect[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FIELD_SELECTOR))
    .filter((node) => node.offsetParent !== null)
    .map((node) => {
      const box = node.getBoundingClientRect()
      return {
        node,
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      }
    })
}

/** Насколько два отрезка перекрываются. Ноль — не перекрываются вовсе. */
function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

function pick(current: Rect, others: Rect[], direction: 'up' | 'down' | 'left' | 'right'): HTMLElement | null {
  const vertical = direction === 'up' || direction === 'down'
  let best: { node: HTMLElement; distance: number; cross: number } | null = null

  for (const other of others) {
    if (other.node === current.node) continue

    if (vertical) {
      // Строго выше или строго ниже: поле в той же строке не считается
      // «выше», даже если его край на пиксель другой.
      const isBelow = other.top >= current.bottom - 2
      const isAbove = other.bottom <= current.top + 2
      if (direction === 'down' ? !isBelow : !isAbove) continue
      const distance = direction === 'down' ? other.top - current.bottom : current.top - other.bottom
      const cross = overlap(current.left, current.right, other.left, other.right)
      // Сначала ближайшая строка, внутри неё — наибольшее перекрытие по
      // горизонтали: так стрелка вниз попадает в поле ПОД текущим, а не в
      // первое поле следующей строки.
      if (
        best === null ||
        distance < best.distance - 2 ||
        (Math.abs(distance - best.distance) <= 2 && cross > best.cross)
      ) {
        best = { node: other.node, distance, cross }
      }
    } else {
      const sameRow = overlap(current.top, current.bottom, other.top, other.bottom) > 4
      if (!sameRow) continue
      const isRight = other.left >= current.right - 2
      const isLeft = other.right <= current.left + 2
      if (direction === 'right' ? !isRight : !isLeft) continue
      const distance = direction === 'right' ? other.left - current.right : current.left - other.right
      if (best === null || distance < best.distance) {
        best = { node: other.node, distance, cross: 0 }
      }
    }
  }
  return best?.node ?? null
}

/** Стоит ли курсор на краю текста — только тогда стрелка уходит из поля. */
function atEdge(node: HTMLElement, side: 'start' | 'end'): boolean {
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
    // У полей без текстового курсора (дата, число, флажок) `selectionStart`
    // недоступен — в них стрелка и так ничего не двигает по символам.
    let position: number | null = null
    try {
      position = node.selectionStart
    } catch {
      return true
    }
    if (position === null) return true
    if (node.selectionStart !== node.selectionEnd) return false
    return side === 'start' ? position === 0 : position === node.value.length
  }
  return true
}

export function useFieldKeyboard(rootRef: RefObject<HTMLElement | null>) {
  return useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const root = rootRef.current
      if (!root) return
      const active = document.activeElement
      if (!(active instanceof HTMLElement) || !root.contains(active)) return
      if (!active.matches(FIELD_SELECTOR)) return

      // Выпадающий список сам обрабатывает стрелки: в нём ими выбирают
      // значение, и отбирать их нельзя.
      if (active instanceof HTMLSelectElement && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        return
      }

      let direction: 'up' | 'down' | 'left' | 'right' | null = null
      if (event.key === 'ArrowDown') direction = 'down'
      else if (event.key === 'ArrowUp') direction = 'up'
      else if (event.key === 'ArrowRight' && atEdge(active, 'end')) direction = 'right'
      else if (event.key === 'ArrowLeft' && atEdge(active, 'start')) direction = 'left'
      if (!direction) return

      const fields = visibleFields(root)
      const current = fields.find((item) => item.node === active)
      if (!current) return
      const next = pick(current, fields, direction)
      if (!next) return

      event.preventDefault()
      next.focus()
      if (next instanceof HTMLInputElement && next.type !== 'checkbox') {
        // Выделяем содержимое: следующее нажатие цифры заменит значение, а не
        // допишет к нему. При вводе пачки товаров это экономит по нажатию на
        // каждое поле.
        try {
          next.select()
        } catch {
          /* у некоторых типов полей выделения нет — не беда */
        }
      }
    },
    [rootRef],
  )
}
