import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { AppSettings } from '../appSettings'
import { SettingsHelpFooter } from '../SettingsHelpFooter'
import { useNotifications } from '../../components/notifications/NotificationProvider'
import {
  getDeviceStatus,
  runDeviceDiagnostics,
  testPrinter,
  testScale,
  listSerialPorts,
  reconnectDevices,
} from '../../services/devices/device.client'
import { apiGet } from '../../api/client'
import type { DeviceStatusSnapshot } from '../../types/electron'
import { BackupsPanel } from './BackupsPanel'
import './DiagnosticsSection.css'

type ContextType = {
  settings: AppSettings
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>
}

type BackendInfo = {
  app_name: string
  app_version: string
  sqlite_path: string
  sqlite_size_bytes: number
  users_count: number
  products_count: number
  sales_count: number
  db_ok: boolean
}

export function DiagnosticsSection() {
  const { settings, setSettings } = useOutletContext<ContextType>()
  const { push } = useNotifications()
  const [status, setStatus] = useState<DeviceStatusSnapshot | null>(null)
  const [printerTest, setPrinterTest] = useState<string | null>(null)
  const [scaleTest, setScaleTest] = useState<string | null>(null)
  const [ports, setPorts] = useState<Array<{ path: string }>>([])
  const [running, setRunning] = useState(false)
  const [backend, setBackend] = useState<BackendInfo | null>(null)
  const [logs, setLogs] = useState<string>('')
  const [archiving, setArchiving] = useState(false)

  const refresh = useCallback(async () => {
    const s = await getDeviceStatus()
    if (s) setStatus(s)
    const p = await listSerialPorts()
    setPorts(p ?? [])
    try {
      const res = await apiGet('/api/diagnostics/info')
      setBackend(res.data as BackendInfo)
    } catch {
      setBackend(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(refresh, 3000)
    return () => window.clearInterval(t)
  }, [refresh, settings])

  const reconnect = async () => {
    await reconnectDevices(settings)
    await refresh()
    push({ kind: 'success', message: 'Переподключение устройств выполнено', dismissMs: 3000 })
  }

  const testPrinterClick = async () => {
    setPrinterTest('Проверка принтера…')
    const r = await testPrinter(settings)
    setPrinterTest(r?.message ?? 'Нет ответа')
    if (r?.savedStrategyId) {
      setSettings((prev) => ({
        ...prev,
        printer: { ...prev.printer, activeStrategyId: r.savedStrategyId },
      }))
    }
    push({ kind: r?.ok ? 'success' : 'error', title: 'Принтер', message: r?.message ?? '' })
  }

  const testScaleClick = async () => {
    setScaleTest('Проверка весов…')
    const r = await testScale(settings)
    setScaleTest(r?.message ?? 'Нет ответа')
    push({ kind: r?.ok ? 'success' : 'warning', title: 'Весы', message: r?.message ?? '' })
  }

  const runAll = async () => {
    setRunning(true)
    const r = (await runDeviceDiagnostics(settings)) as {
      printer?: { message: string }
      scale?: { message: string }
      status?: DeviceStatusSnapshot
    }
    if (r?.printer?.message) setPrinterTest(r.printer.message)
    if (r?.scale?.message) setScaleTest(r.scale.message)
    if (r?.status) setStatus(r.status)
    await refresh()
    setRunning(false)
  }

  const loadLogs = async () => {
    try {
      const channels = ['app', 'backend', 'printer', 'scale', 'update', 'device']
      const parts: string[] = []
      for (const ch of channels) {
        const rows = await (window as any).logsAPI?.read?.(ch, 100)
        if (!Array.isArray(rows) || rows.length === 0) continue
        parts.push(`===== ${ch} =====`)
        for (const row of rows) {
          parts.push(`${row.ts ?? ''} [${row.level}] ${row.message} ${row.meta ? JSON.stringify(row.meta) : ''}`)
        }
      }
      setLogs(parts.length ? parts.join('\n') : 'Логов пока нет.')
    } catch {
      setLogs('Не удалось прочитать логи.')
    }
  }

  const exportLogs = () => {
    const blob = new Blob([logs || ''], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nurcrm-logs-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  /** Полный журнал одним файлом — то, что просят прислать при разборе поломки. */
  const archiveLogs = async () => {
    const api = window.logsAPI
    if (!api?.archive) {
      push({ kind: 'error', title: 'Логи', message: 'Доступно только в приложении кассы.' })
      return
    }
    setArchiving(true)
    try {
      const result = await api.archive()
      if (result.ok) {
        push({
          kind: 'success',
          title: 'Логи собраны',
          message: `${result.files} файлов, ${Math.max(1, Math.round(result.sizeBytes / 1024))} КБ: ${result.path}`,
          dismissMs: 15000,
        })
      } else {
        push({ kind: 'error', title: 'Логи', message: result.error })
      }
    } finally {
      setArchiving(false)
    }
  }

  const exportDb = async () => {
    try {
      const token = localStorage.getItem('nurcrm-token')
      const res = await fetch('http://127.0.0.1:8000/api/diagnostics/export-db', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `nurcrm-export-${new Date().toISOString().slice(0, 10)}.db`
      a.click()
      URL.revokeObjectURL(url)
      push({ kind: 'success', message: 'База экспортирована', dismissMs: 4000 })
    } catch (err: any) {
      push({ kind: 'error', title: 'Экспорт БД', message: err?.message ?? 'Ошибка' })
    }
  }

  const scanner = status?.scanner as DeviceStatusSnapshot['scanner'] & {
    lastBarcode?: string | null
    lastScanAt?: string | null
    lastResponse?: string | null
  }
  const keyboard = status?.keyboard as {
    connected?: boolean
    lastError?: string | null
    lastResponse?: string | null
  }

  return (
    <section className="settings-section diag-section">
      <h2 className="settings-section__title">Диагностика</h2>
      <p className="settings-section__desc">
        Версия, база, логи, оборудование — всё локально
      </p>

      <div className="diag-cards">
        <article className={`diag-card${backend?.db_ok ? ' diag-card--on' : ''}`}>
          <h3>Система</h3>
          <p>{backend?.app_name ?? 'Kassir ERP'}</p>
          <small>Версия бэкенда: {backend?.app_version ?? '—'}</small>
          <small>Приложение: {settings.updates.currentVersion}</small>
        </article>
        <article className={`diag-card${backend?.db_ok ? ' diag-card--on' : ''}`}>
          <h3>База SQLite</h3>
          <p>{backend?.db_ok ? 'OK' : 'Нет связи'}</p>
          <small>
            {backend
              ? `${backend.products_count} товаров · ${backend.sales_count} чеков · ${(backend.sqlite_size_bytes / 1024).toFixed(1)} КБ`
              : '—'}
          </small>
        </article>
        <article className={`diag-card${status?.printer?.connected ? ' diag-card--on' : ''}`}>
          <h3>Принтер</h3>
          <p>{status?.printer?.connected ? 'Подключён' : 'Нет связи'}</p>
          <small>{status?.printer?.lastResponse ?? status?.printer?.lastError ?? '—'}</small>
        </article>
        <article className={`diag-card${status?.scale?.connected ? ' diag-card--on' : ''}`}>
          <h3>Весы</h3>
          <p>
            {status?.scale?.lastWeightKg != null
              ? `${status.scale.lastWeightKg} кг`
              : 'Ожидание…'}
          </p>
          <small>{status?.scale?.lastResponse ?? status?.scale?.lastError ?? '—'}</small>
        </article>
        <article className={`diag-card${scanner?.connected !== false ? ' diag-card--on' : ''}`}>
          <h3>Сканер</h3>
          <p>{scanner?.connected !== false ? 'Активен' : 'Нет данных'}</p>
          <small>
            {scanner?.lastBarcode
              ? `Последний: ${scanner.lastBarcode}`
              : scanner?.lastResponse ?? 'Сканируйте на кассе'}
          </small>
        </article>
        <article className="diag-card diag-card--on">
          <h3>Клавиатура</h3>
          <p>{settings.system.showKeyboardOnFocus ? 'VirtualKeyboard' : 'Выкл.'}</p>
          <small>{keyboard?.lastResponse ?? 'Локальная'}</small>
        </article>
      </div>

      {/*
        Диагностика — только чтение.

        Порты здесь показываются, но не правятся: смена порта или протокола
        посреди смены останавливает печать, а разобраться, почему принтер
        замолчал, кассир не сможет. Оборудование настраивает специалист в
        сервисном мастере; здесь видно, что настроено, и можно проверить
        печатью — этого достаточно, чтобы описать проблему по телефону.
      */}
      <div className="settings-form">
        <label className="settings-field">
          <span className="settings-field__label">Порт принтера (LPT/COM)</span>
          <input
            className="settings-field__input"
            value={settings.printer.portOrPath || '—'}
            readOnly
            aria-readonly="true"
          />
        </label>

        <label className="settings-field">
          <span className="settings-field__label">Порт весов (COM)</span>
          <input
            className="settings-field__input"
            value={settings.scale.comPort || '—'}
            readOnly
            aria-readonly="true"
          />
        </label>

        {ports.length > 0 && (
          <p className="diag-ports">Обнаружено: {ports.map((p) => p.path).join(', ')}</p>
        )}

        <button type="button" className="settings-btn settings-btn--primary" onClick={reconnect}>
          Переподключить устройства
        </button>
        <button type="button" className="settings-btn settings-btn--secondary" onClick={runAll} disabled={running}>
          {running ? 'Диагностика…' : 'Полная диагностика'}
        </button>
        <button type="button" className="settings-btn settings-btn--test" onClick={testPrinterClick}>
          Тест принтера
        </button>
        {printerTest && <p className="settings-test-result">{printerTest}</p>}
        <button type="button" className="settings-btn settings-btn--test" onClick={testScaleClick}>
          Тест весов
        </button>
        {scaleTest && <p className="settings-test-result">{scaleTest}</p>}

        <hr className="diag-sep" />
        <button type="button" className="settings-btn settings-btn--secondary" onClick={() => void loadLogs()}>
          Показать логи
        </button>
        <button type="button" className="settings-btn settings-btn--secondary" onClick={exportLogs} disabled={!logs}>
          Экспорт логов
        </button>
        {/* Экран показывает последние строки, а разработчику нужны все —
            собираем полный журнал в один сжатый файл. */}
        <button
          type="button"
          className="settings-btn settings-btn--secondary"
          onClick={() => void archiveLogs()}
          disabled={archiving}
        >
          {archiving ? 'Собираем…' : 'Собрать логи в архив'}
        </button>
        <button type="button" className="settings-btn settings-btn--secondary" onClick={() => void exportDb()}>
          Экспорт базы SQLite
        </button>
        {logs && (
          <pre className="diag-logs">{logs.slice(-12000)}</pre>
        )}
      </div>

      <hr className="diag-sep" />
      <BackupsPanel />

      <SettingsHelpFooter title="Offline">
        <p>
          Данные и база хранятся только на этом компьютере. Интернет для работы кассы не нужен.
        </p>
        <ul>
          <li>
            Копия базы создаётся сама при закрытии смены, не чаще раза в сутки, и хранится семь
            последних. Восстановление перезапускает приложение.
          </li>
          <li>
            Экспорт базы — снимок через VACUUM INTO: файл получается согласованным, со всеми
            подтверждёнными чеками. Простое копирование nurcrm.db их бы потеряло.
          </li>
        </ul>
      </SettingsHelpFooter>
    </section>
  )
}
