import { memo } from 'react'
import { formatMoney, formatWeight } from '../helpers'

type PaymentFooterProps = {
  itemsCount: number
  totalWeight: number
  discountAmount: number
  totalToPay: number
  onPay: () => void
  disabled: boolean
  disabledReason?: string
}

export const PaymentFooter = memo(function PaymentFooter({
  itemsCount,
  totalWeight,
  discountAmount,
  totalToPay,
  onPay,
  disabled,
  disabledReason,
}: PaymentFooterProps) {
  return (
    <div className="pf">
      <div className="pf__summary">
        <div className="pf__pills">
          <div className="pf__pill">
            <span>Поз.</span>
            <strong>{itemsCount}</strong>
          </div>
          <div className="pf__pill-sep" />
          <div className="pf__pill">
            <span>Вес</span>
            <strong>{formatWeight(totalWeight)}&nbsp;кг</strong>
          </div>
          {discountAmount > 0 && (
            <>
              <div className="pf__pill-sep" />
              <div className="pf__pill pf__pill--discount">
                <span>Скидка</span>
                <strong>−{formatMoney(discountAmount)}&nbsp;сом</strong>
              </div>
            </>
          )}
        </div>
        <div className="pf__total">
          <span>К оплате</span>
          <strong>{formatMoney(totalToPay)}&nbsp;сом</strong>
        </div>
      </div>

      <button
        type="button"
        className="pf__pay-btn"
        onClick={onPay}
        disabled={disabled}
        title={disabledReason}
      >
        <span className="pf__pay-label">ОПЛАТИТЬ</span>
        <span className="pf__pay-amount">{formatMoney(totalToPay)}&nbsp;сом</span>
      </button>
    </div>
  )
})