/**
 * Банковский POS-терминал.
 *
 * Третий уровень приёма оплаты: касса отдаёт терминалу сумму, он сам ведёт
 * диалог с картой или показывает QR и возвращает результат. Модуль отвечает
 * за транспорт — COM или TCP — и за разбор ответа.
 *
 * Протокол вендора подключается таблицей PROTOCOLS. Реализован один,
 * текстовый: `PAY <сумма в копейках> <номер заказа>` и ответы вида
 * `STATUS=PAID;REF=...`. Боевой протокол терминала выдаёт банк вместе с
 * договором.
 *
 * Ключевое правило: неизвестный или отсутствующий ответ — это `failed`, а
 * никогда не `paid`. Придуманное подтверждение означало бы закрытый чек без
 * денег в кассе.
 */

const net = require('node:net')
const logger = require('../services/logger.cjs')
const serialPort = require('./serial-port.cjs')

/** Идущие платежи: paymentId → состояние. Живут только до конца операции. */
const payments = new Map()

function parseReply(text) {
  const pairs = new Map()
  for (const chunk of String(text).split(/[;\r\n]+/)) {
    const index = chunk.indexOf('=')
    if (index <= 0) continue
    pairs.set(chunk.slice(0, index).trim().toUpperCase(), chunk.slice(index + 1).trim())
  }
  const raw = (pairs.get('STATUS') || '').toUpperCase()
  const status =
    raw === 'PAID' || raw === 'APPROVED'
      ? 'paid'
      : raw === 'PENDING' || raw === 'WAIT'
        ? 'pending'
        : raw === 'CANCELED' || raw === 'CANCELLED'
          ? 'canceled'
          : raw
            ? 'failed'
            : null
  if (!status) return null
  return { status, reference: pairs.get('REF') || '', qrPayload: pairs.get('QR') || '' }
}

/** Запрос-ответ по TCP с таймаутом. Терминал в сети — обычная схема в сетях магазинов. */
function tcpRequest(host, port, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) || 9100 })
    const chunks = []
    const done = (error, data) => {
      socket.removeAllListeners()
      socket.destroy()
      if (error) reject(error)
      else resolve(data)
    }
    socket.setTimeout(timeoutMs, () => done(new Error(`Терминал ${host}:${port} не ответил`)))
    socket.on('connect', () => socket.write(payload))
    socket.on('data', (chunk) => {
      chunks.push(chunk)
      // Терминал завершает ответ переводом строки.
      if (chunk.includes(0x0a)) done(null, Buffer.concat(chunks))
    })
    socket.on('error', (error) => done(error))
  })
}

async function exchange(config, payload, timeoutMs) {
  if (config.transport === 'tcp') {
    if (!config.host) throw new Error('Не указан адрес терминала.')
    return tcpRequest(config.host, config.tcpPort, payload, timeoutMs)
  }
  if (!config.comPort) throw new Error('Не указан COM-порт терминала.')
  return serialPort.requestResponse(config.comPort, config.baudRate || 115200, payload, { timeoutMs })
}

async function startPayment(config) {
  const amount = Number(config.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, message: 'Некорректная сумма для терминала.' }
  }

  // Сумма уходит в минимальных единицах: дробь по дороге до железа теряется.
  const minor = Math.round(amount * 100)
  const request = Buffer.from(`PAY ${minor} ${config.orderId}\r\n`, 'ascii')

  try {
    const reply = await exchange(config, request, 8000)
    const parsed = reply && reply.length ? parseReply(reply.toString('utf8')) : null
    if (!parsed) {
      return {
        ok: false,
        message: 'Терминал не ответил или ответ не распознан. Примите оплату другим способом.',
      }
    }
    const paymentId = `term-${config.providerId}-${config.orderId}`
    payments.set(paymentId, { config, status: parsed.status, reference: parsed.reference })
    logger.append('device', 'info', 'terminal payment started', { paymentId, status: parsed.status })
    return {
      ok: true,
      paymentId,
      qrPayload: parsed.qrPayload || undefined,
      reference: parsed.reference || undefined,
    }
  } catch (error) {
    logger.append('device', 'warn', 'terminal payment failed', { message: error.message })
    return { ok: false, message: `Терминал недоступен: ${error.message}` }
  }
}

async function getStatus(paymentId) {
  const entry = payments.get(paymentId)
  if (!entry) return { status: 'failed' }
  // Терминал мог ответить окончательно уже на команду PAY.
  if (entry.status !== 'pending') return { status: entry.status, reference: entry.reference }

  try {
    const reply = await exchange(entry.config, Buffer.from(`STATUS ${paymentId}\r\n`, 'ascii'), 3000)
    const parsed = reply && reply.length ? parseReply(reply.toString('utf8')) : null
    if (!parsed) return { status: 'pending' }
    entry.status = parsed.status
    if (parsed.reference) entry.reference = parsed.reference
    return { status: parsed.status, reference: entry.reference }
  } catch {
    // Обрыв связи — не повод считать оплату прошедшей: остаёмся в ожидании,
    // кассир решит по таймауту.
    return { status: 'pending' }
  }
}

async function cancel(paymentId) {
  const entry = payments.get(paymentId)
  if (!entry) return { ok: true }
  try {
    await exchange(entry.config, Buffer.from(`CANCEL ${paymentId}\r\n`, 'ascii'), 3000)
  } catch {
    /* терминал мог уже закрыть операцию сам */
  }
  entry.status = 'canceled'
  payments.delete(paymentId)
  return { ok: true }
}

module.exports = { startPayment, getStatus, cancel }
