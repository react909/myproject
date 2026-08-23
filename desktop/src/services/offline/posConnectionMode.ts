/** Connectivity stub — local backend only. */
export function isPosOnlineMode(): boolean {
  return true
}

export function setPosManualOffline(_offline: boolean): void {
  /* no-op */
}

export async function probeCrmReachable(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:8000/health')
    return res.ok
  } catch {
    return false
  }
}

export type GoOnlineResult = { ok: boolean; message?: string }

export async function goOnlineAndSync(): Promise<GoOnlineResult> {
  const ok = await probeCrmReachable()
  return { ok, message: ok ? 'Локальный сервер доступен' : 'Локальный сервер не отвечает' }
}
