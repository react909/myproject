/**
 * Окна раздела «Поставщики»: карточка и оплата.
 *
 * Про оплату важно одно: отказ по правам приходит С СЕРВЕРА и показывается как
 * есть. Здесь нет ни проверки роли, ни «если не владелец — не показывать»: и
 * то, и другое обходится, а сервер — нет.
 */

import { useState } from 'react'
import { DeskDialog } from '../DeskDialog'
import { paySupplier } from '../../../services/suppliers'
import type { SupplierCard } from '../../../services/suppliers'
import { formatTiyin, parseTiyin, tiyinToInput } from '../../../utils/money'

/* ── Карточка поставщика ─────────────────────────────────────────────── */

export function SupplierDialog({
  card,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  /** `null` — заводим нового. */
  card: SupplierCard | null
  busy: boolean
  error: string
  onConfirm: (input: {
    name: string
    contactPerson: string
    phone: string
    address: string
    comment: string
  }) => void
  onClose: () => void
}) {
  const [name, setName] = useState(card?.name ?? '')
  const [contact, setContact] = useState(card?.contactPerson ?? '')
  const [phone, setPhone] = useState(card?.phone ?? '')
  const [address, setAddress] = useState(card?.address ?? '')
  const [comment, setComment] = useState(card?.comment ?? '')

  return (
    <DeskDialog
      title={card ? 'Изменить поставщика' : 'Новый поставщик'}
      confirmLabel={card ? 'Сохранить' : 'Создать'}
      confirmDisabled={!name.trim()}
      busy={busy}
      error={error}
      hint="Enter — сохранить, Esc — отмена"
      onConfirm={() =>
        onConfirm({
          name: name.trim(),
          contactPerson: contact.trim(),
          phone: phone.trim(),
          address: address.trim(),
          comment: comment.trim(),
        })
      }
      onClose={onClose}
    >
      <label className="dsk__label dlg__wide">
        Название
        <input
          className="dsk__field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={200}
        />
      </label>
      <div className="dlg__grid">
        <label className="dsk__label">
          Контактное лицо
          <input
            className="dsk__field"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            maxLength={200}
          />
        </label>
        <label className="dsk__label">
          Телефон
          <input
            className="dsk__field"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            maxLength={40}
            placeholder="+996 700 00 00 00"
          />
        </label>
      </div>
      <label className="dsk__label dlg__wide">
        Адрес
        <input
          className="dsk__field"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          maxLength={300}
        />
      </label>
      <label className="dsk__label dlg__wide">
        Комментарий
        <input
          className="dsk__field"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={400}
        />
      </label>
    </DeskDialog>
  )
}

/* ── Оплата поставщику ───────────────────────────────────────────────── */

const METHODS = [
  { id: 'cash', label: 'Наличные' },
  { id: 'card', label: 'Карта' },
  { id: 'transfer', label: 'Перевод' },
]

export function PaymentDialog({
  card,
  onDone,
  onClose,
}: {
  card: SupplierCard
  onDone: () => void
  onClose: () => void
}) {
  const [amount, setAmount] = useState(tiyinToInput(Math.max(0, card.debtTiyin)))
  const [method, setMethod] = useState('cash')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const tiyin = parseTiyin(amount)

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await paySupplier(card.id, { amountTiyin: tiyin, method, comment: comment.trim() })
      onDone()
    } catch (err: any) {
      /*
        403 значит закрытую дверь владельца — и текст об этом приходит с
        сервера. Дописывать сюда «войдите как владелец» нельзя: сервер отвечает
        скупо намеренно, чтобы отказ не подтверждал, чем именно закрыт раздел.
        Но объяснить, ЧТО делать, всё-таки нужно, иначе кассир упрётся в
        «Недостаточно прав» и не поймёт, к кому идти.
      */
      const status = err?.response?.status
      const detail = err?.response?.data?.detail ?? err?.message ?? 'Не удалось внести оплату.'
      setError(
        status === 403
          ? `${detail} Выдача денег доступна только владельцу — он открывает свой кабинет своим паролем.`
          : detail,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <DeskDialog
      title="Оплата поставщику"
      subtitle={`${card.name} · долг ${formatTiyin(card.debtTiyin)} сом`}
      confirmLabel="Внести оплату"
      confirmDisabled={tiyin <= 0}
      busy={busy}
      error={error}
      hint="Enter — внести, Esc — отмена"
      onConfirm={() => void submit()}
      onClose={onClose}
    >
      <label className="dsk__label dlg__wide">
        Сумма, сом
        <input
          className="dsk__field dlg__amount"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          onFocus={(event) => event.target.select()}
        />
      </label>
      <div className="dlg__grid">
        <label className="dsk__label">
          Способ
          <select
            className="dsk__field"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
          >
            {METHODS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="dsk__label">
          Комментарий
          <input
            className="dsk__field"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={200}
          />
        </label>
      </div>
      <p className="dlg__hint">
        Оплата уменьшит долг. Операция доступна только владельцу — проверка на
        сервере.
      </p>
    </DeskDialog>
  )
}
