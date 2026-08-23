/**
 * Окна раздела «Смена»: открытие, внесение, изъятие, закрытие со сверкой.
 *
 * Вынесены из `PanelShift`, потому что закрытие — это не «ещё одно окно», а
 * экран в два шага со своей арифметикой: пересчёт по номиналам, сверка,
 * расхождение. Внутри страницы он занимал бы больше места, чем сама страница.
 */

import { useMemo, useState } from 'react'
import { DeskDialog } from '../DeskDialog'
import { formatTiyin, parseTiyin, tiyinToInput } from '../../../utils/money'

/* ── Открытие смены ──────────────────────────────────────────────────── */

export function OpenShiftDialog({
  defaultCashier,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  defaultCashier: string
  busy: boolean
  error: string
  onConfirm: (input: { cashier: string; openCashTiyin: number }) => void
  onClose: () => void
}) {
  const [cashier, setCashier] = useState(defaultCashier)
  const [cash, setCash] = useState('0.00')
  const tiyin = parseTiyin(cash)

  return (
    <DeskDialog
      title="Открыть смену"
      subtitle="Одновременно может быть открыта только одна смена"
      confirmLabel="Открыть"
      confirmDisabled={!cashier.trim()}
      busy={busy}
      error={error}
      hint="Enter — открыть, Esc — отмена"
      onConfirm={() => onConfirm({ cashier: cashier.trim(), openCashTiyin: tiyin })}
      onClose={onClose}
    >
      <label className="dsk__label dlg__wide">
        Кассир
        <input
          className="dsk__field"
          value={cashier}
          onChange={(event) => setCashier(event.target.value)}
          maxLength={120}
        />
      </label>
      <label className="dsk__label dlg__wide">
        Размен в кассе на начало смены, сом
        <input
          className="dsk__field dlg__amount"
          inputMode="decimal"
          value={cash}
          onChange={(event) => setCash(event.target.value)}
          onFocus={(event) => event.target.select()}
        />
      </label>
      <p className="dlg__hint">
        Размен — это деньги, которые уже лежат в ящике до первой продажи. Он
        войдёт в расчётную сумму при закрытии.
      </p>
    </DeskDialog>
  )
}

/* ── Внесение и изъятие ──────────────────────────────────────────────── */

const DEPOSIT_REASONS = ['Размен из сейфа', 'Возврат подотчёта', 'Прочее']
const WITHDRAWAL_REASONS = ['Инкассация', 'Закупка на месте', 'Выплата зарплаты', 'Прочее']

