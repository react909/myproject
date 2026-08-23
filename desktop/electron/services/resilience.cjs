/**
 * Живучесть окна: сон, блокировка экрана, падение рендерера и GPU.
 *
 * Жалоба, ради которой это написано: ноутбук ушёл в сон с открытой кассой, а
 * после пробуждения окно чёрное. Приложение при этом живо — не отрисовывается
 * поверхность окна. Своими силами кассир из этого не выходит: он видит мёртвый
 * экран и перезапускает приложение, теряя незакрытую смену.
 *
 * Здесь три уровня, от мягкого к жёсткому:
 *
 *  1. Перерисовка. На `resume` и `unlock-screen` окну возвращается фокус и
 *     принудительно сбрасывается поверхность. В большинстве случаев хватает.
 *  2. Сторож. Через полторы секунды после пробуждения рендерер спрашивают:
 *     «ты жив?». Не ответил за три секунды — окно перезагружается само.
 *     Состояние кассы переживает перезагрузку: смена и корзина лежат в базе и
 *     в локальном хранилище, а не в памяти страницы.
 *  3. Падения. `render-process-gone` и `child-process-gone` пишутся в журнал и
 *     чинятся перезагрузкой окна. Если GPU падает повторно, при следующем
 *     запуске отрисовка переключается на программную: лучше медленнее, чем
 *     чёрный экран.
 *
 * Всё пишется в файл журнала и никуда не отправляется.
 */

const { app, ipcMain, powerMonitor } = require('electron')

const logger = require('./logger.cjs')
const appState = require('./app-state.cjs')
const recovery = require('./recovery-window.cjs')

/* --------------------------------------------------------------------------
 * Сторож кадров: белый экран после долгого простоя
 * --------------------------------------------------------------------------
 *
 * Всё, что выше, чинит окно по событию: проснулись, разблокировали, упал
 * процесс. Но самая частая жалоба ни одного события не даёт вовсе — касса
 * простояла несколько часов, и экран стал белым (или серым, или синим). Ни сна,
 * ни падения при этом не было: рендерер жив и отвечает, а рисовать перестал —
 * потерялась поверхность окна или встала отрисовка.
 *
 * Поймать это можно только по кадрам. Страница шлёт отметку на каждом кадре
 * отрисовки (см. desktop/src/services/frameHeartbeat.ts): идут кадры — картинка
 * живая, встали — на экране застыло то, что было. Проверять опросом бесполезно:
 * на «ты жив?» такой рендерер отвечает бодро.
 *
 * Лечение по возрастанию: перерисовать поверхность, потом перезагрузить окно,
 * и только если и это не помогло — перезапустить приложение. Перезапуск
 * последним не из осторожности: касса держит смену и корзину, перезагрузка окна
 * их сохраняет (они в базе и localStorage), а перезапуск приложения — самый
 * долгий для человека за прилавком путь.
 */

/** Как часто страница отмечается. Должно совпадать с frameHeartbeat.ts. */
const HEARTBEAT_EVERY_MS = 2000

/**
 * После какого молчания кадры считаются вставшими.
 *
 * Двенадцать секунд — шесть пропущенных отметок подряд. Одну-две глотает любая
 * тяжёлая операция (печать чека, разбор логотипа), и дёргать окно из-за них
 * нельзя. Шесть подряд при видимом окне означают, что кадров нет вовсе.
 */
const FRAMES_STALE_MS = 12_000

/** Как часто сторож смотрит на отметки. */
const FRAME_CHECK_EVERY_MS = 5000

/**
 * Сколько перезагрузок окна подряд считается «не помогает».
 *
 * После них — один перезапуск приложения за сеанс. Именно один: если
 * перезапуск не лечит, повторять его значит зациклить кассу на перезапусках, а
 * это хуже белого экрана — из белого экрана человек хотя бы выйдет сам.
 */
const RELOADS_BEFORE_RELAUNCH = 2

/**
 * Сколько падений рендерера подряд считается «перезагрузка не лечит».
 *
 * Три, а не два: одно падение — случайность, второе может быть тем же
 * недоеденным кадром на подъёме страницы. Третье за минуту означает, что
 * страница валится на каждом заходе, и крутить перезагрузку дальше — значит
 * держать кассира перед вечным «Восстановление…».
 */
const CRASHES_BEFORE_GIVING_UP = 3

/**
 * За какое время считаются те три падения.
 *
 * Минута: падения раз в неделю чинятся перезагрузкой и копиться до отказа не
 * должны. Без окна счёт за долгую смену набежал бы сам собой.
 */
const CRASH_WINDOW_MS = 60_000

/** Сколько ждать ответа рендерера после пробуждения. */
const PING_TIMEOUT_MS = 3000

