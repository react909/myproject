import { useState, useCallback } from 'react'
import type { Product } from '../mockProducts'
import { formatMoney, getProductStockLabel } from '../mockProducts'
import './ProductCard.css'

type ProductCardProps = {
  product: Product
  onAdd: (product: Product) => void
}

function IconWeight() {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4 4.3A2 2 0 0 1 8 4.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M3.3 5.3h5.4l1.1 4.5A1 1 0 0 1 8.8 11H3.2A1 1 0 0 1 2.2 9.8l1.1-4.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="6" cy="7.5" r="0.7" fill="currentColor" />
    </svg>
  )
}

function IconPiece() {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1.5L10 3.8L6 6.1L2 3.8L6 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M10 3.8v4L6 10.3l-4-2.5v-4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M6 6.1v4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function IconNoImage() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="6" y="10" width="28" height="20" rx="3" stroke="#d1d5db" strokeWidth="1.5" />
      <circle cx="14" cy="16" r="2.5" stroke="#d1d5db" strokeWidth="1.5" />
      <path d="M6 26l8-6 5 4 4-3 11 7" stroke="#d1d5db" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

export function ProductCard({ product, onAdd }: ProductCardProps) {
  const [flash, setFlash] = useState(false)

  const handleClick = useCallback(() => {
    setFlash(true)
    setTimeout(() => setFlash(false), 400)
    onAdd(product)
  }, [onAdd, product])

  const isWeight = product.type === 'weight'

  return (
    <button
      className={`product-card${flash ? ' product-card--flash' : ''}`}
      type="button"
      onClick={handleClick}
      aria-label={`Добавить ${product.name}, ${formatMoney(product.price)} сом`}
    >
      <div className="product-card__image-wrap">
        {product.image ? (
          <img
            className="product-card__image"
            src={product.image}
            alt={product.name}
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className="product-card__image-placeholder">
            <IconNoImage />
          </div>
        )}
        <span className={`product-card__badge product-card__badge--${product.type}`}>
          {isWeight ? <IconWeight /> : <IconPiece />}
          {isWeight ? 'кг' : 'шт'}
        </span>
      </div>

      <div className="product-card__body">
        <p className="product-card__name">{product.name}</p>
        <div className="product-card__footer">
          <span className="product-card__price">
            {formatMoney(product.price)}&nbsp;сом
            {isWeight && <span className="product-card__per-unit">/кг</span>}
          </span>
          <span className="product-card__stock">{getProductStockLabel(product)}</span>
        </div>
        {product.purchasePrice != null && product.purchasePrice > 0 && (
          <span className="product-card__cost">
            Себестоимость: {formatMoney(product.purchasePrice)} сом
          </span>
        )}
      </div>
    </button>
  )
}