/**
 * Обработка картинок: автообрезка полей и круглая маска.
 *
 * Проверяется расчётная часть — та, что решает, где кончается фон и какой
 * квадрат вырезать под круг. Рисование на canvas в этих тестах не участвует:
 * оно живёт в браузере, а сама арифметика от него не зависит.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { circleMaskGeometry, contentBounds } from './logoCanvas'

/** Картинка нужного размера, залитая одним цветом. */
function fill(width: number, height: number, color: [number, number, number, number]): number[] {
  const data: number[] = []
  for (let i = 0; i < width * height; i += 1) data.push(...color)
  return data
}

/** Ставит точку заданного цвета. */
function put(
  data: number[],
  width: number,
  x: number,
  y: number,
  color: [number, number, number, number],
): void {
  const p = (y * width + x) * 4
  data[p] = color[0]
  data[p + 1] = color[1]
  data[p + 2] = color[2]
  data[p + 3] = color[3]
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255]
const BLACK: [number, number, number, number] = [0, 0, 0, 255]
const CLEAR: [number, number, number, number] = [0, 0, 0, 0]

test('белые поля вокруг знака находятся', () => {
  const data = fill(20, 20, WHITE)
  for (let y = 5; y <= 14; y += 1) {
    for (let x = 4; x <= 12; x += 1) put(data, 20, x, y, BLACK)
  }
  assert.deepEqual(contentBounds(data, 20, 20), { left: 4, top: 5, right: 12, bottom: 14 })
})

test('прозрачные поля находятся по альфа-каналу', () => {
  const data = fill(10, 10, CLEAR)
  put(data, 10, 3, 7, BLACK)
  put(data, 10, 6, 8, BLACK)
  assert.deepEqual(contentBounds(data, 10, 10), { left: 3, top: 7, right: 6, bottom: 8 })
})

test('фон не обязан быть идеально ровным', () => {
  // Снимок в JPEG даёт «почти белый» фон: 250 против 255. С допуском это фон,
  // без допуска обрезка не срабатывала бы вовсе.
  const data = fill(12, 12, [250, 251, 250, 255])
  put(data, 12, 6, 6, BLACK)
  assert.deepEqual(contentBounds(data, 12, 12), { left: 6, top: 6, right: 6, bottom: 6 })
})

test('однотонная картинка — обрезать нечего', () => {
  assert.equal(contentBounds(fill(8, 8, WHITE), 8, 8), null)
  assert.equal(contentBounds(fill(8, 8, CLEAR), 8, 8), null)
})

test('круг вписывается в квадрат по центру картинки', () => {
  // Широкий знак 4:1: круг режется по центру, иначе вышел бы овал.
  assert.deepEqual(circleMaskGeometry(400, 100), {
    side: 100,
    offsetX: 150,
    offsetY: 0,
    radius: 50,
  })
  assert.deepEqual(circleMaskGeometry(120, 300), {
    side: 120,
    offsetX: 0,
    offsetY: 90,
    radius: 60,
  })
  assert.deepEqual(circleMaskGeometry(256, 256), {
    side: 256,
    offsetX: 0,
    offsetY: 0,
    radius: 128,
  })
})
