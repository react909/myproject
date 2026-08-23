/**
 * Координаты точки расчётов.
 *
 * Широта и долгота — не поле для набора цифр: их никто не помнит и почти
 * никто не умеет искать. Поэтому основной путь здесь — кнопка «Определить по
 * адресу» и метка на карте, а ручной ввод спрятан и остаётся запасным.
 *
 * Приложение офлайновое, и это учтено: геокодер и тайлы карты нужны только в
 * момент настройки. Без сети кнопка честно говорит, что интернета нет, карта
 * превращается в координатную сетку, а метка продолжает работать — её позиция
 * считается проекцией Меркатора, а не картинками.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { mapCenterForCountry } from './dictionaries'
import { normalizeCoordinate } from './fields'
import { formatOutletAddress } from './types'
import type { OnboardingData, OutletData } from './types'
import './OutletGeoPicker.css'

const TILE = 256
const MIN_ZOOM = 4
const MAX_ZOOM = 18
const VIEW_HEIGHT = 240

/* --- Проекция Меркатора: мировые пиксели ↔ градусы ------------------------ */

function lonToWorldX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * TILE * 2 ** zoom
}

function latToWorldY(lat: number, zoom: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const rad = (clamped * Math.PI) / 180
  const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2
  return y * TILE * 2 ** zoom
}

function worldXToLon(x: number, zoom: number): number {
  return (x / (TILE * 2 ** zoom)) * 360 - 180
}

function worldYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** zoom)
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

/** Координата в чек и в базу уходит строкой — округляем на входе, а не при печати. */
function toFixedCoord(value: number): string {
  return value.toFixed(5)
}

/** Найденное место из геокодера — строка списка подсказок. */
type GeoSuggestion = { label: string; lat: number; lon: number }

/**
 * Сколько ждать после последней набранной буквы перед запросом подсказок.
 *
 * Nominatim просит не чаще одного запроса в секунду, и это не рекомендация:
 * за превышение блокируют по адресу. Пауза плюс минимальная длина строки
 * держат нас в рамках и заодно не гоняют сеть на каждую букву.
 */
const SUGGEST_DELAY_MS = 450
const SUGGEST_MIN_LENGTH = 3

type Props = {
  data: OnboardingData
  onChange: (patch: Partial<OutletData>) => void
  /** Ошибка от реестра полей — показываем её же, отдельного текста не заводим. */
  error?: string
}

