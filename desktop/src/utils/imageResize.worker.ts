/**
 * Уменьшение и сжатие фотографий — В ОТДЕЛЬНОМ ПОТОКЕ.
 *
 * Почему не в основном. Пять фотографий с телефона — это по 4000×3000 точек,
 * то есть по 12 миллионов пикселей каждая. Декодирование и рисование такой
 * картинки на обычном `canvas` идёт в том же потоке, что и весь интерфейс:
 * окно замирает, курсор не двигается, нажатия копятся в очередь. На пяти
 * файлах подряд это секунды неподвижного экрана — то самое «интерфейс
 * замирает», которого быть не должно.
 *
 * `createImageBitmap` декодирует вне основного потока, `OffscreenCanvas`
 * рисует там же, и наружу отдаётся уже готовый маленький Blob. Основной поток
 * при этом не делает ничего, кроме передачи файла сюда и получения результата.
 *
 * Сжатие в JPEG, а не PNG: фотография товара в PNG весит в пять-десять раз
 * больше при том же виде. PNG остаётся только там, где нужна прозрачность, —
 * а у фотографии товара её не бывает.
 */

export type ResizeRequest = {
  id: number
  file: File | Blob
  /** Длинная сторона готового снимка. */
  maxSide: number
  /** Длинная сторона уменьшенной копии для списков. */
  thumbSide: number
  quality: number
}

export type ResizeResult =
  | {
      id: number
      ok: true
      full: Blob
      thumb: Blob
      width: number
      height: number
      /** Сколько заняла сама обработка. Уходит в отчёт о скорости. */
      elapsedMs: number
    }
  | { id: number; ok: false; error: string }

/** Во сколько уместить картинку, сохранив пропорции. Увеличивать не будем. */
function fit(width: number, height: number, maxSide: number) {
  const longest = Math.max(width, height)
  if (longest <= maxSide) return { width, height }
  const scale = maxSide / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

async function draw(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<Blob> {
  const size = fit(bitmap.width, bitmap.height, maxSide)
  const canvas = new OffscreenCanvas(size.width, size.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Не удалось подготовить холст.')
  // Качественное масштабирование: без него уменьшение в пять раз даёт
  // ступенчатые края, и фотография выглядит хуже, чем исходная.
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, size.width, size.height)
  return canvas.convertToBlob({ type: 'image/jpeg', quality })
}

self.onmessage = async (event: MessageEvent<ResizeRequest>) => {
  const { id, file, maxSide, thumbSide, quality } = event.data
  const started = performance.now()
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const full = await draw(bitmap, maxSide, quality)
    // Уменьшенная копия — из ТОГО ЖЕ битмапа, а не из готового JPEG: второе
    // декодирование стоило бы столько же, сколько первое.
    const thumb = await draw(bitmap, thumbSide, 0.7)
    const size = fit(bitmap.width, bitmap.height, maxSide)
    const result: ResizeResult = {
      id,
      ok: true,
      full,
      thumb,
      width: size.width,
      height: size.height,
      elapsedMs: Math.round(performance.now() - started),
    }
    ;(self as unknown as Worker).postMessage(result)
  } catch (error) {
    const result: ResizeResult = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Не удалось обработать изображение.',
    }
    ;(self as unknown as Worker).postMessage(result)
  } finally {
    // Битмап держит несжатые пиксели: 4000×3000 — это 48 МБ. Не закрыть его
    // значит накопить их по числу загруженных фотографий.
    bitmap?.close()
  }
}
