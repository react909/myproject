import { useEffect } from 'react'
import { apiGet } from '../api/client'
import { applyAndCacheTheme, isValidHex, readCachedTheme } from '../auth/applyTheme'
import type { ThemeMode } from '../auth/applyTheme'
import { brandTheme } from '../brand/resolve'

/**
 * Оформление магазина с сервера — и обновление кэша, из которого приложение
 * красится при следующем старте.
 *
 * Не подмена applyStoredTheme() из main.tsx, а вторая половина той же работы.
 * Первая красит экран синхронно и мгновенно, но по вчерашней копии; эта ходит
 * за настоящим значением и поправляет копию, если специалист поменял бренд.
 *
 * `/api/setup/status`, а не `/api/settings/store`: он отвечает без
 * авторизации. Экран входа и экран активации — тоже часть системы, и красить
 * их фирменным цветом магазина надо ровно так же, как кассу. Прежний хук ждал
 * сессии и до входа не работал вовсе.
 *
 * Секретов в ответе нет: цвет, тема и название — оформление, по ним нельзя
 * узнать ничего, чего не видно на самом экране.
 */
export function useStoreTheme(): void {
  useEffect(() => {
    let cancelled = false
    void apiGet('/api/setup/status')
      .then((res) => {
        if (cancelled) return
        const primary = res.data?.primary_color
        if (typeof primary !== 'string' || !isValidHex(primary)) return

        /*
          Через brandTheme, а не по полям напрямую.

          Магазин, вернувшийся к заводскому бренду, продолжает хранить
          выбранный когда-то цвет — поля при возврате не стираются, чтобы
          переключиться обратно можно было одним нажатием. Применять этот цвет
          нельзя: на всех экранах в таком режиме стоит Kassir ERP, и мятная
          система в чужом фиолетовом выглядела бы недокрашенной.

          Решение о том, что показать, одно на всё приложение и живёт в
          brand/resolve — здесь ему просто передают состояние.
        */
        const next = brandTheme({
          useFactoryBrand: res.data?.use_factory_brand !== false,
          brandName: typeof res.data?.brand_name === 'string' ? res.data.brand_name : '',
          primaryColor: primary,
          theme: (res.data?.theme === 'dark' ? 'dark' : 'light') as ThemeMode,
        })

        // Перекрашиваем только на настоящее расхождение. Иначе каждый запуск
        // писал бы в стиль <html> те же значения и дёргал бы перерасчёт стилей
        // на ровном месте — незаметно, но незачем.
        const cached = readCachedTheme()
        if (cached && cached.primary === next.primary.toLowerCase() && cached.mode === next.mode) {
          return
        }
        applyAndCacheTheme(next)
      })
      .catch(() => {
        /* сервер не ответил — остаёмся на кэше, он уже применён в main.tsx */
      })
    return () => {
      cancelled = true
    }
  }, [])
}
