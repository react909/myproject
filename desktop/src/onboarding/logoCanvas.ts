/**
 * Сборка логотипа на canvas.
 *
 * Всё, что здесь получается, — готовый PNG для шапки чека. Чек печатается
 * термопринтером в один бит на точку, поэтому картинка сразу собирается
 * контрастной: полутона на ленте превращаются в грязь.
 */

import type { Area } from 'react-easy-crop'
import type { LogoShape } from './types'

/** Сторона квадратного логотипа. 512 хватает и для чека (384 точки), и для UI. */
export const LOGO_SIZE = 512

export type MonogramStyle = 'solid' | 'gradient' | 'outline' | 'circle'

export const MONOGRAM_STYLES: { id: MonogramStyle; label: string }[] = [
  { id: 'solid', label: 'Заливка' },
  { id: 'gradient', label: 'Градиент' },
  { id: 'outline', label: 'Контур' },
  { id: 'circle', label: 'Круг' },
]

function createCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Не удалось подготовить холст для логотипа.')
  return [canvas, context]
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Не удалось открыть изображение.'))
    image.src = source
  })
}

function roundedPath(
  context: CanvasRenderingContext2D,
  size: number,
  radius: number,
): void {
  context.beginPath()
  context.moveTo(radius, 0)
  context.arcTo(size, 0, size, size, radius)
  context.arcTo(size, size, 0, size, radius)
  context.arcTo(0, size, 0, 0, radius)
  context.arcTo(0, 0, size, 0, radius)
  context.closePath()
}

export function shade(hex: string, amount: number): string {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16)
    const shifted = amount < 0 ? channel * (1 + amount) : channel + (255 - channel) * amount
    return Math.max(0, Math.min(255, Math.round(shifted)))
  })
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** Читаемый цвет текста на заданном фоне — по воспринимаемой яркости. */
export function readableTextOn(hex: string): string {
  const value = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16))
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.62 ? '#10151d' : '#ffffff'
}

/**
 * Настоящая обрезка: из исходника вырезается ровно выбранная область с учётом
 * поворота, и результат кладётся в квадрат LOGO_SIZE. Предыдущая версия только
 * двигала картинку, поэтому «обрезать» ничего не обрезало.
 */
/**
 * Отражает исходник целиком.
 *
 * Отражение применяется к самой картинке, а не к превью поверх неё: библиотека
 * обрезки считает координаты области по неотражённому изображению, и любое
 * «зеркало» только в CSS увело бы результат в сторону от того, что человек
 * видел на экране.
 */
export async function flipImage(imageUrl: string, axis: 'horizontal' | 'vertical'): Promise<string> {
  const image = await loadImage(imageUrl)
  const [canvas, context] = createCanvas(image.naturalWidth, image.naturalHeight)
  context.translate(axis === 'horizontal' ? canvas.width : 0, axis === 'vertical' ? canvas.height : 0)
  context.scale(axis === 'horizontal' ? -1 : 1, axis === 'vertical' ? -1 : 1)
  context.drawImage(image, 0, 0)
  return canvas.toDataURL('image/png')
}

