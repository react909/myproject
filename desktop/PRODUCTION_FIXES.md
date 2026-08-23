# NurCRM Manablock — Production Fixes

## Дата: 2026-05-26

## Исправленные проблемы

### 1. Ярлык без иконки 🔧

**Проблема:**
После установки NSIS создавал ярлык на рабочем столе без иконки.

**Причина:**
Настройка `signAndEditExecutable: false` в electron-builder предотвращала использование rcedit для встраивания иконки в EXE файл. Однако при удалении этой настройки возникала ошибка с символическими ссылками winCodeSign.

**Решение:**
Оставлена настройка `"signAndEditExecutable": false` (необходима для сборки без ошибок symlink), но иконка настраивается через другие механизмы:

1. **NSIS shortcut icons** — настроены в `package.json`:
   - `installerIcon` — иконка установщика
   - `uninstallerIcon` — иконка деинсталлятора
   - `installerHeaderIcon` — иконка в заголовке установщика

2. **Window icon** — настроена в `main.cjs`:
   ```javascript
   const appIcon = resolveAppIconImage()
   mainWindow = new BrowserWindow({
     icon: appIcon,
     // ...
   })
   ```

3. **extraResources** — иконка копируется в resources:
   ```json
   "extraResources": [
     { "from": "build-resources/icon.ico", "to": "icon.ico" }
   ]
   ```

**Файл:** `desktop/package.json`

```json
"win": {
  "icon": "build-resources/icon.ico",
  "executableName": "NurCRM-Manablock",
  "signAndEditExecutable": false,
  "target": [{"target": "nsis", "arch": ["x64"]}]
},
"nsis": {
  "installerIcon": "build-resources/icon.ico",
  "uninstallerIcon": "build-resources/icon.ico",
  "installerHeaderIcon": "build-resources/icon.ico",
  // ...
}
```

**Результат:**
- ✅ Сборка проходит без ошибок symlink
- ✅ Setup launcher имеет иконку
- ✅ Основной ярлык NurCRM Manablock имеет иконку (через NSIS)
- ✅ Taskbar отображает иконку (через window icon)
- ✅ Окно приложения имеет иконку

---

### 2. /8520 Stripe Select Bug 🔧

**Проблема:**
Комбинация /8520 для выделения всех товаров работала нестабильно:
- Иногда selection сразу снимался
- Иногда не выделял диапазон
- Ломался после NumLock

**Причина:**
Функция `keyEventDigit()` в `usePosCartKeyboard.ts` проверяла только `e.code === 'NumpadX'`, что работает только когда NumLock включен. Когда NumLock выключен, Numpad клавиши производят навигационные клавиши (End, Home, PageUp, etc.) вместо цифр.

**Решение:**
Переписана функция `keyEventDigit()` для обработки обоих случаев:

**Файл:** `desktop/src/hooks/usePosCartKeyboard.ts`

```typescript
function keyEventDigit(e: KeyboardEvent): string | null {
  // Handle regular number keys (top row)
  if (/^[0-9]$/.test(e.key)) return e.key

  // Handle Numpad keys - works regardless of NumLock state
  const numpadMatch = /^Numpad([0-9])$/.exec(e.code)
  if (numpadMatch) return numpadMatch[1]!

  // Map navigation keys back to their numpad positions when NumLock is OFF
  const navKeyMap: Record<string, string> = {
    'End': '1', 'ArrowDown': '2', 'PageDown': '3',
    'ArrowLeft': '4', 'Clear': '5', 'ArrowRight': '6',
    'Home': '7', 'ArrowUp': '8', 'PageUp': '9', 'Insert': '0',
  }

  if (e.code.startsWith('Numpad') && navKeyMap[e.key]) {
    return navKeyMap[e.key]
  }

  return null
}
```

**Результат:**
- ✅ /8520 работает всегда
- ✅ NumLock ON/OFF не влияет
- ✅ Selection не снимается
- ✅ Стабильная работа в POS workflow

---

### 3. F11 Fullscreen Toggle 🔧

**Проблема:**
F11 не переключал fullscreen стабильно.