export function OutletGeoPicker({ data, onChange, error }: Props) {
  const { outlet, business } = data
  const [zoom, setZoom] = useState(15)
  const [manual, setManual] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [tilesBroken, setTilesBroken] = useState(false)
  const [viewWidth, setViewWidth] = useState(560)

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  /**
   * Протяжка карты. Хранит точку захвата и центр на момент начала — так
   * карта едет ровно за пальцем, без накопления ошибки от кадра к кадру.
   *
   * `moved` отличает протяжку от нажатия: раньше любое касание карты сразу
   * переставляло метку, и пролистать карту было физически нельзя.
   */
  const panRef = useRef<{ x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null)
  const [panning, setPanning] = useState(false)

  /* --- Поиск места по названию ------------------------------------------- */

  const [search, setSearch] = useState('')
  const [suggestions, setSuggestions] = useState<GeoSuggestion[]>([])
  const [searching, setSearching] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)

  const lat = Number(outlet.lat)
  const lon = Number(outlet.lon)
  const hasPoint = outlet.lat.trim() !== '' && outlet.lon.trim() !== '' &&
    Number.isFinite(lat) && Number.isFinite(lon)

  const fallback = mapCenterForCountry(business.country)
  // Карта центрируется на метке, пока её не перетащили: центр — состояние,
  // чтобы метку можно было увести к краю и она там осталась.
  const [center, setCenter] = useState(() =>
    hasPoint ? { lat, lon } : fallback,
  )

  useEffect(() => {
    const element = viewportRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      setViewWidth(Math.max(240, Math.round(entry.contentRect.width)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  /** Левый верхний угол видимой области в мировых пикселях. */
  const origin = useMemo(
    () => ({
      x: lonToWorldX(center.lon, zoom) - viewWidth / 2,
      y: latToWorldY(center.lat, zoom) - VIEW_HEIGHT / 2,
    }),
    [center, zoom, viewWidth],
  )

  const marker = useMemo(() => {
    if (!hasPoint) return null
    return {
      x: lonToWorldX(lon, zoom) - origin.x,
      y: latToWorldY(lat, zoom) - origin.y,
    }
  }, [hasPoint, lat, lon, zoom, origin])

  const tiles = useMemo(() => {
    const count = 2 ** zoom
    const firstX = Math.floor(origin.x / TILE)
    const firstY = Math.floor(origin.y / TILE)
    const lastX = Math.floor((origin.x + viewWidth) / TILE)
    const lastY = Math.floor((origin.y + VIEW_HEIGHT) / TILE)
    const result: { key: string; url: string; left: number; top: number }[] = []
    for (let ty = firstY; ty <= lastY; ty += 1) {
      if (ty < 0 || ty >= count) continue
      for (let tx = firstX; tx <= lastX; tx += 1) {
        // По горизонтали мир замкнут — берём остаток, чтобы не было пустот.
        const wrapped = ((tx % count) + count) % count
        result.push({
          key: `${zoom}/${tx}/${ty}`,
          url: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${ty}.png`,
          left: tx * TILE - origin.x,
          top: ty * TILE - origin.y,
        })
      }
    }
    return result
  }, [origin, zoom, viewWidth])

  /** Ставит метку в точку внутри видимой области. */
  const setPointFromPixel = useCallback(
    (px: number, py: number) => {
      const nextLon = worldXToLon(origin.x + px, zoom)
      const nextLat = worldYToLat(origin.y + py, zoom)
      onChange({ lat: toFixedCoord(nextLat), lon: toFixedCoord(nextLon) })
    },
    [origin, zoom, onChange],
  )

  const pointerToPixel = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  /**
   * Нажатие на карту начинает протяжку, а не ставит метку.
   *
   * Метка ставится только если палец не поехал — то есть это было именно
   * нажатие, а не перетаскивание. Раньше любое касание сразу переставляло
   * метку, и пролистать карту было нельзя вовсе: она «прыгала» под пальцем.
   */
  const onViewportPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = pointerToPixel(event)
    if (!point) return
    setStatus('')
    setSuggestOpen(false)
    panRef.current = {
      x: event.clientX,
      y: event.clientY,
      originX: origin.x,
      originY: origin.y,
      moved: false,
    }
    setPanning(true)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* захват указателя не поддержан — протяжка всё равно работает */
    }
  }

  const onViewportPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    if (!pan) return
    const dx = event.clientX - pan.x
    const dy = event.clientY - pan.y
    // Порог в 4 пикселя: дрожание пальца на сенсорном экране не должно
    // превращать нажатие в протяжку и наоборот.
    if (!pan.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return
    pan.moved = true
    // Центр считается от исходного, а не от текущего: иначе ошибка
    // накапливалась бы за кадры и карта уезжала быстрее пальца.
    const nextX = pan.originX - dx + viewWidth / 2
    const nextY = pan.originY - dy + VIEW_HEIGHT / 2
    setCenter({ lat: worldYToLat(nextY, zoom), lon: worldXToLon(nextX, zoom) })
  }

  const onViewportPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    panRef.current = null
    setPanning(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* указатель уже отпущен системой */
    }
    if (!pan || pan.moved) return
    const point = pointerToPixel(event)
    if (point) setPointFromPixel(point.x, point.y)
  }

  /**
   * Зум колесом — к точке под курсором, а не к центру.
   *
   * Зум к центру означает, что после каждого щелчка колеса нужное место
   * уезжает и его приходится доводить протяжкой. Здесь точка под курсором
   * остаётся на месте, как в любой нормальной карте.
   */
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const step = event.deltaY < 0 ? 1 : -1
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + step))
    if (nextZoom === zoom) return

    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    // Географическая точка под курсором до зума — она же должна остаться под
    // ним и после.
    const anchorLon = worldXToLon(origin.x + px, zoom)
    const anchorLat = worldYToLat(origin.y + py, zoom)

    const anchorX = lonToWorldX(anchorLon, nextZoom)
    const anchorY = latToWorldY(anchorLat, nextZoom)
    const nextCenterX = anchorX - px + viewWidth / 2
    const nextCenterY = anchorY - py + VIEW_HEIGHT / 2

    setZoom(nextZoom)
    setCenter({ lat: worldYToLat(nextCenterY, nextZoom), lon: worldXToLon(nextCenterX, nextZoom) })
  }

  const onMarkerPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    draggingRef.current = true
  }

  const onMarkerPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) return
    const point = pointerToPixel(event)
    if (!point) return
    setPointFromPixel(point.x, point.y)
  }

  const endMarkerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* указатель уже отпущен системой */
    }
  }

  const query = useMemo(() => {
    const address = formatOutletAddress(outlet)
    return [address, business.country].filter(Boolean).join(', ')
  }, [outlet, business.country])

  const locate = async () => {
    if (!formatOutletAddress(outlet).trim()) {
      setStatus('Сначала заполните адрес — по нему и ищем.')
      return
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus('Нет интернета. Поставьте метку на карте или введите координаты вручную.')
      return
    }

    setBusy(true)
    setStatus('')
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`
      const response = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const found = (await response.json()) as { lat?: string; lon?: string; display_name?: string }[]
      const first = found?.[0]
      if (!first?.lat || !first?.lon) {
        setStatus('По этому адресу ничего не нашлось. Поставьте метку на карте.')
        return
      }
      const nextLat = Number(first.lat)
      const nextLon = Number(first.lon)
      onChange({ lat: toFixedCoord(nextLat), lon: toFixedCoord(nextLon) })
      setCenter({ lat: nextLat, lon: nextLon })
      setZoom(17)
      setStatus(first.display_name ? `Найдено: ${first.display_name}` : 'Координаты определены.')
    } catch {
      setStatus('Геокодер недоступен. Поставьте метку на карте или введите координаты вручную.')
    } finally {
      setBusy(false)
    }
  }

  const recenter = () => {
    if (!hasPoint) return
    setCenter({ lat, lon })
  }

  /* Подсказки по названию: набрали «Вефа» — получили список мест, а не
     требование знать точный адрес. Запрос с паузой, см. SUGGEST_DELAY_MS. */
  useEffect(() => {
    const text = search.trim()
    if (text.length < SUGGEST_MIN_LENGTH) {
      setSuggestions([])
      return undefined
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSuggestions([])
      return undefined
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setSearching(true)
      const scoped = [text, business.country].filter(Boolean).join(', ')
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(scoped)}`
      void fetch(url, { headers: { Accept: 'application/json' } })
        .then((response) => (response.ok ? response.json() : []))
        .then((rows: { lat?: string; lon?: string; display_name?: string }[]) => {
          if (cancelled) return
          const parsed = (Array.isArray(rows) ? rows : [])
            .map((row) => ({
              label: row.display_name ?? '',
              lat: Number(row.lat),
              lon: Number(row.lon),
            }))
            .filter((row) => row.label && Number.isFinite(row.lat) && Number.isFinite(row.lon))
          setSuggestions(parsed)
          setSuggestOpen(parsed.length > 0)
        })
        .catch(() => {
          if (!cancelled) setSuggestions([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, SUGGEST_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [search, business.country])

  /** Выбор подсказки: ставит метку, центрирует карту и приближает. */
  const pickSuggestion = (item: GeoSuggestion) => {
    onChange({ lat: toFixedCoord(item.lat), lon: toFixedCoord(item.lon) })
    setCenter({ lat: item.lat, lon: item.lon })
    setZoom(17)
    setSearch(item.label)
    setSuggestOpen(false)
    setStatus(`Выбрано: ${item.label}`)
  }

  return (
    <div className="geo">
      <div className="geo__head">
        <span className="ob-label">
          Координаты точки
          <b aria-hidden="true"> *</b>
        </span>
        <div className="geo__actions">
          <button type="button" className="geo__btn geo__btn--primary" onClick={() => void locate()} disabled={busy}>
            {busy ? 'Определяем…' : 'Определить по адресу'}
          </button>
          <button type="button" className="geo__btn" onClick={() => setManual((value) => !value)}>
            {manual ? 'Скрыть ручной ввод' : 'Ввести вручную'}
          </button>
        </div>
      </div>

      {/*
        Поиск по названию. Адрес целиком помнят не все, а «Вефа» или
        «Ошский рынок» — помнят все. Подсказки приходят из того же геокодера,
        что и кнопка «Определить по адресу».
      */}
      <div className="geo__search">
        <input
          className="ob-control geo__search-input"
          value={search}
          placeholder="Найти место: «Вефа центр», «ул. Киевская 148»"
          spellCheck={false}
          onChange={(event) => setSearch(event.target.value)}
          onFocus={() => suggestions.length > 0 && setSuggestOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSuggestOpen(false)
            if (event.key === 'Enter') {
              event.preventDefault()
              if (suggestions[0]) pickSuggestion(suggestions[0])
            }
          }}
        />
        {searching && <span className="geo__search-busy">Ищем…</span>}

        {suggestOpen && suggestions.length > 0 && (
          <ul className="geo__suggest">
            {suggestions.map((item) => (
              <li key={`${item.lat},${item.lon}`}>
                <button type="button" onClick={() => pickSuggestion(item)}>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        ref={viewportRef}
        className={`geo__map${tilesBroken ? ' is-offline' : ''}${panning ? ' is-panning' : ''}`}
        style={{ height: VIEW_HEIGHT }}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={onViewportPointerUp}
        onPointerCancel={onViewportPointerUp}
        onWheel={onWheel}
      >
        {!tilesBroken &&
          tiles.map((tile) => (
            <img
              key={tile.key}
              className="geo__tile"
              src={tile.url}
              alt=""
              draggable={false}
              style={{ left: tile.left, top: tile.top }}
              onError={() => setTilesBroken(true)}
            />
          ))}

        {marker && (
          <button
            type="button"
            className="geo__marker"
            style={{ left: marker.x, top: marker.y }}
            aria-label="Метка точки расчётов — перетащите на нужное место"
            onPointerDown={onMarkerPointerDown}
            onPointerMove={onMarkerPointerMove}
            onPointerUp={endMarkerDrag}
            onPointerCancel={endMarkerDrag}
          >
            <i />
          </button>
        )}

        {!marker && (
          <p className="geo__empty">
            Найдите место в поиске выше, нажмите «Определить по адресу» или коснитесь карты, чтобы
            поставить метку. Карту можно тянуть мышью, масштаб — колесом.
          </p>
        )}

        {/* Масштаб лежит поверх карты, поэтому гасим всплытие: иначе нажатие
            на «+» сначала переставило бы метку под палец. */}
        <div className="geo__zoom" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 1))} aria-label="Приблизить">
            +
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 1))} aria-label="Отдалить">
            −
          </button>
          <button type="button" onClick={recenter} disabled={!hasPoint} aria-label="К метке">
            ⌖
          </button>
        </div>

        {tilesBroken && (
          <p className="geo__offline-note">
            Карта не загрузилась — работаем без неё. Метка и координаты по-прежнему точные.
          </p>
        )}
      </div>

      <div className="geo__readout">
        <span>{hasPoint ? `${outlet.lat}, ${outlet.lon}` : 'Координаты не заданы'}</span>
        {hasPoint && (
          <button type="button" className="geo__link" onClick={() => onChange({ lat: '', lon: '' })}>
            Сбросить
          </button>
        )}
      </div>

      {manual && (
        <div className="geo__manual">
          <label className="ob-field">
            <span className="ob-label">Широта</span>
            <input
              className="ob-control"
              inputMode="decimal"
              value={outlet.lat}
              placeholder="42.86622"
              onChange={(event) => onChange({ lat: normalizeCoordinate(event.target.value) })}
            />
          </label>
          <label className="ob-field">
            <span className="ob-label">Долгота</span>
            <input
              className="ob-control"
              inputMode="decimal"
              value={outlet.lon}
              placeholder="74.56862"
              onChange={(event) => onChange({ lon: normalizeCoordinate(event.target.value) })}
            />
          </label>
        </div>
      )}

      {error ? (
        <small className="ob-hint is-invalid">{error}</small>
      ) : status ? (
        <small className="ob-hint">{status}</small>
      ) : (
        <small className="ob-hint">
          Координаты печатаются в фискальном чеке. Определяются по адресу, метку можно поправить вручную.
        </small>
      )}
    </div>
  )
}