export async function cropImage(
  imageUrl: string,
  area: Area,
  rotationDegrees = 0,
): Promise<string> {
  const image = await loadImage(imageUrl)

  // Поворот делается на промежуточном холсте: вырезать повёрнутую область
  // напрямую нельзя — drawImage работает по осям исходника.
  let source: CanvasImageSource = image
  let sourceWidth = image.naturalWidth
  let sourceHeight = image.naturalHeight

  if (rotationDegrees % 360 !== 0) {
    const radians = (rotationDegrees * Math.PI) / 180
    const sin = Math.abs(Math.sin(radians))
    const cos = Math.abs(Math.cos(radians))
    const rotatedWidth = Math.round(image.naturalWidth * cos + image.naturalHeight * sin)
    const rotatedHeight = Math.round(image.naturalWidth * sin + image.naturalHeight * cos)
    const [rotatedCanvas, rotatedContext] = createCanvas(rotatedWidth, rotatedHeight)
    rotatedContext.translate(rotatedWidth / 2, rotatedHeight / 2)
    rotatedContext.rotate(radians)
    rotatedContext.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)
    source = rotatedCanvas
    sourceWidth = rotatedWidth
    sourceHeight = rotatedHeight
  }

  // Пропорции области сохраняются: горизонтальный логотип 4:1, втиснутый в
  // квадрат, превратился бы в растянутую кашу.
  const cropX = Math.max(0, Math.min(area.x, sourceWidth))
  const cropY = Math.max(0, Math.min(area.y, sourceHeight))
  const cropWidth = Math.max(1, Math.min(area.width, sourceWidth - cropX))
  const cropHeight = Math.max(1, Math.min(area.height, sourceHeight - cropY))

  const [canvas, context] = createCanvas(LOGO_SIZE, LOGO_SIZE)
  context.imageSmoothingQuality = 'high'
  /*
    Холст остаётся прозрачным.

    Раньше он заливался белым «на всякий случай для термопечати», и это было
    ошибкой: белый запекался в сам файл, и знак, обрезанный по кругу, приезжал
    в шапку белым квадратом — прозрачности за границей круга взяться было уже
    неоткуда. Печати белый фон и не нужен отсюда: renderThermalPreview заливает
    холст белым сам, перед переводом в один бит, и прозрачное там становится
    белым ровно тогда, когда это нужно, — на ленте.
  */

  const scale = Math.min(LOGO_SIZE / cropWidth, LOGO_SIZE / cropHeight)
  const drawWidth = cropWidth * scale
  const drawHeight = cropHeight * scale
  context.drawImage(
    source,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    (LOGO_SIZE - drawWidth) / 2,
    (LOGO_SIZE - drawHeight) / 2,
    drawWidth,
    drawHeight,
  )
  return canvas.toDataURL('image/png')
}

/* -------------------------------------------------------------------------- */
/* Форма знака и автообрезка полей                                            */
/* -------------------------------------------------------------------------- */

/**
 * Геометрия круглой маски: какой квадрат вырезать из картинки под круг.
 *
 * Круг всегда вписывается в квадрат по центру исходника. Без этого широкий
 * знак 4:1 превратился бы в овал: маска рисуется дугой по холсту, и если холст
 * не квадратный, дуга растягивается вместе с ним.
 *
 * Вынесено отдельно от рисования, чтобы проверяться тестом без canvas.
 */
export function circleMaskGeometry(
  width: number,
  height: number,
): { side: number; offsetX: number; offsetY: number; radius: number } {
  const side = Math.min(width, height) || LOGO_SIZE
  return {
    side,
    offsetX: (width - side) / 2,
    offsetY: (height - side) / 2,
    radius: side / 2,
  }
}

/**
 * Круглая маска: за границей круга остаётся прозрачность.
 *
 * Маска запекается в сам PNG, а не рисуется стилями поверх, и это важно для
 * чека: лента про CSS ничего не знает, а `destination-in` оставляет вне круга
 * настоящую прозрачность, которую печать заливает белым.
 */
export async function applyShapeMask(source: string, shape: LogoShape): Promise<string> {
  if (!source || shape !== 'circle') return source
  const image = await loadImage(source)
  const { side, offsetX, offsetY } = circleMaskGeometry(image.naturalWidth, image.naturalHeight)
  const [canvas, context] = createCanvas(side, side)
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, offsetX, offsetY, side, side, 0, 0, side, side)
  context.globalCompositeOperation = 'destination-in'
  context.beginPath()
  context.arc(side / 2, side / 2, side / 2, 0, Math.PI * 2)
  context.closePath()
  context.fill()
  context.globalCompositeOperation = 'source-over'
  return canvas.toDataURL('image/png')
}

/**
 * Делает почти белые точки прозрачными.
 *
 * Нужно логотипам, скачанным «на белом»: файл выглядит как знак на листе, и на
 * тёмной шапке из него получается белый прямоугольник. Прозрачность здесь
 * настоящая — пиксель уходит в альфу, а не закрашивается фоном интерфейса.
 *
 * Порог задаёт, что считать белым: 245 снимает чистый фон, 225 прощает
 * сероватый скан. У края знака яркость падает не мгновенно, поэтому точки
 * между порогом и чистым белым получают частичную прозрачность — иначе по
 * контуру осталась бы белая кайма из полупрозрачных пикселей.
 */
