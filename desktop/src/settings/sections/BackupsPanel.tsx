/**
 * Резервные копии базы: список, создание и восстановление.
 *
 * Копия делается автоматически при закрытии смены, не чаще раза в сутки, и
 * хранится семь последних. Кнопка здесь — для случая «сейчас будем менять
 * оборудование, сделайте копию перед этим».
 *
 * Восстановление идёт через main-процесс, а не через бэкенд: подменить файл
 * базы можно, только когда её никто не держит открытой, а держит её как раз
 * бэкенд. Поэтому останавливает и запускает его Electron.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '../../api/client'
import { useNotifications } from '../../components/notifications/NotificationProvider'
import { ConfirmModal } from '../../components/ConfirmModal'
import './BackupsPanel.css'

type Backup = {
  name: string
  path: string
  sizeBytes: number
  createdAt: string
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${bytes} Б`
}

function formatMoment(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function BackupsPanel() {
  const { push } = useNotifications()
  const [items, setItems] = useState<Backup[]>([])
  const [directory, setDirectory] = useState('')
  const [keep, setKeep] = useState(7)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<Backup | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiGet('/api/diagnostics/backups')
      const rows = Array.isArray(res?.data?.items) ? res.data.items : []
      setItems(
        rows.map((row: Record<string, unknown>) => ({
          name: String(row.name ?? ''),
          path: String(row.path ?? ''),
          sizeBytes: Number(row.size_bytes ?? 0),
          createdAt: String(row.created_at ?? ''),
        })),
      )
      setDirectory(String(res?.data?.directory ?? ''))
      setKeep(Number(res?.data?.keep ?? 7))
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Не удалось получить список копий.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const createNow = async () => {
    setBusy(true)
    try {
      await apiPost('/api/diagnostics/backups')
      push({ kind: 'success', message: 'Копия базы создана', dismissMs: 4000 })
      await load()
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      push({ kind: 'error', title: 'Копия базы', message: detail ?? 'Не удалось создать копию' })
    } finally {
      setBusy(false)
    }
  }

  const restore = async (backup: Backup) => {
    const api = window.backupAPI
    if (!api) {
      push({
        kind: 'error',
        title: 'Восстановление',
        message: 'Доступно только в приложении кассы, не в браузере.',
      })
      return
    }
    setBusy(true)
    try {
      const result = await api.restore(backup.name)
      if (result.ok) {
        push({
          kind: 'success',
          title: 'База восстановлена',
          message: `Из копии ${backup.name}. Прежняя база сохранена рядом на случай ошибки.`,
          dismissMs: 10000,
        })
        // Данные в памяти относятся к прежней базе — перечитываем всё с нуля.
        window.location.reload()
      } else {
        push({ kind: 'error', title: 'Восстановление', message: result.error })
      }
    } catch (err) {
      push({
        kind: 'error',
        title: 'Восстановление',
        message: err instanceof Error ? err.message : 'Не удалось восстановить базу',
      })
    } finally {
      setBusy(false)
      setRestoreTarget(null)
    }
  }

  return (
    <div className="bkp">
      <div className="bkp__head">
        <div>
          <h3 className="bkp__title">Резервные копии</h3>
          <p className="bkp__sub">
            Создаются автоматически при закрытии смены, не чаще раза в сутки. Хранятся {keep}{' '}
            последних.
          </p>
        </div>
        <button
          type="button"
          className="settings-btn settings-btn--secondary"
          onClick={() => void createNow()}
          disabled={busy}
        >
          Сделать копию сейчас
        </button>
      </div>

      {loading && <p className="bkp__muted">Загрузка…</p>}

      {error && (
        <p className="bkp__error" role="alert">
          {error}{' '}
          <button type="button" className="bkp__retry" onClick={() => void load()}>
            Повторить
          </button>
        </p>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="bkp__muted">
          Копий пока нет. Первая появится после закрытия смены — или нажмите «Сделать копию сейчас».
        </p>
      )}

      {items.length > 0 && (
        <ul className="bkp__list">
          {items.map((item, index) => (
            <li key={item.name} className="bkp__row">
              <div className="bkp__row-main">
                <span className="bkp__row-date">{formatMoment(item.createdAt)}</span>
                {index === 0 && <span className="bkp__badge">свежая</span>}
              </div>
              <span className="bkp__row-size">{formatSize(item.sizeBytes)}</span>
              <button
                type="button"
                className="settings-btn settings-btn--secondary"
                onClick={() => setRestoreTarget(item)}
                disabled={busy}
              >
                Восстановить
              </button>
            </li>
          ))}
        </ul>
      )}

      {directory && <p className="bkp__path">Папка копий: {directory}</p>}

      {restoreTarget && (
        <ConfirmModal
          title="Восстановить базу из копии?"
          message={
            `Все данные, добавленные после ${formatMoment(restoreTarget.createdAt)}, будут потеряны: ` +
            'чеки, товары, смены. Текущая база сохранится рядом под именем nurcrm.db.before-restore — ' +
            'из неё можно вернуться, если копия окажется не той. Приложение перезагрузится.'
          }
          confirmLabel="Восстановить"
          danger
          onConfirm={() => void restore(restoreTarget)}
          onCancel={() => setRestoreTarget(null)}
        />
      )}
    </div>
  )
}
