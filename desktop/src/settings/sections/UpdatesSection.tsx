import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { AppSettings } from '../appSettings'
import { SettingsHelpFooter } from '../SettingsHelpFooter'
import { useNotifications } from '../../components/notifications/NotificationProvider'
import {
  checkUpdates,
  downloadUpdate,
  getUpdaterInfo,
  installUpdate,
  subscribeUpdater,
} from '../../services/updater/updater.client'
import { UpdatesChangelogModal, type ChangelogEntry } from './UpdatesChangelogModal'
import './UpdatesSection.css'

type ContextType = {
  settings: AppSettings
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>
}

type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((p) => Number.parseInt(p, 10) || 0)
  const right = b.split('.').map((p) => Number.parseInt(p, 10) || 0)
  const count = Math.max(left.length, right.length)
  for (let i = 0; i < count; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function UpdatesSection() {
  const { settings, setSettings } = useOutletContext<ContextType>()
  const { push } = useNotifications()
  const [phase, setPhase] = useState<UpdatePhase>('idle')
  const [progress, setProgress] = useState(0)
  const [remoteVersion, setRemoteVersion] = useState<string | null>(null)
  const [changelog, setChangelog] = useState<ChangelogEntry | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [changelogModalOpen, setChangelogModalOpen] = useState(false)
  const [isPackaged, setIsPackaged] = useState(false)

  const currentVersion = settings.updates.currentVersion
  const hasUpdate =
    phase === 'available' || phase === 'downloading' || phase === 'downloaded'
  const canInstall = hasUpdate && phase !== 'downloading'

  const loadMeta = useCallback(async () => {
    const info = await getUpdaterInfo()
    if (info?.currentVersion) {
      setSettings((prev) => ({
        ...prev,
        updates: { ...prev.updates, currentVersion: info.currentVersion },
      }))
    }
    const meta = await window.nurcrm?.getMeta?.()
    if (meta?.isPackaged != null) setIsPackaged(!!meta.isPackaged)
  }, [setSettings])

  useEffect(() => {
    void loadMeta()
    const unsub = subscribeUpdater(
      (status) => {
        if (status.phase === 'checking') setPhase('checking')
        if (status.phase === 'available') {
          setPhase('available')
          setRemoteVersion(status.version ?? null)
        }
        if (status.phase === 'not-available') setPhase('not-available')
        if (status.phase === 'downloaded') setPhase('downloaded')
        if (status.phase === 'error') {
          setPhase('error')
          setErrorMsg(status.message ?? 'Ошибка')
        }
      },
      (p) => {
        if (p.percent >= 0) {
          setPhase('downloading')
          setProgress(p.percent)
        }
      },
    )
    return unsub
  }, [loadMeta])

  const handleCheck = async () => {
    setPhase('checking')
    setErrorMsg(null)
    try {
      const result = (await checkUpdates(settings.updates.updateUrl)) as {
        dev?: boolean
        updateInfo?: { version?: string }
      }

      if (result?.dev && !isPackaged) {
        setPhase('not-available')
        push({ kind: 'info', message: 'В режиме разработки — обновления через сборку dist' })
        return
      }

      const ver = result?.updateInfo?.version ?? null
      const availableVersion = ver && compareVersions(ver, currentVersion) > 0 ? ver : null
      setRemoteVersion(availableVersion)
      setSettings((prev) => ({
        ...prev,
        updates: {
          ...prev.updates,
          lastChecked: new Date().toISOString(),
          availableVersion,
        },
      }))

      if (availableVersion) {
        const cl = (await window.updaterAPI?.getChangelog(availableVersion)) as ChangelogEntry
        setChangelog(cl)
        setPhase('available')
        push({ kind: 'update', title: 'Обновление', message: `Доступна версия ${ver}` })
      } else {
        setPhase('not-available')
        push({ kind: 'success', message: 'Установлена последняя версия' })
      }
    } catch (e) {
      setPhase('error')
      setErrorMsg(e instanceof Error ? e.message : 'Ошибка проверки')
    }
  }

  const handleInstall = async () => {
    try {
      setChangelogModalOpen(false)
      setPhase('downloading')
      await downloadUpdate()
      setPhase('downloaded')
      push({ kind: 'update', message: 'Обновление загружено. Перезапуск…', dismissMs: 8000 })
      void installUpdate()
    } catch (e) {
      setPhase('error')
      setErrorMsg(e instanceof Error ? e.message : 'Ошибка загрузки')
    }
  }

  const handleUpdateNow = async () => {
    void handleCheck
    if (canInstall) {
      await handleInstall()
      return
    }

    setPhase('checking')
    setErrorMsg(null)
    try {
      const result = (await checkUpdates(settings.updates.updateUrl)) as {
        dev?: boolean
        updateInfo?: { version?: string }
      }
      if (result?.dev && !isPackaged) {
        setPhase('not-available')
        push({ kind: 'info', message: 'Dev mode: updates are checked only in installed build.' })
        return
      }
      const ver = result?.updateInfo?.version ?? null
      if (!ver || compareVersions(ver, currentVersion) <= 0) {
        setRemoteVersion(null)
        setPhase('not-available')
        push({ kind: 'success', message: 'Установлена последняя версия' })
        return
      }
      setRemoteVersion(ver)
      setSettings((prev) => ({
        ...prev,
        updates: {
          ...prev.updates,
          lastChecked: new Date().toISOString(),
          availableVersion: ver,
        },
      }))
      const cl = (await window.updaterAPI?.getChangelog(ver)) as ChangelogEntry
      setChangelog(cl)
      await handleInstall()
    } catch (e) {
      setPhase('error')
      setErrorMsg(e instanceof Error ? e.message : 'Update failed')
    }
  }

  const openWhatsNew = async () => {
    if (!changelog && remoteVersion) {
      const cl = (await window.updaterAPI?.getChangelog(remoteVersion)) as ChangelogEntry
      setChangelog(cl)
    }
    setChangelogModalOpen(true)
  }

  return (
    <section className="settings-section updates-section">
      <div className="upd-premium">
        <div className="upd-premium__head">
          <div>
            <p className="upd-premium__label">Текущая версия</p>
            <p className="upd-premium__version">v{currentVersion}</p>
          </div>
          {hasUpdate && remoteVersion && (
            <span className="upd-premium__badge">Доступна v{remoteVersion}</span>
          )}
        </div>

        {phase === 'downloading' && (
          <div className="upd-premium__progress">
            <div className="upd-premium__progress-fill" style={{ width: `${progress}%` }} />
            <span>{Math.round(progress)}%</span>
          </div>
        )}

        {errorMsg && <p className="upd-premium__error">{errorMsg}</p>}

        <div className="upd-premium__actions">
          <button
            type="button"
            className="upd-btn upd-btn--check upd-btn--check-lg"
            onClick={() => void handleUpdateNow()}
            disabled={phase === 'checking' || phase === 'downloading'}
          >
            {phase === 'checking' ? 'Проверка…' : phase === 'downloading' ? 'Загрузка…' : 'Обновить'}
          </button>

          <button
            type="button"
            className="upd-btn upd-btn--ghost"
            onClick={() => void openWhatsNew()}
            disabled={!changelog && !remoteVersion}
          >
            Что нового
          </button>

          {canInstall && (
            <button
              type="button"
              className="upd-btn upd-btn--install upd-btn--install-lg"
              onClick={() => void handleInstall()}
            >
              {phase === 'downloaded' ? 'Перезапустить' : 'Установить обновление'}
            </button>
          )}
        </div>

        {phase === 'not-available' && (
          <p className="upd-premium__hint">Система актуальна. Последняя проверка сохранена.</p>
        )}
      </div>

      <UpdatesChangelogModal
        open={changelogModalOpen}
        changelog={changelog}
        onClose={() => setChangelogModalOpen(false)}
        onInstall={() => void handleInstall()}
        installing={phase === 'downloading'}
        canInstall={canInstall}
      />

      <div className="upd-settings">
        <p className="upd-settings__label">Параметры</p>
        <label className="settings-field">
          <span className="settings-field__label">URL сервера обновлений</span>
          <input
            type="text"
            className="settings-field__input"
            value={settings.updates.updateUrl}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                updates: { ...prev.updates, updateUrl: e.target.value },
              }))
            }
          />
        </label>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.updates.autoCheck}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                updates: { ...prev.updates, autoCheck: e.target.checked },
              }))
            }
          />
          <span>Проверять обновления при запуске</span>
        </label>
      </div>

      <SettingsHelpFooter title="Обновления Manablock">
        <p>
          Установщик NSIS: один раз Setup.exe, дальше запуск только с ярлыка «NurCRM Manablock».
          Не запускайте Setup повторно — это переустановка.
        </p>
      </SettingsHelpFooter>
    </section>
  )
}
