/**
 * Кабинет владельца — отдельная страница, а не вкладка и не модалка.
 *
 * Три раздела и ровно три: аналитика, финансы, сотрудники. Всё, что владелец
 * смотрит один, и ничего из того, чем занята смена. Обычная панель управления
 * (журнал чеков, отчёт товаров, добавление товара) живёт своей жизнью на
 * `/panel` — денег и трендов там нет и не появится.
 *
 * Почему собственный маршрут. Кабинет открывается своим секретом и живёт своей
 * сессией: модалка поверх кассы означала бы, что за ней всё это время открыт
 * экран продаж, а вкладка внутри настроек — что попасть в деньги можно, гуляя
 * по обычным настройкам. Отдельный адрес ещё и закрывается по-человечески:
 * «Выйти из режима» уводит на кассу и гасит дверь на сервере.
 *
 * Права проверяет сервер, а не эта страница. Все три раздела ходят в маршруты
 * за `require_owner` (backend/app/core/access.py), и прямой запрос без открытой
 * двери получает отказ независимо от того, что нарисовано на экране. Обёртка
 * `AccessGate` в маршрутах решает, что показывать, — не более.
 */

import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { lockAccess } from '../../auth/accessKeys'
import { AnalyticsPage } from '../Analytics/AnalyticsPage'
import { FinancePage } from '../Finance/FinancePage'
import { UsersSection } from '../../settings/sections/UsersSection'
import { PanelProductFilterProvider } from '../panel/PanelProductFilterContext'
import { ProductReportModalProvider } from '../../context/ProductReportModalProvider'
import { OwnerEntryLog } from './OwnerEntryLog'
import { OwnerSkeleton } from './OwnerSkeleton'
import './OwnerCabinetPage.css'

/*
 * Разделов стало четыре, и это отступление от изначального требования
 * «только три: аналитика, финансы, сотрудники».
 *
 * Четвёртый — журнал входов со снимками. Смотреть их больше негде, а смысл
 * фотофиксации целиком в том, чтобы владелец их видел: снимок, который никто не
 * открывает, следом не работает. Свернуть его внутрь «Сотрудников» я не стал —
 * там заводят кассиров, а это журнал, и соседство путало бы оба.
 */
type OwnerTab = 'analytics' | 'finance' | 'staff' | 'entries'

const VALID_TABS: OwnerTab[] = ['analytics', 'finance', 'staff', 'entries']

/** Куда попадает владелец, открывший кабинет без параметров. */
const DEFAULT_TAB: OwnerTab = 'analytics'

const IcAnalytics = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" />
    <path d="M7 15l4-5 3 3 5-7" />
  </svg>
)
const IcFinance = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="20" height="13" rx="2.5" />
    <circle cx="12" cy="12.5" r="2.75" />
    <path d="M6 10v5M18 10v5" />
  </svg>
)
const IcStaff = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3.4" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16.5 5.2a3.4 3.4 0 0 1 0 5.6M18 20a6.5 6.5 0 0 0-2.2-4.9" />
  </svg>
)
const IcEntries = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round">
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <circle cx="12" cy="12" r="3.2" />
    <path d="M8 5l1.4-2h5.2L16 5" />
  </svg>
)
const IcArrow = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2.2"
       strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5m0 0 7 7m-7-7 7-7" />
  </svg>
)

const TABS: {
  id: OwnerTab
  label: string
  sub: string
  Icon: () => ReactElement
}[] = [
  { id: 'analytics', label: 'Аналитика', sub: 'Тренды · Показатели', Icon: IcAnalytics },
  { id: 'finance', label: 'Финансы', sub: 'Выручка · Расходы', Icon: IcFinance },
  { id: 'staff', label: 'Сотрудники', sub: 'Кассиры · PIN · Права', Icon: IcStaff },
  { id: 'entries', label: 'Кто заходил', sub: 'Снимки входов', Icon: IcEntries },
]

