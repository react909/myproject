/**
 * Local API client — always talks to the Kassir ERP backend on 127.0.0.1:8000.
 * No remote CRM, no GitHub, no external servers.
 */

const LOCAL_API_BASE = 'http://127.0.0.1:8000'

const isElectron = !!(window as any).nurcrm?.apiRequest

export type ApiRequestOptions = {
  signal?: AbortSignal
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

function resolveUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const base = LOCAL_API_BASE.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

async function rawApiRequest(
  method: string,
  path: string,
  body?: unknown,
  tokenOverride?: string | false,
  options?: ApiRequestOptions,
): Promise<{ status: number; data: any; headers?: any }> {
  const url = resolveUrl(path)
  const token =
    tokenOverride === false
      ? null
      : (tokenOverride ?? localStorage.getItem('nurcrm-token'))

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  throwIfAborted(options?.signal)

  if (isElectron) {
    const res = await (window as any).nurcrm.apiRequest({
      method,
      url,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    })
    if (res.status >= 400) {
      const err: any = new Error(`HTTP ${res.status}`)
      err.response = { status: res.status, data: res.data }
      throw err
    }
    return { status: res.status, data: res.data, headers: res.headers }
  }

  const axios = (await import('axios')).default
  try {
    const res = await axios({
      method: method.toLowerCase(),
      url,
      headers,
      data: body,
      timeout: 30000,
      signal: options?.signal,
    })
    return { status: res.status, data: res.data, headers: res.headers }
  } catch (err: any) {
    throw err
  }
}

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  options?: ApiRequestOptions,
): Promise<any> {
  try {
    return await rawApiRequest(method, path, body, undefined, options)
  } catch (err: any) {
    if (err?.response?.status === 401) {
      localStorage.removeItem('nurcrm-token')
      localStorage.removeItem('nurcrm-refresh-token')
      window.dispatchEvent(new CustomEvent('nurcrm-auth-expired'))
    }
    throw err
  }
}

export async function apiGet(path: string, options?: ApiRequestOptions) {
  return apiRequest('GET', path, undefined, options)
}

export async function apiPost(path: string, body?: unknown, options?: ApiRequestOptions) {
  return apiRequest('POST', path, body, options)
}

export async function apiPut(path: string, body?: unknown, options?: ApiRequestOptions) {
  return apiRequest('PUT', path, body, options)
}

export async function apiPatch(path: string, body?: unknown, options?: ApiRequestOptions) {
  return apiRequest('PATCH', path, body, options)
}

export async function apiDelete(path: string, body?: unknown, options?: ApiRequestOptions) {
  return apiRequest('DELETE', path, body, options)
}

export const LOCAL_BACKEND_URL = LOCAL_API_BASE

export default { get: apiGet, post: apiPost, put: apiPut, patch: apiPatch, delete: apiDelete }
