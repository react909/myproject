const { app, BrowserWindow } = require('electron')
const logger = require('../services/logger.cjs')
const serialPort = require('./serial-port.cjs')
const scaleReader = require('./scale-reader.cjs')
const { buildReceiptBuffer } = require('./receipt-template.cjs')
const { buildBitmapReceiptBuffer } = require('./bitmap-printer.cjs')
const {
  listStrategiesForAutoTest,
  loadPersistedProfile,
  savePersistedProfile,
  strategyById,
} = require('./printer-profiles.cjs')

const state = {
  printer: {
    connected: false,
    lastError: null,
    lastTestAt: null,
    lastResponse: null,
    activeStrategyId: null,
  },
  scale: {
    connected: false,
    lastError: null,
    lastWeightKg: null,
    lastTestAt: null,
    lastResponse: null,
  },
  scanner: {
    connected: true,
    lastError: null,
    lastBarcode: null,
    lastScanAt: null,
    lastResponse: 'HID-клавиатура',
  },
  keyboard: { connected: true, lastError: null, lastResponse: 'Встроенная VirtualKeyboard' },
  cashDrawer: { connected: false, lastError: null },
}

let cachedSettings = null

function userDataPath() {
  try {
    return app.getPath('userData')
  } catch {
    return ''
  }
}

const { buildPreviewSamplePayload, buildReceiptHtml, resolvePaper } = require('../receipt/receipt-render.cjs')

function sampleReceiptPayload(extra = {}) {
  return buildPreviewSamplePayload({
    thankYou: extra.label ?? 'Тест: АБВГД 12345',
    cashier: 'Диагностика',
  })
}

function bitmapHtmlForPayload(payload, cfg) {
  const opts = bitmapOpts(cfg)
  const paper = resolvePaper(opts)
  return buildReceiptHtml(payload, paper, opts)
}

function applySettings(settings) {
  cachedSettings = settings
  const persisted = loadPersistedProfile(userDataPath())
  if (persisted?.strategyId) {
    state.printer.activeStrategyId = persisted.strategyId
  }
  scaleReader.startScaleReader(settings?.scale, (kg) => {
    setScaleWeightKg(kg)
    state.scale.connected = true
    state.scale.lastResponse = `${kg} кг @ ${new Date().toLocaleTimeString('ru-RU')}`
  })
  if (!settings?.scale?.enabled) {
    state.scale.connected = false
    state.scale.lastWeightKg = null
  }
}

function reconnectDevices(settings) {
  applySettings(settings ?? cachedSettings)
  return getStatus()
}

function getStatus() {
  return {
    printer: { ...state.printer },
    scale: { ...state.scale },
    scanner: { ...state.scanner },
    keyboard: { ...state.keyboard },
    cashDrawer: { ...state.cashDrawer },
    settingsLoaded: !!cachedSettings,
  }
}

function broadcastScaleWeight() {
  const payload = getLiveWeight()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send('scale-weight-changed', payload)
    } catch {
      /* ignore */
    }
  }
}

function reportBarcodeScan(code) {
  const trimmed = String(code || '').trim()
  if (!trimmed) return getStatus()
  state.scanner.connected = true
  state.scanner.lastError = null
  state.scanner.lastBarcode = trimmed
  state.scanner.lastScanAt = new Date().toISOString()
  state.scanner.lastResponse = `${trimmed} @ ${new Date().toLocaleTimeString('ru-RU')}`
  return getStatus()
}

async function sendBuffer(cfg, buffer) {
  await serialPort.writeBuffer(cfg.portOrPath || 'LPT1', 9600, buffer)
}

/** Опции bitmap-рендера из настроек принтера (ширина ленты, шрифт, жирность). */
function bitmapOpts(cfg) {
  const paperWidth = cfg?.paperWidth === '80' ? '80' : '58'
  const width = paperWidth === '80' ? 576 : 384
  const clamp = (v, min, max, fb) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb
  }
  return {
    width,
    paperWidth,
    fontScale: clamp(cfg?.fontScale, 0.65, 1.2, 0.92),
    headerScale: clamp(cfg?.headerScale, 0.7, 1.1, 0.88),
    lineSpacing: clamp(cfg?.lineSpacing, 0.9, 1.35, 1.1),
    compactMode: cfg?.compactMode === true,
    bold: cfg?.boldText !== false,
  }
}

