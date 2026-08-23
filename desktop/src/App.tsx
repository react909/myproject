// App.tsx — логин / первый запуск + роутинг (локальный Offline POS)

import { useEffect, useRef, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LoginScreen, type LoginScreenHandle } from './auth/LoginScreen'
import { restoreStoredSession } from './auth/sessionRestore'
import { OnboardingWizard } from './onboarding/OnboardingWizard'
import { ServiceWizardRoute } from './onboarding/ServiceWizardRoute'
import { clearOnboardingCache, fetchOnboarding } from './onboarding/storage'
import { ActivationScreen } from './auth/ActivationScreen'
import { AccessGate } from './auth/AccessDialog'
import { lockAccess } from './auth/accessKeys'
import { lockPin, pinErrorText } from './auth/servicePin'
import { ConfirmPasswordModal } from './settings/ConfirmPasswordModal'
import { VirtualKeyboard } from './virtual-keyboard/VirtualKeyboard'
import { SettingsPage } from './settings/SettingsPage'
import { useSystemSettings } from './hooks/useSystemSettings'
import { useStoreTheme } from './hooks/useStoreTheme'
import { useVirtualKeyboardFocus } from './hooks/useVirtualKeyboardFocus'
import { PrinterSection } from './settings/sections/PrinterSection'
import { SystemSection } from './settings/sections/SystemSection'
import { UpdatesSection } from './settings/sections/UpdatesSection'
import { DiagnosticsSection } from './settings/sections/DiagnosticsSection'
import { DisplaySection } from './settings/sections/DisplaySection'
import { HeavyPageGate } from './pages/HeavyPageGate'
import { LoadingScreen } from './pages/LoadingScreen'
import { PanelPage } from './pages/panel/PanelPage'
import { AppShell } from './layout/AppShell'
import { DashboardPage } from './pages/DashboardPage'
import { OwnerCabinetPage } from './pages/Owner/OwnerCabinetPage'
import { NotificationProvider } from './components/notifications/NotificationProvider'
import { PosConnectionProvider } from './context/PosConnectionProvider'
import { clearAccountSession } from './services/accountSession'
import { runPosInit } from './services/posInit'
import { readProductsCacheStaleOk } from './services/products'
import { apiGet, apiPost } from './api/client'
import type { Product } from './catalog/mockProducts'
import './style.css'

type UserSession = { user: { username: string } }

type PosBootState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  message: string
  products: Product[]
  warnings: string[]
}

type SetupGate = 'loading' | 'needs_setup' | 'needs_reactivation' | 'ready' | 'backend_error'

