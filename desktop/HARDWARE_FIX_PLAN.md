# Hardware Layer Critical Fixes

## Дата: 2026-05-29

## Критические проблемы

### 1. Весы (SUM1/SUM2) не работают

**Проблемы:**
- Reconnect нестабилен
- Live weight не приходит стабильно
- Polling может застревать
- Stale serial instance не очищается

**Решение:**
Нужно переписать scale-reader.cjs с:
- Правильной очисткой stale instances
- Improved reconnect logic with exponential backoff
- Better buffer parsing for SUM1/SUM2 protocols
- Proper port locking to prevent race conditions

### 2. Принтер / Кириллица не работает

**Проблемы:**
- Все codepage режимы выдают мусор
- Китайские принтеры не поддерживают стандартные codepages
- Текстовый режим не работает для кириллицы

**Решение:**
Нужно реализовать **BITMAP PRINTING** (печать как картинка):
- Рендерить текст в canvas
- Конвертировать в монохромное изображение
- Использовать ESC/POS raster bitmap commands (GS v 0)
- Это гарантирует правильную печать кириллицы

### 3. Serial Port нестабилен

**Проблемы:**
- COM lock issues
- Stale serial instances
- Race conditions при reconnect

**Решение:**
- Добавить proper port locking
- Очистка stale instances
- Better error handling

---

## План исправлений

### Phase 1: Bitmap Printing (Приоритет #1)

Создать `desktop/electron/devices/bitmap-printer.cjs`:

```javascript
/**
 * Bitmap printing for ESC/POS printers
 * Рендерит текст как картинку и печатает через GS v 0
 */

const { createCanvas, loadImage, registerFont } = require('canvas')

function renderReceiptToBitmap(data, options = {}) {
  const {
    width = 576, // 80mm printer ~576 dots at 7dpi/mm
    fontFamily = 'Arial',
    fontSize = 24,
    lineHeight = 32,
  } = options

  // Создать canvas
  const height = estimateHeight(data, fontSize, lineHeight)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  
  // Белый фон
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)
  
  // Черный текст (кириллица будет рендериться корректно)
  ctx.fillStyle = '#000000'
  ctx.font = `${fontSize}px ${fontFamily}`
  
  // Рендер текста...
  // (детали реализации)
  
  return canvas.toBuffer('image/bmp')
}

function bitmapToEscPos(bitmap, width) {
  // Конвертировать BMP в ESC/POS raster format
  // GS v 0 команда
  // ...
}

module.exports = { renderReceiptToBitmap, bitmapToEscPos }
```

### Phase 2: Scale Reader Fix

Переписать `desktop/electron/devices/scale-reader.cjs`:

```javascript
// Улучшенный scale reader с:
// 1. Proper port locking
// 2. Exponential backoff reconnect
// 3. Better SUM1/SUM2 parsing
// 4. Stale instance cleanup

class ScaleReader {
  constructor() {
    this.port = null
    this.pollTimer = null
    this.reconnectTimer = null
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 10
    this.isClosing = false
  }

  async start(cfg, onWeight) {
    await this.stop()
    this.isClosing = false
    this.currentCfg = cfg
    this.onWeightCb = onWeight
    this.reconnectAttempts = 0
    await this.connect()
  }

  async stop() {
    this.isClosing = true
    this.clearTimers()
    await this.closePort()
  }

  async connect() {
    // Connect with proper error handling
  }

  async closePort() {
    // Properly close and cleanup
  }

  clearTimers() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
  }
}
```

### Phase 3: Serial Port Stability

Улучшить `desktop/electron/devices/serial-port.cjs`:

```javascript
// Добавить:
// 1. Port locking mechanism
// 2. Stale instance tracking
// 3. Proper cleanup

const activePorts = new Map()

function getOrCreatePort(path, baudRate) {
  const key = `${path}:${baudRate}`
  
  // Check for stale instance
  if (activePorts.has(key)) {
    const existing = activePorts.get(key)
    if (existing.isOpen) {
      return existing
    }
    // Clean up stale instance
    activePorts.delete(key)
  }
  
  // Create new port
  const port = new SerialPort({ path, baudRate, autoOpen: false })
  activePorts.set(key, port)
  
  port.on('close', () => {
    activePorts.delete(key)
  })
  
  return port
}
```

---

## Что нужно сделать СЕЙЧАС

1. **Bitmap Printing** - критично для печати кириллицы
2. **Scale Reader Fix** - критично для работы весов
3. **Serial Port Stability** - критично для надежности

---

## Тестирование

После исправлений нужно протестировать:

1. **Принтер:**
   - Печать русского текста
   - Все символы читаемы
   - Нет мусора/иероглифов

2. **Весы:**
   - Стабильное чтение веса
   - Reconnect после отключения
   - SUM1 и SUM2 протоколы

3. **Serial Port:**
   - Нет утечек памяти
   - Нет stale instances
   - Стабильная работа при frequent reconnect

---

## Дата

2026-05-29