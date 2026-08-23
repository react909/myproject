/**
 * Ряд разделов панели — в ДВА ряда, листающихся как единая сетка.
 *
 * Пришёл на смену `PanelFilterRail`, который был в один ряд и жил в шапке
 * приложения. Оба свойства пришлось поменять, и вот почему.
 *
 * ДВА РЯДА, А НЕ ОДИН. Разделов шесть и будет больше. В один ряд они
 * помещаются только на широком экране, а на моноблоке половина уезжает за край,
 * и о её существовании узнают случайно.
 *
 * ЕДИНАЯ СЕТКА, А НЕ ДВА РЯДА РЯДОМ. Ряды обязаны листаться синхронно, и это
 * не свойство, которое надо поддерживать кодом, а следствие устройства: сетка
 * ОДНА, `grid-auto-flow: column` с двумя строками, и прокручивается она одна.
 * Двумя отдельными рядами с общим обработчиком прокрутки это было бы вечной
 * борьбой за то, чтобы они не разъезжались.
 *
 * НЕ В ШАПКЕ. Шапка приложения — 72 px, и два ряда кнопок в неё не влезают
 * никакими отступами: только надписи в две строки дают под 90 px. Ряд переехал
 * наверх страницы панели, где место есть. Шапка раздела при этом липкой не
 * стала — она осталась в прокручиваемой части, под рядом.
 *
 * ВИД. Прямоугольные кнопки со скруглением 5 px, плоская заливка, граница в
 * один пиксель, никаких теней и градиентов. Акцент — только на активном разделе
 * и на рамке фокуса клавиатуры; всё остальное нейтральное.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { PANEL_SECTIONS } from './panelSections'
import type { PanelSectionId } from './panelSections'
import './PanelSectionRail.css'

/**
 * Насколько палец должен уехать, чтобы это считалось листанием, а не нажатием.
 *
 * Четыре пикселя: на сенсорном экране палец смещается на один-два даже при
 * обычном нажатии. Тот же порог, что у переносимой кнопки клавиатуры, и по той
 * же причине.
 */
const DRAG_THRESHOLD_PX = 4

/** Сколько строк в сетке. Меняется вместе с --psr-rows в CSS. */
const ROWS = 2

type Props = {
  active: PanelSectionId
  onSelect: (id: PanelSectionId) => void
}

