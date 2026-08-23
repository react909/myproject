const { app, BrowserWindow, session, net, ipcMain, dialog } = require('electron')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { spawn } = require('node:child_process')

const logger = require('./services/logger.cjs')
const appState = require('./services/app-state.cjs')
const splash = require('./services/splash-window.cjs')
const recoveryWindow = require('./services/recovery-window.cjs')
const { resolveAppIconImage } = require('./services/icon-path.cjs')
const {
  installResilience,
  installWindowResilience,
  installFrameWatchdog,
  shouldDisableHardwareAcceleration,
} = require('./services/resilience.cjs')

/*
  Программная отрисовка — только если аппаратная уже подводила.

  Решение принимается здесь, до готовности приложения: после `whenReady`
  переключать поздно. Счётчик падений GPU ведёт resilience.cjs, и обычная
  машина сюда не попадает никогда.
*/
if (shouldDisableHardwareAcceleration()) {
  app.disableHardwareAcceleration()
  logger.append('window', 'warn', 'аппаратная отрисовка отключена после повторных падений GPU')
}

/** Проверка критичных модулей до загрузки IPC/принтера (иначе падение в main process). */
function assertPackagedRuntimeModules() {
  const receiptRender = path.join(__dirname, 'receipt', 'receipt-render.cjs')
  if (!fs.existsSync(receiptRender)) {
    const message =
      'Не найден модуль печати чеков (receipt-render.cjs).\n\n' +
      'Переустановите NurCRM Manablock из актуального установщика.'
    try {
      dialog.showErrorBox('NurCRM Manablock — ошибка запуска', message)
    } catch {
      console.error(message)
    }
    app.exit(1)
    return
  }
  require('./receipt/receipt-render.cjs')
}

assertPackagedRuntimeModules()

const { registerIpc } = require('./ipc/register-ipc.cjs')

let backendProcess = null
let backendOwnedByApp = false
let mainWindow = null

const isDev = !app.isPackaged

app.setAppUserModelId('com.nurcrm.manablock')

// ── CORS bypass for external API (e.g. https://app.nurcrm.kg) ──
// Electron renderer runs from file:// which triggers CORS preflight.
// We intercept OPTIONS requests and add proper CORS headers to responses.
function setupCorsBypass(win) {
  const filter = { urls: ['https://app.nurcrm.kg/*'] }

  // Handle OPTIONS preflight: respond with 200 + CORS headers
  win.webContents.session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    // Remove Origin and Referer to avoid CORS preflight on some servers
    delete details.requestHeaders['Origin']
    delete details.requestHeaders['Referer']
    callback({ requestHeaders: details.requestHeaders })
  })

  win.webContents.session.webRequest.onHeadersReceived(filter, (details, callback) => {
    const headers = { ...details.responseHeaders }
    headers['Access-Control-Allow-Origin'] = ['*']
    headers['Access-Control-Allow-Methods'] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
    headers['Access-Control-Allow-Headers'] = ['Content-Type', 'Authorization', 'X-Requested-With']
    headers['Access-Control-Allow-Credentials'] = ['true']
    callback({ responseHeaders: headers })
  })
}

if (!isDev) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
}

function getRendererIndexPath() {
  return path.join(app.getAppPath(), 'dist', 'index.html')
}

function getMainWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

function pingBackend() {
  return new Promise((resolve) => {
    const request = http.get('http://127.0.0.1:8000/health', (response) => {
      resolve(response.statusCode === 200)
      response.resume()
    })
    request.on('error', () => resolve(false))
    request.setTimeout(1500, () => {
      request.destroy()
      resolve(false)
    })
  })
}

