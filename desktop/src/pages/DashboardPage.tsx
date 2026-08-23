import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ProductCatalogPanel } from '../catalog/ProductCatalogPanel'
import { WeightInputModal } from '../catalog/WeightInputModal'
import { getProductStock, type Product } from '../catalog/mockProducts'
import { findProductsByBarcode } from '../catalog/barcodeLookup'
import { useProductsCatalog } from '../hooks/useProductsCatalog'
import { FlavorSelectModal } from '../catalog/FlavorSelectModal'
import { usePublishHeaderShowcase } from '../layout/headerShowcase'
import { useAppBootstrap } from '../hooks/useAppBootstrap'
import { useNotifications } from '../components/notifications/NotificationProvider'
import { scopedStorageKey } from '../services/accountSession'
import { loadSettings } from '../settings/appSettings'
import { useLiveScale } from '../hooks/useLiveScale'
import { useScaleStable } from '../hooks/useScaleStable'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { applyDeviceSettings, printReceipt } from '../services/devices/device.client'
import { cartLinesToPrintPayload, printCartReceipt, printShiftCloseReceipt, shiftSummaryToClosePayload, type ReceiptPrintPayload } from '../services/receiptPrint'
import { RightPanel } from '../right-panel/RightPanel'
import type {
  CartItem,
  DeferredOrder,
  DiscountMode,
  PaymentDetails,
  ShiftRecord,
} from '../right-panel/helpers'
import {
  collectProductLinesInGroupBlock,
  computeOrderTotals,
  hasAnyLineDiscount,
  hasDiscountInput,
  isProductCartLine,
  labelForAutoDeferFromCart,
  applyDiscountToCart,
  clearLineDiscount,
  computeCartPayTotal,
  createAdHocServiceCartItem,
  deferredRestoreHeaderLabel,
  pruneOrphanGroupHeaders,
  removeGroupBlockByHeaderLineId,
} from '../right-panel/helpers'
import { usePosConnection } from '../context/PosConnectionProvider'
import {
  enqueueOfflineSale,
  startOfflineRetryLoop,
  stopOfflineRetryLoop,
} from '../services/offline/transaction-queue'
import { submitPosSale } from '../services/posSales'
import {
  closeCrmShift,
  fetchCrmShiftById,
  fetchOpenCrmShiftSummary,
  isShiftRequiredError,
  openCrmShift,
  reconcilePosShiftWithCrm,
  type CrmShiftSummary,
  type ShiftSyncResult,
} from '../services/posShift'
import { invalidateCrmDataCaches } from '../services/dataInvalidation'

type DashboardPageProps = {
  username: string
  initialProducts?: Product[]
  posReady?: boolean
  initWarnings?: string[]
}

function makeLineId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function resolveCatalogPrice(product: Product, wholesale: boolean): number {
  if (wholesale && product.wholesalePrice != null && product.wholesalePrice > 0) {
    return product.wholesalePrice
  }
  return product.price
}

function toCartItem(product: Product, wholesale = false): CartItem {
  return {
    lineId: makeLineId(),
    productId: product.id,
    name: product.name,
    price: resolveCatalogPrice(product, wholesale),
    purchasePrice: product.purchasePrice,
    availableStock: product.kind === 'service' ? undefined : getProductStock(product),
    type: product.type,
    quantity: product.type === 'piece' ? 1 : 0,
    weightKg: 0,
  }
}

/** Заголовок «отложенный чек + имя» над позициями в корзине */
function makeDeferredGroupHeaderLine(label: string): CartItem {
  return {
    lineId: makeLineId(),
    isGroupHeader: true,
    groupHeaderLabel: label,
    productId: '__deferred-header',
    name: '',
    price: 0,
    type: 'piece',
    quantity: 0,
    weightKg: 0,
  }
}

function cloneCartLines(lines: CartItem[]): CartItem[] {
  return lines.map((line) => ({ ...line }))
}

type LastReceiptPayload = ReceiptPrintPayload

type PersistedDashboardState = {
  cartItems: CartItem[]
  discountMode: DiscountMode
  discountValue: string
  deferredOrders: DeferredOrder[]
  shiftRecord: ShiftRecord | null
  salesCount: number
  sessionRevenue: number
  lastReceipt: LastReceiptPayload | null
}

const POS_STATE_BASE = 'nurcrm-dashboard-state'

function posStateStorageKey(): string {
  return scopedStorageKey(POS_STATE_BASE)
}

function loadDashboardState(): PersistedDashboardState {
  try {
    const raw = localStorage.getItem(posStateStorageKey())
    if (!raw) throw new Error('empty')
    const parsed = JSON.parse(raw) as Partial<PersistedDashboardState>
    return {
      cartItems: Array.isArray(parsed.cartItems) ? parsed.cartItems : [],
      discountMode: parsed.discountMode === 'percent' ? 'percent' : 'amount',
      discountValue: typeof parsed.discountValue === 'string' ? parsed.discountValue : '0',
      deferredOrders: Array.isArray(parsed.deferredOrders) ? parsed.deferredOrders : [],
      shiftRecord: parsed.shiftRecord ?? null,
      salesCount: Number.isFinite(parsed.salesCount) ? Number(parsed.salesCount) : 0,
      sessionRevenue: Number.isFinite(parsed.sessionRevenue) ? Number(parsed.sessionRevenue) : 0,
      lastReceipt: parsed.lastReceipt ?? null,
    }
  } catch {
    return {
      cartItems: [],
      discountMode: 'amount',
      discountValue: '0',
      deferredOrders: [],
      shiftRecord: null,
      salesCount: 0,
      sessionRevenue: 0,
      lastReceipt: null,
    }
  }
}

