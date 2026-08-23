import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export type PanelProductKind = 'all' | 'weight' | 'piece'

type PanelProductFilterContextValue = {
  productKind: PanelProductKind
  setProductKind: (k: PanelProductKind) => void
}

const PanelProductFilterContext = createContext<PanelProductFilterContextValue | null>(null)

export function PanelProductFilterProvider({ children }: { children: ReactNode }) {
  const [productKind, setProductKind] = useState<PanelProductKind>('all')
  const value = useMemo(
    () => ({ productKind, setProductKind }),
    [productKind],
  )
  return (
    <PanelProductFilterContext.Provider value={value}>
      {children}
    </PanelProductFilterContext.Provider>
  )
}

export function usePanelProductFilter() {
  const ctx = useContext(PanelProductFilterContext)
  if (!ctx) {
    return { productKind: 'all' as PanelProductKind, setProductKind: () => {} }
  }
  return ctx
}
