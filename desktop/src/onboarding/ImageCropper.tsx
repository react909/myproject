/**
 * Обрезка картинки — один редактор на всё приложение.
 *
 * Им обрезаются и снимок QR, и логотип интерфейса, и логотип чека. Раньше
 * инструмент был только у QR: автообрезка полей, зум, поворот — а логотип
 * загружали как есть, вместе с белыми полями вокруг знака. Второй такой
 * редактор писать нельзя: обрезка одна и та же, различия задаются пропсами.
 *
 * Что различается по местам вызова:
 *  • `autoTrim` — как искать поля. У QR своя точная реализация по угловым
 *    меткам кода (см. qrImage.ts), у логотипов — общая по однотонным краям.
 *  • `validate` — проверка результата. Нужна только QR: слишком тесная обрезка
 *    съедает тихую зону, и код перестают брать сканеры.
 *  • `renderPreview` — где показать результат: в макете шапки приложения или
 *    на ленте чека.
 *
 * Рамка тянется за углы и стороны и меняет размер симметрично относительно
 * центра, а картинка ездит под ней: так предсказуемо, и не приходится ловить,
 * какой угол «закреплён».
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import Cropper from 'react-easy-crop'
import type { Area } from 'react-easy-crop'
import { ModalPortal } from '../components/ModalPortal'
import { applyShapeMask, autoTrimImage, cropImage, flipImage, removeWhiteBackground } from './logoCanvas'
import type { LogoShape } from './types'

/**
 * Формы обрезки.
 *
 * Круг — это не пропорция, а маска: за границей круга остаётся прозрачность,
 * и она запекается в PNG. Поэтому форма возвращается вызывающему — знак,
 * обрезанный по кругу, шапка приложения показывает круглым, а чек заливает
 * прозрачное белым, чтобы на ленте не было чёрного квадрата.
 */
export const CROP_SHAPES = [
  { id: 'square', label: 'Квадрат', ratio: 1 },
  { id: 'circle', label: 'Круг', ratio: 1 },
  { id: 'wide', label: 'Лента 4:1', ratio: 4 },
  { id: 'free', label: 'Свободно', ratio: 0 },
] as const

export type CropShapeId = (typeof CROP_SHAPES)[number]['id']

/** Границы масштаба в процентах — те же, что показывает поле ввода. */
const ZOOM_MIN = 10
const ZOOM_MAX = 400
const ZOOM_STEP = 5

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export type CropResult = {
  /** PNG data URL готового знака. Для круга — с прозрачностью за границей. */
  image: string
  /** Какой формой обрезали. Нужна шапке и печати, а не только редактору. */
  shape: LogoShape
}

type Props = {
  /** Исходник для обрезки. Хранится отдельно от результата, чтобы обрезку
   *  можно было переделать, не теряя качество на повторном кропе. */
  source: string
  title: string
  /** Форма, с которой редактор открывается. Для чека удобнее лента. */
  initialShape?: CropShapeId
  /**
   * Как искать поля для автообрезки. По умолчанию — общая обрезка однотонных
   * краёв; QR передаёт свою, по угловым меткам кода.
   */
  autoTrim?: (source: string) => Promise<string>
  /** Что сказать, когда обрезать нечего. */
  autoTrimEmptyNote?: string
  /**
   * Проверка результата перед применением. Возвращает текст предупреждения
   * или пустую строку. Нужна картинке QR: слишком тесная обрезка съедает
   * тихую зону, и код перестаёт сканироваться — узнать об этом надо здесь,
   * а не на кассе при живом клиенте.
   */
  validate?: (result: string) => Promise<string>
  /** Живой предпросмотр результата в том виде, в каком он будет работать. */
  renderPreview?: (result: string) => ReactNode
  onApply: (result: CropResult) => Promise<void> | void
  onClose: () => void
  onError: (message: string) => void
}

