/**
 * Шапка панели: ряд разделов и кнопка «Добавить товар».
 *
 * Собрано в один узел, потому что шапка приложения принимает от страницы ровно
 * одно место — середину (см. headerMode). Разделы и добавление товара делят
 * его: разделы тянутся, кнопка стоит справа фиксированной ширины.
 *
 * Почему «Добавить товар» — отдельная кнопка, а не седьмой раздел в ряду. Её
 * нажимают чаще любого раздела: товары заводят пачками. Пункт в листающемся
 * ряду означал бы листать перед каждым новым товаром, а на сенсорном экране
 * ещё и промахиваться.
 */

import { PanelSectionRail } from './PanelSectionRail'
import type { PanelSectionId } from './panelSections'

function IcoPlus() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

type Props = {
  active: PanelSectionId
  onSelect: (id: PanelSectionId) => void
  onAddProduct: () => void
}

export function PanelHeaderNav({ active, onSelect, onAddProduct }: Props) {
  return (
    <div className="pnav">
      <div className="pnav__rail">
        <PanelSectionRail active={active} onSelect={onSelect} />
      </div>
      <button
        type="button"
        className="pnav__add"
        onClick={onAddProduct}
        title="Добавить товар — пробел"
      >
        <IcoPlus />
        <span>Добавить товар</span>
        <kbd className="pnav__key">Пробел</kbd>
      </button>
    </div>
  )
}
