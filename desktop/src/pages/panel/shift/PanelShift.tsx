/**
 * Раздел «Смена».
 *
 * Что здесь происходит по существу: касса открывается, работает, считает
 * деньги в ящике и закрывается со сверкой. Всё остальное — способ это увидеть.
 *
 * Три решения, которые видно не сразу:
 *
 * 1. РАСЧЁТНАЯ СУММА В ЯЩИКЕ приходит с сервера, а не складывается здесь.
 *    Соблазн сложить её на фронте большой — все слагаемые уже на экране, — но
 *    тогда цифра на экране и цифра, по которой сервер проверит сверку, стали бы
 *    двумя разными, и расходились бы они ровно на округлении.
 *
 * 2. ПОКАЗАТЕЛИ ОБНОВЛЯЮТСЯ ПОСЛЕ КАЖДОГО ДЕЙСТВИЯ, а не по таймеру. Опрос
 *    сервера раз в секунду на офлайновой кассе — это работа впустую: между
 *    внесением и изъятием ничего не меняется само. Кроме одного случая: пока
 *    раздел открыт, кассир может пробивать чеки на другом экране, поэтому есть
 *    F5 и обновление при возвращении на вкладку.
 *
 * 3. ПРИБЫЛИ ЗДЕСЬ НЕТ. Есть выручка смены, разбивка по способам оплаты и
 *    возвраты. Прибыль магазина — это кабинет владельца, и показывать её
 *    кассиру в разделе смены нельзя.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HotkeyBar } from '../HotkeyBar'
import type { Hotkey } from '../HotkeyBar'
import { useRowKeyboard } from '../../../hooks/useRowKeyboard'
import { isAbortError } from '../../../api/errors'
import { useNotifications } from '../../../components/notifications/NotificationProvider'
import { loadSettings } from '../../../settings/appSettings'
import {
  buildCashMovementPayload,
  buildShiftDeskReportPayload,
  printShiftCloseReceipt,
} from '../../../services/receiptPrint'
import {
  addCashMovement,
  closeShift,
  fetchMovements,
  fetchShiftHistory,
  fetchShiftReport,
  fetchShiftState,
  openShift,
} from '../../../services/shiftDesk'
import type { HistoryRow, Movement, ShiftState } from '../../../services/shiftDesk'
import { formatTiyin } from '../../../utils/money'
import { CashMovementDialog, CloseShiftDialog, OpenShiftDialog } from './ShiftDialogs'
import '../deskCommon.css'
import './PanelShift.css'

/** Высота строки таблиц раздела. Обязана совпадать с .dsk__row в CSS. */
const ROW_HEIGHT = 30

const MOVEMENT_LABELS: Record<string, string> = {
  deposit: 'Внесение',
  withdrawal: 'Изъятие',
  refund: 'Возврат',
  debt_payment: 'Оплата долга',
}

function moment(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

function clock(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** «7 ч 24 мин» — столько идёт смена. */
function duration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours <= 0) return `${minutes} мин`
  return `${hours} ч ${minutes} мин`
}

type Dialog =
  | { kind: 'open' }
  | { kind: 'deposit' }
  | { kind: 'withdrawal' }
  | { kind: 'close' }
  | null

