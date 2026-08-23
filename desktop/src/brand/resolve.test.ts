/**
 * Граница «бренд интерфейса ≠ данные магазина».
 *
 * Проверяется то, что легко сломать обратно одной строкой: название в шапке
 * не имеет права приезжать из реквизитов, а возврат к заводскому бренду обязан
 * вернуть заводской вид, ничего не стирая.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_PRIMARY } from '../auth/applyTheme'
import { FACTORY_NAME, brandTheme, resolveBrandName } from './resolve'
import type { BrandSource } from './resolve'

/** Магазин со своим брендом: фиолетовый, тёмная тема, своё название. */
const own: BrandSource = {
  useFactoryBrand: false,
  brandName: 'Бимар Маркет',
  primaryColor: '#7c3aed',
  theme: 'dark',
}

const factory: BrandSource = { ...own, useFactoryBrand: true }

test('по умолчанию система называется Kassir ERP', () => {
  assert.equal(FACTORY_NAME, 'Kassir ERP')
  assert.equal(resolveBrandName(factory), 'Kassir ERP')
})

test('под заводским брендом система стоит в мятном и светлой теме', () => {
  // Даже когда в полях лежит фиолетовый и тёмная тема, выбранные в прошлый
  // заход: режим решает, что показать, а поля остаются нетронутыми.
  assert.deepEqual(brandTheme(factory), { mode: 'light', primary: DEFAULT_PRIMARY })
  assert.equal(DEFAULT_PRIMARY, '#00f5bc')
})

test('свой бренд подставляет название, цвет и тему клиента', () => {
  assert.equal(resolveBrandName(own), 'Бимар Маркет')
  assert.deepEqual(brandTheme(own), { mode: 'dark', primary: '#7c3aed' })
})

test('переключение режима обратимо и ничего не теряет', () => {
  // Тот же объект, меняется только режим — значит поля пережили возврат.
  const there = brandTheme({ ...own, useFactoryBrand: true })
  const back = brandTheme({ ...own, useFactoryBrand: false })
  assert.deepEqual(there, { mode: 'light', primary: DEFAULT_PRIMARY })
  assert.deepEqual(back, { mode: 'dark', primary: '#7c3aed' })
  assert.equal(resolveBrandName({ ...own, useFactoryBrand: true }), FACTORY_NAME)
  assert.equal(resolveBrandName({ ...own, useFactoryBrand: false }), 'Бимар Маркет')
})

test('пустое название под своим брендом остаётся заводским', () => {
  // Клиент загрузил знак, а поле названия не заполнил: безымянная шапка хуже
  // заводской.
  assert.equal(resolveBrandName({ ...own, brandName: '' }), FACTORY_NAME)
  assert.equal(resolveBrandName({ ...own, brandName: '   ' }), FACTORY_NAME)
})

test('название магазина в бренд не попадает никаким путём', () => {
  /*
    Главная проверка файла.

    `BrandSource` вообще не содержит реквизитов — ни company.shortName, ни
    outlet.name. Пока шапка звала storeDisplayName(store), название торговой
    точки было её единственным источником; теперь такого входа у бренда нет,
    и вернуть его молча нельзя — придётся расширять тип.
  */
  const keys = Object.keys(own).sort()
  assert.deepEqual(keys, ['brandName', 'primaryColor', 'theme', 'useFactoryBrand'])
})
