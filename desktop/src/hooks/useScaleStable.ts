import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveScaleReading } from './useLiveScale'
import { loadSettings, SCALE_SPEED_PRESETS } from '../settings/appSettings'

const STABLE_EPS_KG = 0.008

function readHoldMs(): number {
  try {
    return SCALE_SPEED_PRESETS[loadSettings().scale.speedMode].stableHoldMs
  } catch {
    return SCALE_SPEED_PRESETS.fast.stableHoldMs
  }
}

export type ScaleStableState = {
  /** Показание для экрана (кг), null — показывать «—» */
  displayKg: number | null
  /** Вес не менялся достаточно долго — можно фиксировать */
  isStable: boolean
  /** Зафиксированное стабильное значение (кг) */
  stableKg: number | null
  /** Сброс после переноса веса в чек */
  resetStable: () => void
}

/**
 * Отслеживает, когда показания весов «устоялись» (для кнопки «Зафиксировать»).
 */
export function useScaleStable(live: LiveScaleReading): ScaleStableState {
  const [isStable, setIsStable] = useState(false)
  const [stableKg, setStableKg] = useState<number | null>(null)
  const tracker = useRef<{ kg: number; since: number } | null>(null)
  const holdMsRef = useRef(readHoldMs())

  useEffect(() => {
    const refresh = () => {
      holdMsRef.current = readHoldMs()
    }
    window.addEventListener('nurcrm-settings-changed', refresh)
    return () => window.removeEventListener('nurcrm-settings-changed', refresh)
  }, [])

  useEffect(() => {
    const kg = live.kg
    if (kg == null || !Number.isFinite(kg) || kg <= 0) {
      tracker.current = null
      setIsStable(false)
      setStableKg(null)
      return
    }

    const now = Date.now()
    const t = tracker.current

    if (t != null && Math.abs(t.kg - kg) <= STABLE_EPS_KG) {
      if (now - t.since >= holdMsRef.current) {
        setIsStable(true)
        setStableKg(Math.round(kg * 1000) / 1000)
      } else {
        setIsStable(false)
        setStableKg(null)
      }
      return
    }

    tracker.current = { kg, since: now }
    setIsStable(false)
    setStableKg(null)
  }, [live.kg])

  const displayKg =
    live.kg != null && Number.isFinite(live.kg) && live.kg > 0 ? live.kg : null

  const resetStable = useCallback(() => {
    tracker.current = null
    setIsStable(false)
    setStableKg(null)
  }, [])

  return { displayKg, isStable, stableKg, resetStable }
}