/** Пауза перед опросом: сразу после `resume` система ещё поднимает подсистемы. */
const PING_DELAY_MS = 1500

/**
 * Столько падений GPU подряд — и следующий запуск идёт на программной
 * отрисовке. Одно падение случается и на исправной машине (обновился драйвер),
 * а вот три подряд означают, что аппаратный путь на этом железе не работает.
 */
const GPU_CRASH_LIMIT = 3

/** Флаг в состоянии приложения, чтобы решение пережило перезапуск. */
const STATE_KEY = 'gpuCrashCount'

let watchdogTimer = null

function readGpuCrashes() {
  const state = appState.readState() || {}
  const value = Number(state[STATE_KEY])
  return Number.isFinite(value) ? value : 0
}

function writeGpuCrashes(count) {
  try {
    appState.writeState({ [STATE_KEY]: count })
  } catch {
    /* состояние недоступно — переживём, просто не запомним */
  }
}

/**
 * Нужна ли программная отрисовка. Вызывается до готовности приложения: после
 * `app.whenReady()` переключать уже поздно.
 */
function shouldDisableHardwareAcceleration() {
  return readGpuCrashes() >= GPU_CRASH_LIMIT
}

/** Принудительная перерисовка окна — то же средство, что после чужих диалогов. */
function repaint(win) {
  if (!win || win.isDestroyed() || win.isMinimized()) return
  try {
    win.webContents.invalidate()
    win.webContents.focus()
  } catch {
    /* окно закрыли, пока мы просыпались */
  }
}

/**
 * Жив ли рендерер. Именно рендерер, а не окно: чёрный экран — это когда окно
 * есть, а страница в нём не отвечает или не рисует.
 */
async function isRendererAlive(win) {
  if (!win || win.isDestroyed()) return false
  try {
    const answer = await Promise.race([
      win.webContents.executeJavaScript('document.readyState', true),
      new Promise((resolve) => setTimeout(() => resolve(null), PING_TIMEOUT_MS)),
    ])
    return typeof answer === 'string'
  } catch {
    return false
  }
}

/**
 * Перезагрузка окна с пометкой в журнале и с показом «Восстановление…».
 *
 * Раньше перезагрузка шла молча, и со стороны прилавка выглядела так же, как
 * поломка: экран замер, моргнул, снова замер. Кассир в этот момент не знает,
 * ждать или звать специалиста, и обычно выключает питание.
 *
 * Окно восстановления гаснет само, когда страница поднялась (см. подписку на
 * `did-finish-load` в installWindowResilience).
 */
function reloadWindow(win, reason) {
  if (!win || win.isDestroyed()) return
  logger.append('window', 'warn', 'перезагрузка окна', { reason })
  try {
    recovery.showHealing()
  } catch {
    /* не показалось — чинить всё равно надо */
  }
  /*
    Перезагрузка — СЛЕДУЮЩИМ тактом, а не прямо здесь.

    Сюда приходят и из обработчика `render-process-gone`, а перезагрузить
    webContents изнутри этого события нельзя: Chromium ловит это внутренней
    проверкой и аварийно останавливает процесс (0x80000003 STATUS_BREAKPOINT).
    Останавливается при этом ГЛАВНЫЙ процесс — то есть на настоящем падении
    рендерера умирало всё приложение целиком, ровно вместо того, чтобы
    починиться. Ни записи в журнале после «рендерер упал», ни окна
    «Восстановление…»: касса просто исчезала с экрана.

    Поймано настоящим падением: процесс рендерера убит снаружи (так его убивает
    Windows при нехватке памяти), в журнале — «рендерер упал», и следом
    электрон уходил с кодом -2147483645.

    `setImmediate` возвращает управление Chromium, тот доводит уборку мёртвого
    рендерера до конца, и перезагрузка идёт уже по спокойной воде. Задержка —
    один такт цикла событий, на глаз незаметна.
  */
  setImmediate(() => {
    if (!win || win.isDestroyed()) return
    try {
      win.webContents.reloadIgnoringCache()
    } catch (error) {
      logger.append('window', 'error', 'перезагрузка не удалась', { reason, message: String(error) })
    }
  })
}

/**
 * Сторож после пробуждения: перерисовать, потом проверить и, если рендерер
 * молчит, перезагрузить окно. Молчание — это и есть чёрный экран.
 */