export function PanelSectionRail({ active, onSelect }: Props) {
  const railRef = useRef<HTMLDivElement | null>(null)
  /** Доля прокрутки: слева, ширина видимого окна. Для индикатора и затуханий. */
  const [view, setView] = useState({ start: 0, size: 1, scrollable: false })

  /**
   * Какая кнопка под фокусом клавиатуры.
   *
   * Отдельно от активного раздела, и это не усложнение. Стрелки ВОДЯТ по ряду,
   * Enter ОТКРЫВАЕТ — так написано в требованиях к клавиатуре. Если бы стрелка
   * сразу открывала раздел, проход по ряду из шести пунктов означал бы шесть
   * загрузок данных, из которых нужна одна.
   */
  const [focused, setFocused] = useState<number>(() =>
    Math.max(0, PANEL_SECTIONS.findIndex((section) => section.id === active)),
  )

  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([])

  /**
   * Пересчёт долей прокрутки.
   *
   * Через состояние, а не прямой записью в стиль: величин две, они меняются
   * редко (только при прокрутке ряда) и читаются тремя элементами сразу.
   * Прокрутка ряда — не покадровое движение вроде переноса кнопки, и городить
   * ради неё обход React незачем.
   */
  const measure = useCallback(() => {
    const rail = railRef.current
    if (!rail) return
    const { scrollLeft, scrollWidth, clientWidth } = rail
    const scrollable = scrollWidth - clientWidth > 1
    setView({
      start: scrollable ? scrollLeft / scrollWidth : 0,
      size: scrollable ? clientWidth / scrollWidth : 1,
      scrollable,
    })
  }, [])

  useEffect(() => {
    measure()
    const rail = railRef.current
    if (!rail) return undefined
    // ResizeObserver, а не слушатель окна: ряд меняет ширину и когда окно не
    // трогали — например, когда рядом появляется полоса прокрутки таблицы.
    const observer = new ResizeObserver(measure)
    observer.observe(rail)
    return () => observer.disconnect()
  }, [measure])

  /**
   * Колесо мыши листает сетку вбок.
   *
   * У обычной мыши есть только вертикальное колесо, и без этого ряд ей не
   * пролистать вовсе — оставалось бы только тащить. `deltaX` при этом не
   * игнорируем: у трекпада и у мыши с горизонтальным колесом он свой.
   */
  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const rail = railRef.current
    if (!rail) return
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (delta === 0) return
    rail.scrollLeft += delta
  }, [])

  /* Перетаскивание мышью и пальцем. Указательные события — один код на оба. */
  const dragRef = useRef<{ x: number; scroll: number; moved: boolean } | null>(null)

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    /*
      Палец НЕ ПЕРЕХВАТЫВАЕТСЯ — им листает сам браузер.

      Сначала здесь был свой перенос на все виды указателя, и на сенсорном
      моноблоке он выходил хуже родного: у Chromium есть инерция, отскок у
      краёв и остановка пальцем на лету, а самодельный перенос давал жёсткое
      «доехал и встал». Писать это заново значит воспроизводить то, что уже
      есть в системе, — и хуже.

      Мышью браузер горизонтальную область не листает вовсе, поэтому для неё
      перенос остаётся. Отсюда и `touch-action: pan-x` в стилях: сенсор
      обрабатывает браузер, мышь — мы.
    */
    if (event.pointerType === 'touch') return
    const rail = railRef.current
    if (!rail) return
    dragRef.current = { x: event.clientX, scroll: rail.scrollLeft, moved: false }
  }, [])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const rail = railRef.current
    if (!drag || !rail) return
    const shift = event.clientX - drag.x
    if (!drag.moved) {
      if (Math.abs(shift) < DRAG_THRESHOLD_PX) return
      drag.moved = true
      // Захват указателя: палец может уехать за пределы ряда, и без этого
      // листание обрывалось бы на первом же быстром движении.
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    rail.scrollLeft = drag.scroll - shift
  }, [])

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    // Сетку пролистали — нажатие на кнопку под пальцем не засчитываем. Иначе
    // каждое листание меняло бы раздел.
    if (drag?.moved) {
      const guard = (blocked: Event) => {
        blocked.preventDefault()
        blocked.stopPropagation()
      }
      const node = event.currentTarget
      node.addEventListener('click', guard, { capture: true, once: true })
      // Страховка: если клика так и не случилось, слушатель снимется сам.
      window.setTimeout(() => node.removeEventListener('click', guard, { capture: true }), 0)
    }
  }, [])

  /** Подвести кнопку в видимую часть — её могло унести за край. */
  const reveal = useCallback((index: number) => {
    const node = buttonsRef.current[index]
    node?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [])

  /* Выбранный раздел подъезжает в видимую часть при смене снаружи. */
  useEffect(() => {
    const index = PANEL_SECTIONS.findIndex((section) => section.id === active)
    if (index < 0) return
    setFocused(index)
    reveal(index)
  }, [active, reveal])

  /**
   * Клавиатура.
   *
   * Раскладка «змейкой» по столбцам: разделы 0 и 1 — первый столбец, 2 и 3 —
   * второй. Поэтому влево-вправо это шаг на ЦЕЛЫЙ СТОЛБЕЦ (±2), а вверх-вниз —
   * переход между рядами (±1). Считать иначе значило бы, что стрелка вправо
   * уводит кнопку на строку ниже — то есть не туда, куда показывает стрелка.
   */
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const last = PANEL_SECTIONS.length - 1
      const move = (next: number) => {
        const clamped = Math.max(0, Math.min(last, next))
        setFocused(clamped)
        reveal(clamped)
        buttonsRef.current[clamped]?.focus()
        event.preventDefault()
      }

      switch (event.key) {
        case 'ArrowRight':
          return move(focused + ROWS)
        case 'ArrowLeft':
          return move(focused - ROWS)
        case 'ArrowDown':
          // Внутри столбца: из верхнего ряда в нижний.
          return move(focused % ROWS === ROWS - 1 ? focused : focused + 1)
        case 'ArrowUp':
          return move(focused % ROWS === 0 ? focused : focused - 1)
        case 'Home':
          return move(0)
        case 'End':
          return move(last)
        case 'Enter':
        case ' ':
          event.preventDefault()
          return onSelect(PANEL_SECTIONS[focused].id)
        default:
      }
    },
    [focused, onSelect, reveal],
  )

  const fadeStart = view.scrollable && view.start > 0.002
  const fadeEnd = view.scrollable && view.start + view.size < 0.998

  const railClass = useMemo(
    () =>
      `psr__grid${fadeStart ? ' psr__grid--fade-start' : ''}${
        fadeEnd ? ' psr__grid--fade-end' : ''
      }`,
    [fadeStart, fadeEnd],
  )

  return (
    <div className="psr">
      <div
        ref={railRef}
        className={railClass}
        role="tablist"
        aria-label="Разделы панели"
        aria-orientation="horizontal"
        onScroll={measure}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        {PANEL_SECTIONS.map((section, index) => {
          const selected = section.id === active
          const Icon = section.icon
          return (
            <button
              key={section.id}
              ref={(node) => {
                buttonsRef.current[index] = node
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              /* Блуждающий tabindex: в ряд входят одним Tab, дальше ведут
                 стрелки. Шесть табов подряд ради шести кнопок — это как раз то,
                 из-за чего работу с клавиатуры бросают. */
              tabIndex={index === focused ? 0 : -1}
              className={`psr__btn${selected ? ' psr__btn--on' : ''}`}
              onFocus={() => setFocused(index)}
              onClick={() => onSelect(section.id)}
            >
              {/*
                Только значок и короткое название, БЕЗ второй строки-подписи.

                Подписи были — и из-за них два ряда не помещались в шапку
                высотой 72 px: с ними кнопка выходит под 45 px, два ряда под
                95. Подробное описание раздела уехало в заголовок страницы,
                где место есть и где его читают внимательно, а не краем глаза.
              */}
              <Icon className="psr__icon" />
              <span className="psr__label">{section.label}</span>
            </button>
          )
        })}
      </div>

      {/* Полоса-указатель положения. Только когда есть что листать: под
          коротким рядом она сообщала бы о прокрутке, которой нет. */}
      <div className={`psr__bar${view.scrollable ? '' : ' psr__bar--idle'}`} aria-hidden="true">
        <i
          className="psr__bar-thumb"
          style={{
            // transform, а не left/width: движение считает композитор, и
            // раскладка на каждое движение пальца не пересчитывается.
            transform: `translateX(${view.start * 100}%) scaleX(${view.size})`,
          }}
        />
      </div>
    </div>
  )
}
