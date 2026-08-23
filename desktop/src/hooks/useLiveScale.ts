import { useEffect, useRef, useState } from 'react'
import { loadSettings, type ScaleSpeedMode } from '../settings/appSettings'
import { applyDeviceSettings } from '../services/devices/device.client'

export type LiveScaleReading = {
  kg: number | null
  connected: boolean
  stable: boolean
  lastError: string | null
}

const EMPTY: LiveScaleReading = {
  kg: null,
  connected: false,
  stable: false,
  lastError: null,
}

function pollMsForMode(mode: ScaleSpeedMode): number {
  if (mode === 'turbo') return 70
  if (mode === 'normal') return 160
  return 100
}

function toReading(r: {
  kg?: number | null
  connected?: boolean
  stable?: boolean
  error?: string | null
} | null | undefined): LiveScaleReading {
  if (!r) return EMPTY
  return {
    kg: typeof r.kg === 'number' && Number.isFinite(r.kg) ? r.kg : null,
    connected: !!r.connected,
    stable: !!r.stable,
    lastError: r.error ?? null,
  }
}

/**
 * Живой вес: push из main + частый poll (страховка), без лишних setState.
 */
export function useLiveScale(pollMs?: number): LiveScaleReading {
  const [reading, setReading] = useState<LiveScaleReading>(EMPTY)
  const [settingsRev, setSettingsRev] = useState(0)
  const readingRef = useRef(reading)
  const lastPushAtRef = useRef(0)

  useEffect(() => {
    readingRef.current = reading
  }, [reading])

  useEffect(() => {
    const bump = () => setSettingsRev((n) => n + 1)
    window.addEventListener('nurcrm-settings-changed', bump)
    return () => window.removeEventListener('nurcrm-settings-changed', bump)
  }, [])

  useEffect(() => {
    const settings = loadSettings()
    if (!settings.scale.enabled) {
      setReading(EMPTY)
      return undefined
    }

    void applyDeviceSettings(settings)

    const intervalMs = pollMs ?? pollMsForMode(settings.scale.speedMode)
    let cancelled = false

    const applyPayload = (r: Parameters<typeof toReading>[0]) => {
      if (cancelled) return
      const next = toReading(r)
      const prev = readingRef.current
      if (
        prev.kg === next.kg
        && prev.connected === next.connected
        && prev.stable === next.stable
        && prev.lastError === next.lastError
      ) {
        return
      }
      readingRef.current = next
      setReading(next)
    }

    const pull = async (pulse = false) => {
      try {
        const api = window.devicesAPI
        if (!api?.getLiveWeight) return
        const r = pulse && api.requestScaleRead
          ? await api.requestScaleRead()
          : await api.getLiveWeight()
        applyPayload(r)
      } catch {
        if (!cancelled) setReading({ ...EMPTY, lastError: 'Ошибка чтения весов' })
      }
    }

    void pull(true)
    void pull(false)

    const unsubPush = window.devicesAPI?.onScaleWeight?.((payload) => {
      lastPushAtRef.current = Date.now()
      applyPayload(payload)
    })

    const id = window.setInterval(() => {
      if (Date.now() - lastPushAtRef.current < intervalMs) return
      void pull(false)
    }, intervalMs)

    return () => {
      cancelled = true
      unsubPush?.()
      window.clearInterval(id)
    }
  }, [pollMs, settingsRev])

  return reading
}
