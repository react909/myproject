/**
 * Состав шапки приложения по выбранной компоновке.
 *
 * Проверяется то, на чём эта часть ломается: шапка и редактор спрашивают состав
 * у одной функции, и стоит ей разойтись с настройкой — редактор просит файл,
 * который шапка уже не показывает, или наоборот. Отсюда и главный инвариант
 * ниже: единая картинка не соседствует ни со знаком, ни с надписью.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_ONBOARDING, HEADER_LAYOUTS, headerLayoutParts } from './types'
import type { HeaderLayout } from './types'

const ALL: HeaderLayout[] = HEADER_LAYOUTS.map((item) => item.id)

test('единая картинка заменяет собой знак и надпись, а не дополняет их', () => {
  const parts = headerLayoutParts('combined')
  assert.equal(parts.combined, true)
  assert.equal(parts.mark, false)
  assert.equal(parts.wordmark, false)
})

test('две картинки — только у строки и столбика', () => {
  for (const layout of ALL) {
    const parts = headerLayoutParts(layout)
    const both = parts.mark && parts.wordmark
    assert.equal(both, layout === 'mark_left' || layout === 'mark_top', layout)
  }
})

test('столбиком стоит только «знак сверху, надпись снизу»', () => {
  for (const layout of ALL) {
    assert.equal(headerLayoutParts(layout).stacked, layout === 'mark_top', layout)
  }
})

test('одиночные компоновки просят ровно одну картинку', () => {
  const mark = headerLayoutParts('mark')
  assert.deepEqual([mark.mark, mark.wordmark, mark.combined], [true, false, false])

  const wordmark = headerLayoutParts('wordmark')
  assert.deepEqual([wordmark.mark, wordmark.wordmark, wordmark.combined], [false, true, false])
})

test('пустых компоновок нет: шапка не может остаться без бренда вовсе', () => {
  for (const layout of ALL) {
    const parts = headerLayoutParts(layout)
    assert.ok(parts.mark || parts.wordmark || parts.combined, layout)
  }
})

test('по умолчанию — знак слева, надпись справа: так шапка выглядела и раньше', () => {
  assert.equal(DEFAULT_ONBOARDING.branding.headerLayout, 'mark_left')
  // Картинок нет ни у знака, ни у надписи: пока их не загрузили, шапка рисует
  // название текстом из реквизитов.
  assert.equal(DEFAULT_ONBOARDING.branding.logoWordmark, '')
  assert.equal(DEFAULT_ONBOARDING.branding.logoCombined, '')
})
