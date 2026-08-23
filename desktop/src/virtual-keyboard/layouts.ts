/**
 * Раскладки экранной клавиатуры — один набор на всё приложение.
 *
 * Клавиатур в кассе две, и это не дублирование, а разные роли: плавающая
 * (VirtualKeyboard) всплывает над любым полем, встроенная (AccessKeypad) живёт
 * внутри окна ввода ключа, потому что там нельзя зависеть от того, всплыла ли
 * панель поверх модального окна. А вот раскладки у них обязаны быть одни: пока
 * их было две, во встроенной не было ни русских букв, ни символов — ключ с
 * буквой «ж» на моноблоке было не набрать вовсе.
 *
 * Русская раскладка первая: касса продаётся в Кыргызстане, названия и ключи
 * чаще набирают по-русски.
 */

export type KeyboardLayout = 'russian' | 'english' | 'symbols1' | 'symbols2'

export const RU_ROWS_LOWER = [
  ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х'],
  ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э'],
  ['я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', 'ё'],
]

export const RU_ROWS_UPPER = [
  ['Й', 'Ц', 'У', 'К', 'Е', 'Н', 'Г', 'Ш', 'Щ', 'З', 'Х'],
  ['Ф', 'Ы', 'В', 'А', 'П', 'Р', 'О', 'Л', 'Д', 'Ж', 'Э'],
  ['Я', 'Ч', 'С', 'М', 'И', 'Т', 'Ь', 'Б', 'Ю', 'Ё'],
]

export const EN_ROWS_LOWER = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
]

export const EN_ROWS_UPPER = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
]

export const SYMBOLS_PAGE_1 = [
  ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'],
  ['-', '_', '+', '=', '{', '}', '[', ']', '\\', '|'],
  [';', ':', "'", '"', ',', '.', '<', '>', '/', '?'],
]

export const SYMBOLS_PAGE_2 = [
  ['€', '£', '¥', '₽', '¢', '©', '®', '™', '°', '±'],
  ['~', '`', '§', '¶', '†', '‡', '•', '…', '‰', '′'],
  ['←', '→', '↑', '↓', '↔', '✓', '✗', '★', '☆', '♪'],
]

/** Цифровой ряд. Отдельно от букв: он одинаков во всех раскладках. */
export const DIGITS_ROW = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

/** Правый калькуляторный блок плавающей клавиатуры. */
export const CALC_ROWS = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
  ['0', '.', ','],
]

/**
 * Ряды букв или символов для выбранной раскладки.
 *
 * `shift` действует только на буквы: у символов верхнего регистра нет, и
 * переключать там нечего — вместо этого работает вторая страница символов.
 */
export function rowsFor(layout: KeyboardLayout, shift: boolean): string[][] {
  if (layout === 'russian') return shift ? RU_ROWS_UPPER : RU_ROWS_LOWER
  if (layout === 'english') return shift ? EN_ROWS_UPPER : EN_ROWS_LOWER
  return layout === 'symbols1' ? SYMBOLS_PAGE_1 : SYMBOLS_PAGE_2
}

/** Подпись переключателя раскладки. */
export const LAYOUT_LABELS: Record<KeyboardLayout, string> = {
  russian: 'РУС',
  english: 'ENG',
  symbols1: '!#1',
  symbols2: '€→★',
}

/** Порядок перебора раскладок по кнопке переключения. */
export const LAYOUT_ORDER: KeyboardLayout[] = ['russian', 'english', 'symbols1', 'symbols2']

export function nextLayout(current: KeyboardLayout): KeyboardLayout {
  const index = LAYOUT_ORDER.indexOf(current)
  return LAYOUT_ORDER[(index + 1) % LAYOUT_ORDER.length]
}
