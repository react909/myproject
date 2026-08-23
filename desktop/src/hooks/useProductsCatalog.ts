import { useCallback, useEffect, useRef, useState } from 'react'

import type { Product } from '../catalog/mockProducts'

import {

  fetchProducts,

  refreshProductsFromNetwork,

  readProductsCacheStaleOk,

  readProductsCacheAge,

  PRODUCTS_CACHE_TTL_MS,

  writeProductsCache,

} from '../services/products'



function resolveInitialProducts(seed?: Product[]): Product[] {

  if (seed && seed.length > 0) return seed

  return readProductsCacheStaleOk()

}



function isProductsCacheFresh(): boolean {

  const savedAt = readProductsCacheAge()

  if (!savedAt) return false

  return Date.now() - savedAt < PRODUCTS_CACHE_TTL_MS

}



export function useProductsCatalog(seedProducts?: Product[]) {

  const [products, setProducts] = useState<Product[]>(() => resolveInitialProducts(seedProducts))

  const [isInitialLoading, setIsInitialLoading] = useState(() => products.length === 0)

  const [isRefreshing, setIsRefreshing] = useState(false)

  const [error, setError] = useState<string | null>(null)



  const requestSeq = useRef(0)

  const hasDataRef = useRef(products.length > 0)



  const refresh = useCallback(async (force = false): Promise<Product[]> => {

    const seq = ++requestSeq.current

    const initial = !hasDataRef.current

    if (initial) setIsInitialLoading(true)

    else setIsRefreshing(true)

    if (initial) setError(null)



    try {

      const next = force ? await refreshProductsFromNetwork() : await fetchProducts()

      if (seq !== requestSeq.current) return next

      if (next.length > 0) hasDataRef.current = true

      setProducts(next)

      writeProductsCache(next)

      return next

    } catch (err: unknown) {

      if (seq !== requestSeq.current) return []

      const e = err as { response?: { data?: { detail?: string } }; message?: string }

      const msg = e.response?.data?.detail ?? e.message ?? 'Не удалось загрузить товары'

      if (!hasDataRef.current) setError(msg)

      return []

    } finally {

      if (seq === requestSeq.current) {

        setIsInitialLoading(false)

        setIsRefreshing(false)

      }

    }

  }, [])



  const forceRefresh = useCallback((): Promise<Product[]> => refresh(true), [refresh])



  useEffect(() => {

    const cached = readProductsCacheStaleOk()

    if (cached.length > 0 && isProductsCacheFresh()) {

      hasDataRef.current = true

      setIsInitialLoading(false)

      return

    }

    void refresh()

  }, [refresh])



  useEffect(() => {

    const onBump = () => {

      void refresh(true)

    }

    const onOnline = () => {

      if (!isProductsCacheFresh()) void refresh()

    }

    window.addEventListener('nurcrm-panel-products', onBump)

    window.addEventListener('online', onOnline)

    window.addEventListener('nurcrm-account-changed', onBump)

    return () => {

      window.removeEventListener('nurcrm-panel-products', onBump)

      window.removeEventListener('online', onOnline)

      window.removeEventListener('nurcrm-account-changed', onBump)

    }

  }, [refresh])



  useEffect(() => {

    if (!seedProducts || seedProducts.length === 0) return

    hasDataRef.current = true

    setProducts(seedProducts)

    writeProductsCache(seedProducts)

    setIsInitialLoading(false)

  }, [seedProducts])



  return {

    products,

    isInitialLoading,

    isRefreshing,

    error,

    refresh,

    forceRefresh,

  }

}


