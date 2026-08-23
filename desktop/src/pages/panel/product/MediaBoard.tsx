/**
 * Фото и видео карточки товара.
 *
 * Три вещи, ради которых это отдельный компонент.
 *
 * ПОРЯДОК ДОСТУПЕН С КЛАВИАТУРЫ. Перетаскивание мышью есть, но оно НЕ
 * единственный способ: у каждого снимка кнопки «левее» и «правее», до которых
 * доходит Tab. Требование «ни одно действие не требует мыши» относится и к
 * выбору главного фото — а главное фото это то, что видно на витрине кассы.
 *
 * ОБРАБОТКА ИДЁТ ДО ЗАГРУЗКИ И ВНЕ ОСНОВНОГО ПОТОКА. Снимок с телефона — это
 * 12 мегапикселей; уменьшение такого на обычном холсте вешает окно на секунды.
 * Уменьшает отдельный поток (utils/imageResize.ts), сюда возвращается готовый
 * маленький файл, и он же показывается в предпросмотре.
 *
 * ФАЙЛЫ ГРУЗЯТСЯ СРАЗУ, а привязываются к товару при сохранении. Поэтому у
 * снимка два состояния: «во временной папке» (есть токен) и «привязан» (есть
 * номер). Различать их надо: первый удаляется локально, второй — запросом.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteMedia, mediaUrl, stageMedia } from '../../../services/productCard'
import type { MediaItem } from '../../../services/productCard'
import { preparePhoto, readVideoInfo } from '../../../utils/imageResize'

/** Столько же, сколько принимает сервер. Расходиться им нельзя. */
export const MAX_PHOTOS = 5
const MAX_VIDEO_MB = 20
const MAX_VIDEO_SECONDS = 30

export type Slot = {
  key: string
  kind: 'photo' | 'video'
  /** Номер привязанного файла. Нет — файл ещё во временной папке. */
  id?: number
  /** Токен временного файла. Уходит на сервер при сохранении карточки. */
  token?: string
  /** Токен уменьшенной копии. У видео её нет. */
  thumbToken?: string
  previewUrl: string
  busy?: boolean
  error?: string
}

type Props = {
  /** Товар, если он уже создан: только тогда файлы можно удалять запросом. */
  productId?: number
  attached: MediaItem[]
  slots: Slot[]
  onSlots: (next: Slot[]) => void
  /** Сколько миллисекунд заняла последняя обработка — показывается в отчёте. */
  onTiming?: (info: { elapsedMs: number; onMainThread: boolean }) => void
}

