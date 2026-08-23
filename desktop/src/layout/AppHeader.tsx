import { showsHint } from '../auth/hiddenAccessGate'
import { useClock } from '../hooks/useClock'
import { useNotifications } from '../components/notifications/NotificationProvider'
import { HeaderBrand } from './HeaderBrand'
import type { HeaderBrandView } from './HeaderBrand'
import { useHeaderMode } from './headerMode'
import type { HeaderShowcase } from './headerShowcase'

function IcoBack() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M19 12H5m0 0 7 7m-7-7 7-7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IcoPanel() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 4h7v7H4V4zM13 4h7v7h-7V4zM4 13h7v7H4v-7zM13 13h7v7h-7v-7z"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IcoBell() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3a5 5 0 0 0-5 5v2.5c0 .9-.3 1.8-.9 2.5L5 15.5h14l-1.1-2.5c-.6-.7-.9-1.6-.9-2.5V8a5 5 0 0 0-5-5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function IcoSettings() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852 1.003 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IcoLogout() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M10 17H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 12H3M20 12l-4-4M20 12l-4 4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IcoMinimize() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 12h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function IcoExpand() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 2h6M2 2v6M22 2h-6M22 2v6M2 22h6M2 22v-6M22 22h-6M22 22v-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IcoExitFullscreen() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4.5 4.5L12 12M19.5 4.5L12 12M4.5 19.5L12 12M19.5 19.5L12 12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IcoClose() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function IcoReceipts() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 2h16v22l-3-2-2 2-2-2-2 2-2-2-3 2V2z"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinejoin="round"
      />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
    </svg>
  )
}

export type AppHeaderProps = {
  username: string
  /**
   * Живые числа кассы: вес, сумма к оплате, состояние смены.
   *
   * Их нет, когда открыта не касса, а панель, настройки или отчёт, — и это
   * нормальное состояние шапки, а не отсутствие данных. Витрина в середине
   * тогда не рисуется вовсе: показать «К оплате 0,00» на экране настроек
   * значит соврать, а не промолчать.
   */
  showcase?: HeaderShowcase
  isFullscreen: boolean
  onToggleFullscreen: () => void
  onMinimize: () => void
  /** Центр управления: финансы / аналитика / чеки — одна точка входа */
  onOpenPanel: () => void
  /** Журнал чеков в панели */
  onOpenReceiptsJournal?: () => void
  onOpenSettings: () => void
  onLogout: () => void
  onCloseApp: () => void
  /**
   * Что стоит в шапке: знак, надпись и их компоновка. Уже разрешённый вид —
   * решает его `headerBrandView`, единственное место, где реквизиты
   * превращаются в состав шапки.
   */
  brand: HeaderBrandView
  /**
   * Скрытый вход специалиста: серия тапов и удержание — оба жеста на логотипе.
   *
   * Шапка о правилах входа не знает и знать не должна: она только передаёт
   * знаку обработчики. Что считается тапом, когда начинается отсчёт и после
   * чего он вообще возможен — целиком в useHiddenAccess.
   */
  hiddenAccess?: {
    longPressHandlers: {
      onPointerDown: () => void
      onPointerUp: () => void
      onPointerLeave: () => void
      onContextMenu: (event: { preventDefault: () => void }) => void
    }
    /** 0…1 — сколько уже держат логотип. Ноль, пока вход не взведён. */
    longPressProgress?: number
  }
}

/*
 * Кольца прогресса вокруг логотипа здесь больше нет намеренно. Жест скрытый:
 * кольцо видел любой кассир, дожимал из любопытства и упирался в запрос ключа,
 * которого у него нет. Теперь знак едва заметно темнеет с третьей секунды —
 * порог живёт в правилах входа (hiddenAccessGate), рядом с длительностью
 * удержания, чтобы эти два числа не разошлись.
 *
 * Без взведённого аккорда сюда не доходит вовсе: отсчёт не запускается, и доля
 * остаётся нулевой.
 */

function formatKg(kg: number): string {
  return (kg >= 0 ? kg : 0).toFixed(3).replace('.', ',')
}

/*
 * Разбора фона логотипа здесь больше нет.
 *
 * Раньше шапка смотрела на края картинки и подкладывала под тёмный знак
 * светлую плашку. Плашка и была тем «белым квадратом вокруг круглого
 * логотипа»: файл к тому моменту уже приезжал с запечённым белым фоном (его
 * заливала обрезка), край читался как светлый, и поверх добавлялась рамка.
 *
 * Теперь обрезка сохраняет прозрачность, а в редакторе есть «Убрать белый
 * фон» — знак ложится прямо на шапку, без подложек и рамок.
 */

