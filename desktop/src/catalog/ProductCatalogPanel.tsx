import {
  memo,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { type Product, formatMoney, getProductStock } from './mockProducts'
import { loadFavoriteProductIds, saveFavoriteProductIds } from './favoritesStorage'
import './ProductCatalogPanel.css'

const CATALOG_PAGE_SIZE = 100

export type DeferredCheckSummary = {
  id: string
  createdAt: string
  positionsCount: number
}

export type ProductFilter = 'weight' | 'piece'
export type CatalogFilter = 'all' | 'weight' | 'piece'

export type ProductCatalogPanelProps = {
  searchQuery: string
  onSearchChange: (value: string) => void
  onAddProduct: (product: Product) => void
  activeInputRef: MutableRefObject<HTMLInputElement | null>
  products?: Product[]
  defaultFilter?: ProductFilter | 'all'
  deferredChecks?: DeferredCheckSummary[]
  onRestoreDeferred?: (checkId: string) => void
  scannerConnected?: boolean
  showAllFilter?: boolean
  largeCards?: boolean
  loading?: boolean
  /** Фоновое обновление каталога — не скрывает уже загруженные товары */
  refreshing?: boolean
  error?: string | null
  onRefresh?: () => void
  /** Режим оптовых цен в каталоге */
  wholesaleMode?: boolean
  onWholesaleModeChange?: (value: boolean) => void
}

function productMatchesQuery(p: Product, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const hay = [p.name, p.barcode, p.sku, p.article]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase()
  return hay.includes(needle)
}

/* ─── Icons ──────────────────────────────────────────────────────── */

function IconSearch() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13 13L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconClear() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function IconWeight() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.3 5.3A2.7 2.7 0 0 1 10.7 5.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4 6.7h8l1.5 6.3A1.2 1.2 0 0 1 12.3 14.5H3.7A1.2 1.2 0 0 1 2.5 13L4 6.7Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="8" cy="10" r="0.9" fill="currentColor" />
    </svg>
  )
}