function OwnerCabinetBody() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get('tab') as OwnerTab
  const tab: OwnerTab = VALID_TABS.includes(raw) ? raw : DEFAULT_TAB

  /**
   * Разделы, которые уже открывали.
   *
   * Монтируются по первому заходу и дальше остаются: возврат на аналитику не
   * должен пересчитывать её заново. Но и все три сразу монтировать нельзя —
   * это три тяжёлых запроса к базе в момент, когда владелец смотрит на один
   * раздел, и открытие кабинета упиралось бы в самый медленный из них.
   */
  const [visited, setVisited] = useState<Set<OwnerTab>>(() => new Set([tab]))

  const openTab = (next: OwnerTab) => {
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)))
    setSearchParams({ tab: next }, { replace: true })
  }

  const leave = () => {
    // Закрываем дверь, а не просто уходим со страницы: повышенная сессия живёт
    // на сервере своим сроком и ещё десять минут пускала бы прямые запросы.
    lockAccess('owner')
    navigate('/', { replace: true })
  }

  const current = useMemo(() => TABS.find((item) => item.id === tab) ?? TABS[0], [tab])

  return (
    <div className="ocab">
      <header className="ocab__header">
        <div className="ocab__header-left">
          <Link to="/" className="ocab__back">
            <IcArrow />
            <span>Касса</span>
          </Link>
          <div className="ocab__divider" aria-hidden />
          <div>
            <p className="ocab__title">Кабинет владельца</p>
            <p className="ocab__subtitle">Аналитика · Финансы · Сотрудники · Кто заходил</p>
          </div>
        </div>

        <div className="ocab__header-right">
          {/* Прямая кнопка выхода из режима. Без неё дверь закрывалась бы только
              по бездействию, и уехавший владелец оставлял бы кассу открытой. */}
          <button type="button" className="ocab__leave" onClick={leave}>
            Выйти из режима
          </button>
        </div>

        <nav className="ocab__mobile-tabs" aria-label="Разделы кабинета">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => openTab(id)}
              className={`ocab__mobile-tab${tab === id ? ' ocab__mobile-tab--on' : ''}`}
            >
              <Icon />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="ocab__body">
        <aside className="ocab__sidebar" aria-label="Разделы кабинета">
          <p className="ocab__sidebar-label">Раздел</p>
          <nav className="ocab__nav">
            {TABS.map(({ id, label, sub, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => openTab(id)}
                className={`ocab__nav-item${tab === id ? ' ocab__nav-item--on' : ''}`}
                aria-current={tab === id ? 'page' : undefined}
              >
                <span className="ocab__nav-icon"><Icon /></span>
                <span className="ocab__nav-body">
                  <span className="ocab__nav-label">{label}</span>
                  <span className="ocab__nav-sub">{sub}</span>
                </span>
                {tab === id && <span className="ocab__nav-bar" aria-hidden />}
              </button>
            ))}
          </nav>

          <p className="ocab__note">
            Разделы кабинета видны только по паролю владельца. Смена работает в кассе и в панели
            управления — деньги ей там не показываются.
          </p>
        </aside>

        <main className="ocab__main" aria-label={current.label}>
          {/*
            Скрытые разделы остаются в разметке, но не показываются: hidden
            вместо размонтирования сохраняет уже посчитанное. Переключение между
            разделами при этом ничего не запрашивает заново и не моргает.
          */}
          {visited.has('analytics') && (
            <div className="ocab__pane" hidden={tab !== 'analytics'}>
              <AnalyticsPage />
            </div>
          )}
          {visited.has('finance') && (
            <div className="ocab__pane" hidden={tab !== 'finance'}>
              <FinancePage />
            </div>
          )}
          {visited.has('staff') && (
            <div className="ocab__pane ocab__pane--plain" hidden={tab !== 'staff'}>
              <UsersSection />
            </div>
          )}
          {visited.has('entries') && (
            <div className="ocab__pane" hidden={tab !== 'entries'}>
              <OwnerEntryLog />
            </div>
          )}
          {/* Раздел ещё не смонтирован — держим место скелетоном, чтобы переход
              не показывал пустоту в кадре между нажатием и отрисовкой. */}
          {!visited.has(tab) && <OwnerSkeleton chart={tab === 'analytics' || tab === 'finance'} />}
        </main>
      </div>
    </div>
  )
}

/**
 * Финансы и аналитика читают фильтр «весовые / штучные» и модалку отчёта из
 * тех же контекстов, что панель управления. В панели их даёт `PanelPage`, и без
 * этих обёрток разделы падали бы здесь на первом же обращении к контексту.
 */
export function OwnerCabinetPage() {
  return (
    <PanelProductFilterProvider>
      <ProductReportModalProvider>
        <OwnerCabinetBody />
      </ProductReportModalProvider>
    </PanelProductFilterProvider>
  )
}
