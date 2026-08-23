/**
 * Что видит человек, пока касса чинится.
 *
 * Сторож живучести (resilience.cjs) умел лечить окно молча: перерисовать,
 * перезагрузить, перезапустить. Со стороны прилавка это выглядело так же, как
 * поломка, — экран замер, потом моргнул, потом опять замер. Кассир в это время
 * не знает, ждать ему или звать специалиста, и обычно вырубает питание.
 *
 * Здесь два состояния одного окна:
 *
 *   'healing'  — «Восстановление…», короткий показ на время перезагрузки.
 *                Само гаснет, когда страница поднялась.
 *   'failed'   — попытки исчерпаны. Кнопка «Перезапустить» и объяснение, что
 *                делать. Без неё касса оставалась с белым экраном и без
 *                единого способа выйти из него, кроме диспетчера задач.
 *
 * Отдельное окно, а не сообщение внутри страницы: чинят как раз ту страницу,
 * которая рисовать перестала, и просить её что-то показать бессмысленно.
 *
 * Незакрытый чек это окно не трогает: оно ничего не знает про кассу и только
 * показывает текст. Смена и корзина лежат в базе и в localStorage и переживают
 * перезагрузку окна — см. шапку resilience.cjs.
 */

const { BrowserWindow, ipcMain, app } = require('electron')

const { resolveAppIconImage } = require('./icon-path.cjs')

/** Канал, по которому кнопка из окна просит перезапуск. */
const RESTART_CHANNEL = 'recovery:restart'

let win = null

function html() {
  /*
    Цвета заданы значениями, а не токенами: это отдельное окно главного
    процесса, оно грузится из data-URL и до таблиц стилей приложения не
    дотягивается. Мятный тот же, что --accent по умолчанию.
  */
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
      gap:14px;padding:28px;text-align:center;
      font-family:'Segoe UI',system-ui,sans-serif;
      background:linear-gradient(145deg,#0f1419,#1a2332);color:#f8fafc}
    h1{font-size:19px;font-weight:800}
    p{font-size:13px;line-height:1.5;color:#94a3b8;max-width:340px}
    .bar{width:220px;height:4px;border-radius:99px;background:#334155;overflow:hidden}
    .bar>i{display:block;height:100%;width:40%;border-radius:inherit;
      background:linear-gradient(90deg,#00c294,#00f5bc);animation:run 1.1s ease-in-out infinite}
    @keyframes run{from{transform:translateX(-100%)}to{transform:translateX(280%)}}
    button{margin-top:6px;height:42px;padding:0 26px;border:0;border-radius:10px;
      background:linear-gradient(160deg,#00f5bc,#00c294);color:#00231b;
      font:inherit;font-size:15px;font-weight:800;cursor:pointer}
    button:active{transform:scale(.97)}
    .hide{display:none}
  </style></head><body>
    <div id="healing">
      <h1>Восстановление…</h1>
      <p>Экран кассы завис, идёт перезагрузка. Незакрытый чек и смена сохранены — они в базе, а не на экране.</p>
      <div class="bar"><i></i></div>
    </div>
    <div id="failed" class="hide">
      <h1>Касса не восстановилась</h1>
      <p>Перезагрузка не помогла. Нажмите «Перезапустить» — незакрытый чек и открытая смена сохранены и вернутся после запуска. Если повторится, покажите специалисту журнал в папке logs.</p>
      <button id="restart" type="button">Перезапустить</button>
    </div>
    <script>
      const { ipcRenderer } = require('electron')
      document.getElementById('restart').addEventListener('click', () => {
        ipcRenderer.send(${JSON.stringify(RESTART_CHANNEL)})
      })
      window.showState = (state) => {
        document.getElementById('healing').className = state === 'healing' ? '' : 'hide'
        document.getElementById('failed').className = state === 'failed' ? '' : 'hide'
      }
    </script>
  </body></html>`
}

function ensureWindow() {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    width: 460,
    height: 300,
    icon: resolveAppIconImage(),
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    center: true,
    show: false,
    backgroundColor: '#0f1419',
    // nodeIntegration нужен ради одной кнопки: окно грузится из data-URL, и
    // подключить к нему preload нечем. Наружу оно не ходит и ничего не
    // загружает — весь его код в строке выше.
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  })
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html())}`)
  win.on('closed', () => {
    win = null
  })
  return win
}

/** Показать «Восстановление…». Вызывается перед перезагрузкой окна. */
function showHealing() {
  const target = ensureWindow()
  const apply = () => {
    target.webContents.executeJavaScript("window.showState('healing')").catch(() => {})
    if (!target.isDestroyed()) target.show()
  }
  if (target.webContents.isLoading()) target.webContents.once('did-finish-load', apply)
  else apply()
}

/** Показать «Касса не восстановилась» с кнопкой. Попытки исчерпаны. */
function showFailed() {
  const target = ensureWindow()
  const apply = () => {
    target.webContents.executeJavaScript("window.showState('failed')").catch(() => {})
    if (!target.isDestroyed()) target.show()
  }
  if (target.webContents.isLoading()) target.webContents.once('did-finish-load', apply)
  else apply()
}

/** Спрятать: касса ожила. */
function hide() {
  if (win && !win.isDestroyed()) win.hide()
}

/**
 * Подписка на кнопку «Перезапустить». Ставится один раз при старте.
 *
 * Перезапуск здесь, а не в окне: `app.relaunch` доступен только главному
 * процессу, и решение «перезапустить приложение» должно остаться за ним.
 */
function installRecoveryIpc() {
  ipcMain.on(RESTART_CHANNEL, () => {
    app.relaunch()
    app.exit(0)
  })
}

module.exports = { showHealing, showFailed, hide, installRecoveryIpc }
