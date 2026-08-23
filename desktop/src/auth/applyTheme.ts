/**
 * Акцентный цвет системы: применение, вычисление производных и проверка того,
 * что выбранный цвет вообще пригоден к работе.
 *
 * Один источник на всё приложение. В стиль <html> пишутся ровно четыре
 * величины: сам `--accent` и три, которые нельзя получить смешиванием, —
 * читаемый текст поверх заливки и две версии акцента как цвета текста.
 * Наведение, нажатие, подложка, обводка, кольцо фокуса и тень вычисляются в
 * CSS через color-mix от `var(--accent)` (см. styles/tokens.css) и
 * пересчитываются браузером сами. Разойтись производным с базой нечем: они не
 * записаны нигде отдельно.
 */

export type ThemeMode = 'light' | 'dark'

/** Стандартный акцент системы. Совпадает с дефолтом в types.ts и в базе. */
export const DEFAULT_PRIMARY = '#00f5bc'

/**
 * Поверхности, относительно которых считается читаемость.
 *
 * Значения повторяют `--bg-surface` и `--bg-rail` из styles/tokens.css.
 * Дублирование вынужденное — считать контраст надо до отрисовки, когда
 * спросить у браузера вычисленное значение переменной ещё не у кого, — но
 * держать его в одном месте на весь модуль всё же лучше, чем по месту вызова.
 */
const SURFACE_LIGHT = '#ffffff'
const SURFACE_DARK = '#151b23'
const SURFACE_RAIL = '#10151d'

/**
 * Нижняя граница контраста для текста — 4.5:1, требование WCAG AA к обычному
 * тексту. Ниже неё надпись перестаёт читаться через прилавок, а именно с этого
 * расстояния на кассу и смотрят.
 */
export const MIN_TEXT_CONTRAST = 4.5

/**
 * Насколько акцент должен отличаться от поверхности, чтобы залитая им кнопка
 * вообще была видна.
 *
 * 1.3:1, а не привычные для нетекстовых элементов 3:1. Причина в самом
 * стандартном цвете: #00f5bc на белом даёт 1.42:1 — светлая мята и правда
 * лежит близко к белому. Требование в 3:1 забраковало бы и его, и половину
 * светлых фирменных цветов, которые на деле прекрасно видны за счёт
 * насыщенности. 1.3 отсекает то, что действительно сливается: белое на белом,
 * почти-белое на светлой теме, почти-чёрное на тёмной.
 */
const MIN_SURFACE_CONTRAST = 1.3

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function isValidHex(value: string): boolean {
  return HEX_RE.test(value.trim())
}

/** Канонический #rrggbb в нижнем регистре; невалидный вход -> цвет по умолчанию. */
export function normalizeHex(value: string): string {
  const trimmed = value.trim()
  return isValidHex(trimmed) ? `#${trimmed.slice(1).toLowerCase()}` : DEFAULT_PRIMARY
}

/** Прогрессивная чистка поля ввода хекса, пока пользователь ещё печатает. */
export function sanitizeHexInput(raw: string): string {
  let value = raw.trim()
  if (!value.startsWith('#')) value = `#${value}`
  const body = value.slice(1).replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
  return `#${body}`
}

function hexToRgb(hex: string): [number, number, number] {
  const body = normalizeHex(hex).slice(1)
  const channels = [0, 2, 4].map((offset) => parseInt(body.slice(offset, offset + 2), 16))
  return channels as [number, number, number]
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (channel: number) => Math.max(0, Math.min(255, Math.round(channel)))
  return `#${[r, g, b].map((channel) => clamp(channel).toString(16).padStart(2, '0')).join('')}`
}

function mixToward(hex: string, target: [number, number, number], amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const [tr, tg, tb] = target
  return rgbToHex(r + (tr - r) * amount, g + (tg - g) * amount, b + (tb - b) * amount)
}

export function darken(hex: string, amount: number): string {
  return mixToward(hex, [0, 0, 0], amount)
}

export function lighten(hex: string, amount: number): string {
  return mixToward(hex, [255, 255, 255], amount)
}

function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a) + 0.05
  const l2 = relativeLuminance(b) + 0.05
  return l1 > l2 ? l1 / l2 : l2 / l1
}

/**
 * Чёрный или белый — что читается лучше на этом фоне.
 *
 * Выбор из двух, а не подбор оттенка, и это осознанно: у любого цвета лучший
 * из чёрного и белого даёт не меньше 4.58:1. Хуже всего дело обстоит ровно на
 * яркости 0.179, где оба варианта дают одинаковые 4.58, — и это всё равно выше
 * требуемых 4.5. То есть текст на кнопке читается при ЛЮБОМ выбранном акценте,
 * и отдельной проверки этому месту не нужно.
 */
export function readableTextOn(hex: string): string {
  return contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff') ? '#000000' : '#ffffff'
}

/**
 * Версия акцента, пригодная как цвет текста на заданной поверхности.
 *
 * Сырой акцент для этого обычно не годится: #00f5bc на белом даёт 1.4:1.
 * Затемняем (на светлой поверхности) или осветляем (на тёмной) шагами, пока не
 * наберётся нужный контраст, — оттенок при этом узнаётся, в отличие от простой
 * замены на чёрный.
 *
 * Крайний случай — когда шагов не хватило — заканчивается чистым чёрным или
 * белым, и он всегда проходит: на светлой поверхности чёрный даёт минимум 21:1,
 * на тёмной белый — не меньше 17:1.
 */