function resolveBackendCommand() {
  if (isDev) {
    return {
      command: 'python',
      args: ['main.py'],
      cwd: path.resolve(__dirname, '../../backend'),
    }
  }
  const frontendDir = path.dirname(process.execPath)
  const siblingBackendDir = path.resolve(frontendDir, '../backend')
  const bundledBackendDir = path.join(process.resourcesPath, 'backend')
  const backendDir = fs.existsSync(path.join(siblingBackendDir, 'backend.exe'))
    ? siblingBackendDir
    : bundledBackendDir
  return {
    command: path.join(backendDir, 'backend.exe'),
    args: [],
    cwd: backendDir,
  }
}

async function waitForBackend(timeoutMs = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await pingBackend()) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

async function startBackend() {
  if (await pingBackend()) {
    logger.append('backend', 'info', 'already running on :8000')
    return true
  }
  const { command, args, cwd } = resolveBackendCommand()
  if (!isDev && !fs.existsSync(command)) {
    logger.append('backend', 'warn', 'backend.exe not found', { command })
    return false
  }
  const sqlitePath = path.join(app.getPath('userData'), 'nurcrm.db')
  // Only overrides the backend's own default DSN when a shop has explicitly
  // configured one (multi-till setups pointing at a shared LAN Postgres).
  // Otherwise falls through to whatever's already in the OS environment
  // (spread below), and failing that, the backend's built-in local default.
  const postgresDsn = appState.readState().postgresDsn
  logger.append('backend', 'info', 'starting', { command, cwd, sqlitePath, postgresDsnConfigured: Boolean(postgresDsn) })
  backendProcess = spawn(command, args, {
    cwd,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      UVICORN_LOOP: 'asyncio',
      SQLITE_PATH: sqlitePath,
      ...(postgresDsn ? { NURCRM_POSTGRES_DSN: postgresDsn } : {}),
    },
  })
  backendOwnedByApp = true
  backendProcess.stdout?.on('data', (c) => process.stdout.write(`[backend] ${c}`))
  backendProcess.stderr?.on('data', (c) => process.stderr.write(`[backend] ${c}`))
  backendProcess.on('exit', (code) => {
    backendProcess = null
    if (code && code !== 0) logger.append('backend', 'error', `exit ${code}`)
  })
  const ok = await waitForBackend(30000)
  if (!ok) logger.append('backend', 'error', 'health check timeout after start')
  return ok
}

function stopBackend() {
  if (backendOwnedByApp && backendProcess && !backendProcess.killed) {
    backendProcess.kill()
  }
}

