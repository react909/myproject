/**
 * Генератор QR-кодов.
 *
 * Своя реализация нужна по двум причинам, и обе принципиальные. Первая —
 * касса офлайновая: внешний сервис вроде api.qrserver.com не ответит там, где
 * приложение и должно работать. Вторая важнее: платёжный payload содержит
 * сумму, счёт мерчанта и номер заказа, и отправлять его на чужой сервер ради
 * картинки нельзя.
 *
 * Режим — байтовый (payload платёжных систем содержит и латиницу, и цифры, и
 * служебные разделители), уровень коррекции M: он держит частично засвеченный
 * или залапанный экран и при этом не раздувает матрицу.
 *
 * Реализация покрывает версии 1–15 (до 412 байт), чего с запасом хватает на
 * payload любой платёжной системы — EMVCo QR обычно укладывается в 300 байт.
 */

/** Уровень коррекции ошибок. Пока нужен только M — остальные не заводим. */
const EC_LEVEL_M_BITS = 0b00

/**
 * Разбивка на блоки для уровня M: [байт коррекции на блок, блоков в группе 1,
 * данных в блоке группы 1, блоков в группе 2, данных в блоке группы 2].
 * Индекс — версия минус один.
 */
const EC_TABLE_M: readonly (readonly [number, number, number, number, number])[] = [
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
  [30, 1, 50, 4, 51],
  [22, 6, 36, 2, 37],
  [22, 8, 37, 1, 38],
  [24, 4, 40, 5, 41],
  [24, 5, 41, 5, 42],
]

/** Центры выравнивающих узоров по версиям. Версия 1 их не имеет. */
const ALIGNMENT_CENTERS: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
]

/* -------------------------------------------------------------------------- */
/* Арифметика поля Галуа GF(256)                                              */
/* -------------------------------------------------------------------------- */

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)

;(() => {
  let x = 1
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    // Порождающий многочлен QR: x^8 + x^4 + x^3 + x^2 + 1.
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255]
})()

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

/** Порождающий многочлен кода Рида — Соломона на `degree` байт коррекции. */
function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1])
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1)
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i])
    }
    poly = next
  }
  return poly
}

function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
  const generator = rsGenerator(ecCount)
  const remainder = new Uint8Array(ecCount)
  for (const byte of data) {
    const factor = byte ^ remainder[0]
    remainder.copyWithin(0, 1)
    remainder[ecCount - 1] = 0
    if (factor !== 0) {
      for (let i = 0; i < ecCount; i += 1) {
        remainder[i] ^= gfMul(generator[i + 1], factor)
      }
    }
  }
  return remainder
}

/* -------------------------------------------------------------------------- */
/* Поток бит                                                                  */
/* -------------------------------------------------------------------------- */

class BitBuffer {
  private bits: number[] = []

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) {
      this.bits.push((value >>> i) & 1)
    }
  }

  get length(): number {
    return this.bits.length
  }

  toBytes(): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(this.bits.length / 8))
    this.bits.forEach((bit, index) => {
      if (bit) bytes[index >>> 3] |= 0x80 >>> index % 8
    })
    return bytes
  }
}

/* -------------------------------------------------------------------------- */
/* Сборка кодовых слов                                                        */
/* -------------------------------------------------------------------------- */

function characterCountBits(version: number): number {
  return version < 10 ? 8 : 16
}

function dataCapacityBytes(version: number): number {
  const [, blocks1, data1, blocks2, data2] = EC_TABLE_M[version - 1]
  const totalData = blocks1 * data1 + blocks2 * data2
  const headerBits = 4 + characterCountBits(version)
  return totalData - Math.ceil(headerBits / 8)
}

function pickVersion(byteLength: number): number {
  for (let version = 1; version <= EC_TABLE_M.length; version += 1) {
    if (byteLength <= dataCapacityBytes(version)) return version
  }
  throw new Error(
    `QR: payload ${byteLength} байт не помещается — предел ${dataCapacityBytes(EC_TABLE_M.length)} байт.`,
  )
}