function IconPiece() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.5L13 4.5L8 7.5L3 4.5L8 1.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M13 4.5v5L8 12.5l-5-3v-5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 7.5v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function IconAll() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function IconEmpty() {
  return (
    <svg viewBox="0 0 56 56" fill="none" aria-hidden="true">
      <rect x="8" y="14" width="40" height="30" rx="5" stroke="#d1d5db" strokeWidth="1.5" />
      <circle cx="20" cy="24" r="3.5" stroke="#d1d5db" strokeWidth="1.5" />
      <path d="M8 34l10-8 7 5 7-4 16 9" stroke="#d1d5db" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function IconNoImage() {
  return (
    <svg viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <rect x="5" y="9" width="34" height="26" rx="4" stroke="#e5e7eb" strokeWidth="1.4" />
      <circle cx="14" cy="18" r="3" stroke="#e5e7eb" strokeWidth="1.4" />
      <path d="M5 28l9-7 6 5 5-3.5 14 9" stroke="#e5e7eb" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function IconStar({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={filled ? 'pcard__star-svg pcard__star-svg--on' : 'pcard__star-svg'}>
      <path
        d="M10 2.5l2.18 4.42 4.88.71-3.53 3.44.83 4.86L10 13.77l-4.36 2.3.83-4.86-3.53-3.44 4.88-.71L10 2.5z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
        fill={filled ? 'currentColor' : 'none'}
      />
    </svg>
  )
}

/* ─── Product Card ───────────────────────────────────────────────── */

type ProductCardProps = {
  product: Product
  onAdd: (product: Product) => void
  isFavorite: boolean
  onToggleFavorite: (productId: string, e: ReactMouseEvent) => void
  compact?: boolean
  wholesaleMode?: boolean
}

const ProductCard = memo(function ProductCard({
  product,
  onAdd,
  isFavorite,
  onToggleFavorite,
  compact = false,
  wholesaleMode = false,
}: ProductCardProps) {
  const [active, setActive] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isWeight = product.type === 'weight'
  const displayPrice =
    wholesaleMode && product.wholesalePrice != null && product.wholesalePrice > 0
      ? product.wholesalePrice
      : product.price

  const stock = getProductStock(product)
  const stockLabel = (() => {
    if (stock === undefined) return '—'
    if (isWeight) return `${stock.toFixed(1)} кг`
    return `${Math.floor(stock)} шт`
  })()

  const handleClick = useCallback(() => {
    setActive(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setActive(false), 380)
    onAdd(product)
  }, [onAdd, product])

  return (
    <div
      className={`pcard${active ? ' pcard--active' : ''}${isFavorite ? ' pcard--fav' : ''}${compact ? ' pcard--compact' : ''}${isWeight ? ' pcard--weight' : ' pcard--piece'}`}
    >
      <span
        className={`pcard__stripe pcard__stripe--${product.type}`}
        aria-hidden
      />
      <div className="pcard__col">
        <div className="pcard__image-wrap">
          <button
            type="button"
            className={`pcard__fav-btn${isFavorite ? ' pcard__fav-btn--on' : ''}`}
            title={isFavorite ? 'Убрать из избранного' : 'В избранное'}
            aria-pressed={isFavorite}
            aria-label={isFavorite ? 'Убрать из избранного' : 'В избранное'}
            onClick={(e) => onToggleFavorite(product.id, e)}
          >
            <IconStar filled={isFavorite} />
          </button>
          <button
            type="button"
            className="pcard__image-hit"
            onClick={handleClick}
            aria-label={`Добавить ${product.name}`}
          />
          {product.image ? (
            <img
              className="pcard__image"
              src={product.image}
              alt=""
              loading="lazy"
              draggable={false}
            />
          ) : (
            <div className="pcard__no-image">
              <IconNoImage />
            </div>
          )}
          <span className={`pcard__type-badge pcard__type-badge--${product.type}`}>
            {isWeight ? <IconWeight /> : <IconPiece />}
          </span>
        </div>

        <button
          type="button"
          className="pcard__add"
          onClick={handleClick}
          aria-label={`Добавить ${product.name}`}
        >
        <div className="pcard__body">
          <p className="pcard__name">{product.name}</p>
          <div className="pcard__meta">
            <span className="pcard__price">
              {formatMoney(displayPrice)}&nbsp;сом
              {wholesaleMode && product.wholesalePrice != null && product.wholesalePrice > 0 ? (
                <span className="pcard__unit pcard__unit--wholesale"> опт</span>
              ) : null}
              {isWeight && <span className="pcard__unit">/кг</span>}
            </span>
            <span className="pcard__stock">{stockLabel}</span>
          </div>
        </div>

        <span className="pcard__ripple" aria-hidden="true" />
      </button>
      </div>
    </div>
  )
})

/* ─── Main Panel ─────────────────────────────────────────────────── */

function ProductCatalogPanelImpl({
  searchQuery,
  onSearchChange,
  onAddProduct,
  activeInputRef,
  products = [],
  defaultFilter = 'piece',
  largeCards = false,
  loading = false,
  refreshing = false,
  error = null,
  onRefresh,
  wholesaleMode = false,
  onWholesaleModeChange,
}: ProductCatalogPanelProps) {
  const initialFilter: CatalogFilter =
    defaultFilter === 'weight' ? 'weight' : defaultFilter === 'all' ? 'all' : 'piece'
  const [filter, setFilter] = useState<CatalogFilter>(initialFilter)
  const [favoriteIds, setFavoriteIds] = useState(() => new Set(loadFavoriteProductIds()))
  const [page, setPage] = useState(1)
  const inputRef = useRef<HTMLInputElement>(null)

  const toggleFavorite = useCallback((id: string, e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setFavoriteIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveFavoriteProductIds(next)
      return next
    })
  }, [])

  const counts = useMemo<Record<CatalogFilter, number>>(() => {
    let weight = 0
    let piece = 0
    for (const p of products) {
      if (p.type === 'weight') weight++
      else piece++
    }
    return { all: weight + piece, weight, piece }
  }, [products])

  const filteredProducts = useMemo(() => {
    return products.filter(
      (p) => (filter === 'all' || p.type === filter) && productMatchesQuery(p, searchQuery),
    )
  }, [filter, products, searchQuery])

  const favoriteStripProducts = useMemo(() => {
    return filteredProducts.filter((p) => favoriteIds.has(p.id))
  }, [filteredProducts, favoriteIds])

  const gridProducts = useMemo(() => {
    const inStrip = new Set(favoriteStripProducts.map((p) => p.id))
    return filteredProducts.filter((p) => !inStrip.has(p.id))
  }, [filteredProducts, favoriteStripProducts])
  const totalPages = Math.max(1, Math.ceil(gridProducts.length / CATALOG_PAGE_SIZE))
  const visibleGridProducts = useMemo(() => {
    const safePage = Math.min(page, totalPages)
    const start = (safePage - 1) * CATALOG_PAGE_SIZE
    return gridProducts.slice(start, start + CATALOG_PAGE_SIZE)
  }, [gridProducts, page, totalPages])
  const pageStart = gridProducts.length === 0
    ? 0
    : (Math.min(page, totalPages) - 1) * CATALOG_PAGE_SIZE + 1
  const pageEnd = Math.min(gridProducts.length, Math.min(page, totalPages) * CATALOG_PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [filter, searchQuery])

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages))
  }, [totalPages])

  function handleClear() {
    onSearchChange('')
    inputRef.current?.focus()
  }

  return (
    <section className={`catalog${largeCards ? ' catalog--large-cards' : ''}`}>
      <div className="catalog__header">
        <div className="catalog__search-wrap">
          <span className="catalog__search-icon">
            <IconSearch />
          </span>
          <input
            ref={inputRef}
            className="catalog__search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск товара или штрихкода"
            autoComplete="off"
            spellCheck={false}
            onFocus={(e) => {
              activeInputRef.current = e.currentTarget
            }}
            aria-label="Поиск товара"
          />
          {searchQuery.length > 0 && (
            <button
              className="catalog__search-clear"
              type="button"
              onClick={handleClear}
              aria-label="Очистить"
              tabIndex={-1}
            >
              <IconClear />
            </button>
          )}
        </div>

        <div className="catalog__filters-row">
        <div className="catalog__tabs" role="tablist">
          {(['all', 'weight', 'piece'] as const).map((tab) => (
            <button
              key={tab}
              className={`catalog__tab${filter === tab ? ' is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={filter === tab}
              onClick={() => setFilter(tab)}
            >
              <span className="catalog__tab-icon">
                {tab === 'all' ? <IconAll /> : tab === 'weight' ? <IconWeight /> : <IconPiece />}
              </span>
              <span className="catalog__tab-label">
                {tab === 'all' ? 'Все' : tab === 'weight' ? 'Весовые' : 'Штучные'}
              </span>
              <span className="catalog__tab-count">{counts[tab]}</span>
            </button>
          ))}
        </div>

        {onWholesaleModeChange && (
          <button
            type="button"
            className={`catalog__wholesale${wholesaleMode ? ' is-active' : ''}`}
            aria-pressed={wholesaleMode}
            onClick={() => onWholesaleModeChange(!wholesaleMode)}
            title="Добавлять в чек по оптовой цене"
          >
            Оптовая цена
          </button>
        )}
        </div>
      </div>

      <div className="catalog__toolbar">
        <span className="catalog__toolbar-title">
          {filter === 'all' ? 'Все товары' : filter === 'weight' ? 'Весовые товары' : 'Штучные товары'}
        </span>
        <span className="catalog__toolbar-badge">{filteredProducts.length}</span>
        {loading && products.length === 0 && (
          <span className="catalog__loading">Загрузка каталога…</span>
        )}
        {refreshing && products.length > 0 && (
          <span className="catalog__refreshing">Обновление…</span>
        )}
        {error && (
          <>
            <span className="catalog__error">{error}</span>
            {onRefresh && (
              <button className="catalog__refresh" type="button" onClick={onRefresh}>
                Обновить
              </button>
            )}
          </>
        )}
      </div>

      <div className="catalog__scroll">
        {favoriteStripProducts.length > 0 && (
          <div className="catalog__fav-block">
            <p className="catalog__fav-label">Избранное</p>
            <div className="catalog__fav-strip" role="list">
              {favoriteStripProducts.map((p) => (
                <div key={p.id} className="catalog__fav-item" role="listitem">
                  <ProductCard
                    product={p}
                    onAdd={onAddProduct}
                    isFavorite={favoriteIds.has(p.id)}
                    onToggleFavorite={toggleFavorite}
                    compact
                    wholesaleMode={wholesaleMode}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {loading && products.length === 0 ? (
          <div className="catalog__grid catalog__grid--skeleton" aria-label="Загрузка товаров">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="pcard-skeleton">
                <span className="pcard-skeleton__img" />
                <span className="pcard-skeleton__line" />
                <span className="pcard-skeleton__line pcard-skeleton__line--short" />
              </div>
            ))}
          </div>
        ) : gridProducts.length > 0 ? (
          <div className="catalog__grid">
            {visibleGridProducts.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onAdd={onAddProduct}
                isFavorite={favoriteIds.has(p.id)}
                onToggleFavorite={toggleFavorite}
                wholesaleMode={wholesaleMode}
              />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="catalog__empty">
            <IconEmpty />
            <strong>Каталог пуст</strong>
            <span>Добавьте товары в панели управления → «Добавить товар»</span>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="catalog__empty">
            <IconEmpty />
            <strong>Товары не найдены</strong>
            <span>Попробуйте изменить запрос или фильтр</span>
          </div>
        ) : (
          <p className="catalog__all-in-fav">Все совпадения уже в избранном сверху.</p>
        )}
      </div>
      {gridProducts.length > CATALOG_PAGE_SIZE && (
        <div className="catalog__pager" aria-label="Страницы товаров">
          <button
            type="button"
            className="catalog__pager-btn"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Назад
          </button>
          <span className="catalog__pager-info">
            {pageStart}-{pageEnd} из {gridProducts.length} · стр. {Math.min(page, totalPages)} / {totalPages}
          </span>
          <button
            type="button"
            className="catalog__pager-btn catalog__pager-btn--next"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Вперёд
          </button>
        </div>
      )}
    </section>
  )
}

/**
 * Memoized so frequent parent re-renders (e.g. live scale ticks in DashboardPage)
 * don't reconcile the entire product grid. Re-renders only when its own props change.
 */
export const ProductCatalogPanel = memo(ProductCatalogPanelImpl)