async function testPrinter(settings) {
  const cfg = settings?.printer ?? cachedSettings?.printer
  if (!cfg?.enabled) {
    return { ok: false, message: 'Принтер отключён в настройках' }
  }

  const ud = userDataPath()
  const mode = cfg.encodingMode ?? 'auto'

  if (mode === 'bitmap_raster') {
    try {
      const payload = sampleReceiptPayload({
        label: 'BITMAP: русский текст как изображение',
      })
      const buf = await buildBitmapReceiptBuffer(
        { ...payload, bitmapHtml: bitmapHtmlForPayload(payload, cfg) },
        bitmapOpts(cfg),
      )
      await sendBuffer(cfg, buf)
      state.printer.connected = true
      state.printer.lastError = null
      state.printer.lastTestAt = new Date().toISOString()
      state.printer.lastResponse = `Bitmap OK ${new Date().toLocaleTimeString('ru-RU')}`
      return {
        ok: true,
        message: 'OK: чек отправлен картинкой. Этот режим нужен для принтеров, где русский печатается кракозябрами.',
        strategyId: 'bitmap_raster',
        bytes: buf.length,
      }
    } catch (e) {
      state.printer.connected = false
      state.printer.lastError = e.message
      state.printer.lastResponse = e.message
      return { ok: false, message: `Bitmap ошибка: ${e.message}` }
    }
  }

  try {
    const payload = sampleReceiptPayload({
      label: 'BITMAP: русский текст как изображение',
    })
    const buf = await buildBitmapReceiptBuffer(
      { ...payload, bitmapHtml: bitmapHtmlForPayload(payload, cfg) },
      bitmapOpts(cfg),
    )
    await sendBuffer(cfg, buf)
    state.printer.connected = true
    state.printer.lastError = null
    state.printer.lastTestAt = new Date().toISOString()
    state.printer.lastResponse = `Bitmap OK ${new Date().toLocaleTimeString('ru-RU')}`
    logger.append('printer', 'info', 'bitmap test print OK', { port: cfg.portOrPath, bytes: buf.length })
    return {
      ok: true,
      message: 'OK: bitmap-чек отправлен. Кириллица печатается как изображение, без CP1251/CP866.',
      strategyId: 'bitmap_raster',
      bytes: buf.length,
    }
  } catch (bitmapErr) {
    logger.append('printer', 'warn', 'bitmap test failed, fallback to text strategies', { message: bitmapErr.message })
  }

  if (mode === 'auto') {
    const persisted = loadPersistedProfile(ud)
    const strategies = listStrategiesForAutoTest(cfg, persisted)
    const tried = []
    let lastOk = null

    for (const s of strategies) {
      try {
        const buf = buildReceiptBuffer(
          sampleReceiptPayload({ label: `Профиль: ${s.label}` }),
          { ...cfg, encodingMode: 'manual', manualEncoding: s.encoding, manualCodePage: String(s.codePage) },
          ud,
        )
        await sendBuffer(cfg, buf)
        tried.push({ id: s.id, label: s.label, ok: true })
        lastOk = s
        await new Promise((r) => setTimeout(r, 400))
      } catch (e) {
        tried.push({ id: s.id, label: s.label, ok: false, error: e.message })
      }
    }

    if (lastOk) {
      savePersistedProfile(ud, {
        strategyId: lastOk.id,
        encoding: lastOk.encoding,
        codePage: lastOk.codePage,
        savedAt: new Date().toISOString(),
      })
      state.printer.activeStrategyId = lastOk.id
      state.printer.connected = true
      state.printer.lastError = null
      state.printer.lastTestAt = new Date().toISOString()
      state.printer.lastResponse = `Auto: сохранён ${lastOk.label}`
      return {
        ok: true,
        message: `Отправлено ${tried.length} тестов. Сохранён профиль: ${lastOk.label}. Выберите читаемый чек в ленте.`,
        tried,
        savedStrategyId: lastOk.id,
      }
    }

    state.printer.lastError = 'Все профили не удалось отправить'
    return { ok: false, message: 'Не удалось отправить тест ни одним профилем', tried }
  }

  try {
    const buf = buildReceiptBuffer(sampleReceiptPayload(), cfg, ud)
    await sendBuffer(cfg, buf)
    state.printer.connected = true
    state.printer.lastError = null
    state.printer.lastTestAt = new Date().toISOString()
    state.printer.lastResponse = `OK ${new Date().toLocaleTimeString('ru-RU')}`
    logger.append('printer', 'info', 'test print OK', { port: cfg.portOrPath })
    return { ok: true, message: 'OK: тестовый чек с кириллицей отправлен' }
  } catch (e) {
    state.printer.connected = false
    state.printer.lastError = e.message
    state.printer.lastResponse = e.message
    return { ok: false, message: `Ошибка: ${e.message}` }
  }
}