function watchAfterWake(getWindow, reason) {
  if (watchdogTimer) clearTimeout(watchdogTimer)
  const win = getWindow()
  repaint(win)
  // Второй заход кадром позже: часть систем возвращает поверхность не сразу.
  setTimeout(() => repaint(getWindow()), 400)

  watchdogTimer = setTimeout(async () => {
    watchdogTimer = null
    const target = getWindow()
    if (!target || target.isDestroyed()) return
    const alive = await isRendererAlive(target)
    logger.append('window', 'info', 'проверка после пробуждения', { reason, alive })
    if (!alive) reloadWindow(target, `${reason}: рендерер не ответил`)
    else {
      // Живой рендерер всё равно просят пересобрать кадр: часы и таймеры
      // после сна отстают, а страница об этом не знает.
      repaint(target)
      try {
        target.webContents.send('power:resume', { reason })
      } catch {
        /* окно закрылось между проверкой и отправкой */
      }
    }
  }, PING_DELAY_MS)
}

/**
 * Подписки на питание и падения процессов.
 *
 * @param {() => Electron.BrowserWindow | null} getWindow
 */
function installResilience(getWindow) {
  for (const event of ['resume', 'unlock-screen']) {
    try {
      powerMonitor.on(event, () => {
        logger.append('window', 'info', `питание: ${event}`)
        watchAfterWake(getWindow, event)
      })
    } catch {
      // На части систем часть событий не поддерживается — это не повод падать.
    }
  }

  for (const event of ['suspend', 'lock-screen']) {
    try {
      powerMonitor.on(event, () => logger.append('window', 'info', `питание: ${event}`))
    } catch {
      /* см. выше */
    }
  }

  // Смена монитора и разрешения бьёт по поверхности окна так же, как сон.
  try {
    const { screen } = require('electron')
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(event, () => {
        logger.append('window', 'info', `экран: ${event}`)
        watchAfterWake(getWindow, event)
      })
    }
  } catch {
    /* screen доступен только после ready — вызывающий это учитывает */
  }

  app.on('child-process-gone', (_event, details) => {
    logger.append('window', 'error', 'дочерний процесс упал', details)
    if (details?.type === 'GPU') {
      const count = readGpuCrashes() + 1
      writeGpuCrashes(count)
      logger.append('window', 'warn', 'падение GPU', { count, limit: GPU_CRASH_LIMIT })
      watchAfterWake(getWindow, 'gpu-crash')
    }
  })
}

/**
 * Подписки на конкретное окно. Отдельно от системных: окно пересоздаётся, а
 * подписки на приложение живут один раз.
 */
function installWindowResilience(win, getWindow) {
  /*
    Падения рендерера тоже считаются, и у них тоже есть предел.

    Своего счётчика здесь не было: сторож кадров считал попытки и в конце
    показывал «Перезапустить», а падения перезагружались без конца. Разница
    видна, когда страница валится КАЖДЫЙ раз — испорченная запись в локальном
    хранилище, битый кэш, нехватка памяти: касса уходила в вечный круг
    «упало → Восстановление… → упало», и выйти из него было нечем. Ровно тот
    белый экран, ради которого сторож и заведён.

    Проверено настоящим падением: три убийства процесса рендерера подряд —
    и все три раза окно оставалось в состоянии «Восстановление…».

    Окно, а не общий счёт за сеанс: одно падение в неделю чинится
    перезагрузкой и не должно копиться до отказа. Три за минуту — это уже не
    случайность, и человеку пора сказать правду.
  */
  const crashes = []

  win.webContents.on('render-process-gone', (_event, details) => {
    logger.append('window', 'error', 'рендерер упал', details)
    // «clean-exit» — это наш же reload, чинить нечего.
    if (details?.reason === 'clean-exit') return

    const now = Date.now()
    while (crashes.length && now - crashes[0] > CRASH_WINDOW_MS) crashes.shift()
    crashes.push(now)

    if (crashes.length >= CRASHES_BEFORE_GIVING_UP) {
      logger.append('window', 'error', 'рендерер падает подряд — экран восстановления', {
        count: crashes.length,
        windowMs: CRASH_WINDOW_MS,
      })
      try {
        recovery.showFailed()
        return
      } catch (error) {
        // Не показалось окно восстановления — лучше ещё одна перезагрузка,
        // чем чёрный экран без объяснений.
        logger.append('window', 'error', 'экран восстановления не открылся', {
          message: String(error),
        })
      }
    }

    // Счёт — в самой причине: по журналу должно быть видно, какой это заход
    // подряд, иначе десять одинаковых строк «перезагрузка окна» не отличить
    // от десяти не связанных между собой случаев за смену.
    reloadWindow(
      getWindow(),
      `render-process-gone: ${details?.reason ?? 'unknown'} (падение ${crashes.length} из ${CRASHES_BEFORE_GIVING_UP})`,
    )
  })

  /*
    На это событие рассчитывать нельзя — оно приходит далеко не всегда.

    Проверено: рендерер повешен бесконечным циклом на двенадцать секунд, и
    `unresponsive` не сработал ни разу. Chromium считает страницу зависшей по
    невыполненным событиям ВВОДА: если в кассу в этот момент никто не тычет,
    событий неоткуда взять, и зависание остаётся незамеченным.

    Отсюда важное: белый экран ловит сторож кадров (installFrameWatchdog), и он
    здесь не подстраховка, а единственная защита. Эта подписка — быстрый путь
    для случая, когда кассир как раз жмёт по экрану; убирать её незачем, но и
    полагаться на неё одну нельзя.
  */
  win.webContents.on('unresponsive', () => {
    logger.append('window', 'warn', 'страница не отвечает')
    watchAfterWake(getWindow, 'unresponsive')
  })

  win.webContents.on('responsive', () => {
    logger.append('window', 'info', 'страница снова отвечает')
  })

  // Успешная загрузка — признак, что аппаратная отрисовка работает: счётчик
  // падений GPU обнуляем, иначе три случайных падения за год однажды посадят
  // исправную машину на программную отрисовку навсегда.
  win.webContents.once('did-finish-load', () => {
    if (readGpuCrashes() > 0 && !shouldDisableHardwareAcceleration()) writeGpuCrashes(0)
  })
}

