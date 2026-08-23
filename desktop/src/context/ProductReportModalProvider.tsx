import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ProductSalesModal } from '../components/ProductSalesModal'
import type { ProductReportPeriod } from '../services/productReport'

type ProductReportModalContextValue = {
  openProductReport: (productName: string, period?: ProductReportPeriod) => void
}

const ProductReportModalContext = createContext<ProductReportModalContextValue | null>(null)

export function ProductReportModalProvider({ children }: { children: ReactNode }) {
  const [productName, setProductName] = useState<string | null>(null)
  const [initialPeriod, setInitialPeriod] = useState<ProductReportPeriod>('month')

  const openProductReport = useCallback((name: string, period: ProductReportPeriod = 'month') => {
    setProductName(name)
    setInitialPeriod(period)
  }, [])

  const close = useCallback(() => setProductName(null), [])

  const value = useMemo(
    () => ({ openProductReport }),
    [openProductReport],
  )

  return (
    <ProductReportModalContext.Provider value={value}>
      {children}
      {productName ? (
        <ProductSalesModal
          productName={productName}
          initialPeriod={initialPeriod}
          onClose={close}
        />
      ) : null}
    </ProductReportModalContext.Provider>
  )
}

export function useProductReportModal(): ProductReportModalContextValue {
  const ctx = useContext(ProductReportModalContext)
  if (!ctx) {
    throw new Error('useProductReportModal must be used within ProductReportModalProvider')
  }
  return ctx
}
