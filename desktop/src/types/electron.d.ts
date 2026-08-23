import type { AppSettings } from '../settings/appSettings'
import type { ReceiptPrintPayload } from '../receipt/receiptTemplate'

export type DeviceStatusSnapshot = {
  printer: {
    connected: boolean
    lastError: string | null
    lastTestAt: string | null
    lastResponse?: string | null
    activeStrategyId?: string | null
  }
  scale: {
    connected: boolean
    lastError: string | null
    lastWeightKg: number | null
    lastTestAt: string | null
    lastResponse?: string | null
  }
  scanner: {
    connected: boolean
    lastError: string | null
    lastBarcode?: string | null
    lastScanAt?: string | null
    lastResponse?: string | null
  }
  keyboard?: {
    connected: boolean
    lastError: string | null
    lastResponse?: string | null
  }
  cashDrawer: { connected: boolean; lastError: string | null }
  settingsLoaded?: boolean
}

declare global {
  interface Window {
    nurcrm?: {
      platform: string
      getMeta: () => Promise<{
        version: string
        isPackaged: boolean
        platform: string
        state: Record<string, unknown>
      }>
      markReady: () => Promise<unknown>
    }
    electronAPI?: {
      minimize?: () => void
      close?: () => void
      getFullscreen?: () => Promise<boolean>
      setFullscreen?: (v: boolean) => Promise<void>
      toggleFullscreen?: () => Promise<boolean>
      saveSetupLogo?: (dataUrl: string) => Promise<{ path: string }>
      onFullscreenChange?: (cb: (v: boolean) => void) => () => void
    }
    /**
     * Системный диалог выбора картинки. Открывает его main-процесс: диалог,
     * открытый страницей, оставлял frameless-окно незакрашенным.
     */
    filesAPI?: {
      pickImage: (options?: { title?: string }) => Promise<{
        canceled?: boolean
        error?: string
        name?: string
        size?: number
        type?: string
        /** Содержимое файла. Приходит из main-процесса как Buffer. */
        bytes?: Uint8Array<ArrayBuffer>
      }>
    }
    /**
     * Питание: пробуждение из сна, разблокировка экрана, смена монитора.
     * Подписка нужна странице, чтобы пересчитать часы и перезапустить кадры —
     * во сне таймеры стоят, и сама страница об этом не узнает.
     */
    powerAPI?: {
      onResume?: (cb: (payload: { reason: string }) => void) => () => void
      /**
       * Отметка «кадр нарисован» — по ней главный процесс отличает живую
       * картинку от застывшей. См. services/frameHeartbeat.ts.
       */
      heartbeat?: () => void
    }
    updaterAPI?: {
      getInfo: () => Promise<{ currentVersion: string; changelog: Record<string, unknown> }>
      check: (feedUrl?: string) => Promise<unknown>
      download: () => Promise<unknown>
      install: () => Promise<unknown>
      getChangelog: (version: string) => Promise<unknown>
      onStatus: (cb: (payload: import('../services/updater/updater.client').UpdaterStatusPayload) => void) => () => void
      onProgress: (cb: (payload: import('../services/updater/updater.client').UpdaterProgressPayload) => void) => () => void
    }
    devicesAPI?: {
      applySettings: (settings: AppSettings) => Promise<{ ok: boolean }>
      getStatus: () => Promise<DeviceStatusSnapshot>
      testPrinter: (settings: AppSettings) => Promise<{
        ok: boolean
        message: string
        savedStrategyId?: string
        tried?: Array<{ id: string; label: string; ok: boolean }>
      }>
      reconnect?: (settings: AppSettings) => Promise<DeviceStatusSnapshot>
      /** Опрос фискального регистратора: заводской и регистрационный номера. */
      readKkmRegistration?: (
        settings: AppSettings | null,
      ) => Promise<import('../services/devices/kkm.client').KkmReadResult>
      testScale: (settings: AppSettings) => Promise<{ ok: boolean; message: string }>
      runDiagnostics: (settings: AppSettings) => Promise<unknown>
      printReceipt: (payload: ReceiptPrintPayload, settings: AppSettings) => Promise<{ ok: boolean; message?: string }>
      listPorts: () => Promise<Array<{ path: string; manufacturer?: string }>>
      getLiveWeight: () => Promise<{
        kg: number | null
        connected: boolean
        stable: boolean
        error?: string | null
      }>
      requestScaleRead?: () => Promise<{
        kg: number | null
        connected: boolean
        stable: boolean
        error?: string | null
      }>
      setScaleWeightKg: (kg: number) => Promise<{
        kg: number | null
        connected: boolean
        stable: boolean
        error?: string | null
      }>
      reportBarcodeScan?: (code: string) => Promise<DeviceStatusSnapshot>
      onScaleWeight?: (
        cb: (payload: {
          kg: number | null
          connected: boolean
          stable: boolean
          error?: string | null
        }) => void,
      ) => () => void
      /** Оплата через банковский POS-терминал. */
      startTerminalPayment?: (config: {
        providerId: string
        amount: number
        orderId: string
        transport: 'com' | 'tcp'
        comPort?: string
        baudRate?: number
        host?: string
        tcpPort?: number
      }) => Promise<
        | { ok: true; paymentId: string; qrPayload?: string; reference?: string }
        | { ok: false; message: string }
      >
      getTerminalPaymentStatus?: (paymentId: string) => Promise<{
        status: import('../payments/types').PaymentStatus
        reference?: string
      }>
      cancelTerminalPayment?: (paymentId: string) => Promise<{ ok: boolean }>
    }
    /** Экран покупателя на втором мониторе моноблока. */
    customerDisplayAPI?: {
      open: () => Promise<{ attached: boolean; reason?: string }>
      close: () => Promise<{ attached: boolean }>
      push: (state: import('../customer-display/state').CustomerDisplayState) => Promise<{
        delivered: boolean
      }>
      getInfo: () => Promise<{
        attached: boolean
        displayCount: number
        externalAvailable: boolean
      }>
      onState?: (
        cb: (state: import('../customer-display/state').CustomerDisplayState) => void,
      ) => () => void
    }
    logsAPI?: {
      read: (channel?: string, limit?: number) => Promise<unknown[]>
      /** Все логи одним сжатым файлом — для отправки разработчику. */
      archive: () => Promise<
        { ok: true; path: string; sizeBytes: number; files: number } | { ok: false; error: string }
      >
      /**
       * Запись ошибки интерфейса в файл лога. Без неё падение renderer видно
       * только в DevTools, которые на кассе никто не открывает.
       */
      append?: (
        level: string,
        message: string,
        meta?: Record<string, unknown> | null,
      ) => Promise<void>
    }
    /**
     * Резервные копии базы. Список отдаёт и бэкенд, но восстановление — только
     * отсюда: подменить файл базы можно, лишь остановив сервер, а это умеет
     * только main-процесс.
     */
    backupAPI?: {
      list: () => Promise<
        Array<{ name: string; path: string; sizeBytes: number; createdAt: string }>
      >
      restore: (
        name: string,
      ) => Promise<
        | { ok: true; restoredFrom: string; previousDatabase: string }
        | { ok: false; error: string }
      >
    }
    systemAPI?: {
      setAutoLaunch: (enabled: boolean) => Promise<{ ok: boolean; message?: string }>
      openTouchKeyboard: () => Promise<{ ok: boolean }>
      applyKiosk: (enabled: boolean) => Promise<{ ok: boolean }>
    }
  }
}

export {}
