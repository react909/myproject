import { useCallback, useEffect, useState } from 'react'
import { ModalPortal } from '../components/ModalPortal'
import { formatMoney } from './mockProducts'
import type { Product } from './mockProducts'
import './FlavorSelectModal.css'

type Props = {
  products: Product[]
  barcode: string
  onPick: (product: Product) => void
  onClose: () => void
}

export function FlavorSelectModal({ products, barcode, onPick, onClose }: Props) {
  const [idx, setIdx] = useState(0)
  const current = products[idx]

  const move = useCallback(
    (delta: number) => {
      setIdx((i) => {
        const next = i + delta
        if (next < 0) return products.length - 1
        if (next >= products.length) return 0
        return next
      })
    },
    [products.length],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        move(-1)
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        move(1)
        return
      }
      if (e.key === 'Enter' && current) {
        e.preventDefault()
        onPick(current)
        return
      }
      const num = Number.parseInt(e.key, 10)
      if (num >= 1 && num <= products.length) {
        e.preventDefault()
        onPick(products[num - 1]!)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [move, onClose, onPick, current, products])

  if (!current) return null

  return (
    <ModalPortal>
      <div className="flavor-overlay" role="dialog" aria-modal="true" onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}>
        <div className="flavor-modal">
          <header className="flavor-modal__head">
            <h2>Выберите вкус</h2>
            <p>Штрихкод: {barcode}</p>
            <button type="button" className="flavor-modal__close" onClick={onClose}>×</button>
          </header>

          <div className="flavor-modal__card">
            <div className="flavor-modal__img">
              {current.image ? (
                <img src={current.image} alt="" />
              ) : (
                <span>Нет фото</span>
              )}
            </div>
            <div className="flavor-modal__body">
              <h3>{current.name}</h3>
              <p className="flavor-modal__price">{formatMoney(current.price)} сом</p>
              <p className="flavor-modal__hint">
                ← → или ↑ ↓ · Enter — добавить · {idx + 1} / {products.length}
              </p>
            </div>
          </div>

          <div className="flavor-modal__list">
            {products.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className={`flavor-modal__item${i === idx ? ' is-active' : ''}`}
                onClick={() => setIdx(i)}
                onDoubleClick={() => onPick(p)}
              >
                {p.name}
              </button>
            ))}
          </div>

          <footer className="flavor-modal__foot">
            <button type="button" className="flavor-modal__btn flavor-modal__btn--ghost" onClick={onClose}>
              Отмена
            </button>
            <button
              type="button"
              className="flavor-modal__btn flavor-modal__btn--primary"
              onClick={() => onPick(current)}
            >
              Добавить · Enter
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  )
}
