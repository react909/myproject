/**
 * Читаемость акцента: то единственное в этой системе, что нельзя проверить
 * глазами.
 *
 * Цвет выбирает клиент, и выбрать он может любой из шестнадцати миллионов.
 * Посмотреть на все нельзя, а достаточно одного неудачного — и кассир полдня
 * не видит надписи на кнопке «Оплатить». Поэтому проверяется не «выглядит
 * хорошо», а измеримое: контраст по WCAG не ниже 4.5:1, и не для десятка
 * подобранных цветов, а для всей сетки оттенков разом.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_PRIMARY,
  MIN_TEXT_CONTRAST,
  accentOtherThemeWarning,
  accentProblem,
  accentTextOn,
  contrastRatio,
  isValidHex,
  normalizeHex,
  readableTextOn,
  sanitizeHexInput,
} from './applyTheme'

const SURFACE_LIGHT = '#ffffff'
const SURFACE_DARK = '#151b23'
const SURFACE_RAIL = '#10151d'

/** Сетка по всему цветовому кубу: 6×6×6 = 216 цветов, включая крайности. */
function colorGrid(): string[] {
  const steps = [0, 51, 102, 153, 204, 255]
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  const out: string[] = []
  for (const r of steps) for (const g of steps) for (const b of steps) {
    out.push(`#${hex(r)}${hex(g)}${hex(b)}`)
  }
  return out
}

test('текст на кнопке читается при любом акценте', () => {
  for (const accent of colorGrid()) {
    const fg = readableTextOn(accent)
    const ratio = contrastRatio(fg, accent)
    assert.ok(
      ratio >= MIN_TEXT_CONTRAST,
      `${accent}: текст ${fg} даёт ${ratio.toFixed(2)}:1, нужно ${MIN_TEXT_CONTRAST}`,
    )
  }
})

test('на стандартном мятном текст тёмный, а не белый', () => {
  // Та самая ошибка, ради которой всё считается: белая надпись на #00f5bc
  // даёт 1.4:1 и не видна вовсе.
  assert.equal(readableTextOn(DEFAULT_PRIMARY), '#000000')
  assert.ok(contrastRatio('#ffffff', DEFAULT_PRIMARY) < MIN_TEXT_CONTRAST)
})

test('на тёмном акценте текст светлый', () => {
  assert.equal(readableTextOn('#0f172a'), '#ffffff')
  assert.equal(readableTextOn('#4f46e5'), '#ffffff')
})

test('акцент как цвет надписи читается на всех трёх поверхностях', () => {
  for (const accent of colorGrid()) {
    for (const surface of [SURFACE_LIGHT, SURFACE_DARK, SURFACE_RAIL]) {
      const text = accentTextOn(accent, surface)
      const ratio = contrastRatio(text, surface)
      assert.ok(
        ratio >= MIN_TEXT_CONTRAST,
        `${accent} на ${surface}: получилось ${text}, ${ratio.toFixed(2)}:1`,
      )
    }
  }
})

test('усиленный вариант надписи добирает до 7:1', () => {
  for (const accent of colorGrid()) {
    const strong = accentTextOn(accent, SURFACE_LIGHT, 7)
    assert.ok(
      contrastRatio(strong, SURFACE_LIGHT) >= 7,
      `${accent}: усиленный ${strong} не дотянул до 7:1`,
    )
  }
})

test('акцент, годный как есть, не перекрашивается', () => {
  // Тёмно-синий и так читается на белом — трогать его незачем, иначе оттенок
  // фирменного цвета уплывал бы без причины.
  assert.equal(accentTextOn('#2563eb', SURFACE_LIGHT), '#2563eb')
})

test('стандартный цвет системы проходит проверку на обеих темах', () => {
  assert.equal(accentProblem(DEFAULT_PRIMARY, 'light'), '')
  assert.equal(accentProblem(DEFAULT_PRIMARY, 'dark'), '')
  assert.equal(accentOtherThemeWarning(DEFAULT_PRIMARY, 'light'), '')
})

test('цвет, сливающийся с фоном, не пропускается', () => {
  // Белый на светлой теме и почти-чёрный на тёмной — кнопок не будет видно.
  assert.notEqual(accentProblem('#ffffff', 'light'), '')
  assert.notEqual(accentProblem('#fafafa', 'light'), '')
  assert.notEqual(accentProblem('#0b0e13', 'dark'), '')
  assert.notEqual(accentProblem('#151b23', 'dark'), '')
})

test('негодный на одной теме бывает годен на другой', () => {
  // Запрещать такой цвет вообще нельзя: магазин со светлой темой в тёмную
  // может не зайти никогда. Отказ — по текущей теме, предупреждение — о второй.
  assert.equal(accentProblem('#ffffff', 'dark'), '')
  assert.notEqual(accentOtherThemeWarning('#ffffff', 'dark'), '')

  assert.equal(accentProblem('#0f172a', 'light'), '')
  assert.notEqual(accentOtherThemeWarning('#0f172a', 'light'), '')
})

test('недобранный хекс не проходит', () => {
  assert.notEqual(accentProblem('#00f5b', 'light'), '')
  assert.notEqual(accentProblem('', 'light'), '')
})

test('готовые варианты палитры работают на обеих темах', () => {
  // Список повторяет ACCENT_PRESETS из BrandEditor.tsx. Ради него проверка и
  // существует: предлагать в один клик цвет, который сам же и забракуешь при
  // сохранении, — худшее, что может сделать этот экран.
  const presets = ['#00f5bc', '#4f46e5', '#2563eb', '#0f9d58', '#e2761b', '#d0342c', '#7c3aed', '#475569']
  for (const hex of presets) {
    assert.equal(accentProblem(hex, 'light'), '', `${hex} не годится на светлой теме`)
    assert.equal(accentProblem(hex, 'dark'), '', `${hex} не годится на тёмной теме`)
  }
})

test('разбор хекса', () => {
  assert.ok(isValidHex('#00F5BC'))
  assert.ok(!isValidHex('00f5bc'))
  assert.ok(!isValidHex('#00f5b'))
  assert.equal(normalizeHex('#00F5BC'), '#00f5bc')
  // Мусор на входе — стандартный цвет, а не сломанная тема.
  assert.equal(normalizeHex('не цвет'), DEFAULT_PRIMARY)
  assert.equal(sanitizeHexInput('00f5bcZZ'), '#00f5bc')
  assert.equal(sanitizeHexInput('#00f5bcffff'), '#00f5bc')
})
