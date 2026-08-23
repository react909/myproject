export type NotificationKind = 'success' | 'warning' | 'error' | 'info' | 'update'

export type NotificationItem = {
  id: string
  kind: NotificationKind
  message: string
  title?: string
  dismissMs?: number
  read?: boolean
  createdAt: string
}

export type PushNotificationInput = {
  kind: NotificationKind
  message: string
  title?: string
  dismissMs?: number
  persist?: boolean
}
