const fs = require('node:fs')
const path = require('node:path')
const escpos = require('./escpos.cjs')

/** @typedef {{ id: string, encoding: string, codePage: number, init: string[], label: string }} PrintStrategy */

const STRATEGIES = [
  {
    id: 'force_ru_cp1251',
    label: 'Force Russian CP1251',
    encoding: 'CP1251',
    codePage: 46,
    init: ['disableChinese', 'cancelKanji', 'charset7', 'page46'],
  },
  {
    id: 'force_ru_cp866',
    label: 'Force Russian CP866',
    encoding: 'CP866',
    codePage: 17,
    init: ['disableChinese', 'cancelKanji', 'charset7', 'page17'],
  },
  {
    id: 'chinese_panel_cp866',
    label: 'Chinese panel CP866',
    encoding: 'CP866',
    codePage: 17,
    init: ['disableChinese', 'cancelKanji', 'vendorInit', 'whitePanelInit', 'charset7', 'page17'],
  },
  {
    id: 'chinese_pos_cp936',
    label: 'Chinese POS + CP1251',
    encoding: 'CP1251',
    codePage: 46,
    init: ['disableChinese', 'cancelKanji', 'vendorInit', 'charset7', 'page46'],
  },
  {
    id: 'legacy_escpos_cp866',
    label: 'Legacy ESC/POS CP866',
    encoding: 'CP866',
    codePage: 17,
    init: ['disableChinese', 'page17'],
  },
  {
    id: 'utf8_fallback',
    label: 'UTF-8 Fallback',
    encoding: 'UTF-8',
    codePage: 0,
    init: ['disableChinese', 'cancelKanji'],
  },
  {
    id: 'sunmi_cp1251',
    label: 'Sunmi CP1251',
    encoding: 'CP1251',
    codePage: 46,
    init: ['disableChinese', 'sunmiInit', 'charset7', 'page46'],
  },
  {
    id: 'posiflex_cp1251',
    label: 'Posiflex CP1251',
    encoding: 'CP1251',
    codePage: 46,
    init: ['disableChinese', 'vendorInit', 'charset7', 'page46'],
  },
  {
    id: 'white_panel_cp1251',
    label: 'White panel CP1251',
    encoding: 'CP1251',
    codePage: 46,
    init: ['disableChinese', 'cancelKanji', 'vendorInit', 'whitePanelInit', 'charset7', 'page46'],
  },
]

const PROFILE_ORDER = {
  auto: STRATEGIES.map((s) => s.id),
  sunmi: ['sunmi_cp1251', 'force_ru_cp1251', 'force_ru_cp866', 'utf8_fallback'],
  posiflex: ['posiflex_cp1251', 'force_ru_cp1251', 'force_ru_cp866'],
  custom_china: [
    'white_panel_cp1251',
    'chinese_panel_cp866',
    'chinese_pos_cp936',
    'force_ru_cp1251',
    'force_ru_cp866',
    'legacy_escpos_cp866',
  ],
  generic_escpos: ['force_ru_cp1251', 'force_ru_cp866', 'legacy_escpos_cp866', 'utf8_fallback'],
  legacy_chinese: ['legacy_escpos_cp866', 'chinese_panel_cp866', 'chinese_pos_cp936', 'force_ru_cp866'],
}

function strategyById(id) {
  return STRATEGIES.find((s) => s.id === id) ?? STRATEGIES[0]
}

function buildInitBuffer(initFlags) {
  const chunks = [escpos.init()]
  for (const flag of initFlags) {
    if (flag === 'disableChinese') chunks.push(escpos.disableChineseMode())
    if (flag === 'cancelKanji') chunks.push(escpos.cancelKanjiMode())
    if (flag === 'vendorInit') chunks.push(escpos.vendorInitSequence())
    if (flag === 'sunmiInit') chunks.push(escpos.sunmiInitSequence())
    if (flag === 'whitePanelInit') chunks.push(escpos.whitePanelInitSequence())
    if (flag === 'charset7') chunks.push(escpos.selectInternationalCharset(7))
    if (flag === 'page17') chunks.push(escpos.selectCodePage(17))
    if (flag === 'page46') chunks.push(escpos.selectCodePage(46))
  }
  return Buffer.concat(chunks)
}

function resolveStrategyFromSettings(printerCfg, persisted) {
  const mode = printerCfg?.encodingMode ?? 'auto'
  const profile = printerCfg?.profile ?? 'auto'

  if (mode === 'cp1251') return strategyById('force_ru_cp1251')
  if (mode === 'cp866') return strategyById('force_ru_cp866')
  if (mode === 'chinese_pos') return strategyById('chinese_pos_cp936')
  if (mode === 'legacy_escpos') return strategyById('legacy_escpos_cp866')
  if (mode === 'utf8_fallback') return strategyById('utf8_fallback')
  if (mode === 'force_russian') return strategyById('force_ru_cp1251')

  if (mode === 'manual' && printerCfg?.manualEncoding) {
    const enc = printerCfg.manualEncoding
    const page = Number.parseInt(String(printerCfg.manualCodePage || '').replace(/\D/g, ''), 10)
    return {
      id: 'manual',
      label: 'Manual',
      encoding: enc,
      codePage: Number.isFinite(page) ? page : enc === 'CP1251' ? 46 : 17,
      init: ['disableChinese', 'cancelKanji', 'charset7'],
    }
  }

  if (persisted?.strategyId) {
    const saved = strategyById(persisted.strategyId)
    if (saved) return saved
  }

  const order = PROFILE_ORDER[profile] ?? PROFILE_ORDER.auto
  return strategyById(order[0])
}

function listStrategiesForAutoTest(printerCfg, persisted) {
  const profile = printerCfg?.profile ?? 'auto'
  const order = PROFILE_ORDER[profile] ?? PROFILE_ORDER.auto
  const ids = [...new Set([persisted?.strategyId, ...order].filter(Boolean))]
  return ids.map((id) => strategyById(id))
}

function loadPersistedProfile(userDataPath) {
  try {
    const p = path.join(userDataPath, 'printer-profile.json')
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function savePersistedProfile(userDataPath, data) {
  try {
    const p = path.join(userDataPath, 'printer-profile.json')
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

module.exports = {
  STRATEGIES,
  buildInitBuffer,
  resolveStrategyFromSettings,
  listStrategiesForAutoTest,
  loadPersistedProfile,
  savePersistedProfile,
  strategyById,
}
