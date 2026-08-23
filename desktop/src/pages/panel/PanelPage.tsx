/**
 * Панель управления.
 *
 * Устройство, а не вид:
 *
 * • Ряд разделов живёт В ШАПКЕ ПРИЛОЖЕНИЯ — два ряда, листающихся как одна
 *   сетка, плюс отдельная кнопка «Добавить товар». Он там помещается ровно
 *   потому, что у кнопок нет вторых строк-подписей: подписи уехали в заголовок
 *   страницы (см. PanelSectionRail.css).
 *
 * • Шапка раздела (название и подпись) — обычный блок в потоке, не липкая. На
 *   моноблоке высота экрана дефицит, и постоянная полоса над таблицей отняла
 *   бы пять строк из двадцати.
 *
 * • Разделы не висят все смонтированными. Прежняя панель держала три вкладки в
 *   разметке «чтобы не терять данные»: каждая при открытии панели ходила за
 *   своими данными, и журнал чеков грузился, даже когда человек зашёл добавить
 *   товар.
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useDeclareHeaderMode } from '../../layout/headerMode'
import { ProductReportModalProvider } from '../../context/ProductReportModalProvider'
import { PanelProductFilterProvider, usePanelProductFilter } from './PanelProductFilterContext'
import { PanelProductPage } from './product/PanelProductPage'
import { PanelProductReportPage } from '../PanelProductReportPage'
import { PanelHeaderNav } from './PanelHeaderNav'
import { PanelJournal } from './PanelJournal'
import { PanelShift } from './shift/PanelShift'
import { PanelPurchase } from './purchase/PanelPurchase'
import { PanelSuppliers } from './suppliers/PanelSuppliers'
import { panelSectionById, panelSectionFrom } from './panelSections'
import type { PanelSectionId } from './panelSections'
import './PanelPage.css'

/**
 * Разделы рабочего места: они держат свою высоту сами.
 *
 * Внутри у них таблицы со своей прокруткой и полоса подсказок клавиш, прибитая
 * к низу. Такому разделу нужна КОНЕЧНАЯ высота, а не «сколько получится»:
 * иначе полоса подсказок уезжает под нижний край окна, а таблица растёт вниз
 * без конца и прокручивает страницу целиком.
 */
const DESK_SECTIONS = new Set<PanelSectionId>([
  'shift',
  'purchase',
  'suppliers',
  'add-product',
])

/**
 * Поля, у которых пробел — это символ, а не команда.
 *
 * Проверяется цель события, а не флаг «мы в режиме ввода»: флаг рано или
 * поздно разойдётся с тем, где на самом деле стоит фокус, и пробел перестанет
 * печататься посреди названия товара.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    // Пробел на кнопке — это её нажатие, и отбирать его нельзя.
    target instanceof HTMLButtonElement
  )
}

function PanelPageBody() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { productKind, setProductKind } = usePanelProductFilter()

  const section = panelSectionFrom(searchParams.get('tab'))
  const meta = panelSectionById(section)
  const desk = DESK_SECTIONS.has(section)

  const setSection = useCallback(
    (next: PanelSectionId) => {
      setSearchParams({ tab: next }, { replace: true })
    },
    [setSearchParams],
  )

  /*
    Шапка приложения на время панели: ряд разделов и «Добавить товар».

    `useMemo` не для скорости, а чтобы объявление режима не перезапускалось на
    каждую отрисовку — см. useDeclareHeaderMode.
  */
  const mode = useMemo(
    () => ({
      center: (
        <PanelHeaderNav
          active={section}
          onSelect={setSection}
          onAddProduct={() => setSection('add-product')}
        />
      ),
      compactActions: true,
      // Возврат к продажам — в общей шапке, а не в шапке раздела: она есть на
      // каждой странице панели, и путь назад не может потеряться вместе с
      // содержимым раздела. Именно так он и пропал при прошлой переделке.
      back: { label: 'Касса', onClick: () => navigate('/') },
    }),
    [section, setSection, navigate],
  )
  useDeclareHeaderMode(mode, [section])

  /*
    Пробел открывает «Добавить товар».

    Слушатель на окне, но с тремя оговорками, без которых он ломает ввод:

      • в любом поле ввода пробел печатает пробел — иначе нельзя набрать
        название из двух слов, а это большинство названий;
      • на кнопке пробел нажимает кнопку — так работает клавиатура везде;
      • при открытом окне ввода не срабатывает вовсе: там свои клавиши.

    `preventDefault` обязателен: иначе пробел заодно прокрутит страницу вниз.
  */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.code !== 'Space') return
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return
      if (isTyping(event.target)) return
      // Открытое окно ввода перехватывает клавиши на себя.
      if (document.querySelector('.dlg')) return
      event.preventDefault()
      setSection('add-product')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setSection])

  return (
    <div className="pnl">
      <div className={`pnl__view${desk ? ' pnl__view--desk' : ''}`}>
        {/*
          Шапка раздела. Здесь и живут подробные подписи, снятые с кнопок в
          шапке приложения: на кнопке их читают краем глаза, здесь — внимательно.

          У разделов рабочего места она в одну строку: под ними таблицы со
          своей прокруткой, и каждая отданная строка — это строка таблицы.
        */}
        <header className={`pnl__head${desk ? ' pnl__head--tight' : ''}`}>
          <h1 className="pnl__title">{meta.label}</h1>
          <p className="pnl__caption">{meta.caption}</p>
        </header>

        {/* Смонтирован только открытый раздел. */}
        <div className="pnl__body">
          {section === 'receipts' && <PanelJournal />}
          {section === 'product-report' && (
            <PanelProductReportPage active productKind={productKind} onProductKind={setProductKind} />
          )}
          {section === 'add-product' && <PanelProductPage />}
          {section === 'shift' && <PanelShift />}
          {section === 'purchase' && <PanelPurchase />}
          {section === 'suppliers' && <PanelSuppliers />}
        </div>
      </div>
    </div>
  )
}

export function PanelPage() {
  return (
    <PanelProductFilterProvider>
      <ProductReportModalProvider>
        <PanelPageBody />
      </ProductReportModalProvider>
    </PanelProductFilterProvider>
  )
}