export function PanelShift() {
  const { push } = useNotifications()
  const [state, setState] = useState<ShiftState | null>(null)
  const [movements, setMovements] = useState<Movement[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')
  /** Какая смена раскрыта в истории — по ней показывается карточка. */
  const [openedHistory, setOpenedHistory] = useState<HistoryRow | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const cashierName = useMemo(() => {
    const stored = localStorage.getItem('nurcrm-user-email') ?? ''
    return stored.split('@')[0] || 'Кассир'
  }, [])

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      setError('')
      try {
        const current = await fetchShiftState(signal)
        setState(current)
        // Движения нужны только у открытой смены: у закрытой их показывает
        // карточка из истории, и грузить их заранее незачем.
        setMovements(current ? await fetchMovements(current.shift.id, signal) : [])
        const page = await fetchShiftHistory({}, signal)
        setHistory(page.items)
      } catch (err: any) {
        if (isAbortError(err)) return
        setError(err?.response?.data?.detail ?? err?.message ?? 'Не удалось загрузить смену.')
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void reload(controller.signal)
    return () => controller.abort()
  }, [reload])

  /*
    Возврат на вкладку обновляет данные.

    Пока раздел открыт, за кассой продают: показатели устаревают не сами по
    себе, а от чужих действий. Опрашивать сервер по таймеру ради этого — работа
    впустую; обновиться в момент, когда на экран снова смотрят, достаточно.
  */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reload])

  const shift = state?.shift ?? null
  const open = shift?.status === 'open'

  /* ── Действия ────────────────────────────────────────────────────────── */

  const doOpen = useCallback(
    async (input: { cashier: string; openCashTiyin: number }) => {
      setBusy(true)
      setDialogError('')
      try {
        await openShift({ openCashTiyin: input.openCashTiyin, cashierName: input.cashier })
        setDialog(null)
        await reload()
        push({ kind: 'success', title: 'Смена', message: 'Смена открыта', dismissMs: 4000 })
      } catch (err: any) {
        setDialogError(err?.response?.data?.detail ?? err?.message ?? 'Не удалось открыть смену.')
      } finally {
        setBusy(false)
      }
    },
    [push, reload],
  )

  const doMovement = useCallback(
    async (
      kind: 'deposit' | 'withdrawal',
      input: { amountTiyin: number; reason: string; comment: string; actorName: string },
    ) => {
      if (!shift) return
      setBusy(true)
      setDialogError('')
      try {
        const next = await addCashMovement(shift.id, { kind, ...input })
        setState(next)
        setMovements(await fetchMovements(shift.id))
        setDialog(null)

        /*
          Чек операции. Печать не должна отменять саму операцию: деньги уже
          в ящике (или уже вынуты), и откатывать движение из-за неудачной
          печати значило бы разойтись с тем, что произошло на самом деле.
          Поэтому ошибка печати показывается отдельным сообщением.
        */
        if (loadSettings().printer.enabled) {
          const result = await printShiftCloseReceipt(
            buildCashMovementPayload({
              kind,
              amountTiyin: input.amountTiyin,
              reason: input.reason,
              comment: input.comment,
              actorName: input.actorName,
              cashier: shift.openedBy || cashierName,
              shiftNumber: shift.number,
              balanceTiyin: next.expectedCashTiyin,
            }),
          )
          if (!result.ok) {
            push({
              kind: 'warning',
              title: 'Печать',
              message: `Операция записана, но чек не напечатан: ${result.message}`,
              dismissMs: 7000,
            })
          }
        }
      } catch (err: any) {
        setDialogError(err?.response?.data?.detail ?? err?.message ?? 'Не удалось записать операцию.')
      } finally {
        setBusy(false)
      }
    },
    [shift, cashierName, push],
  )

  const doClose = useCallback(
    async (input: { countedTiyin: number; reason: string }) => {
      if (!shift) return
      setBusy(true)
      setDialogError('')
      try {
        await closeShift(shift.id, {
          countedCashTiyin: input.countedTiyin,
          varianceReason: input.reason,
        })
        setDialog(null)
        // Итоговый отчёт печатается по данным сервера, а не по тем, что были
        // на экране: между открытием окна и нажатием могла пройти продажа.
        await printReport(shift.id, 'z')
        await reload()
        push({ kind: 'success', title: 'Смена', message: 'Смена закрыта', dismissMs: 4000 })
      } catch (err: any) {
        setDialogError(err?.response?.data?.detail ?? err?.message ?? 'Не удалось закрыть смену.')
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shift, push, reload],
  )

  const printReport = useCallback(
    async (id: number, kind: 'x' | 'z') => {
      if (!loadSettings().printer.enabled) {
        push({
          kind: 'info',
          title: 'Печать',
          message: 'Принтер выключен — отчёт не напечатан.',
          dismissMs: 5000,
        })
        return
      }
      try {
        const report = await fetchShiftReport(id, kind)
        const result = await printShiftCloseReceipt(
          buildShiftDeskReportPayload({
            kind,
            number: report.shift.number,
            cashier: report.shift.openedBy,
            openedAt: report.shift.openedAt,
            closedAt: report.shift.closedAt,
            openCashTiyin: report.shift.openCashTiyin,
            expectedCashTiyin: report.expectedCashTiyin,
            countedCashTiyin: report.shift.countedCashTiyin,
            varianceTiyin: report.shift.varianceTiyin,
            varianceReason: report.shift.varianceReason,
            reconciled: report.shift.reconciled,
            salesCount: report.metrics.salesCount,
            refundsCount: report.metrics.refundsCount,
            revenueTiyin: report.metrics.revenueTiyin,
            cashTiyin: report.metrics.cashTiyin,
            cardTiyin: report.metrics.cardTiyin,
            qrTiyin: report.metrics.qrTiyin,
            debtTiyin: report.metrics.debtTiyin,
            refundsTiyin: report.metrics.refundsTiyin,
            discountsTiyin: report.metrics.discountsTiyin,
            depositsTiyin: report.depositsTiyin,
            withdrawalsTiyin: report.withdrawalsTiyin,
            printedAt: report.printedAt,
            printedBy: report.printedBy,
          }),
        )
        push({
          kind: result.ok ? 'success' : 'warning',
          title: 'Печать',
          message: result.ok
            ? kind === 'x'
              ? 'Промежуточный отчёт напечатан. Смена продолжается.'
              : 'Итоговый отчёт напечатан.'
            : result.message,
          dismissMs: 6000,
        })
      } catch (err: any) {
        push({
          kind: 'error',
          title: 'Печать',
          message: err?.response?.data?.detail ?? err?.message ?? 'Не удалось получить отчёт.',
          dismissMs: 7000,
        })
      }
    },
    [push],
  )

  /* ── Клавиатура раздела ──────────────────────────────────────────────── */

  const historyKeys = useRowKeyboard({
    count: history.length,
    rowHeight: ROW_HEIGHT,
    rowClass: 'dsk__row psh__history-row',
    selectedClass: 'dsk__row--on',
    onEnter: (index) => setOpenedHistory(history[index] ?? null),
    onEscape: () => setOpenedHistory(null),
  })

  const movementKeys = useRowKeyboard({
    count: movements.length,
    rowHeight: ROW_HEIGHT,
    rowClass: 'dsk__row psh__move-row',
    selectedClass: 'dsk__row--on',
  })

  /*
    Функциональные клавиши раздела.

    Слушатель на самом разделе, а не на окне: пока открыто окно ввода, F5 не
    должен перезагружать данные под ним, а F4 — закрывать смену из-под чужого
    диалога. Окно рисуется порталом в body, то есть вне этого узла, и события
    сюда не доходят по построению.
  */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (dialog) return
      switch (event.key) {
        case 'F5':
          event.preventDefault()
          void reload()
          return
        case 'F2':
          if (!open) {
            event.preventDefault()
            setDialog({ kind: 'open' })
          }
          return
        case 'F6':
          if (open) {
            event.preventDefault()
            setDialog({ kind: 'deposit' })
          }
          return
        case 'F7':
          if (open) {
            event.preventDefault()
            setDialog({ kind: 'withdrawal' })
          }
          return
        case 'F8':
          if (open && shift) {
            event.preventDefault()
            void printReport(shift.id, 'x')
          }
          return
        case 'F4':
          if (open) {
            event.preventDefault()
            setDialog({ kind: 'close' })
          }
          return
        default:
      }
    },
    [dialog, open, shift, reload, printReport],
  )

  const hotkeys = useMemo<Hotkey[]>(
    () => [
      { keys: 'F2', action: 'Открыть смену', off: open },
      { keys: 'F4', action: 'Закрыть смену', off: !open },
      { keys: 'F5', action: 'Обновить' },
      { keys: 'F6', action: 'Внесение', off: !open },
      { keys: 'F7', action: 'Изъятие', off: !open },
      { keys: 'F8', action: 'Промежуточный отчёт', off: !open },
      { keys: '↑↓', action: 'По строкам' },
      { keys: 'Enter', action: 'Открыть смену из истории' },
      { keys: 'Esc', action: 'Закрыть карточку' },
    ],
    [open],
  )

  /* ── Отрисовка ───────────────────────────────────────────────────────── */

  const metrics = state?.metrics
  const drawer = state?.expectedCashTiyin ?? 0

  return (
    <div className="dsk psh" ref={rootRef} onKeyDown={onKeyDown} tabIndex={-1}>
      {/* ── Полоса состояния смены ── */}
      <div className={`psh__state${open ? ' psh__state--open' : ''}`}>
        {loading ? (
          <span className="dsk__skeleton" style={{ width: 220 }} />
        ) : open && shift && state ? (
          <>
            <span className="psh__badge psh__badge--open">Смена открыта</span>
            <span className="psh__state-item">
              <b>№{shift.number}</b>
            </span>
            <span className="psh__state-item">
              {shift.openedBy || '—'}, с {clock(shift.openedAt)}
            </span>
            <span className="psh__state-item dsk__muted">идёт {duration(state.durationSeconds)}</span>
            <span className="psh__state-item">
              Размен <b>{formatTiyin(shift.openCashTiyin)}</b>
            </span>
            <span className="dsk__spacer" />
            <span className="psh__drawer">
              <span className="psh__drawer-label">В ящике сейчас</span>
              <b className="psh__drawer-value">{formatTiyin(drawer)} сом</b>
            </span>
          </>
        ) : (
          <>
            <span className="psh__badge">Смена закрыта</span>
            <span className="psh__state-item dsk__muted">
              Продажи недоступны, пока смена не открыта
            </span>
            <span className="dsk__spacer" />
            <button
              type="button"
              className="dsk__btn dsk__btn--primary"
              onClick={() => setDialog({ kind: 'open' })}
            >
              Открыть смену
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="dsk__error" role="alert">
          {error}
        </p>
      )}

      {/* ── Действия ── */}
      {open && shift && (
        <div className="dsk__bar">
          <button type="button" className="dsk__btn" onClick={() => setDialog({ kind: 'deposit' })}>
            Внесение
          </button>
          <button
            type="button"
            className="dsk__btn"
            onClick={() => setDialog({ kind: 'withdrawal' })}
          >
            Изъятие
          </button>
          <button type="button" className="dsk__btn" onClick={() => void printReport(shift.id, 'x')}>
            Промежуточный отчёт
          </button>
          <span className="dsk__spacer" />
          <button type="button" className="dsk__btn" onClick={() => void reload()}>
            Обновить
          </button>
          <button
            type="button"
            className="dsk__btn dsk__btn--danger"
            onClick={() => setDialog({ kind: 'close' })}
          >
            Закрыть смену
          </button>
        </div>
      )}

      {/* ── Показатели текущей смены ── */}
      {open && (
        <div className="dsk__stats">
          <Stat label="Чеков продажи" value={metrics && String(metrics.salesCount)} />
          <Stat label="Чеков возврата" value={metrics && String(metrics.refundsCount)} />
          <Stat label="Выручка" value={metrics && formatTiyin(metrics.revenueTiyin)} unit="сом" />
          <Stat label="Наличные" value={metrics && formatTiyin(metrics.cashTiyin)} unit="сом" />
          <Stat label="Карта" value={metrics && formatTiyin(metrics.cardTiyin)} unit="сом" />
          <Stat label="QR" value={metrics && formatTiyin(metrics.qrTiyin)} unit="сом" />
          <Stat label="Долг" value={metrics && formatTiyin(metrics.debtTiyin)} unit="сом" />
          <Stat
            label="Возвраты"
            value={metrics && formatTiyin(metrics.refundsTiyin)}
            unit="сом"
            tone={metrics && metrics.refundsTiyin > 0 ? 'bad' : undefined}
          />
          <Stat label="Средний чек" value={metrics && formatTiyin(metrics.avgCheckTiyin)} unit="сом" />
          {/* Скидки показываются, только если они были: строка «Скидки 0,00» —
              это шум, за которым теряются числа, которые смотрят. */}
          {metrics && metrics.discountsTiyin > 0 && (
            <Stat label="Скидки" value={formatTiyin(metrics.discountsTiyin)} unit="сом" />
          )}
        </div>
      )}

      <div className="dsk__split">
        {/* ── Движение денег в ящике ── */}
        <div className="dsk__pane">
          <h2 className="psh__pane-title">
            Движение денег в ящике
            {state && (
              <span className="psh__pane-note">
                внесено {formatTiyin(state.depositsTiyin)} · изъято{' '}
                {formatTiyin(state.withdrawalsTiyin)}
              </span>
            )}
          </h2>
          <div className="dsk__table">
            <div className="dsk__head psh__move-row" role="row">
              <span>Время</span>
              <span>Операция</span>
              <span>Причина</span>
              <span className="dsk__num">Сумма</span>
            </div>
            <div
              className="dsk__scroll"
              ref={movementKeys.scrollRef}
              tabIndex={0}
              onKeyDown={movementKeys.onKeyDown}
              role="grid"
              aria-label="Движение денег"
            >
              {!open ? (
                <div className="dsk__empty">
                  <strong>Смена закрыта</strong>
                  <span>Движения по ящику появятся, когда смену откроют.</span>
                </div>
              ) : movements.length === 0 ? (
                <div className="dsk__empty">
                  <strong>Движений нет</strong>
                  <span>
                    Здесь появятся внесения, изъятия и возвраты наличными. Продажи в этот список
                    не попадают — они в показателях выше.
                  </span>
                </div>
              ) : (
                movements.map((item, index) => (
                  <div key={item.id} {...movementKeys.rowProps(index)} role="row">
                    <span className="dsk__muted">{clock(item.createdAt)}</span>
                    <span>{MOVEMENT_LABELS[item.kind] ?? item.kind}</span>
                    <span className="dsk__ellipsis dsk__muted">
                      {item.reason}
                      {item.actorName && ` · ${item.actorName}`}
                    </span>
                    <span
                      className={`dsk__num ${item.amountTiyin < 0 ? 'dsk__bad' : 'dsk__good'}`}
                    >
                      {item.amountTiyin > 0 ? '+' : '−'}
                      {formatTiyin(Math.abs(item.amountTiyin))}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── История смен ── */}
        <div className="dsk__pane">
          <h2 className="psh__pane-title">История смен</h2>
          <div className="dsk__table">
            <div className="dsk__head psh__history-row" role="row">
              <span>№</span>
              <span>Открыта</span>
              <span>Кассир</span>
              <span className="dsk__num">Выручка</span>
              <span className="dsk__num">Наличные</span>
              <span className="dsk__num">Расхождение</span>
            </div>
            <div
              className="dsk__scroll"
              ref={historyKeys.scrollRef}
              tabIndex={0}
              onKeyDown={historyKeys.onKeyDown}
              role="grid"
              aria-label="История смен"
            >
              {loading ? (
                <SkeletonRows columns={6} />
              ) : history.length === 0 ? (
                <div className="dsk__empty">
                  <strong>Смен ещё не было</strong>
                  <span>Первая смена появится здесь, как только её закроют.</span>
                </div>
              ) : (
                history.map((row, index) => (
                  <div
                    key={row.id}
                    {...historyKeys.rowProps(index)}
                    role="row"
                    onClick={() => {
                      historyKeys.setIndex(index)
                      setOpenedHistory(row)
                    }}
                  >
                    <span className="dsk__num">{row.number}</span>
                    <span className="dsk__muted">{moment(row.openedAt)}</span>
                    <span className="dsk__ellipsis">{row.cashier || '—'}</span>
                    <span className="dsk__num">{formatTiyin(row.revenueTiyin)}</span>
                    <span className="dsk__num">{formatTiyin(row.cashTiyin)}</span>
                    <span className="dsk__num">
                      {row.status === 'open' ? (
                        <i className="dsk__tag dsk__tag--open">идёт</i>
                      ) : !row.reconciled ? (
                        <span className="dsk__muted">не сверяли</span>
                      ) : row.varianceTiyin === 0 ? (
                        <span className="dsk__muted">—</span>
                      ) : (
                        <span className={row.varianceTiyin < 0 ? 'dsk__bad' : 'dsk__warn'}>
                          {row.varianceTiyin > 0 ? '+' : '−'}
                          {formatTiyin(Math.abs(row.varianceTiyin))}
                        </span>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Карточка выбранной смены. Открывается Enter'ом или щелчком. */}
          {openedHistory && (
            <div className="dsk__card psh__card">
              <div className="dsk__bar">
                <strong className="dsk__card-title">Смена №{openedHistory.number}</strong>
                <span className="dsk__spacer" />
                <button
                  type="button"
                  className="dsk__btn"
                  onClick={() => setOpenedHistory(null)}
                >
                  Закрыть
                </button>
              </div>
              <div className="dsk__rows">
                <Pair label="Кассир" value={openedHistory.cashier || '—'} />
                <Pair label="Открыта" value={moment(openedHistory.openedAt)} />
                <Pair
                  label="Закрыта"
                  value={openedHistory.closedAt ? moment(openedHistory.closedAt) : 'ещё идёт'}
                />
                <Pair label="Выручка" value={`${formatTiyin(openedHistory.revenueTiyin)} сом`} />
                <Pair label="Наличные" value={`${formatTiyin(openedHistory.cashTiyin)} сом`} />
                <Pair
                  label="Безналичные"
                  value={`${formatTiyin(openedHistory.cashlessTiyin)} сом`}
                />
                <Pair label="Возвраты" value={`${formatTiyin(openedHistory.refundsTiyin)} сом`} />
                <Pair
                  label="Расхождение"
                  value={
                    !openedHistory.reconciled
                      ? 'сверка не проводилась'
                      : openedHistory.varianceTiyin === 0
                        ? 'сошлось'
                        : `${openedHistory.varianceTiyin < 0 ? 'недостача' : 'излишек'} ${formatTiyin(
                            Math.abs(openedHistory.varianceTiyin),
                          )} сом`
                  }
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <HotkeyBar
        hotkeys={hotkeys}
        status={open && shift ? `Смена №${shift.number} · ${formatTiyin(drawer)} сом в ящике` : 'Смена закрыта'}
      />

      {dialog?.kind === 'open' && (
        <OpenShiftDialog
          defaultCashier={cashierName}
          busy={busy}
          error={dialogError}
          onConfirm={doOpen}
          onClose={() => {
            setDialog(null)
            setDialogError('')
          }}
        />
      )}

      {(dialog?.kind === 'deposit' || dialog?.kind === 'withdrawal') && (
        <CashMovementDialog
          kind={dialog.kind}
          drawerTiyin={drawer}
          busy={busy}
          error={dialogError}
          onConfirm={(input) => void doMovement(dialog.kind as 'deposit' | 'withdrawal', input)}
          onClose={() => {
            setDialog(null)
            setDialogError('')
          }}
        />
      )}

      {dialog?.kind === 'close' && shift && (
        <CloseShiftDialog
          expectedTiyin={drawer}
          shiftNumber={shift.number}
          busy={busy}
          error={dialogError}
          onConfirm={doClose}
          onClose={() => {
            setDialog(null)
            setDialogError('')
          }}
        />
      )}
    </div>
  )
}

/* ── Мелочи ──────────────────────────────────────────────────────────── */

function Stat({
  label,
  value,
  unit,
  tone,
}: {
  label: string
  /** `undefined` — данные ещё не пришли, показываем скелетон той же высоты. */
  value: string | undefined | null
  unit?: string
  tone?: 'bad' | 'warn' | 'good'
}) {
  return (
    <div className="dsk__stat">
      <span className="dsk__stat-label">{label}</span>
      {value == null ? (
        <span className="dsk__skeleton" aria-hidden="true" />
      ) : (
        <strong className={`dsk__stat-value${tone ? ` dsk__stat-value--${tone}` : ''}`}>
          {value}
          {unit && <i className="dsk__stat-unit">{unit}</i>}
        </strong>
      )}
    </div>
  )
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="dsk__pair">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SkeletonRows({ columns }: { columns: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="dsk__row psh__history-row" key={index}>
          {Array.from({ length: columns }, (_, cell) => (
            <span className="dsk__skeleton" style={{ width: '70%' }} key={cell} />
          ))}
        </div>
      ))}
    </div>
  )
}
