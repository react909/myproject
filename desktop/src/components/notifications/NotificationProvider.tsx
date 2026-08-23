import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { NotificationToastStack } from './NotificationToastStack'
import { NotificationCenter } from './NotificationCenter'
import { playNotificationSound } from './notification-sound'
import type { NotificationItem, PushNotificationInput } from './notification.types'

const HISTORY_KEY = 'nurcrm-notification-history'
const MAX_HISTORY = 80

type NotificationContextValue = {
  push: (input: PushNotificationInput) => string
  dismiss: (id: string) => void
  markAllRead: () => void
  unreadCount: number
  centerOpen: boolean
  openCenter: () => void
  closeCenter: () => void
  toggleCenter: () => void
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

function loadHistory(): NotificationItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as NotificationItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHistory(items: NotificationItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(-MAX_HISTORY)))
  } catch {
    /* ignore */
  }
}

function makeId() {
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>(() => loadHistory())
  const [centerOpen, setCenterOpen] = useState(false)
  const timers = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    saveHistory(items)
  }, [items])

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id)
    if (t) window.clearTimeout(t)
    timers.current.delete(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const push = useCallback(
    (input: PushNotificationInput) => {
      const id = makeId()
      const item: NotificationItem = {
        id,
        kind: input.kind,
        message: input.message,
        title: input.title,
        dismissMs: input.dismissMs ?? 6000,
        read: false,
        createdAt: new Date().toISOString(),
      }
      setItems((prev) => [...prev, item])
      if (input.kind === 'error') playNotificationSound('error')
      else playNotificationSound('default')

      const ms = item.dismissMs ?? 6000
      const timer = window.setTimeout(() => {
        setItems((prev) =>
          prev.map((i) => (i.id === id ? { ...i, read: true } : i)),
        )
        timers.current.delete(id)
      }, ms)
      timers.current.set(id, timer)

      return id
    },
    [],
  )

  const markAllRead = useCallback(() => {
    setItems((prev) => prev.map((i) => ({ ...i, read: true })))
  }, [])

  const unreadCount = useMemo(
    () => items.filter((i) => !i.read).length,
    [items],
  )

  const value = useMemo<NotificationContextValue>(
    () => ({
      push,
      dismiss,
      markAllRead,
      unreadCount,
      centerOpen,
      openCenter: () => setCenterOpen(true),
      closeCenter: () => setCenterOpen(false),
      toggleCenter: () => setCenterOpen((v) => !v),
    }),
    [push, dismiss, markAllRead, unreadCount, centerOpen],
  )

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <NotificationToastStack
        items={items}
        onDismiss={(id) => {
          dismiss(id)
        }}
      />
      <NotificationCenter
        open={centerOpen}
        items={items}
        onClose={() => setCenterOpen(false)}
        onMarkAllRead={markAllRead}
        onDismiss={dismiss}
      />
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider')
  return ctx
}
