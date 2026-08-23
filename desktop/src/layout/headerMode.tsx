/**
 * Режим шапки: что она показывает на текущем экране.
 *
 * Шапка одна на всё приложение (см. AppShell), но экраны у неё разные, и
 * набор кнопок у них тоже разный. Пока набор был жёстким, панель управления
 * несла в шапке всё то же, что касса: сумму «К оплате», которой на панели нет,
 * email аккаунта, иконку перехода в панель, где мы и так находимся, и иконку
 * журнала чеков, который в панели открыт вкладкой. Места под то, что панели
 * действительно нужно, не оставалось.
 *
 * Устроено снизу вверх, как и числа кассы (headerShowcase): страница объявляет
 * свой режим, шапка о страницах не знает и по имени их не различает. Иначе
 * пришлось бы вписывать в шапку условие про каждый новый экран.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/** Что шапка показывает вместо обычного набора. */
export type HeaderMode = {
  /**
   * Явный возврат на кассу — слева, первым, всегда видимый.
   *
   * Не «крестик» и не выход из аккаунта. При переделке панели кнопка «← Касса»
   * пропала вместе со старой шапкой раздела, и вернуться к продажам можно было
   * только выйдя из аккаунта — для магазина это остановка работы. Поэтому
   * возврат живёт в общей шапке: она есть на каждой странице панели, и путь
   * назад не может потеряться вместе с содержимым раздела.
   */
  back?: { label: string; onClick: () => void }
  /**
   * Ряд кнопок-разделов на месте витрины.
   *
   * Приходит готовым узлом, а не описанием: разделы знает страница, а шапка
   * только отводит им место. Пусто — витрина работает как обычно.
   */
  center?: ReactNode
  /**
   * Свернуть правую часть до необходимого.
   *
   * `true` оставляет настройки и выход, убирая чип кассира, переход в панель,
   * журнал чеков и уведомления. Не «спрятать лишнее ради красоты»: каждая из
   * убранных кнопок на панели либо ведёт туда, где мы уже стоим, либо
   * показывает то, чего на этом экране нет.
   */
  compactActions?: boolean
}

const EMPTY: HeaderMode = {}

const HeaderModeValue = createContext<HeaderMode>(EMPTY)
const HeaderModeSink = createContext<(mode: HeaderMode | null) => void>(() => {})

export function HeaderModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<HeaderMode | null>(null)
  const value = mode ?? EMPTY
  return (
    <HeaderModeSink.Provider value={setMode}>
      <HeaderModeValue.Provider value={value}>{children}</HeaderModeValue.Provider>
    </HeaderModeSink.Provider>
  )
}

/** Что шапке рисовать сейчас. Читает только сама шапка. */
export function useHeaderMode(): HeaderMode {
  return useContext(HeaderModeValue)
}

/**
 * Объявить режим шапки на время жизни экрана.
 *
 * Снимается при размонтировании — обязательно и без условий: иначе панель,
 * закрытая переходом на кассу, оставила бы шапку без витрины и без кнопок.
 *
 * `center` в зависимостях намеренно нет: это узел JSX, он новый на каждой
 * отрисовке, и по нему эффект перезапускался бы бесконечно. Вместо него —
 * `deps`, которые передаёт вызывающий: там перечислено то, от чего ряд
 * действительно зависит (какой раздел выбран).
 */
export function useDeclareHeaderMode(mode: HeaderMode, deps: unknown[]): void {
  const setMode = useContext(HeaderModeSink)
  const compact = mode.compactActions
  const center = mode.center
  const back = mode.back

  useEffect(() => {
    setMode({ center, compactActions: compact, back })
    return () => setMode(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setMode, compact, ...deps])
}

/** Пустой режим — для экранов, которым шапка нужна обычная. */
export function useDefaultHeaderMode(): HeaderMode {
  return useMemo(() => EMPTY, [])
}
