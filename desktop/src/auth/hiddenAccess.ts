/**
 * Сочетания клавиш для скрытых настроек.
 *
 * Владельца аккорд впускает сразу, специалиста — только взводит ожидание
 * жеста: дальше нужно удержать логотип. Разбор, почему так, — в
 * useHiddenAccess.
 *
 * Про сочетания. Аккорд вида «Ctrl+Alt+L+I» технически не существует:
 * клавиатура не передаёт две обычные буквенные клавиши в одном аккорде. Стрелки
 * — другое дело: у них отдельные коды, они не зависят от раскладки, и зажать
 * обе при трёх модификаторах можно. На этом и построен аккорд специалиста
 * (`matchesSpecialistChord`); у владельца остаётся обычное сочетание.
 *
 * Сочетания лежат в настройках, а не в коде, чтобы менять их без пересборки.
 */

export type HiddenAccessShortcuts = {
  /** Настройки владельца: финансы, отчёты, сотрудники. */
  owner: string
  /**
   * Взвод входа специалиста. Не сочетание, а аккорд из двух клавиш при трёх
   * зажатых модификаторах — обычным `matchesShortcut` не проверяется, см.
   * `matchesSpecialistChord`.
   */
  specialist: string
  /** Сколько миллисекунд держать логотип, чтобы открылся тот же диалог. */
  longPressMs: number
}

/**
 * Аккорд специалиста: `Ctrl+Alt+Shift` и обе стрелки.
 *
 * Три модификатора удерживаются, влево и вправо нажимаются — в любом порядке,
 * лишь бы обе оказались зажаты одновременно. Записан строкой ради единообразия
 * с аккордом владельца, но проверяется отдельной функцией: сочетаний из двух
 * обычных клавиш не бывает, а из двух стрелок при модификаторах — бывает, и
 * именно потому, что стрелки клавиатура передаёт как отдельные коды и в
 * раскладке не участвуют.
 *
 * Почему не `Ctrl+Esc`, с которого начинали: его Windows забирает себе на меню
 * «Пуск», и до приложения он не доходит вовсе. Буквенные аккорды вида
 * `Ctrl+Alt+L+I` невозможны технически — две обычные клавиши в одном аккорде
 * клавиатура не передаёт.
 */
export const SPECIALIST_CHORD = 'Ctrl+Alt+Shift+ArrowLeft+ArrowRight'

export const DEFAULT_HIDDEN_ACCESS: HiddenAccessShortcuts = {
  owner: 'Ctrl+Shift+M',
  specialist: SPECIALIST_CHORD,
  /*
    Пять секунд, а не десять.

    Долгое удержание было защитой от случайного попадания локтем и рукавом:
    жест жил сам по себе, и открыть окно ключа мог кто угодно, кто до него
    дотронется. Теперь удержание работает только после аккорда (см.
    useHiddenAccess), случайно его не поймать, и держать вдвое дольше нужного
    незачем — специалист стоит у кассы с занятыми руками.
  */
  longPressMs: 5000,
}

/**
 * Сработал ли аккорд специалиста на этом событии.
 *
 * `pressed` — коды клавиш, зажатых прямо сейчас, вместе с той, что пришла в
 * этом событии. Считает вызывающий: браузер не сообщает состояние всей
 * клавиатуры, а `event.getModifierState` знает только про модификаторы.
 *
 * Модификаторы берутся из самого события, а не из набора: раскладка и
 * автоповтор иногда не присылают keydown на сам модификатор, зато флаги
 * `ctrlKey`/`altKey`/`shiftKey` в событии стрелки стоят всегда.
 */
export function matchesSpecialistChord(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey'>,
  pressed: ReadonlySet<string>,
): boolean {
  if (!event.ctrlKey || !event.altKey || !event.shiftKey) return false
  return pressed.has('ArrowLeft') && pressed.has('ArrowRight')
}

/**
 * Сколько времени стрелки считаются нажатыми «вместе».
 *
 * Требовать физической одновременности оказалось слишком строго: человек с
 * зажатыми тремя модификаторами жмёт стрелки по очереди — влево, потом
 * вправо, — и первую нередко успевает отпустить. Со стороны это выглядит как
 * «аккорд не работает», хотя сделано всё правильно.
 *
 * Полторы секунды: обе стрелки, нажатые подряд в пределах этого времени,
 * засчитываются за аккорд. Случайно так не выходит — три модификатора всё это
 * время должны быть зажаты.
 */
export const CHORD_WINDOW_MS = 1500

/**
 * Более снисходительная проверка аккорда: по времени, а не по одновременности.
 *
 * `pressedAt` — когда каждая стрелка нажималась последний раз. Аккорд считается
 * набранным, если обе нажимались не дольше `CHORD_WINDOW_MS` назад, а
 * модификаторы зажаты прямо сейчас.
 */
export function matchesSpecialistChordWithin(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey'>,
  pressedAt: ReadonlyMap<string, number>,
  now: number,
): boolean {
  if (!event.ctrlKey || !event.altKey || !event.shiftKey) return false
  const left = pressedAt.get('ArrowLeft')
  const right = pressedAt.get('ArrowRight')
  if (left === undefined || right === undefined) return false
  return now - left <= CHORD_WINDOW_MS && now - right <= CHORD_WINDOW_MS
}

/** Приводит сочетание к каноничному виду: «ctrl+alt+shift+s». */
export function normalizeShortcut(value: string): string {
  const parts = value
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
  const modifiers = ['ctrl', 'alt', 'shift', 'meta'].filter((mod) => parts.includes(mod))
  const key = parts.find((part) => !['ctrl', 'alt', 'shift', 'meta'].includes(part)) ?? ''
  return [...modifiers, key].filter(Boolean).join('+')
}

/** Сочетание, которое соответствует событию клавиатуры. */
export function shortcutFromEvent(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('ctrl')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  if (event.metaKey) parts.push('meta')
  // event.key при зажатом Shift даёт «S», а при Alt на части раскладок —
  // произвольный символ. Поэтому берём физическую клавишу из code.
  const code = event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.code.toLowerCase()
  parts.push(code)
  return parts.join('+')
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  return shortcutFromEvent(event) === normalizeShortcut(shortcut)
}

/** Человеческая запись сочетания для подсказки на экране. */
export function shortcutLabel(shortcut: string): string {
  return normalizeShortcut(shortcut)
    .split('+')
    .map((part) => (part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' + ')
}
