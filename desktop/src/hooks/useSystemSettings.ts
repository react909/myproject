import { useEffect } from 'react'
import { loadSettings } from '../settings/appSettings'

export function useSystemSettings() {
  useEffect(() => {
    const apply = (settings = loadSettings()) => {
      void window.systemAPI?.setAutoLaunch?.(settings.system.startWithWindows)
      void window.systemAPI?.applyKiosk?.(settings.system.alwaysFullscreen)
    }

    apply()

    const onSettings = () => apply()
    window.addEventListener('nurcrm-settings-changed', onSettings)
    return () => {
      window.removeEventListener('nurcrm-settings-changed', onSettings)
    }
  }, [])
}
