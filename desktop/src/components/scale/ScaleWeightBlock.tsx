import './ScaleWeightBlock.css'

type ScaleWeightBlockProps = {
  displayKg: number | null
  isStable: boolean
  onFix: () => void
  compact?: boolean
}

function formatKg(kg: number): string {
  return kg.toFixed(3).replace('.', ',')
}

export function ScaleWeightBlock({
  displayKg,
  isStable,
  onFix,
  compact = false,
}: ScaleWeightBlockProps) {
  const label = displayKg != null && displayKg > 0 ? formatKg(displayKg) : '—'
  const canFix = isStable && displayKg != null && displayKg > 0

  return (
    <div
      className={`swb${compact ? ' swb--compact' : ''}${isStable ? ' swb--stable' : ''}`}
    >
      <div className="swb__readout">
        <span className="swb__label">Вес на весах, кг</span>
        <span
          className={`swb__value${label === '—' ? ' swb__value--empty' : ''}`}
        >
          {label}
        </span>
      </div>
      <button
        type="button"
        className={`swb__fix${canFix ? ' swb__fix--ready' : ''}`}
        disabled={!canFix}
        onClick={onFix}
      >
        Зафиксировать
      </button>
    </div>
  )
}
