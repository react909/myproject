const { ipcMain, BrowserWindow, app, dialog } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const logger = require('../services/logger.cjs')
const appState = require('../services/app-state.cjs')
const updater = require('../updater/updater.cjs')
const deviceManager = require('../devices/device-manager.cjs')
const kkmReader = require('../devices/kkm-reader.cjs')
const posTerminal = require('../devices/pos-terminal.cjs')
const customerDisplay = require('../services/customer-display.cjs')
const systemBridge = require('../services/system-bridge.cjs')
const dbRestore = require('../services/db-restore.cjs')

/** Что вообще годится в логотип и в картинку QR. */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'svg']

const MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

/**
 * Потолок размера файла. Нужен не ради места на диске, а ради времени: разбор
 * стамегабайтного файла на кассовом моноблоке — это секунды замершего
 * интерфейса, а картинка логотипа столько не весит никогда.
 */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024

/**
 * Перерисовка окна после того, как системный диалог отдал фокус обратно.
 *
 * Chromium на Windows во frameless-окне случается не пересобирает поверхность,
 * когда фокус возвращается из чужого модального окна: DOM цел, обработчики
 * живы, но человек видит белый экран. Отсюда и жалоба «нажал „выбрать
 * логотип“ — фон стал белым, приложение не работает».
 *
 * Одного `invalidate()` на практике не хватило (он уже стоит на `focus` в
 * main.cjs), поэтому здесь три средства подряд: вернуть фокус самому
 * содержимому, перерисовать и — там, где это не ломает геометрию окна —
 * сдвинуть границы на пиксель и вернуть обратно. Сдвиг заставляет систему
 * пересобрать окно целиком; для полноэкранного и развёрнутого окна он
 * пропускается, иначе окно вышло бы из своего режима.
 */
function repaintAfterNativeDialog(win) {
  if (!win || win.isDestroyed()) return
  const repaint = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return
    try {
      win.focus()
      win.webContents.focus()
      win.webContents.invalidate()
      if (!win.isFullScreen() && !win.isMaximized()) {
        const bounds = win.getBounds()
        win.setBounds({ ...bounds, height: Math.max(1, bounds.height - 1) })
        win.setBounds(bounds)
      }
    } catch {
      /* окно закрыли, пока диалог был открыт */
    }
  }
  repaint()
  // Второй заход кадром позже: возврат фокуса из диалога приходит не мгновенно.
  setTimeout(repaint, 90)
}

/**
 * @param {() => Electron.BrowserWindow | null} getMainWindow
 * @param {{ stopBackend: () => void, startBackend: () => Promise<boolean> }} [backendLifecycle]
 *   Управление локальным сервером. Нужно восстановлению базы: файл нельзя
 *   заменить, пока его держит открытым работающий процесс.
 */
