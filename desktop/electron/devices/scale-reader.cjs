const logger = require('../services/logger.cjs')

let SerialPort = null
try {
  SerialPort = require('serialport').SerialPort
} catch {
  /* native module missing until postinstall */
}

const MIN_POLL_MS = 80
const MIN_EMIT_MS_DEFAULT = 90
const STALE_MS = 4000
/** Окно медианного фильтра — гасит одиночные выбросы (0→3→0). */
const SMOOTH_WINDOW_DEFAULT = 3
const RECONNECT_BASE_MS = 800
const RECONNECT_MAX_MS = 12000

function normalizeCfg(cfg) {
  if (!cfg?.enabled) return { enabled: false }
  const speedMode =
    cfg.speedMode === 'turbo' ? 'turbo' : cfg.speedMode === 'normal' ? 'normal' : 'fast'
  const emitMinMs =
    speedMode === 'turbo' ? 55 : speedMode === 'normal' ? 130 : MIN_EMIT_MS_DEFAULT
  const smoothWindow = speedMode === 'turbo' ? 2 : SMOOTH_WINDOW_DEFAULT
  return {
    enabled: true,
    protocol: cfg.protocol === 'sum2' ? 'sum2' : 'sum1',
    comPort: String(cfg.comPort || 'COM1').trim().toUpperCase(),
    baudRate: Number(cfg.baudRate) || 9600,
    requestWeightHex: String(cfg.requestWeightHex || '05').trim(),
    prDelay: Number(cfg.prDelay ?? 0.25),
    repeatRequest: Math.max(1, Math.min(3, Number(cfg.repeatRequest) || 1)),
    speedMode,
    emitMinMs,
    smoothWindow,
  }
}

function sameCfg(a, b) {
  return JSON.stringify(normalizeCfg(a)) === JSON.stringify(normalizeCfg(b))
}

function parseWeightKg(chunk, protocol = 'sum1') {
  const raw = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
  const ascii = raw.toString('ascii').replace(/\x00/g, ' ').trim()
  const hex = raw.toString('hex').toUpperCase()

  const textPatterns = [
    /ST[,\s]+GS[,\s]+([+-]?\d+[.,]\d+)/i,
    /([+-]?\d+[.,]\d{2,4})\s*kg/i,
    /([+-]?\d+[.,]\d{2,4})/,
    /([+-]?\d{1,6})\s*g\b/i,
  ]

  for (const re of textPatterns) {
    const m = ascii.match(re)
    if (!m) continue
    let kg = Number.parseFloat(String(m[1]).replace(',', '.'))
    if (/\sg\b/i.test(m[0])) kg /= 1000
    if (Number.isFinite(kg) && kg >= 0 && kg < 1000) return Math.round(kg * 1000) / 1000
  }

  const digits = ascii.replace(/[^0-9+-]/g, '')
  if (digits.length >= 3 && digits.length <= 8) {
    const n = Number.parseInt(digits, 10)
    if (Number.isFinite(n) && n >= 0) {
      const kg = n / 1000
      if (kg < 1000) return Math.round(kg * 1000) / 1000
    }
  }

  logger.append('scale', 'debug', 'unparsed scale frame', { ascii, hex, protocol })
  return null
}

function hexToBuffer(hex) {
  const raw = String(hex || '').replace(/\s/g, '')
  if (!raw) return null
  if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length % 2 !== 0) return null
  return Buffer.from(raw, 'hex')
}

class ScaleManager {
  constructor() {
    this.port = null
    this.cfg = null
    this.onWeight = null
    this.pollTimer = null
    this.reconnectTimer = null
    this.heartbeatTimer = null
    this.buffer = Buffer.alloc(0)
    this.lastFrameAt = 0
    this.lastEmitAt = 0
    this.lastKg = null
    this.recentKg = []
    this.reconnectAttempts = 0
    this.generation = 0
    this.opening = false
    this.destroyed = true
  }

  start(cfg, onWeight) {
    const nextCfg = normalizeCfg(cfg)
    this.onWeight = typeof onWeight === 'function' ? onWeight : null

    if (!nextCfg.enabled) {
      this.stop()
      this.cfg = nextCfg
      return
    }

    if (this.cfg?.enabled && sameCfg(this.cfg, nextCfg) && this.port?.isOpen) {
      return
    }

    this.stop({ keepCallback: true })
    this.cfg = nextCfg
    this.destroyed = false
    this.reconnectAttempts = 0
    this.connect()
  }

  stop(options = {}) {
    this.destroyed = true
    this.generation += 1
    this.clearTimers()
    this.buffer = Buffer.alloc(0)
    this.recentKg = []
    this.opening = false
    if (!options.keepCallback) this.onWeight = null
    this.closePort()
  }

