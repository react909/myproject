/**
 * Бренд интерфейса — единственный источник знака, названия и цвета системы.
 *
 * Здесь проходит граница, которой раньше не было: бренд интерфейса и данные
 * магазина — разные вещи.
 *
 *   Данные магазина (шаг 1): название, город, улица, телефон. Это реквизиты —
 *   они печатаются в чеке и в документах. В шапку приложения они не попадают
 *   никогда.
 *
 *   Бренд интерфейса (шаг 4): знак, название и основной цвет. Это то, как
 *   выглядит сама программа, и к тому, как называется магазин, отношения не
 *   имеет.
 *
 * Пока границы не было, шапка показывала `storeDisplayName(store)` — название
 * магазина из реквизитов. Магазин «Глобус» превращал кассу в программу
 * «Глобус», хотя никакого своего бренда не заводил.
 *
 * Сами решения — в resolve.ts, отдельным модулем без картинок: так их
 * покрывает тест. Здесь к ним добавляется знак.
 */

import kassirMark from '../assets/kassir-logo.png'
import {
  FACTORY_ACCENT,
  FACTORY_NAME,
  FACTORY_THEME,
  brandTheme,
  resolveBrandName,
} from './resolve'
import type { ThemeMode } from '../auth/applyTheme'
import type { BrandingData } from '../onboarding/types'

export { brandTheme }

/**
 * Заводской бренд.
 *
 * Знак — один файл на весь проект. Копий больше нет: их было пять на три
 * разных изображения, и экраны расходились между собой — мастер показывал
 * одно, шапка другое. Иконка окна и фавиконка собираются из этого же файла
 * (см. scripts/build-win-icon.mjs).
 */
export const FACTORY_BRAND = {
  name: FACTORY_NAME,
  mark: kassirMark,
  accent: FACTORY_ACCENT,
  theme: FACTORY_THEME,
} as const

/** Готовый ответ «как сейчас выглядит система». Без «если» на стороне вида. */
export type ResolvedBrand = {
  /** Название в шапке и на экранах входа. Никогда не пустое. */
  name: string
  /** Знак. Никогда не пустой: заводской подставляется сам. */
  mark: string
  /** Основной цвет системы. */
  accent: string
  theme: ThemeMode
  /** Работаем под заводским брендом. */
  isFactory: boolean
}

/**
 * Оформление → бренд. Единственное место, где это решается.
 *
 * Возврат к заводскому бренду ничего не стирает. `useFactoryBrand` — это
 * переключатель режима, а не команда «забудь настройки»: клиент вправе
 * попробовать свой бренд, вернуться к Kassir ERP и передумать обратно, не
 * загружая логотип заново. Поэтому здесь режим ВЫБИРАЕТ, что показать, а
 * сохранённые поля остаются лежать нетронутыми.
 */
export function resolveBrand(branding: BrandingData): ResolvedBrand {
  const theme = brandTheme(branding)
  return {
    name: resolveBrandName(branding),
    // Порядок отката: готовый экранный размер, потом исходник, потом заводской
    // знак. Тот же, что был в шапке, — только теперь он один на все экраны, а
    // не переписан в каждом заново.
    mark: branding.useFactoryBrand
      ? FACTORY_BRAND.mark
      : branding.logoVariants.s128 || branding.logo || FACTORY_BRAND.mark,
    accent: theme.primary,
    theme: theme.mode,
    isFactory: branding.useFactoryBrand,
  }
}
