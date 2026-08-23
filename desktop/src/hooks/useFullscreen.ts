import { useCallback, useEffect, useState } from 'react'

export function useFullscreen() {
  const [active, setActive] = useState(false)
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined

  const syncAll = useCallback(async () => {
    const a = window.electronAPI
    let native = false
    if (a?.getFullscreen) {
      try {
        native = !!(await a.getFullscreen())
      } catch {
        native = false
      }
    }
    const dom = !!document.fullscreenElement
    setActive(native || dom)
  }, [])

  useEffect(() => {
    const a = window.electronAPI
    if (a?.getFullscreen && a?.onFullscreenChange) {
      void syncAll()
      return a.onFullscreenChange(() => {
        void syncAll()
      })
    }
    const sync = () => setActive(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    sync()
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [syncAll])

  const enter = useCallback(async () => {
    if (api?.setFullscreen) {
      await api.setFullscreen(true)
      void syncAll()
      return
    }
    try {
      await document.documentElement.requestFullscreen()
    } catch {
      /* browser may deny */
    }
  }, [api?.setFullscreen, syncAll])

  const exit = useCallback(async () => {
    if (api?.setFullscreen) {
      await api.setFullscreen(false)
      void syncAll()
      return
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
    } catch {
      /* ignore */
    }
  }, [api?.setFullscreen, syncAll])

  const toggle = useCallback(async () => {
    if (api?.toggleFullscreen) {
      try {
        await api.toggleFullscreen()
      } catch {
        /* ignore */
      }
      requestAnimationFrame(() => {
        void syncAll()
        window.setTimeout(() => void syncAll(), 0)
        window.setTimeout(() => void syncAll(), 80)
      })
      return
    }
    if (document.fullscreenElement) await exit()
    else await enter()
  }, [api?.toggleFullscreen, enter, exit, syncAll])

  return { isFullscreen: active, enter, exit, toggle }
}
