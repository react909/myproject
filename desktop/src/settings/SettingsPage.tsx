// src/settings/SettingsPage.tsx

import { useEffect, useRef, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { SettingsSidebar } from './SettingsSidebar'
import { IconChevronLeft, IconSavedCheck } from './SettingsIcons'
import { loadSettings, saveSettings, type AppSettings } from './appSettings'
import { applyDeviceSettings } from '../services/devices/device.client'
import { PosConnectionBadge } from '../components/PosConnectionBadge'
import { ServiceLockButton } from '../auth/ServicePinGate'
import './SettingsPage.css'

export function SettingsPage() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [saved, setSaved] = useState(false)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    const timer = setTimeout(() => {
      saveSettings(settings)
      void applyDeviceSettings(settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }, 400)
    return () => clearTimeout(timer)
  }, [settings])

  useEffect(() => {
    return () => {
      saveSettings(settingsRef.current)
      void applyDeviceSettings(settingsRef.current)
    }
  }, [])

  return (
    <div className="settings-page">
      <header className="settings-page__header">
        <button
          type="button"
          className="settings-back-btn"
          onClick={() => navigate('/')}
          aria-label="Назад на главную"
        >
          <IconChevronLeft />
          <span>На главную</span>
        </button>
        {saved && (
          <motion.span
            className="settings-saved-indicator"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <IconSavedCheck />
            <span>Сохранено</span>
          </motion.span>
        )}
        <PosConnectionBadge compact />
        {/* Владелец закрывает скрытые разделы, не дожидаясь автоблокировки, —
            обычный сценарий «посмотрел отчёт и вернул кассу продавцу». */}
        <ServiceLockButton className="settings-lock-btn" />
      </header>

      <div className="settings-page__body">
        <SettingsSidebar />
        <main className="settings-page__content">
          <Outlet context={{ settings, setSettings }} />
        </main>
      </div>
    </div>
  )
}