export async function removeWhiteBackground(source: string, threshold = 240): Promise<string> {
  if (!source) return source
  const image = await loadImage(source)
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (!width || !height) return source

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return source
  context.drawImage(image, 0, 0)

  const pixels = context.getImageData(0, 0, width, height)
  const { data } = pixels
  // Ниже этой яркости точка считается содержимым при любом пороге: смягчение
  // должно работать в узкой полосе у самого белого, а не съедать светло-серые
  // части знака.
  const soft = Math.max(0, threshold - 24)

  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] === 0) continue
    const luma = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
    if (luma >= threshold) {
      data[p + 3] = 0
      continue
    }
    if (luma > soft) {
      const ratio = (luma - soft) / (threshold - soft)
      data[p + 3] = Math.round(data[p + 3] * (1 - ratio))
    }
  }

  context.putImageData(pixels, 0, 0)
  return canvas.toDataURL('image/png')
}

/** Насколько цвет точки может отличаться от фона и всё ещё считаться фоном. */
const TRIM_TOLERANCE = 18

export type ContentBounds = { left: number; top: number; right: number; bottom: number }

/**
 * Границы содержимого на однотонном или прозрачном фоне.
 *
 * Сердце автообрезки, вынесенное отдельно от canvas: чистая функция над
 * массивом точек, которую можно проверить тестом без браузера.
 *
 * Фон определяется по четырём углам. Все прозрачны — режем по альфа-каналу;
 * иначе берём цвет угла и сравниваем с допуском: JPEG не даёт идеально ровной
 * заливки, и точное сравнение оставило бы поля на месте.
 *
 * `null` — содержимого нет: картинка однотонна целиком.
 */
export function contentBounds(
  data: Uint8ClampedArray | number[],
  width: number,
  height: number,
  tolerance = TRIM_TOLERANCE,
): ContentBounds | null {
  if (width <= 0 || height <= 0) return null

  const at = (x: number, y: number) => {
    const p = (y * width + x) * 4
    return { r: data[p], g: data[p + 1], b: data[p + 2], a: data[p + 3] }
  }
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)]
  const byAlpha = corners.every((corner) => corner.a < 24)
  const background = corners[0]

  const isBackground = (x: number, y: number) => {
    const pixel = at(x, y)
    if (byAlpha) return pixel.a < 24
    if (pixel.a < 24) return true
    return (
      Math.abs(pixel.r - background.r) <= tolerance &&
      Math.abs(pixel.g - background.g) <= tolerance &&
      Math.abs(pixel.b - background.b) <= tolerance
    )
  }

  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isBackground(x, y)) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  if (right < left || bottom < top) return null
  return { left, top, right, bottom }
}

/**
 * Обрезает однотонные или прозрачные поля по краям картинки.
 *
 * Общая механика для всего, что загружает магазин: у снимка QR это шапка
 * банковского приложения, у логотипа — белые поля вокруг знака, оставленные
 * дизайнером. Фон определяется по углам: если все четыре прозрачны — режем по
 * альфа-каналу, иначе по цвету угла с допуском (JPEG не даёт идеально ровной
 * заливки, и точное сравнение не сработало бы).
 *
 * Пустая строка — обрезать нечего: полей нет, картинка однотонна целиком или
 * поля занимают меньше двух процентов. Вызывающий в этом случае оставляет
 * исходник.
 */
