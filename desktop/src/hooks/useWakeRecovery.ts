/**
 * Восстановление интерфейса после сна и блокировки экрана.
 *
 * Главный процесс к этому моменту уже вернул окну поверхность и, если страница
 * не отвечала, перезагрузил её (см. electron/services/resilience.cjs). Здесь
 * доделывается то, что видно только изнутри страницы:
 *
 *  • часы и таймеры. `setInterval` во сне не идёт, и после пробуждения время в
 *    шапке отстаёт ровно на длительность сна — пока не отработает следующий
 *    тик. Событие заставляет пересчитать его сразу;
 *  • кадры. Цикл `requestAnimationFrame` в замороженной вкладке
 *    останавливается и сам не возобновляется, если его никто не подтолкнул;
 *  • данные. Смена и реквизиты могли устареть за два часа сна.
 *
 * Наружу отдаётся счётчик пробуждений: экраны используют его как ключ, по
 * которому пересобирают своё состояние, — сигнал один на всё приложение, а не
 * по подписке в каждом компоненте.
 */

import { useEffect, useState } from 'react'

/** Сколько времени между кадрами считается «страница спала», а не тормозит. */
const FREEZE_GAP_MS = 20_000

export function useWakeRecovery(): number {
  const [wakeCount, setWakeCount] = useState(0)

  useEffect(() => {
    const wake = () => setWakeCount((value) => value + 1)

    // Сигнал из главного процесса: powerMonitor знает о сне то, чего страница
    // знать не может.
    const offResume = window.powerAPI?.onResume?.(wake)

    // Запасной путь для случаев, когда системного события не будет: браузер в
    // киоске, заморозка вкладки, возврат из фонового режима.
    const onVisible = () => {
      if (document.visibilityState === 'visible') wake()
    }
    document.addEventListener('visibilitychange', onVisible)

    /*
      Сторож на часах. Если между двумя проверками прошло заметно больше, чем
      должно было, — страницу морозили. Это ловит и сон без системного события,
      и перевод системного времени.
    */
    let last = Date.now()
    const timer = window.setInterval(() => {
      const now = Date.now()
      if (now - last > FREEZE_GAP_MS) wake()
      last = now
    }, 5000)

    return () => {
      offResume?.()
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [])

  return wakeCount
}
