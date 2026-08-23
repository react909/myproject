import { useCallback, useEffect, useRef, useState } from 'react'

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; code?: string }
  return e.name === 'AbortError' || e.name === 'CanceledError' || e.code === 'ERR_CANCELED'
}

export function panelLoadErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as { response?: { data?: { detail?: string } }; message?: string }
    if (typeof e.response?.data?.detail === 'string' && e.response.data.detail) {
      return e.response.data.detail
    }
    if (typeof e.message === 'string' && e.message) return e.message
  }
  return fallback
}

export type PanelAsyncLoadState<T> = {
  data: T | null
  isLoading: boolean
  isRefreshing: boolean
  error: string | null
  hasData: boolean
  reload: () => void
}

const PANEL_DATA_TTL_MS = 5 * 60 * 1000
const panelDataCache = new Map<string, { at: number; data: unknown }>()

function readPanelCache<T>(key: string): T | null {
  const entry = panelDataCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > PANEL_DATA_TTL_MS) {
    panelDataCache.delete(key)
    return null
  }
  return entry.data as T
}

function writePanelCache<T>(key: string, data: T): void {
  panelDataCache.set(key, { at: Date.now(), data })
}

export function invalidatePanelDataCache(prefix?: string): void {
  if (!prefix) {
    panelDataCache.clear()
    return
  }
  for (const key of panelDataCache.keys()) {
    if (key.startsWith(prefix)) panelDataCache.delete(key)
  }
}

export function usePanelAsyncLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>,
  enabled = true,
  cacheKey?: string,
): PanelAsyncLoadState<T> {
  const cachedInitial = cacheKey ? readPanelCache<T>(cacheKey) : null
  const [data, setData] = useState<T | null>(cachedInitial)
  const [isLoading, setIsLoading] = useState(cachedInitial === null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requestSeq = useRef(0)
  const hasDataRef = useRef(cachedInitial !== null)
  const staleRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load

  const depsKey = JSON.stringify(deps)
  const lastDepsKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (lastDepsKeyRef.current !== null && lastDepsKeyRef.current !== depsKey) {
      staleRef.current = true
    }
    lastDepsKeyRef.current = depsKey
  }, [depsKey])

  const run = useCallback(async (signal: AbortSignal) => {
    const seq = ++requestSeq.current
    const initial = !hasDataRef.current
    if (initial) setIsLoading(true)
    else setIsRefreshing(true)
    setError(null)

    try {
      const next = await loadRef.current(signal)
      if (seq !== requestSeq.current || signal.aborted) return
      hasDataRef.current = true
      setData(next)
      if (cacheKey) writePanelCache(cacheKey, next)
    } catch (err: unknown) {
      if (seq !== requestSeq.current || signal.aborted || isAbortError(err)) return
      setError(panelLoadErrorMessage(err, 'Не удалось загрузить данные'))
    } finally {
      if (seq === requestSeq.current && !signal.aborted) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [cacheKey])

  const start = useCallback(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    void run(controller.signal)
  }, [run])

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort()
      return undefined
    }

    if (!staleRef.current && hasDataRef.current) {
      return undefined
    }

    if (cacheKey && !staleRef.current) {
      const cached = readPanelCache<T>(cacheKey)
      if (cached) {
        setData(cached)
        hasDataRef.current = true
        setIsLoading(false)
        return undefined
      }
    }

    staleRef.current = false
    start()
    return () => {
      abortRef.current?.abort()
      requestSeq.current += 1
    }
  }, [depsKey, enabled, cacheKey, start])

  const reload = useCallback(() => {
    staleRef.current = true
    start()
  }, [start])

  return {
    data,
    isLoading,
    isRefreshing,
    error,
    hasData: data !== null,
    reload,
  }
}
