import './PanelFetchOverlay.css'

/**
 * Тонкая полоса «идёт обновление» поверх уже показанных данных.
 *
 * Показывается только тогда, когда данные на экране уже есть: подменять их
 * загрузочным экраном при каждом обновлении значило бы мигать содержимым на
 * ровном месте. Пока данных нет вовсе — работают скелетоны самого раздела.
 */
export function PanelFetchOverlay({ label }: { label: string }) {
  return (
    <div className="pfo" role="status" aria-live="polite">
      <span className="pfo__bar" aria-hidden="true" />
      <span className="pfo__label">{label}</span>
    </div>
  )
}