export function MediaBoard({ productId, attached, slots, onSlots, onTiming }: Props) {
  const photoInput = useRef<HTMLInputElement | null>(null)
  const videoInput = useRef<HTMLInputElement | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)

  /* Привязанные файлы приезжают с сервера — показываем их вместе с новыми. */
  useEffect(() => {
    if (attached.length === 0) return
    onSlots(
      attached.map((item) => ({
        key: `m${item.id}`,
        kind: item.kind,
        id: item.id,
        previewUrl: mediaUrl(item.thumbUrl || item.url),
      })),
    )
    // Список привязанных меняется только при загрузке карточки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attached])

  const photos = slots.filter((slot) => slot.kind === 'photo')
  const video = slots.find((slot) => slot.kind === 'video')

  const addPhotos = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      const room = MAX_PHOTOS - photos.length
      const picked = Array.from(files).slice(0, Math.max(0, room))
      if (picked.length === 0) return

      // Заглушки появляются сразу: иначе после выбора пяти файлов экран
      // несколько секунд выглядит так, будто нажатие не сработало.
      const placeholders: Slot[] = picked.map((file, index) => ({
        key: `p${Date.now()}-${index}`,
        kind: 'photo',
        previewUrl: '',
        busy: true,
        error: undefined,
        token: undefined,
        id: undefined,
        // Имя не показываем: оно длинное и ничего не добавляет к картинке.
        ...(file ? {} : {}),
      }))
      let working = [...slots, ...placeholders]
      onSlots(working)

      // ПО ОДНОМУ: пять одновременных декодирований съедают память под
      // несжатые пиксели (12 Мп — это 48 МБ на снимок).
      for (let index = 0; index < picked.length; index += 1) {
        const file = picked[index]
        const key = placeholders[index].key
        try {
          const prepared = await preparePhoto(file)
          onTiming?.({ elapsedMs: prepared.elapsedMs, onMainThread: prepared.onMainThread })
          /*
            Грузятся ОБА файла: снимок и уменьшенная копия.

            Копия обязательна: в списке товаров и на витрине кассы показывается
            только она. Без неё пришлось бы отдавать оригинал — двести
            килобайт на плитку вместо десяти, и список из пятидесяти товаров
            тянул бы десять мегабайт вместо полумегабайта.

            Делать копию на сервере нельзя: у него нет распакованной картинки,
            а здесь она уже есть — вторая отрисовка из того же битмапа почти
            бесплатна.
          */
          const staged = await stageMedia(prepared.full, 'photo', 'image/jpeg')
          const stagedThumb = await stageMedia(prepared.thumb, 'photo', 'image/jpeg')
          working = working.map((slot) =>
            slot.key === key
              ? {
                  ...slot,
                  busy: false,
                  token: staged.token,
                  thumbToken: stagedThumb.token,
                  previewUrl: URL.createObjectURL(prepared.thumb),
                }
              : slot,
          )
        } catch (error: any) {
          working = working.map((slot) =>
            slot.key === key
              ? { ...slot, busy: false, error: error?.message ?? 'Не удалось загрузить.' }
              : slot,
          )
        }
        onSlots(working)
      }
    },
    [photos.length, slots, onSlots, onTiming],
  )

  const addVideo = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0]
      if (!file) return
      const key = `v${Date.now()}`
      // Видео одно: новое заменяет старое, а не добавляется вторым.
      let working = [...slots.filter((slot) => slot.kind !== 'video'), {
        key,
        kind: 'video' as const,
        previewUrl: '',
        busy: true,
      }]
      onSlots(working)

      try {
        if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
          throw new Error(`Видео больше ${MAX_VIDEO_MB} МБ.`)
        }
        // Длительность меряем ЗДЕСЬ: сервер её не умеет — см. imageResize.ts.
        const info = await readVideoInfo(file)
        if (info.durationMs > MAX_VIDEO_SECONDS * 1000) {
          throw new Error(`Видео длиннее ${MAX_VIDEO_SECONDS} секунд.`)
        }
        const staged = await stageMedia(file, 'video', file.type || 'video/mp4', info.durationMs)
        working = working.map((slot) =>
          slot.key === key
            ? { ...slot, busy: false, token: staged.token, previewUrl: URL.createObjectURL(file) }
            : slot,
        )
      } catch (error: any) {
        working = working.map((slot) =>
          slot.key === key
            ? { ...slot, busy: false, error: error?.message ?? 'Не удалось загрузить видео.' }
            : slot,
        )
      }
      onSlots(working)
    },
    [slots, onSlots],
  )

  const drop = useCallback(
    async (slot: Slot) => {
      if (slot.id && productId) {
        try {
          await deleteMedia(productId, slot.id)
        } catch {
          // Файла уже нет — из списка убираем всё равно: держать строку,
          // которая ссылается в пустоту, хуже.
        }
      }
      if (slot.previewUrl.startsWith('blob:')) URL.revokeObjectURL(slot.previewUrl)
      onSlots(slots.filter((item) => item.key !== slot.key))
    },
    [productId, slots, onSlots],
  )

  /** Переставить снимок. Работает и мышью, и с клавиатуры. */
  const move = useCallback(
    (key: string, delta: number) => {
      const list = [...slots]
      const from = list.findIndex((slot) => slot.key === key)
      if (from < 0) return
      const to = from + delta
      if (to < 0 || to >= list.length) return
      if (list[to].kind !== list[from].kind) return
      const [moved] = list.splice(from, 1)
      list.splice(to, 0, moved)
      onSlots(list)
    },
    [slots, onSlots],
  )

  return (
    <div className="pmb">
      <div className="pmb__row">
        {photos.map((slot, index) => (
          <div
            className={`pmb__slot${slot.error ? ' pmb__slot--bad' : ''}${
              dragKey === slot.key ? ' pmb__slot--dragging' : ''
            }`}
            key={slot.key}
            draggable={!slot.busy}
            onDragStart={() => setDragKey(slot.key)}
            onDragEnd={() => setDragKey(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              if (!dragKey || dragKey === slot.key) return
              const from = slots.findIndex((item) => item.key === dragKey)
              const to = slots.findIndex((item) => item.key === slot.key)
              if (from < 0 || to < 0) return
              move(dragKey, to - from)
              setDragKey(null)
            }}
          >
            {slot.busy ? (
              <span className="pmb__busy" aria-label="Обрабатываем" />
            ) : slot.error ? (
              <span className="pmb__error" title={slot.error}>
                !
              </span>
            ) : (
              <img src={slot.previewUrl} alt="" className="pmb__img" />
            )}

            {/* Первое фото — главное: оно попадает на витрину кассы. */}
            {index === 0 && !slot.busy && !slot.error && (
              <span className="pmb__main">Главное</span>
            )}

            {/* Порядок доступен с клавиатуры: перетаскивание мышью — не
                единственный способ. */}
            <div className="pmb__tools">
              <button
                type="button"
                className="pmb__tool"
                onClick={() => move(slot.key, -1)}
                disabled={index === 0}
                title="Левее"
                aria-label="Переместить левее"
              >
                ‹
              </button>
              <button
                type="button"
                className="pmb__tool"
                onClick={() => move(slot.key, 1)}
                disabled={index === photos.length - 1}
                title="Правее"
                aria-label="Переместить правее"
              >
                ›
              </button>
              <button
                type="button"
                className="pmb__tool pmb__tool--drop"
                onClick={() => void drop(slot)}
                title="Убрать"
                aria-label="Убрать снимок"
              >
                ×
              </button>
            </div>
          </div>
        ))}

        {photos.length < MAX_PHOTOS && (
          <button
            type="button"
            className="pmb__add"
            data-field="photo"
            onClick={() => photoInput.current?.click()}
          >
            <span className="pmb__add-sign">+</span>
            <span className="pmb__add-text">Фото</span>
            <span className="pmb__add-hint">
              {photos.length}/{MAX_PHOTOS}
            </span>
          </button>
        )}

        {/* Видео — одно. Отдельной плиткой, чтобы не путалось с фотографиями. */}
        {video ? (
          <div className={`pmb__slot pmb__slot--video${video.error ? ' pmb__slot--bad' : ''}`}>
            {video.busy ? (
              <span className="pmb__busy" aria-label="Загружаем" />
            ) : video.error ? (
              <span className="pmb__error" title={video.error}>
                !
              </span>
            ) : (
              // Не проигрывается само: `preload="metadata"` берёт только кадр,
              // а не файл целиком, и звук не включается никогда.
              <video src={video.previewUrl} className="pmb__img" preload="metadata" controls />
            )}
            <div className="pmb__tools">
              <button
                type="button"
                className="pmb__tool pmb__tool--drop"
                onClick={() => void drop(video)}
                title="Убрать видео"
                aria-label="Убрать видео"
              >
                ×
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="pmb__add pmb__add--video"
            data-field="video"
            onClick={() => videoInput.current?.click()}
          >
            <span className="pmb__add-sign">+</span>
            <span className="pmb__add-text">Видео</span>
            <span className="pmb__add-hint">до {MAX_VIDEO_SECONDS} с</span>
          </button>
        )}
      </div>

      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        multiple
        className="pmb__file"
        onChange={(event) => {
          void addPhotos(event.target.files)
          // Сброс: иначе повторный выбор того же файла не даст события.
          event.target.value = ''
        }}
      />
      <input
        ref={videoInput}
        type="file"
        accept="video/mp4,video/webm"
        className="pmb__file"
        onChange={(event) => {
          void addVideo(event.target.files)
          event.target.value = ''
        }}
      />
    </div>
  )
}
