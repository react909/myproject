import {
  memo, useRef, useEffect, useState, useCallback,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { motion } from 'framer-motion'
import { CartRow } from './CartRow'
import { CartGroupRow } from './CartGroupRow'
import { IcoCartEmpty } from '../icons'
import {
  getProductLineIds,
  lineIdFromPoint,
  selectionRangeIds,
} from '../cartSelection'
import { isProductCartLine, type CartItem } from '../helpers'

type OrderListProps = {
  items: CartItem[]
  selectedIds: Set<string>
  selectionMode: boolean
  /** После /8520 — подсказка «ведите вниз» */
  stripeSelectActive?: boolean
  images: Record<string, string | undefined>
  onToggleSelect: (lineId: string) => void
  /** Заменить выделение диапазоном (drag-stripe), не merge */
  onSetSelectionRange: (lineIds: string[]) => void
  onStripeSelectEnd?: () => void
  onUpdateQuantity: (lineId: string, delta: number) => void
  onUpdatePieceQuantity: (lineId: string, raw: string) => void
  onUpdateWeight: (lineId: string, raw: string) => void
  onAdjustWeight: (lineId: string, delta: number) => void
  onRemoveItem: (lineId: string) => void
  onReDeferGroupBlock: (headerLineId: string) => void
  onClearLineDiscount?: (lineId: string) => void
  onRequestWeightEdit: (lineId: string) => void
  onClear: () => void
  activeInputRef: MutableRefObject<HTMLInputElement | null>
}

const ITEM_ANIM = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.04 },
} as const

const DRAG_THRESHOLD_PX = 2
const STRIPE_DRAG_THRESHOLD_PX = 12
const RANGE_THROTTLE_MS = 48

