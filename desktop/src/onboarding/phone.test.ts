/**
 * Маска телефона.
 *
 * Проверяется то, на чём она ломалась в жизни: поле дописывало цифры само,
 * принимало больше девяти и теряло код страны. Вставка из буфера в разных
 * видах — отдельный случай: номер приносят из мессенджера, из визитки и из
 * банковского приложения, и все три вида должны сойтись к одному.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PHONE_NATIONAL_LENGTH,
  caretAfterDigits,
  formatPhone,
  formatPhoneInput,
  phoneDigits,
  phoneProblem,
  phoneValue,
} from './phone'

test('вставка из буфера приводится к одному виду', () => {
  for (const raw of [
    '0555123456',
    '996555123456',
    '+996 555 12-34-56',
    '+996555123456',
    '555 123 456',
    '(0555) 12 34 56',
  ]) {
    assert.equal(phoneValue(raw), '+996555123456', `вставка «${raw}»`)
  }
})

test('больше девяти цифр после кода не принимается', () => {
  assert.equal(phoneDigits('9965551234567890'), '555123456')
  assert.equal(phoneValue('+996 555 123 456 789'), '+996555123456')
  assert.equal(phoneDigits('5551234567').length, PHONE_NATIONAL_LENGTH)
})

test('приложение не дописывает цифры от себя', () => {
  // Ровно то, что набрали, — ни одной лишней цифры, только пробелы.
  assert.equal(formatPhoneInput('+996555'), '+996 555')
  assert.equal(formatPhoneInput('+9965551'), '+996 555 1')
  assert.equal(phoneDigits('555'), '555')
  // Пустое поле — только код страны, без единой цифры номера.
  assert.equal(formatPhoneInput(''), '+996 ')
  assert.equal(phoneDigits(''), '')
})

test('номер, начинающийся на 996, не принимают за код страны дважды', () => {
  assert.equal(phoneValue('996123456'), '+996996123456')
})

test('форматирование для поля и для чека', () => {
  assert.equal(formatPhoneInput('+996555123456'), '+996 555 123 456')
  assert.equal(formatPhone('+996555123456'), '+996 555 123 456')
  // Пустой номер в чеке — пустая строка, а не голый код страны: строка
  // «Телефон: +996» на чеке выглядит как ошибка кассы.
  assert.equal(formatPhone(''), '')
  // Номера, сохранённые прежней маской с пробелами, читаются как есть.
  assert.equal(formatPhone('+996 555 111 222'), '+996 555 111 222')
})

test('неполный номер не пускает дальше', () => {
  assert.equal(phoneProblem('+996555'), 'Введите 9 цифр после +996.')
  assert.equal(phoneProblem('+996555123456'), '')
  // Пустое поле — забота обязательности поля, а не маски.
  assert.equal(phoneProblem(''), '')
})

test('курсор встаёт после набранной цифры, а не в конец строки', () => {
  assert.equal(caretAfterDigits(0), '+996 '.length)
  assert.equal(caretAfterDigits(3), '+996 555'.length)
  assert.equal(caretAfterDigits(4), '+996 555 1'.length)
  assert.equal(caretAfterDigits(9), formatPhoneInput('+996555123456').length)
})