/**
 * Сторож кадров. Ловит белый экран после долгого простоя — случай, на который
 * не приходит ни одного системного события.
 *
 * @param {() => Electron.BrowserWindow | null} getWindow
 * @returns {() => void} остановить сторожа
 */
function installFrameWatchdog(getWindow) {
  let lastFrameAt = Date.now()
  let reloads = 0
  let relaunched = false
  let healing = false

  ipcMain.on('app:heartbeat', () => {
    lastFrameAt = Date.now()
    // Кадры пошли — прошлые попытки лечения засчитаны как удачные, а окно
    // «Восстановление…» больше не нужно: касса рисует.
    if (reloads > 0 || relaunched) {
      try {
        recovery.hide()
      } catch {
        /* окна восстановления может не быть вовсе */
      }
    }
    reloads = 0
  })

  const heal = async () => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    healing = true
    try {
      const silentFor = Date.now() - lastFrameAt
      logger.append('window', 'warn', 'кадры встали', { silentFor, reloads })

      // 1. Вернуть поверхность. Самое дешёвое и чаще всего достаточное.
      repaint(win)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      if (Date.now() - lastFrameAt < FRAMES_STALE_MS) {
        logger.append('window', 'info', 'кадры пошли после перерисовки')
        return
      }

      // 2. Перезагрузить окно. Смена и корзина это переживают: они в базе и в
      //    локальном хранилище, а не в памяти страницы.
      if (reloads < RELOADS_BEFORE_RELAUNCH) {
        reloads += 1
        reloadWindow(win, 'кадры встали')
        // Даём странице подняться, прежде чем считать молчание заново.
        lastFrameAt = Date.now()
        return
      }

      /*
        3. Попытки исчерпаны — показываем экран с кнопкой «Перезапустить».

        Не перезапускаем сами, и это изменение по сравнению с прежним
        поведением. Автоматический перезапуск здесь был ровно один раз за
        сеанс, а дальше сторож писал в журнал «оставляем как есть» и умолкал:
        касса оставалась с белым экраном и без единого способа выйти из него,
        кроме диспетчера задач.

        Перезапуск посреди смены — решение человека, а не программы: он может
        идти в очереди с покупателем, и выбрать момент должен сам. Кнопка
        рядом, а незакрытый чек и смена перезапуск переживают.
      */
      if (!relaunched) {
        relaunched = true
        logger.append('window', 'error', 'перезагрузка окна не помогла — экран восстановления')
      }
      try {
        recovery.showFailed()
      } catch (error) {
        // Не показалось окно восстановления — последнее средство прежнее.
        logger.append('window', 'error', 'экран восстановления не открылся', {
          message: String(error),
        })
        app.relaunch()
        app.exit(0)
      }
    } finally {
      healing = false
    }
  }

  const timer = setInterval(() => {
    if (healing) return
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    // Свёрнутое или скрытое окно кадров не рисует, и это норма, а не поломка:
    // Chromium сам останавливает отрисовку невидимого окна.
    if (!win.isVisible() || win.isMinimized()) {
      lastFrameAt = Date.now()
      return
    }
    if (Date.now() - lastFrameAt > FRAMES_STALE_MS) void heal()
  }, FRAME_CHECK_EVERY_MS)

  return () => clearInterval(timer)
}

module.exports = {
  installResilience,
  installWindowResilience,
  installFrameWatchdog,
  shouldDisableHardwareAcceleration,
  GPU_CRASH_LIMIT,
  HEARTBEAT_EVERY_MS,
  FRAMES_STALE_MS,
  RELOADS_BEFORE_RELAUNCH,
  CRASHES_BEFORE_GIVING_UP,
  CRASH_WINDOW_MS,
}
