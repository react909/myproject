const { app, shell } = require('electron')

function setAutoLaunch(enabled) {
  if (process.platform !== 'win32') {
    return { ok: false, message: 'Автозапуск настроен только для Windows' }
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      path: process.execPath,
      args: [],
    })
    return { ok: true, enabled: !!enabled }
  } catch (e) {
    return { ok: false, message: e.message }
  }
}

/** Windows OSK/TabTip отключены — только встроенная VirtualKeyboard в renderer. */
function openWindowsTouchKeyboard() {
  return { ok: true, message: 'Встроенная клавиатура NurCRM' }
}

/**
 * Режим киоска: окно на весь экран, чтобы кассир не проваливался на рабочий
 * стол случайным касанием.
 *
 * Сторож сворачивания здесь пропускает сворачивание, запрошенное самим
 * человеком, и это главное в блоке. Раньше он возвращал окно назад на любое
 * событие `minimize`, а `alwaysFullscreen` включён по умолчанию — то есть на
 * каждой установке. Кнопка «свернуть» в шапке отправляла окно вниз, сторож
 * тут же дёргал `restore()`, окно моргало и всплывало обратно уже без
 * полноэкранного режима. Со стороны это выглядело как «приложение закрылось и
 * запустилось заново», а на моноблоке — как серый неотзывчивый экран.
 *
 * `setMinimizable(false)` убран по той же причине: у приложения есть
 * собственная кнопка «свернуть», и запрет на уровне окна ломает именно её —
 * Windows отменяет сворачивание уже начатым, оставляя окно в промежуточном
 * состоянии. Киоск держится полноэкранным режимом и сторожем, а не запретом.
 */
function applyKioskToWindow(win, systemSettings) {
  if (!win || win.isDestroyed()) return
  const kiosk = !!systemSettings?.alwaysFullscreen
  win.setMenuBarVisibility(false)
  win.setMinimizable(true)
  win.nurcrmKioskOn = kiosk

  if (kiosk) {
    win.setFullScreen(true)
    win.setAlwaysOnTop(false)
    win.setResizable(false)
    win.setMaximizable(false)
    if (!win._nurcrmKioskGuard) {
      win._nurcrmKioskGuard = true
      // Один слушатель на всё время жизни окна: снять его при выключении
      // киоска нечем, поэтому решение принимается внутри — по флагу режима.
      win.on('minimize', () => {
        if (win.isDestroyed()) return
        if (!win.nurcrmKioskOn) return
        // Человек нажал «свернуть» — это его право, а не побег из киоска.
        if (win.nurcrmMinimizeRequested) return
        win.restore()
      })
    }
  } else {
    win.setResizable(true)
    win.setMaximizable(true)
  }
}

module.exports = {
  setAutoLaunch,
  openWindowsTouchKeyboard,
  applyKioskToWindow,
  openExternal: (url) => shell.openExternal(url),
}
