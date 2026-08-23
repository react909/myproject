import {
  memo, useCallback, useMemo, useRef, useState,
  type MutableRefObject,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  IcoHold, IcoList, IcoDiscount,
  IcoSelect, IcoTrash, IcoChevDown,
} from '../icons'
import { DeferredListPanel } from './DeferredListPanel'
import { DiscountPanel } from './DiscountPanel'
import { DeferModal } from './DeferModal'
import { isProductCartLine, productNamesDeferFull, type CartItem, type DeferredOrder, type DiscountMode } from '../helpers'

type SubPanel = 'none' | 'deferred' | 'discount'

type ActionsBarProps = {
  cartItems: CartItem[]
  selectedIds: Set<string>
  selectionMode: boolean
  onToggleSelectionMode: () => void
  onDeleteSelected: () => void
  onSelectAllProductLines: () => void
  deferredOrders: DeferredOrder[]
  onDeferAll: (label: string) => void
  onDeferSelected: (label: string, ids: string[]) => void
  onRestoreDeferred: (id: string) => void
  onDeleteDeferred: (id: string) => void
  discountMode: DiscountMode
  discountValue: string
  discountAmount: number
  discountPreviewAmount: number
  onDiscountModeChange: (mode: DiscountMode) => void
  onDiscountValueChange: (value: string) => void
  onApplyDiscount: () => void
  activeInputRef: MutableRefObject<HTMLInputElement | null>
  onAddAdHocService?: () => void
}

const SLIDE = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit:    { height: 0, opacity: 0 },
  transition: { duration: 0.13, ease: 'easeOut' },
} as const