/** Данные и коррекция, разложенные в порядке, которого требует стандарт. */
function buildCodewords(payload: Uint8Array, version: number): Uint8Array {
  const [ecPerBlock, blocks1, data1, blocks2, data2] = EC_TABLE_M[version - 1]
  const totalData = blocks1 * data1 + blocks2 * data2

  const buffer = new BitBuffer()
  buffer.push(0b0100, 4) // байтовый режим
  buffer.push(payload.length, characterCountBits(version))
  for (const byte of payload) buffer.push(byte, 8)
  // Терминатор — до четырёх нулей, но не за границу ёмкости.
  buffer.push(0, Math.min(4, totalData * 8 - buffer.length))

  const raw = buffer.toBytes()
  const data = new Uint8Array(totalData)
  data.set(raw.subarray(0, Math.min(raw.length, totalData)))
  // Добивка чередующимися 0xEC / 0x11 — так предписывает стандарт.
  for (let i = raw.length; i < totalData; i += 1) {
    data[i] = i % 2 === raw.length % 2 ? 0xec : 0x11
  }

  const dataBlocks: Uint8Array[] = []
  const ecBlocks: Uint8Array[] = []
  let offset = 0
  for (const [count, size] of [
    [blocks1, data1],
    [blocks2, data2],
  ]) {
    for (let i = 0; i < count; i += 1) {
      const block = data.subarray(offset, offset + size)
      offset += size
      dataBlocks.push(block)
      ecBlocks.push(rsEncode(block, ecPerBlock))
    }
  }

  // Чередование: сначала по одному байту данных из каждого блока, потом так же
  // байты коррекции. Блоки разной длины — короткие просто заканчиваются раньше.
  const result: number[] = []
  const maxData = Math.max(data1, data2)
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i])
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) result.push(block[i])
  }
  return new Uint8Array(result)
}

/* -------------------------------------------------------------------------- */
/* Матрица                                                                    */
/* -------------------------------------------------------------------------- */

type Matrix = {
  size: number
  modules: Uint8Array
  /** Служебные модули — их нельзя ни занимать данными, ни маскировать. */
  reserved: Uint8Array
}

function createMatrix(size: number): Matrix {
  return { size, modules: new Uint8Array(size * size), reserved: new Uint8Array(size * size) }
}

function setModule(matrix: Matrix, x: number, y: number, dark: boolean, reserve = true): void {
  const index = y * matrix.size + x
  matrix.modules[index] = dark ? 1 : 0
  if (reserve) matrix.reserved[index] = 1
}

function isDark(matrix: Matrix, x: number, y: number): boolean {
  return matrix.modules[y * matrix.size + x] === 1
}

function placeFinder(matrix: Matrix, x0: number, y0: number): void {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const x = x0 + dx
      const y = y0 + dy
      if (x < 0 || y < 0 || x >= matrix.size || y >= matrix.size) continue
      const inRing = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6
      const border = inRing && (dx === 0 || dx === 6 || dy === 0 || dy === 6)
      const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4
      setModule(matrix, x, y, border || core)
    }
  }
}

function placeAlignment(matrix: Matrix, version: number): void {
  const centers = ALIGNMENT_CENTERS[version - 1]
  for (const cy of centers) {
    for (const cx of centers) {
      // Углы, занятые поисковыми узорами, пропускаем.
      const nearFinder =
        (cx <= 8 && cy <= 8) ||
        (cx <= 8 && cy >= matrix.size - 9) ||
        (cx >= matrix.size - 9 && cy <= 8)
      if (nearFinder) continue
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const ring = Math.max(Math.abs(dx), Math.abs(dy))
          setModule(matrix, cx + dx, cy + dy, ring !== 1)
        }
      }
    }
  }
}

function placeTiming(matrix: Matrix): void {
  for (let i = 8; i < matrix.size - 8; i += 1) {
    const dark = i % 2 === 0
    setModule(matrix, i, 6, dark)
    setModule(matrix, 6, i, dark)
  }
}

