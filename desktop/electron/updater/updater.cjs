const { autoUpdater } = require('electron-updater')
const { app, BrowserWindow } = require('electron')
const logger = require('../services/logger.cjs')
const versionManager = require('./version-manager.cjs')

let mainWindowGetter = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())

function send(channel, payload) {
  const win = mainWindowGetter()
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

function initUpdater(getMainWindow) {
  if (typeof getMainWindow === 'function') {
    mainWindowGetter = getMainWindow
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    logger.append('update', 'info', 'checking-for-update')
    send('updater:status', { phase: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    logger.append('update', 'info', 'update-available', info)
    send('updater:status', {
      phase: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      files: info.files,
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    logger.append('update', 'info', 'update-not-available', info)
    send('updater:status', { phase: 'not-available', version: versionManager.getCurrentVersion() })
  })

  autoUpdater.on('error', (err) => {
    logger.append('update', 'error', err.message)
    send('updater:status', { phase: 'error', message: err.message })
  })

  autoUpdater.on('download-progress', (p) => {
    send('updater:progress', {
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    logger.append('update', 'info', 'update-downloaded', { version: info.version })
    send('updater:status', { phase: 'downloaded', version: info.version })
  })
}

function setFeedUrl(url) {
  if (!url || typeof url !== 'string') return false
  try {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: url.endsWith('/') ? url : `${url}/`,
    })
    return true
  } catch (e) {
    logger.append('update', 'error', 'setFeedURL failed', { message: e.message })
    return false
  }
}

async function checkForUpdates(feedUrl) {
  if (!app.isPackaged) {
    return {
      ok: true,
      dev: true,
      currentVersion: versionManager.getCurrentVersion(),
      message: 'В режиме разработки используется mock-проверка',
    }
  }
  if (feedUrl) setFeedUrl(feedUrl)
  const result = await autoUpdater.checkForUpdates()
  return {
    ok: true,
    currentVersion: versionManager.getCurrentVersion(),
    updateInfo: result?.updateInfo ?? null,
  }
}

async function downloadUpdate() {
  if (!app.isPackaged) {
    send('updater:progress', { percent: 100 })
    send('updater:status', { phase: 'downloaded', version: 'dev-mock' })
    return { ok: true, dev: true }
  }
  await autoUpdater.downloadUpdate()
  return { ok: true }
}

function quitAndInstall() {
  if (!app.isPackaged) {
    send('updater:status', { phase: 'restart-mock' })
    return { ok: true, dev: true }
  }
  autoUpdater.quitAndInstall(false, true)
  return { ok: true }
}

module.exports = {
  initUpdater,
  setFeedUrl,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  getCurrentVersion: versionManager.getCurrentVersion,
  getChangelogFor: versionManager.getChangelogFor,
  loadChangelog: versionManager.loadChangelog,
}
