/**
 * Устройство шага «Оформление».
 *
 * Шаг проверяется целиком, а не по одному полю, потому что ломается он именно
 * как целое: достаточно забыть `when` у одного поля, и настройка цвета снова
 * вылезет у магазина, который работает под заводским брендом, — а собрать это
 * глазами можно только пройдя мастер до четвёртого шага.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sectionsForStep } from './fields'
import { createOnboardingDraft } from './types'
import type { OnboardingData } from './types'

/** Номер шага «Оформление» в реестре. Человеку он показывается четвёртым. */
const BRAND_STEP = 3

function draft(useFactoryBrand: boolean): OnboardingData {
  const data = createOnboardingDraft()
  data.branding.useFactoryBrand = useFactoryBrand
  return data
}

function layout(useFactoryBrand: boolean): { section: string; ids: string[] }[] {
  return sectionsForStep(BRAND_STEP, draft(useFactoryBrand)).map(({ section, fields }) => ({
    section,
    ids: fields.map((field) => field.id),
  }))
}

test('под заводским брендом настраивать нечего', () => {
  const sections = layout(true)
  const names = sections.map((item) => item.section)

  // Выбор режима — и подпись на чеке, которая к бренду не относится.
  assert.deepEqual(names, ['Бренд системы', 'Чек'])
  assert.deepEqual(sections[0].ids, ['branding.factoryBrand'])
})

test('всё оформление собрано в одной секции своего бренда', () => {
  const sections = layout(false)
  const own = sections.find((item) => item.section === 'Свой бренд')
  assert.ok(own, 'секции «Свой бренд» нет')

  // Порядок важен: название первым — его чаще всего и путают с реквизитами.
  assert.deepEqual(own.ids, [
    'branding.brandName',
    'branding.logo',
    'branding.logoTextEditor',
    'branding.theme',
    'branding.primaryColor',
    'branding.receiptLook',
  ])
})

test('отдельных секций «Тема интерфейса» и «Цвета» больше нет', () => {
  for (const factory of [true, false]) {
    const names = layout(factory).map((item) => item.section)
    assert.ok(!names.includes('Тема интерфейса'), `«Тема интерфейса» осталась (factory=${factory})`)
    assert.ok(!names.includes('Цвета'), `«Цвета» остались (factory=${factory})`)
    assert.ok(
      !names.includes('Логотип в интерфейсе'),
      `«Логотип в интерфейсе» остался отдельной секцией (factory=${factory})`,
    )
  }
})

test('тема и цвет под заводским брендом не спрашиваются', () => {
  const ids = layout(true).flatMap((item) => item.ids)
  assert.ok(!ids.includes('branding.theme'))
  assert.ok(!ids.includes('branding.primaryColor'))
  assert.ok(!ids.includes('branding.brandName'))
})

test('подпись на чеке остаётся в обоих режимах', () => {
  // Это не бренд, а текст на ленте: телефон, Instagram, «Спасибо за покупку».
  // Спрятать его внутрь своего бренда значило бы отнять его у большинства.
  for (const factory of [true, false]) {
    const ids = layout(factory).flatMap((item) => item.ids)
    assert.ok(ids.includes('branding.receiptFooter'), `подписи нет (factory=${factory})`)
  }
})

test('признаки оборудования живут на первом шаге, и по одному разу', () => {
  // Сенсорный экран и камера — параметры устройства, а не оформления. Дубль
  // на другом шаге означал бы две галочки на одно значение.
  const data = createOnboardingDraft()
  for (const step of [0, 1, 2, 3, 4, 5]) {
    const ids = sectionsForStep(step, data).flatMap((item) => item.fields.map((f) => f.id))
    const touch = ids.filter((id) => id === 'branding.touchScreen').length
    const camera = ids.filter((id) => id === 'branding.hasCamera').length
    assert.equal(touch, step === 0 ? 1 : 0, `сенсорный экран на шаге ${step}`)
    assert.equal(camera, step === 0 ? 1 : 0, `камера на шаге ${step}`)
  }
})
