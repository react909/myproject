import { useEffect, useState } from 'react'

import { useWakeRecovery } from './useWakeRecovery'

/**
 * Ровная секундная метка для часов в шапке.
 *
 * Таймер пересобирается после каждого пробуждения: во сне `setInterval` не
 * идёт, и после возвращения часы показывали время засыпания, пока не отработает
 * следующий тик, — а при долгом сне ещё и с уехавшим выравниванием по секунде.
 * Кассир видел стоящие часы и решал, что приложение повисло.
 */
export function useClock() {
  const wakeCount = useWakeRecovery()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    setNow(new Date())
    const alignMs = 1000 - (Date.now() % 1000)
    let tick: ReturnType<typeof setInterval> | undefined
    const first = window.setTimeout(() => {
      setNow(new Date())
      tick = setInterval(() => setNow(new Date()), 1000)
    }, alignMs)
    return () => {
      clearTimeout(first)
      if (tick !== undefined) clearInterval(tick)
    }
  }, [wakeCount])

  return now
}
