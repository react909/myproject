/**
 * Съёмка экранов приложения через сам Electron.
 *
 * Playwright в проекте нет и тащить его сюда незачем: у Electron есть всё
 * нужное — `BrowserWindow` и `webContents.capturePage()`. Скрипт поднимает
 * окно, входит в кассу подложенным токеном, ходит по адресам из `shots.json` и
 * сохраняет кадры.
 *
 * Четыре вещи ломают такую съёмку молча, и все четыре обойдены здесь:
 *
 * 1. `show: false` вешает `capturePage()` намертво — на Windows Chromium не
 *    композитит невидимое окно, и промис не разрешается никогда. Окно только
 *    видимое.
 * 2. stdout GUI-процесса до оболочки не доходит. Весь ход прогона пишется в
 *    файл, иначе прогон выглядит немым.
 * 3. Список экранов передаётся ФАЙЛОМ: PowerShell оборачивает JSON в свои
 *    кавычки, и `JSON.parse` падает на второй позиции.
 * 4. Два экземпляра Electron дерутся за профиль по умолчанию. Свой `userData`.
 *
 * Запуск:
 *   node_modules\electron\dist\electron.exe tools\shoot.cjs <папка> <токен>
 */

const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const OUT_DIR = process.argv[2] || path.join(__dirname, '..', 'shots')
const TOKEN = process.argv[3] || ''
// Четвёртым аргументом можно подсунуть другой список экранов: полный прогон
// долгий, а переснять один-два экрана после правки нужно постоянно.
const PLAN_FILE = process.argv[4] || 'shots.json'
const PLAN = JSON.parse(fs.readFileSync(path.join(__dirname, PLAN_FILE), 'utf8'))
const ORIGIN = 'http://127.0.0.1:5173'
const LOG = path.join(OUT_DIR, 'shoot.log')

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(LOG, '')
const log = (line) => fs.appendFileSync(LOG, `${new Date().toISOString()}  ${line}\n`)

// Свой профиль: иначе второй запущенный Electron (или само приложение в dev)
// отбирает блокировку и окно падает с ERR_FAILED на первом же адресе.
app.setPath('userData', path.join(OUT_DIR, '.profile'))

// Зависший прогон иначе висит до таймаута оболочки.
const guard = setTimeout(() => {
  log('ТАЙМАУТ прогона')
  app.exit(2)
}, 8 * 60_000)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Снимок с повторами.
 *
 * `capturePage()` иногда отвечает `UnknownVizError`: компоновщик не успел
 * отдать кадр — окно перекрыли, GPU-процесс перезапустился. Лечится фокусом,
 * подъёмом окна и паузой. Один неудачный кадр не должен ронять прогон.
 */
async function capture(win, file, rect, magnify) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      win.focus()
      win.moveTop()
      await wait(140 * attempt)
      let image = rect ? await win.webContents.capturePage(rect) : await win.webContents.capturePage()
      if (image.isEmpty()) throw new Error('пустой кадр')
      /*
        Увеличение вырезанного куска.

        Мелкие детали — как именно уголок сел в угол, есть ли щель между ним и
        кромкой — на кадре в сто точек не разглядеть вовсе. Увеличение здесь, а
        не масштабом страницы: масштаб страницы поменял бы раскладку и показал
        бы не то, что видит человек.
      */
      if (magnify && magnify > 1) {
        const { width, height } = image.getSize()
        image = image.resize({ width: width * magnify, height: height * magnify, quality: 'best' })
      }
      fs.writeFileSync(file, image.toPNG())
      log(`снят ${path.basename(file)} (${image.getSize().width}×${image.getSize().height})`)
      return true
    } catch (error) {
      log(`попытка ${attempt} не удалась: ${error.message}`)
    }
  }
  log(`НЕ СНЯТ ${path.basename(file)}`)
  return false
}

/**
 * Куда смотреть на кадре.
 *
 * `corner: "tl" | "tr" | "bl" | "br"` вырезает квадрат нужного угла ОКНА, а не
 * заданный числами прямоугольник. Числа здесь не годятся: у окна 1440×900
 * рабочая область меньше на высоту рамки, и прямоугольник, посчитанный от
 * заявленного размера, вылезает за неё. `capturePage` на такой отвечает
 * `UnknownVizError` — то есть выглядит как случайный сбой композитора, хотя это
 * промах мимо кадра.
 */
