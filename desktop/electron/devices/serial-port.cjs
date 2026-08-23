const fs = require('node:fs')
const logger = require('../services/logger.cjs')

let SerialPort = null
try {
  SerialPort = require('serialport').SerialPort
} catch {
  logger.append('device', 'warn', 'serialport module not available — COM features disabled until native rebuild')
}

const writeQueues = new Map()
const DEFAULT_WRITE_TIMEOUT_MS = 8000

function normalizeComPath(port) {
  if (!port) return null
  const p = String(port).trim().toUpperCase()
  if (p.startsWith('COM')) return `\\\\.\\${p}`
  if (p.startsWith('LPT')) return `\\\\.\\${p}`
  return port
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer)
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout ${timeoutMs}ms`)), timeoutMs)
    }),
  ])
}

function enqueuePortTask(portPath, task) {
  const key = String(portPath || '').toUpperCase()
  const prev = writeQueues.get(key) || Promise.resolve()
  const next = prev.catch(() => {}).then(task)
  // Keep the queue cleanup promise handled. The caller still receives `next`
  // and can handle the real write error, but Electron main must not emit an
  // extra UnhandledPromiseRejection when a printer port is missing (e.g. LPT1).
  const cleanup = next.finally(() => {
    if (writeQueues.get(key) === next) writeQueues.delete(key)
  }).catch(() => {})
  writeQueues.set(key, cleanup)
  return next
}

function openCom(port, baudRate) {
  if (!SerialPort) {
    return Promise.reject(new Error('Модуль serialport не установлен. Выполните: npm install && npm run postinstall'))
  }
  return new Promise((resolve, reject) => {
    const instance = new SerialPort({
      path: normalizeComPath(port) || port,
      baudRate: Number(baudRate) || 9600,
      autoOpen: false,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
    })
    instance.open((err) => {
      if (err) reject(err)
      else resolve(instance)
    })
  })
}

function writeBuffer(portPath, baudRate, buffer) {
  const normalized = normalizeComPath(portPath)
  const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  return enqueuePortTask(normalized || portPath, async () => {
    if (normalized && normalized.toUpperCase().includes('LPT')) {
      return withTimeout(
        new Promise((resolve, reject) => {
          fs.writeFile(normalized, payload, (err) => (err ? reject(err) : resolve({ ok: true, mode: 'lpt' })))
        }),
        DEFAULT_WRITE_TIMEOUT_MS,
        `LPT write ${normalized}`,
      )
    }

    let port = null
    try {
      port = await withTimeout(openCom(normalized || portPath, baudRate), DEFAULT_WRITE_TIMEOUT_MS, `COM open ${portPath}`)
      await withTimeout(
        new Promise((resolve, reject) => {
          port.write(payload, (writeErr) => {
            if (writeErr) return reject(writeErr)
            port.drain((drainErr) => (drainErr ? reject(drainErr) : resolve()))
          })
        }),
        DEFAULT_WRITE_TIMEOUT_MS,
        `COM write ${portPath}`,
      )
      return { ok: true, mode: 'com' }
    } finally {
      if (port) {
        try { port.removeAllListeners() } catch {}
        try { if (port.isOpen) port.close(() => {}) } catch {}
      }
    }
  })
}

/**
 * Запрос-ответ по COM: пишем команду и ждём ответ устройства.
 *
 * Нужен опросу оборудования, которое умеет отвечать (фискальный регистратор
 * отдаёт свои регистрационные номера). Печать этим не пользуется: ей ответ не
 * нужен, а лишнее ожидание в момент оплаты недопустимо.
 */
function requestResponse(portPath, baudRate, payload, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 1200
  const normalized = normalizeComPath(portPath)
  const request = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)

  return enqueuePortTask(normalized || portPath, async () => {
    let port = null
    try {
      port = await withTimeout(openCom(normalized || portPath, baudRate), timeoutMs, `COM open ${portPath}`)
      const chunks = []
      port.on('data', (chunk) => chunks.push(chunk))
      await new Promise((resolve, reject) => {
        port.write(request, (err) => (err ? reject(err) : resolve()))
      })
      // Молчание — штатный исход: на порту может стоять принтер или весы.
      // Ждём фиксированное окно и отдаём то, что успело прийти.
      await new Promise((resolve) => setTimeout(resolve, timeoutMs))
      return Buffer.concat(chunks)
    } finally {
      if (port) {
        try { port.removeAllListeners() } catch {}
        try { if (port.isOpen) port.close(() => {}) } catch {}
      }
    }
  })
}

function listPorts() {
  if (!SerialPort) return Promise.resolve([])
  return SerialPort.list().then((ports) =>
    ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer,
      serialNumber: p.serialNumber,
    })),
  )
}

function isAvailable() {
  return !!SerialPort
}

module.exports = { writeBuffer, requestResponse, listPorts, normalizeComPath, isAvailable }
