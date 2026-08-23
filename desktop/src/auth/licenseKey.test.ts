/**
 * Маска лицензионного ключа и признак «набран целиком».
 *
 * От второго зависит автоматический вход в окне специалиста: по нему ключ
 * уходит на проверку без кнопки. Ошибись он в одну сторону — окно било бы в
 * сервер недобранным ключом на каждый символ и съедало лимит попыток; ошибись
 * в другую — ключ, набранный правильно, не отправился бы никогда, и человек
 * упирался бы в молчание.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  LICENSE_KEY_LENGTH,
  formatLicenseKeyInput,
  isCompleteLicenseKey,
} from './licenseKey'

const FULL = 'KASSIR-A1B2-C3D4-E5F6'

test('ключ разбивается на группы по мере набора', () => {
  assert.equal(formatLicenseKeyInput('A1B2'), 'KASSIR-A1B2')
  assert.equal(formatLicenseKeyInput('A1B2C3D4'), 'KASSIR-A1B2-C3D4')
  assert.equal(formatLicenseKeyInput('A1B2C3D4E5F6'), FULL)
})

test('пустой ввод не превращается в один префикс', () => {
  // Иначе очистка поля оставляла бы «KASSIR-», и стереть его было бы нечем.
  assert.equal(formatLicenseKeyInput(''), '')
  assert.equal(formatLicenseKeyInput('KASSIR'), '')
})

test('набранный вручную префикс не задваивается', () => {
  assert.equal(formatLicenseKeyInput('KASSIR-A1B2-C3D4-E5F6'), FULL)
  assert.equal(formatLicenseKeyInput('kassira1b2c3d4e5f6'), FULL)
})

test('регистр, пробелы и дефисы человек расставляет как хочет', () => {
  // Ключ читают с наклейки и набирают на экранной клавиатуре — придираться к
  // тому, как он разделил группы, здесь не к чему.
  assert.equal(formatLicenseKeyInput('a1b2 c3d4 e5f6'), FULL)
  assert.equal(formatLicenseKeyInput('a1b2--c3d4---e5f6'), FULL)
})

test('лишнее за пределами длины ключа отбрасывается', () => {
  assert.equal(formatLicenseKeyInput('A1B2C3D4E5F6ZZZZ'), FULL)
  assert.equal(FULL.length, LICENSE_KEY_LENGTH)
})

test('готовым ключ считается только целиком', () => {
  assert.equal(isCompleteLicenseKey(FULL), true)
  // Одиннадцать символов из двенадцати — ещё не ключ: отправлять его значит
  // потратить попытку заведомо впустую.
  assert.equal(isCompleteLicenseKey('KASSIR-A1B2-C3D4-E5F'), false)
  assert.equal(isCompleteLicenseKey('KASSIR'), false)
  assert.equal(isCompleteLicenseKey(''), false)
})

test('символы вне алфавита ключа до поля не доходят', () => {
  // U в Crockford Base32 нет, и заменить её нечем — отбрасывается, как любой
  // посторонний символ. Иначе окно сочло бы ключ набранным целиком и потратило
  // бы попытку на заведомо неверный.
  assert.equal(formatLicenseKeyInput('A1B2C3D4E5FU'), 'KASSIR-A1B2-C3D4-E5F')
  assert.equal(isCompleteLicenseKey('A1B2C3D4E5FU'), false)
})

test('спутанные с цифрами буквы читаются как цифры', () => {
  // I и L неотличимы от единицы, O — от нуля; в настоящем ключе их не бывает,
  // поэтому набранная буква может быть только неверно прочитанной цифрой.
  assert.equal(formatLicenseKeyInput('IL0O1234ABCD'), 'KASSIR-1100-1234-ABCD')
})

test('префикс не портится подстановкой: в слове KASSIR есть «I»', () => {
  // Подстановка до снятия префикса превратила бы его в «KASS1R» — он перестал
  // бы узнаваться и уехал бы в тело ключа.
  assert.equal(formatLicenseKeyInput('KASSIRA1B2C3D4E5F6'), FULL)
})
