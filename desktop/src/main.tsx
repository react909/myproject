import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { CustomerDisplayApp } from './customer-display/CustomerDisplay'
import { installGlobalErrorLogging } from './services/reportError'
import { startFrameHeartbeat } from './services/frameHeartbeat'
import { applyStoredTheme } from './auth/applyTheme'
import './style.css'

/*
  Фирменный цвет — до первого кадра, а не после.

  Здесь, в самом начале модуля, потому что ниже по файлу уже идёт отрисовка, а
  между ней и этой строкой браузер ничего не показывает. Читается синхронно из
  localStorage: сходить за цветом на сервер — значит показать кассиру вспышку
  стандартной мяты и перекрасить экран у него на глазах.

  Магазин, где мастер ещё не проходили, попадает сюда без кэша — и правильно
  остаётся на стандартном #00f5bc из styles/tokens.css.
*/
applyStoredTheme()

// Ошибки в промисах и обработчиках событий граница React не видит — она ловит
// только рендер. Ставим глобальные слушатели до отрисовки, чтобы падение при
// старте тоже попало в журнал.
installGlobalErrorLogging()

/*
  Отметки «страница рисуется» — для главного процесса.

  Ловят то, чего не ловит ни граница ошибок, ни системные события: касса
  простояла несколько часов, и экран побелел. Рендерер при этом жив и на любой
  вопрос отвечает — застыла картинка. Видно это только по кадрам, поэтому
  отметка ставится из цикла кадров, а не по таймеру.

  Здесь, а не внутри React: отсчёт не должен зависеть от того, что происходит с
  деревом компонентов, — упавшее дерево тем более нуждается в лечении.
*/
startFrameHeartbeat()

const root = document.querySelector<HTMLDivElement>('#app')!

/**
 * Окно на втором мониторе загружает то же приложение, но ему не нужны ни
 * логин, ни мастер установки: там стоит покупатель, а не кассир. Развилка
 * здесь, до всего остального, — иначе экран клиента упёрся бы в форму входа.
 */
const isCustomerDisplay = window.location.hash.startsWith('#/customer-display')

/*
  Внешняя граница ошибок — последняя защита от белого экрана. Внутренние
  границы (мастер установки, экраны кассы) перехватят падение раньше и дадут
  вернуться, не теряя остального; эта ловит то, что случилось выше них.
*/
const app = (
  <ErrorBoundary scope="app">
    {isCustomerDisplay ? <CustomerDisplayApp /> : <App />}
  </ErrorBoundary>
)
const tree = import.meta.env.PROD ? app : <React.StrictMode>{app}</React.StrictMode>

ReactDOM.createRoot(root).render(tree)
