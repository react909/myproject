import { usePosConnection } from '../context/PosConnectionProvider'
import './PosConnectionBadge.css'

type PosConnectionBadgeProps = {
  compact?: boolean
}

export function PosConnectionBadge({ compact = false }: PosConnectionBadgeProps) {
  const { isOnline, offlinePending } = usePosConnection()

  if (isOnline) return null

  return (
    <span
      className={`pos-conn-badge${compact ? ' pos-conn-badge--compact' : ''}`}
      title={
        offlinePending > 0
          ? `Оффлайн · ${offlinePending} чек(ов) в очереди`
          : 'Оффлайн · продажи сохраняются локально'
      }
    >
      Offline
      {offlinePending > 0 && <span className="pos-conn-badge__count">{offlinePending}</span>}
    </span>
  )
}
