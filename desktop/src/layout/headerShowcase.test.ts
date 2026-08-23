/**
 * Предохранитель от вечной перерисовки шапки.
 *
 * Касса публикует свои числа в общую шапку, шапка держит их в состоянии
 * каркаса. Если публикация с теми же числами каждый раз считалась бы новой,
 * получился бы замкнутый круг: состояние каркаса меняется, каркас
 * перерисовывает кассу, касса публикует снова. На кассе это зависание посреди
 * продажи, поэтому сравнение проверяется отдельно от React.
 *
 * Обработчик кнопки в сравнение не входит намеренно: он приезжает новой
 * функцией на каждой отрисовке, и по нему круг не разорвать никогда — он живёт
 * в ссылке, а шапке уходит стабильная обёртка.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { showcaseNumbersEqual } from './headerShowcase'
import type { HeaderShowcase } from './headerShowcase'

function showcase(patch: Partial<HeaderShowcase> = {}): HeaderShowcase {
  return {
    scaleEnabled: true,
    scaleDisplayKg: 1.234,
    scaleWeightStable: false,
    onFixScaleWeight: () => {},
    totalRub: 250,
    salesCount: 3,
    shiftOpen: true,
    shiftRevenue: 4200,
    ...patch,
  }
}

test('те же числа в новом объекте — это одно и то же', () => {
  assert.equal(showcaseNumbersEqual(showcase(), showcase()), true)
})

test('новый обработчик сам по себе не считается изменением', () => {
  const before = showcase({ onFixScaleWeight: () => {} })
  const after = showcase({ onFixScaleWeight: () => {} })
  assert.equal(showcaseNumbersEqual(before, after), true)
})

test('изменение любого числа замечается', () => {
  const cases: Partial<HeaderShowcase>[] = [
    { scaleEnabled: false },
    { scaleDisplayKg: 1.235 },
    { scaleDisplayKg: null },
    { scaleWeightStable: true },
    { totalRub: 251 },
    { salesCount: 4 },
    { shiftOpen: false },
    { shiftRevenue: 4201 },
  ]
  for (const patch of cases) {
    assert.equal(showcaseNumbersEqual(showcase(), showcase(patch)), false, JSON.stringify(patch))
  }
})

test('уход со страницы и возврат на неё — это изменение', () => {
  assert.equal(showcaseNumbersEqual(showcase(), null), false)
  assert.equal(showcaseNumbersEqual(null, showcase()), false)
  // Обе пустые — на соседней странице чисел кассы нет, и повторная очистка
  // не должна дёргать шапку.
  assert.equal(showcaseNumbersEqual(null, null), true)
})
