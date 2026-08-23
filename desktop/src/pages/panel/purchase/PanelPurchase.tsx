/**
 * Раздел «Закупка».
 *
 * Два экрана в одном разделе — список документов и открытый документ, — а не
 * два маршрута. Причина простая: из документа возвращаются в список постоянно
 * (провёл, вернулся, открыл следующий), и адресная строка при этом не значит
 * ничего: панель и так живёт внутри `?tab=`.
 *
 * Опасные действия — проведение и отмена проведения — спрашивают подтверждение
 * ЗДЕСЬ, а не в редакторе: редактор рисует документ, а решение о том, что
 * применить к складу, принимает раздел.
 */

import { useCallback, useEffect, useState } from 'react'
import { HotkeyBar } from '../HotkeyBar'
import type { Hotkey } from '../HotkeyBar'
import { isAbortError } from '../../../api/errors'
import { useNotifications } from '../../../components/notifications/NotificationProvider'
import { fetchSuppliers } from '../../../services/suppliers'
import type { SupplierRow } from '../../../services/suppliers'
import {
  createDoc,
  fetchDoc,
  fetchLabels,
  fetchSoldAfter,
  postDoc,
  saveDoc,
  unpostDoc,
} from '../../../services/purchases'
import type { DocKind, DocRow, PurchaseDoc, SoldAfterRow } from '../../../services/purchases'
import { formatQty, formatTiyin } from '../../../utils/money'
import { DeskConfirm } from '../DeskConfirm'
import { PurchaseList } from './PurchaseList'
import { PurchaseDocEditor } from './PurchaseDocEditor'
import { LabelsDialog } from './LabelsDialog'
import '../deskCommon.css'
import './PanelPurchase.css'

