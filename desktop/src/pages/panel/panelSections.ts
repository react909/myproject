/**
 * Разделы панели управления.
 *
 * Один список на всё: по нему рисуется ряд кнопок в шапке, по нему же маршрут
 * решает, что показать. Пока список жил внутри страницы панели, шапка о нём не
 * знала вовсе — и её пришлось бы заводить заново со своей копией.
 *
 * Денег владельца здесь нет. «Финансы» и «Аналитика» стояли в этом списке под
 * замком: замок оставлял их видимыми, кассир знал, что раздел есть, и пробовал
 * стучаться. Теперь их нет ни пунктом, ни ссылкой — они за дверью владельца.
 *
 * ПОРЯДОК ЗНАЧИМ. Кнопки раскладываются в два ряда «змейкой» по столбцам:
 * первый столбец — первый и второй разделы, второй столбец — третий и
 * четвёртый, и так далее. Поэтому соседи по списку оказываются друг под другом,
 * и порядок здесь — это раскладка на экране, а не просто перечисление.
 */

import type { ComponentType } from 'react'
import {
  IcoAddProduct,
  IcoPurchase,
  IcoReceipts,
  IcoReport,
  IcoShift,
  IcoSuppliers,
} from './panelIcons'

export type PanelSectionId =
  | 'receipts'
  | 'product-report'
  | 'add-product'
  | 'shift'
  | 'purchase'
  | 'suppliers'

export type PanelSection = {
  id: PanelSectionId
  /** Надпись на кнопке. Коротко: ряд листается, длинные не помещаются. */
  label: string
  /**
   * Вторая строка на кнопке, 11 px приглушённым.
   *
   * Не украшение: разделов стало шесть, и по одному слову «Закупка» не
   * очевидно, приход это или расход. Подпись отвечает на этот вопрос, не
   * заставляя открывать раздел.
   */
  hint: string
  /** Что внутри — читается под заголовком раздела, не на кнопке. */
  caption: string
  icon: ComponentType<{ className?: string }>
}

export const PANEL_SECTIONS: readonly PanelSection[] = [
  {
    id: 'receipts',
    label: 'Журнал чеков',
    hint: 'продажи и возвраты',
    caption: 'Продажи, возвраты, долги',
    icon: IcoReceipts,
  },
  {
    id: 'product-report',
    label: 'Отчёт товаров',
    hint: 'продано и осталось',
    caption: 'Продано и осталось',
    icon: IcoReport,
  },
  {
    id: 'add-product',
    label: 'Добавить товар',
    hint: 'новая карточка',
    caption: 'Товар, услуга или комплект — сразу в каталог кассы',
    icon: IcoAddProduct,
  },
  {
    id: 'shift',
    label: 'Смена',
    hint: 'касса и наличные',
    caption: 'Открытие, движение денег, закрытие',
    icon: IcoShift,
  },
  {
    id: 'purchase',
    label: 'Закупка',
    hint: 'приход от поставщика',
    caption: 'Накладные, проведение, ценники',
    icon: IcoPurchase,
  },
  {
    id: 'suppliers',
    label: 'Поставщики',
    hint: 'долги и цены',
    caption: 'Справочник, расчёты, сравнение цен',
    icon: IcoSuppliers,
  },
] as const

/** Куда попадает тот, кто открыл панель без параметров. */
export const DEFAULT_PANEL_SECTION: PanelSectionId = 'receipts'

/**
 * Раздел из адреса.
 *
 * Ссылка на убранный раздел («?tab=finance» из закладки или из чужой подсказки)
 * приводит на журнал чеков — молча, без объяснения, что раздел где-то есть.
 */
export function panelSectionFrom(raw: string | null): PanelSectionId {
  const found = PANEL_SECTIONS.find((section) => section.id === raw)
  return found ? found.id : DEFAULT_PANEL_SECTION
}

export function panelSectionById(id: PanelSectionId): PanelSection {
  return PANEL_SECTIONS.find((section) => section.id === id) ?? PANEL_SECTIONS[0]
}
