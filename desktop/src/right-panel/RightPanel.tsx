import { useCallback, useEffect, useLayoutEffect, useMemo, useState,
  type MutableRefObject,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'

import { TopBar } from './components/TopBar'
import { OrderList } from './components/OrderList'
import { ActionsBar } from './components/ActionsBar'
import { PaymentFooter } from './components/PaymentFooter'
import { PaymentSuccessOverlay, type SuccessSummary } from './components/PaymentSuccessOverlay'
import { PaymentModal, type PaymentExtra } from './components/PaymentModal'
import { WeightModal, type WeightModalPayload, type WeightModalMode } from './components/WeightModal'
import { ShiftModal, type ShiftModalType } from './components/ShiftModal'
import { AdHocServiceModal } from './components/AdHocServiceModal'
import { PayDebtModal } from './components/PayDebtModal'
import { TodayJournalModal } from './components/TodayJournalModal'
import { readOnboardingCached } from '../onboarding/storage'
import { providersFromSettings } from '../payments/registry'
import {
  attachCustomerDisplay,
  publishCustomerDisplay,
} from '../customer-display/customerDisplay.client'
import { usePosConnection } from '../context/PosConnectionProvider'

import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { usePosCartKeyboard } from '../hooks/usePosCartKeyboard'
import { flushSync } from 'react-dom'

import {
  calcDiscount,
  computeOrderTotals,
  getDiscountPreviewCart,
  getLineNetTotal,
  getTotalWeight,
  hasAnyLineDiscount,
  hasDiscountInput,
  isProductCartLine,
  roundMoney2,
  sumGross,
  wait,
} from './helpers'

import type {
  CartItem,
  DeferredOrder,
  DiscountMode,
  PaymentDetails,
  PaymentMethod,
  SaleRecord,
  ShiftRecord,
} from './helpers'

import './RightPanel.css'

export type { CartItem, DeferredOrder, DiscountMode, SaleRecord, ShiftRecord }

export type RightPanelProps = {
  cashierName: string
  salesCount: number
  cartItems: CartItem[]
  images: Record<string, string | undefined>
  onUpdateQuantity: (lineId: string, delta: number) => void
  onUpdatePieceQuantity: (lineId: string, raw: string) => void
  onUpdateWeight: (lineId: string, raw: string) => void
  onAdjustWeight: (lineId: string, delta: number) => void
  onRemoveItem: (lineId: string) => void
  onRemoveItems?: (lineIds: string[]) => void
  onClearCart: () => void
  onCompleteSale: (details: PaymentDetails) => Promise<boolean>
  onApplyDiscount: (
    mode: DiscountMode,
    value: string,
    selectedLineIds: string[] | null,
    splitFixedAmount?: boolean,
  ) => void
  onClearLineDiscount?: (lineId: string) => void
  /** Синхронизация «К оплате» в шапке моноблока */
  onCheckoutTotalChange?: (total: number) => void
  onRegisterRequestPayment?: (open: (() => void) | null) => void
  /** Перед «К оплате»: зафиксировать вес с весов в чек */
  onBeforePayment?: () => void
  onPaymentBlocked?: (reason: string) => void
  /** Живой вес для модала весового товара */
  scaleDisplayKg?: number | null
  scaleWeightStable?: boolean
  onFixScaleWeight?: () => void
  deferredOrders: DeferredOrder[]
  onDeferAll: (label: string) => void
  onDeferSelected: (label: string, ids: string[]) => void
  onRestoreDeferred: (id: string) => void
  onReDeferGroupBlock: (headerLineId: string) => void
  onDeleteDeferred: (id: string) => void
  shiftOpen: boolean
  shiftRecord?: ShiftRecord | null
  /** Касса полностью инициализирована после входа */
  posReady?: boolean
  onShiftOpen: (record: ShiftRecord) => void
  onShiftClose: (record: Partial<ShiftRecord>) => void
  /**
   * Просьба открыть окно смены. Меняется — окно открывается.
   *
   * Нужна ровно для одного случая: сервер отказал в продаже, потому что смены
   * нет. Раньше это заканчивалось сообщением «откройте смену» — то есть кассир
   * читал совет и шёл искать кнопку. Теперь окно открывается само, а число тут
   * потому, что просьба может повториться подряд, а значение при этом
   * одинаково.
   */
  shiftPromptToken?: number
  discountMode: DiscountMode
  discountValue: string
  onDiscountModeChange: (mode: DiscountMode) => void
  onDiscountValueChange: (value: string) => void
  activeInputRef: MutableRefObject<HTMLInputElement | null>
  onOpenSettings: () => void
  onRefresh: () => void
  /** Накопленная выручка и число заказов за текущую смену (для модала закрытия) */
  shiftSessionRevenue?: number
  shiftSessionOrders?: number
  /** Меню «шестерёнки» в топбаре чека */
  onRepeatReceipt: () => void
  onQuickReturn: () => void
  onAddAdHocServiceLine?: (name: string, price: number) => void
  /**
   * Только экран кассы: F1 — выбор строки, `/8520` (если VK вкл.) — все строки, Enter — оплата, +−.
   * На других маршрутах не передавать.
   */
  posKeyboardShortcuts?: boolean
}

export function RightPanel({
  cashierName, salesCount,
  cartItems, images,
  onUpdateQuantity, onUpdatePieceQuantity, onUpdateWeight, onAdjustWeight,
  onRemoveItem, onRemoveItems, onClearCart, onCompleteSale, onApplyDiscount,
  onClearLineDiscount, onCheckoutTotalChange, onRegisterRequestPayment,
  onBeforePayment,
  onPaymentBlocked,
  scaleDisplayKg = null,
  scaleWeightStable = false,
  onFixScaleWeight,
  deferredOrders, onDeferAll, onDeferSelected,
  onRestoreDeferred, onReDeferGroupBlock, onDeleteDeferred,
  shiftOpen, shiftRecord = null, posReady = true, onShiftOpen, onShiftClose, shiftPromptToken = 0,
  discountMode, discountValue,
  onDiscountModeChange, onDiscountValueChange,
  activeInputRef, onOpenSettings, onRefresh,
  shiftSessionRevenue = 0,
  shiftSessionOrders = 0,
  onRepeatReceipt,
  onQuickReturn,
  onAddAdHocServiceLine,
  posKeyboardShortcuts = false,
}: RightPanelProps) {
  /* ── State ── */
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set())
  const [shiftModal, setShiftModal]       = useState<ShiftModalType | null>(null)
  const [weightModal, setWeightModal]     = useState<WeightModalPayload | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [successSummary, setSuccessSummary] = useState<SuccessSummary | null>(null)
  const [showPayModal, setShowPayModal] = useState(false)
  const [showAdHocService, setShowAdHocService] = useState(false)
  const [showPayDebt, setShowPayDebt] = useState(false)
  const [showTodayJournal, setShowTodayJournal] = useState(false)
  const [paymentProcessing, setPaymentProcessing] = useState(false)
  const navigate = useNavigate()

  /*
    Сервер отказал в продаже из-за отсутствия смены — открываем окно смены.

    Первое значение токена пропускается: иначе окно открывалось бы при каждом
    появлении панели на экране, а не по просьбе.
  */
  useEffect(() => {
    if (shiftPromptToken > 0 && !shiftOpen) setShiftModal('open')
  }, [shiftPromptToken, shiftOpen])
  const {
    isOnline,
    offlinePending,
    switching: connSwitching,
    setOffline,
    tryConnectOnline,
    refreshPendingCount,
  } = usePosConnection()
  const [stripeSelectActive, setStripeSelectActive] = useState(false)
  const [previewLockLineIds, setPreviewLockLineIds] = useState<Set<string>>(
    () => new Set(),
  )
  // Номер заказа уходит в банк вместе с суммой и возвращается в референсе
  // платежа — он должен быть свой у каждой попытки оплаты.
  const [payOrderId, setPayOrderId] = useState('')
  const [customerScreenAttached, setCustomerScreenAttached] = useState(false)

  /* ── Экран покупателя ── */
  // Провайдеры пересобираются на каждое открытие оплаты: владелец мог
  // донастроить банк в соседней вкладке настроек, не перезапуская кассу.
  const paymentProviders = useMemo(
    () => (showPayModal ? providersFromSettings() : []),
    [showPayModal],
  )

  useEffect(() => {
    if (!readOnboardingCached().acquiring.secondScreen) return
    let cancelled = false
    void attachCustomerDisplay().then((result) => {
      if (!cancelled) setCustomerScreenAttached(result.attached)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setPreviewLockLineIds(new Set())
  }, [discountValue, discountMode])

  const selectedIdsKey = useMemo(
    () => [...selectedIds].sort().join('|'),
    [selectedIds],
  )

  const displayCartItems = useMemo(
    () =>
      getDiscountPreviewCart(
        cartItems,
        discountMode,
        discountValue,
        selectionMode,
        selectedIds,
        previewLockLineIds,
      ),
    [
      cartItems,
      discountMode,
      discountValue,
      selectionMode,
      selectedIdsKey,
      previewLockLineIds,
    ],
  )

  /* ── Computed ── */
  const orderTotals = useMemo(() => {
    if (hasAnyLineDiscount(displayCartItems) || hasDiscountInput(discountValue)) {
      return computeOrderTotals(displayCartItems, 'percent', '0')
    }
    return computeOrderTotals(cartItems, discountMode, discountValue)
  }, [cartItems, displayCartItems, discountMode, discountValue])
  const subtotalGross = orderTotals.subtotalGross
  const discountAmount = orderTotals.discountTotal
  const totalToPay = orderTotals.total
  const totalWeight = useMemo(() => getTotalWeight(cartItems), [cartItems])
  const productLineCount = useMemo(
    () => cartItems.filter((i) => isProductCartLine(i)).length,
    [cartItems],
  )

  /* Корзина на экране покупателя. Пока идёт оплата состоянием управляет
     модалка оплаты — иначе набор корзины перебивал бы её QR. */
  useEffect(() => {
    if (showPayModal || showSuccess) return
    const store = readOnboardingCached()
    const storeName = store.company.shortName || 'Магазин'
    const lines = displayCartItems.filter((item) => isProductCartLine(item))
    if (lines.length === 0) {
      publishCustomerDisplay({
        screen: 'idle',
        storeName,
        // Экран покупателя — часть интерфейса, а не печати: логотипом
        // управляет тумблер «Показывать логотип в шапке», а не настройка чека.
        logo:
          !store.branding.uiLogo || store.branding.mode === 'none'
            ? undefined
            : store.branding.logo || undefined,
      })
      return
    }
    publishCustomerDisplay({
      screen: 'cart',
      storeName,
      lines: lines.map((line) => ({
        name: line.name,
        quantity: line.type === 'weight' ? `${line.weightKg} кг` : String(line.quantity),
        price: line.price,
        total: getLineNetTotal(line),
        discount: undefined,
      })),
      discountTotal: orderTotals.discountTotal,
      total: orderTotals.total,
    })
  }, [displayCartItems, orderTotals, showPayModal, showSuccess])

  /** Все товарные строки выделены (например после /8520) → Enter открывает оплату, не строку */
  const allProductLinesSelected = useMemo(() => {
    const products = cartItems.filter((i) => isProductCartLine(i))
    return (
      products.length > 0
      && products.every((p) => selectedIds.has(p.lineId))
    )
  }, [cartItems, selectedIds])

  const discountPreviewAmount = useMemo(() => {
    if (hasDiscountInput(discountValue) || hasAnyLineDiscount(displayCartItems)) {
      const base = computeOrderTotals(cartItems, 'percent', '0')
      const next = computeOrderTotals(displayCartItems, 'percent', '0')
      return Math.max(0, roundMoney2(base.total - next.total))
    }
    return calcDiscount(sumGross(cartItems), discountMode, discountValue)
  }, [cartItems, displayCartItems, discountMode, discountValue])

  useEffect(() => {
    onCheckoutTotalChange?.(orderTotals.total)
  }, [orderTotals.total, onCheckoutTotalChange])

  const openPayment = useCallback(() => {
    if (!posReady) {
      onPaymentBlocked?.('Касса инициализируется. Подождите несколько секунд.')
      return
    }
    if (!shiftOpen) {
      onPaymentBlocked?.('Смена не открыта. Нажмите «Открыть смену» справа вверху.')
      return
    }
    if (productLineCount > 0 && shiftOpen) {
      const selectedLineIds =
        selectionMode && selectedIds.size > 0 ? Array.from(selectedIds) : null
      if (hasDiscountInput(discountValue)) {
        flushSync(() => {
          onApplyDiscount(
            discountMode,
            discountValue,
            selectedLineIds,
            false,
          )
          setPreviewLockLineIds(new Set())
        })
      }
      onBeforePayment?.()
      // Свой номер на каждую попытку: банк различает платежи по нему, и
      // повторный QR после отмены не должен попасть в старый заказ.
      setPayOrderId(`CHK-${Date.now().toString(36).toUpperCase()}`)
      setShowPayModal(true)
    }
  }, [
    productLineCount,
    posReady,
    shiftOpen,
    onBeforePayment,
    onPaymentBlocked,
    discountMode,
    discountValue,
    selectionMode,
    selectedIds,
    onApplyDiscount,
  ])

  useLayoutEffect(() => {
    onRegisterRequestPayment?.(openPayment)
    return () => onRegisterRequestPayment?.(null)
  }, [onRegisterRequestPayment, openPayment])

  /* ── Selection ── */
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setSelectionMode(false)
    setStripeSelectActive(false)
  }, [])

  const handleToggleSelect = useCallback((lineId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(lineId)) {
        next.delete(lineId)
      } else {
        next.add(lineId)
        setPreviewLockLineIds((locks) => {
          if (!locks.has(lineId)) return locks
          const copy = new Set(locks)
          copy.delete(lineId)
          return copy
        })
      }
      return next
    })
  }, [])

  const handleToggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) setSelectedIds(new Set())
      return !prev
    })
  }, [])

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return
    const ids = Array.from(selectedIds)
    if (onRemoveItems) onRemoveItems(ids)
    else ids.forEach((id) => onRemoveItem(id))
    clearSelection()
  }, [selectedIds, onRemoveItems, onRemoveItem, clearSelection])

  const handleSelectAllProductLines = useCallback(() => {
    const ids = cartItems.filter(isProductCartLine).map((i) => i.lineId)
    if (ids.length === 0) return
    flushSync(() => {
      setSelectionMode(true)
      setSelectedIds(new Set(ids))
      setPreviewLockLineIds((locks) => {
        if (locks.size === 0) return locks
        const copy = new Set(locks)
        ids.forEach((id) => copy.delete(id))
        return copy
      })
    })
  }, [cartItems])

  const handleSetSelectionRange = useCallback((lineIds: string[]) => {
    if (lineIds.length === 0) return
    flushSync(() => {
      setSelectionMode(true)
      setSelectedIds(new Set(lineIds))
      setPreviewLockLineIds((locks) => {
        if (locks.size === 0) return locks
        const copy = new Set(locks)
        lineIds.forEach((id) => copy.delete(id))
        return copy
      })
    })
  }, [])

  /* ── Weight modal ── */
  const handleRequestWeightEdit = useCallback((lineId: string) => {
    const item = cartItems.find((i) => i.lineId === lineId)
    if (!item || item.type !== 'weight') return
    setWeightModal({
      mode: 'update',
      existingItem: item,
      productId: item.productId,
      productName: item.name,
      pricePerKg: item.price,
      productImage: images[item.productId],
    })
  }, [cartItems, images])

  const handleWeightConfirm = useCallback((weightKg: number, _mode: WeightModalMode) => {
    if (!weightModal?.existingItem) return
    onUpdateWeight(weightModal.existingItem.lineId, String(weightKg))
    setWeightModal(null)
  }, [weightModal, onUpdateWeight])

  const handleApplyDiscountClick = useCallback(() => {
    onApplyDiscount(
      discountMode,
      discountValue,
      selectionMode && selectedIds.size > 0 ? Array.from(selectedIds) : null,
      discountMode === 'amount',
    )
    setPreviewLockLineIds(new Set())
  }, [onApplyDiscount, discountMode, discountValue, selectionMode, selectedIds])

  const handleClearLineDiscount = useCallback(
    (lineId: string) => {
      onClearLineDiscount?.(lineId)
      setPreviewLockLineIds((prev) => new Set([...prev, lineId]))
    },
    [onClearLineDiscount],
  )

  const handlePaymentModalConfirm = useCallback(
    async (method: PaymentMethod, extra: PaymentExtra) => {
      if (paymentProcessing) return
      const summary: SuccessSummary = {
        total: orderTotals.total,
        methodLabel:
          method === 'card'
            ? // Название банка кассиру полезнее слова «Карта»: по нему потом и
              // ищут платёж в выписке.
              extra.outcome?.providerTitle ?? 'Карта'
            : method === 'mixed'
              ? 'Смешанная'
              : method === 'debt'
                ? 'В долг'
                : 'Наличные',
        change: extra.change,
        discountTotal: orderTotals.discountTotal,
        lines: displayCartItems
          .filter((i) => isProductCartLine(i))
          .map((i) => ({ name: i.name, total: getLineNetTotal(i) })),
      }
      const details: PaymentDetails = {
        method,
        cashReceived: extra.cashReceived,
        cardAmount: extra.cardAmount,
        change: extra.change,
        providerId: extra.outcome?.providerId,
        providerTitle: extra.outcome?.providerTitle,
        paymentRef: extra.outcome?.reference ?? extra.outcome?.paymentId,
        paymentConfirmation: extra.outcome?.confirmation,
      }
      setPaymentProcessing(true)
      try {
        const ok = await onCompleteSale(details)
        if (ok) {
          setShowPayModal(false)
          setSuccessSummary(summary)
          setShowSuccess(true)
          clearSelection()
        }
      } finally {
        setPaymentProcessing(false)
      }
    },
    [displayCartItems, orderTotals, onCompleteSale, clearSelection, paymentProcessing],
  )

  /* ── Restore deferred (перенос текущего чека в отложенные + подстановка — атомарно в Dashboard) ── */
  const handleRestoreDeferred = useCallback((id: string) => {
    onRestoreDeferred(id)
  }, [onRestoreDeferred])

  /* ── Shift ── */
  const handleShiftConfirm = useCallback((cashAmount: number) => {
    const now = new Date().toISOString()
    if (shiftModal === 'open') {
      onShiftOpen({ openedAt: now, openCash: cashAmount, salesTotal: 0 })
    } else if (shiftModal === 'close') {
      onShiftClose({ closedAt: now, closeCash: cashAmount, salesTotal: shiftSessionRevenue })
    }
    setShiftModal(null)
  }, [shiftModal, onShiftOpen, onShiftClose, shiftSessionRevenue])

  /* ── Connection ── */
  const handleToggleConnection = useCallback(async () => {
    if (connSwitching) return
    await wait(200)
    if (isOnline) {
      setOffline()
    } else {
      await tryConnectOnline()
    }
    refreshPendingCount()
  }, [connSwitching, isOnline, setOffline, tryConnectOnline, refreshPendingCount])

  /* ── Keyboard ── */
  const handleDeleteLast = useCallback(() => {
    if (selectionMode && selectedIds.size > 0) { handleDeleteSelected(); return }
    const products = cartItems.filter((i) => isProductCartLine(i))
    if (products.length === 0) return
    onRemoveItem(products[products.length - 1].lineId)
  }, [selectionMode, selectedIds.size, handleDeleteSelected, cartItems, onRemoveItem])

  const handleEscape = useCallback(() => {
    if (paymentProcessing) return
    if (showPayModal) { setShowPayModal(false); return }
    if (showSuccess) { setShowSuccess(false); setSuccessSummary(null); return }
    if (weightModal) { setWeightModal(null); return }
    if (shiftModal) { setShiftModal(null); return }
    if (selectionMode) { clearSelection(); return }
  }, [paymentProcessing, showPayModal, showSuccess, weightModal, shiftModal, selectionMode, clearSelection])

  const handleEnterOnSelectedLine = useCallback(() => {
    if (!posKeyboardShortcuts || !selectionMode) return
    const products = cartItems.filter((i) => isProductCartLine(i))
    if (products.length === 0) return
    const picked = products.find((p) => selectedIds.has(p.lineId)) ?? products[0]
    if (!picked) return
    if (picked.type === 'weight') handleRequestWeightEdit(picked.lineId)
    else onUpdateQuantity(picked.lineId, 1)
  }, [
    posKeyboardShortcuts,
    selectionMode,
    cartItems,
    selectedIds,
    handleRequestWeightEdit,
    onUpdateQuantity,
  ])

  useKeyboardShortcuts({
    onPay: openPayment,
    onDelLast: handleDeleteLast,
    onEsc: handleEscape,
    blockEnter: showPayModal || showSuccess,
    useEnterForLineAction:
      posKeyboardShortcuts
      && selectionMode
      && productLineCount > 0
      && !allProductLinesSelected,
    onEnterLineAction: handleEnterOnSelectedLine,
  })

  usePosCartKeyboard({
    enabled: posKeyboardShortcuts,
    blocked:
      showPayModal || showSuccess || Boolean(weightModal) || Boolean(shiftModal) || connSwitching,
    cartItems,
    selectionMode,
    selectedIds,
    setSelectionMode,
    setSelectedIds,
    onUpdateQuantity,
    clearSelection,
    onStripeSelectArmed: () => setStripeSelectActive(true),
  })

  return (
    <div className="rp">
      <div className="rp__section rp__topbar-wrap">
        <TopBar
          shiftOpen={shiftOpen}
          isOnline={isOnline}
          connectionSwitching={connSwitching}
          offlinePending={offlinePending}
          cashierName={cashierName}
          salesCount={salesCount}
          onShiftClick={() => setShiftModal(shiftOpen ? 'close' : 'open')}
          onRepeatReceipt={onRepeatReceipt}
          onQuickReturn={onQuickReturn}
          onPayDebt={() => setShowPayDebt(true)}
          onOpenTodayJournal={() => setShowTodayJournal(true)}
          onSettings={onOpenSettings}
          onRefresh={onRefresh}
          onToggleConnection={handleToggleConnection}
        />
      </div>

      <div className="rp__section rp__actions-wrap">
        <ActionsBar
          cartItems={cartItems}
          selectedIds={selectedIds}
          selectionMode={selectionMode}
          onToggleSelectionMode={handleToggleSelectionMode}
          onDeleteSelected={handleDeleteSelected}
          onSelectAllProductLines={handleSelectAllProductLines}
          deferredOrders={deferredOrders}
          onDeferAll={onDeferAll}
          onDeferSelected={onDeferSelected}
          onRestoreDeferred={handleRestoreDeferred}
          onDeleteDeferred={onDeleteDeferred}
          discountMode={discountMode}
          discountValue={discountValue}
          discountAmount={discountAmount}
          discountPreviewAmount={discountPreviewAmount}
          onDiscountModeChange={onDiscountModeChange}
          onDiscountValueChange={onDiscountValueChange}
          onApplyDiscount={handleApplyDiscountClick}
          activeInputRef={activeInputRef}
          onAddAdHocService={() => setShowAdHocService(true)}
        />
      </div>

      <div className="rp__section rp__order-wrap">
        <OrderList
          items={displayCartItems}
          selectedIds={selectedIds}
          selectionMode={selectionMode}
          stripeSelectActive={stripeSelectActive}
          images={images}
          onToggleSelect={handleToggleSelect}
          onSetSelectionRange={handleSetSelectionRange}
          onStripeSelectEnd={() => setStripeSelectActive(false)}
          onUpdateQuantity={onUpdateQuantity}
          onUpdatePieceQuantity={onUpdatePieceQuantity}
          onUpdateWeight={onUpdateWeight}
          onAdjustWeight={onAdjustWeight}
          onRemoveItem={onRemoveItem}
          onReDeferGroupBlock={onReDeferGroupBlock}
          onClearLineDiscount={handleClearLineDiscount}
          onRequestWeightEdit={handleRequestWeightEdit}
          onClear={onClearCart}
          activeInputRef={activeInputRef}
        />
      </div>

      <div className="rp__section rp__footer-wrap">
        <PaymentFooter
          itemsCount={productLineCount}
          totalWeight={totalWeight}
          discountAmount={discountAmount}
          totalToPay={totalToPay}
          onPay={openPayment}
          disabled={productLineCount === 0 || !shiftOpen || !posReady}
          disabledReason={
            !posReady
              ? 'Касса инициализируется'
              : !shiftOpen
                ? 'Смена не открыта'
                : productLineCount === 0
                  ? 'Корзина пустая'
                  : undefined
          }
        />
      </div>

      {/* ── Modals ── */}
      <AnimatePresence>
        {shiftModal && (
          <ShiftModal
            type={shiftModal}
            salesTotal={shiftModal === 'close' ? shiftSessionRevenue : subtotalGross}
            ordersCount={shiftModal === 'close' ? shiftSessionOrders : undefined}
            activeInputRef={activeInputRef}
            onConfirm={handleShiftConfirm}
            onClose={() => setShiftModal(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {weightModal && (
          <WeightModal
            payload={weightModal}
            activeInputRef={activeInputRef}
            scaleDisplayKg={scaleDisplayKg}
            scaleWeightStable={scaleWeightStable}
            onFixScaleWeight={onFixScaleWeight}
            onConfirm={handleWeightConfirm}
            onClose={() => setWeightModal(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {connSwitching && (
          <motion.div
            className="conn-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            <div className="conn-card">
              <div className="conn-spinner" />
              <strong>{isOnline ? 'Переход в офлайн…' : 'Подключение к CRM…'}</strong>
              {!isOnline && offlinePending > 0 && (
                <span>Синхронизация {offlinePending} продаж</span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPayModal && (
          <PaymentModal
            total={totalToPay}
            cashierName={cashierName}
            storeName={readOnboardingCached().company.shortName || 'Магазин'}
            providers={paymentProviders}
            orderId={payOrderId}
            mirrorCustomerScreen={!customerScreenAttached}
            processing={paymentProcessing}
            onClose={() => {
              if (!paymentProcessing) setShowPayModal(false)
            }}
            onConfirm={(m, ex) => void handlePaymentModalConfirm(m, ex)}
          />
        )}
      </AnimatePresence>

      {showAdHocService && (
        <AdHocServiceModal
          onClose={() => setShowAdHocService(false)}
          onConfirm={(name, price) => {
            onAddAdHocServiceLine?.(name, price)
            setShowAdHocService(false)
          }}
        />
      )}

      {showPayDebt && (
        <PayDebtModal
          onClose={() => setShowPayDebt(false)}
          onPaid={onRefresh}
          shiftOpen={shiftOpen}
          shiftRecord={shiftRecord}
          cashierName={cashierName}
        />
      )}

      {showTodayJournal && (
        <TodayJournalModal
          onClose={() => setShowTodayJournal(false)}
          onOpenFullJournal={() => {
            setShowTodayJournal(false)
            navigate('/panel?tab=receipts')
          }}
        />
      )}

      <AnimatePresence>
        {showSuccess && successSummary && (
          <PaymentSuccessOverlay
            summary={successSummary}
            onDone={() => {
              setShowSuccess(false)
              setSuccessSummary(null)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