export async function autoTrimImage(source: string, padRatio = 0.02): Promise<string> {
  if (!source) return ''
  const image = await loadImage(source)
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (!width || !height) return ''

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return ''
  context.drawImage(image, 0, 0)
  const { data } = context.getImageData(0, 0, width, height)

  const bounds = contentBounds(data, width, height)
  if (!bounds) return ''
  const { left, top, right, bottom } = bounds

  const pad = Math.round(Math.max(right - left, bottom - top) * padRatio)
  const cropLeft = Math.max(0, left - pad)
  const cropTop = Math.max(0, top - pad)
  const cropRight = Math.min(width, right + 1 + pad)
  const cropBottom = Math.min(height, bottom + 1 + pad)
  const cropWidth = cropRight - cropLeft
  const cropHeight = cropBottom - cropTop
  if (cropWidth < 8 || cropHeight < 8) return ''
  // Срезать нечего — только зря пережали бы картинку.
  if (cropWidth >= width * 0.98 && cropHeight >= height * 0.98) return ''

  const [out, outContext] = createCanvas(cropWidth, cropHeight)
  outContext.drawImage(canvas, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
  return out.toDataURL('image/png')
}

/**
 * Убирает прозрачные поля, оставленные квадратным холстом обрезки.
 *
 * `cropImage` всегда кладёт результат в квадрат LOGO_SIZE — знаку это ровно то,
 * что нужно, а широкой надписи нет: её содержимое занимает четверть высоты, а
 * остальное прозрачные поля. В шапке картинка вписывается по высоте, и такая
 * надпись вышла бы вчетверо мельче знака рядом.
 *
 * Отдельная функция, а не `autoTrimImage` по месту: та возвращает пустую
 * строку, когда резать нечего, и откат к исходнику пришлось бы писать у каждого
 * вызова.
 */
export async function tightenImage(image: string): Promise<string> {
  if (!image) return image
  const trimmed = await autoTrimImage(image, 0)
  return trimmed || image
}

/*
 * Композиции «знак + подпись» здесь больше нет.
 *
 * Она сводила знак и название в один PNG, а шапка приложения рядом печатала
 * название ещё раз — выходило два названия подряд. Теперь картинка несёт
 * только знак, а название рисует интерфейс текстом (см. storeDisplayName и
 * шаблоны LOGO_TEXT_TEMPLATES). На чек название тоже уходит настоящим текстом
 * принтера, а не растром: на 384 точках ширины растровая надпись рассыпается.
 */

/**
 * Потолок размера картинки — логотипа и снимка QR.
 *
 * Нужен не ради места на диске, а ради времени и памяти: разбор
 * стамегабайтного файла на кассовом моноблоке — это секунды замершего
 * интерфейса, а то и падение вкладки. Картинка логотипа столько не весит
 * никогда, поэтому такой файл — заведомо не то, что человек хотел выбрать.
 */
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024

/**
 * Годится ли файл в логотип или в картинку QR. Пустая строка — годится.
 *
 * Одна проверка на все три места загрузки (интерфейсный логотип, логотип чека,
 * картинка QR): раньше каждое проверяло по-своему, и сообщения расходились.
 * Проверка идёт до любой обработки — исключение из canvas объяснить человеку
 * нечем.
 */
export function imageFileProblem(file: File): string {
  if (!file.type.startsWith('image/')) {
    return 'Выберите файл изображения — PNG, JPG, WebP или SVG.'
  }
  if (file.size === 0) return 'Файл пустой — выберите другой.'
  if (file.size > MAX_IMAGE_BYTES) {
    return `Файл больше ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} МБ — это не картинка логотипа.`
  }
  return ''
}

/** Читает файл в data URL. Запасной путь, когда декодер картинок не сработал. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Не удалось прочитать файл изображения.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

/**
 * Сжатие большого файла вместо отказа.
 *
 * Владелец приносит логотип, снятый на телефон, и ошибка «файл больше 5 МБ»
 * для него означает «программа не работает». Ужимаем сами и молча.
 *
 * Декодируем через `createImageBitmap` прямо из файла, а не через FileReader и
 * data URL. Разница не в стиле: снимок на 12 мегапикселей в base64 — это ещё
 * и строка на десяток мегабайт в памяти вдобавок к самой картинке, и именно на
 * этом пути кассовый моноблок с 4 ГБ уходил в своп. Декодер отдаёт растр сразу,
 * а исходник закрывается явно.
 */
export async function shrinkOversizedImage(file: File, maxSide = 2048): Promise<string> {
  // SVG — вектор, ужимать нечего и незачем. Его же не берёт createImageBitmap.
  if (file.type === 'image/svg+xml') return readAsDataUrl(file)

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // Формат, который декодер не знает, — пробуем прежним путём: <img> берёт
    // кое-что сверх того, что умеет createImageBitmap.
    const dataUrl = await readAsDataUrl(file)
    const image = await loadImage(dataUrl)
    const longest = Math.max(image.naturalWidth, image.naturalHeight)
    if (longest <= maxSide) return dataUrl
    const scale = maxSide / longest
    const [canvas, context] = createCanvas(
      Math.round(image.naturalWidth * scale),
      Math.round(image.naturalHeight * scale),
    )
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.92)
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height)
    // Картинка и так небольшая — отдаём исходный файл как есть, не пережимая:
    // повторное кодирование PNG съело бы прозрачность и добавило артефактов.
    if (longest <= maxSide) return await readAsDataUrl(file)

    const scale = maxSide / longest
    const [canvas, context] = createCanvas(
      Math.round(bitmap.width * scale),
      Math.round(bitmap.height * scale),
    )
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.92)
  } finally {
    // Растр держит память до сборки мусора — закрываем сразу.
    bitmap.close()
  }
}