export function AppHeader({
  username,
  showcase,
  isFullscreen,
  onToggleFullscreen,
  onMinimize,
  onOpenPanel,
  onOpenReceiptsJournal,
  onOpenSettings,
  onLogout,
  onCloseApp,
  brand,
  hiddenAccess,
}: AppHeaderProps) {
  const { unreadCount, toggleCenter } = useNotifications()
  // Что рисовать в середине и в правой части — объявляет сам экран, см.
  // headerMode. Шапка страниц по имени не различает.
  const mode = useHeaderMode()
  const now = useClock()
  const holdProgress = hiddenAccess?.longPressProgress ?? 0
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const scaleDisplayKg = showcase?.scaleDisplayKg ?? null
  const scaleKgStr =
    scaleDisplayKg != null && Number.isFinite(scaleDisplayKg) && scaleDisplayKg > 0
      ? formatKg(scaleDisplayKg)
      : '—'
  const rubStr = (showcase?.totalRub ?? 0).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const canFix =
    !!showcase?.scaleEnabled &&
    showcase.scaleWeightStable &&
    scaleDisplayKg != null &&
    scaleDisplayKg > 0

  return (
    <header className="app-header">
      <div className="app-header__left">
        {/* Логотип — вход в скрытые настройки: и пять быстрых тапов, и
            удержание. Оба жеста на одном знаке, а не разнесены по шапке:
            объяснять их специалисту по телефону приходится вслепую. Ни один из
            них не работает и ничем себя не выдаёт, пока не взведён аккорд. */}
        <div className="app-header__brand" {...(hiddenAccess?.longPressHandlers ?? {})}>
          {/* Состав блока решён заранее — см. headerBrandView. Здесь его не
              пересобирают: пока условие «что показывать» жило и в шапке, и в
              настройке, они расходились. */}
          <HeaderBrand view={brand} holding={showsHint(holdProgress)} />
          <div className="app-header__brand-text">
            {/* Часы снова просто часы: жест переехал на логотип целиком. */}
            <time
              className="app-header__clock-mono"
              dateTime={now.toISOString()}
              aria-live="polite"
              aria-atomic="true"
            >
              {hh}:{mm}:{ss}
            </time>
          </div>
        </div>

        {/*
          Возврат на кассу — сразу за брендом, первым в шапке.

          Отдельно от выхода из аккаунта и намеренно непохоже на него: одна
          кнопка возвращает к продажам, другая завершает смену, и путать их
          нельзя. Выход стоит у правого края, красный, со значком двери; эта —
          слева, со стрелкой и словом «Касса».
        */}
        {mode.back && (
          <button
            type="button"
            className="app-header__back"
            onClick={mode.back.onClick}
            title="Вернуться к продажам"
          >
            <IcoBack />
            <span>{mode.back.label}</span>
          </button>
        )}
      </div>

      {/*
        Середина шапки занята одним из двух.

        Экран может объявить свой ряд кнопок (см. headerMode) — тогда витрина
        уступает ему место целиком. Так устроена панель управления: сумма «К
        оплате» там не показывается вовсе, а освободившуюся ширину занимают
        разделы. Шапка при этом не знает ни одной страницы по имени: она просто
        рисует то, что ей объявили.
      */}
      {mode.center ? (
        <div className="app-header__center">{mode.center}</div>
      ) : (
      /* Витрина только там, где есть что показывать: вес и сумма живут на
         кассе, а не в настройках или в отчёте. Пустая середина в шапке — это
         честно, «К оплате 0,00» на чужом экране — нет. */
      <div
        className="app-header__showcase"
        aria-live="polite"
        aria-label={
          showcase ? `Вес на весах ${scaleKgStr} кг, к оплате ${rubStr} рублей` : undefined
        }
      >
        {showcase?.scaleEnabled && (
          <div
            className={`app-header__showcase-tile app-header__showcase-tile--weight${showcase.scaleWeightStable ? ' app-header__showcase-tile--stable' : ''}`}
          >
            <span className="app-header__showcase-label">Вес на весах, кг</span>
            <div className="app-header__weight-stack">
              <span
                className={`app-header__showcase-value app-header__showcase-value--kg${scaleKgStr === '—' ? ' app-header__showcase-value--empty' : ''}${scaleDisplayKg != null ? ' app-header__showcase-value--live-on' : ''}`}
              >
                {scaleKgStr}
              </span>
              <button
                type="button"
                className={`app-header__fix-weight${canFix ? ' app-header__fix-weight--ready' : ''}`}
                disabled={!canFix}
                onClick={showcase.onFixScaleWeight}
                title={
                  canFix
                    ? 'Зафиксировать устойчивый вес и добавить в чек'
                    : scaleDisplayKg != null && scaleDisplayKg > 0
                      ? 'Подождите, пока вес перестанет меняться (~3 сек)'
                      : 'Положите товар на весы'
                }
              >
                Зафиксировать
              </button>
            </div>
          </div>
        )}

        {showcase && (
          <div className="app-header__showcase-tile app-header__showcase-tile--pay">
            <span className="app-header__showcase-label">К оплате</span>
            <span className="app-header__showcase-value app-header__showcase-value--rub">{rubStr} сом</span>
          </div>
        )}
      </div>
      )}

      <div className="app-header__right">
        {/*
          Свёрнутый набор — не косметика.

          В панели управления каждая убранная кнопка либо ведёт туда, где мы уже
          стоим (сама панель), либо открывает то, что здесь открыто вкладкой
          (журнал чеков), либо показывает данные другого экрана (сумма смены в
          чипе кассира). Остаются настройки и выход — единственные два действия,
          которые с панели действительно нужны.
        */}
        {!mode.compactActions && (
          <>
            <div className="cashier-chip" aria-label={`Кассир: ${username}`}>
              <div className="cashier-chip__avatar">{username.charAt(0).toUpperCase()}</div>
              <div className="cashier-chip__info">
                <span className="cashier-chip__name">{username}</span>
                {/* Состояние смены знает только касса. На других страницах строки
                    нет вовсе: «Смена закрыта» там было бы утверждением, которого
                    шапка в этот момент проверить не может. */}
                {showcase && (
                  <span className="cashier-chip__sub">
                    {showcase.shiftOpen
                      ? `${showcase.salesCount} транзакций · ${showcase.shiftRevenue.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} сом`
                      : 'Смена закрыта'}
                  </span>
                )}
              </div>
            </div>

            <div className="header-sep" aria-hidden="true" />
          </>
        )}

        <div className="header-tray">
          <div className="header-btns">
            {!mode.compactActions && (
              <>
                <button type="button" className="header-btn header-btn--panel" onClick={onOpenPanel} title="Панель управления" aria-label="Панель управления">
                  <IcoPanel />
                </button>

                {onOpenReceiptsJournal && (
                  <button
                    type="button"
                    className="header-btn"
                    onClick={onOpenReceiptsJournal}
                    title="Журнал чеков"
                    aria-label="Журнал чеков"
                  >
                    <IcoReceipts />
                  </button>
                )}

                <button
                  type="button"
                  className="header-btn header-btn--notify"
                  onClick={toggleCenter}
                  title="Уведомления"
                  aria-label={`Уведомления${unreadCount ? `, непрочитано ${unreadCount}` : ''}`}
                >
                  <IcoBell />
                  {unreadCount > 0 ? <span className="header-btn__badge">{unreadCount > 9 ? '9+' : unreadCount}</span> : null}
                </button>
              </>
            )}

            <button type="button" className="header-btn" onClick={onOpenSettings} title="Настройки" aria-label="Настройки">
              <IcoSettings />
            </button>

            <button
              type="button"
              className="header-btn header-btn--logout"
              onClick={onLogout}
              title="Выйти из аккаунта"
              aria-label="Выйти"
            >
              <IcoLogout />
            </button>
          </div>

          <div className="window-controls" aria-label="Управление окном">
            <button type="button" className="wctrl-btn wctrl-btn--minimize" onClick={onMinimize} title="Свернуть" aria-label="Свернуть окно">
              <IcoMinimize />
            </button>

            <button
              type="button"
              className={`wctrl-btn wctrl-btn--fullscreen${isFullscreen ? ' is-active' : ''}`}
              onClick={onToggleFullscreen}
              title={isFullscreen ? 'Выйти из полного экрана' : 'Полный экран'}
              aria-label={isFullscreen ? 'Выйти из полного экрана' : 'Полный экран'}
              aria-pressed={isFullscreen}
            >
              {isFullscreen ? <IcoExitFullscreen /> : <IcoExpand />}
            </button>

            <button type="button" className="wctrl-btn wctrl-btn--close" onClick={onCloseApp} title="Закрыть приложение" aria-label="Закрыть приложение">
              <IcoClose />
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