export const ActionsBar = memo(function ActionsBar({
  cartItems, selectedIds, selectionMode,
  onToggleSelectionMode, onDeleteSelected, onSelectAllProductLines,
  deferredOrders, onDeferAll, onDeferSelected,
  onRestoreDeferred, onDeleteDeferred,
  discountMode, discountValue, discountAmount, discountPreviewAmount,
  onDiscountModeChange, onDiscountValueChange, onApplyDiscount,
  activeInputRef, onAddAdHocService,
}: ActionsBarProps) {
  const [open, setOpen] = useState(false)
  const [subPanel, setSubPanel] = useState<SubPanel>('none')
  const [showDeferModal, setShowDeferModal] = useState(false)
  const deferredRef = useRef(deferredOrders)
  deferredRef.current = deferredOrders

  const defaultProductLabel = useMemo(
    () => productNamesDeferFull(cartItems),
    [cartItems],
  )

  const toggleSubPanel = useCallback((panel: SubPanel) => {
    setOpen(true)
    setSubPanel((p) => (p === panel ? 'none' : panel))
  }, [])

  /** Очередь FIFO: читаем актуальный [0] из ref, чтобы клик не брал устаревший id. */
  const handleReturnCheck = useCallback(() => {
    const next = deferredRef.current[0]
    if (!next) return
    onRestoreDeferred(next.id)
  }, [onRestoreDeferred])

  const handleDeferSubmit = useCallback(
    (payload: { label: string; mode: 'all' | 'selected' }) => {
      if (payload.mode === 'selected' && selectedIds.size > 0) {
        onDeferSelected(payload.label, Array.from(selectedIds))
      } else {
        onDeferAll(payload.label)
      }
      setShowDeferModal(false)
    },
    [selectedIds, onDeferSelected, onDeferAll],
  )

  const handleApplyDiscount = useCallback(() => {
    onApplyDiscount()
  }, [onApplyDiscount])

  return (
    <div className="ab">
      <div className="ab__header">
        <div className="ab__header-left">
          {selectionMode && (
            <span className="ab__sel-chip">
              Выбрано:&nbsp;<strong>{selectedIds.size}</strong>
            </span>
          )}
        </div>
        <button
          type="button"
          className={`ab__toggle${open ? ' is-open' : ''}`}
          onClick={() => {
            setOpen((v) => {
              if (v) setSubPanel('none')
              return !v
            })
          }}
        >
          <span>Действия</span>
          <IcoChevDown className="ab__chevron" />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="ab__panel" {...SLIDE}>
            {/* Toolbar */}
            <div className="ab__toolbar">
              <button
                type="button"
                className={`ab__tool-btn${selectionMode ? ' is-active' : ''}`}
                onClick={onToggleSelectionMode}
              >
                <IcoSelect />
                <span>{selectionMode ? 'Снять выбор' : 'Выбрать'}</span>
              </button>
              {selectionMode && (
                <>
                  <button
                    type="button"
                    className="ab__tool-btn"
                    onClick={onSelectAllProductLines}
                    disabled={!cartItems.some(isProductCartLine)}
                  >
                    <span>Все</span>
                  </button>
                  <button
                    type="button"
                    className="ab__tool-btn ab__tool-btn--danger"
                    onClick={onDeleteSelected}
                    disabled={selectedIds.size === 0}
                  >
                    <IcoTrash />
                    <span>Удалить{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}</span>
                  </button>
                </>
              )}
            </div>

            {/* Action grid */}
            <div className="ab__grid">
              <button
                type="button"
                className="ab__act ab__act--amber"
                disabled={!cartItems.some(isProductCartLine)}
                onClick={() => {
                  if (!cartItems.some(isProductCartLine)) return
                  setShowDeferModal(true)
                }}
              >
                <IcoHold />
                <span>Отложить</span>
              </button>

              <button
                type="button"
                className={`ab__act ab__act--outline${subPanel === 'deferred' ? ' is-active' : ''}`}
                onClick={() => toggleSubPanel('deferred')}
              >
                <IcoList />
                <span>Отложенные</span>
                {deferredOrders.length > 0 && (
                  <em className="ab__act-badge">{deferredOrders.length}</em>
                )}
              </button>

              <button
                type="button"
                className={`ab__act ab__act--graphite${subPanel === 'discount' ? ' is-active' : ''}`}
                onClick={() => toggleSubPanel('discount')}
              >
                <IcoDiscount />
                <span>Скидка</span>
                {discountAmount > 0 && <em className="ab__act-badge">−</em>}
              </button>

              <button
                type="button"
                className="ab__act ab__act--service"
                onClick={() => {
                  setOpen(false)
                  onAddAdHocService?.()
                }}
              >
                <span className="ab__act-service-mark">+</span>
                <span>Доп. услуга</span>
              </button>

              <button
                type="button"
                className="ab__act ab__act--return-check ab__act--muted"
                disabled={deferredOrders.length === 0}
                title={deferredOrders.length === 0 ? 'Нет отложенных чеков' : 'Следующий в очереди в текущий чек (цикл)'}
                onClick={handleReturnCheck}
              >
                <IcoHold />
                <span className="ab__act-ticket-cap">
                  <span className="ab__act-ticket-l1">Вернуть</span>
                  <span className="ab__act-ticket-l2">чек</span>
                </span>
                {deferredOrders.length > 0 && (
                  <em className="ab__act-badge">{deferredOrders.length}</em>
                )}
              </button>
            </div>

            {/* Sub-panels */}
            <AnimatePresence initial={false}>
              {subPanel === 'deferred' && (
                <motion.div key="deferred" className="ab__subpanel ab__subpanel--deferred" {...SLIDE}>
                  <div className="ab__deferred-head">
                    <p className="ab__subpanel-title">Отложенные чеки</p>
                    <p className="ab__deferred-hint">
                      Список сверху вниз — порядок очереди: «Вернуть чек» берёт первый; если в корзине уже есть товары,
                      они уходят в конец очереди, затем в корзину подставляется выбранный отложенный.
                    </p>
                  </div>
                  <DeferredListPanel
                    orders={deferredOrders}
                    onRestore={onRestoreDeferred}
                    onDelete={onDeleteDeferred}
                  />
                </motion.div>
              )}
              {subPanel === 'discount' && (
                <motion.div
                  key="discount"
                  className="ab__subpanel ab__subpanel--compact"
                  {...SLIDE}
                >
                  <p className="ab__subpanel-title">Скидка</p>
                  <DiscountPanel
                    mode={discountMode}
                    value={discountValue}
                    previewAmount={discountPreviewAmount}
                    selectionMode={selectionMode}
                    selectedCount={selectedIds.size}
                    onModeChange={onDiscountModeChange}
                    onValueChange={onDiscountValueChange}
                    onApply={handleApplyDiscount}
                    activeInputRef={activeInputRef}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeferModal && (
          <DeferModal
            selectionMode={selectionMode}
            selectedCount={selectedIds.size}
            totalCount={cartItems.filter(isProductCartLine).length}
            defaultProductLabel={defaultProductLabel}
            activeInputRef={activeInputRef}
            onClose={() => setShowDeferModal(false)}
            onSubmit={handleDeferSubmit}
          />
        )}
      </AnimatePresence>
    </div>
  )
})