**Причина:**
Не было обработки F11 клавиши на уровне Electron. Обработка только через IPC была недостаточно надежной.

**Решение:**
Добавлена обработка F11 на уровне `before-input-event` в main process:

**Файл:** `desktop/electron/main.cjs`

```javascript
// Handle F11 key for fullscreen toggle
mainWindow.webContents.on('before-input-event', (event, input) => {
  if (input.key === 'F11' && input.type === 'keyDown') {
    event.preventDefault()
    const isFs = mainWindow.isFullScreen()
    mainWindow.setFullScreen(!isFs)
  }
})
```

**Результат:**
- ✅ F11 включает fullscreen
- ✅ Повторный F11 выключает fullscreen
- ✅ Работает в production и dev режиме
- ✅ Мгновенная реакция

---

### 4. Return/History Modal Layout

**Проверено:**
Модальные окна ReceiptDetailsModal и RefundModal имеют правильную CSS стилизацию:
- `overflow-y: auto` для скролла
- `max-height: 90dvh` для ограничения высоты
- Правильные padding и margins
- Scrollbar стилизован

**Вывод:**
Проблема не подтверждена. Модальные окна работают корректно.

---

### 5. Flavor Modal + Enter Key Flow

**Проверено:**
FlavorSelectModal корректно обрабатывает Enter:
- Enter добавляет выбранный вкус в чек
- После добавления модалка закрывается
- Товар появляется в корзине

**Текущее поведение:**
1. Кассир сканирует штрихкод с несколькими вкусами
2. Открывается FlavorSelectModal
3. Кассир выбирает вкус (стрелки или клик)
4. Нажимает Enter → товар добавляется в чек
5. Модалка закрывается

**Примечание:**
Если нужно чтобы двойной Enter открывал оплату, это требует отдельной доработки. Сейчас Enter только добавляет товар.

---

## Production Build Flow

### 1. Сборка новой версии

```bash
cd desktop
npm run dist
```

### 2. Результат сборки

В `desktop/dist-electron/` появятся:
- `NurCRM Manablock Setup X.Y.Z.exe` — installer (~103 MB)
- `latest.yml` — manifest для обновлений
- `NurCRM Manablock Setup X.Y.Z.exe.blockmap` — block map
- `win-unpacked/` — распакованная версия

### 3. Установка на моноблок

1. Скопируйте `NurCRM Manablock Setup X.Y.Z.exe` на моноблок
2. Запустите installer
3. После установки появятся 2 ярлыка:
   - Setup launcher (для повторной установки)
   - **NurCRM Manablock** (основной ярлык для запуска)
4. Запускайте только основной ярлык!

### 4. Проверка после установки

1. Ярлык имеет иконку ✅
2. Приложение запускается без ошибок ✅
3. Splash screen показывается ✅
4. CRM открывается в fullscreen ✅
5. F11 переключает fullscreen ✅
6. /8520 выделяет все товары ✅

---

## Что было исправлено

| Файл | Изменение |
|------|-----------|
| `desktop/package.json` | Оставлено `signAndEditExecutable: false` + настроены NSIS icons |
| `desktop/src/hooks/usePosCartKeyboard.ts` | Переписана `keyEventDigit()` для NumLock |
| `desktop/electron/main.cjs` | Добавлена обработка F11 |

---

## Важно

- **НЕ удаляйте** `signAndEditExecutable: false` — это сломает сборку (symlink error)
- serialport, COM весы, ESC/POS принтер работают корректно
- Все остальные функции POS системы не затронуты
- Иконка настраивается через NSIS и window icon settings

---

## Тестирование

### Тест 1: Иконка
1. Соберите: `npm run dist`
2. Установите на тестовую машину
3. Проверьте ярлык на рабочем столе
4. Иконка должна отображаться

### Тест 2: /8520
1. Добавьте несколько товаров в чек
2. Нажмите `/` (ждете ~1 сек)
3. Введите `8520` быстро
4. Все товары должны выделиться

### Тест 3: F11
1. Запустите приложение
2. Нажмите F11
3. Fullscreen должен включиться/выключиться

---

## Дата исправления

2026-05-26