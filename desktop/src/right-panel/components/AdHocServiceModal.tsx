import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { parseMoneyInput, roundMoney2 } from '../helpers'
import './AdHocServiceModal.css'

type Props = {
  onConfirm: (name: string, price: number) => void
  onClose: () => void
}

export const AdHocServiceModal = memo(function AdHocServiceModal({
  onConfirm,
  onClose,
}: Props) {
  const [name, setName] = useState('')
  const [priceRaw, setPriceRaw] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const price = parseMoneyInput(priceRaw)
  const canSubmit = name.trim().length > 0 && price > 0

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return
    onConfirm(name.trim(), roundMoney2(price))
  }, [canSubmit, name, onConfirm, price])

  return (
    <div className="adhoc-modal" role="dialog" aria-modal="true" aria-labelledby="adhoc-title">
      <button type="button" className="adhoc-modal__backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="adhoc-modal__card">
        <h2 id="adhoc-title" className="adhoc-modal__title">Доп. услуга</h2>
        <p className="adhoc-modal__hint">
          Доставка, помощь с погрузкой и т.п. — строка в чеке без товара из каталога.
        </p>

        <label className="adhoc-modal__field">
          <span>Название</span>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например: Доставка"
            maxLength={120}
          />
        </label>

        <label className="adhoc-modal__field">
          <span>Сумма, сом</span>
          <input
            type="text"
            inputMode="decimal"
            value={priceRaw}
            onChange={(e) => setPriceRaw(e.target.value)}
            placeholder="0.00"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
            }}
          />
        </label>

        <div className="adhoc-modal__actions">
          <button type="button" className="adhoc-modal__btn adhoc-modal__btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="adhoc-modal__btn adhoc-modal__btn--primary"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Добавить в чек
          </button>
        </div>
      </div>
    </div>
  )
})
