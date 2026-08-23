import type { LiveScaleReading } from '../../hooks/useLiveScale'

function toReading(r: {
  kg?: number | null
  connected?: boolean
  stable?: boolean
  error?: string | null
} | null | undefined): LiveScaleReading {
  if (!r) {
    return { kg: null, connected: false, stable: false, lastError: null }
  }
  return {
    kg: typeof r.kg === 'number' && Number.isFinite(r.kg) ? r.kg : null,
    connected: !!r.connected,
    stable: !!r.stable,
    lastError: r.error ?? null,
  }
}

/** Мгновенный снимок с весов: пульс опроса + последнее значение из main. */
export async function requestScaleSnapshot(): Promise<LiveScaleReading> {
  const api = window.devicesAPI
  if (!api?.getLiveWeight) {
    return { kg: null, connected: false, stable: false, lastError: null }
  }
  try {
    if (api.requestScaleRead) {
      return toReading(await api.requestScaleRead())
    }
    return toReading(await api.getLiveWeight())
  } catch {
    return { kg: null, connected: false, stable: false, lastError: 'Ошибка чтения весов' }
  }
}

export function pickScaleKg(
  live: LiveScaleReading,
  presetKg?: number | null,
): number | null {
  if (live.kg != null && live.kg > 0) return live.kg
  if (presetKg != null && presetKg > 0) return presetKg
  return null
}

export function formatScaleKgInput(kg: number | null | undefined): string {
  return kg != null && kg > 0 ? kg.toFixed(3) : ''
}
