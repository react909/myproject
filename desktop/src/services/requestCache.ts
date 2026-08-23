type CacheEntry<T> = { data: T; at: number }

const memory = new Map<string, CacheEntry<unknown>>()
const inflight = new Map<string, Promise<unknown>>()

export function getMemoryCache<T>(key: string, ttlMs: number): T | null {
  const entry = memory.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > ttlMs) {
    memory.delete(key)
    return null
  }
  return entry.data as T
}

export function setMemoryCache<T>(key: string, data: T): void {
  memory.set(key, { data, at: Date.now() })
}

export function invalidateMemoryCache(prefix?: string): void {
  if (!prefix) {
    memory.clear()
    inflight.clear()
    return
  }
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) memory.delete(key)
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key)
  }
}

/** Один общий in-flight запрос + TTL-кэш в памяти. */
export async function dedupedFetch<T>(
  key: string,
  ttlMs: number,
  fetcher: (signal?: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const cached = getMemoryCache<T>(key, ttlMs)
  if (cached !== null) return cached

  const pending = inflight.get(key)
  if (pending) return pending as Promise<T>

  const promise = fetcher(signal)
    .then((data) => {
      setMemoryCache(key, data)
      inflight.delete(key)
      return data
    })
    .catch((err) => {
      inflight.delete(key)
      throw err
    })

  inflight.set(key, promise)
  return promise
}
