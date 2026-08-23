/**
 * Двухступенчатый вход специалиста.
 *
 * Проверяется главное свойство: без аккорда удержание логотипа не делает
 * ничего. Пока жест работал сам по себе, его находил любой любопытный кассир —
 * логотип на виду, а удержание первое, что пробуют на сенсорном экране.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ARM_WINDOW_MS,
  HOLD_HINT_FROM,
  HOLD_WINDOW_MS,
  TAP_COUNT,
  TAP_WINDOW_MS,
  arm,
  completeTaps,
  createGateState,
  disarm,
  holdCompleted,
  holdProgress,
  isArmed,
  registerTap,
  shouldStartHold,
  showsHint,
  tapsArm,
} from './hiddenAccessGate'

const HOLD_MS = 5000

/** Прогоняет серию тапов с заданными паузами и отдаёт итог. */
function tapSeries(gaps: number[]): { taps: number[]; armed: boolean } {
  let now = 1_000
  let taps = registerTap([], now)
  for (const gap of gaps) {
    now += gap
    taps = registerTap(taps, now)
  }
  return { taps, armed: tapsArm(taps) }
}

test('без аккорда не работает ничего: ни тапы, ни удержание', () => {
  const state = createGateState()
  assert.equal(isArmed(state, 1_000), false)
  assert.equal(shouldStartHold(state, 1_000), false)
  // Тапы без разрешения не дают права на удержание, сколько бы их ни было.
  assert.equal(shouldStartHold(completeTaps(state, 1_000), 1_000), false)
  // И удержание не начинается никогда — отсчёта нет, показывать нечего.
  assert.equal(shouldStartHold(state, 1_000_000), false)
})

test('аккорд выдаёт разрешение на полминуты — но только на тапы', () => {
  const now = 10_000
  const state = arm(createGateState(), now)
  assert.equal(isArmed(state, now), true)
  assert.equal(isArmed(state, now + ARM_WINDOW_MS - 1), true)
  // Ровно в момент истечения разрешение уже погасло.
  assert.equal(isArmed(state, now + ARM_WINDOW_MS), false)
  // Само по себе разрешение удержание не открывает — нужно второе звено.
  assert.equal(shouldStartHold(state, now), false)
})

test('цепочка целиком: аккорд, тапы, удержание', () => {
  const chord = 10_000
  const taps = chord + 5_000
  const state = completeTaps(arm(createGateState(), chord), taps)
  assert.equal(shouldStartHold(state, taps), true)
  assert.equal(shouldStartHold(state, taps + HOLD_WINDOW_MS - 1), true)
  assert.equal(shouldStartHold(state, taps + HOLD_WINDOW_MS), false)
})

test('серия тапов тратит разрешение: второй раз подряд не пройти', () => {
  const chord = 10_000
  const after = completeTaps(arm(createGateState(), chord), chord + 1_000)
  assert.equal(isArmed(after, chord + 1_000), false)
  // Повторная серия без нового аккорда ничего не продлевает.
  const again = completeTaps(after, chord + 2_000)
  assert.equal(again.holdUntil, after.holdUntil)
})

test('тапы после истечения разрешения не считаются', () => {
  const chord = 10_000
  const late = chord + ARM_WINDOW_MS + 1
  const state = completeTaps(arm(createGateState(), chord), late)
  assert.equal(shouldStartHold(state, late), false)
})

test('цепочка одноразовая: после сброса нужен новый аккорд', () => {
  const passed = completeTaps(arm(createGateState(), 0), 1_000)
  const after = disarm()
  assert.equal(shouldStartHold(after, 2_000), false)
  assert.equal(isArmed(after, 2_000), false)
  // Прежнее состояние на это не влияет — сброс полный.
  assert.notEqual(passed.holdUntil, after.holdUntil)
})

test('повторный аккорд начинает цепочку заново, а не продолжает её', () => {
  const passed = completeTaps(arm(createGateState(), 0), 1_000)
  const restarted = arm(passed, 2_000)
  // Право на удержание сгорело: аккорд возвращает к первому звену.
  assert.equal(shouldStartHold(restarted, 2_000), false)
  assert.equal(isArmed(restarted, 2_000), true)
})

test('окно ключа открывается ровно на пятой секунде', () => {
  assert.equal(holdCompleted(0, 4_999, HOLD_MS), false)
  assert.equal(holdCompleted(0, 5_000, HOLD_MS), true)
})

test('намёк появляется на третьей секунде, не раньше', () => {
  // Первые три секунды — ничего: случайное касание ничего не выдаёт.
  assert.equal(showsHint(holdProgress(0, 1_000, HOLD_MS)), false)
  assert.equal(showsHint(holdProgress(0, 2_999, HOLD_MS)), false)
  assert.equal(showsHint(holdProgress(0, 3_000, HOLD_MS)), true)
  assert.equal(showsHint(holdProgress(0, 4_500, HOLD_MS)), true)
  // Порог соответствует трём секундам из пяти.
  assert.equal(HOLD_HINT_FROM * HOLD_MS, 3_000)
})

test('доля удержания не выходит за границы', () => {
  assert.equal(holdProgress(0, -100, HOLD_MS), 0)
  assert.equal(holdProgress(0, 99_999, HOLD_MS), 1)
})

/* --- Второе звено: серия тапов по логотипу -------------------------------- */

test('пять быстрых тапов складываются в серию', () => {
  // Четыре паузы по 300 мс — вся серия укладывается в секунду с небольшим.
  const { armed, taps } = tapSeries([300, 300, 300, 300])
  assert.equal(taps.length, TAP_COUNT)
  assert.equal(armed, true)
})

test('четырёх тапов недостаточно', () => {
  assert.equal(tapSeries([300, 300, 300]).armed, false)
})

test('пауза посередине обнуляет счётчик', () => {
  // Два тапа, пауза четыре секунды, ещё три: серия начинается заново, и до
  // пяти она не доходит.
  const { armed, taps } = tapSeries([300, 4_000, 300, 300])
  assert.equal(armed, false)
  assert.equal(taps.length, 3)
})

test('пять медленных тапов не считаются серией', () => {
  // Паузы короче окна, поэтому счётчик не обнуляется, но вся серия длиннее
  // трёх секунд — так по логотипу попадают случайно, а не жестом.
  const { armed, taps } = tapSeries([900, 900, 900, 900])
  assert.equal(taps.length, TAP_COUNT)
  assert.equal(armed, false)
})

test('серия на самой границе окна ещё считается', () => {
  const { armed } = tapSeries([TAP_WINDOW_MS / 4, TAP_WINDOW_MS / 4, TAP_WINDOW_MS / 4, TAP_WINDOW_MS / 4])
  assert.equal(armed, true)
})

test('серия сама по себе — не вход: без аккорда она ничего не открывает', () => {
  // Ровно тот случай, ради которого цепочка и делалась: кассир, отбивающий
  // пальцем по логотипу, набирает серию и не получает ничего.
  const { armed } = tapSeries([300, 300, 300, 300])
  assert.equal(armed, true, 'серия набрана')
  const state = completeTaps(createGateState(), 50_000)
  assert.equal(shouldStartHold(state, 50_000), false)
})
