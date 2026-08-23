// receipt-template.cjs
const iconv = require('iconv-lite')
const escpos = require('./escpos.cjs')
const { wrapProductName } = require('../receipt/receipt-render.cjs')
const {
  buildInitBuffer,
  resolveStrategyFromSettings,
  loadPersistedProfile,
} = require('./printer-profiles.cjs')

function encodingToIconv(encoding) {
  if (encoding === 'CP1251') return 'win1251'
  if (encoding === 'UTF-8') return 'utf8'
  if (encoding === 'KOI8-R') return 'koi8-r'
  if (encoding === 'ISO-8859-5') return 'iso88595'
  return 'cp866'
}

function encodeLine(text, encoding) {
  return iconv.encode(text, encodingToIconv(encoding))
}

function paperLayout(printerCfg) {
  const is80 = printerCfg?.paperWidth === '80'
  return {
    width: is80 ? 48 : 32,
    nameMax: is80 ? 32 : 22,
    qtyMax: is80 ? 8 : 6,
    sumMax: is80 ? 10 : 8,
  }
}

function twoCol(left, right, width) {
  const l = String(left)
  const r = String(right)
  const space = width - l.length - r.length
  if (space <= 1) return `${l.slice(0, width - r.length - 1)} ${r}`.slice(0, width)
  return l + ' '.repeat(space) + r
}

function center(text, width) {
  const s = String(text)
  if (s.length >= width) return s.slice(0, width)
  const total = width - s.length
  const left = Math.floor(total / 2)
  return ' '.repeat(left) + s
}

function sep(char = '-', width) {
  return char.repeat(width)
}

function buildReceiptBuffer(data, printerCfg, userDataPath) {
  const layout = paperLayout(printerCfg)
  const WIDTH = layout.width
  const persisted = userDataPath ? loadPersistedProfile(userDataPath) : null
  const strategy = resolveStrategyFromSettings(printerCfg, persisted)
  const encoding = strategy.encoding
  const enc = (line) => encodeLine(line, encoding)

  const chunks = []
  chunks.push(buildInitBuffer(strategy.init))

  chunks.push(escpos.alignCenter())
  chunks.push(
    escpos.bold(true),
    escpos.textLine(data.storeName || 'Магазин', enc),
    escpos.bold(false),
  )

  if (data.storeAddress) chunks.push(escpos.textLine(data.storeAddress, enc))
  if (data.storePhone) chunks.push(escpos.textLine(data.storePhone, enc))
  if (data.taxId) chunks.push(escpos.textLine(`ИНН: ${data.taxId}`, enc))

  chunks.push(escpos.feed(1))

  if (data.receiptNumber) {
    chunks.push(
      escpos.bold(true),
      escpos.textLine(`ЧЕК № ${data.receiptNumber}`, enc),
      escpos.bold(false),
    )
  }

  chunks.push(
    escpos.textLine(data.date || '', enc),
    escpos.alignLeft(),
    escpos.textLine(sep('=', WIDTH), enc),
  )

  for (const line of data.lines || []) {
    const nameLines = wrapProductName(line.name, layout.nameMax)
    for (const nameLine of nameLines) {
      chunks.push(escpos.textLine(nameLine, enc))
    }

    const qtyPart = [line.qty, line.unit].filter(Boolean).join(' ')
    const detail = line.price ? `${qtyPart} x ${line.price}` : qtyPart
    const sumStr = String(line.sum ?? '').slice(0, layout.sumMax)
    chunks.push(escpos.textLine(twoCol(detail.slice(0, WIDTH - layout.sumMax - 1), sumStr, WIDTH), enc))

    if (line.discount) {
      chunks.push(escpos.textLine(`  Скидка: -${line.discount}`, enc))
    }
  }

  chunks.push(escpos.textLine(sep('-', WIDTH), enc))

  if (data.gross && data.discount) {
    chunks.push(
      escpos.textLine(twoCol('Сумма без скидки:', data.gross, WIDTH), enc),
      escpos.textLine(twoCol('Скидка:', `-${data.discount}`, WIDTH), enc),
    )
  }

  chunks.push(
    escpos.textLine(sep('=', WIDTH), enc),
    escpos.bold(true),
    escpos.textLine(twoCol('ИТОГО:', data.total, WIDTH), enc),
    escpos.bold(false),
    escpos.textLine(sep('=', WIDTH), enc),
  )

  if (data.paymentMethod) {
    chunks.push(escpos.textLine(twoCol('Оплата:', data.paymentMethod, WIDTH), enc))
  }
  if (data.cash) {
    chunks.push(escpos.textLine(twoCol('Наличные:', data.cash, WIDTH), enc))
  }
  if (data.change) {
    chunks.push(
      escpos.bold(true),
      escpos.textLine(twoCol('Сдача:', data.change, WIDTH), enc),
      escpos.bold(false),
    )
  }

  chunks.push(
    escpos.textLine(sep('-', WIDTH), enc),
    escpos.textLine(twoCol('Кассир:', data.cashier || '-', WIDTH), enc),
    escpos.feed(1),
    escpos.alignCenter(),
    escpos.bold(true),
    escpos.textLine(data.thankYou || 'Спасибо за покупку!', enc),
    escpos.bold(false),
    escpos.feed(3),
    escpos.cut(),
  )

  return Buffer.concat(chunks)
}

module.exports = { buildReceiptBuffer, resolveStrategyFromSettings }