function saveDashboardState(state: PersistedDashboardState): void {
  try {
    localStorage.setItem(posStateStorageKey(), JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

const CATALOG_WIDTH_KEY = 'nurcrm-catalog-width'

function readDefaultCatalogWidth(): number {
  try {
    const saved = localStorage.getItem(scopedStorageKey(CATALOG_WIDTH_KEY))
    if (saved) {
      const n = Number.parseInt(saved, 10)
      if (Number.isFinite(n) && n >= 260) return n
    }
  } catch {
    /* ignore */
  }
  const w = typeof window !== 'undefined' ? window.innerWidth : 1280
  return Math.round(Math.max(300, Math.min(w * 0.44, w - 340)))
}

export function DashboardPage({
  username,
  initialProducts,
  posReady = true,
  initWarnings = [],
}: DashboardPageProps) {
  useAppBootstrap(username)
  const { push } = useNotifications()
  const navigate = useNavigate()
  const persistedState = useMemo(() => loadDashboardState(), [])
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [wholesaleMode, setWholesaleMode] = useState(false)
  const [cartItems, setCartItems] = useState<CartItem[]>(() => persistedState.cartItems)
  const [discountMode, setDiscountMode] = useState<DiscountMode>(() => persistedState.discountMode)
  const [discountValue, setDiscountValue] = useState(() => persistedState.discountValue)
  const [headerPayTotal, setHeaderPayTotal] = useState(0)
  const [weightPickProduct, setWeightPickProduct] = useState<Product | null>(null)
  const [flavorPick, setFlavorPick] = useState<{ barcode: string; products: Product[] } | null>(null)
  const [deferredOrders, setDeferredOrders] = useState<DeferredOrder[]>(() => persistedState.deferredOrders)
  const [shiftRecord, setShiftRecord] = useState<ShiftRecord | null>(() => {
    if (persistedState.shiftRecord && !persistedState.shiftRecord.closedAt) {
      return persistedState.shiftRecord
    }
    return null
  })
  const [salesCount, setSalesCount] = useState(() => persistedState.salesCount)
  const [sessionRevenue, setSessionRevenue] = useState(() => persistedState.sessionRevenue)
  const [crmShiftStats, setCrmShiftStats] = useState<CrmShiftSummary | null>(null)
  /**
   * Счётчик просьб открыть смену.
   *
   * Растёт, когда сервер отказал в продаже из-за отсутствия смены. Правая
   * панель следит за ним и открывает своё окно смены. Именно счётчик, а не
   * флаг: попыток продать без смены может быть несколько подряд, и флаг,
   * который уже стоит, второй раз ничего бы не открыл.
   */
  const [shiftPromptToken, setShiftPromptToken] = useState(0)
  const [lastReceipt, setLastReceipt] = useState<LastReceiptPayload | null>(() => persistedState.lastReceipt)
  const [catalogWidth, setCatalogWidth] = useState(readDefaultCatalogWidth)
  const [catalogRev, setCatalogRev] = useState(0)
  const [refreshingAll, setRefreshingAll] = useState(false)
  const { isOnline: posOnline } = usePosConnection()

  const activeInputRef = useRef<HTMLInputElement | null>(null)

  const {
    products: apiProducts,
    isInitialLoading: productsLoading,
    isRefreshing: productsRefreshing,
    error: productsError,
    forceRefresh: forceRefreshProducts,
  } = useProductsCatalog(initialProducts)

  useEffect(() => {
    if (initWarnings.length === 0) return
    for (const warning of initWarnings) {
      if (!warning) continue
      push({
        kind: 'warning',
        title: 'Инициализация',
        message: warning,
        dismissMs: 10000,
      })
    }
  // Предупреждения показываем один раз при входе.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveDashboardState({
        cartItems,
        discountMode,
        discountValue,
        deferredOrders,
        shiftRecord,
        salesCount,
        sessionRevenue,
        lastReceipt,
      })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [
    cartItems,
    discountMode,
    discountValue,
    deferredOrders,
    shiftRecord,
    salesCount,
    sessionRevenue,
    lastReceipt,
  ])

  const shiftOpen = Boolean(shiftRecord && !shiftRecord.closedAt)

  const applyShiftSync = useCallback((sync: ShiftSyncResult) => {
    if (sync.record?.closedAt) {
      setShiftRecord(sync.record)
      setSalesCount(0)
      setSessionRevenue(0)
      setCrmShiftStats(null)
    } else if (sync.record && !sync.record.closedAt) {
      setShiftRecord(sync.record)
      if (sync.summary) {
        setCrmShiftStats(sync.summary)
        setSalesCount(sync.summary.salesCount)
        setSessionRevenue(sync.summary.salesTotal)
      }
    } else if (!sync.record) {
      setShiftRecord(null)
      setSalesCount(0)
      setSessionRevenue(0)
      setCrmShiftStats(null)
    }
    if (sync.message) {
      push({
        kind: sync.synced ? 'info' : 'warning',
        title: 'Смена',
        message: sync.message,
        dismissMs: 7000,
      })
    }
  }, [push])

  const refreshCrmShiftStats = useCallback(async () => {
    if (!shiftOpen || !posOnline) return
    const summary = shiftRecord?.crmShiftId
      ? await fetchCrmShiftById(shiftRecord.crmShiftId)
      : await fetchOpenCrmShiftSummary(shiftRecord?.cashboxId)
    if (!summary || summary.status !== 'open') return
    setCrmShiftStats(summary)
    setSalesCount(summary.salesCount)
    setSessionRevenue(summary.salesTotal)
  }, [shiftOpen, posOnline, shiftRecord?.crmShiftId, shiftRecord?.cashboxId])

  useEffect(() => {
    if (!posOnline) return
    let cancelled = false
    void reconcilePosShiftWithCrm(shiftRecord).then((sync) => {
      if (cancelled) return
      applyShiftSync(sync)
    })
    return () => {
      cancelled = true
    }
    // Сверка при входе и при восстановлении Online
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posOnline, username])

  useEffect(() => {
    if (!shiftOpen || !posOnline) return
    void refreshCrmShiftStats()
    const timer = window.setInterval(() => {
      void refreshCrmShiftStats()
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [shiftOpen, posOnline, refreshCrmShiftStats])

  const handleDashboardRefresh = useCallback(async () => {
    if (refreshingAll) return
    if (!posOnline) {
      push({
        kind: 'warning',
        title: 'CRM',
        message: 'Нет связи с CRM. Включите Online или проверьте интернет.',
        dismissMs: 6000,
      })
      return
    }
    setRefreshingAll(true)
    try {
      const [products, sync] = await Promise.all([
        forceRefreshProducts(),
        reconcilePosShiftWithCrm(shiftRecord),
      ])
      applyShiftSync(sync)
      invalidateCrmDataCaches()
      push({
        kind: 'success',
        title: 'Обновлено',
        message: `Товаров в каталоге: ${products.length}${sync.summary?.status === 'open' ? ' · смена в CRM активна' : ''}`,
        dismissMs: 5000,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Не удалось обновить данные'
      push({ kind: 'error', title: 'Обновление', message: msg, dismissMs: 7000 })
    } finally {
      setRefreshingAll(false)
    }
  }, [refreshingAll, posOnline, shiftRecord, forceRefreshProducts, applyShiftSync, push])

  useEffect(() => {
    const settings = loadSettings()
    void applyDeviceSettings(settings)
    startOfflineRetryLoop()
    const welcomeKey = `nurcrm-welcome-toast-${username}`
    if (!sessionStorage.getItem(welcomeKey)) {
      sessionStorage.setItem(welcomeKey, '1')
      push({
        kind: 'success',
        title: 'NurCRM',
        message: `Добро пожаловать обратно, ${username}`,
        dismissMs: 6000,
      })
    }
    return () => {
      stopOfflineRetryLoop()
    }
  }, [username, push])

  useEffect(() => {
    const bump = () => setCatalogRev((n) => n + 1)
    window.addEventListener('nurcrm-panel-products', bump)
    window.addEventListener('storage', bump)
    return () => {
      window.removeEventListener('nurcrm-panel-products', bump)
      window.removeEventListener('storage', bump)
    }
  }, [])

  // Каталог кассы показывает только реальные товары из CRM.
  const catalogProducts = useMemo(() => {
    return apiProducts
  }, [apiProducts])

  const images = useMemo(
    () =>
      Object.fromEntries(
        catalogProducts.map((p) => [p.id, p.image]),
      ) as Record<string, string | undefined>,
    [catalogProducts],
  )

  useEffect(() => {
    setHeaderPayTotal(computeCartPayTotal(cartItems, discountMode, discountValue))
  }, [cartItems, discountMode, discountValue])
  const liveScale = useLiveScale()
  const scaleStable = useScaleStable(liveScale)
  const scaleSettings = useMemo(() => loadSettings().scale, [catalogRev])


  const applyLiveWeightToCart = useCallback((kg: number) => {
    if (!Number.isFinite(kg) || kg <= 0) return
    const rounded = Math.round(kg * 1000) / 1000
    setCartItems((prev) => {
      const weightLines = prev.filter(
        (line) => isProductCartLine(line) && line.type === 'weight',
      )
      if (weightLines.length === 0) return prev
      const target = weightLines[weightLines.length - 1]!
      return prev.map((line) => {
        if (line.lineId !== target.lineId) return line
        const nextKg =
          line.weightKg > 0
            ? Math.round((line.weightKg + rounded) * 1000) / 1000
            : rounded
        return { ...line, weightKg: nextKg }
      })
    })
  }, [])

  /*
    Зависимости — сами числа, а не объект состояния весов.

    `useScaleStable` отдаёт новый объект на каждой отрисовке, поэтому от
    `scaleStable` целиком этот обработчик пересоздавался бы каждый раз. Пока он
    жил только в пропсах шапки, это ничего не стоило; теперь он уезжает в общую
    шапку через публикацию, а та сравнивает значения по ссылке — и вечно новый
    обработчик закрутил бы отрисовку по кругу: публикация меняет состояние
    каркаса, каркас перерисовывает кассу, касса публикует снова.

    Тот же приём строкой ниже, у lockScaleWeightForPayment.
  */
  const fixStableScaleWeight = useCallback(() => {
    const kg = scaleStable.stableKg ?? scaleStable.displayKg
    if (kg != null && kg > 0) {
      applyLiveWeightToCart(kg)
      scaleStable.resetStable()
    }
  }, [
    scaleStable.stableKg,
    scaleStable.displayKg,
    scaleStable.resetStable,
    applyLiveWeightToCart,
  ])

  const lockScaleWeightForPayment = useCallback(() => {
    const kg = scaleStable.stableKg ?? scaleStable.displayKg ?? liveScale.kg
    if (kg != null) applyLiveWeightToCart(kg)
  }, [scaleStable.stableKg, scaleStable.displayKg, liveScale.kg, applyLiveWeightToCart])

  /*
    Живые числа кассы уходят в общую шапку.

    Собраны через useMemo по самим числам, а не сложены заново на каждой
    отрисовке: свежий объект каждый раз загонял бы публикацию в бесконечный
    круг — она меняет состояние каркаса, каркас перерисовывает страницу,
    страница публикует снова.
  */
  usePublishHeaderShowcase(
    useMemo(
      () => ({
        scaleEnabled: scaleSettings.enabled,
        scaleDisplayKg: scaleStable.displayKg,
        scaleWeightStable: scaleStable.isStable,
        onFixScaleWeight: fixStableScaleWeight,
        totalRub: headerPayTotal,
        salesCount: shiftOpen ? salesCount : 0,
        shiftOpen,
        shiftRevenue: shiftOpen ? (crmShiftStats?.salesTotal ?? sessionRevenue) : 0,
      }),
      [
        scaleSettings.enabled,
        scaleStable.displayKg,
        scaleStable.isStable,
        fixStableScaleWeight,
        headerPayTotal,
        shiftOpen,
        salesCount,
        crmShiftStats?.salesTotal,
        sessionRevenue,
      ],
    ),
  )

  const patchCart = useCallback(
    (fn: (prev: CartItem[]) => CartItem[]) => {
      startTransition(() => setCartItems(fn))
    },
    [],
  )

  const handleAddProduct = useCallback((product: Product) => {
    const isService = product.kind === 'service'
    const stock = isService ? undefined : getProductStock(product)
    const inCartQty = cartItems
      .filter((line) => line.productId === product.id && !line.isGroupHeader)
      .reduce((sum, line) => sum + (line.type === 'weight' ? line.weightKg : line.quantity), 0)
    if (!isService && typeof stock === 'number' && stock <= inCartQty) {
      push({
        kind: 'error',
        title: 'Товар не хватает',
        message: `${product.name}: на складе ${stock <= 0 ? 'нет остатка' : `осталось ${stock}`}.`,
        dismissMs: 6000,
      })
      return
    }
    if (product.type === 'weight') {
      setWeightPickProduct(product)
      return
    }
    patchCart((prev) => {
      const existing = prev.find(
        (line) => line.productId === product.id && !line.isGroupHeader,
      )
      if (!existing) return [...prev, toCartItem(product, wholesaleMode)]

      return prev.map((line) => {
        if (line.lineId !== existing.lineId) return line
        return { ...line, quantity: line.quantity + 1 }
      })
    })
  }, [cartItems, patchCart, push, wholesaleMode])

  const handleAddAdHocServiceLine = useCallback((name: string, price: number) => {
    if (!Number.isFinite(price) || price <= 0) return
    patchCart((prev) => [...prev, createAdHocServiceCartItem(name, price)])
  }, [patchCart])

  const handleScanBarcode = useCallback(
    (barcode: string) => {
      void window.devicesAPI?.reportBarcodeScan?.(barcode)
      const matches = findProductsByBarcode(catalogProducts, barcode)
      if (matches.length === 0) {
        push({
          kind: 'warning',
          title: 'Штрихкод',
          message: `Товар не найден: ${barcode}`,
          dismissMs: 2500,
        })
        return
      }
      if (matches.length === 1) {
        handleAddProduct(matches[0]!)
        return
      }
      setFlavorPick({ barcode, products: matches })
    },
    [catalogProducts, handleAddProduct, push],
  )

  useBarcodeScanner({
    enabled: true,
    blocked: Boolean(weightPickProduct || flavorPick),
    onBarcode: handleScanBarcode,
  })

  const handleWeightPickConfirm = useCallback(
    (product: Product, weightKg: number) => {
      const kg = Math.max(0.001, Math.round(weightKg * 1000) / 1000)
      const stock = getProductStock(product)
      const inCartKg = cartItems
        .filter((line) => line.productId === product.id && !line.isGroupHeader)
        .reduce((sum, line) => sum + line.weightKg, 0)
      if (typeof stock === 'number' && inCartKg + kg > stock) {
        push({
          kind: 'error',
          title: 'Товар не хватает',
          message: `${product.name}: на складе ${stock} кг, в чеке уже ${inCartKg} кг.`,
          dismissMs: 6000,
        })
        return
      }
      patchCart((prev) => {
        const existing = prev.find(
          (line) => line.productId === product.id && !line.isGroupHeader,
        )
        if (!existing) {
          return [...prev, { ...toCartItem(product, wholesaleMode), weightKg: kg }]
        }
        return prev.map((line) => {
          if (line.lineId !== existing.lineId) return line
          return {
            ...line,
            weightKg: Math.round((line.weightKg + kg) * 1000) / 1000,
          }
        })
      })
      setWeightPickProduct(null)
    },
    [cartItems, patchCart, push, wholesaleMode],
  )

  const handleRemoveItems = useCallback(
    (lineIds: string[]) => {
      const drop = new Set(lineIds)
      patchCart((prev) => pruneOrphanGroupHeaders(prev.filter((line) => !drop.has(line.lineId))))
    },
    [patchCart],
  )

  const handleCompleteSale = async (details: PaymentDetails) => {
    const lines = cartItems.filter(isProductCartLine)
    const effectiveLines =
      hasDiscountInput(discountValue) && !hasAnyLineDiscount(lines)
        ? applyDiscountToCart(lines, discountMode, discountValue, null, false)
        : lines
    const effectiveTotals = computeOrderTotals(effectiveLines, discountMode, discountValue)
    if (effectiveTotals.total <= 0) return false
    const paymentLabel =
      details.method === 'card'
        ? // Оплату по QR печатаем с названием банка: «Оплата по QR · MBank»
          // ищется в выписке, а безликая «Карта» — нет.
          details.providerTitle
          ? `Оплата по QR · ${details.providerTitle}`
          : 'Карта'
        : details.method === 'mixed'
          ? 'Смешанная'
          : details.method === 'debt'
            ? 'В долг'
            : 'Наличные'
    const receiptPayload = cartLinesToPrintPayload(effectiveLines, {
      cashier: username,
      total: effectiveTotals.total,
      discountTotal: effectiveTotals.discountTotal,
      paymentMethod: paymentLabel,
      cashReceived: details.cashReceived,
      change: details.change,
      paymentRef: details.paymentRef,
      // «Успешно завершено» печатаем только когда завершение подтвердил банк.
      paymentConfirmed: details.paymentConfirmation === 'auto',
    })
    let completed = false
    if (!posOnline) {
      enqueueOfflineSale(cloneCartLines(effectiveLines), effectiveTotals.total, details, {
        discountMode,
        discountValue,
      })
      push({
        kind: 'info',
        title: 'Офлайн',
        message: 'Чек в локальной очереди. Синхронизация при Online.',
        dismissMs: 6000,
      })
      completed = true
    } else {
      try {
        const result = await submitPosSale({
          items: cloneCartLines(effectiveLines),
          payment: details,
          discountMode,
          discountValue,
          shift: shiftRecord
            ? {
                crmShiftId: shiftRecord.crmShiftId,
                cashboxId: shiftRecord.cashboxId,
                openCash: shiftRecord.openCash,
              }
            : undefined,
        })
        if (result.crmShift && shiftRecord && !shiftRecord.closedAt) {
          setShiftRecord((prev) =>
            prev && !prev.closedAt
              ? {
                  ...prev,
                  crmShiftId: result.crmShift!.shiftId,
                  cashboxId: result.crmShift!.cashboxId,
                }
              : prev,
          )
        }
        push({
          kind: 'success',
          message: 'Чек отправлен в CRM',
          dismissMs: 4000,
        })
        completed = true
      } catch (err: any) {
        const status = err?.response?.status
        const detail = err?.response?.data?.detail ?? err?.message ?? 'CRM не приняла чек.'
        /*
          Смены нет — не советуем, а предлагаем открыть.

          Раньше здесь был текст «Нажмите „Открыть смену“ вверху справа»: то
          есть система знала, что делать, и сообщала об этом словами, оставляя
          человека искать кнопку с полным чеком на руках. Теперь окно смены
          открывается само, а чек остаётся в корзине — после открытия смены
          оплату повторяют одним нажатием.
        */
        const needsShift = isShiftRequiredError(err)
        if (needsShift) setShiftPromptToken((token) => token + 1)
        push({
          kind: status === 400 ? 'error' : 'warning',
          title: needsShift ? 'Смена' : 'CRM',
          message: needsShift ? `${detail} Чек сохранён в корзине.` : detail,
          dismissMs: 8000,
        })
        return false
      }
    }

    if (!completed) return false

    // Продажа уже в CRM — сразу обновляем кассу и закрываем оплату,
    // печать не должна держать интерфейс.
    setSalesCount((v) => v + 1)
    setSessionRevenue((v) => v + effectiveTotals.total)
    void refreshCrmShiftStats()
    setLastReceipt(receiptPayload)
    setCartItems([])
    setDiscountValue('0')

    const printSettings = loadSettings()
    if (printSettings.printer.enabled && printSettings.printer.printOnPayment) {
      try {
        const printResult = await printCartReceipt(effectiveLines, {
          cashier: username,
          total: effectiveTotals.total,
          discountTotal: effectiveTotals.discountTotal,
          paymentMethod: paymentLabel,
          cashReceived: details.cashReceived,
          change: details.change,
        })
        if (printResult?.ok) {
          push({ kind: 'success', message: 'Чек напечатан' })
        } else if (printResult?.message) {
          push({ kind: 'error', title: 'Принтер', message: printResult.message, dismissMs: 8000 })
        }
      } catch {
        push({
          kind: 'error',
          title: 'Принтер',
          message: 'Не удалось отправить чек на печать',
          dismissMs: 8000,
        })
      }
    }

    return true
  }

  const handleRepeatReceipt = useCallback(async () => {
    if (!lastReceipt) {
      push({ kind: 'warning', message: 'Пока нет последнего чека для повтора' })
      return
    }
    const settings = loadSettings()
    const result = await printReceipt(lastReceipt, settings)
    if (result?.ok) {
      push({ kind: 'success', message: 'Дубликат последнего чека напечатан' })
    } else {
      push({
        kind: 'error',
        title: 'Принтер',
        message: result?.message ?? 'Не удалось напечатать чек',
      })
    }
  }, [lastReceipt, push])

  /**
   * Вернуть отложенный чек: одно обновление очереди (текущий чек в конец, затем вынуть id),
   * чтобы батчинг React не «терял» шаги; корзина и скидка подставляются из вынутого заказа.
   */
  const handleRestoreDeferred = useCallback((id: string) => {
    const snap = cartItems
    const hasLiveCart = snap.some(isProductCartLine)
    let pulled: DeferredOrder | undefined

    flushSync(() => {
      setDeferredOrders((prev) => {
        let list = [...prev]
        if (hasLiveCart) {
          const productsOnly = snap.filter((line) => !line.isGroupHeader)
          list.push({
            id: makeLineId(),
            createdAt: new Date().toISOString(),
            label: labelForAutoDeferFromCart(snap),
            items: cloneCartLines(productsOnly),
            discountMode,
            discountValue,
          })
        }
        const idx = list.findIndex((o) => o.id === id)
        if (idx < 0) return prev
        pulled = list[idx]!
        return list.filter((o) => o.id !== id)
      })
    })

    if (!pulled) return

    const lines = cloneCartLines(pulled.items)
  const headerLabel = deferredRestoreHeaderLabel(pulled)
    setCartItems([makeDeferredGroupHeaderLine(headerLabel), ...lines])
    setDiscountMode(pulled.discountMode)
    setDiscountValue(pulled.discountValue)
  }, [cartItems, discountMode, discountValue])

  /** Кнопка «снова в отложенные» рядом с именем блока — убираем блок из чека и кладём в список отложенных. */
  const handleReDeferGroupBlock = useCallback(
    (headerLineId: string) => {
      const snap = cartItems
      const header = snap.find(
        (i) => i.lineId === headerLineId && i.isGroupHeader,
      )
      const products = collectProductLinesInGroupBlock(snap, headerLineId)
      if (!header || products.length === 0) return

      const newDefer: DeferredOrder = {
        id: makeLineId(),
        createdAt: new Date().toISOString(),
        label: header.groupHeaderLabel?.trim() || 'Отложено',
        items: cloneCartLines(products),
        discountMode,
        discountValue,
      }

      flushSync(() => {
        setCartItems(removeGroupBlockByHeaderLineId(snap, headerLineId))
        setDeferredOrders((list) => [...list, newDefer])
      })
    },
    [cartItems, discountMode, discountValue],
  )

  const handleSplitterPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const target = event.currentTarget
    const grid = gridRef.current
    if (!grid) return

    target.setPointerCapture(event.pointerId)

    const min = 260
    const minRightPanel = 300
    const max = Math.max(min, grid.clientWidth - minRightPanel)
    const storageKey = scopedStorageKey(CATALOG_WIDTH_KEY)

    const onMove = (e: PointerEvent) => {
      const rect = grid.getBoundingClientRect()
      const next = e.clientX - rect.left
      setCatalogWidth(Math.min(max, Math.max(min, next)))
    }

    const onUp = (e: PointerEvent) => {
      try {
        target.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
      setCatalogWidth((w) => {
        try {
          localStorage.setItem(storageKey, String(w))
        } catch {
          /* ignore */
        }
        return w
      })
    }

    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }, [])

  return (
    <>
      <div className="screen-content">
        <div className="main-workspace">
          <div className="dashboard-screen">
            <div className="dashboard-grid" ref={gridRef}>
              {flavorPick && (
                <FlavorSelectModal
                  products={flavorPick.products}
                  barcode={flavorPick.barcode}
                  onPick={(p) => {
                    setFlavorPick(null)
                    handleAddProduct(p)
                  }}
                  onClose={() => setFlavorPick(null)}
                />
              )}

              {weightPickProduct && (
                <WeightInputModal
                  key={weightPickProduct.id}
                  product={weightPickProduct}
                  presetKg={liveScale.kg ?? scaleStable.displayKg}
                  scaleConnected={liveScale.connected}
                  scaleReading={liveScale}
                  onConfirm={handleWeightPickConfirm}
                  onClose={() => setWeightPickProduct(null)}
                />
              )}

              <aside className="catalog-aside" style={{ width: `${catalogWidth}px` }}>
                <ProductCatalogPanel
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onAddProduct={handleAddProduct}
                  activeInputRef={activeInputRef}
                  products={catalogProducts}
                  largeCards
                  loading={productsLoading}
                  refreshing={productsRefreshing}
                  error={productsError}
                  onRefresh={() => void forceRefreshProducts()}
                  wholesaleMode={wholesaleMode}
                  onWholesaleModeChange={setWholesaleMode}
                />
              </aside>

              <div
                className="dashboard-splitter"
                role="separator"
                aria-orientation="vertical"
                aria-label="Изменить ширину: влево — больше чек, вправо — больше товары"
                onPointerDown={handleSplitterPointerDown}
              >
                <span className="dashboard-splitter-grip" />
              </div>

              <div className="sale-panel-flex">
                <RightPanel
                  cashierName={username}
                  salesCount={salesCount}
                  cartItems={cartItems}
                  images={images}
                  onUpdateQuantity={(lineId, delta) =>
                    patchCart((prev) =>
                      prev.map((line) => {
                        if (line.lineId !== lineId) return line
                        const next = Math.max(1, line.quantity + delta)
                        if (typeof line.availableStock === 'number' && next > line.availableStock) {
                          push({ kind: 'error', title: 'Товар не хватает', message: `${line.name}: осталось ${line.availableStock}` })
                          return line
                        }
                        return { ...line, quantity: next }
                      }),
                    )
                  }
                  onUpdatePieceQuantity={(lineId, raw) =>
                    patchCart((prev) =>
                      prev.map((line) => {
                        if (line.lineId !== lineId || line.type !== 'piece') return line
                        const n = Math.floor(Number.parseFloat(raw.replace(',', '.')))
                        if (!Number.isFinite(n) || n < 1) return line
                        if (typeof line.availableStock === 'number' && n > line.availableStock) {
                          push({ kind: 'error', title: 'Товар не хватает', message: `${line.name}: осталось ${line.availableStock}` })
                          return line
                        }
                        return { ...line, quantity: Math.min(9999, n) }
                      }),
                    )
                  }
                  onUpdateWeight={(lineId, raw) =>
                    patchCart((prev) =>
                      prev.map((line) => {
                        if (line.lineId !== lineId) return line
                        const next = Number.parseFloat(raw.replace(',', '.'))
                        if (typeof line.availableStock === 'number' && Number.isFinite(next) && next > line.availableStock) {
                          push({ kind: 'error', title: 'Товар не хватает', message: `${line.name}: осталось ${line.availableStock} кг` })
                          return line
                        }
                        return { ...line, weightKg: Number.isFinite(next) && next > 0 ? next : line.weightKg }
                      }),
                    )
                  }
                  onAdjustWeight={(lineId, delta) =>
                    patchCart((prev) =>
                      prev.map((line) => {
                        if (line.lineId !== lineId) return line
                        const next = Math.max(0.001, line.weightKg + delta)
                        if (typeof line.availableStock === 'number' && next > line.availableStock) {
                          push({ kind: 'error', title: 'Товар не хватает', message: `${line.name}: осталось ${line.availableStock} кг` })
                          return line
                        }
                        return { ...line, weightKg: next }
                      }),
                    )
                  }
                  onRemoveItem={(lineId) => handleRemoveItems([lineId])}
                  onRemoveItems={handleRemoveItems}
                  onClearCart={() => patchCart(() => [])}
                  onCompleteSale={handleCompleteSale}
                  onApplyDiscount={(mode, value, selectedLineIds, splitFixedAmount) => {
                    setDiscountMode(mode)
                    setDiscountValue(value)
                    setCartItems((prev) =>
                      applyDiscountToCart(prev, mode, value, selectedLineIds, splitFixedAmount),
                    )
                  }}
                  onClearLineDiscount={(lineId) => {
                    setCartItems((prev) => clearLineDiscount(prev, lineId))
                  }}
                  onCheckoutTotalChange={setHeaderPayTotal}
                  deferredOrders={deferredOrders}
                  onDeferAll={(label) => {
                    const productsOnly = cartItems.filter((line) => !line.isGroupHeader)
                    if (productsOnly.length === 0) return
                    const deferred: DeferredOrder = {
                      id: makeLineId(),
                      createdAt: new Date().toISOString(),
                      label,
                      items: cloneCartLines(productsOnly),
                      discountMode,
                      discountValue,
                    }
                    setDeferredOrders((prev) => [...prev, deferred])
                    setCartItems([])
                  }}
                  onDeferSelected={(label, ids) => {
                    const selected = cartItems.filter(
                      (line) => !line.isGroupHeader && ids.includes(line.lineId),
                    )
                    if (selected.length === 0) return
                    const deferred: DeferredOrder = {
                      id: makeLineId(),
                      createdAt: new Date().toISOString(),
                      label,
                      items: cloneCartLines(selected),
                      discountMode,
                      discountValue,
                    }
                    setDeferredOrders((prev) => [...prev, deferred])
                    setCartItems((prev) =>
                      pruneOrphanGroupHeaders(prev.filter((line) => !ids.includes(line.lineId))),
                    )
                  }}
                  onRestoreDeferred={handleRestoreDeferred}
                  onReDeferGroupBlock={handleReDeferGroupBlock}
                  onDeleteDeferred={(id) =>
                    setDeferredOrders((prev) => prev.filter((order) => order.id !== id))
                  }
                  shiftOpen={shiftOpen}
                  shiftRecord={shiftRecord}
                  shiftPromptToken={shiftPromptToken}
                  shiftSessionRevenue={crmShiftStats?.salesTotal ?? sessionRevenue}
                  shiftSessionOrders={shiftOpen ? salesCount : 0}
                  posReady={posReady}
                  onPaymentBlocked={(reason) => {
                    if (!posReady) {
                      push({
                        kind: 'warning',
                        title: 'Касса',
                        message: 'Касса ещё инициализируется. Подождите несколько секунд.',
                        dismissMs: 5000,
                      })
                      return
                    }
                    push({
                      kind: 'warning',
                      title: 'Смена',
                      message: reason,
                      dismissMs: 6000,
                    })
                  }}
                  onShiftOpen={(record) => {
                    void (async () => {
                      try {
                        const crm = await openCrmShift(record.openCash)
                        setShiftRecord({
                          ...record,
                          crmShiftId: crm.shiftId,
                          cashboxId: crm.cashboxId,
                        })
                        setSalesCount(0)
                        setSessionRevenue(0)
                        setCrmShiftStats(null)
                        void fetchCrmShiftById(crm.shiftId).then((summary) => {
                          if (!summary) return
                          setCrmShiftStats(summary)
                          setSalesCount(summary.salesCount)
                          setSessionRevenue(summary.salesTotal)
                        })
                        push({
                          kind: 'success',
                          title: 'Смена',
                          message: 'Смена открыта в кассе и в CRM',
                          dismissMs: 4000,
                        })
                      } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : 'Не удалось открыть смену в CRM'
                        push({
                          kind: 'error',
                          title: 'Смена',
                          message: msg,
                          dismissMs: 8000,
                        })
                      }
                    })()
                  }}
                  onShiftClose={(record) => {
                    void (async () => {
                      const shiftId = shiftRecord?.crmShiftId
                      const closeStats = crmShiftStats
                      try {
                        if (shiftId && posOnline) {
                          await closeCrmShift(shiftId, record.closeCash ?? 0)
                        }
                        setShiftRecord((prev) => (prev ? { ...prev, ...record } : null))
                        setSalesCount(0)
                        setSessionRevenue(0)
                        setCrmShiftStats(null)
                        const settings = loadSettings()
                        if (settings.printer.enabled) {
                          const zPayload = shiftSummaryToClosePayload(
                            {
                              shiftId: shiftId ?? '',
                              cashboxId: shiftRecord?.cashboxId ?? 'local',
                              status: 'closed',
                              openingCash: shiftRecord?.openCash ?? 0,
                              salesCount: closeStats?.salesCount ?? salesCount,
                              salesTotal: closeStats?.salesTotal ?? sessionRevenue,
                              cashboxName: closeStats?.cashboxName,
                            },
                            username,
                            record.closeCash ?? 0,
                            shiftRecord?.openedAt,
                            record.closedAt,
                          )
                          void printShiftCloseReceipt(zPayload).then((printResult) => {
                            if (printResult?.ok) {
                              push({ kind: 'success', message: 'Z-отчёт напечатан', dismissMs: 4000 })
                            } else if (printResult?.message) {
                              push({ kind: 'warning', title: 'Принтер', message: printResult.message, dismissMs: 6000 })
                            }
                          })
                        }
                        push({
                          kind: 'info',
                          title: 'Смена',
                          message: 'Смена закрыта',
                          dismissMs: 4000,
                        })
                      } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : 'Не удалось закрыть смену в CRM'
                        push({
                          kind: 'warning',
                          title: 'Смена',
                          message: `${msg}. Локально смена закрыта.`,
                          dismissMs: 8000,
                        })
                        setShiftRecord((prev) => (prev ? { ...prev, ...record } : null))
                        setSalesCount(0)
                        setSessionRevenue(0)
                        setCrmShiftStats(null)
                      }
                    })()
                  }}
                  discountMode={discountMode}
                  discountValue={discountValue}
                  onDiscountModeChange={setDiscountMode}
                  onDiscountValueChange={setDiscountValue}
                  activeInputRef={activeInputRef}
                  onOpenSettings={() => navigate('/settings')}
                  onRefresh={() => void handleDashboardRefresh()}
                  onRepeatReceipt={() => void handleRepeatReceipt()}
                  onQuickReturn={() => navigate('/receipts')}
                  onAddAdHocServiceLine={handleAddAdHocServiceLine}
                  onBeforePayment={lockScaleWeightForPayment}
                  scaleDisplayKg={scaleStable.displayKg}
                  scaleWeightStable={scaleStable.isStable}
                  onFixScaleWeight={fixStableScaleWeight}
                  posKeyboardShortcuts
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
