import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
} from 'react'
import type { Product } from './mockProducts'
import { formatMoney } from './mockProducts'
import type { LiveScaleReading } from '../hooks/useLiveScale'
import {
  formatScaleKgInput,
  pickScaleKg,
  requestScaleSnapshot,
} from '../services/devices/scaleSnapshot'
import './WeightInputModal.css'

/* ─── Types ──────────────────────────────────────────────────────── */

type WeightStatus = 'stable' | 'measuring' | 'error'

type WeightInputModalProps = {
  product: Product
  /** Зафиксированный с шапки вес (кг) для подстановки в поле */
  presetKg?: number | null
  scaleConnected?: boolean
  scaleReading: LiveScaleReading
  onConfirm: (product: Product, weight: number) => void
  onClose: () => void
}

/* ─── Constants ──────────────────────────────────────────────────── */

const QUICK_WEIGHTS = [0.1, 0.5, 1.0, 2.0] as const

const NUMPAD_KEYS = [
  '7', '8', '9',
  '4', '5', '6',
  '1', '2', '3',
  '.', '0', 'bs',
] as const

type NumpadKey = typeof NUMPAD_KEYS[number]

/* ─── Icons ──────────────────────────────────────────────────────── */

function IconClose() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function IconBackspace() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 7H9L3 12L9 17H20V7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M13 10.5L17 14.5M17 10.5L13 14.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconScale() {
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path
        d="M9 10A5 5 0 0 1 19 10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M7 12h14l2.4 10A2 2 0 0 1 21.5 24H6.5A2 2 0 0 1 4.6 22L7 12Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="17" r="1.5" fill="currentColor" />
      <path d="M14 5V3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function IconConfirm() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4 10.5L8 14.5L16 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/* ─── Status Indicator ───────────────────────────────────────────── */

function StatusIndicator({ status }: { status: WeightStatus }) {
  const config = {
    stable:    { label: 'СТАБИЛЬНО', mod: 'stable' },
    measuring: { label: 'ИЗМЕРЕНИЕ', mod: 'measuring' },
    error:     { label: 'ОШИБКА', mod: 'error' },
  } as const

  const { label, mod } = config[status]

  return (
    <div className={`wm-status wm-status--${mod}`}>
      <span className="wm-status__dot" />
      <span className="wm-status__text">{label}</span>
    </div>
  )
}

/* ─── Main Modal ─────────────────────────────────────────────────── */

export function WeightInputModal({
  product,
  presetKg,
  scaleConnected = false,
  scaleReading: liveScale,
  onConfirm,
  onClose,
}: WeightInputModalProps) {
  const [rawInput, setRawInput] = useState(() =>
    formatScaleKgInput(pickScaleKg(liveScale, presetKg)),
  )
  const [status, setStatus] = useState<WeightStatus>(() => {
    const seed = pickScaleKg(liveScale, presetKg)
    return seed != null ? (liveScale.stable ? 'stable' : 'measuring') : 'measuring'
  })
  const [confirmPressed, setConfirmPressed] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const userEditedRef = useRef(false)
  const liveKg = pickScaleKg(liveScale, presetKg)

  useLayoutEffect(() => {
    userEditedRef.current = false
    setConfirmPressed(false)
    const seed = pickScaleKg(liveScale, presetKg)
    setRawInput(formatScaleKgInput(seed))
    setStatus(
      seed != null
        ? liveScale.stable || scaleConnected
          ? 'stable'
          : 'measuring'
        : 'measuring',
    )
    wrapRef.current?.focus()

    void requestScaleSnapshot().then((snapshot) => {
      if (userEditedRef.current) return
      const next = pickScaleKg(snapshot, presetKg)
      if (next == null) {
        setRawInput('')
        setStatus('measuring')
        return
      }
      setRawInput(formatScaleKgInput(next))
      setStatus(snapshot.stable || snapshot.connected || scaleConnected ? 'stable' : 'measuring')
    })
  }, [product.id])

  useEffect(() => {
    if (userEditedRef.current) return
    if (liveKg != null && liveKg > 0) {
      setRawInput(formatScaleKgInput(liveKg))
      setStatus(liveScale.stable || scaleConnected ? 'stable' : 'measuring')
    } else {
      setRawInput('')
      setStatus('measuring')
    }
  }, [liveKg, liveScale.stable, scaleConnected])

  const parsedWeight = parseFloat(rawInput) || 0
  const isValid = parsedWeight > 0
  const totalPrice = parsedWeight * product.price

  /* Numpad handler */
  const handleKey = useCallback((key: NumpadKey) => {
    userEditedRef.current = true
    setStatus('stable')
    setRawInput((prev) => {
      if (key === 'bs') return prev.slice(0, -1)
      if (key === '.') {
        if (prev.includes('.')) return prev
        return prev === '' ? '0.' : prev + '.'
      }
      const next = prev + key
      const parts = next.split('.')
      if (parts[1] !== undefined && parts[1].length > 3) return prev
      return next
    })
  }, [])

  /* Quick weight */
  const handleQuick = useCallback((w: number) => {
    userEditedRef.current = true
    setRawInput(w.toFixed(3))
    setStatus('stable')
  }, [])

  /* Confirm */
  const handleConfirm = useCallback(() => {
    if (!isValid) return
    setConfirmPressed(true)
    setTimeout(() => {
      onConfirm(product, parsedWeight)
    }, 180)
  }, [isValid, onConfirm, parsedWeight, product])

  /* Keyboard */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') { handleConfirm(); return }
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'Backspace') { handleKey('bs'); return }
      if (e.key === '.') { handleKey('.'); return }
      if (/^[0-9]$/.test(e.key)) { handleKey(e.key as NumpadKey); return }
    },
    [handleConfirm, handleKey, onClose],
  )

  /* Display value */
  const displayInt = rawInput.split('.')[0] || '0'
  const displayDec = rawInput.includes('.') ? '.' + (rawInput.split('.')[1] ?? '') : ''

  return (
    <div className="wm-overlay" role="dialog" aria-modal="true" aria-label="Ввод веса">
      <div
        ref={wrapRef}
        className={`wm-modal${confirmPressed ? ' wm-modal--confirm' : ''}`}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {/* ── Header ── */}
        <div className="wm-header">
          <div className="wm-header__left">
            {product.image ? (
              <img src={product.image} alt="" className="wm-product-img" />
            ) : (
              <div className="wm-header__icon">
                <IconScale />
              </div>
            )}
            <div className="wm-header__text">
              <span className="wm-header__title">{product.name}</span>
              <span className="wm-header__sub">
                {formatMoney(product.price)}&nbsp;сом&nbsp;/&nbsp;кг
              </span>
            </div>
          </div>
          <button
            className="wm-close"
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <IconClose />
          </button>
        </div>

        {/* ── Display ── */}
        <div className="wm-display">
          <div className="wm-display__inner">
            <div className="wm-display__top">
              <div className="wm-display__weight">
                <span className="wm-display__int">{displayInt}</span>
                {displayDec && (
                  <span className="wm-display__dec">{displayDec}</span>
                )}
                <span className="wm-display__unit">кг</span>
              </div>
              <StatusIndicator status={status} />
            </div>

            <p className="wm-display__scale-hint">
              {liveScale.connected || scaleConnected
                ? 'Весы подключены — можно с весов или вручную'
                : 'Весы не подключены — введите вес кнопками'}
            </p>

            <div className="wm-display__total">
              <span className="wm-display__total-label">К оплате</span>
              <span className="wm-display__total-value">
                {parsedWeight > 0 ? `${formatMoney(totalPrice)} сом` : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Numpad ── */}
        <div className="wm-numpad">
          {NUMPAD_KEYS.map((key) => (
            <NumpadButton key={key} value={key} onClick={handleKey} />
          ))}
        </div>

        {/* ── Quick weights ── */}
        <div className="wm-quick">
          <span className="wm-quick__label">Быстрый ввод</span>
          <div className="wm-quick__row">
            {QUICK_WEIGHTS.map((w) => (
              <button
                key={w}
                type="button"
                className="wm-quick__btn"
                onClick={() => handleQuick(w)}
                tabIndex={-1}
              >
                {w % 1 === 0 ? `${w} кг` : `${w} кг`}
              </button>
            ))}
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="wm-actions">
          <button
            type="button"
            className="wm-actions__cancel"
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            type="button"
            className={`wm-actions__confirm${!isValid ? ' is-disabled' : ''}`}
            onClick={handleConfirm}
            disabled={!isValid}
          >
            <span className="wm-actions__confirm-icon">
              <IconConfirm />
            </span>
            <span>
              {isValid
                ? `Добавить · ${parsedWeight.toFixed(3)} кг`
                : 'Введите вес'}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Numpad Button ──────────────────────────────────────────────── */

type NumpadButtonProps = {
  value: NumpadKey
  onClick: (key: NumpadKey) => void
}

function NumpadButton({ value, onClick }: NumpadButtonProps) {
  const [pressed, setPressed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handlePress() {
    setPressed(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setPressed(false), 150)
    onClick(value)
  }

  const isBackspace = value === 'bs'
  const isDot = value === '.'

  return (
    <button
      type="button"
      className={[
        'wm-key',
        isBackspace ? 'wm-key--bs' : '',
        isDot ? 'wm-key--dot' : '',
        pressed ? 'wm-key--pressed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handlePress}
      aria-label={isBackspace ? 'Удалить' : value}
      tabIndex={-1}
    >
      {isBackspace ? <IconBackspace /> : value}
    </button>
  )
}