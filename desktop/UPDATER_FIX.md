# NurCRM Manablock — Updater Fix

## Проблема (Problem)

Updater постоянно spam'ил уведомлениями об ошибках:
- "Проверка обновлений"
- "Не удалось проверить обновления"
- "Проверьте интернет или адрес сервера обновлений"

При ручном нажатии "Проверить обновления" в настройках:
```
Error invoking remote method 'updater-check':
Error: net::ERR_NAME_NOT_RESOLVED
```

## Причина (Root Cause)

1. **Несуществующий сервер обновлений**: URL `https://updates.nurcrm.kz/desktop/` не существует
2. **autoCheck включен по умолчанию**: При каждом запуске приложения происходила попытка проверки
3. **Error notifications показывались всегда**: Каждая неудачная проверка вызывала popup уведомление

## Решение (Solution)

### 1. Отключить autoCheck by default

**Файл:** `desktop/src/settings/appSettings.ts`

```diff
  updates: {
    currentVersion: '1.1.1',
    updateUrl: DEFAULT_UPDATE_URL,
    lastChecked: null,
-   autoCheck: true,
+   autoCheck: false,
    availableVersion: null,
  },
```

### 2. Убрать error notifications из bootstrap

**Файл:** `desktop/src/hooks/useAppBootstrap.ts`

```diff
  const unsubUpdater = subscribeUpdater(
    (status) => {
+     // Only show notifications for important events
+     // Error notifications are suppressed during auto-check to avoid spam
      if (status.phase === 'available') {
        push({
          kind: 'update',
          title: 'Доступно обновление',
          message: `Вышла новая версия ${status.version ?? ''}...`,
          dismissMs: 15000,
        })
      }
      if (status.phase === 'downloaded') {
        push({
          kind: 'update',
          title: 'Обновление загружено',
          message: `Перезапуск для установки ${status.version ?? ''}...`,
          dismissMs: 12000,
        })
      }
-     if (status.phase === 'error') {
-       push({
-         kind: 'warning',
-         title: 'Проверка обновлений',
-         message: 'Не удалось проверить обновления...',
-         dismissMs: 10000,
-       })
-     }
+     // Note: error notifications are suppressed here
+     // They will only be shown on manual check in UpdatesSection
    },
    ...
  )
```

## Как теперь работает updater

### Автоматическая проверка (autoCheck)
- **Отключена по умолчанию** — никаких фоновых проверок
- Пользователь может включить в Настройки → Обновления → "Проверять обновления при запуске"

### Ручная проверка (кнопка "Обновить")
- Пользователь нажимает кнопку в настройках
- Если есть обновление — показывается notification + статус в UI
- Если ошибка — показывается **inline error** в UI (не popup)
- Если всё актуально — показывается success message

### Уведомления
- **available**: "Доступно обновление" → показывает один раз
- **downloaded**: "Обновление загружено" → показывает перед перезапуском
- **error**: НЕ показывает notification (только inline в UI настроек)

## Как публиковать новые обновления

### 1. Собрать новую версию
```bash
cd desktop
npm run dist
```

### 2. Файлы для публикации
В `desktop/dist-electron/` появятся:
- `NurCRM Manablock Setup X.Y.Z.exe` — installer
- `latest.yml` — manifest для electron-updater
- `NurCRM Manablock Setup X.Y.Z.exe.blockmap` — block map

### 3. Загрузить на сервер
Загрузите все 3 файла на ваш update server:
```
https://updates.nurcrm.kz/desktop/
├── latest.yml
├── NurCRM Manablock Setup 1.2.0.exe
└── NurCRM Manablock Setup 1.2.0.exe.blockmap
```

### 4. latest.yml формат
electron-builder автоматически генерирует правильный `latest.yml`:
```yaml
version: 1.2.0
files:
  - url: NurCRM Manablock Setup 1.2.0.exe
    sha512: xxxxx
    size: 12345678
path: NurCRM Manablock Setup 1.2.0.exe
sha512: xxxxx
releaseDate: '2026-05-26T00:00:00.000Z'
```

## Как протестировать updater локально

### 1. Создать локальный update server
```bash
# В dist-electron лежит latest.yml и .exe
# Запустите простой HTTP server:
cd desktop/dist-electron
python -m http.server 8080
```

### 2. Указать локальный URL
В приложении: Настройки → Обновления → URL сервера обновлений:
```
http://localhost:8080/
```

### 3. Нажать "Проверить обновления"

### 4. Для теста без реального сервера
Измените `package.json` version на более высокую чем текущая, пересоберите, и загрузите файлы на локальный server.

## Как проверить update server

```bash
# Проверить доступность latest.yml
curl -I https://updates.nurcrm.kz/desktop/latest.yml

# Должно вернуть:
# HTTP/1.1 200 OK
# Content-Type: text/yaml

# Проверить содержимое
curl https://updates.nurcrm.kz/desktop/latest.yml
```

## Что было исправлено

| Файл | Изменение |
|------|-----------|
| `desktop/src/settings/appSettings.ts` | `autoCheck: true` → `autoCheck: false` |
| `desktop/src/hooks/useAppBootstrap.ts` | Убраны error notifications из subscribeUpdater |

## Важно

- **НЕ включайте autoCheck** пока не настроите реальный update server
- Error notifications теперь показываются только при **ручной** проверке (inline в UI)
- silent background check не spam'ит уведомлениями
- serialport, COM весы, ESC/POS принтер работают корректно
- Все остальные функции POS системы не затронуты

## Дата исправления

2026-05-26