export function ImageCropper({
  source,
  title,
  initialShape = 'square',
  autoTrim = autoTrimImage,
  autoTrimEmptyNote = 'Полей вокруг картинки не нашлось — она уже обрезана по содержимому.',
  validate,
  renderPreview,
  onApply,
  onClose,
  onError,
}: Props) {
  const [image, setImage] = useState(source)
  const [notice, setNotice] = useState('')
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [area, setArea] = useState<Area | null>(null)
  const [shape, setShape] = useState<CropShapeId>(initialShape)
  const [cropSize, setCropSize] = useState({ width: 280, height: 280 })
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState('')

  const stageRef = useRef<HTMLDivElement | null>(null)
  const stageBox = useRef({ width: 0, height: 0 })
  const dragRef = useRef<{ handle: Handle; startX: number; startY: number; w: number; h: number } | null>(null)

  useEffect(() => setImage(source), [source])

  const clampCropSize = (width: number, height: number) => {
    const maxW = Math.max(80, stageBox.current.width - 24 || 320)
    const maxH = Math.max(80, stageBox.current.height - 24 || 320)
    return {
      width: Math.max(60, Math.min(width, maxW)),
      height: Math.max(60, Math.min(height, maxH)),
    }
  }

  const applyShape = (id: CropShapeId) => {
    setShape(id)
    const ratio = CROP_SHAPES.find((item) => item.id === id)?.ratio ?? 0
    if (!ratio) return
    const maxW = Math.max(80, stageBox.current.width - 24 || 320)
    const maxH = Math.max(80, stageBox.current.height - 24 || 320)
    let width = maxW
    let height = width / ratio
    if (height > maxH) {
      height = maxH
      width = height * ratio
    }
    setCropSize({ width: Math.round(width), height: Math.round(height) })
  }

  useEffect(() => {
    const element = stageRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => {
      stageBox.current = { width: entry.contentRect.width, height: entry.contentRect.height }
      setCropSize((prev) => clampCropSize(prev.width, prev.height))
    })
    observer.observe(element)
    return () => observer.disconnect()
    // clampCropSize читает только ref-ы, пересоздавать наблюдатель незачем.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Стартовая форма выставляется, когда сцена уже измерена, иначе рамка
     считалась бы по нулевым размерам и схлопывалась в минимум. */
  useEffect(() => {
    const timer = window.setTimeout(() => applyShape(initialShape), 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialShape])

  /*
   * Живой предпросмотр результата.
   *
   * Считается с паузой и только когда его есть кому показать: полный кроп на
   * каждое движение рамки — это canvas на каждый кадр. Пауза в четверть
   * секунды человеком не ощущается, а работу сокращает на порядок.
   */
  useEffect(() => {
    if (!renderPreview || !area) return undefined
    let cancelled = false
    const timer = window.setTimeout(() => {
      void cropImage(image, area, rotation)
        .then((result) => applyShapeMask(result, shape === 'circle' ? 'circle' : 'square'))
        .then((result) => {
          if (!cancelled) setPreview(result)
        })
        .catch(() => {
          if (!cancelled) setPreview('')
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [image, area, rotation, shape, renderPreview])

  const onHandleDown = (handle: Handle) => (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      w: cropSize.width,
      h: cropSize.height,
    }
  }

  const onHandleMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current
    if (!drag) return
    // Рамка меняется симметрично от центра, поэтому смещение указателя даёт
    // удвоенное изменение стороны.
    const dx = (event.clientX - drag.startX) * 2
    const dy = (event.clientY - drag.startY) * 2
    const horizontal = drag.handle.includes('w') ? -dx : drag.handle.includes('e') ? dx : 0
    const vertical = drag.handle.includes('n') ? -dy : drag.handle.includes('s') ? dy : 0

    const ratio = CROP_SHAPES.find((item) => item.id === shape)?.ratio ?? 0
    let width = drag.w + horizontal
    let height = drag.h + vertical
    if (ratio) {
      // Пропорция зафиксирована — ведём по той стороне, которую тянут.
      if (horizontal !== 0) height = width / ratio
      else if (vertical !== 0) width = height * ratio
    }
    setCropSize(clampCropSize(width, height))
  }

  const onHandleUp = (event: ReactPointerEvent<HTMLSpanElement>) => {
    dragRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* указатель уже отпущен системой */
    }
  }

  /** Отражение применяется к исходнику, чтобы превью и результат совпадали. */
  const flipSource = async (axis: 'horizontal' | 'vertical') => {
    setBusy(true)
    try {
      setImage(await flipImage(image, axis))
    } catch {
      onError('Не удалось отразить изображение.')
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!area) return
    setBusy(true)
    try {
      const cropped = await cropImage(image, area, rotation)
      // Круглая маска накладывается до всего остального: чек переводит знак в
      // один бит и заливает прозрачное белым — иначе вокруг круга на ленте
      // остался бы чёрный квадрат.
      const masked = await applyShapeMask(cropped, shape === 'circle' ? 'circle' : 'square')
      // Проверка до применения, а не после: предупреждение имеет смысл, пока
      // обрезку ещё можно поправить, не начиная всё заново.
      //
      // Первое нажатие показывает предупреждение, второе — применяет. Это
      // предупреждение, а не запрет: бывает, что код не читается из-за
      // качества снимка, а не из-за обрезки, и запирать человека в редакторе
      // из-за нашей неуверенности нельзя.
      const warning = validate ? await validate(masked) : ''
      if (warning && !notice) {
        setNotice(warning)
        return
      }
      await onApply({ image: masked, shape: shape === 'circle' ? 'circle' : 'square' })
      onClose()
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Не удалось обрезать картинку.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Убрать белый фон.
   *
   * Применяется к исходнику, а не к результату: дальше картинку ещё обрезают и
   * масштабируют, и прозрачность должна дожить до конца, а не появиться после.
   * Повторное нажатие берёт уже обработанное изображение — так порог можно
   * «дожать», если с первого раза остался сероватый ореол.
   */
  const dropWhite = async () => {
    setBusy(true)
    setNotice('')
    try {
      setImage(await removeWhiteBackground(image))
    } catch {
      onError('Не удалось убрать фон у этой картинки.')
    } finally {
      setBusy(false)
    }
  }

  /** Автообрезка полей. У QR — по меткам кода, у логотипа — по однотонным краям. */
  const runAutoTrim = async () => {
    setBusy(true)
    setNotice('')
    try {
      const trimmed = await autoTrim(image)
      if (!trimmed) {
        setNotice(autoTrimEmptyNote)
        return
      }
      setImage(trimmed)
      setCrop({ x: 0, y: 0 })
      setZoom(1)
      setRotation(0)
      applyShape(shape)
    } catch {
      onError('Не удалось обрезать поля автоматически.')
    } finally {
      setBusy(false)
    }
  }

  /** Масштаб числом: ползунок хорош для грубой наводки, поле — для точной. */
  const setZoomPercent = (percent: number) => {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(percent)))
    setZoom(clamped / 100)
  }

  const frameStyle = useMemo(
    () => ({ width: `${cropSize.width}px`, height: `${cropSize.height}px` }),
    [cropSize],
  )

  return (
    /*
      Через портал в body: модалка живёт внутри прокручиваемого тела мастера,
      а у прокручиваемых контейнеров легко появляется свой контекст наложения.
      Тогда «поверх всего» перестаёт быть поверх всего — окно обрезается или
      уезжает под содержимое. В body таких соседей нет.
    */
    <ModalPortal>
    <div className="ls-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ls-modal__panel">
        <header className="ls-modal__head">
          <strong>{title}</strong>
          <button type="button" className="ls-icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </header>

        {/* Прокручивается только середина: шапка и подвал с «Применить»
            остаются на виду при любой высоте экрана. */}
        <div className="ls-modal__body">
        <div className="ls-aspects" role="group" aria-label="Форма обрезки">
          {CROP_SHAPES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ls-chip${shape === item.id ? ' is-active' : ''}`}
              onClick={() => applyShape(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="ls-stage" ref={stageRef}>
          <Cropper
            image={image}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            cropSize={cropSize}
            cropShape={shape === 'circle' ? 'round' : 'rect'}
            showGrid={shape !== 'circle'}
            restrictPosition={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={(_area, pixels) => setArea(pixels)}
          />
          {/* Рамка рисуется поверх: react-easy-crop своих ручек не даёт. */}
          <div
            className={`ls-frame${shape === 'circle' ? ' ls-frame--round' : ''}`}
            style={frameStyle}
            aria-hidden="true"
          >
            {HANDLES.map((handle) => (
              <span
                key={handle}
                className={`ls-handle ls-handle--${handle}`}
                onPointerDown={onHandleDown(handle)}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
              />
            ))}
          </div>
        </div>

        <div className="ls-controls">
          <label className="ls-slider">
            <span>Масштаб</span>
            <input
              type="range"
              min={ZOOM_MIN / 100}
              max={ZOOM_MAX / 100}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            {/* Числом — потому что ползунком не попасть в «ровно 100%», а
                именно оно чаще всего и нужно. */}
            <span className="ls-zoom">
              <button
                type="button"
                className="ls-zoom__btn"
                onClick={() => setZoomPercent(zoom * 100 - ZOOM_STEP)}
                aria-label="Уменьшить масштаб"
              >
                −
              </button>
              <input
                className="ls-zoom__input"
                type="number"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={ZOOM_STEP}
                value={Math.round(zoom * 100)}
                onChange={(event) => setZoomPercent(Number(event.target.value))}
                aria-label="Масштаб в процентах"
              />
              <span className="ls-zoom__unit">%</span>
              <button
                type="button"
                className="ls-zoom__btn"
                onClick={() => setZoomPercent(zoom * 100 + ZOOM_STEP)}
                aria-label="Увеличить масштаб"
              >
                +
              </button>
            </span>
          </label>
          <div className="ls-tools">
            <button type="button" className="ls-chip" onClick={() => setZoomPercent(100)}>
              100%
            </button>
            <button
              type="button"
              className="ls-chip"
              onClick={() => {
                setZoomPercent(100)
                setCrop({ x: 0, y: 0 })
                applyShape(shape)
              }}
            >
              По размеру
            </button>
            <button
              type="button"
              className="ls-chip ls-chip--action"
              onClick={() => void runAutoTrim()}
              disabled={busy}
            >
              Обрезать поля автоматически
            </button>
            {/* Логотипы часто приносят «на белом листе»: на тёмной шапке из
                такого файла получается белый прямоугольник. */}
            <button
              type="button"
              className="ls-chip ls-chip--action"
              onClick={() => void dropWhite()}
              disabled={busy}
              title="Сделать белый фон прозрачным"
            >
              Убрать белый фон
            </button>
            <button type="button" className="ls-chip" onClick={() => setRotation((r) => (r + 90) % 360)}>
              Повернуть 90°
            </button>
            <button type="button" className="ls-chip" onClick={() => void flipSource('horizontal')}>
              Отразить ↔
            </button>
            <button type="button" className="ls-chip" onClick={() => void flipSource('vertical')}>
              Отразить ↕
            </button>
            <button
              type="button"
              className="ls-chip"
              onClick={() => {
                setImage(source)
                setCrop({ x: 0, y: 0 })
                setZoom(1)
                setRotation(0)
                applyShape(initialShape)
              }}
            >
              Сбросить
            </button>
          </div>
        </div>

        {/* Предпросмотр ровно там, где картинка будет работать: в макете шапки
            или на ленте. Картинка «на белом фоне» об этом ничего не говорит. */}
        {renderPreview && preview && <div className="ls-result">{renderPreview(preview)}</div>}

        {/* Предупреждение, а не запрет: обрезка может быть осознанной, и
            последнее слово остаётся за человеком — кнопка «Применить» рядом
            и работает. */}
        {notice && (
          <p className="ls-notice" role="alert">
            {notice}
          </p>
        )}
        </div>

        <footer className="ls-modal__foot">
          <button type="button" className="ls-btn ls-btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="ls-btn ls-btn--primary"
            onClick={() => void apply()}
            disabled={!area || busy}
          >
            {busy ? 'Готовим файлы…' : notice ? 'Применить всё равно' : 'Применить'}
          </button>
        </footer>
      </div>
    </div>
    </ModalPortal>
  )
}