export function PanelPurchase() {
  const { push } = useNotifications()
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [doc, setDoc] = useState<PurchaseDoc | null>(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [selected, setSelected] = useState<DocRow | null>(null)
  const [labels, setLabels] = useState<{ docId: number } | null>(null)
  /** Какое опасное действие ждёт подтверждения. */
  const [confirm, setConfirm] = useState<
    { kind: 'post' } | { kind: 'unpost'; sold: SoldAfterRow[] } | { kind: 'leave' } | null
  >(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchSuppliers({ signal: controller.signal })
      .then(setSuppliers)
      .catch((err: any) => {
        if (isAbortError(err)) return
        push({
          kind: 'warning',
          title: 'Поставщики',
          message: 'Справочник поставщиков не загрузился — выбрать поставщика не получится.',
          dismissMs: 7000,
        })
      })
    return () => controller.abort()
  }, [push])

  const openDoc = useCallback(
    async (id: number) => {
      try {
        setDoc(await fetchDoc(id))
        setDirty(false)
      } catch (err: any) {
        push({
          kind: 'error',
          title: 'Закупка',
          message: err?.response?.data?.detail ?? 'Не удалось открыть документ.',
          dismissMs: 7000,
        })
      }
    },
    [push],
  )

  /**
   * Создать документ.
   *
   * У возврата поставщику есть отдельный, самый частый путь: в списке выбран
   * проведённый приход, и возвращают именно из него. Тогда новый документ
   * заводится УЖЕ ЗАПОЛНЕННЫМ — тот же поставщик, те же товары и те же цены,
   * — и кассиру остаётся поправить количества.
   *
   * Набирать возврат руками, глядя в соседнее окно с приходом, — это ровно тот
   * способ ошибиться в цене, из-за которого потом не сходится расчёт с
   * поставщиком.
   */
  const create = useCallback(
    async (kind: DocKind) => {
      setBusy(true)
      try {
        const source =
          kind === 'return' && selected?.status === 'posted' && selected.kind === 'purchase'
            ? await fetchDoc(selected.id)
            : null

        const created = await createDoc({
          supplierId: source?.supplierId ?? null,
          docDate: new Date().toISOString(),
          invoiceNumber: '',
          comment: source ? `Возврат по документу №${source.number}` : '',
          settlement: source?.settlement ?? 'paid',
          dueDate: null,
          kind,
          sourceDocId: source?.id ?? null,
          lines:
            source?.lines.map((line) => ({
              productId: line.productId,
              name: line.name,
              barcode: line.barcode,
              unit: line.unit,
              qty: line.qty,
              costTiyin: line.costTiyin,
              // Розничную цену возврат не трогает — и в строке её быть не
              // должно, иначе проведение попробовало бы её применить.
              retailTiyin: 0,
            })) ?? [],
        })
        setDoc(created)
        setDirty(false)
        if (source) {
          push({
            kind: 'info',
            title: 'Возврат поставщику',
            message: `Заполнено из прихода №${source.number}. Поправьте количества.`,
            dismissMs: 6000,
          })
        }
      } catch (err: any) {
        push({
          kind: 'error',
          title: 'Закупка',
          message: err?.response?.data?.detail ?? 'Не удалось создать документ.',
          dismissMs: 7000,
        })
      } finally {
        setBusy(false)
      }
    },
    [push, selected],
  )

  const save = useCallback(
    async (input: Parameters<typeof saveDoc>[1]) => {
      if (!doc) return null
      setBusy(true)
      try {
        const saved = await saveDoc(doc.id, input)
        setDoc(saved)
        setReloadToken((token) => token + 1)
        return saved
      } catch (err: any) {
        push({
          kind: 'error',
          title: 'Закупка',
          message: err?.response?.data?.detail ?? 'Не удалось сохранить документ.',
          dismissMs: 7000,
        })
        return null
      } finally {
        setBusy(false)
      }
    },
    [doc, push],
  )

  /**
   * Провести.
   *
   * Черновик сначала сохраняется, и только потом проводится: иначе провелось
   * бы то, что лежит на сервере, а не то, что человек видит на экране.
   * Подтверждение спрашивается ДО сохранения: отказ не должен оставлять на
   * сервере наполовину применённое.
   */
  const post = useCallback(async () => {
    if (!doc) return
    setBusy(true)
    try {
      const posted = await postDoc(doc.id)
      setDoc(posted)
      setDirty(false)
      setReloadToken((token) => token + 1)
      push({
        kind: 'success',
        title: 'Закупка',
        message: `Документ №${posted.number} проведён. Остатки обновлены.`,
        dismissMs: 5000,
      })
    } catch (err: any) {
      push({
        kind: 'error',
        title: 'Закупка',
        message: err?.response?.data?.detail ?? 'Не удалось провести документ.',
        dismissMs: 8000,
      })
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }, [doc, push])

  /**
   * Спросить перед отменой проведения.
   *
   * Сначала узнаём у сервера, что из документа уже продано, и показываем это
   * человеку. Запрещать отмену нельзя: товар мог быть продан по ошибке, и
   * тогда отмена — как раз то, что нужно. Дело системы — показать, что именно
   * уйдёт в минус, а решение оставить за человеком.
   */
  const askUnpost = useCallback(async () => {
    if (!doc) return
    setBusy(true)
    try {
      const sold = await fetchSoldAfter(doc.id)
      setConfirm({ kind: 'unpost', sold })
    } catch (err: any) {
      push({
        kind: 'error',
        title: 'Закупка',
        message: err?.response?.data?.detail ?? 'Не удалось проверить продажи по документу.',
        dismissMs: 8000,
      })
    } finally {
      setBusy(false)
    }
  }, [doc, push])

  const unpost = useCallback(async () => {
    if (!doc) return
    setBusy(true)
    try {
      const canceled = await unpostDoc(doc.id)
      setDoc(canceled)
      setReloadToken((token) => token + 1)
      push({
        kind: 'success',
        title: 'Закупка',
        message: 'Проведение отменено, остатки и цены возвращены.',
        dismissMs: 5000,
      })
    } catch (err: any) {
      push({
        kind: 'error',
        title: 'Закупка',
        message: err?.response?.data?.detail ?? 'Не удалось отменить проведение.',
        dismissMs: 8000,
      })
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }, [doc, push])

  /* ── Полоса подсказок ────────────────────────────────────────────────── */

  const hotkeys: Hotkey[] = doc
    ? [
        { keys: 'F2', action: 'Сохранить', off: doc.status !== 'draft' },
        { keys: 'F4', action: 'Провести', off: doc.status !== 'draft' },
        { keys: 'Enter', action: 'Следующая строка', off: doc.status !== 'draft' },
        { keys: '↑↓←→', action: 'По ячейкам', off: doc.status !== 'draft' },
        { keys: 'Ins', action: 'Добавить строку', off: doc.status !== 'draft' },
        { keys: 'Del', action: 'Удалить строку', off: doc.status !== 'draft' },
        { keys: 'Esc', action: 'К списку' },
      ]
    : [
        { keys: '↑↓', action: 'По документам' },
        { keys: 'Enter', action: 'Открыть' },
        { keys: 'Home/End', action: 'В начало / в конец' },
        { keys: 'PgUp/PgDn', action: 'На страницу' },
      ]

  const status = doc
    ? `${doc.kind === 'return' ? 'Возврат' : 'Закупка'} №${doc.number} · ${
        doc.status === 'draft' ? 'черновик' : doc.status === 'posted' ? 'проведён' : 'отменён'
      }${dirty ? ' · есть несохранённые правки' : ''}`
    : selected
      ? `№${selected.number} · ${formatTiyin(selected.totalTiyin)} сом`
      : undefined

  return (
    <div className="dsk ppu">
      {doc ? (
        <PurchaseDocEditor
          doc={doc}
          suppliers={suppliers}
          busy={busy}
          onDirtyChange={setDirty}
          onSave={save}
          onPost={() => setConfirm({ kind: 'post' })}
          onUnpost={() => void askUnpost()}
          onPrintLabels={() => setLabels({ docId: doc.id })}
          onClose={() => {
            if (dirty) {
              setConfirm({ kind: 'leave' })
              return
            }
            setDoc(null)
          }}
        />
      ) : (
        <PurchaseList
          suppliers={suppliers}
          reloadToken={reloadToken}
          onOpen={(id) => void openDoc(id)}
          onCreate={(kind) => void create(kind)}
          onSelectionChange={setSelected}
        />
      )}

      <HotkeyBar hotkeys={hotkeys} status={status} />

      {labels && (
        <LabelsDialog
          load={() => fetchLabels(labels.docId)}
          onClose={() => setLabels(null)}
        />
      )}

      {confirm?.kind === 'post' && (
        <DeskConfirm
          title={`Провести документ №${doc?.number}`}
          message={
            doc?.kind === 'return'
              ? 'Остатки по товарам документа уменьшатся, задолженность перед поставщиком скорректируется. Отменить проведение можно будет отдельно.'
              : 'Остатки увеличатся, себестоимость пересчитается средневзвешенной, а указанные розничные цены применятся к товарам.'
          }
          confirmLabel="Провести"
          busy={busy}
          onConfirm={() => void post()}
          onClose={() => setConfirm(null)}
        />
      )}

      {confirm?.kind === 'unpost' && (
        <DeskConfirm
          title={`Отменить проведение №${doc?.number}`}
          message={
            confirm.sold.length
              ? 'Часть товаров документа уже продана. Отмена вычтет приход, и остаток по ним может уйти в минус.'
              : 'Остатки и цены вернутся к тому, что было до проведения. Документ перейдёт в отменённые.'
          }
          details={
            confirm.sold.length > 0 && (
              <div className="dcf__list">
                {confirm.sold.map((row) => (
                  <div className="dcf__list-row" key={row.productId}>
                    <span>{row.name}</span>
                    <span>
                      продано {formatQty(row.qty)} · чеков {row.receipts}
                    </span>
                  </div>
                ))}
              </div>
            )
          }
          confirmLabel="Отменить проведение"
          danger
          busy={busy}
          onConfirm={() => void unpost()}
          onClose={() => setConfirm(null)}
        />
      )}

      {confirm?.kind === 'leave' && (
        <DeskConfirm
          title="Выйти без сохранения"
          message="В документе есть правки, которых нет на сервере. Если выйти сейчас, они пропадут."
          confirmLabel="Выйти"
          danger
          onConfirm={() => {
            setConfirm(null)
            setDoc(null)
            setDirty(false)
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
