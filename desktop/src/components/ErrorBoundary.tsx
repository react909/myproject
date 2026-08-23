/**
 * Граница ошибок: вместо белого экрана — понятный экран с текстом ошибки.
 *
 * Зачем именно так. При необработанном исключении в рендере React снимает всё
 * дерево целиком — остаётся пустая страница, и кассир видит белый экран без
 * единой подсказки, что делать. Смена не продолжается, а по телефону сказать
 * нечего: текста ошибки нет нигде.
 *
 * Граница ловит такие исключения, показывает, что именно сломалось, и даёт
 * два выхода: вернуться к работе (сбросив сломанный участок) или перезагрузить
 * приложение. Ошибка при этом уходит в файл лога — см. reportError.
 *
 * Класс, а не хук: ловить ошибки рендера в React умеют только компоненты с
 * componentDidCatch, функционального эквивалента нет.
 */

import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { errorText, reportError } from '../services/reportError'
import './ErrorBoundary.css'

type Props = {
  /** Что именно огорожено — попадает в лог и помогает найти место. */
  scope: string
  /**
   * Показывать кнопку «Вернуться». Сбрасывает границу и пробует отрисовать
   * содержимое заново — помогает, когда упало на конкретных данных, а общее
   * состояние приложения цело.
   */
  onReset?: () => void
  children: ReactNode
}

type State = { error: Error | null; details: string }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, details: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(`ErrorBoundary:${this.props.scope}`, error, {
      componentStack: info.componentStack,
    })
    this.setState({ details: info.componentStack ?? '' })
  }

  private reset = () => {
    this.setState({ error: null, details: '' })
    this.props.onReset?.()
  }

  render(): ReactNode {
    const { error, details } = this.state
    if (!error) return this.props.children

    return (
      <div className="eb" role="alert">
        <div className="eb__card">
          <span className="eb__icon" aria-hidden="true">
            !
          </span>
          <h1 className="eb__title">Что-то пошло не так</h1>
          <p className="eb__lead">
            Приложение не смогло отрисовать этот экран. Данные не потеряны — уже введённое
            сохранено. Попробуйте вернуться назад; если повторится, перезапустите приложение.
          </p>

          {/* Текст ошибки виден на экране намеренно: без него разработчику
              передают «просто белый экран», и найти причину нечем. */}
          <pre className="eb__error">{errorText(error)}</pre>

          {details && (
            <details className="eb__details">
              <summary>Подробности для разработчика</summary>
              <pre>{details}</pre>
            </details>
          )}

          <p className="eb__hint">
            Ошибка записана в журнал. Настройки → Диагностика → «Собрать логи в архив» — и файл
            можно отправить разработчику.
          </p>

          <div className="eb__actions">
            <button type="button" className="eb__btn" onClick={this.reset}>
              Вернуться
            </button>
            <button
              type="button"
              className="eb__btn eb__btn--primary"
              onClick={() => window.location.reload()}
            >
              Перезагрузить приложение
            </button>
          </div>
        </div>
      </div>
    )
  }
}
