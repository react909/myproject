/**
 * Виртуализация списка строк одинаковой высоты.
 *
 * Своя, а не библиотечная: задача узкая — таблица чеков со строками равной
 * высоты, — и весь расчёт умещается в тридцать строк. Тянуть ради этого
 * зависимость на десятки килобайт незачем, тем более что в проекте нет ни
 * одного UI-кита и заводить первый ради одного списка не стоит.
 *
 * Что даёт: в разметке живут только видимые строки плюс небольшой запас сверху
 * и снизу. Тысяча чеков в DOM — это тысяча узлов таблицы, каждый со своими
 * стилями; браузер честно раскладывает их все, и прокрутка начинает
 * подтормаживать задолго до того, как список кончится.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Сколько строк рисуется за пределами видимой области, сверху и снизу.
 *
 * Шесть: при быстрой прокрутке пальцем экран успевает уехать на несколько
 * строк раньше, чем React перерисует список, и без запаса на границе мелькала
 * бы пустота. Больше держать незачем — это уже узлы, которых никто не видит.
 */
const OVERSCAN = 6

export type VirtualWindow = {
  /** Индекс первой отрисовываемой строки. */
  start: number
  /** Индекс за последней отрисовываемой строкой. */
  end: number
  /** Высота всего списка — держит полосу прокрутки на своём месте. */
  totalHeight: number
  /** Смещение первой отрисованной строки от начала списка. */
  offsetTop: number
}

/**
 * Окно видимых строк.
 *
 * `rowHeight` обязан совпадать с высотой строки в CSS. Расхождение проявляется
 * как «список едет не туда» при быстрой прокрутке, поэтому высота задана
 * токеном и в CSS, и здесь одним значением — см. PanelJournal.css.
 */
export function useVirtualRows(
  count: number,
  rowHeight: number,
): { scrollRef: (node: HTMLElement | null) => void; window: VirtualWindow } {
  const nodeRef = useRef<HTMLElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)

  const scrollRef = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node
    if (node) setViewport(node.clientHeight)
  }, [])

  useEffect(() => {
    const node = nodeRef.current
    if (!node) return undefined

    /*
      Прокрутка читается в кадре отрисовки, а не на каждое событие.

      События прокрутки приходят чаще, чем экран успевает перерисоваться, и
      setState на каждое из них давал бы несколько лишних отрисовок на кадр.
      Флаг-«уже запланировано» гасит их до одной.
    */
    let scheduled = false
    const onScroll = () => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        setScrollTop(node.scrollTop)
      })
    }

    node.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(() => setViewport(node.clientHeight))
    observer.observe(node)
    return () => {
      node.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [])

  const window_ = useMemo<VirtualWindow>(() => {
    const visible = Math.ceil((viewport || 0) / rowHeight)
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN)
    const last = Math.min(count, first + visible + OVERSCAN * 2)
    return {
      start: first,
      end: last,
      totalHeight: count * rowHeight,
      offsetTop: first * rowHeight,
    }
  }, [count, rowHeight, scrollTop, viewport])

  return { scrollRef, window: window_ }
}
