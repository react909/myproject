/**
 * Обработка картинки QR перед тем, как она попадёт на экран покупателя.
 *
 * Магазин приносит снимок экрана из банковского приложения: вокруг самого кода
 * там шапка приложения, кнопки, подписи и поля. Показывать это покупателю
 * целиком — значит отдать половину экрана под чужой интерфейс, а сам код
 * сделать мелким.
 *
 * Отсюда две функции. `autoTrimQr` находит границы кода и обрезает поля сама.
 * `decodeQr` проверяет, что после обрезки код всё ещё читается: слишком тесная
 * обрезка съедает «тихую зону» по краям, без которой сканеры перестают его
 * видеть. Без этой проверки о поломке узнали бы на кассе при живом клиенте.
 */

import jsQR from 'jsqr'

/** Порог яркости, ниже которого точка считается частью кода. */
const DARK_LEVEL = 128

/**
 * Ширина «тихой зоны» вокруг кода в модулях стандарта — четыре. Мы не знаем
 * размер модуля, поэтому оставляем поле в долях от найденного кода: этого
 * достаточно, чтобы сканер видел границу.
 */
const QUIET_ZONE_RATIO = 0.06

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Не удалось открыть изображение.'))
    image.src = source
  })
}

function drawToCanvas(image: HTMLImageElement): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Не удалось подготовить холст.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0)
  return [canvas, context]
}

/**
 * Читается ли QR на картинке.
 *
 * Возвращает содержимое кода или пустую строку. Пустая строка — не обязательно
 * поломка: снимок может быть просто размытым. Но если код читался до обрезки и
 * перестал после неё, обрезали слишком тесно.
 */
export async function decodeQr(source: string): Promise<string> {
  return (await inspectQr(source)).text
}

export type QrInspection = {
  /** Содержимое кода. Пусто — распознать не удалось. */
  text: string
  /**
   * Самое узкое поле вокруг кода, в модулях. −1, если код не распознан.
   *
   * Стандарт требует четыре модуля тихой зоны. Меньше двух — код почти
   * наверняка не возьмут дешёвые сканеры и камеры старых телефонов, даже
   * если наш декодер справился.
   */
  quietZoneModules: number
}

/**
 * Разбирает картинку QR: читается ли код и сколько вокруг него поля.
 *
 * Одной проверки «читается» мало, и это выяснилось на измерении: jsQR берёт
 * код и с нулевой тихой зоной, тогда как настоящий сканер на кассе — нет.
 * Поэтому поле считается отдельно, по координатам угловых меток.
 */
export async function inspectQr(source: string): Promise<QrInspection> {
  if (!source) return { text: '', quietZoneModules: -1 }
  try {
    const image = await loadImage(source)
    const [canvas, context] = drawToCanvas(image)
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
    const found = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })
    if (!found) return { text: '', quietZoneModules: -1 }

    const corners = [
      found.location.topLeftCorner,
      found.location.topRightCorner,
      found.location.bottomLeftCorner,
      found.location.bottomRightCorner,
    ]
    const xs = corners.map((corner) => corner.x)
    const ys = corners.map((corner) => corner.y)
    const left = Math.min(...xs)
    const right = Math.max(...xs)
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)

    // Размер модуля: сторона кода делится на число модулей. Число модулей
    // однозначно задаётся версией — это формула стандарта, а не догадка.
    const side = Math.max(right - left, bottom - top)
    const moduleCount = found.version > 0 ? found.version * 4 + 17 : 21
    const modulePx = side / moduleCount
    if (modulePx <= 0) return { text: found.data, quietZoneModules: -1 }

    const margin = Math.min(left, top, width - right, height - bottom)
    return { text: found.data, quietZoneModules: Math.floor(margin / modulePx) }
  } catch {
    return { text: '', quietZoneModules: -1 }
  }
}

/**
 * Обрезает поля вокруг кода.
 *
 * Сначала пробуем найти сам код через jsQR: он возвращает координаты трёх
 * угловых меток, и это самый надёжный способ. Если код не распознался (снимок
 * бледный или под углом), откатываемся на поиск границ тёмных точек — грубее,
 * но работает и на том, что jsQR не берёт.
 *
 * Возвращает пустую строку, если обрезать нечего: полей нет или картинку не
 * удалось разобрать. Вызывающий в этом случае оставляет оригинал.
 */
export async function autoTrimQr(source: string): Promise<string> {
  if (!source) return ''
  const image = await loadImage(source)
  const [canvas, context] = drawToCanvas(image)
  const { width, height } = canvas
  const pixels = context.getImageData(0, 0, width, height)

  const bounds =
    boundsFromDecoder(pixels) ?? boundsFromDarkPixels(pixels.data, width, height)
  if (!bounds) return ''

  // Тихая зона: без поля по краям сканеры теряют границу кода.
  const side = Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top)
  const pad = Math.round(side * QUIET_ZONE_RATIO)
  const left = Math.max(0, bounds.left - pad)
  const top = Math.max(0, bounds.top - pad)
  const right = Math.min(width, bounds.right + pad)
  const bottom = Math.min(height, bounds.bottom + pad)

  const cropWidth = right - left
  const cropHeight = bottom - top
  if (cropWidth < 16 || cropHeight < 16) return ''
  // Обрезать почти ничего — значит только пережать картинку зря.
  if (cropWidth >= width * 0.98 && cropHeight >= height * 0.98) return ''

  const out = document.createElement('canvas')
  out.width = cropWidth
  out.height = cropHeight
  const outContext = out.getContext('2d')
  if (!outContext) return ''
  outContext.fillStyle = '#ffffff'
  outContext.fillRect(0, 0, cropWidth, cropHeight)
  outContext.drawImage(canvas, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
  return out.toDataURL('image/png')
}

type Bounds = { left: number; top: number; right: number; bottom: number }

/** Границы по угловым меткам, которые вернул декодер. Самый точный способ. */
function boundsFromDecoder(pixels: ImageData): Bounds | null {
  const found = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' })
  if (!found) return null
  const corners = [
    found.location.topLeftCorner,
    found.location.topRightCorner,
    found.location.bottomLeftCorner,
    found.location.bottomRightCorner,
  ]
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  return {
    left: Math.max(0, Math.floor(Math.min(...xs))),
    top: Math.max(0, Math.floor(Math.min(...ys))),
    right: Math.min(pixels.width, Math.ceil(Math.max(...xs))),
    bottom: Math.min(pixels.height, Math.ceil(Math.max(...ys))),
  }
}

/**
 * Границы по тёмным точкам — запасной путь, когда код не распознался.
 *
 * Считает по строкам и столбцам, где вообще есть тёмное. На снимке из
 * банковского приложения тёмным будет и текст интерфейса, поэтому способ
 * грубее: он обрежет поля, но не гарантирует, что вырезал ровно код. Тем не
 * менее это лучше, чем не обрезать вовсе, а результат человек видит сразу.
 */
function boundsFromDarkPixels(data: Uint8ClampedArray, width: number, height: number): Bounds | null {
  let left = width
  let top = height
  let right = 0
  let bottom = 0
  let seen = false

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4
      const luma = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
      // Прозрачные точки — не содержимое: у PNG со скруглёнными углами они
      // дали бы ложную границу.
      if (data[p + 3] < 32 || luma >= DARK_LEVEL) continue
      seen = true
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }

  if (!seen || right <= left || bottom <= top) return null
  return { left, top, right: right + 1, bottom: bottom + 1 }
}
