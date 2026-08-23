/**
 * Решения о бренде — без картинок.
 *
 * Отдельный модуль от brand.ts по одной причине: там импортируется PNG знака,
 * а сборка тестов идёт в CommonJS через node --test, где `require` картинки
 * разрешать нечем. Решения при этом и есть то, что стоит проверять: какое имя
 * попадёт в шапку и какой цвет применится при каждом режиме. Знак к ним ничего
 * не добавляет — он один и тот же файл.
 *
 * Граница, ради которой всё это заведено:
 *
 *   данные магазина (шаг 1) → реквизиты, чек, документы;
 *   бренд интерфейса (шаг 4) → шапка, экраны входа, цвет всей системы.
 *
 * Пока границы не было, шапка брала название торговой точки из реквизитов.
 */

import { DEFAULT_PRIMARY } from '../auth/applyTheme'
import type { ThemeMode } from '../auth/applyTheme'

/** Заводское название системы. */
export const FACTORY_NAME = 'Kassir ERP'

/** Заводской акцент. Тот же, что стоит в styles/tokens.css и в базе. */
export const FACTORY_ACCENT = DEFAULT_PRIMARY

/** Заводская тема. */
export const FACTORY_THEME: ThemeMode = 'light'

/**
 * Та часть оформления, от которой зависит бренд.
 *
 * Не весь `BrandingData`: модулю незачем знать про обрезку логотипа и пороги
 * термопечати, а узкий вход не даёт ошибиться в том, что здесь участвует.
 */
export type BrandSource = {
  useFactoryBrand: boolean
  brandName: string
  primaryColor: string
  theme: ThemeMode
}

/**
 * Название системы в интерфейсе.
 *
 * Пустое название под своим брендом — всё ещё «Kassir ERP»: безымянная шапка
 * хуже заводской, а поле клиент вполне может оставить незаполненным, загрузив
 * один только знак.
 */
export function resolveBrandName(branding: BrandSource): string {
  if (branding.useFactoryBrand) return FACTORY_NAME
  return branding.brandName.trim() || FACTORY_NAME
}

/**
 * Тема и акцент, которые надо применить.
 *
 * Разница видна ровно в одном случае, и он и есть смысл функции: под заводским
 * брендом система стоит в мятном, даже если в `primaryColor` лежит цвет,
 * который клиент выбирал в прошлый заход и потом вернулся к Kassir ERP.
 * Сохранённое значение при этом не стирается — переключиться обратно можно
 * одним нажатием, и цвет окажется на месте.
 */
export function brandTheme(branding: BrandSource): { mode: ThemeMode; primary: string } {
  if (branding.useFactoryBrand) return { mode: FACTORY_THEME, primary: FACTORY_ACCENT }
  return { mode: branding.theme, primary: branding.primaryColor }
}