export function CashMovementDialog({
  kind,
  drawerTiyin,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  kind: 'deposit' | 'withdrawal'
  drawerTiyin: number
  busy: boolean
  error: string
  onConfirm: (input: {
    amountTiyin: number
    reason: string
    comment: string
    actorName: string
  }) => void
  onClose: () => void
}) {
  const deposit = kind === 'deposit'
  const reasons = deposit ? DEPOSIT_REASONS : WITHDRAWAL_REASONS
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState(reasons[0])
  const [comment, setComment] = useState('')
  const [actor, setActor] = useState('')

  const tiyin = parseTiyin(amount)
  // Изъять больше, чем лежит в ящике, нельзя — и сказать об этом надо здесь, а
  // не отказом сервера после нажатия.
  const tooMuch = !deposit && tiyin > drawerTiyin

  return (
    <DeskDialog
      title={deposit ? 'Внесение наличных' : 'Изъятие наличных'}
      subtitle={`В ящике сейчас ${formatTiyin(drawerTiyin)} сом`}
      confirmLabel={deposit ? 'Внести' : 'Изъять'}
      confirmDisabled={tiyin <= 0 || tooMuch}
      danger={!deposit}
      busy={busy}
      error={error || (tooMuch ? 'В ящике меньше этой суммы.' : '')}
      hint="Enter — подтвердить, Esc — отмена"
      onConfirm={() =>
        onConfirm({
          amountTiyin: tiyin,
          reason,
          comment: comment.trim(),
          actorName: actor.trim(),
        })
      }
      onClose={onClose}
    >
      <label className="dsk__label dlg__wide">
        Сумма, сом
        <input
          className="dsk__field dlg__amount"
          inputMode="decimal"
          value={amount}
          placeholder="0.00"
          onChange={(event) => setAmount(event.target.value)}
          onFocus={(event) => event.target.select()}
        />
      </label>
      <div className="dlg__grid">
        <label className="dsk__label">
          Причина
          <select
            className="dsk__field"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            {reasons.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        {/* Кто забрал — только у изъятия: при внесении деньги кладёт тот, кто
            стоит за кассой, и спрашивать его имя незачем. */}
        {!deposit && (
          <label className="dsk__label">
            Кто забрал
            <input
              className="dsk__field"
              value={actor}
              onChange={(event) => setActor(event.target.value)}
              placeholder="Фамилия"
              maxLength={120}
            />
          </label>
        )}
      </div>
      <label className="dsk__label dlg__wide">
        Комментарий
        <input
          className="dsk__field"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={200}
        />
      </label>
    </DeskDialog>
  )
}

/* ── Закрытие смены: два шага ────────────────────────────────────────── */

/** Номиналы сома. Купюры и монеты, от крупных к мелким — так их и считают. */
const DENOMINATIONS = [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 1]

export function CloseShiftDialog({
  expectedTiyin,
  shiftNumber,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  expectedTiyin: number
  shiftNumber: number
  busy: boolean
  error: string
  onConfirm: (input: { countedTiyin: number; reason: string }) => void
  onClose: () => void
}) {
  const [step, setStep] = useState<'count' | 'check'>('count')
  const [manual, setManual] = useState(tiyinToInput(expectedTiyin))
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [byDenoms, setByDenoms] = useState(false)
  const [reason, setReason] = useState('')

  /** Сумма по номиналам. Считается здесь, а не в поле итога: поле итога —
   *  ручной ввод, и подменять его на лету значило бы драться с человеком. */
  const denomTotal = useMemo(
    () =>
      DENOMINATIONS.reduce((sum, face) => {
        const count = Number((counts[face] ?? '').replace(/\D/g, '')) || 0
        return sum + face * 100 * count
      }, 0),
    [counts],
  )

  const counted = byDenoms ? denomTotal : parseTiyin(manual)
  const variance = counted - expectedTiyin
  const verdict =
    variance === 0 ? '' : variance < 0 ? 'dlg__verdict--short' : 'dlg__verdict--over'

  if (step === 'count') {
    return (
      <DeskDialog
        title={`Закрытие смены №${shiftNumber} · шаг 1 из 2`}
        subtitle="Пересчитайте наличные в ящике и введите фактическую сумму"
        confirmLabel="Дальше — сверка"
        confirmDisabled={counted < 0}
        busy={false}
        error={error}
        hint="Enter — дальше, Esc — отмена"
        onConfirm={() => setStep('check')}
        onClose={onClose}
      >
        {/* Итог одной суммой — быстрый путь. Им пользуются, когда деньги уже
            посчитаны на столе. */}
        <label className="dsk__label dlg__wide">
          Фактически в ящике, сом
          <input
            className="dsk__field dlg__amount"
            inputMode="decimal"
            value={byDenoms ? tiyinToInput(denomTotal) : manual}
            readOnly={byDenoms}
            onChange={(event) => setManual(event.target.value)}
            onFocus={(event) => event.target.select()}
          />
        </label>

        <label className="dsk__label" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={byDenoms}
            onChange={(event) => setByDenoms(event.target.checked)}
          />
          Считать по номиналам
        </label>

        {/*
          Пересчёт по номиналам — то, что кассир делает руками: раскладывает
          купюры по стопкам и считает штуки. Складывать за него должна система.
        */}
        {byDenoms && (
          <div className="dlg__denoms">
            {DENOMINATIONS.map((face) => (
              <div className="dlg__denom" key={face}>
                <span className="dlg__denom-face">{face}</span>
                <input
                  className="dlg__denom-count"
                  inputMode="numeric"
                  value={counts[face] ?? ''}
                  placeholder="0"
                  onChange={(event) =>
                    setCounts((prev) => ({ ...prev, [face]: event.target.value }))
                  }
                  onFocus={(event) => event.target.select()}
                />
              </div>
            ))}
          </div>
        )}
      </DeskDialog>
    )
  }

  return (
    <DeskDialog
      title={`Закрытие смены №${shiftNumber} · шаг 2 из 2`}
      subtitle="Сверка расчётной и фактической суммы"
      confirmLabel="Закрыть смену"
      /* Расхождение без объяснения не пропускает и сервер — но сказать об этом
         надо здесь, до нажатия, а не отказом после. */
      confirmDisabled={variance !== 0 && !reason.trim()}
      danger
      busy={busy}
      error={error}
      hint="Enter — закрыть, Esc — вернуться к пересчёту"
      onConfirm={() => onConfirm({ countedTiyin: counted, reason: reason.trim() })}
      onClose={() => setStep('count')}
    >
      <div className="dsk__rows">
        <div className="dsk__pair">
          <span>Расчётная сумма</span>
          <strong>{formatTiyin(expectedTiyin)} сом</strong>
        </div>
        <div className="dsk__pair">
          <span>Фактическая сумма</span>
          <strong>{formatTiyin(counted)} сом</strong>
        </div>
      </div>

      <div className={`dlg__verdict ${verdict}`}>
        <span className="dlg__verdict-label">
          {variance === 0 ? 'Сошлось' : variance < 0 ? 'Недостача' : 'Излишек'}
        </span>
        <span className="dlg__verdict-value">{formatTiyin(Math.abs(variance))} сом</span>
      </div>

      {variance !== 0 && (
        <label className="dsk__label dlg__wide">
          Причина расхождения — обязательно
          <input
            className="dsk__field"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ошиблись сдачей, не пробили чек…"
            maxLength={300}
          />
        </label>
      )}

      <p className="dlg__hint">
        Причина попадёт в отчёт смены. Закрытую смену изменить нельзя.
      </p>
    </DeskDialog>
  )
}
