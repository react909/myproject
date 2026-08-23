/**
 * Аккорд специалиста: `Ctrl+Alt+Shift` и обе стрелки.
 *
 * Проверяется главное: аккорд не срабатывает ни от одной стрелки, ни без
 * какого-либо из трёх модификаторов. Каждая такая поблажка превращала бы
 * первое звено цепочки в сочетание, которое можно нажать случайно локтем или
 * подсмотреть из-за плеча по половине.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CHORD_WINDOW_MS,
  DEFAULT_HIDDEN_ACCESS,
  matchesShortcut,
  matchesSpecialistChord,
  matchesSpecialistChordWithin,
  normalizeShortcut,
} from './hiddenAccess'

/** Событие клавиатуры в объёме, который нужен проверке аккорда. */
function keys(ctrl: boolean, alt: boolean, shift: boolean) {
  return { ctrlKey: ctrl, altKey: alt, shiftKey: shift }
}

const ALL_MODIFIERS = keys(true, true, true)
const BOTH_ARROWS = new Set(['ArrowLeft', 'ArrowRight'])

test('три модификатора и обе стрелки — аккорд сработал', () => {
  assert.equal(matchesSpecialistChord(ALL_MODIFIERS, BOTH_ARROWS), true)
})

test('порядок стрелок не важен: важно, что зажаты обе', () => {
  // Набор неупорядочен по определению — тест фиксирует, что реализация не
  // начнёт однажды требовать «сначала влево».
  const reversed = new Set(['ArrowRight', 'ArrowLeft'])
  assert.equal(matchesSpecialistChord(ALL_MODIFIERS, reversed), true)
})

test('одной стрелки мало', () => {
  assert.equal(matchesSpecialistChord(ALL_MODIFIERS, new Set(['ArrowLeft'])), false)
  assert.equal(matchesSpecialistChord(ALL_MODIFIERS, new Set(['ArrowRight'])), false)
})

test('без любого из трёх модификаторов аккорда нет', () => {
  assert.equal(matchesSpecialistChord(keys(false, true, true), BOTH_ARROWS), false)
  assert.equal(matchesSpecialistChord(keys(true, false, true), BOTH_ARROWS), false)
  assert.equal(matchesSpecialistChord(keys(true, true, false), BOTH_ARROWS), false)
})

test('стрелок нет вовсе — модификаторы сами по себе ничего не значат', () => {
  assert.equal(matchesSpecialistChord(ALL_MODIFIERS, new Set()), false)
})

/* --- Стрелки можно нажимать по очереди ------------------------------------ */

/** Отметки «когда нажата», как их ведёт useHiddenAccess. */
function at(left: number | null, right: number | null): ReadonlyMap<string, number> {
  const map = new Map<string, number>()
  if (left !== null) map.set('ArrowLeft', left)
  if (right !== null) map.set('ArrowRight', right)
  return map
}

test('стрелки, нажатые подряд, засчитываются за аккорд', () => {
  // Требовать физической одновременности оказалось слишком строго: с зажатыми
  // тремя модификаторами стрелки жмут по очереди, и первую успевают отпустить.
  assert.equal(matchesSpecialistChordWithin(ALL_MODIFIERS, at(1000, 1400), 1400), true)
})

test('слишком долгий разрыв между стрелками аккордом не считается', () => {
  const late = 1000 + CHORD_WINDOW_MS + 1
  assert.equal(matchesSpecialistChordWithin(ALL_MODIFIERS, at(1000, late), late), false)
})

test('одной стрелки не хватает и по времени', () => {
  assert.equal(matchesSpecialistChordWithin(ALL_MODIFIERS, at(1000, null), 1100), false)
  assert.equal(matchesSpecialistChordWithin(ALL_MODIFIERS, at(null, 1000), 1100), false)
})

test('без модификаторов время стрелок ничего не значит', () => {
  assert.equal(matchesSpecialistChordWithin(keys(false, true, true), at(1000, 1100), 1100), false)
  assert.equal(matchesSpecialistChordWithin(keys(true, false, true), at(1000, 1100), 1100), false)
  assert.equal(matchesSpecialistChordWithin(keys(true, true, false), at(1000, 1100), 1100), false)
})

test('лишние зажатые клавиши аккорду не мешают', () => {
  // Стрелки нажимают, не отпуская модификаторов, и клавиатура нередко успевает
  // прислать что-то ещё. Требовать «ровно две клавиши» значило бы ломать
  // аккорд на ровном месте.
  const noisy = new Set(['ArrowLeft', 'ArrowRight', 'Shift', 'Control'])
  assert.equal(matchesSpecialistChord(ALL_MODIFIERS, noisy), true)
})

test('аккорд владельца остаётся обычным сочетанием', () => {
  assert.equal(normalizeShortcut(DEFAULT_HIDDEN_ACCESS.owner), 'ctrl+shift+m')
})

test('аккорд владельца не срабатывает от аккорда специалиста', () => {
  // Оба живут в одном обработчике, и перепутать двери нельзя: у владельца
  // окно открывается сразу, у специалиста — только взводится ожидание.
  const event = {
    ctrlKey: true,
    altKey: true,
    shiftKey: true,
    code: 'ArrowLeft',
  } as KeyboardEvent
  assert.equal(matchesShortcut(event, DEFAULT_HIDDEN_ACCESS.owner), false)
})

test('пароль владельца и ключ специалиста открывают разные двери', () => {
  // Сочетания разные и настраиваются раздельно — общего аккорда на обе двери
  // нет и быть не должно.
  assert.notEqual(
    normalizeShortcut(DEFAULT_HIDDEN_ACCESS.owner),
    normalizeShortcut(DEFAULT_HIDDEN_ACCESS.specialist),
  )
})
