/**
 * Справочники онбординга.
 *
 * Вынесены из мастера отдельно, потому что теми же списками пользуются
 * настройки и модуль печати (символ валюты идёт в каждую сумму чека).
 */

export type CurrencyDef = { code: string; label: string; symbol: string }

export const CURRENCIES: CurrencyDef[] = [
  { code: 'KGS', label: 'Кыргызский сом', symbol: 'сом' },
  { code: 'KZT', label: 'Казахстанский тенге', symbol: '₸' },
  { code: 'UZS', label: 'Узбекский сум', symbol: 'сўм' },
  { code: 'RUB', label: 'Российский рубль', symbol: '₽' },
  { code: 'USD', label: 'Доллар США', symbol: '$' },
]

export const COUNTRIES: string[] = [
  'Кыргызстан',
  'Казахстан',
  'Узбекистан',
  'Таджикистан',
  'Россия',
]

export type TimezoneDef = { value: string; label: string }

export const TIMEZONES: TimezoneDef[] = [
  { value: 'Asia/Bishkek', label: 'Бишкек · UTC+6' },
  { value: 'Asia/Almaty', label: 'Алматы · UTC+5' },
  { value: 'Asia/Tashkent', label: 'Ташкент · UTC+5' },
  { value: 'Asia/Dushanbe', label: 'Душанбе · UTC+5' },
  { value: 'Europe/Moscow', label: 'Москва · UTC+3' },
  { value: 'UTC', label: 'UTC · UTC+0' },
]

export function currencyByCode(code: string): CurrencyDef {
  return CURRENCIES.find((item) => item.code === code) ?? CURRENCIES[0]
}

/**
 * Куда смотрит карта, пока координаты не определены. Столица выбранной страны
 * — не «правильная» точка, а рабочая: с неё метку дотащить до своего города
 * быстрее, чем с нулевого меридиана посреди Атлантики.
 */
export const COUNTRY_MAP_CENTER: Record<string, { lat: number; lon: number }> = {
  Кыргызстан: { lat: 42.8746, lon: 74.5698 },
  Казахстан: { lat: 51.1605, lon: 71.4704 },
  Узбекистан: { lat: 41.2995, lon: 69.2401 },
  Таджикистан: { lat: 38.5598, lon: 68.787 },
  Россия: { lat: 55.7558, lon: 37.6173 },
}

export function mapCenterForCountry(country: string): { lat: number; lon: number } {
  return COUNTRY_MAP_CENTER[country] ?? COUNTRY_MAP_CENTER['Кыргызстан']
}
