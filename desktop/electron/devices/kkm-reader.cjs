/**
 * Чтение регистрационных данных с фискального регистратора.
 *
 * Заводской и регистрационный номера, номер фискального модуля и версии
 * прошивки — свойства самой кассы. Переписывать их с шильдика в форму значит
 * гарантированно получить опечатку в фискальном чеке, поэтому мастер сначала
 * пробует спросить их у устройства.
 *
 * Модуль отвечает только за транспорт и разбор ответа. Протокол конкретного
 * вендора подключается записью в PROTOCOLS. Сейчас реализован один —
 * текстовый: на запрос `INFO?` касса отвечает строкой пар «ключ=значение».
 * Ничего не выдумывается: если ответа нет или он не разобран, возвращается
 * ok:false, и мастер оставляет поля для ручного ввода.
 */

const logger = require('../services/logger.cjs')
const serialPort = require('./serial-port.cjs')

/** Порты, за которыми заведомо не касса: на них висят весы и принтер. */
function excludedPorts(settings) {
  const busy = new Set()
  const scale = settings?.scale
  if (scale?.enabled && scale.comPort) busy.add(String(scale.comPort).toUpperCase())
  const printer = settings?.printer
  if (printer?.enabled && printer.portOrPath) busy.add(String(printer.portOrPath).toUpperCase())
  return busy
}

/**
 * Разбор текстового ответа: `SN=488483;RN=000237;FM=000237;FFD=1.0;SW=NewCas-F 1.0`.
 * Регистр ключей и порядок значения не имеют, лишние пары игнорируются.
 */
function parseKeyValueReply(text) {
  const pairs = new Map()
  for (const chunk of String(text).split(/[;\r\n]+/)) {
    const index = chunk.indexOf('=')
    if (index <= 0) continue
    pairs.set(chunk.slice(0, index).trim().toUpperCase(), chunk.slice(index + 1).trim())
  }

  const serialNumber = pairs.get('SN') || pairs.get('SERIAL') || ''
  const registrationNumber = pairs.get('RN') || pairs.get('REG') || ''
  // Заводской номер — минимальный признак того, что ответила именно касса.
  if (!serialNumber) return null

  return {
    serialNumber,
    registrationNumber,
    fiscalModule: pairs.get('FM') || pairs.get('FISCAL') || '',
    ffdVersion: pairs.get('FFD') || '',
    swVersion: pairs.get('SW') || pairs.get('VERSION') || '',
  }
}

const PROTOCOLS = [
  {
    id: 'text_info',
    label: 'Текстовый INFO',
    baudRate: 115200,
    request: Buffer.from('INFO?\r\n', 'ascii'),
    parse: (buffer) => parseKeyValueReply(buffer.toString('utf8')),
  },
  {
    id: 'text_info_9600',
    label: 'Текстовый INFO, 9600',
    baudRate: 9600,
    request: Buffer.from('INFO?\r\n', 'ascii'),
    parse: (buffer) => parseKeyValueReply(buffer.toString('utf8')),
  },
]

/**
 * Опрашивает порты и возвращает реквизиты первой ответившей кассы.
 *
 * @returns {Promise<{ok: true, port: string, protocol: string, data: object}
 *   | {ok: false, reason: string, message: string, ports?: string[]}>}
 */
async function readRegistration(settings = {}) {
  if (!serialPort.isAvailable()) {
    return {
      ok: false,
      reason: 'no_driver',
      message: 'Драйвер COM-портов не установлен. Выполните: npm install && npm run postinstall',
    }
  }

  let ports = []
  try {
    ports = await serialPort.listPorts()
  } catch (error) {
    return { ok: false, reason: 'list_failed', message: `Не удалось получить список портов: ${error.message}` }
  }

  const busy = excludedPorts(settings)
  const candidates = ports.filter((item) => !busy.has(String(item.path).toUpperCase()))

  if (candidates.length === 0) {
    return {
      ok: false,
      reason: 'no_port',
      message: ports.length
        ? 'Свободных COM-портов нет: занятые заняты весами и принтером.'
        : 'COM-порты не найдены. Проверьте, что касса подключена по USB и включена.',
      ports: ports.map((item) => item.path),
    }
  }

  for (const candidate of candidates) {
    for (const protocol of PROTOCOLS) {
      try {
        const reply = await serialPort.requestResponse(
          candidate.path,
          protocol.baudRate,
          protocol.request,
          { timeoutMs: 900 },
        )
        if (!reply || reply.length === 0) continue
        const parsed = protocol.parse(reply)
        if (!parsed) continue
        logger.append('device', 'info', 'kkm registration read', {
          port: candidate.path,
          protocol: protocol.id,
        })
        return { ok: true, port: candidate.path, protocol: protocol.label, data: parsed }
      } catch (error) {
        logger.append('device', 'warn', 'kkm probe failed', {
          port: candidate.path,
          protocol: protocol.id,
          message: error.message,
        })
      }
    }
  }

  return {
    ok: false,
    reason: 'not_found',
    message: `Касса не ответила ни на одном из портов: ${candidates.map((item) => item.path).join(', ')}.`,
    ports: candidates.map((item) => item.path),
  }
}

module.exports = { readRegistration }