export const OrderList = memo(function OrderList({
  items,
  selectedIds,
  selectionMode,
  stripeSelectActive = false,
  images,
  onToggleSelect,
  onSetSelectionRange,
  onStripeSelectEnd,
  onUpdateQuantity,
  onUpdatePieceQuantity,
  onUpdateWeight,
  onAdjustWeight,
  onRemoveItem,
  onReDeferGroupBlock,
  onClearLineDiscount,
  onRequestWeightEdit,
  onClear,
  activeInputRef,
}: OrderListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const prevLen = useRef(items.length)
  const [newIds, setNewIds] = useState<Set<string>>(new Set())

  const itemsRef = useRef(items)
  const selectedIdsRef = useRef(selectedIds)
  const selectionModeRef = useRef(selectionMode)
  const stripeActiveRef = useRef(stripeSelectActive)
  const onSetRangeRef = useRef(onSetSelectionRange)
  const onToggleRef = useRef(onToggleSelect)
  const onStripeEndRef = useRef(onStripeSelectEnd)

  itemsRef.current = items
  selectedIdsRef.current = selectedIds
  selectionModeRef.current = selectionMode
  stripeActiveRef.current = stripeSelectActive
  onSetRangeRef.current = onSetSelectionRange
  onToggleRef.current = onToggleSelect
  onStripeEndRef.current = onStripeSelectEnd

  const dragRef = useRef<{
    pointerId: number
    anchorId: string
    startX: number
    startY: number
    dragging: boolean
    lastRangeKey: string
    lastRangeAt: number
  } | null>(null)

  const applyRange = useCallback((anchorId: string, currentId: string) => {
    const order = getProductLineIds(itemsRef.current)
    const ids = selectionRangeIds(order, anchorId, currentId)
    if (ids.length === 0) return
    const key = ids.join('|')
    const st = dragRef.current
    if (st && st.lastRangeKey === key) return
    const now = performance.now()
    if (st && now - st.lastRangeAt < RANGE_THROTTLE_MS) return
    if (st) {
      st.lastRangeKey = key
      st.lastRangeAt = now
    }
    onSetRangeRef.current(ids)
  }, [])

  const endDrag = useCallback((pointerId: number) => {
    const st = dragRef.current
    if (!st || st.pointerId !== pointerId) return
    dragRef.current = null
    onStripeEndRef.current?.()
  }, [])

  const onScrollPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!selectionModeRef.current) return
    if (e.button !== 0) return
    const t = e.target as Element
    if (t.closest('button, input, textarea, .cr__del, .cr__step, .cr__quick')) return

    const order = getProductLineIds(itemsRef.current)
    if (order.length === 0) return

    const hitId = lineIdFromPoint(e.clientX, e.clientY)
    let anchorId = order[0]!
    if (stripeActiveRef.current) {
      const armed = order.find((id) => selectedIdsRef.current.has(id))
      if (armed) anchorId = armed
    } else if (hitId && order.includes(hitId)) {
      anchorId = hitId
    }

    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()

    dragRef.current = {
      pointerId: e.pointerId,
      anchorId,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      lastRangeKey: '',
      lastRangeAt: 0,
    }
  }, [])

  const onScrollPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragRef.current
    if (!st || st.pointerId !== e.pointerId) return

    const moved = Math.hypot(e.clientX - st.startX, e.clientY - st.startY)
    const threshold = stripeActiveRef.current
      ? STRIPE_DRAG_THRESHOLD_PX
      : DRAG_THRESHOLD_PX
    if (!st.dragging && moved >= threshold) {
      st.dragging = true
    }
    if (!st.dragging) return

    e.preventDefault()
    const currentId = lineIdFromPoint(e.clientX, e.clientY)
    const orderNow = getProductLineIds(itemsRef.current)
    if (!currentId || !orderNow.includes(currentId)) {
      const anchorIdx = orderNow.indexOf(st.anchorId)
      if (anchorIdx < 0) return
      const y = e.clientY
      const rows = scrollRef.current?.querySelectorAll('[data-cart-line]')
      if (!rows?.length) return
      let bestId = st.anchorId
      let bestDist = Infinity
      rows.forEach((node) => {
        const id = node.getAttribute('data-cart-line')
        if (!id || !orderNow.includes(id)) return
        const rect = node.getBoundingClientRect()
        const cy = rect.top + rect.height / 2
        const d = Math.abs(cy - y)
        if (d < bestDist) {
          bestDist = d
          bestId = id
        }
      })
      applyRange(st.anchorId, bestId)
      return
    }
    applyRange(st.anchorId, currentId)
  }, [applyRange])

  const onScrollPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragRef.current
    if (!st || st.pointerId !== e.pointerId) return

    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }

    if (!st.dragging && !stripeActiveRef.current) {
      onToggleRef.current(st.anchorId)
    }
    endDrag(e.pointerId)
  }, [endDrag])

  const onScrollPointerCancel = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    endDrag(e.pointerId)
  }, [endDrag])

  useEffect(() => {
    if (items.length > prevLen.current) {
      const latestId = items[items.length - 1]?.lineId
      if (latestId) {
        setNewIds((prev) => new Set([...prev, latestId]))
        setTimeout(() => {
          setNewIds((prev) => {
            const next = new Set(prev)
            next.delete(latestId)
            return next
          })
        }, 400)
      }
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'auto' })
    }
    prevLen.current = items.length
  }, [items])

  const fastSel = selectionMode

  return (
    <div className={`ol${fastSel ? ' ol--stripe' : ''}`}>
      <div className="ol__header">
        <div className="ol__header-left">
          <span className="ol__title">Текущий чек</span>
          <span className="ol__badge">{items.length}</span>
        </div>
        {items.length > 0 && (
          <button type="button" className="ol__clear-btn" onClick={onClear}>
            Очистить
          </button>
        )}
      </div>

      {selectionMode && items.length > 0 && (
        <div className={`ol__sel-hint${stripeSelectActive ? ' ol__sel-hint--stripe' : ''}`}>
          {stripeSelectActive
            ? 'Ведите пальцем вниз или вверх — строки выделяются по ходу'
            : 'Зажмите на строке и ведите — выделится полоса товаров'}
        </div>
      )}

      <div
        ref={scrollRef}
        className={`ol__scroll${selectionMode ? ' ol__scroll--selecting' : ''}${stripeSelectActive ? ' ol__scroll--stripe-ready' : ''}`}
        onPointerDown={onScrollPointerDown}
        onPointerMove={onScrollPointerMove}
        onPointerUp={onScrollPointerUp}
        onPointerCancel={onScrollPointerCancel}
      >
        {items.length > 0 ? (
          items.map((item, idx) =>
            item.isGroupHeader ? (
              fastSel ? (
                <div key={item.lineId} className="ol__row-wrap ol__row-wrap--group">
                  <CartGroupRow
                    label={item.groupHeaderLabel ?? 'Отложенный чек'}
                    onRemove={() => onRemoveItem(item.lineId)}
                    onReDeferToHold={(() => {
                      let hasP = false
                      for (let k = idx + 1; k < items.length; k++) {
                        const it = items[k]!
                        if (it.isGroupHeader) break
                        if (isProductCartLine(it)) {
                          hasP = true
                          break
                        }
                      }
                      return hasP ? () => onReDeferGroupBlock(item.lineId) : undefined
                    })()}
                  />
                </div>
              ) : (
                <motion.div
                  key={item.lineId}
                  {...ITEM_ANIM}
                  className="ol__row-wrap ol__row-wrap--group"
                >
                  <CartGroupRow
                    label={item.groupHeaderLabel ?? 'Отложенный чек'}
                    onRemove={() => onRemoveItem(item.lineId)}
                    onReDeferToHold={(() => {
                      let hasP = false
                      for (let k = idx + 1; k < items.length; k++) {
                        const it = items[k]!
                        if (it.isGroupHeader) break
                        if (isProductCartLine(it)) {
                          hasP = true
                          break
                        }
                      }
                      return hasP ? () => onReDeferGroupBlock(item.lineId) : undefined
                    })()}
                  />
                </motion.div>
              )
            ) : fastSel ? (
              <div
                key={item.lineId}
                data-cart-line={item.lineId}
                className={`ol__row-wrap${selectedIds.has(item.lineId) ? ' ol__row-wrap--selected' : ''}`}
              >
                <CartRow
                  item={item}
                  image={images[item.productId]}
                  index={idx}
                  isNew={newIds.has(item.lineId)}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(item.lineId)}
                  onUpdateQuantity={onUpdateQuantity}
                  onUpdatePieceQuantity={onUpdatePieceQuantity}
                  onUpdateWeight={onUpdateWeight}
                  onAdjustWeight={onAdjustWeight}
                  onRemoveItem={onRemoveItem}
                  onClearLineDiscount={onClearLineDiscount}
                  onOpenWeightEdit={onRequestWeightEdit}
                  activeInputRef={activeInputRef}
                />
              </div>
            ) : (
              <motion.div
                key={item.lineId}
                {...ITEM_ANIM}
                data-cart-line={item.lineId}
                className={`ol__row-wrap${selectedIds.has(item.lineId) ? ' ol__row-wrap--selected' : ''}`}
              >
                <CartRow
                  item={item}
                  image={images[item.productId]}
                  index={idx}
                  isNew={newIds.has(item.lineId)}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(item.lineId)}
                  onUpdateQuantity={onUpdateQuantity}
                  onUpdatePieceQuantity={onUpdatePieceQuantity}
                  onUpdateWeight={onUpdateWeight}
                  onAdjustWeight={onAdjustWeight}
                  onRemoveItem={onRemoveItem}
                  onClearLineDiscount={onClearLineDiscount}
                  onOpenWeightEdit={onRequestWeightEdit}
                  activeInputRef={activeInputRef}
                />
              </motion.div>
            ),
          )
        ) : (
          <div className="ol__empty">
            <IcoCartEmpty />
            <strong>Чек пуст</strong>
            <span>Добавьте товар из каталога или отсканируйте штрихкод</span>
          </div>
        )}
      </div>
    </div>
  )
})