/** Резервирует места под информацию о формате и версии. */
function reserveInfoAreas(matrix: Matrix, version: number): void {
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) setModule(matrix, i, 8, false)
    if (i !== 6) setModule(matrix, 8, i, false)
  }
  for (let i = 0; i < 8; i += 1) {
    setModule(matrix, matrix.size - 1 - i, 8, false)
    setModule(matrix, 8, matrix.size - 1 - i, false)
  }
  // Тёмный модуль — всегда единица, он не часть формата.
  setModule(matrix, 8, matrix.size - 8, true)

  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = Math.floor(i / 3)
      const b = (i % 3) + matrix.size - 11
      setModule(matrix, a, b, false)
      setModule(matrix, b, a, false)
    }
  }
}

/** Раскладка кодовых слов змейкой снизу вверх, по две колонки. */
function placeData(matrix: Matrix, codewords: Uint8Array): void {
  let bitIndex = 0
  let upward = true
  for (let right = matrix.size - 1; right >= 1; right -= 2) {
    // Шестая колонка занята синхрополосой и в змейке не участвует.
    if (right === 6) right = 5
    for (let step = 0; step < matrix.size; step += 1) {
      const y = upward ? matrix.size - 1 - step : step
      for (const x of [right, right - 1]) {
        const index = y * matrix.size + x
        if (matrix.reserved[index]) continue
        const byte = codewords[bitIndex >>> 3]
        const bit = byte === undefined ? 0 : (byte >>> (7 - (bitIndex % 8))) & 1
        matrix.modules[index] = bit
        bitIndex += 1
      }
    }
    upward = !upward
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

function applyMask(matrix: Matrix, maskId: number): Matrix {
  const masked: Matrix = {
    size: matrix.size,
    modules: Uint8Array.from(matrix.modules),
    reserved: matrix.reserved,
  }
  const rule = MASKS[maskId]
  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      const index = y * matrix.size + x
      if (matrix.reserved[index]) continue
      if (rule(x, y)) masked.modules[index] ^= 1
    }
  }
  return masked
}

/** Штраф маски по четырём правилам стандарта: чем меньше, тем читаемее код. */
function maskPenalty(matrix: Matrix): number {
  const { size } = matrix
  let penalty = 0

  // Правило 1: серии одноцветных модулей длиной от пяти.
  for (let i = 0; i < size; i += 1) {
    for (const horizontal of [true, false]) {
      let run = 1
      for (let j = 1; j < size; j += 1) {
        const prev = horizontal ? isDark(matrix, j - 1, i) : isDark(matrix, i, j - 1)
        const curr = horizontal ? isDark(matrix, j, i) : isDark(matrix, i, j)
        if (prev === curr) {
          run += 1
        } else {
          if (run >= 5) penalty += run - 2
          run = 1
        }
      }
      if (run >= 5) penalty += run - 2
    }
  }

  // Правило 2: одноцветные квадраты 2×2.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const first = isDark(matrix, x, y)
      if (
        first === isDark(matrix, x + 1, y) &&
        first === isDark(matrix, x, y + 1) &&
        first === isDark(matrix, x + 1, y + 1)
      ) {
        penalty += 3
      }
    }
  }

  // Правило 3: узор 1:1:3:1:1 со светлой зоной — его можно спутать с поисковым.
  const pattern = [true, false, true, true, true, false, true]
  const quiet = [false, false, false, false]
  const matches = (cells: boolean[], start: number, expected: boolean[]) =>
    expected.every((value, offset) => cells[start + offset] === value)

  for (let i = 0; i < size; i += 1) {
    const row: boolean[] = []
    const column: boolean[] = []
    for (let j = 0; j < size; j += 1) {
      row.push(isDark(matrix, j, i))
      column.push(isDark(matrix, i, j))
    }
    for (const cells of [row, column]) {
      for (let start = 0; start + 7 <= size; start += 1) {
        if (!matches(cells, start, pattern)) continue
        const before = start >= 4 && matches(cells, start - 4, quiet)
        const after = start + 11 <= size && matches(cells, start + 7, quiet)
        if (before || after) penalty += 40
      }
    }
  }

  // Правило 4: перекос доли тёмных модулей от половины.
  let dark = 0
  for (let i = 0; i < matrix.modules.length; i += 1) dark += matrix.modules[i]
  const ratio = (dark * 100) / (size * size)
  penalty += Math.floor(Math.abs(ratio - 50) / 5) * 10

  return penalty
}

