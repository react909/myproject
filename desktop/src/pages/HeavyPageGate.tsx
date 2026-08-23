import { useEffect, useState, type ReactNode } from 'react'
import { LoadingScreen } from './LoadingScreen'

type HeavyPageGateProps = {
  loadingTitle: string
  loadingSubtitle?: string
  children: ReactNode
}

export function HeavyPageGate({ loadingTitle, loadingSubtitle, children }: HeavyPageGateProps) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(false)
    const id = window.setTimeout(() => setReady(true), 80)
    return () => window.clearTimeout(id)
  }, [])

  if (!ready) {
    return (
      <LoadingScreen
        title={loadingTitle}
        subtitle={loadingSubtitle ?? 'Загрузка данных…'}
      />
    )
  }
  return children
}
