/**
 * Окно экрана покупателя на втором мониторе.
 *
 * Кассовые моноблоки часто двухсторонние: к продавцу основной экран, к
 * покупателю второй. Если второго дисплея нет, окно не создаётся, и
 * интерфейс кассы показывает то же самое модалкой на основном мониторе —
 * решение принимает renderer по флагу `attached`.
 *
 * Окно намеренно безрамочное и в киоске: покупатель не должен его закрыть,
 * свернуть или увести с него фокус.
 */

const { BrowserWindow, app, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const logger = require('./logger.cjs')

const HASH = '#/customer-display'

let displayWindow = null
/** Последнее состояние: окно может открыться посреди чека и должно его догнать. */
let lastState = null

function isAlive() {
  return displayWindow && !displayWindow.isDestroyed()
}

/** Монитор, на котором стоит основное окно, покупателю не подходит. */
function pickExternalDisplay(mainWindow) {
  const displays = screen.getAllDisplays()
  if (displays.length < 2) return null
  const primary = screen.getPrimaryDisplay()
  const mainBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null
  const busy = mainBounds ? screen.getDisplayMatching(mainBounds).id : primary.id
  return displays.find((display) => display.id !== busy) ?? null
}

function loadInto(window, isDev) {
  if (isDev) {
    return window.loadURL(`http://127.0.0.1:5173/${HASH}`)
  }
  const indexPath = path.join(app.getAppPath(), 'dist', 'index.html')
  if (!fs.existsSync(indexPath)) {
    logger.append('app', 'error', 'customer display: index.html missing', { indexPath })
  }
  return window.loadFile(indexPath, { hash: HASH.slice(1) })
}

function open(getMainWindow) {
  if (isAlive()) {
    displayWindow.showInactive()
    return { attached: true }
  }

  const target = pickExternalDisplay(getMainWindow?.())
  if (!target) {
    return { attached: false, reason: 'Второй монитор не найден — показываем на основном экране' }
  }

  const isDev = !app.isPackaged
  const { x, y, width, height } = target.bounds
  displayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    kiosk: true,
    fullscreen: true,
    autoHideMenuBar: true,
    // Покупательский экран не должен перехватывать фокус у кассира посреди
    // набора корзины.
    focusable: false,
    skipTaskbar: true,
    backgroundColor: '#0f1419',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  displayWindow.setMenuBarVisibility(false)
  displayWindow.on('closed', () => {
    displayWindow = null
  })

  // Состояние, накопившееся до загрузки страницы, отдаём сразу после неё.
  displayWindow.webContents.on('did-finish-load', () => {
    if (lastState && isAlive()) {
      try {
        displayWindow.webContents.send('customer-display:state', lastState)
      } catch {
        /* окно уже закрывают */
      }
    }
  })

  void loadInto(displayWindow, isDev)
  displayWindow.showInactive()
  logger.append('app', 'info', 'customer display opened', { displayId: target.id, width, height })
  return { attached: true }
}

function close() {
  if (isAlive()) displayWindow.close()
  displayWindow = null
  return { attached: false }
}

function push(state) {
  lastState = state
  if (!isAlive()) return { delivered: false }
  try {
    displayWindow.webContents.send('customer-display:state', state)
    return { delivered: true }
  } catch {
    return { delivered: false }
  }
}

function getInfo(getMainWindow) {
  return {
    attached: isAlive(),
    displayCount: screen.getAllDisplays().length,
    externalAvailable: Boolean(pickExternalDisplay(getMainWindow?.())),
  }
}

module.exports = { open, close, push, getInfo }
