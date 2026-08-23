import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type GoOnlineResult = {
  ok: boolean
  message?: string
}

type PosConnectionContextValue = {
  isOnline: boolean
  networkAvailable: boolean
  offlinePending: number
  switching: boolean
  setOffline: () => void
  tryConnectOnline: () => Promise<GoOnlineResult>
  refreshPendingCount: () => void
}

const PosConnectionContext = createContext<PosConnectionContextValue | null>(null)

/**
 * Offline-first POS: local backend is always the source of truth.
 * The Online/Offline pill stays "Online" (local). Manual CRM sync removed.
 */
export function PosConnectionProvider({ children }: { children: ReactNode }) {
  const [switching] = useState(false)

  const setOffline = useCallback(() => {
    /* no-op: local mode has no CRM offline queue */
  }, [])

  const tryConnectOnline = useCallback(async (): Promise<GoOnlineResult> => {
    return { ok: true, message: 'Локальный режим' }
  }, [])

  const refreshPendingCount = useCallback(() => {}, [])

  const value = useMemo<PosConnectionContextValue>(
    () => ({
      isOnline: true,
      networkAvailable: true,
      offlinePending: 0,
      switching,
      setOffline,
      tryConnectOnline,
      refreshPendingCount,
    }),
    [switching, setOffline, tryConnectOnline, refreshPendingCount],
  )

  return (
    <PosConnectionContext.Provider value={value}>
      {children}
    </PosConnectionContext.Provider>
  )
}

export function usePosConnection(): PosConnectionContextValue {
  const ctx = useContext(PosConnectionContext)
  if (!ctx) {
    throw new Error('usePosConnection must be used within PosConnectionProvider')
  }
  return ctx
}
