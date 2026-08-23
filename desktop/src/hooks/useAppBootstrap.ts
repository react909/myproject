import { useEffect } from 'react'
import { loadSettings } from '../settings/appSettings'
import { checkUpdates, subscribeUpdater } from '../services/updater/updater.client'
import { useNotifications } from '../components/notifications/NotificationProvider'
import { applyDeviceSettings } from '../services/devices/device.client'

export function useAppBootstrap(_username: string) {
  const { push } = useNotifications()

  useEffect(() => {
    const settings = loadSettings()
    void applyDeviceSettings(settings)

    const onOnline = () => {
      /* Offline POS — сеть не обязательна */
    }
    const onOffline = () => {
      /* Offline POS — работаем без интернета */
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    if (!navigator.onLine) onOffline()

    const unsubUpdater = subscribeUpdater(
      (status) => {
        // Only show notifications for important events
        // Error notifications are suppressed during auto-check to avoid spam
        if (status.phase === 'available') {
          push({
            kind: 'update',
            title: 'Доступно обновление',
            message: `Вышла новая версия ${status.version ?? ''}. Откройте Настройки -> Обновления и нажмите «Обновить».`.trim(),
            dismissMs: 15000,
          })
        }
        if (status.phase === 'downloaded') {
          push({
            kind: 'update',
            title: 'Обновление загружено',
            message: `Перезапуск для установки ${status.version ?? ''}`.trim(),
            dismissMs: 12000,
          })
        }
        // Note: error notifications are suppressed here
        // They will only be shown on manual check in UpdatesSection
      },
      () => {
        /* progress shown on Updates page */
      },
    )

    void window.nurcrm?.markReady()

    if (settings.updates.autoCheck && settings.updates.updateUrl.trim()) {
      void checkUpdates(settings.updates.updateUrl)
    }

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      unsubUpdater()
    }
  }, [push])
}
