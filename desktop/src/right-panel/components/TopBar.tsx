// src/right-panel/components/TopBar.tsx

import { memo, useEffect, useRef, useState } from 'react'
import {
  ShiftOpenIcon,
  ShiftCloseIcon,
  SettingsIcon,
  RefreshIcon,
  WifiOnIcon,
  WifiOffIcon,
} from '../icons'

type TopBarProps = {
  shiftOpen: boolean
  isOnline: boolean
  connectionSwitching: boolean
  offlinePending: number
  cashierName: string
  salesCount: number
  onShiftClick: () => void
  /** Шестерёнка: повтор чека → панель */
  onRepeatReceipt: () => void
  /** Шестерёнка: возврат */
  onQuickReturn: () => void
  onPayDebt: () => void
  onOpenTodayJournal: () => void
  onSettings: () => void
  onRefresh: () => void
  onToggleConnection: () => void
}

export const TopBar = memo(function TopBar({
  shiftOpen,
  isOnline,
  connectionSwitching,
  offlinePending,
  cashierName,
  salesCount,
  onShiftClick,
  onRepeatReceipt,
  onQuickReturn,
  onPayDebt,
  onOpenTodayJournal,
  onSettings,
  onRefresh,
  onToggleConnection,
}: TopBarProps) {
  const [quickOpen, setQuickOpen] = useState(false)
  const quickWrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!quickOpen) return
    const onDoc = (e: MouseEvent) => {
      const el = quickWrapRef.current
      if (el && !el.contains(e.target as Node)) setQuickOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [quickOpen])

  useEffect(() => {
    if (!quickOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setQuickOpen(false)
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [quickOpen])

  return (
    <div className="topbar">
      <div className="topbar__left">
        <button
          type="button"
          className={`topbar__shift-btn ${shiftOpen ? 'is-close' : 'is-open'}`}
          onClick={onShiftClick}
        >
          {shiftOpen ? (
            <ShiftCloseIcon className="topbar__shift-icon" />
          ) : (
            <ShiftOpenIcon className="topbar__shift-icon" />
          )}
          <span>{shiftOpen ? 'Закрыть смену' : 'Открыть смену'}</span>
        </button>

        <button
          type="button"
          className={`topbar__conn-pill ${isOnline ? 'is-online' : 'is-offline'}`}
          onClick={onToggleConnection}
          disabled={connectionSwitching}
          title="Локальный режим (Offline POS)"
        >
          <span className="topbar__conn-dot" />
          {isOnline ? (
            <WifiOnIcon className="topbar__conn-icon" />
          ) : (
            <WifiOffIcon className="topbar__conn-icon" />
          )}
          <span>Локально</span>
          {!isOnline && offlinePending > 0 && (
            <span className="topbar__offline-badge">{offlinePending}</span>
          )}
        </button>
      </div>

      <div className="topbar__right">
        <div className="topbar__cashier">
          <div className="topbar__avatar">
            {cashierName.slice(0, 1).toUpperCase()}
          </div>
          <div className="topbar__cashier-text">
            <strong>{cashierName}</strong>
            <span>{salesCount} чеков</span>
          </div>
        </div>

        <button
          type="button"
          className="topbar__icon-btn"
          onClick={onRefresh}
          title="Обновить"
        >
          <RefreshIcon />
        </button>

        <div className="topbar__quick-wrap" ref={quickWrapRef}>
          <button
            type="button"
            className={`topbar__icon-btn${quickOpen ? ' is-active' : ''}`}
            title="Меню кассы"
            aria-expanded={quickOpen}
            aria-haspopup="menu"
            onClick={() => setQuickOpen((v) => !v)}
          >
            <SettingsIcon />
          </button>
          {quickOpen && (
            <div className="topbar__quick-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="topbar__quick-item"
                onClick={() => {
                  setQuickOpen(false)
                  onRepeatReceipt()
                }}
              >
                Дубликат чека
              </button>
              <button
                type="button"
                role="menuitem"
                className="topbar__quick-item"
                onClick={() => {
                  setQuickOpen(false)
                  onOpenTodayJournal()
                }}
              >
                Чеки за сегодня
              </button>
              <button
                type="button"
                role="menuitem"
                className="topbar__quick-item"
                onClick={() => {
                  setQuickOpen(false)
                  onPayDebt()
                }}
              >
                Оплата долга
              </button>
              <button
                type="button"
                role="menuitem"
                className="topbar__quick-item"
                onClick={() => {
                  setQuickOpen(false)
                  onQuickReturn()
                }}
              >
                Возврат
              </button>
              <div className="topbar__quick-sep" aria-hidden="true" />
              <button
                type="button"
                role="menuitem"
                className="topbar__quick-item topbar__quick-item--muted"
                onClick={() => {
                  setQuickOpen(false)
                  onSettings()
                }}
              >
                Настройки
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})