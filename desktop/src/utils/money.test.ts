/**
 * Деньги целыми тыйынами и связка «наценка ↔ розничная цена».
 *
 * Проверяется то, что ломается тихо и обнаруживается только сложением столбца
 * вручную:
 *
 * • разбор суммы не теряет и не выдумывает копейки;
 * • сумма строки не уплывает на дробном количестве (весовой товар);
 * • наценка и цена обратимы — иначе ввод в таблице закупки «дрожал» бы:
 *   поправил цену, наценка пересчиталась, а от неё цена вернулась не той.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatSigned,
  formatTiyin,
  lineTotal,
  markupPercent,
  parseQty,
  parseTiyin,
  retailFromMarkup,
  tiyinToInput,
} from './money'

test('разбор суммы: запятая, точка, пробелы и мусор', () => {
  assert.equal(parseTiyin('123.45'), 12_345)
  assert.equal(parseTiyin('123,45'), 12_345)
  // Неразрывный и узкий пробелы приезжают из скопированной надписи.
  assert.equal(parseTiyin('12 345,60'), 1_234_560)
  assert.equal(parseTiyin('12 345,60'), 1_234_560)
  // Пустое поле — это ноль, а не NaN: NaN уехал бы в запрос и упал на сервере.
  assert.equal(parseTiyin(''), 0)
  assert.equal(parseTiyin('-'), 0)
  assert.equal(parseTiyin('абв'), 0)
})

test('округление «половину вверх», а не банковское', () => {
  // 2.675 в float это 2.67499999…, и Math.round дал бы 267.
  assert.equal(parseTiyin('2.675'), 268)
  assert.equal(parseTiyin('0.005'), 1)
})

test('сумма строки не уплывает на дробном количестве', () => {
  // 2.5 кг по 3.33 сома = 8.325 → 833 тыйына, а не 832.4999.
  assert.equal(lineTotal(333, 2.5), 833)
  assert.equal(lineTotal(12_345, 3), 37_035)
  assert.equal(lineTotal(0, 10), 0)
})

test('наценка и розничная цена обратимы', () => {
  // Именно это чинит «дрожание» ввода: поправил цену — наценка пересчиталась,
  // а от наценки цена обязана вернуться той же.
  for (const cost of [1, 100, 4_999, 12_345, 987_654]) {
    for (const percent of [0, 5, 12.5, 35, 100, 250]) {
      const retail = retailFromMarkup(cost, percent)
      const back = markupPercent(cost, retail)
      const again = retailFromMarkup(cost, back)
      assert.equal(
        again,
        retail,
        `цена разошлась: закуп ${cost}, наценка ${percent} → ${retail} → ${back} → ${again}`,
      )
    }
  }
})

test('нулевая закупочная цена не даёт бесконечной наценки', () => {
  assert.equal(markupPercent(0, 5_000), 0)
  assert.equal(retailFromMarkup(0, 50), 0)
})

test('отрицательная наценка — это продажа ниже закупки, и она считается', () => {
  assert.equal(markupPercent(10_000, 8_000), -20)
  assert.equal(retailFromMarkup(10_000, -20), 8_000)
})

test('количество: запятая, отрицательное отбрасывается', () => {
  assert.equal(parseQty('2,5'), 2.5)
  assert.equal(parseQty('2.5'), 2.5)
  // Минус-приход — это возврат, и вводить его количеством нельзя.
  assert.equal(parseQty('-3'), 0)
  assert.equal(parseQty(''), 0)
})

test('вывод суммы: разряды, знак и поле ввода', () => {
  assert.equal(formatTiyin(1_234_560).replace(/ /g, ' '), '12 345,60')
  assert.equal(formatSigned(5_000).replace(/ /g, ' '), '+50,00')
  assert.equal(formatSigned(-5_000).replace(/ /g, ' '), '−50,00')
  assert.equal(formatSigned(0).replace(/ /g, ' '), '0,00')
  // В поле ввода — без разрядов: с ними его нельзя дописывать с клавиатуры.
  assert.equal(tiyinToInput(1_234_560), '12345.60')
})