/** BCH-код информации о формате: уровень коррекции плюс номер маски. */
function formatBits(maskId: number): number {
  const data = (EC_LEVEL_M_BITS << 3) | maskId
  let value = data << 10
  for (let i = 14; i >= 10; i -= 1) {
    if ((value >>> i) & 1) value ^= 0b10100110111 << (i - 10)
  }
  return ((data << 10) | value) ^ 0b101010000010010
}

function versionBits(version: number): number {
  let value = version << 12
  for (let i = 17; i >= 12; i -= 1) {
    if ((value >>> i) & 1) value ^= 0b1111100100101 << (i - 12)
  }
  return (version << 12) | value
}

function writeFormatAndVersion(matrix: Matrix, version: number, maskId: number): void {
  const format = formatBits(maskId)
  for (let i = 0; i < 15; i += 1) {
    const bit = ((format >>> i) & 1) === 1
    // Первая копия — вокруг левого верхнего поискового узора.
    if (i < 6) setModule(matrix, 8, i, bit)
    else if (i < 8) setModule(matrix, 8, i + 1, bit)
    else if (i === 8) setModule(matrix, 7, 8, bit)
    else setModule(matrix, 14 - i, 8, bit)
    // Вторая копия — резервная, у правого верхнего и левого нижнего узоров.
    if (i < 8) setModule(matrix, matrix.size - 1 - i, 8, bit)
    else setModule(matrix, 8, matrix.size - 15 + i, bit)
  }

  if (version < 7) return
  const info = versionBits(version)
  for (let i = 0; i < 18; i += 1) {
    const bit = ((info >>> i) & 1) === 1
    const a = Math.floor(i / 3)
    const b = (i % 3) + matrix.size - 11
    setModule(matrix, a, b, bit)
    setModule(matrix, b, a, bit)
  }
}

/* -------------------------------------------------------------------------- */
/* Публичный интерфейс                                                        */
/* -------------------------------------------------------------------------- */

export type QrMatrix = {
  size: number
  /** `true` — тёмный модуль. Строка за строкой, сверху вниз. */
  cells: boolean[]
}

/** Строит матрицу QR по строке payload. Бросает, если payload слишком длинный. */
export function encodeQr(text: string): QrMatrix {
  const payload = new TextEncoder().encode(text)
  const version = pickVersion(payload.length)
  const codewords = buildCodewords(payload, version)

  const base = createMatrix(version * 4 + 17)
  placeFinder(base, 0, 0)
  placeFinder(base, base.size - 7, 0)
  placeFinder(base, 0, base.size - 7)
  placeAlignment(base, version)
  placeTiming(base)
  reserveInfoAreas(base, version)
  placeData(base, codewords)

  let best: Matrix | null = null
  let bestPenalty = Number.POSITIVE_INFINITY
  for (let maskId = 0; maskId < MASKS.length; maskId += 1) {
    const candidate = applyMask(base, maskId)
    writeFormatAndVersion(candidate, version, maskId)
    const penalty = maskPenalty(candidate)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      best = candidate
    }
  }

  const chosen = best!
  return {
    size: chosen.size,
    cells: Array.from(chosen.modules, (value) => value === 1),
  }
}

/**
 * QR как SVG. Именно SVG, а не canvas: он одинаково чёткий на экране клиента
 * любого размера, а на термопечать всё равно уходит растеризованным.
 */
export function qrToSvg(text: string, options: { quietZone?: number } = {}): string {
  const quiet = options.quietZone ?? 4
  const { size, cells } = encodeQr(text)
  const total = size + quiet * 2

  // Один путь на весь код: тысяча отдельных <rect> заметно тормозит отрисовку
  // на слабом процессоре моноблока.
  const parts: string[] = []
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (cells[y * size + x]) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`)
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR-код для оплаты">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/>` +
    `<path d="${parts.join('')}" fill="#000000"/>` +
    `</svg>`
  )
}

/** QR как data URL — для <img> и для передачи в модуль печати. */
export function qrToDataUrl(text: string, options: { quietZone?: number } = {}): string {
  const svg = qrToSvg(text, options)
  return `data:image/svg+xml;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(svg)))}`
}
