import { memo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { IcoTrash } from '../icons'
import { formatMoney, formatTimeShort, getLineTotal } from '../helpers'
import type { DeferredOrder } from '../helpers'

type SessionSwitcherProps = {
  orders: DeferredOrder[]
  onRestore: (id: string) => void
  onDelete: (id: string) => void
}

function getDeferredTotal(order: DeferredOrder): number {
  return order.items.reduce((s, i) => s + getLineTotal(i), 0)
}

export const SessionSwitcher = memo(function SessionSwitcher({
  orders, onRestore, onDelete,
}: SessionSwitcherProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  if (orders.length === 0) {
    return (
      <div className="ss__empty">
        <span>Нет отложенных чеков</span>
      </div>
    )
  }

  return (
    <div className="ss">
      <div className="ss__scroll" ref={scrollRef}>
        <AnimatePresence initial={false}>
          {orders.map((order) => (
            <motion.div
              key={order.id}
              className="ss__card"
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.14 }}
            >
              {/* Restore zone */}
              <button
                type="button"
                className="ss__restore"
                onClick={() => onRestore(order.id)}
              >
                <span className="ss__name">{order.label}</span>
                <span className="ss__meta">
                  {order.items.length}&nbsp;поз.
                  &nbsp;·&nbsp;
                  {formatTimeShort(order.createdAt)}
                </span>
                <span className="ss__total">
                  {formatMoney(getDeferredTotal(order))}&nbsp;сом
                </span>
              </button>

              {/* Delete */}
              <button
                type="button"
                className="ss__delete"
                onClick={(e) => { e.stopPropagation(); onDelete(order.id) }}
                aria-label={`Удалить чек ${order.label}`}
              >
                <IcoTrash />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
})