/**
 * Живые числа кассы для общей шапки.
 *
 * Шапка одна на все страницы, но вес на весах, сумма к оплате и состояние
 * смены есть только на самой кассе. Тащить их через пропсы каждого экрана
 * нельзя — экраны о них ничего не знают и знать не должны, — поэтому касса
 * публикует их отсюда, а шапка читает.
 *
 * Направление важно: не шапка спрашивает у страницы, а страница отдаёт шапке.
 * Иначе шапка знала бы про каждый экран приложения поимённо.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

/** Что касса показывает в середине шапки и в плашке кассира. */
export type HeaderShowcase = {
  scaleEnabled: boolean
  /** Живой вес, кг. null — весов нет или на них ничего не лежит. */
  scaleDisplayKg: number | null
  /** Вес устоялся — можно нажать «Зафиксировать». */
  scaleWeightStable: boolean
  onFixScaleWeight: () => void
  totalRub: number
  salesCount: number
  shiftOpen: boolean
  shiftRevenue: number
}

/**
 * Приёмник значений. Пустая функция по умолчанию — чтобы страница, отрисованная
 * вне каркаса (в тестах или в предпросмотре), не падала, а просто ничего не
 * публиковала.
 */
export const HeaderShowcaseSink = createContext<(value: HeaderShowcase | null) => void>(() => {})

/**
 * Публикует значения в шапку и снимает их при уходе со страницы.
 *
 * `value` обязан быть стабильным между отрисовками, пока числа не изменились
 * (useMemo по самим числам). Свежий объект на каждой отрисовке загнал бы это в
 * бесконечный круг: публикация меняет состояние каркаса, каркас перерисовывает
 * страницу, страница публикует снова.
 */
export function usePublishHeaderShowcase(value: HeaderShowcase): void {
  const publish = useContext(HeaderShowcaseSink)
  useEffect(() => {
    publish(value)
    // Уходя со страницы, убираем числа: чужая сумма к оплате в шапке настроек
    // — это не «пусто», это неверные данные.
    return () => publish(null)
  }, [publish, value])
}

/**
 * Одинаковы ли числа. Обработчик сюда не входит — он живёт в ссылке.
 *
 * Экспортируется ради теста: это и есть предохранитель от вечной перерисовки,
 * и проверять его надо отдельно от React.
 */
export function showcaseNumbersEqual(
  a: HeaderShowcase | null,
  b: HeaderShowcase | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.scaleEnabled === b.scaleEnabled &&
    a.scaleDisplayKg === b.scaleDisplayKg &&
    a.scaleWeightStable === b.scaleWeightStable &&
    a.totalRub === b.totalRub &&
    a.salesCount === b.salesCount &&
    a.shiftOpen === b.shiftOpen &&
    a.shiftRevenue === b.shiftRevenue
  )
}

/**
 * Хранилище значений на стороне каркаса.
 *
 * Устроено так, что вечная перерисовка здесь невозможна в принципе, а не
 * «пока страницы аккуратно мемоизируют». Касса — экран, который не имеет права
 * зависнуть посреди продажи, и одного неудачного `useCallback` на другом конце
 * приложения для этого хватило бы: публикация меняет состояние каркаса, каркас
 * перерисовывает страницу, страница публикует снова.
 *
 * Отсюда два решения. Числа сравниваются по значению, и при совпадении
 * состояние не трогается вовсе — React в этом случае обрывает круг сам.
 * Обработчик кнопки сравнивать по значению нельзя, поэтому он живёт в ссылке:
 * шапке уходит стабильная обёртка, а зовёт она всегда свежий обработчик.
 */
export function useHeaderShowcaseState(): {
  showcase: HeaderShowcase | null
  publish: (value: HeaderShowcase | null) => void
} {
  const [numbers, setNumbers] = useState<HeaderShowcase | null>(null)
  const latestHandler = useRef<() => void>(() => {})

  const publish = useCallback((value: HeaderShowcase | null) => {
    latestHandler.current = value?.onFixScaleWeight ?? (() => {})
    setNumbers((prev) => (showcaseNumbersEqual(prev, value) ? prev : value))
  }, [])

  const showcase = useMemo(
    () => (numbers ? { ...numbers, onFixScaleWeight: () => latestHandler.current() } : null),
    [numbers],
  )

  return { showcase, publish }
}
