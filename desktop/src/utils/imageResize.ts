/**
 * Подготовка фотографий к загрузке: уменьшение, сжатие и уменьшенная копия.
 *
 * Основная работа идёт в отдельном потоке (imageResize.worker.ts) — иначе окно
 * замирает на секунды. Здесь только очередь к нему и запасной путь.
 *
 * ЗАПАСНОЙ ПУТЬ нужен не «на всякий случай»: `OffscreenCanvas` есть не везде,
 * а касса ставится на то, что стоит у клиента. Если потока нет, обработка идёт
 * в основном — но СТРОГО ПО ОДНОМУ ФАЙЛУ и с уступкой потоку между ними, чтобы
 * окно успевало перерисоваться. Сколько при этом длится блокировка, замеряется
 * и возвращается наружу: об этом надо знать, а не догадываться.
 */

import type { ResizeRequest, ResizeResult } from './imageResize.worker'

/** Длинная сторона готового снимка. Больше на витрине кассы не нужно. */
export const MAX_SIDE = 1200
/** Длинная сторона уменьшенной копии для списков. */
export const THUMB_SIDE = 240
export const JPEG_QUALITY = 0.82

export type PreparedPhoto = {
  full: Blob
  thumb: Blob
  width: number
  height: number
  /** Сколько заняла обработка, мс. */
  elapsedMs: number
  /** Шла ли обработка в основном потоке (то есть с подвисанием окна). */
  onMainThread: boolean
}

let worker: Worker | null = null
let workerBroken = false
let nextId = 1
const pending = new Map<number, (result: ResizeResult) => void>()

function ensureWorker(): Worker | null {
  if (workerBroken) return null
  if (worker) return worker
  try {
    // `new URL(..., import.meta.url)` — то, как Vite узнаёт файл потока и
    // собирает его отдельной точкой входа. Строкой путь передавать нельзя:
    // в собранном приложении файла с таким именем не будет.
    worker = new Worker(new URL('./imageResize.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<ResizeResult>) => {
      const resolve = pending.get(event.data.id)
      if (resolve) {
        pending.delete(event.data.id)
        resolve(event.data)
      }
    }
    worker.onerror = () => {
      // Поток не поднялся или упал — дальше работаем в основном, но об этом
      // скажем наружу, а не сделаем вид, что всё хорошо.
      workerBroken = true
      worker = null
      for (const [id, resolve] of pending) {
        resolve({ id, ok: false, error: 'Поток обработки изображений недоступен.' })
      }
      pending.clear()
    }
    return worker
  } catch {
    workerBroken = true
    return null
  }
}

/** Поддерживает ли среда обработку вне основного потока. */
export function hasOffscreenSupport(): boolean {
  return typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function'
}

async function viaWorker(file: File | Blob): Promise<PreparedPhoto> {
  const active = ensureWorker()
  if (!active) throw new Error('worker unavailable')
  const id = nextId++
  const request: ResizeRequest = {
    id,
    file,
    maxSide: MAX_SIDE,
    thumbSide: THUMB_SIDE,
    quality: JPEG_QUALITY,
  }
  const result = await new Promise<ResizeResult>((resolve) => {
    pending.set(id, resolve)
    active.postMessage(request)
  })
  if (!result.ok) throw new Error(result.error)
  return {
    full: result.full,
    thumb: result.thumb,
    width: result.width,
    height: result.height,
    elapsedMs: result.elapsedMs,
    onMainThread: false,
  }
}

/** Запасной путь: тот же расчёт, но в основном потоке. Окно при этом стоит. */
async function viaMainThread(file: File | Blob): Promise<PreparedPhoto> {
  const started = performance.now()
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('Не удалось прочитать изображение.'))
      element.src = url
    })
    const render = (maxSide: number, quality: number): Promise<Blob> => {
      const longest = Math.max(image.naturalWidth, image.naturalHeight)
      const scale = longest > maxSide ? maxSide / longest : 1
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(image.naturalWidth * scale)
      canvas.height = Math.round(image.naturalHeight * scale)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Не удалось подготовить холст.')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      return new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось сжать изображение.'))),
          'image/jpeg',
          quality,
        )
      })
    }
    const full = await render(MAX_SIDE, JPEG_QUALITY)
    const thumb = await render(THUMB_SIDE, 0.7)
    const longest = Math.max(image.naturalWidth, image.naturalHeight)
    const scale = longest > MAX_SIDE ? MAX_SIDE / longest : 1
    return {
      full,
      thumb,
      width: Math.round(image.naturalWidth * scale),
      height: Math.round(image.naturalHeight * scale),
      elapsedMs: Math.round(performance.now() - started),
      onMainThread: true,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Подготовить одну фотографию.
 *
 * Файлы обрабатываются ПО ОДНОМУ, а не пачкой: пять одновременных декодирований
 * съедают память под несжатые пиксели (4000×3000 — это 48 МБ на снимок), и на
 * моноблоке с четырьмя гигабайтами это заметно.
 */
export async function preparePhoto(file: File | Blob): Promise<PreparedPhoto> {
  if (hasOffscreenSupport()) {
    try {
      return await viaWorker(file)
    } catch {
      // Поток не справился — доделываем в основном, но честно об этом
      // сообщаем через `onMainThread`.
    }
  }
  const prepared = await viaMainThread(file)
  // Уступка потоку: следующий файл начнёт обрабатываться после того, как окно
  // успеет перерисоваться. Без неё пять файлов подряд сливаются в одну
  // длинную заморозку.
  await new Promise((resolve) => setTimeout(resolve, 0))
  return prepared
}

export type VideoInfo = { durationMs: number; width: number; height: number }

/**
 * Длительность и размеры видео.
 *
 * Меряется ЗДЕСЬ, потому что сервер этого не умеет: разобрать длительность без
 * ffmpeg нельзя, а тащить ffmpeg в офлайновую кассу ради одного числа — это
 * десятки мегабайт в установщике. Сервер проверяет тип, сигнатуру и размер
 * файла; длительность он принимает на веру от интерфейса.
 */
export function readVideoInfo(file: File | Blob): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const info = {
        durationMs: Math.round((video.duration || 0) * 1000),
        width: video.videoWidth,
        height: video.videoHeight,
      }
      URL.revokeObjectURL(url)
      resolve(info)
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Не удалось прочитать видео.'))
    }
    video.src = url
  })
}
