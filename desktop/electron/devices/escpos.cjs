/** Минимальный ESC/POS: инициализация, текст, отрез. */
const GS = 0x1d
const ESC = 0x1b

function cmd(...bytes) {
  return Buffer.from(bytes)
}

function init() {
  return cmd(ESC, 0x40)
}

function alignCenter() {
  return cmd(ESC, 0x61, 1)
}

function alignLeft() {
  return cmd(ESC, 0x61, 0)
}

function bold(on) {
  return cmd(ESC, 0x45, on ? 1 : 0)
}

function textLine(str, encodingBuffer) {
  return Buffer.concat([encodingBuffer(str + '\n')])
}

function cut() {
  return cmd(GS, 0x56, 0)
}

function feed(lines = 3) {
  return cmd(ESC, 0x64, Math.min(255, lines))
}

function doubleSize(on) {
  return cmd(GS, 0x21, on ? 0x11 : 0x00)
}

/** Отключить китайский/канцзи-режим (типично на китайских ESC/POS). */
function disableChineseMode() {
  return cmd(0x1c, 0x2e)
}

/** FS . — отмена режима Kanji */
function cancelKanjiMode() {
  return cmd(0x1c, 0x2e)
}

/** ESC @ + vendor wake для «белых» и китайских панелей */
function vendorInitSequence() {
  return Buffer.concat([
    cmd(ESC, 0x40),
    cmd(ESC, 0x74, 46),
    cmd(ESC, 0x52, 7),
  ])
}

function sunmiInitSequence() {
  return Buffer.concat([cmd(ESC, 0x40), cmd(ESC, 0x74, 46)])
}

function whitePanelInitSequence() {
  return Buffer.concat([
    cmd(0x1c, 0x2e),
    cmd(ESC, 0x40),
    cmd(ESC, 0x74, 46),
    cmd(ESC, 0x52, 7),
    cmd(0x1b, 0x39, 0x01),
  ])
}

/** ESC t n — таблица символов (17 = PC866, 46 = WPC1251 на большинстве принтеров). */
function selectCodePage(n) {
  return cmd(ESC, 0x74, Math.max(0, Math.min(255, n)))
}

/** ESC R n — международный набор (7 = Russia на многих прошивках). */
function selectInternationalCharset(n = 7) {
  return cmd(ESC, 0x52, Math.max(0, Math.min(255, n)))
}

module.exports = {
  init,
  alignCenter,
  alignLeft,
  bold,
  textLine,
  cut,
  feed,
  doubleSize,
  disableChineseMode,
  cancelKanjiMode,
  vendorInitSequence,
  sunmiInitSequence,
  whitePanelInitSequence,
  selectCodePage,
  selectInternationalCharset,
}
