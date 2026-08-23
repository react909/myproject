const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('nurcrm', {
  platform: process.platform,
  getMeta: () => ipcRenderer.invoke('app-get-meta'),
  markReady: () => ipcRenderer.invoke('app-mark-ready'),
  apiRequest: (opts) => ipcRenderer.invoke('api-request', opts),
})

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.invoke('window-minimize'),
  close: () => ipcRenderer.invoke('window-close'),
  getFullscreen: () => ipcRenderer.invoke('window-get-fullscreen'),
  setFullscreen: (v) => ipcRenderer.invoke('window-set-fullscreen', v),
  toggleFullscreen: () => ipcRenderer.invoke('window-toggle-fullscreen'),
  saveSetupLogo: (dataUrl) => ipcRenderer.invoke('setup-save-logo', dataUrl),
  onFullscreenChange: (cb) => {
    const fn = (_e, v) => cb(!!v)
    ipcRenderer.on('fullscreen-changed', fn)
    return () => ipcRenderer.removeListener('fullscreen-changed', fn)
  },
})

/**
 * Выбор картинки системным диалогом. Открывает его main-процесс, а не
 * страница: диалог Chromium из renderer оставлял frameless-окно
 * незакрашенным — это и был «белый экран после выбора логотипа».
 */
contextBridge.exposeInMainWorld('filesAPI', {
  pickImage: (options) => ipcRenderer.invoke('dialog-pick-image', options ?? {}),
})

contextBridge.exposeInMainWorld('updaterAPI', {
  getInfo: () => ipcRenderer.invoke('updater-get-info'),
  check: (feedUrl) => ipcRenderer.invoke('updater-check', feedUrl),
  download: () => ipcRenderer.invoke('updater-download'),
  install: () => ipcRenderer.invoke('updater-install'),
  getChangelog: (version) => ipcRenderer.invoke('updater-changelog', version),
  onStatus: (cb) => {
    const fn = (_e, payload) => cb(payload)
    ipcRenderer.on('updater:status', fn)
    return () => ipcRenderer.removeListener('updater:status', fn)
  },
  onProgress: (cb) => {
    const fn = (_e, payload) => cb(payload)
    ipcRenderer.on('updater:progress', fn)
    return () => ipcRenderer.removeListener('updater:progress', fn)
  },
})

contextBridge.exposeInMainWorld('devicesAPI', {
  applySettings: (settings) => ipcRenderer.invoke('devices-apply-settings', settings),
  getStatus: () => ipcRenderer.invoke('devices-status'),
  testPrinter: (settings) => ipcRenderer.invoke('devices-test-printer', settings),
  testScale: (settings) => ipcRenderer.invoke('devices-test-scale', settings),
  runDiagnostics: (settings) => ipcRenderer.invoke('devices-diagnostics', settings),
  printReceipt: (payload, settings) => ipcRenderer.invoke('devices-print-receipt', payload, settings),
  listPorts: () => ipcRenderer.invoke('devices-list-ports'),
  getLiveWeight: () => ipcRenderer.invoke('devices-scale-live'),
  requestScaleRead: () => ipcRenderer.invoke('devices-scale-read'),
  setScaleWeightKg: (kg) => ipcRenderer.invoke('devices-scale-set', kg),
  reportBarcodeScan: (code) => ipcRenderer.invoke('devices-report-barcode', code),
  onScaleWeight: (cb) => {
    const fn = (_e, payload) => cb(payload)
    ipcRenderer.on('scale-weight-changed', fn)
    return () => ipcRenderer.removeListener('scale-weight-changed', fn)
  },
  reconnect: (settings) => ipcRenderer.invoke('devices-reconnect', settings),
  readKkmRegistration: (settings) => ipcRenderer.invoke('devices-kkm-read', settings),
  startTerminalPayment: (config) => ipcRenderer.invoke('terminal-payment-start', config),
  getTerminalPaymentStatus: (paymentId) => ipcRenderer.invoke('terminal-payment-status', paymentId),
  cancelTerminalPayment: (paymentId) => ipcRenderer.invoke('terminal-payment-cancel', paymentId),
})

contextBridge.exposeInMainWorld('customerDisplayAPI', {
  open: () => ipcRenderer.invoke('customer-display:open'),
  close: () => ipcRenderer.invoke('customer-display:close'),
  push: (state) => ipcRenderer.invoke('customer-display:push', state),
  getInfo: () => ipcRenderer.invoke('customer-display:info'),
  onState: (cb) => {
    const fn = (_e, state) => cb(state)
    ipcRenderer.on('customer-display:state', fn)
    return () => ipcRenderer.removeListener('customer-display:state', fn)
  },
})

contextBridge.exposeInMainWorld('powerAPI', {
  /**
   * Пробуждение из сна, разблокировка экрана, смена монитора. Страница на это
   * подписывается, чтобы пересинхронизировать часы и перезапустить анимации:
   * после сна таймеры отстают, а страница об этом не знает.
   */
  onResume: (cb) => {
    const fn = (_e, payload) => cb(payload)
    ipcRenderer.on('power:resume', fn)
    return () => ipcRenderer.removeListener('power:resume', fn)
  },

  /**
   * Отметка «кадр нарисован».
   *
   * Единственный способ отличить живую картинку от застывшей: рендерер, у
   * которого потерялась поверхность окна, на вопрос «ты жив?» отвечает бодро, а
   * рисовать при этом перестал. Кадры не соврут. Разбор — в
   * electron/services/resilience.cjs.
   *
   * `send`, а не `invoke`: ответ не нужен, а отметка идёт каждые пару секунд
   * всё время работы кассы.
   */
  heartbeat: () => ipcRenderer.send('app:heartbeat'),
})

contextBridge.exposeInMainWorld('systemAPI', {
  setAutoLaunch: (enabled) => ipcRenderer.invoke('system-set-autolaunch', enabled),
  openTouchKeyboard: () => ipcRenderer.invoke('system-open-touch-keyboard'),
  applyKiosk: (enabled) => ipcRenderer.invoke('system-apply-kiosk', enabled),
})

contextBridge.exposeInMainWorld('logsAPI', {
  read: (channel, limit) => ipcRenderer.invoke('logs-read', channel, limit),
  // Все логи одним сжатым файлом — для отправки разработчику.
  archive: () => ipcRenderer.invoke('logs-archive'),
  // Ошибка из интерфейса в файл лога: без неё падение renderer видно только
  // в DevTools, которые на кассе никто не открывает.
  append: (level, message, meta) => ipcRenderer.invoke('logs-append', level, message, meta),
})

/**
 * Резервные копии базы. Список копий отдаёт и бэкенд, но восстановление
 * возможно только отсюда: подменить файл базы можно лишь тогда, когда её никто
 * не держит открытой, а останавливать сервер умеет только main-процесс.
 */
contextBridge.exposeInMainWorld('backupAPI', {
  list: () => ipcRenderer.invoke('backups-list'),
  restore: (name) => ipcRenderer.invoke('backups-restore', name),
})