async function printReceipt(payload, settings) {
  const cfg = settings?.printer ?? cachedSettings?.printer
  if (!cfg?.enabled) return { ok: false, message: 'Принтер отключён' }
  const ud = userDataPath()
  const repeat = Math.max(1, (cfg.repeatPrint ?? 0) + 1)

  const bitmapPayload = {
    ...payload,
    bitmapHtml: payload.bitmapHtml || bitmapHtmlForPayload(payload, cfg),
  }

  if (cfg.encodingMode === 'bitmap_raster') {
    try {
      const buf = await buildBitmapReceiptBuffer(bitmapPayload, bitmapOpts(cfg))
      for (let i = 0; i < repeat; i++) await sendBuffer(cfg, buf)
      state.printer.connected = true
      state.printer.lastError = null
      state.printer.lastResponse = 'Печать OK (картинкой)'
      return { ok: true, strategyId: 'bitmap_raster', bytes: buf.length }
    } catch (e) {
      state.printer.connected = false
      state.printer.lastError = e.message
      return { ok: false, message: e.message }
    }
  }

  try {
    const buf = await buildBitmapReceiptBuffer(bitmapPayload, bitmapOpts(cfg))
    for (let i = 0; i < repeat; i++) await sendBuffer(cfg, buf)
    state.printer.connected = true
    state.printer.lastError = null
    state.printer.lastResponse = 'Печать OK (bitmap/raster)'
    logger.append('printer', 'info', 'bitmap receipt print OK', { port: cfg.portOrPath, bytes: buf.length, repeat })
    return { ok: true, strategyId: 'bitmap_raster', bytes: buf.length }
  } catch (bitmapErr) {
    logger.append('printer', 'warn', 'bitmap print failed, fallback to text strategies', { message: bitmapErr.message })
  }

  if (cfg.encodingMode === 'auto') {
    const persisted = loadPersistedProfile(ud)
    const strategies = listStrategiesForAutoTest(cfg, persisted)
    let lastErr = null
    for (const s of strategies) {
      try {
        const buf = buildReceiptBuffer(
          payload,
          {
            ...cfg,
            encodingMode: 'manual',
            manualEncoding: s.encoding,
            manualCodePage: String(s.codePage),
          },
          ud,
        )
        for (let i = 0; i < repeat; i++) await sendBuffer(cfg, buf)
        state.printer.connected = true
        state.printer.lastError = null
        state.printer.lastResponse = `Печать OK (${s.id})`
        return { ok: true, strategyId: s.id }
      } catch (e) {
        lastErr = e
        logger.append('printer', 'warn', 'print attempt failed', { strategy: s.id, message: e.message })
      }
    }
    state.printer.lastError = lastErr?.message ?? 'print failed'
    return { ok: false, message: state.printer.lastError }
  }

  try {
    const buf = buildReceiptBuffer(payload, cfg, ud)
    for (let i = 0; i < repeat; i++) await sendBuffer(cfg, buf)
    state.printer.connected = true
    state.printer.lastError = null
    state.printer.lastResponse = `Печать OK`
    return { ok: true }
  } catch (e) {
    state.printer.connected = false
    state.printer.lastError = e.message
    return { ok: false, message: e.message }
  }
}

async function testScale(settings) {
  const cfg = settings?.scale ?? cachedSettings?.scale
  if (!cfg?.enabled) {
    return { ok: false, message: 'Весы отключены в настройках' }
  }
  try {
    const ports = await serialPort.listPorts()
    const target = (cfg.comPort || 'COM1').toUpperCase()
    const found = ports.some((p) => String(p.path).toUpperCase() === target)
    applySettings(settings)
    state.scale.lastError = null
    state.scale.lastTestAt = new Date().toISOString()
    const kg = state.scale.lastWeightKg
    state.scale.lastResponse =
      kg != null
        ? `${kg} кг`
        : `Ожидание ответа с ${cfg.comPort}`
    if (!found && ports.length > 0) {
      return {
        ok: true,
        message: `Драйвер запущен. ${cfg.comPort} не в списке. Доступно: ${ports.map((p) => p.path).join(', ')}`,
      }
    }
    return {
      ok: true,
      message: `OK: ${cfg.comPort} @ ${cfg.baudRate} baud${kg != null ? `, вес ${kg} кг` : ''}`,
    }
  } catch (e) {
    state.scale.connected = false
    state.scale.lastError = e.message
    state.scale.lastResponse = e.message
    return { ok: false, message: `Ошибка: ${e.message}` }
  }
}

async function runFullDiagnostics(settings) {
  const printer = await testPrinter(settings)
  const scale = await testScale(settings)
  return {
    printer,
    scale,
    scanner: { ok: true, message: 'Сканер: HID-клавиатура (авто)' },
    timestamp: new Date().toISOString(),
    status: getStatus(),
  }
}

async function listSerialPorts() {
  return serialPort.listPorts()
}

function getLiveWeight() {
  const cfg = cachedSettings?.scale
  if (!cfg?.enabled) {
    return { kg: null, connected: false, stable: false, error: null }
  }
  return {
    kg: state.scale.lastWeightKg,
    connected: state.scale.connected,
    stable: state.scale.lastWeightKg != null && state.scale.lastWeightKg > 0,
    error: state.scale.lastError,
  }
}

function requestScaleRead() {
  scaleReader.requestImmediateScaleRead()
  return getLiveWeight()
}

function setScaleWeightKg(kg) {
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg < 0) return
  state.scale.lastWeightKg = Math.round(kg * 1000) / 1000
  state.scale.connected = true
  state.scale.lastError = null
  state.scale.lastResponse = `${state.scale.lastWeightKg} кг`
  broadcastScaleWeight()
}

module.exports = {
  applySettings,
  reconnectDevices,
  getStatus,
  getLiveWeight,
  requestScaleRead,
  setScaleWeightKg,
  reportBarcodeScan,
  testPrinter,
  testScale,
  printReceipt,
  runFullDiagnostics,
  listSerialPorts,
}