  clearTimers() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.pollTimer = null
    this.reconnectTimer = null
    this.heartbeatTimer = null
  }

  closePort() {
    const p = this.port
    this.port = null
    if (!p) return
    try { p.removeAllListeners('data') } catch {}
    try { p.removeAllListeners('error') } catch {}
    try { p.removeAllListeners('close') } catch {}
    try {
      if (p.isOpen) p.close(() => {})
    } catch {}
  }

  connect() {
    if (this.destroyed || !this.cfg?.enabled || this.opening) return
    if (!SerialPort) {
      logger.append('scale', 'warn', 'serialport unavailable — rebuild native deps')
      return
    }

    const gen = this.generation
    const { comPort, baudRate } = this.cfg
    this.opening = true

    const port = new SerialPort({
      path: comPort,
      baudRate,
      autoOpen: false,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      rtscts: false,
      xon: false,
      xoff: false,
      xany: false,
    })

    this.port = port

    port.on('data', (data) => this.handleData(data))
    port.on('error', (err) => {
      logger.append('scale', 'error', 'port error', { message: err.message, path: comPort })
      this.scheduleReconnect('error')
    })
    port.on('close', () => {
      if (!this.destroyed) this.scheduleReconnect('close')
    })

    port.open((err) => {
      this.opening = false
      if (gen !== this.generation || this.destroyed) {
        try { if (port.isOpen) port.close(() => {}) } catch {}
        return
      }
      if (err) {
        logger.append('scale', 'error', 'open failed', { message: err.message, path: comPort, baudRate })
        this.scheduleReconnect('open-failed')
        return
      }

      this.reconnectAttempts = 0
      this.lastFrameAt = Date.now()
      logger.append('scale', 'info', 'reader started', { path: comPort, baudRate, protocol: this.cfg.protocol })
      this.startPolling()
      this.startHeartbeat()
    })
  }

  startPolling() {
    if (!this.cfg?.enabled) return
    const cmd = hexToBuffer(this.cfg.requestWeightHex)
    if (!cmd?.length) return
    const intervalMs = Math.max(MIN_POLL_MS, Math.round((this.cfg.prDelay || 0.25) * 1000))
    const repeats = this.cfg.repeatRequest
    const send = () => {
      const p = this.port
      if (!p?.isOpen || this.destroyed) return
      for (let i = 0; i < repeats; i++) {
        p.write(cmd, (writeErr) => {
          if (writeErr) logger.append('scale', 'warn', 'write failed', { message: writeErr.message })
        })
      }
    }
    send()
    this.pollTimer = setInterval(send, intervalMs)
  }

  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.destroyed || !this.cfg?.enabled) return
      if (!this.port?.isOpen) {
        this.scheduleReconnect('heartbeat-closed')
        return
      }
      if (Date.now() - this.lastFrameAt > STALE_MS) {
        logger.append('scale', 'warn', 'stale scale stream, reconnecting', { ageMs: Date.now() - this.lastFrameAt })
        this.scheduleReconnect('stale')
      }
    }, 1000)
  }

  scheduleReconnect(reason) {
    if (this.destroyed || !this.cfg?.enabled || this.reconnectTimer) return
    this.clearTimers()
    this.closePort()
    this.reconnectAttempts += 1
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** Math.min(5, this.reconnectAttempts - 1)))
    logger.append('scale', 'info', 'schedule reconnect', { reason, delay, attempt: this.reconnectAttempts })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  handleData(data) {
    if (this.destroyed || !Buffer.isBuffer(data)) return
    this.lastFrameAt = Date.now()
    this.buffer = Buffer.concat([this.buffer, data])
    if (this.buffer.length > 256) this.buffer = this.buffer.subarray(this.buffer.length - 256)

    const frames = []
    let start = 0
    for (let i = 0; i < this.buffer.length; i++) {
      const b = this.buffer[i]
      if (b === 0x0a || b === 0x0d || b === 0x03) {
        if (i > start) frames.push(this.buffer.subarray(start, i))
        start = i + 1
      }
    }
    if (start > 0) this.buffer = this.buffer.subarray(start)
    if (frames.length === 0 && this.buffer.length >= 6) frames.push(this.buffer)

    for (const frame of frames) {
      const kg = parseWeightKg(frame, this.cfg?.protocol)
      if (kg == null) continue
      this.pushSample(kg)
    }
  }

  /**
   * Медианный фильтр окна 3: одиночный выброс (например 0→3→0) отсекается,
   * а реальное изменение веса проходит после 2 совпадающих кадров.
   * Возврат к нулю (снятие товара) пропускаем сразу — без задержки.
   */
  pushSample(kg) {
    const windowSize = this.cfg?.smoothWindow || SMOOTH_WINDOW_DEFAULT
    if (kg <= 0) {
      this.recentKg = [0]
      this.emitWeight(0)
      return
    }
    this.recentKg.push(kg)
    if (this.recentKg.length > windowSize) this.recentKg.shift()
    if (this.recentKg.length < windowSize) {
      this.emitWeight(kg)
      return
    }
    const sorted = [...this.recentKg].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    this.emitWeight(median)
  }

  emitWeight(kg) {
    const now = Date.now()
    const minEmit = this.cfg?.emitMinMs || MIN_EMIT_MS_DEFAULT
    if (this.lastKg === kg && now - this.lastEmitAt < Math.max(minEmit, 250)) return
    if (now - this.lastEmitAt < minEmit) return
    this.lastKg = kg
    this.lastEmitAt = now
    if (this.onWeight) this.onWeight(kg)
  }

  requestImmediateRead() {
    if (this.destroyed || !this.cfg?.enabled) return false
    const cmd = hexToBuffer(this.cfg.requestWeightHex)
    const p = this.port
    if (!cmd?.length || !p?.isOpen) return false
    const repeats = this.cfg.repeatRequest || 1
    for (let i = 0; i < repeats; i++) {
      p.write(cmd, (writeErr) => {
        if (writeErr) logger.append('scale', 'warn', 'immediate read failed', { message: writeErr.message })
      })
    }
    return true
  }
}

const manager = new ScaleManager()

function startScaleReader(cfg, onWeight) {
  manager.start(cfg, onWeight)
}

function stopScaleReader() {
  manager.stop()
}

function requestImmediateScaleRead() {
  return manager.requestImmediateRead()
}

module.exports = { startScaleReader, stopScaleReader, parseWeightKg, requestImmediateScaleRead }