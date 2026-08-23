import type { PrinterSettings } from './appSettings'

export type MonoblockPresetId = 'chinese' | 'normal'

export type ReceiptLayoutPresetId = 'readable' | 'compact'

export type MonoblockPreset = {
  id: MonoblockPresetId
  title: string
  hint: string
  settings: Partial<PrinterSettings>
}

/** Готовые настройки под тип моноблока. */
export const MONOBLOCK_PRESETS: Record<MonoblockPresetId, MonoblockPreset> = {
  chinese: {
    id: 'chinese',
    title: 'Китайский / без русского',
    hint: 'Русский только картинкой — как в preview. CP866/CP1251 не помогут.',
    settings: {
      encodingMode: 'bitmap_raster',
      profile: 'custom_china',
      paperWidth: '58',
      compactMode: true,
      fontScale: 0.9,
      headerScale: 0.85,
      lineSpacing: 1.05,
      boldText: true,
      portOrPath: 'LPT1',
    },
  },
  normal: {
    id: 'normal',
    title: 'Нормальный (русский ESC/POS)',
    hint: 'Сначала картинка (красивый чек), при сбое — текст CP1251/CP866.',
    settings: {
      encodingMode: 'auto',
      profile: 'generic_escpos',
      paperWidth: '58',
      compactMode: true,
      fontScale: 0.92,
      headerScale: 0.88,
      lineSpacing: 1.1,
      boldText: true,
      portOrPath: 'LPT1',
    },
  },
}

/** Пресеты вида чека (шрифт, компактность) — отдельно от типа моноблока. */
export const RECEIPT_LAYOUT_PRESETS: Record<
  ReceiptLayoutPresetId,
  { id: ReceiptLayoutPresetId; title: string; hint: string; settings: Partial<PrinterSettings> }
> = {
  readable: {
    id: 'readable',
    title: 'Крупный (много товаров)',
    hint: 'Больше шрифт, без обрезки длинного списка. Для длинных чеков.',
    settings: {
      compactMode: false,
      fontScale: 1.05,
      headerScale: 1.0,
      lineSpacing: 1.15,
      boldText: true,
    },
  },
  compact: {
    id: 'compact',
    title: 'Компактный',
    hint: 'Меньше бумаги, мелкий текст. Для коротких чеков.',
    settings: {
      compactMode: true,
      fontScale: 0.88,
      headerScale: 0.85,
      lineSpacing: 1.05,
      boldText: true,
    },
  },
}

export function detectReceiptLayoutPreset(printer: PrinterSettings): ReceiptLayoutPresetId | null {
  if (printer.compactMode === false && printer.fontScale >= 1.0) return 'readable'
  if (printer.compactMode !== false && printer.fontScale <= 0.9) return 'compact'
  return null
}

export function applyReceiptLayoutPreset(
  printer: PrinterSettings,
  presetId: ReceiptLayoutPresetId,
): PrinterSettings {
  return { ...printer, ...RECEIPT_LAYOUT_PRESETS[presetId].settings }
}

export function detectMonoblockPreset(printer: PrinterSettings): MonoblockPresetId | null {
  if (printer.encodingMode === 'bitmap_raster') return 'chinese'
  if (printer.encodingMode === 'auto') return 'normal'
  return null
}

export function applyMonoblockPreset(
  printer: PrinterSettings,
  presetId: MonoblockPresetId,
): PrinterSettings {
  return { ...printer, ...MONOBLOCK_PRESETS[presetId].settings }
}
