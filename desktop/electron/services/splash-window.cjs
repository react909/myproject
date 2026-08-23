const { BrowserWindow } = require('electron')
const { resolveAppIconImage } = require('./icon-path.cjs')

let splash = null

function createSplash() {
  if (splash && !splash.isDestroyed()) return splash

  splash = new BrowserWindow({
    width: 420,
    height: 280,
    icon: resolveAppIconImage(),
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    center: true,
    show: false,
    backgroundColor: '#0f1419',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"/><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:Segoe UI,system-ui,sans-serif;background:linear-gradient(145deg,#0f1419,#1a2332);color:#f8fafc}
    .logo{width:72px;height:72px;border-radius:18px;background:linear-gradient(135deg,#f59e0b,#d97706);
      display:grid;place-items:center;font-weight:800;font-size:22px;color:#1a1205;margin-bottom:20px}
    h1{font-size:18px;font-weight:700;margin-bottom:8px}
    p{font-size:13px;color:#94a3b8;margin-bottom:22px;text-align:center;padding:0 24px}
    .bar{width:220px;height:4px;border-radius:99px;background:#334155;overflow:hidden}
    .bar>i{display:block;height:100%;width:40%;background:linear-gradient(90deg,#f59e0b,#fbbf24);
      animation:load 1.1s ease-in-out infinite}
    @keyframes load{0%{transform:translateX(-100%)}100%{transform:translateX(280%)}}
  </style></head><body>
    <div class="logo">N</div>
    <h1>NurCRM Manablock</h1>
    <p id="sub">Запуск приложения…</p>
    <div class="bar"><i></i></div>
  </body></html>`

  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  splash.once('ready-to-show', () => splash?.show())
  return splash
}

function setSplashMessage(text) {
  if (!splash || splash.isDestroyed()) return
  splash.webContents
    .executeJavaScript(`document.getElementById('sub').textContent = ${JSON.stringify(text)}`)
    .catch(() => {})
}

function closeSplash() {
  if (splash && !splash.isDestroyed()) splash.close()
  splash = null
}

module.exports = { createSplash, setSplashMessage, closeSplash }