export function App() {
  useSystemSettings()
  /*
    Оформление магазина — без всяких условий и до входа.

    Прежний хук ждал сессию (`useAccentColor(!!session)`) и красил ровно две
    переменные из девяти. Из-за первого экран входа и активации оставались
    заводскими, из-за второго на самой кассе перекрашивалась часть элементов, а
    остальные держали янтарный цвет.
  */
  useStoreTheme()
  const [setupGate, setSetupGate] = useState<SetupGate>('loading')
  const [setupToken, setSetupToken] = useState<string | null>(null)
  const [setupCheckNonce, setSetupCheckNonce] = useState(0)
  // A completed offline setup persists its local session. Do not send a
  // cashier back to the legacy login screen on every application restart.
  const [session, setSession] = useState<UserSession | null>(() => {
    const restored = restoreStoredSession()
    return restored ? { user: restored } : null
  })
  const [posBoot, setPosBoot] = useState<PosBootState>({
    status: 'idle',
    message: '',
    products: [],
    warnings: [],
  })
  const [message, setMessage] = useState('Введите логин и нажмите «Войти».')
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  useVirtualKeyboardFocus(setKeyboardOpen)
  const loginScreenRef = useRef<LoginScreenHandle | null>(null)
  const activeInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setSetupGate('loading')
    setSetupToken(null)

    const checkSetup = async () => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          const res = await apiGet('/api/setup/status')
          if (cancelled) return
          if (res.data?.needs_setup) setSetupGate('needs_setup')
          else if (res.data?.needs_reactivation) setSetupGate('needs_reactivation')
          else setSetupGate('ready')
          return
        } catch {
          if (cancelled) return
          await new Promise((resolve) => window.setTimeout(resolve, 500))
        }
      }
      if (!cancelled) setSetupGate('backend_error')
    }

    void checkSetup()
    return () => {
      cancelled = true
    }
  }, [setupCheckNonce])

  useEffect(() => {
    if (!session) {
      setPosBoot({ status: 'idle', message: '', products: [], warnings: [] })
      return undefined
    }

    const controller = new AbortController()
    setPosBoot({
      status: 'loading',
      message: 'Проверка локального сервера…',
      products: [],
      warnings: [],
    })

    // Реквизиты нужны кассиру для печати чека, а его аккаунт мастер установки
    // не проходил — тянем их сразу после входа, а не только после регистрации.
    void fetchOnboarding().catch(() => undefined)

    void runPosInit(
      (progress) => {
        setPosBoot((prev) => ({ ...prev, message: progress.message }))
      },
      controller.signal,
    )
      .then((result) => {
        setPosBoot({
          status: 'ready',
          message: '',
          products: result.products,
          warnings: result.warnings,
        })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const errMessage =
          err && typeof err === 'object' && 'message' in err && typeof (err as { message: string }).message === 'string'
            ? (err as { message: string }).message
            : 'Не удалось подготовить кассу'
        setPosBoot({
          status: 'error',
          message: errMessage,
          products: readProductsCacheStaleOk(),
          warnings: [errMessage],
        })
      })

    return () => controller.abort()
  }, [session?.user.username])

  // Прямой выход — без пароля. Используется там, где спрашивать его нельзя:
  // на экране «касса не поднялась» сервер может быть недоступен, и проверка
  // пароля заперла бы человека в неработающем приложении.
  const handleLogout = () => {
    // Закрываем все три двери разом: смену передают другому человеку.
    lockAccess()
    lockPin()
    // Реквизиты — данные магазина, а не пользователя, но держать их в
    // localStorage после выхода незачем: следующий вход всё равно тянет свежие.
    clearOnboardingCache()
    clearAccountSession()
    setSession(null)
  }

  // Обычный выход из шапки: смена пользователя — это передача кассы другому
  // человеку, поэтому уходящий подтверждает, что это действительно он.
  const [logoutPrompt, setLogoutPrompt] = useState(false)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutError, setLogoutError] = useState('')

  const confirmLogout = async (password: string) => {
    setLogoutBusy(true)
    setLogoutError('')
    try {
      await apiPost('/api/auth/verify-password', { password })
      setLogoutPrompt(false)
      handleLogout()
      setMessage('Вы вышли из аккаунта. Введите логин и нажмите «Войти».')
    } catch (caught) {
      setLogoutError(pinErrorText(caught))
    } finally {
      setLogoutBusy(false)
    }
  }

  // api/client.ts wipes the stored token on any 401 but never told the UI —
  // without this, the app kept rendering the last screen with a session
  // that no longer has a token, so every subsequent request silently fails
  // auth ("Требуется авторизация.") no matter what the user does.
  useEffect(() => {
    const onAuthExpired = () => {
      clearAccountSession()
      setSession(null)
      setMessage('Сессия истекла — войдите снова.')
    }
    window.addEventListener('nurcrm-auth-expired', onAuthExpired)
    return () => window.removeEventListener('nurcrm-auth-expired', onAuthExpired)
  }, [])

  const keyboard = (
    <VirtualKeyboard
      isOpen={keyboardOpen}
      onOpenChange={setKeyboardOpen}
      onEnter={
        !session && setupGate === 'ready'
          ? () => void loginScreenRef.current?.submit()
          : undefined
      }
    />
  )

  if (setupGate === 'loading') {
    return (
      <>
        <div className="screen-shell">
          <LoadingScreen title="Запуск…" subtitle="Подключение к локальному серверу" />
        </div>
        {keyboard}
      </>
    )
  }

  if (setupGate === 'backend_error') {
    return (
      <>
        <div className="screen-shell">
          <LoadingScreen
            title="Локальный сервер не запустился"
            subtitle="Перезапустите приложение или нажмите «Повторить». Интернет не требуется."
          />
          <div className="bottom-message" role="status">
            <button
              type="button"
              onClick={() => setSetupCheckNonce((value) => value + 1)}
            >
              Повторить
            </button>
          </div>
        </div>
        {keyboard}
      </>
    )
  }

  if (setupGate === 'needs_reactivation') {
    return (
      <>
        <div className="screen-shell">
          {/* Полосы .bottom-message здесь нет: она принадлежит экрану входа
              и показывает «Введите логин и нажмите Войти» — на активации это
              бессмысленно, а место она отнимает у самого экрана. Свои ошибки
              ActivationScreen показывает внутри карточки. */}
          <ActivationScreen
            mode="reactivate"
            onReactivated={() => setSetupGate('ready')}
            onNotify={setMessage}
          />
        </div>
        {keyboard}
      </>
    )
  }

  if (setupGate === 'needs_setup') {
    if (!setupToken) {
      return (
        <>
          <div className="screen-shell">
            <ActivationScreen
              mode="activate"
              onActivated={setSetupToken}
              onNotify={setMessage}
            />
          </div>
          {keyboard}
        </>
      )
    }

    return (
      <>
        <div className="screen-shell">
          {/* Мастер занимает экран целиком. Полосы .bottom-message здесь нет
              намеренно: она принадлежит экрану входа, показывает «Введите
              логин и нажмите Войти» и к установке отношения не имеет, а 26 px
              отъедала у списка, из-за чего нижние карточки шага обрезались.
              Свои ошибки мастер показывает в собственном подвале. */}
          <OnboardingWizard
            setupToken={setupToken}
            onDone={(username) => {
              setSetupGate('ready')
              setSession({ user: { username } })
              setMessage(`Настройка завершена. Добро пожаловать, ${username}.`)
            }}
            onNotify={setMessage}
          />
        </div>
        {keyboard}
      </>
    )
  }

  if (!session) {
    return (
      <>
        <div className="screen-shell">
          <LoginScreen
            ref={loginScreenRef}
            activeInputRef={activeInputRef}
            onSuccess={(username) => {
              setMessage(`Касса готова, ${username}.`)
              setSession({ user: { username } })
            }}
            onNotify={setMessage}
          />
          <div className="bottom-message" role="status">
            {message}
          </div>
        </div>
        {keyboard}
      </>
    )
  }

  if (posBoot.status === 'error' && posBoot.products.length === 0) {
    return (
      <>
        <div className="screen-shell">
          <LoadingScreen
            title="Не удалось подготовить кассу"
            subtitle={posBoot.message || 'Проверьте локальный сервер и повторите вход'}
          />
          <div className="bottom-message" role="status">
            <button type="button" onClick={handleLogout}>
              Выйти и повторить
            </button>
          </div>
        </div>
        {keyboard}
      </>
    )
  }

  if (posBoot.status === 'loading') {
    return (
      <>
        <div className="screen-shell">
          <LoadingScreen
            title="Подготовка кассы…"
            subtitle={posBoot.message || 'Каталог, устройства'}
          />
        </div>
        {keyboard}
      </>
    )
  }

  const posReady = posBoot.status === 'ready'
  const initWarnings = posBoot.warnings

  return (
    <NotificationProvider>
      <PosConnectionProvider>
        <HashRouter>
        <Routes>
          {/* Маршрут-обёртка: общая шапка над каждой страницей. Своей шапки
              приложения у экранов нет — они рисуют только собственные панели
              инструментов под этой. */}
          <Route
            element={
              <AppShell
                username={session.user.username}
                onLogout={() => {
                  setLogoutError('')
                  setLogoutPrompt(true)
                }}
              />
            }
          >
          <Route
            path="/"
            element={
              <DashboardPage
                username={session.user.username}
                initialProducts={posBoot.products}
                posReady={posReady}
                initWarnings={initWarnings}
              />
            }
          />

          <Route
            path="/panel"
            element={
              <HeavyPageGate
                loadingTitle="Панель управления…"
                loadingSubtitle="Подготовка разделов и фильтров"
              >
                <PanelPage />
              </HeavyPageGate>
            }
          />

          {/*
            Обычные настройки — ежедневная работа смены, и пароля здесь не
            спрашивают. Раньше весь раздел был закрыт дверью владельца: кассир
            упирался в запрос пароля, чтобы выбрать принтер или поменять размер
            шрифта на чеке. Секретов внутри не осталось — техника уехала к
            специалисту, деньги к владельцу, — и запирать больше нечего.
          */}
          <Route path="/settings" element={<SettingsPage />}>
            {/*
              Маршруты обычных настроек совпадают с меню (SettingsSidebar).
              Реквизиты, весы и оплата отсюда убраны целиком, а не спрятаны:
              они живут в сервисном мастере за дверью специалиста. Оставленный
              маршрут без пункта меню — это та же открытая дверь, просто без
              вывески, и попасть в неё можно было бы прямой ссылкой.
            */}
            <Route index element={<Navigate to="/settings/printer" replace />} />
            <Route path="requisites" element={<Navigate to="/settings/printer" replace />} />
            <Route path="connection" element={<Navigate to="/settings/printer" replace />} />
            <Route path="scale" element={<Navigate to="/settings/printer" replace />} />
            <Route path="payment" element={<Navigate to="/settings/printer" replace />} />
            <Route path="printer" element={<PrinterSection />} />
            <Route path="display" element={<DisplaySection />} />
            {/*
              Сотрудники переехали в кабинет владельца целиком — вместе с
              финансами и аналитикой, к которым они и относятся. Здесь остаётся
              переадресация: закладка на старый адрес не должна упираться в
              пустой экран, но и своей копии раздела в настройках больше нет.
            */}
            <Route path="users" element={<Navigate to="/owner?tab=staff" replace />} />
            <Route path="system" element={<SystemSection />} />
            <Route path="updates" element={<UpdatesSection />} />
            <Route path="diagnostics" element={<DiagnosticsSection />} />
          </Route>

          {/*
            Кабинет владельца — отдельная страница с тремя разделами.

            Открывается аккордом Ctrl+Shift+M и паролем владельца (см. AppShell).
            Внутри каркаса, а не рядом с ним: шапка с логотипом, часами и
            кнопками окна нужна и здесь — на моноблоке в киоске это единственный
            способ свернуть или закрыть приложение.

            AccessGate решает только, что рисовать. Сами разделы ходят в
            маршруты за require_owner, и без открытой двери сервер откажет им
            независимо от интерфейса.
          */}
          <Route
            path="/owner"
            element={
              <AccessGate
                kind="owner"
                caption="Аналитика, финансы и сотрудники — только для владельца."
              >
                <OwnerCabinetPage />
              </AccessGate>
            }
          />

          {/* Прежние адреса разделов ведут в кабинет: они жили порознь, пока
              кабинета не было. Своей двери у них больше нет — она одна на весь
              кабинет, и открывать её трижды подряд незачем. */}
          <Route path="/finance" element={<Navigate to="/owner?tab=finance" replace />} />
          <Route path="/analytics" element={<Navigate to="/owner?tab=analytics" replace />} />
          {/* Журнал чеков живёт в панели вкладкой, а не отдельной страницей.
              Свой экран у него был, пока панель держала три вкладки
              смонтированными разом; теперь раздел один и открывается прямо. */}
          <Route path="/receipts" element={<Navigate to="/panel?tab=receipts" replace />} />

          <Route path="*" element={<Navigate to="/" replace />} />
          </Route>

          {/*
            Сервисный проход мастера — вне общего каркаса: мастер занимает
            экран целиком, и шапка кассы с плитками «К оплате» на нём лишняя.
            За дверью специалиста: сессия живёт в sessionStorage, поэтому
            перезапуск приложения закрывает проход сам.
          */}
          <Route
            path="/service"
            element={
              <AccessGate
                kind="specialist"
                caption="Настройки установки: оборудование, оформление, чек."
              >
                <ServiceWizardRoute />
              </AccessGate>
            }
          />
        </Routes>
      </HashRouter>
      </PosConnectionProvider>
      {logoutPrompt && (
        <ConfirmPasswordModal
          title="Выход из аккаунта"
          description={`Подтвердите, что это вы, ${session.user.username}. Смена закроется на этом устройстве, и войти сможет другой сотрудник.`}
          fieldLabel="Ваш пароль входа"
          confirmLabel="Выйти"
          busy={logoutBusy}
          error={logoutError}
          onConfirm={(password) => void confirmLogout(password)}
          onCancel={() => {
            setLogoutPrompt(false)
            setLogoutError('')
          }}
        />
      )}
      {keyboard}
    </NotificationProvider>
  )
}
