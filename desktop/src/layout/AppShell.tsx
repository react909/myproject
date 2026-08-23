/**
 * Каркас приложения: общая шапка над любой страницей.
 *
 * Раньше шапка была только на кассе — её рисовал сам экран кассы. Из-за этого
 * на панели, в настройках и в отчётах не было ни логотипа магазина, ни часов,
 * ни кнопок окна: свернуть или закрыть приложение с экрана настроек было
 * нечем, а на моноблоке в киоске это единственные такие кнопки. Вместе с
 * шапкой оттуда пропадали и скрытые жесты — удержание логотипа и тапы по
 * часам, — то есть попасть в служебные настройки можно было только вернувшись
 * на кассу.
 *
 * Поэтому шапка живёт здесь, в маршруте-обёртке, а страницы отрисовываются
 * внутрь. Копий у неё нет и быть не должно: страница, которой нужна своя
 * панель инструментов (заголовок, вкладки, кнопка «назад»), рисует её под
 * общей шапкой, а не вместо неё.
 *
 * Живые числа кассы — вес, сумма к оплате, смена — приходят снизу вверх, от
 * самой кассы (см. headerShowcase). Шапка не знает ни одного экрана поимённо.
 */

import { useMemo } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { OwnerAccessDialog, SpecialistAccessDialog } from '../auth/AccessDialog'
import { useHiddenAccess } from '../auth/useHiddenAccess'
import { captureOwnerEntry } from '../services/entryPhoto'
import { useFullscreen } from '../hooks/useFullscreen'
import { useOnboarding } from '../onboarding/useOnboarding'
import { AppHeader } from './AppHeader'
import { headerBrandView } from './HeaderBrand'
import { HeaderModeProvider } from './headerMode'
import { HeaderShowcaseSink, useHeaderShowcaseState } from './headerShowcase'

export type AppShellProps = {
  username: string
  onLogout: () => void
}

export function AppShell({ username, onLogout }: AppShellProps) {
  const navigate = useNavigate()
  // Скрытые жесты живут в каркасе, а не на кассе: аккорд и удержание логотипа
  // обязаны работать на любой странице, где эта шапка есть.
  const hiddenAccess = useHiddenAccess()
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen()
  const store = useOnboarding({ refresh: false })
  // Числа кассы. Хранилище само гасит повторные публикации с теми же
  // значениями — см. useHeaderShowcaseState.
  const { showcase, publish } = useHeaderShowcaseState()

  /*
    Состав шапки решает одно место на всё приложение — им же пользуются
    предпросмотры в редакторах, поэтому настройка и шапка не расходятся.

    Реквизиты магазина сюда больше не передаются. Раньше здесь стояло
    `storeDisplayName(store)`, и название торговой точки с первого шага
    попадало в шапку программы: магазин «Глобус» — программа «Глобус». В шапке
    стоит бренд системы (Kassir ERP или название, заданное клиентом на шаге
    оформления), а реквизиты печатаются в чеке, где им и место.

    Зависимость — от `store.branding`, а не от всего `store`: шапка меняется
    только от оформления, и пересобирать её на каждую правку адреса незачем.
  */
  const brand = useMemo(() => headerBrandView(store.branding), [store.branding])

  return (
    <HeaderShowcaseSink.Provider value={publish}>
      {/* Режим шапки объявляет страница, а не каркас: см. headerMode. */}
      <HeaderModeProvider>
      <div className="screen-shell">
        <AppHeader
          username={username}
          showcase={showcase ?? undefined}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => void toggleFullscreen()}
          onMinimize={() => void window.electronAPI?.minimize?.()}
          onOpenPanel={() => navigate('/panel')}
          onOpenReceiptsJournal={() => navigate('/panel?tab=receipts')}
          onOpenSettings={() => navigate('/settings')}
          onLogout={onLogout}
          onCloseApp={() => void window.electronAPI?.close?.()}
          brand={brand}
          hiddenAccess={hiddenAccess}
        />

        {/*
          Два окна, а не одно на обе роли. Владелец приходит своим аккордом
          (Ctrl+Shift+M), специалист — цепочкой жестов на логотипе, и каждый
          вводит свой секрет в своё окно: так одна опечатка тратит только свой
          лимит попыток. Секреты у них тоже разные и не взаимозаменяемы:
          лицензионный ключ не открывает кабинет владельца, пароль владельца не
          открывает сервисный режим.

          Специалист после ключа возвращается в тот же мастер, который
          проходили при установке, — не на отдельный экран настроек: он приехал
          поправить оформление или чек и правит их там же, где заводил.
        */}
        {hiddenAccess.pending === 'specialist' && (
          <SpecialistAccessDialog
            onUnlocked={() => {
              hiddenAccess.clear()
              navigate('/service')
            }}
            onCancel={hiddenAccess.clear}
          />
        )}

        {/* Владелец после пароля попадает в свой кабинет, а не в панель смены:
            панель это журнал чеков и товары, денег в ней нет и не будет. */}
        {hiddenAccess.pending === 'owner' && (
          <OwnerAccessDialog
            onUnlocked={() => {
              hiddenAccess.clear()
              // Снимок вошедшего — след, а не защита: дверь уже открылась, и
              // ждать фотографию незачем. Разбор — в services/entryPhoto.ts.
              captureOwnerEntry(store.branding.hasCamera)
              navigate('/owner')
            }}
            onCancel={hiddenAccess.clear}
          />
        )}

        {/*
          Отсчёт удержания — без единого слова о том, что происходит.

          Подпись «Удерживайте логотип — откроются скрытые настройки» здесь была
          и была ошибкой: она объясняла секретный жест вслух любому, кто в этот
          момент смотрит на экран. Кассиру достаточно один раз увидеть её
          случайно, чтобы дальше пробовать самому, — а весь смысл цепочки в том,
          что о ней не догадаться.

          Остаётся полоса заполнения. Тому, кто держит осознанно, она говорит
          ровно то, что нужно: идёт, не отпускай. Тому, кто задел логотип
          случайно, — ничего.
        */}
        {hiddenAccess.longPressProgress > 0 && (
          <div className="acc-longpress" role="presentation">
            <span
              className="acc-longpress__fill"
              style={{ transform: `scaleX(${hiddenAccess.longPressProgress})` }}
            />
          </div>
        )}

        {/*
          Тело каркаса. Высоту делит с шапкой, а не отсчитывает от окна: пока
          страницы мерили себя в 100vh, шапка добавлялась к полной высоте
          экрана, и низ страницы уезжал под нижний край.

          Прокрутка здесь, потому что страницы делятся на два рода: касса и
          панель держат свою высоту сами и прокручивают внутренние области, а
          отчёты и журнал чеков растут вниз. Первым это правило ничего не
          меняет, вторым даёт прокрутку, не задевающую шапку.
        */}
        <div className="app-shell__body">
          <Outlet />
        </div>
      </div>
      </HeaderModeProvider>
    </HeaderShowcaseSink.Provider>
  )
}