/** Монограмма из шаблона — когда своего логотипа нет. */
export function renderMonogram(letters: string, color: string, style: MonogramStyle): string {
  const [canvas, context] = createCanvas(LOGO_SIZE, LOGO_SIZE)
  const text = (letters || 'K').slice(0, 2).toUpperCase()

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, LOGO_SIZE, LOGO_SIZE)

  if (style === 'circle') {
    context.beginPath()
    context.arc(LOGO_SIZE / 2, LOGO_SIZE / 2, LOGO_SIZE / 2 - 4, 0, Math.PI * 2)
    context.fillStyle = color
    context.fill()
  } else if (style === 'outline') {
    roundedPath(context, LOGO_SIZE, LOGO_SIZE * 0.24)
    context.lineWidth = 22
    context.strokeStyle = color
    context.stroke()
  } else {
    roundedPath(context, LOGO_SIZE, LOGO_SIZE * 0.24)
    if (style === 'gradient') {
      const gradient = context.createLinearGradient(0, 0, LOGO_SIZE, LOGO_SIZE)
      gradient.addColorStop(0, color)
      gradient.addColorStop(1, shade(color, -0.28))
      context.fillStyle = gradient
    } else {
      context.fillStyle = color
    }
    context.fill()
  }

  context.fillStyle = style === 'outline' ? color : readableTextOn(color)
  context.font = `700 ${text.length > 1 ? 210 : 270}px Inter, -apple-system, "Segoe UI", sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, LOGO_SIZE / 2, LOGO_SIZE / 2 + LOGO_SIZE * 0.03)

  return canvas.toDataURL('image/png')
}

/**
 * Ширина печати на ленте 58 мм при 203 dpi. Чековый вариант логотипа
 * готовится ровно под неё — растягивать его при печати уже нечем.
 */
export const RECEIPT_LOGO_WIDTH = 384

/**
 * Ширина чекового логотипа под каждый рулон, в точках.
 *
 * Меньше ширины печати (576 точек на 80 мм и 384 на 58 мм) намеренно: знак во
 * всю ширину ленты упирается в край, а часть принтеров этот край срезает.
 * Оставшиеся поля и делают логотип похожим на напечатанный, а не на обрезанный.
 */
export const RECEIPT_LOGO_WIDTHS = {
  '80': 384,
  '58': 288,
} as const

/**
 * Оба чековых размера из одного знака.
 *
 * Готовятся заранее и сразу оба: рулон меняют прямо на точке, и пересчитывать
 * логотип в момент печати — значит задержать чек при живом покупателе.
 */
export async function buildReceiptLogoVariants(
  mark: string,
  options: { style?: ThermalStyle; threshold?: number } = {},
): Promise<{ w384: string; w288: string }> {
  if (!mark) return { w384: '', w288: '' }
  const [w384, w288] = await Promise.all([
    renderThermalPreview(mark, { ...options, width: RECEIPT_LOGO_WIDTHS['80'] }),
    renderThermalPreview(mark, { ...options, width: RECEIPT_LOGO_WIDTHS['58'] }),
  ])
  return { w384, w288 }
}

/**
 * Шаблоны обработки логотипа под термопечать.
 *
 * Термопринтер знает только «жечь» и «не жечь» — одна точка, один бит. Любой
 * логотип надо к этому свести, и одного способа на все случаи нет:
 *
 * - `standard` — обычный порог с рассеиванием ошибки. Годится большинству.
 * - `contrast` — порог поднят, растяжка контраста. Для светлых логотипов,
 *   которые при обычном пороге выходят пустым пятном.
 * - `dither` — рассеивание без растяжки, порог посередине. Для картинок с
 *   мелкими деталями и полутонами: детали остаются узором из точек.
 * - `outline` — только контур. Для цветных заливок: сплошное чёрное пятно на
 *   ленте нечитаемо и съедает ресурс головки, а контур узнаваем.
 */
export type ThermalStyle = 'standard' | 'contrast' | 'dither' | 'outline'

export const THERMAL_STYLES: {
  id: ThermalStyle
  label: string
  hint: string
  /** Порог по умолчанию для шаблона. Дальше правится ползунком. */
  threshold: number
}[] = [
  { id: 'standard', label: 'Стандарт', hint: 'Обычный порог. Подходит большинству логотипов', threshold: 176 },
  { id: 'contrast', label: 'Контрастный', hint: 'Для светлых логотипов, которые пропадают на ленте', threshold: 205 },
  { id: 'dither', label: 'Тонкие линии', hint: 'Дизеринг: сохраняет мелкие детали и полутона', threshold: 128 },
  { id: 'outline', label: 'Только контур', hint: 'Для цветных заливок — вместо пятна остаётся контур', threshold: 128 },
]

export function thermalStyleById(id: ThermalStyle) {
  return THERMAL_STYLES.find((item) => item.id === id) ?? THERMAL_STYLES[0]
}

/**
 * Растягивает реальный диапазон яркостей на весь 0…255.
 *
 * Нужно светлым логотипам: они занимают узкую полосу вроде 190…240, и порог по
 * ней либо съедает изображение целиком, либо не трогает вовсе. Плоскую
 * картинку (весь диапазон уже почти нулевой) не трогаем — растягивать шум
 * значит превратить чистый фон в грязь.
 */
function stretchContrast(gray: Float32Array): void {
  let min = 255
  let max = 0
  for (let i = 0; i < gray.length; i += 1) {
    if (gray[i] < min) min = gray[i]
    if (gray[i] > max) max = gray[i]
  }
  const span = max - min
  if (span < 8) return
  const factor = 255 / span
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = (gray[i] - min) * factor
  }
}

/**
 * Только контур — для логотипов со сплошными цветными заливками.
 *
 * Такая заливка при обычном пороге даёт чёрный прямоугольник: на ленте он
 * нечитаем, печатается медленно и зря греет головку. Контур узнаваем и стоит
 * принтеру считанных точек.
 *
 * Границы ищутся оператором Собеля по яркости — там, где яркость резко
 * меняется, и проходит край знака.
 */
async function renderThermalOutline(
  logoDataUrl: string,
  options: { threshold?: number; width?: number } = {},
): Promise<string> {
  const { threshold = 128, width } = options
  const image = await loadImage(logoDataUrl)

  const targetWidth = width ?? image.naturalWidth
  const scale = targetWidth / image.naturalWidth
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale))

  const [canvas, context] = createCanvas(targetWidth, targetHeight)
  context.imageSmoothingQuality = 'high'
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, targetWidth, targetHeight)
  context.drawImage(image, 0, 0, targetWidth, targetHeight)

  const pixels = context.getImageData(0, 0, targetWidth, targetHeight)
  const { data } = pixels

  const gray = new Float32Array(targetWidth * targetHeight)
  for (let i = 0; i < gray.length; i += 1) {
    const p = i * 4
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
  }

  const at = (x: number, y: number) => {
    const cx = Math.max(0, Math.min(targetWidth - 1, x))
    const cy = Math.max(0, Math.min(targetHeight - 1, y))
    return gray[cy * targetWidth + cx]
  }

  // Порог с ползунка задаёт чувствительность края: чем он выше, тем толще и
  // грубее контур. Масштаб подобран так, чтобы середина ползунка давала
  // читаемую линию на большинстве логотипов.
  const edgeCutoff = Math.max(12, (255 - threshold) * 0.9)

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const gx =
        -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) +
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)
      const edge = Math.sqrt(gx * gx + gy * gy)
      const value = edge > edgeCutoff ? 0 : 255
      const p = (y * targetWidth + x) * 4
      data[p] = value
      data[p + 1] = value
      data[p + 2] = value
      data[p + 3] = 255
    }
  }

  context.putImageData(pixels, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * Как логотип ляжет на термоленту: один бит на точку.
 *
 * Простой порог теряет всё, что светлее него, — фотографический или
 * градиентный логотип превращается в пятно. Поэтому по умолчанию рассеиваем
 * ошибку по Флойду — Стайнбергу: полутон становится узором из чёрных точек, и
 * на ленте остаётся узнаваемая картинка вместо белого прямоугольника.
 */
export async function renderThermalPreview(
  logoDataUrl: string,
  options: {
    threshold?: number
    width?: number
    dither?: boolean
    style?: ThermalStyle
  } = {},
): Promise<string> {
  const style = options.style ?? 'standard'
  if (style === 'outline') return renderThermalOutline(logoDataUrl, options)

  const {
    threshold = thermalStyleById(style).threshold,
    width,
    // «Тонкие линии» — это и есть дизеринг; контрастный, наоборот, режет
    // полутона намеренно, иначе светлый логотип снова расплывётся в узор.
    dither = style !== 'contrast',
  } = options
  const image = await loadImage(logoDataUrl)

  const targetWidth = width ?? image.naturalWidth
  const scale = targetWidth / image.naturalWidth
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale))

  const [canvas, context] = createCanvas(targetWidth, targetHeight)
  context.imageSmoothingQuality = 'high'
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, targetWidth, targetHeight)
  context.drawImage(image, 0, 0, targetWidth, targetHeight)

  const pixels = context.getImageData(0, 0, targetWidth, targetHeight)
  const { data } = pixels

  // Отдельный буфер яркости: ошибка рассеивается в него, а не в исходные
  // байты, иначе она обрезалась бы на границах 0…255 и узор поплыл.
  const gray = new Float32Array(targetWidth * targetHeight)
  for (let i = 0; i < gray.length; i += 1) {
    const p = i * 4
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
  }

  /* Контрастный шаблон: растягиваем реальный диапазон яркостей на весь 0…255.
     Светлый логотип занимает узкую полосу вроде 190…240, и любой порог по ней
     либо съедает всё, либо ничего. После растяжки порог снова осмыслен. */
  if (style === 'contrast') stretchContrast(gray)

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const index = y * targetWidth + x
      const old = gray[index]
      const next = old > threshold ? 255 : 0
      gray[index] = next

      if (dither) {
        const error = old - next
        // Классические веса Флойда — Стайнберга: 7/16 вправо, 3/16 влево-вниз,
        // 5/16 вниз, 1/16 вправо-вниз.
        if (x + 1 < targetWidth) gray[index + 1] += (error * 7) / 16
        if (y + 1 < targetHeight) {
          if (x > 0) gray[index + targetWidth - 1] += (error * 3) / 16
          gray[index + targetWidth] += (error * 5) / 16
          if (x + 1 < targetWidth) gray[index + targetWidth + 1] += error / 16
        }
      }

      const p = index * 4
      data[p] = next
      data[p + 1] = next
      data[p + 2] = next
      data[p + 3] = 255
    }
  }

  context.putImageData(pixels, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * Уменьшенная копия квадратного знака.
 *
 * Подложка не заливается: круглый логотип должен остаться круглым и на тёмной
 * шапке, а белый квадрат за ним и есть та самая «плашка вокруг круга». Фон под
 * знаком, когда он действительно нужен, подбирает шапка — см. logoTone.ts.
 */
async function resizeSquare(source: string, size: number): Promise<string> {
  const image = await loadImage(source)
  const [canvas, context] = createCanvas(size, size)
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, size, size)
  return canvas.toDataURL('image/png')
}

/**
 * Четыре размера из одного знака.
 *
 * Все — из знака и только из знака: название в картинку не запекается, его
 * рисует интерфейс текстом, а на ленту оно уходит настоящим текстом принтера.
 * Чековый вариант дополнительно приводится к одному биту на точку.
 */
export async function buildLogoVariants(
  mark: string,
): Promise<{ s512: string; s128: string; s64: string; receipt: string }> {
  if (!mark) return { s512: '', s128: '', s64: '', receipt: '' }
  const [s512, s128, s64, receipt] = await Promise.all([
    resizeSquare(mark, 512),
    resizeSquare(mark, 128),
    resizeSquare(mark, 64),
    renderThermalPreview(mark, { width: RECEIPT_LOGO_WIDTH }),
  ])
  return { s512, s128, s64, receipt }
}

/** Инициалы для монограммы из названия магазина или компании. */
export function initialsFrom(...candidates: string[]): string {
  const source = candidates.map((value) => value.trim()).find(Boolean) ?? 'K'
  const words = source.replace(/["«»]/g, '').split(/\s+/).filter(Boolean)
  const meaningful = words.filter((word) => !/^(ОсОО|ООО|ИП|ТОО|АО|Общество|с|ограниченной|ответственностью)$/i.test(word))
  const source2 = meaningful.length ? meaningful : words
  const letters = source2.length > 1 ? source2[0][0] + source2[1][0] : (source2[0] ?? source).slice(0, 2)
  return letters.toUpperCase()
}
