// src/settings/sections/SystemSection.tsx

import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { apiPost } from '../../api/client'
import { clearAccountSession } from '../../services/accountSession'
import type { AppSettings } from '../appSettings'
import { ConfirmPasswordModal } from '../ConfirmPasswordModal'
import { SettingsHelpFooter } from '../SettingsHelpFooter'
import './SystemSection.css'

type ContextType = {
  settings: AppSettings
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>
}

export function SystemSection() {
  const { settings, setSettings } = useOutletContext<ContextType>()
  const [resetOpen, setResetOpen] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState('')

  const confirmReset = async (password: string) => {
    setResetBusy(true)
    setResetError('')
    try {
      await apiPost('/api/setup/factory-reset', { password })
      clearAccountSession()
      window.location.reload()
    } catch (err: any) {
      setResetError(err?.response?.data?.detail ?? 'Не удалось сбросить кассу')
      setResetBusy(false)
    }
  }

  const patchSystem = (patch: Partial<AppSettings['system']>) => {
    setSettings((prev) => {
      const next = { ...prev, system: { ...prev.system, ...patch } }
      void window.systemAPI?.setAutoLaunch?.(next.system.startWithWindows)
      void window.systemAPI?.applyKiosk?.(next.system.alwaysFullscreen)
      return next
    })
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Система</h2>
      <p className="settings-section__desc">Общее поведение приложения после запуска</p>

      <div className="settings-form">
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.system.startWithWindows}
            onChange={(e) => patchSystem({ startWithWindows: e.target.checked })}
          />
          <span>Автозапуск вместе с Windows</span>
        </label>

        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.system.showKeyboardOnFocus}
            onChange={(e) => patchSystem({ showKeyboardOnFocus: e.target.checked })}
          />
          <span>Встроенная клавиатура NurCRM при фокусе поля ввода</span>
        </label>

        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.system.alwaysFullscreen}
            onChange={(e) => patchSystem({ alwaysFullscreen: e.target.checked })}
          />
          <span>Полный экран без рамки (скрыть кнопку окна)</span>
        </label>
        <p className="settings-field__hint">
          Для режима киоска: рабочий стол пользователя виден только в окне приложения.
        </p>
      </div>

      <div className="system-danger-zone">
        <h3 className="system-danger-zone__title">Опасная зона</h3>
        <p className="system-danger-zone__desc">
          Полный сброс кассы: удаляет владельца, всех сотрудников, товары, чеки и настройки магазина. После этого
          приложение снова откроет регистрацию — как при первой установке.
        </p>
        <button type="button" className="system-danger-zone__btn" onClick={() => setResetOpen(true)}>
          Удалить аккаунт владельца / сбросить кассу
        </button>
      </div>

      <SettingsHelpFooter title="Чем «Система» отличается от других экранов">
        <p>
          Здесь собрано то, что относится к <strong>запуску Windows и режиму окна приложения</strong>, а не к
          весам, чекам или обновлениям прошивки.
        </p>
        <ul>
          <li>«Экран» — про размер и плотность элементов в каталоге.</li>
          <li>«Подключение» — про COM и протокол для оборудования.</li>
        </ul>
        <p className="settings-help-footer__idea">
          <strong>Идеи:</strong> экспорт/импорт всех настроек в один файл; привязка к профилю кассира; отдельный
          «URL API» для сервера NurCRM — чтобы после тиражирования Manablock на сеть касс не править адреса
          вручную.
        </p>
      </SettingsHelpFooter>

      {resetOpen && (
        <ConfirmPasswordModal
          title="Сбросить кассу?"
          description="Это удалит владельца, всех сотрудников и все данные магазина без возможности восстановления. Приложение перезапустится на экране регистрации."
          confirmLabel="Сбросить кассу"
          danger
          busy={resetBusy}
          error={resetError}
          onConfirm={(password) => void confirmReset(password)}
          onCancel={() => {
            setResetOpen(false)
            setResetError('')
          }}
        />
      )}
    </section>
  )
}
