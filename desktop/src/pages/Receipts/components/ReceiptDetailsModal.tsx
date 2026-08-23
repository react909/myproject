// src/pages/Receipts/components/ReceiptDetailsModal.tsx
//
// Стили импортируются здесь, а не страницей: страницы старого журнала больше
// нет — он переписан заново как pages/panel/PanelJournal. Само окно осталось:
// оно общее с кассой и умеет печатать дубликат и открывать возврат.
import './ReceiptModals.css'

import { motion } from 'framer-motion'
import { ModalPortal } from '../../../components/ModalPortal'
import type { Receipt } from '../types'

type ReceiptDetailsModalProps = {
  receipt: Receipt
  onClose: () => void
  onPrint: () => void
  /**
   * Оформить возврат по этому чеку. Не задан — кнопки нет.
   *
   * Отсюда, а не из строки таблицы: возврат — не рядовое действие, и нажимать
   * его вслепую из списка нельзя. Открыв чек, кассир видит, что именно
   * возвращает.
   */
  onRefund?: () => void
}

export function ReceiptDetailsModal({
  receipt,
  onClose,
  onPrint,
  onRefund,
}: ReceiptDetailsModalProps) {
  return (
    <ModalPortal>
    <motion.div
      className="receipt-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <motion.div
        className="receipt-modal"
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        transition={{ duration: 0.2 }}
      >
        <header className="receipt-modal__header">
          <h2 className="receipt-modal__title">Чек {receipt.number}</h2>
          <button type="button" className="receipt-modal__close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="receipt-modal__body">
          <div className="receipt-modal__info">
            <div className="receipt-info-row">
              <span className="receipt-info-row__label">Дата:</span>
              <span className="receipt-info-row__value">
                {receipt.date} {receipt.time}
              </span>
            </div>
            <div className="receipt-info-row">
              <span className="receipt-info-row__label">Кассир:</span>
              <span className="receipt-info-row__value">{receipt.cashier}</span>
            </div>
            <div className="receipt-info-row">
              <span className="receipt-info-row__label">Оплата:</span>
              <span className="receipt-info-row__value">
                {receipt.paymentMethod === 'cash'
                  ? 'Наличные'
                  : receipt.paymentMethod === 'card'
                    ? 'Карта'
                    : 'Смешанная'}
              </span>
            </div>
            {receipt.customerName && (
              <div className="receipt-info-row">
                <span className="receipt-info-row__label">Клиент:</span>
                <span className="receipt-info-row__value">{receipt.customerName}</span>
              </div>
            )}
          </div>

          <div className="receipt-modal__items">
            <h3 className="receipt-modal__items-title">Товары</h3>
            <table className="receipt-items-table">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th>Кол-во</th>
                  <th>Цена</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {receipt.items.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '14px', color: 'var(--text-2)' }}>
                      Загрузка позиций…
                    </td>
                  </tr>
                )}
                {receipt.items.map((item) => (
                  <tr key={item.id} className={item.refunded ? 'is-refunded' : ''}>
                    <td>{item.name}</td>
                    <td>
                      {item.quantity.toLocaleString('ru-RU', {
                        minimumFractionDigits: item.isWeight ? 3 : 0,
                        maximumFractionDigits: item.isWeight ? 3 : 0,
                      })}{' '}
                      {item.isWeight ? 'кг' : 'шт'}
                    </td>
                    <td>{item.price.toLocaleString('ru-RU')} сом</td>
                    <td className="receipt-items-table__total">
                      {item.total.toLocaleString('ru-RU')} сом
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="receipt-modal__totals">
            <div className="receipt-total-row">
              <span>Подытог:</span>
              <span>{receipt.subtotal.toLocaleString('ru-RU')} сом</span>
            </div>
            {receipt.discount > 0 && (
              <div className="receipt-total-row">
                <span>Скидка:</span>
                <span className="receipt-total-row__discount">
                  −{receipt.discount.toLocaleString('ru-RU')} сом
                </span>
              </div>
            )}
            <div className="receipt-total-row receipt-total-row--major">
              <span>Итого:</span>
              <span>{receipt.total.toLocaleString('ru-RU')} сом</span>
            </div>
            {receipt.cashGiven != null && (
              <>
                <div className="receipt-total-row">
                  <span>Получено:</span>
                  <span>{receipt.cashGiven.toLocaleString('ru-RU')} сом</span>
                </div>
                <div className="receipt-total-row">
                  <span>Сдача:</span>
                  <span>{receipt.change?.toLocaleString('ru-RU') ?? 0} сом</span>
                </div>
              </>
            )}
          </div>
        </div>

        <footer className="receipt-modal__footer">
          <button type="button" className="receipt-modal__btn receipt-modal__btn--secondary" onClick={onClose}>
            Закрыть
          </button>
          {/* Возврат — только по уже оплаченному чеку. По отменённому и по
              возвращённому возвращать нечего, и кнопка там врёт. */}
          {onRefund && (receipt.status === 'completed' || receipt.status === 'partial_refund') && (
            <button
              type="button"
              className="receipt-modal__btn receipt-modal__btn--danger"
              onClick={onRefund}
            >
              Возврат
            </button>
          )}
          <button type="button" className="receipt-modal__btn receipt-modal__btn--primary" onClick={onPrint}>
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
              <path
                d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M6 14h12v8H6z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Печать</span>
          </button>
        </footer>
      </motion.div>
    </motion.div>
    </ModalPortal>
  )
}