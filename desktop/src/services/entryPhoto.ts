/**
 * Снимок того, кто открыл кабинет владельца.
 *
 * Не распознавание и не защита: дверь по-прежнему открывает только пароль
 * владельца, и снимок ни на что не влияет. Это след — владелец видит, кто
 * заходил в его финансы. Для магазина, где деньги смотрит один человек, а за
 * кассой стоит смена, след работает не хуже замка: подобрать пароль незаметно
 * больше нельзя.
 *
 * Три правила, которые здесь соблюдаются буквально:
 *
 *  1. Камера включается только в момент снимка и гасится сразу. Держать поток
 *     открытым «на всякий случай» нельзя: это и горящий индикатор камеры над
 *     кассой весь день, и постоянная нагрузка на слабом моноблоке.
 *  2. Снимок делается только после успешного входа. Пока пароль набирают,
 *     камера не работает вовсе.
 *  3. Ничего не ломается, если не получилось. Нет камеры, занята другой
 *     программой, отказано в доступе — вход уже состоялся, и мешать ему из-за
 *     фотографии нельзя.
 */

import { apiPost } from '../api/client'

/** Размер кадра. Задача — узнать человека в лицо, а не разглядеть. */
const WIDTH = 320
const HEIGHT = 240

/**
 * Сколько ждать первого пригодного кадра.
 *
 * Камера просыпается не мгновенно, и первые кадры часто чёрные — матрица ещё
 * не набрала экспозицию. Полторы секунды хватает обычной веб-камере; дольше
 * ждать нельзя, человек уже внутри и смотрит на кабинет, а не в объектив.
 */
const WARMUP_MS = 1500

/** Качество JPEG. 0.7 — читаемое лицо примерно в 25 КБ. */
const QUALITY = 0.7

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

/**
 * Делает один кадр с камеры. `null` — камеры нет или она недоступна.
 *
 * Ошибки не пробрасываются: вызывающий уже вошёл, и падение из-за камеры было
 * бы хуже отсутствия снимка.
 */
async function grabFrame(): Promise<string | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null

  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: WIDTH, height: HEIGHT, facingMode: 'user' },
      audio: false,
    })

    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    await video.play()

    /* Ждём кадр, а не время: `play()` возвращается раньше, чем матрица отдаст
       первую картинку, и снимок вышел бы чёрным. Ограничение по времени —
       чтобы не ждать вечно, если камера так и не отдала ничего. */
    await new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener('loadeddata', done)
        resolve()
      }
      if (video.readyState >= 2) resolve()
      else video.addEventListener('loadeddata', done)
      window.setTimeout(done, WARMUP_MS)
    })

    if (!video.videoWidth) return null

    const canvas = document.createElement('canvas')
    canvas.width = WIDTH
    canvas.height = HEIGHT
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(video, 0, 0, WIDTH, HEIGHT)

    video.pause()
    video.srcObject = null
    return canvas.toDataURL('image/jpeg', QUALITY)
  } catch {
    // Нет камеры, отказано в доступе, занята другой программой — молча
    // обходимся без снимка.
    return null
  } finally {
    // Камера гаснет в любом случае, включая ошибку на середине.
    if (stream) stopStream(stream)
  }
}

/**
 * Снимает вошедшего и отправляет снимок на локальный сервер.
 *
 * Ничего не ждёт и ничего не возвращает: вызывается после того, как дверь уже
 * открылась, и задерживать переход в кабинет ради фотографии незачем.
 */
export function captureOwnerEntry(hasCamera: boolean): void {
  // Камеры на этой кассе нет — специалист снял галочку в мастере. Не спрашиваем
  // доступ вовсе: системный запрос на устройстве без камеры выглядит поломкой.
  if (!hasCamera) return

  void (async () => {
    const image = await grabFrame()
    if (!image) return
    try {
      await apiPost('/api/auth/owner/entry-photo', { image })
    } catch {
      /* журнал не должен мешать работе кабинета */
    }
  })()
}
