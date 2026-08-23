/**
 * Когда набранное уходит на проверку.
 *
 * Кнопки «Войти» в окнах нет, и это условие — единственное, что решает, войдёт
 * человек или нет. Ошибись оно в одну сторону — окно било бы в сервер обрывками
 * пароля и съедало лимит попыток; ошибись в другую — верный секрет не
 * отправился бы никогда, и окно выглядело бы зависшим.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  KEY_SETTLE_MS,
  PASSWORD_SETTLE_MS,
  expectedLengthFor,
  readyToSend,
  settleMsFor,
  shapeFor,
  shouldAttempt,
} from './secretShape'
import { LICENSE_KEY_LENGTH } from './licenseKey'

const NONE: ReadonlySet<string> = new Set()
const FULL_KEY = 'KASSIR-A1B2-C3D4-E5F6'

test('пароль уходит на проверку, когда набрано не меньше минимума', () => {
  assert.equal(shouldAttempt('owner', 'Vladelec2026', NONE, false), true)
  // Ровно восемь — уже достаточно.
  assert.equal(shouldAttempt('owner', '12345678', NONE, false), true)
})

test('короткий пароль не отправляется: попытка ушла бы заведомо впустую', () => {
  assert.equal(shouldAttempt('owner', '1234567', NONE, false), false)
  assert.equal(shouldAttempt('owner', '', NONE, false), false)
})

test('ключ отправляется только набранным целиком', () => {
  assert.equal(shouldAttempt('specialist', FULL_KEY, NONE, false), true)
  assert.equal(shouldAttempt('specialist', 'KASSIR-A1B2-C3D4-E5F', NONE, false), false)
})

test('уже отвергнутое сервером второй раз не отправляется', () => {
  // Иначе каждая отрисовка окна тратила бы ещё одну попытку на тот же пароль.
  const rejected = new Set(['Vladelec2026'])
  assert.equal(shouldAttempt('owner', 'Vladelec2026', rejected, false), false)
  // А исправленный — отправляется.
  assert.equal(shouldAttempt('owner', 'Vladelec2027', rejected, false), true)
})

test('пока идёт проверка, вторая не начинается', () => {
  assert.equal(shouldAttempt('owner', 'Vladelec2026', NONE, true), false)
})

test('пробелы по краям не создают отдельного значения', () => {
  // Иначе « пароль» и «пароль » считались бы разными попытками и тратили лимит
  // по разу каждая.
  const rejected = new Set(['Vladelec2026'])
  assert.equal(shouldAttempt('owner', '  Vladelec2026  ', rejected, false), false)
})

test('известна длина — проверка без ожидания', () => {
  // Так же ведёт себя ввод кода на телефоне: длина известна, и код уходит на
  // проверку ровно на последнем символе. Именно это делает вход мгновенным.
  assert.equal(settleMsFor('specialist', 21), KEY_SETTLE_MS)
  assert.equal(settleMsFor('owner', 12), 0)
})

test('длина неизвестна — возвращается пауза, и она не нулевая', () => {
  // Единственный оставшийся случай: касса обновилась со старой версии, длину
  // сервер узнает при первом успешном входе. Ноль здесь был бы той самой
  // ошибкой, из-за которой проверка запускалась на каждую букву.
  assert.ok(PASSWORD_SETTLE_MS > 0, 'без паузы проверка запускается на каждую букву')
  assert.ok(PASSWORD_SETTLE_MS <= 500, 'пауза не должна читаться как задержка')
  assert.equal(settleMsFor('owner', null), PASSWORD_SETTLE_MS)
})

test('пароль отправляется ровно на своей длине, когда она известна', () => {
  // Ни раньше, ни позже: на сервере запускается ровно одна дорогая проверка.
  assert.equal(readyToSend('owner', 'Vladelec202', 12), false)
  assert.equal(readyToSend('owner', 'Vladelec2026', 12), true)
  // Перебор длины тоже не отправляется — это уже не тот пароль.
  assert.equal(readyToSend('owner', 'Vladelec20266', 12), false)
})

test('без известной длины работает прежнее правило минимума', () => {
  assert.equal(readyToSend('owner', '1234567', null), false)
  assert.equal(readyToSend('owner', '12345678', null), true)
})

test('длина ключа известна всегда — её не надо спрашивать у сервера', () => {
  assert.equal(expectedLengthFor('specialist', null), LICENSE_KEY_LENGTH)
  // А у пароля — только то, что сообщил сервер.
  assert.equal(expectedLengthFor('owner', null), null)
  assert.equal(expectedLengthFor('owner', 12), 12)
})

test('маска и вид поля по-прежнему различаются у ключа и пароля', () => {
  assert.equal(shapeFor('owner').mask('Па Роль-1'), 'Па Роль-1')
  assert.equal(shapeFor('specialist').mask('a1b2c3d4e5f6'), FULL_KEY)
})