function rectFor(win, shot) {
  if (!shot.corner) return shot.rect
  const [width, height] = win.getContentSize()
  const side = shot.side ?? 200
  const box = Math.min(side, width, height)
  return {
    x: shot.corner.endsWith('l') ? 0 : Math.max(0, width - box),
    y: shot.corner.startsWith('t') ? 0 : Math.max(0, height - box),
    width: box,
    height: box,
  }
}

async function run() {
  const win = new BrowserWindow({
    width: PLAN.width || 1440,
    height: PLAN.height || 900,
    show: true,
    backgroundColor: '#0b0e13',
    webPreferences: { backgroundThrottling: false, offscreen: false },
  })

  // Вход: токен кладётся в localStorage до того, как приложение решит, что
  // сессии нет. Поэтому сначала пустая страница того же origin, потом запись,
  // и только потом настоящий адрес.
  await win.loadURL(`${ORIGIN}/index.html`)
  await win.webContents.executeJavaScript(
    `localStorage.setItem('nurcrm-token', ${JSON.stringify(TOKEN)});
     localStorage.setItem('nurcrm-user-email', ${JSON.stringify(PLAN.email || '')});
     /*
       Экранная клавиатура на время съёмки выключена.

       Она открывается сама, стоит фокусу попасть в поле ввода, — и это
       правильное поведение на сенсорном моноблоке, но на снимке она закрывает
       собой ровно то, что снимают: таблицу ввода накладной. Настройка
       localStorage, а не правка кода: приложение не должно знать, что его
       снимают.
     */
     (() => {
       let s = {};
       try { s = JSON.parse(localStorage.getItem('nurcrm-settings') || '{}') } catch {}
       s.system = Object.assign({}, s.system, { showKeyboardOnFocus: false });
       localStorage.setItem('nurcrm-settings', JSON.stringify(s));
     })();
     true`,
  )
  log('токен подложен, экранная клавиатура выключена')

  let visit = 0
  for (const shot of PLAN.shots) {
    try {
      /*
        В адресе есть меняющийся параметр, и он не для обхода кеша.

        `loadURL` на адрес, отличающийся ТОЛЬКО хэшем, — это переход по
        фрагменту: страница не перезагружается, приложение не перезапускается,
        и подложенный токен так и не читается. Ровно на это ушёл первый прогон:
        все кадры вышли с экраном входа. Отличие в запросе делает переход
        настоящим.
      */
      visit += 1
      await win.loadURL(`${ORIGIN}/index.html?shot=${visit}#${shot.route}`)
      await wait(shot.settle ?? 1800)
      if (shot.script) {
        const result = await win.webContents.executeJavaScript(shot.script, true)
        log(`${shot.name}: скрипт вернул ${JSON.stringify(result)}`)
        await wait(shot.after ?? 900)
      }
      await capture(win, path.join(OUT_DIR, `${shot.name}.png`), rectFor(win, shot), shot.magnify)
    } catch (error) {
      log(`ЭКРАН ${shot.name} упал: ${error.stack || error.message}`)
    }
  }

  // Замеры удобнее возвращать числами, чем разглядывать на уменьшенной
  // картинке: «режется ли кнопка» на скриншоте не видно, а
  // getBoundingClientRect() отвечает точно.
  if (PLAN.probe) {
    try {
      await win.loadURL(`${ORIGIN}/index.html?shot=probe#${PLAN.probe.route}`)
      /*
        Окно ОБЯЗАНО быть в фокусе и наверху.

        Замер движения идёт по `requestAnimationFrame`, а неактивное окно
        Chromium кадры почти не выдаёт: первый прогон дал один кадр за 1.8
        секунды, кнопка при этом не сдвинулась вовсе — потому что и сама
        отрисовка переноса живёт на rAF. Выглядело как «физика не работает»,
        хотя не работал замер.
      */
      win.focus()
      win.moveTop()
      await wait(2500)
      const measured = await win.webContents.executeJavaScript(PLAN.probe.script, true)
      fs.writeFileSync(
        path.join(OUT_DIR, 'probe.json'),
        JSON.stringify(measured, null, 2),
      )
      log(`замеры: ${JSON.stringify(measured)}`)
    } catch (error) {
      log(`ЗАМЕРЫ упали: ${error.stack || error.message}`)
    }
  }

  clearTimeout(guard)
  log('готово')
  app.exit(0)
}

app.whenReady().then(() =>
  run().catch((error) => {
    log(`ПРОГОН УПАЛ: ${error.stack || error.message}`)
    app.exit(1)
  }),
)

// Увеличенный кусок кадра — для мелких деталей вроде посадки кнопки в углу.
module.exports = { nativeImage }
