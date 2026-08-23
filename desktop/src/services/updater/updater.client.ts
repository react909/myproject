export type UpdaterStatusPayload = {
  phase: string
  version?: string
  message?: string
  releaseDate?: string
}

export type UpdaterProgressPayload = {
  percent: number
  transferred?: number
  total?: number
}

export async function getUpdaterInfo() {
  return window.updaterAPI?.getInfo() ?? {
    currentVersion: '1.0.0',
    changelog: {},
  }
}

export async function checkUpdates(feedUrl?: string) {
  return window.updaterAPI?.check(feedUrl)
}

export async function downloadUpdate() {
  return window.updaterAPI?.download()
}

export async function installUpdate() {
  return window.updaterAPI?.install()
}

export function subscribeUpdater(
  onStatus: (p: UpdaterStatusPayload) => void,
  onProgress: (p: UpdaterProgressPayload) => void,
) {
  const unsub1 = window.updaterAPI?.onStatus(onStatus) ?? (() => {})
  const unsub2 = window.updaterAPI?.onProgress(onProgress) ?? (() => {})
  return () => {
    unsub1()
    unsub2()
  }
}
