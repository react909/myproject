// src/right-panel/components/DeferredListPanel.tsx

import { memo } from 'react'
import { TrashIcon } from '../icons'
import { buildDeferredDisplay } from '../helpers'
import type { DeferredOrder } from '../helpers'

type DeferredListPanelProps = {
  orders: DeferredOrder[]
  onRestore: (id: string) => void
  onDelete: (id: string) => void
}

export const DeferredListPanel = memo(function DeferredListPanel({
  orders,
  onRestore,
  onDelete,
}: DeferredListPanelProps) {
  if (orders.length === 0) {
    return <div className="deferred-list__empty">Нет отложенных заказов</div>
  }

  return (
    <div className="deferred-list">
      {orders.map((order) => {
        const { title, goodsLine, meta } = buildDeferredDisplay(order)

        return (
          <button
            key={order.id}
            type="button"
            className="deferred-list__item"
            title={`Отложено: ${title}. Нажмите, чтобы вернуть в корзину`}
            onClick={() => onRestore(order.id)}
          >
            <div className="deferred-list__item-info">
              <strong className="deferred-list__name">{title}</strong>
              {goodsLine ? (
                <span className="deferred-list__goods">{goodsLine}</span>
              ) : null}
              <span className="deferred-list__meta">{meta}</span>
            </div>
            <div
              className="deferred-list__item-actions"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="deferred-list__delete-btn"
                onClick={() => onDelete(order.id)}
                aria-label={`Удалить отложенный чек ${title}`}
              >
                <TrashIcon />
                <span>Удалить</span>
              </button>
            </div>
          </button>
        )
      })}
    </div>
  )
})
