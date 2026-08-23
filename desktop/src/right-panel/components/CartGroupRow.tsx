import { memo } from 'react'
import { IcoHold } from '../icons'

type Props = {
  label: string
  onRemove: () => void
  /** Снова отправить этот блок (имя + товары) в список «Отложенные». */
  onReDeferToHold?: () => void
}

/** Заголовок блока отложенного чека (имя клиента) — без участия в суммах */
export const CartGroupRow = memo(function CartGroupRow({
  label,
  onRemove,
  onReDeferToHold,
}: Props) {
  return (
    <div className="cr-group">
      <div className="cr-group__inner">
        <span className="cr-group__badge">Отложено</span>
        <span className="cr-group__label">{label}</span>
        {onReDeferToHold && (
          <button
            type="button"
            className="cr-group__redefer"
            onClick={onReDeferToHold}
            title="Снова в отложенные (с этим именем)"
            aria-label="Снова в отложенные"
          >
            <IcoHold className="cr-group__redefer-ico" />
          </button>
        )}
        <button type="button" className="cr-group__dismiss" onClick={onRemove} aria-label="Убрать подпись">
          ×
        </button>
      </div>
    </div>
  )
})