function registerIpc(getMainWindow, backendLifecycle) {
  updater.initUpdater(getMainWindow)

  // --- Резервные копии базы ------------------------------------------------
  ipcMain.handle('backups-list', () => dbRestore.listBackups())

  ipcMain.handle('backups-restore', async (_e, name) => {
    if (!backendLifecycle) {
      return { ok: false, error: 'Управление сервером недоступно — перезапустите приложение.' }
    }
    return dbRestore.restoreFromBackup(name, backendLifecycle)
  })

  // Логи в один архив — для отправки разработчику.
  ipcMain.handle('logs-archive', async () => logger.archiveLogs())

  /**
   * Запись из интерфейса в файл лога.
   *
   * Нужна ради падений в renderer: до неё сообщение об ошибке жило только в
   * консоли DevTools, которую на кассе никто не открывает. Разработчик узнавал
   * о белом экране в пересказе, без текста ошибки и стека.
   */
  ipcMain.handle('logs-append', (_e, level, message, meta) => {
    logger.append('renderer', level || 'error', String(message ?? ''), meta ?? null)
  })

  ipcMain.handle('app-get-meta', () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    state: appState.readState(),
  }))

  ipcMain.handle('app-mark-ready', () => {
    if (app.isPackaged) {
      return appState.markApplicationLaunch(app.getVersion())
    }
    return appState.readState()
  })

  // Renderer never receives a filesystem path with write permissions. The
  // setup wizard submits a cropped image and Electron persists it locally.
  ipcMain.handle('setup-save-logo', async (_event, dataUrl) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      throw new Error('Invalid logo image')
    }
    const encoded = dataUrl.split(',', 2)[1]
    if (!encoded) throw new Error('Invalid logo image')
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.length > 2 * 1024 * 1024) throw new Error('Logo is too large')
    const directory = path.join(app.getPath('userData'), 'assets', 'logos')
    await fs.mkdir(directory, { recursive: true })
    const filename = `store-logo-${Date.now()}.png`
    const absolutePath = path.join(directory, filename)
    await fs.writeFile(absolutePath, bytes)
    return { path: absolutePath }
  })

  /**
   * Выбор картинки системным диалогом — из main-процесса, а не из скрытого
   * `<input type="file">` в странице.
   *
   * Дело не в удобстве. Диалог, который открывает сам Chromium из renderer,
   * во frameless-окне на Windows забирает фокус и возвращает его так, что окно
   * остаётся незакрашенным — тот самый белый экран при выборе логотипа и
   * картинки QR. Диалог, открытый отсюда, принадлежит окну как модальное окно
   * приложения, а после его закрытия мы ещё и принудительно перерисовываем
   * окно (см. repaintAfterNativeDialog).
   *
   * Наружу отдаются байты, а не путь: у renderer нет и не должно быть доступа
   * к файловой системе. Проверки размера и расширения делаются здесь же — до
   * чтения файла, чтобы стамегабайтный «логотип» не попал в память вообще.
   */
  ipcMain.handle('dialog-pick-image', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender) || getMainWindow()
    let picked
    try {
      picked = await dialog.showOpenDialog(win, {
        title: options?.title || 'Выберите картинку',
        buttonLabel: 'Выбрать',
        properties: ['openFile', 'dontAddToRecent'],
        filters: [
          { name: 'Изображения', extensions: IMAGE_EXTENSIONS },
          { name: 'Все файлы', extensions: ['*'] },
        ],
      })
    } catch (error) {
      logger.append('app', 'error', 'dialog-pick-image failed', { message: String(error) })
      return { error: 'Не удалось открыть окно выбора файла.' }
    } finally {
      repaintAfterNativeDialog(win)
    }

    if (picked.canceled || !picked.filePaths?.length) return { canceled: true }

    const filePath = picked.filePaths[0]
    const extension = path.extname(filePath).slice(1).toLowerCase()
    if (!IMAGE_EXTENSIONS.includes(extension)) {
      return { error: 'Это не картинка. Подойдут PNG, JPG, WebP или SVG.' }
    }
    try {
      const stat = await fs.stat(filePath)
      if (!stat.size) return { error: 'Файл пустой — выберите другой.' }
      if (stat.size > MAX_IMAGE_BYTES) {
        return {
          error: `Файл больше ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} МБ — это не картинка логотипа.`,
        }
      }
      const bytes = await fs.readFile(filePath)
      return {
        name: path.basename(filePath),
        size: stat.size,
        type: MIME_BY_EXTENSION[extension],
        bytes,
      }
    } catch (error) {
      logger.append('app', 'error', 'dialog-pick-image read failed', { message: String(error) })
      return { error: 'Не удалось прочитать файл. Попробуйте другой.' }
    }
  })

  ipcMain.handle('logs-read', (_e, channel, limit) => logger.readRecent(channel || 'app', limit || 50))

  ipcMain.handle('updater-get-info', () => ({
    currentVersion: updater.getCurrentVersion(),
    changelog: updater.loadChangelog(),
  }))

  ipcMain.handle('updater-check', async (_e, feedUrl) => updater.checkForUpdates(feedUrl))
  ipcMain.handle('updater-download', async () => updater.downloadUpdate())
  ipcMain.handle('updater-install', () => updater.quitAndInstall())
  ipcMain.handle('updater-changelog', (_e, version) => updater.getChangelogFor(version))

  ipcMain.handle('devices-apply-settings', (_e, settings) => {
    deviceManager.applySettings(settings)
    return { ok: true }
  })

  ipcMain.handle('devices-status', () => deviceManager.getStatus())
  ipcMain.handle('devices-test-printer', (_e, settings) => deviceManager.testPrinter(settings))
  ipcMain.handle('devices-test-scale', (_e, settings) => deviceManager.testScale(settings))
  ipcMain.handle('devices-diagnostics', (_e, settings) => deviceManager.runFullDiagnostics(settings))
  ipcMain.handle('devices-print-receipt', (_e, payload, settings) =>
    deviceManager.printReceipt(payload, settings),
  )
  ipcMain.handle('devices-list-ports', () => deviceManager.listSerialPorts())
  ipcMain.handle('devices-scale-live', () => deviceManager.getLiveWeight())
  ipcMain.handle('devices-scale-read', () => deviceManager.requestScaleRead())
  ipcMain.handle('devices-scale-set', (_e, kg) => {
    deviceManager.setScaleWeightKg(kg)
    return deviceManager.getLiveWeight()
  })

  ipcMain.handle('devices-report-barcode', (_e, code) => {
    deviceManager.reportBarcodeScan(code)
    return deviceManager.getStatus()
  })

  ipcMain.handle('devices-reconnect', (_e, settings) =>
    deviceManager.reconnectDevices(settings),
  )

  // Реквизиты кассы читаются с устройства, а не набираются с шильдика.
  ipcMain.handle('devices-kkm-read', (_e, settings) => kkmReader.readRegistration(settings))

  ipcMain.handle('terminal-payment-start', (_e, config) => posTerminal.startPayment(config))
  ipcMain.handle('terminal-payment-status', (_e, paymentId) => posTerminal.getStatus(paymentId))
  ipcMain.handle('terminal-payment-cancel', (_e, paymentId) => posTerminal.cancel(paymentId))

  // Экран покупателя: отдельное окно на втором мониторе моноблока.
  ipcMain.handle('customer-display:open', () => customerDisplay.open(getMainWindow))
  ipcMain.handle('customer-display:close', () => customerDisplay.close())
  ipcMain.handle('customer-display:push', (_e, state) => customerDisplay.push(state))
  ipcMain.handle('customer-display:info', () => customerDisplay.getInfo(getMainWindow))

  ipcMain.handle('system-set-autolaunch', (_e, enabled) =>
    systemBridge.setAutoLaunch(enabled),
  )

  ipcMain.handle('system-open-touch-keyboard', () => ({
    ok: true,
    message: 'Используйте встроенную VirtualKeyboard в интерфейсе',
  }))

  ipcMain.handle('system-apply-kiosk', (event, enabled) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    systemBridge.applyKioskToWindow(win, { alwaysFullscreen: !!enabled })
    return { ok: true }
  })

  ipcMain.handle('window-get-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win && !win.isDestroyed() ? win.isFullScreen() : false
  })

  ipcMain.handle('window-set-fullscreen', (event, flag) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.setFullScreen(!!flag)
  })

  ipcMain.handle('window-toggle-fullscreen', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return false
    win.setFullScreen(!win.isFullScreen())
    await new Promise((r) => setImmediate(r))
    return win.isFullScreen()
  })

  /**
   * Свернуть окно.
   *
   * Два флага, и оба нужны из-за того, как кнопка ломалась на практике.
   *
   * `nurcrmMinimizeRequested` читает сторож киоска в system-bridge. Сторож
   * возвращает окно обратно на любое сворачивание — так задуман режим киоска, —
   * и без этого флага он отменял и то сворачивание, которое человек только что
   * запросил кнопкой. Поскольку `alwaysFullscreen` включён по умолчанию,
   * кнопка «свернуть» не работала вообще ни на одной установке: окно уходило
   * вниз и тут же всплывало обратно. Это и выглядело как «приложение
   * закрылось и открылось заново».
   *
   * `isMinimizing` читает main.cjs: пока сворачивание идёт, возвращать окно в
   * полноэкранный режим нельзя — иначе оно борется само с собой и остаётся
   * серым.
   *
   * Из полноэкранного режима выходим по-настоящему, и только потом сворачиваем.
   * Свернуть окно, оставив его полноэкранным, не получается: оно уходит вниз, а
   * через одну–пять секунд Chromium возвращает его сам — это видно в журнале
   * окна, и в стеке нет ни одного нашего вызова. Полноэкранное окно Chromium на
   * Windows держит монитор целиком и восстанавливается при возврате фокуса
   * приложению. Отсюда и жалоба «свернул — оно тут же открылось заново».
   *
   * Переход небыстрый, а команда, посланная внутрь него, теряется — поэтому
   * сворачиваем после события `leave-full-screen`, с задержкой и повторной
   * попыткой. Полноэкранный режим возвращается при восстановлении окна: за это
   * отвечает `nurcrmRestoreFullScreen` и repaintAfterRestore в main.cjs.
   */
  ipcMain.handle('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return

    win.isMinimizing = true
    win.nurcrmMinimizeRequested = true
    win.nurcrmRestoreFullScreen = win.isFullScreen()

    const release = () => {
      win.isMinimizing = false
      win.nurcrmMinimizeRequested = false
    }
    win.once('restore', release)
    win.once('show', release)

    const minimizeNow = () => {
      if (win.isDestroyed() || win.isMinimized()) return
      if (!win.nurcrmMinimizeRequested) return
      win.minimize()
    }

    if (!win.isFullScreen()) {
      minimizeNow()
      return
    }

    win.once('leave-full-screen', () => {
      // Две попытки: первая обычно проходит, вторая закрывает случай, когда
      // переход ещё не отпустил окно. Повтор безвреден — minimizeNow сам
      // проверяет, не свёрнуто ли уже.
      setTimeout(minimizeNow, 120)
      setTimeout(minimizeNow, 450)
    })
    win.setFullScreen(false)
  })

  ipcMain.handle('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.close()
  })

  logger.append('app', 'info', 'IPC handlers registered')
}

module.exports = { registerIpc }