function createWindow() {
  const appIcon = resolveAppIconImage()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    backgroundColor: '#0f1419',
    title: 'NurCRM Manablock',
    icon: appIcon,
    frame: false,
    autoHideMenuBar: true,
    show: false,
    fullscreen: !isDev,
    kiosk: false,
    movable: isDev,
    minimizable: true,
    maximizable: true,
    resizable: isDev,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  mainWindow.setMenuBarVisibility(false)

  // Fix: на части моноблоков после «свернуть → развернуть» frameless-fullscreen окно
  // теряет композицию и показывает серый экран. Принудительно перерисовываем
  // и заново включаем полноэкранный режим при восстановлении.
  /**
   * Возврат окна из панели задач.
   *
   * Работа отложена на кадр намеренно. Событие `restore` приходит в середине
   * перехода: окно ещё считается сворачивающимся, флаги сворачивания ещё не
   * сняты, а команда полноэкранного режима, отправленная в этот момент,
   * теряется ровно так же, как терялось сворачивание. Отложив на 90 мс, мы
   * судим по факту — окно действительно развёрнуто — и только тогда действуем.
   *
   * Полный экран возвращается, если окно так и стояло до сворачивания, если
   * включён киоск или если это собранное приложение (там оно полноэкранное
   * всегда). Без этого возврата окно приходило из панели задач маленьким
   * поверх рабочего стола — то самое «серое окно, ничего нажать нельзя».
   */
  const repaintAfterRestore = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
      try {
        const shouldRestoreFullScreen =
          Boolean(mainWindow.nurcrmRestoreFullScreen)
          || Boolean(mainWindow.nurcrmKioskOn)
          || !isDev
        if (shouldRestoreFullScreen && !mainWindow.isFullScreen()) {
          mainWindow.setFullScreen(true)
        }
        mainWindow.nurcrmRestoreFullScreen = false
        mainWindow.webContents.invalidate()
      } catch {
        /* ignore */
      }
    }, 90)
  }
  mainWindow.on('restore', repaintAfterRestore)
  mainWindow.on('show', repaintAfterRestore)

  /* Сон, блокировка экрана, смена монитора и падения процессов — всё, после
     чего окно оставалось чёрным. См. services/resilience.cjs. */
  installWindowResilience(mainWindow, getMainWindow)

  /* Страница поднялась — окно «Восстановление…» больше не нужно. Здесь, а не
     только по сердцебиению: загрузка может завершиться раньше первого кадра. */
  mainWindow.webContents.on('did-finish-load', () => recoveryWindow.hide())

  /*
   * Перерисовка при возврате фокуса — и только она.
   *
   * Системный диалог выбора файла забирает фокус у полноэкранного окна, а
   * возвращает его уже другим путём. Chromium на Windows в этот момент
   * случается не перерисовывает поверхность, и окно остаётся залитым фоном:
   * DOM цел, обработчики живы, но человек видит пустой экран. Отсюда жалобы
   * «выбрал картинку — стало белым»: ни исключения, ни записи в журнале нет,
   * потому что ничего и не падало.
   *
   * Полноэкранный режим здесь намеренно не трогаем. `focus` приходит и во
   * время сворачивания, и при каждом переключении окон — принудительный
   * setFullScreen на каждый такой случай как раз и заставлял окно бороться
   * само с собой (см. window-minimize).
   */
  mainWindow.on('focus', () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
    try {
      mainWindow.webContents.invalidate()
    } catch {
      /* ignore */
    }
  })

  /*
   * Журнал состояний окна.
   *
   * Жалобы вида «свернул, а оно закрылось и открылось заново» невозможно
   * разобрать по пересказу: снаружи видно моргание, а что именно его вызвало —
   * сворачивание, выход из полноэкранного режима или чей-то restore() — нет.
   * Здесь это видно строкой с временем, и разбор занимает минуту вместо дня.
   */
  for (const event of [
    'minimize',
    'restore',
    'show',
    'hide',
    'enter-full-screen',
    'leave-full-screen',
    'maximize',
    'unmaximize',
  ]) {
    mainWindow.on(event, () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      logger.append('window', 'info', event, {
        fullScreen: mainWindow.isFullScreen(),
        minimized: mainWindow.isMinimized(),
        kiosk: Boolean(mainWindow.nurcrmKioskOn),
        minimizeRequested: Boolean(mainWindow.nurcrmMinimizeRequested),
      })
    })
  }
  // На `focus` не вешаем намеренно: он приходит и во время сворачивания, и
  // при каждом переключении окон — принудительный полноэкранный режим на
  // каждый такой случай и создавал борьбу окна с самим собой.

  mainWindow.once('ready-to-show', () => {
    splash.closeSplash()
    mainWindow.maximize()
    if (!isDev) mainWindow.setFullScreen(true)
    mainWindow.show()
    if (app.isPackaged) appState.markApplicationLaunch(app.getVersion())
  })

  if (isDev) {
    void mainWindow.loadURL('http://127.0.0.1:5173')
  } else {
    const indexPath = getRendererIndexPath()
    if (!fs.existsSync(indexPath)) {
      logger.append('app', 'error', 'index.html missing', { indexPath })
    }
    void mainWindow.loadFile(indexPath)
  }

  const broadcastFs = (v) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.send('fullscreen-changed', v)
      } catch {
        /* ignore */
      }
    }
  }

  // Handle F11 key for fullscreen toggle
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') {
      event.preventDefault()
      const isFs = mainWindow.isFullScreen()
      mainWindow.setFullScreen(!isFs)
    }
  })

  mainWindow.on('enter-full-screen', () => broadcastFs(true))
  mainWindow.on('leave-full-screen', () => broadcastFs(false))
  // Apply CORS bypass for external API calls
  setupCorsBypass(mainWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  // Восстановлению базы нужен доступ к жизненному циклу сервера: файл нельзя
  // подменить, пока его держит открытым работающий процесс.
  registerIpc(getMainWindow, { stopBackend, startBackend })
  /*
   * Доступ к камере — только к камере и только своей странице.
   *
   * Chromium по умолчанию отказывает во всём, о чём его не спросили, и без
   * этого обработчика `getUserMedia` в кассе просто не работает. Системного
   * окна «разрешить камеру?» тут быть не должно: касса стоит в киоске, нажать
   * в нём некому, и молчание читалось бы как поломка.
   *
   * Разрешается ровно `media` и ровно с video. Микрофон, геолокация,
   * уведомления, буфер обмена и всё остальное по-прежнему отклоняются: касса
   * ничего из этого не делает, а открытое на всякий случай разрешение однажды
   * пригодится не нам.
   */
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    if (permission !== 'media') return callback(false)
    // mediaTypes отсутствует у части запросов — тогда считаем, что просят не
    // видео, и отказываем: разрешать вслепую нельзя.
    const wantsVideo = details?.mediaTypes?.includes('video') ?? false
    const wantsAudio = details?.mediaTypes?.includes('audio') ?? false
    callback(wantsVideo && !wantsAudio)
  })

  // Подписки на сон, блокировку экрана и падения процессов. После ready:
  // powerMonitor и screen до неё не готовы.
  installResilience(getMainWindow)
  /* Сторож кадров: белый экран после долгого простоя. Отдельно от подписок
     выше, потому что ловит случай, на который не приходит ни одного
     системного события, — рендерер жив, а картинка застыла. */
  installFrameWatchdog(getMainWindow)
  /* Кнопка «Перезапустить» на экране восстановления. Подписка одна на весь
     сеанс: само окно создаётся и уничтожается по надобности. */
  recoveryWindow.installRecoveryIpc()
  const splashDeadline =
    app.isPackaged
      ? setTimeout(() => splash.closeSplash(), 1600)
      : null

  if (app.isPackaged) {
    splash.createSplash()
    splash.setSplashMessage('Запуск NurCRM Manablock…')
  }
  await startBackend()
  if (app.isPackaged) splash.setSplashMessage('Загрузка интерфейса…')
  createWindow()
  if (splashDeadline) clearTimeout(splashDeadline)
  // ── API proxy: use native fetch (Node 18+ / Electron 28+) — no CORS, no header stripping ──
  ipcMain.handle('api-request', async (_event, { method, url, headers, body }) => {
    console.log(`[IPC-API] ${method} ${url}`)
    const safeHeaders = { ...headers }
    if (safeHeaders.Authorization) safeHeaders.Authorization = 'Bearer ***'
    console.log('[IPC-API] headers:', JSON.stringify(safeHeaders))
    try {
      const fetchOptions = {
        method,
        headers: { ...headers },
        body: body || undefined,
      }
      const response = await fetch(url, fetchOptions)
      const text = await response.text()
      let data = null
      try { data = JSON.parse(text) } catch { data = text }
      if (response.status >= 400) {
        console.warn(`[IPC-API] Response: ${response.status}`, JSON.stringify(data).slice(0, 700))
      } else {
        console.log(`[IPC-API] Response: ${response.status}`)
      }
      return { status: response.status, headers: Object.fromEntries(response.headers), data }
    } catch (err) {
      console.error('[IPC-API] Fetch error:', err.message)
      return { status: 0, data: { error: err.message } }
    }
  })

  logger.append('app', 'info', 'application ready', { version: app.getVersion(), isDev })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopBackend()
  splash.closeSplash()
})
