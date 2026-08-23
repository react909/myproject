/**
 * Деньги на фронте: целые тыйыны внутрь, строка наружу.
 *
 * Сервер новых разделов отдаёт и принимает суммы ТОЛЬКО целыми тыйынами (см.
 * backend/app/core/money.py). Здесь их превращают в надпись и обратно — и
 * больше нигде: как только сумма где-то станет `number` в сомах, она начнёт
 * терять копейки на каждом сложении, и итог накладной перестанет сходиться с
 * суммой строк.
 *
 * Правило простое: в состоянии компонентов лежат тыйыны, `formatTiyin`
 * вызывается в момент отрисовки.
 */

/** Разделитель разрядов — узкий неразрывный пробел, как в остальной системе. */
const groups = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const whole = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

/** «12 345,60». Знак сохраняется: отрицательные суммы бывают у расхождения. */
export function formatTiyin(tiyin: number): string {
  return groups.format(tiyin / 100)
}

/** То же, но со знаком плюс у положительных — для расхождений и изменений. */
export function formatSigned(tiyin: number): string {
  const text = formatTiyin(Math.abs(tiyin))
  if (tiyin > 0) return `+${text}`
  if (tiyin < 0) return `−${text}`
  return text
}

/** Количество: три знака после запятой, но без хвоста нулей у штучного. */
export function formatQty(qty: number): string {
  if (Number.isInteger(qty)) return whole.format(qty)
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(qty)
}

/**
 * Разбор того, что человек ввёл в поле суммы, в целые тыйыны.
 *
 * Принимает и запятую, и точку: на цифровой клавиатуре моноблока запятая, а с
 * внешней клавиатуры чаще точка, и заставлять помнить разницу незачем.
 * Пробелы (в том числе неразрывные, которые приезжают из скопированной
 * надписи) выкидываются.
 *
 * Округление — до тыйына, «половину вверх»: 12.345 → 1235 тыйынов. Дробная
 * часть длиннее двух знаков обрезается, а не отвергается: в поле цены её
 * набирают по ошибке, и отказ на третьем знаке выглядит как «поле сломалось».
 */
export function parseTiyin(raw: string): number {
  const cleaned = raw.replace(/[\s  ]/g, '').replace(',', '.')
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100)
}

/** Что показать в поле ввода для суммы в тыйынах: «1234.50» без разрядов. */
export function tiyinToInput(tiyin: number): string {
  return (tiyin / 100).toFixed(2)
}

/** Разбор количества. Отрицательное не пропускаем: минус-приход это возврат. */
export function parseQty(raw: string): number {
  const cleaned = raw.replace(/[\s  ]/g, '').replace(',', '.')
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.round(value * 1000) / 1000
}

/**
 * Наценка в процентах от закупочной цены.
 *
 * Дубль серверной формулы (`markup_percent`), и это осознанно: в таблице ввода
 * наценка и цена связаны в обе стороны и пересчитываются на каждое нажатие
 * клавиши. Ходить за этим на сервер значит показывать человеку цифру, которая
 * догоняет его ввод с задержкой.
 *
 * Обе формулы обратимы и проверены тестом (utils/money.test.ts): ввёл
 * наценку — получил цену, из цены получил ту же наценку.
 */
export function markupPercent(costTiyin: number, retailTiyin: number): number {
  if (costTiyin <= 0) return 0
  return Math.round(((retailTiyin - costTiyin) * 10000) / costTiyin) / 100
}

/** Розничная цена по закупочной и наценке, в тыйынах. */
export function retailFromMarkup(costTiyin: number, percent: number): number {
  if (costTiyin <= 0) return 0
  return Math.round(costTiyin * (1 + percent / 100))
}

/** Сумма строки: цена за единицу × количество, целыми тыйынами. */
export function lineTotal(unitTiyin: number, qty: number): number {
  return Math.round(unitTiyin * qty)
}
