// src/settings/appSettings.ts

import { DEFAULT_HIDDEN_ACCESS } from '../auth/hiddenAccess'
import type { HiddenAccessShortcuts } from '../auth/hiddenAccess'

export type ScaleProtocol = 'sum1' | 'sum2'

/** Режим скорости опроса весов: обычный / быстрый / супербыстрый. */
export type ScaleSpeedMode = 'normal' | 'fast' | 'turbo'

/**
 * Пресеты скорости весов.
 * prDelay — интервал опроса (сек), repeatRequest — повтор команды,
 * stableHoldMs — сколько вес должен «устояться» для фиксации.
 */
export const SCALE_SPEED_PRESETS: Record<
  ScaleSpeedMode,
  { prDelay: number; repeatRequest: number; stableHoldMs: number }
> = {
  normal: { prDelay: 0.5, repeatRequest: 1, stableHoldMs: 2200 },
  fast: { prDelay: 0.25, repeatRequest: 1, stableHoldMs: 1300 },
  turbo: { prDelay: 0.12, repeatRequest: 2, stableHoldMs: 700 },
}

export type DisplaySettings = {
  largeProductCards: boolean
}

export type PrinterEncodingMode =
  | 'auto'
  | 'force_russian'
  | 'cp1251'
  | 'cp866'
  | 'chinese_pos'
  | 'legacy_escpos'
  | 'utf8_fallback'
  | 'bitmap_raster'
  | 'manual'

export type PrinterProfileId =
  | 'auto'
  | 'sunmi'
  | 'posiflex'
  | 'custom_china'
  | 'generic_escpos'
  | 'legacy_chinese'

export type PrinterManualEncoding =
  | 'CP866'
  | 'CP1251'
  | 'IBM866'
  | 'KOI8-R'
  | 'ISO-8859-5'
  | 'UTF-8'

export type PrinterPaperWidth = '58' | '80'

export type PrinterSettings = {
  enabled: boolean
  portOrPath: string
  printOnPayment: boolean
  profile: PrinterProfileId
  encodingMode: PrinterEncodingMode
  manualEncoding: PrinterManualEncoding
  manualCodePage: string
  repeatPrint: number
  /** Ширина ленты: 58мм (384 точки) или 80мм (576 точек). */
  paperWidth: PrinterPaperWidth
  /** Масштаб основного текста (товары, итог): 0.65 … 1.2 */
  fontScale: number
  /** Масштаб шапки (название магазина): 0.7 … 1.1 */
  headerScale: number
  /** Межстрочный интервал: 0.9 … 1.35 */
  lineSpacing: number
  /** Компактный чек — меньше отступы, агрессивнее перенос длинных названий */
  compactMode: boolean
  /** Жирный текст (для чёткости на бледных принтерах). */
  boldText: boolean
  activeStrategyId?: string
}

/** Ширина печати в точках для bitmap-рендера. */
export const PAPER_WIDTH_DOTS: Record<PrinterPaperWidth, number> = {
  '58': 384,
  '80': 576,
}

export type ScaleSettings = {
  enabled: boolean
  protocol: ScaleProtocol
  comPort: 'COM1' | 'COM2' | 'COM3' | 'COM4' | 'COM5' | 'COM6' | 'COM7' | 'COM8'
  baudRate: 4800 | 9600 | 19200 | 38400 | 57600 | 115200
  requestWeightHex: string
  speedMode: ScaleSpeedMode
  prDelay: number
  repeatRequest: number
}

/**
 * Только QR для оплаты картой. Названия магазина, адреса и телефона здесь
 * намеренно нет: это реквизиты, они живут в OnboardingData и приходят с
 * сервера. Когда они дублировались здесь, чек печатался из этой копии, а не
 * из того, что вводили при регистрации.
 */
export type PaymentQrSettings = {
  imageDataUrl?: string
  paymentUrl?: string
}

export type UpdateSettings = {
  currentVersion: string
  updateUrl: string
  lastChecked: string | null
  autoCheck: boolean
  availableVersion: string | null
}

const DEFAULT_UPDATE_URL = ''
const LEGACY_UPDATE_URLS = new Set([
  'https://updates.nurcrm.kz/desktop/',
  'https://api.nurcrm.kz/updates/check',
  'https://app.nurcrm.kg/updates/',
])

export type SystemSettings = {
  startWithWindows: boolean
  showKeyboardOnFocus: boolean
  alwaysFullscreen: boolean
  /**
   * Прилипает ли кнопка вызова клавиатуры к краю экрана.
   *
   * Включено — брошенная кнопка сама подъезжает к ближайшему краю и не остаётся
   * посреди рабочего экрана. Выключено — остаётся ровно там, где отпустили: на
   * широком мониторе кассы иногда нужно поставить её именно посередине, рядом с
   * полем, в которое печатают.
   */
  keyboardSnapToEdge: boolean
}

export type AppSettings = {
  display: DisplaySettings
  printer: PrinterSettings
  scale: ScaleSettings
  paymentQr: PaymentQrSettings
  system: SystemSettings
  updates: UpdateSettings
  /**
   * Сочетания для скрытых настроек. Лежат в настройках, а не в коде, чтобы
   * специалист мог поменять их на точке без пересборки приложения.
   */
  hiddenAccess: HiddenAccessShortcuts
}

