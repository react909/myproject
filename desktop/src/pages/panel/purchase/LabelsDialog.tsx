/**
 * Печать ценников на товары проведённого документа.
 *
 * Выбор «все позиции или отмеченные» — это весь смысл окна: после прихода
 * ценники меняют не всем товарам, а тем, у кого поехала цена, и печатать пачку
 * лишних этикеток никто не станет.
 *
 * Печать идёт на ту же чековую ленту, что и чеки: отдельного принтера этикеток
 * у моноблока нет, а ценник на чековой ленте — обычная для小 магазина практика.
 */

import { useEffect, useState } from 'react'
import { DeskDialog } from '../DeskDialog'
import { useNotifications } from '../../../components/notifications/NotificationProvider'
import { loadSettings } from '../../../settings/appSettings'
import { printShiftCloseReceipt } from '../../../services/receiptPrint'
import { readOnboardingCached } from '../../../onboarding/storage'
import type { LabelRow } from '../../../services/purchases'
import { formatTiyin } from '../../../utils/money'

export function LabelsDialog({
  load,
  onClose,
}: {
  load: () => Promise<LabelRow[]>
  onClose: () => void
}) {
  const { push } = useNotifications()
  const [rows, setRows] = useState<LabelRow[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    load()
      .then((items) => {
        setRows(items)
        // По умолчанию отмечено всё: чаще печатают ценники на весь приход, и
        // заставлять отмечать сорок позиций руками значит не пользоваться этим.
        setPicked(new Set(items.map((_, index) => index)))
      })
      .catch((err: any) =>
        setError(err?.response?.data?.detail ?? err?.message ?? 'Не удалось получить ценники.'),
      )
  }, [load])

  const toggle = (index: number) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  const print = async () => {
    if (!rows) return
    const chosen = rows.filter((_, index) => picked.has(index))
    if (chosen.length === 0) return
    if (!loadSettings().printer.enabled) {
      setError('Принтер выключен. Включите его в настройках печати.')
      return
    }
    setBusy(true)
    setError('')
    try {
      /*
        Ценники печатаются ОДНОЙ лентой, а не по чеку на позицию.

        Сорок отдельных чеков — это сорок отрезов ленты и сорок ожиданий
        принтера; на приход в сорок позиций это минуты. Одна лента режется
        руками по строкам.
      */
      const result = await printShiftCloseReceipt({
        fiscal: readOnboardingCached(),
        receiptNumber: 'ЦЕННИКИ',
        date: new Date().toLocaleString('ru-RU'),
        lines: chosen.map((row) => ({
          name: `${row.name}${row.barcode ? ` · ${row.barcode}` : ''}`,
          sum: `${formatTiyin(row.priceTiyin)} сом`,
        })),
        total: `${chosen.length} шт`,
        paymentMethod: 'Ценники',
        cashier: '',
        thankYou: 'Разрежьте по строкам',
      })
      if (result.ok) {
        push({
          kind: 'success',
          title: 'Ценники',
          message: `Отправлено на печать: ${chosen.length}`,
          dismissMs: 4000,
        })
        onClose()
      } else {
        setError(result.message)
      }
    } catch (err: any) {
      setError(err?.message ?? 'Не удалось напечатать ценники.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DeskDialog
      title="Печать ценников"
      subtitle="Отметьте позиции, на которые нужны ценники"
      confirmLabel={`Печать (${picked.size})`}
      confirmDisabled={!rows || picked.size === 0}
      busy={busy}
      error={error}
      hint="Пробел — отметить, Enter — печать"
      onConfirm={() => void print()}
      onClose={onClose}
    >
      {rows === null ? (
        <span className="dsk__skeleton" style={{ width: '100%', height: 120 }} />
      ) : rows.length === 0 ? (
        <div className="dsk__empty">
          <strong>Печатать нечего</strong>
          <span>
            Ни у одной позиции документа не указана розничная цена. Ценник без цены хуже, чем его
            отсутствие.
          </span>
        </div>
      ) : (
        <>
          <div className="dsk__bar">
            <button
              type="button"
              className="dsk__btn"
              onClick={() => setPicked(new Set(rows.map((_, index) => index)))}
            >
              Все
            </button>
            <button type="button" className="dsk__btn" onClick={() => setPicked(new Set())}>
              Снять отметки
            </button>
          </div>
          <div className="ppu__labels">
            {rows.map((row, index) => (
              <label className="ppu__label-row" key={`${row.productId}-${index}`}>
                <input
                  type="checkbox"
                  checked={picked.has(index)}
                  onChange={() => toggle(index)}
                />
                <span className="dsk__ellipsis">{row.name}</span>
                <span className="dsk__num">{formatTiyin(row.priceTiyin)}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </DeskDialog>
  )
}