export function accentTextOn(
  accent: string,
  surface: string,
  minContrast: number = MIN_TEXT_CONTRAST,
): string {
  const normalized = normalizeHex(accent)
  if (contrastRatio(normalized, surface) >= minContrast) return normalized

  const towardDark = relativeLuminance(surface) > 0.5
  for (let step = 1; step <= 20; step += 1) {
    const candidate = towardDark ? darken(normalized, step * 0.05) : lighten(normalized, step * 0.05)
    if (contrastRatio(candidate, surface) >= minContrast) return candidate
  }
  return towardDark ? '#000000' : '#ffffff'
}

/**
 * Что не так с выбранным цветом — или пустая строка, если всё в порядке.
 *
 * Проверяется ровно одно: не сливается ли акцент с поверхностью интерфейса.
 * Читаемость текста ПОВЕРХ акцента не проверяется, потому что проверять
 * нечего — см. readableTextOn: лучший из чёрного и белого не опускается ниже
 * 4.58:1 ни для какого цвета.
 *
 * Считается по теме, которая выбрана сейчас: белый акцент нерабочий на светлой
 * теме и вполне рабочий на тёмной, и запрещать его вообще — значит запрещать
 * то, что у клиента будет выглядеть нормально.
 */
export function accentProblem(accent: string, mode: ThemeMode): string {
  if (!isValidHex(accent)) return 'Цвет задан не полностью — нужно шесть знаков после решётки.'

  const surface = mode === 'dark' ? SURFACE_DARK : SURFACE_LIGHT
  if (contrastRatio(accent, surface) < MIN_SURFACE_CONTRAST) {
    return mode === 'dark'
      ? 'Цвет почти сливается с тёмным фоном — кнопок и вкладок не будет видно. Возьмите светлее.'
      : 'Цвет почти сливается со светлым фоном — кнопок и вкладок не будет видно. Возьмите темнее.'
  }
  return ''
}

/**
 * Предупреждение о второй теме — не запрет.
 *
 * Тема переключается отдельно от цвета, и цвет, прекрасно работающий на
 * светлой, может пропасть на тёмной. Сказать об этом надо, а запрещать
 * нельзя: магазин выбрал светлую тему и в тёмную может не зайти никогда.
 */
export function accentOtherThemeWarning(accent: string, mode: ThemeMode): string {
  const other: ThemeMode = mode === 'dark' ? 'light' : 'dark'
  if (!accentProblem(accent, other)) return ''
  return other === 'dark'
    ? 'На тёмной теме этот цвет будет почти не виден. Со светлой темой всё в порядке.'
    : 'На светлой теме этот цвет будет почти не виден. С тёмной темой всё в порядке.'
}

/**
 * Применяет тему и акцент ко всему приложению.
 *
 * Ставит data-theme на <html> (styles/tokens.css переключает по нему
 * нейтральные токены) и пишет акцент. Производные не пишутся — их считает CSS
 * от `--accent`, см. шапку файла.
 */
export function applyTheme({ mode, primary }: { mode: ThemeMode; primary: string }): void {
  const root = document.documentElement
  root.dataset.theme = mode

  const accent = normalizeHex(primary)
  const surface = mode === 'dark' ? SURFACE_DARK : SURFACE_LIGHT

  const style = root.style
  style.setProperty('--accent', accent)
  style.setProperty('--accent-fg', readableTextOn(accent))
  style.setProperty('--accent-text', accentTextOn(accent, surface))
  // Заголовки и значения поверх мягкой подложки — на шаг заметнее обычного
  // акцентного текста. Потолок в 7:1 (WCAG AAA), выше подбирать нечего.
  style.setProperty('--accent-text-strong', accentTextOn(accent, surface, 7))
  style.setProperty('--accent-on-rail', accentTextOn(accent, SURFACE_RAIL))
}

/* -------------------------------------------------------------------------- */
/* Применение до первой отрисовки                                             */
/* -------------------------------------------------------------------------- */

/**
 * Где лежит выбор оформления между запусками.
 *
 * Зачем вообще копия, когда есть сервер и есть настройки магазина: сервер
 * отвечает через сеть, пусть и локальную, а тема нужна ДО первого кадра.
 * Дождаться ответа — значит показать кассиру вспышку стандартной мяты и
 * перекрасить экран у него на глазах. Поэтому выбор дублируется сюда, читается
 * синхронно при старте, а ответ сервера просто обновляет копию.
 *
 * Источник истины при этом остаётся один — база. Здесь именно кэш: если он
 * разойдётся с сервером, следующий же ответ его поправит.
 */
const THEME_CACHE_KEY = 'nurcrm-theme'

type ThemeChoice = { mode: ThemeMode; primary: string }

export function readCachedTheme(): ThemeChoice | null {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ThemeChoice>
    if (parsed?.mode !== 'light' && parsed?.mode !== 'dark') return null
    if (typeof parsed.primary !== 'string' || !isValidHex(parsed.primary)) return null
    return { mode: parsed.mode, primary: normalizeHex(parsed.primary) }
  } catch {
    // Приватный режим или испорченная запись: встанем на стандартный цвет.
    return null
  }
}

export function cacheTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(choice))
  } catch {
    /* не запомнилось — на этом запуске цвет всё равно уже применён */
  }
}

/**
 * Применить и запомнить одним действием. Всё, что меняет цвет магазина
 * (мастер, сервисный проход, ответ сервера), зовёт именно её — иначе кэш
 * отстанет и следующий запуск моргнёт старым цветом.
 */
export function applyAndCacheTheme(choice: ThemeChoice): void {
  applyTheme(choice)
  cacheTheme(choice)
}

/**
 * Первое применение при старте — синхронно, до отрисовки React.
 *
 * Если магазин ещё не заведён (кэша нет), ничего не делаем вовсе: в
 * styles/tokens.css уже стоит стандартный #00f5bc и светлая тема, и трогать их
 * незачем.
 */
export function applyStoredTheme(): void {
  const cached = readCachedTheme()
  if (cached) applyTheme(cached)
}