export const DEFAULT_SETTINGS: AppSettings = {
  display: {
    largeProductCards: false,
  },
  printer: {
    enabled: true,
    portOrPath: 'LPT1',
    printOnPayment: true,
    profile: 'generic_escpos',
    encodingMode: 'auto',
    manualEncoding: 'CP1251',
    manualCodePage: '46',
    repeatPrint: 0,
    paperWidth: '58',
    fontScale: 0.92,
    headerScale: 0.88,
    lineSpacing: 1.1,
    compactMode: true,
    boldText: true,
  },
  scale: {
    enabled: false,
    protocol: 'sum1',
    comPort: 'COM2',
    baudRate: 9600,
    requestWeightHex: '05',
    speedMode: 'fast',
    prDelay: SCALE_SPEED_PRESETS.fast.prDelay,
    repeatRequest: SCALE_SPEED_PRESETS.fast.repeatRequest,
  },
  paymentQr: {},
  system: {
    startWithWindows: false,
    showKeyboardOnFocus: true,
    alwaysFullscreen: true,
    keyboardSnapToEdge: true,
  },
  updates: {
    currentVersion: '1.1.1',
    updateUrl: DEFAULT_UPDATE_URL,
    lastChecked: null,
    autoCheck: false,
    availableVersion: null,
  },
  hiddenAccess: DEFAULT_HIDDEN_ACCESS,
}

function migratePrinter(raw: Record<string, unknown>): PrinterSettings {
  const d = DEFAULT_SETTINGS.printer
  const enc = raw.encoding as string | undefined
  let encodingMode = (raw.encodingMode as PrinterEncodingMode) ?? 'auto'
  if (!raw.encodingMode && enc === 'CP1251') encodingMode = 'cp1251'
  if (!raw.encodingMode && enc === 'CP866') encodingMode = 'cp866'

  const paperWidth: PrinterPaperWidth = raw.paperWidth === '80' ? '80' : '58'
  const rawScale = Number(raw.fontScale)
  const fontScale = Number.isFinite(rawScale) ? Math.max(0.65, Math.min(1.2, rawScale)) : d.fontScale
  const rawHeader = Number(raw.headerScale)
  const headerScale = Number.isFinite(rawHeader) ? Math.max(0.7, Math.min(1.1, rawHeader)) : d.headerScale
  const rawSpacing = Number(raw.lineSpacing)
  const lineSpacing = Number.isFinite(rawSpacing) ? Math.max(0.9, Math.min(1.35, rawSpacing)) : d.lineSpacing

  return {
    ...d,
    ...(raw as Partial<PrinterSettings>),
    enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : d.enabled,
    printOnPayment: raw.printOnPayment !== undefined ? Boolean(raw.printOnPayment) : d.printOnPayment,
    profile: (raw.profile as PrinterProfileId) ?? 'generic_escpos',
    encodingMode,
    manualEncoding: (raw.manualEncoding as PrinterManualEncoding) ?? (enc as PrinterManualEncoding) ?? 'CP1251',
    manualCodePage: String(raw.manualCodePage ?? raw.codePage ?? '46'),
    paperWidth,
    fontScale,
    headerScale,
    lineSpacing,
    compactMode: raw.compactMode !== undefined ? Boolean(raw.compactMode) : d.compactMode,
    boldText: raw.boldText !== undefined ? Boolean(raw.boldText) : true,
  }
}

function inferSpeedMode(raw: Record<string, unknown>): ScaleSpeedMode {
  const stored = raw.speedMode
  if (stored === 'normal' || stored === 'fast' || stored === 'turbo') return stored
  // Старые настройки без режима — выводим из интервала опроса.
  const pr = Number(raw.prDelay)
  if (Number.isFinite(pr)) {
    if (pr >= 0.4) return 'normal'
    if (pr <= 0.15) return 'turbo'
  }
  return 'fast'
}

function migrateScale(raw: Record<string, unknown>): ScaleSettings {
  const d = DEFAULT_SETTINGS.scale
  const protocol = (raw.protocol as ScaleProtocol) ?? 'sum1'
  const speedMode = inferSpeedMode(raw)
  const preset = SCALE_SPEED_PRESETS[speedMode]
  return {
    ...d,
    ...(raw as Partial<ScaleSettings>),
    protocol,
    speedMode,
    // Режим — источник истины: интервал и повтор всегда соответствуют пресету.
    prDelay: preset.prDelay,
    repeatRequest: preset.repeatRequest,
    requestWeightHex:
      protocol === 'sum1'
        ? '05'
        : String(raw.requestWeightHex ?? '05'),
  }
}

function mergeStoredIntoDefaults(raw: Partial<Record<string, unknown>>): AppSettings {
  const d = DEFAULT_SETTINGS
  const rawUpdates = (raw.updates ?? {}) as Partial<UpdateSettings>
  const updateUrl = rawUpdates.updateUrl && !LEGACY_UPDATE_URLS.has(rawUpdates.updateUrl)
    ? rawUpdates.updateUrl
    : DEFAULT_UPDATE_URL

  return {
    display: { ...d.display, ...((raw.display ?? {}) as Partial<DisplaySettings>) },
    printer: migratePrinter((raw.printer ?? {}) as Record<string, unknown>),
    scale: migrateScale((raw.scale ?? {}) as Record<string, unknown>),
    paymentQr: { ...d.paymentQr, ...((raw.paymentQr ?? {}) as Partial<PaymentQrSettings>) },
    system: { ...d.system, ...((raw.system ?? {}) as Partial<SystemSettings>) },
    updates: { ...d.updates, ...rawUpdates, updateUrl },
    hiddenAccess: {
      ...d.hiddenAccess,
      ...((raw.hiddenAccess ?? {}) as Partial<HiddenAccessShortcuts>),
    },
  }
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('nurcrm-settings')
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return DEFAULT_SETTINGS
    return mergeStoredIntoDefaults(parsed as Partial<Record<string, unknown>>)
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem('nurcrm-settings', JSON.stringify(settings))
    window.dispatchEvent(new CustomEvent('nurcrm-settings-changed'))
  } catch {
    /* ignore */
  }
}
