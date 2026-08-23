# NurCRM Manablock — Production Hardware Fix Report

Дата: 2026-05-29

## Что реально изменено

### 1. Весы / COM / VCOM

Полностью переписан файл:

- `desktop/electron/devices/scale-reader.cjs`

Новая архитектура:

- singleton `ScaleManager`
- один владелец COM-порта
- нет постоянного stop/start при одинаковых настройках
- throttled emit веса: минимум `180ms` между событиями
- подавление одинакового веса чаще 1 раза/сек
- polling ограничен минимум `250ms`
- heartbeat раз в 1 сек
- stale stream reconnect после `4000ms` без кадров
- exponential reconnect: `800ms → 1600ms → 3200ms ... max 12000ms`
- generation guard против старых callback после reconnect
- cleanup timers/listeners/port on stop
- parser принимает ASCII, ST/GS, `kg`, граммы, и raw digit frames

Почему раньше лагало:

- reader мог часто перезапускаться через `applySettings()`;
- polling был до `80ms`, что давило main process;
- каждый новый start делал stop/open без state-machine;
- не было throttling для IPC live weight;
- close/error/reconnect могли гоняться друг с другом;
- stale serial instance мог оставаться с listeners.

Теперь live weight идёт через controlled pipeline:

```text
SerialPort data → scale buffer/parser → throttled onWeight → device-manager state → IPC broadcast
```

---

### 2. Кириллица / ESC/POS printer

Добавлен новый файл:

- `desktop/electron/devices/bitmap-printer.cjs`

Изменён файл:

- `desktop/electron/devices/device-manager.cjs`

Новая печать:

- чек рендерится в hidden Electron `BrowserWindow`;
- русский текст рисуется как HTML/Canvas-rendered page;
- страница снимается через `capturePage()`;
- `nativeImage.getBitmap()` конвертируется в монохромный raster;
- отправляется ESC/POS raster command `GS v 0`;
- затем feed + cut.

Почему codepages бесполезны:

- многие китайские ESC/POS прошивки не имеют CP1251/CP866;
- `ESC t n` может игнорироваться;
- номер codepage у разных firmware разный;
- часть принтеров печатает только китайские таблицы;
- поэтому русский текст как байты превращается в иероглифы/мусор.

Почему bitmap решает:

- принтер больше не должен понимать русский;
- он получает только чёрно-белые точки;
- кириллицу рисует Chromium/Electron, а не firmware принтера;
- результат не зависит от CP1251/CP866/ESC t n.

Порядок печати теперь:

```text
printReceipt/testPrinter
  → buildBitmapReceiptBuffer()
  → serialPort.writeBuffer()
  → если bitmap упал, только тогда fallback на старый text/codepage flow
```

---

### 3. Serial port stability

Изменён файл:

- `desktop/electron/devices/serial-port.cjs`

Добавлено:

- per-port write queue (`writeQueues`);
- timeout protection для open/write/LPT write;
- COM path normalization `\\.\COMx`;
- LPT path normalization `\\.\LPTx`;
- `drain()` перед close;
- cleanup listeners после записи;
- последовательная запись в один порт без overlap.

Почему COM был нестабилен:

- печать могла открыть порт поверх другой операции;
- не было queue/mutex per port;
- COM close мог происходить до drain;
- timeout не ограничивал зависшие write/open;
- stale listeners могли оставаться после ошибок.

---

## Проверки, которые выполнены

### Syntax check Electron CJS

Проверены:

- `bitmap-printer.cjs`
- `device-manager.cjs`
- `scale-reader.cjs`
- `serial-port.cjs`

Команда прошла без syntax errors:

```powershell
node --check desktop\electron\devices\bitmap-printer.cjs
node --check desktop\electron\devices\device-manager.cjs
node --check desktop\electron\devices\scale-reader.cjs
node --check desktop\electron\devices\serial-port.cjs
```

### Frontend build

```powershell
cd desktop
npm run build
```

Результат: успешно.

### Production dist

```powershell
cd desktop
npm run dist
```

Результат: успешно.

Создано:

- `desktop/dist-electron/NurCRM Manablock Setup 1.1.1.exe`
- `desktop/dist-electron/latest.yml`
- `desktop/dist-electron/NurCRM Manablock Setup 1.1.1.exe.blockmap`

winCodeSign symlink error не появился.

---

## Что теперь production-ready

1. Кириллица больше не зависит от codepage — используется bitmap/raster печать.
2. Весы больше не создают агрессивный polling/restart loop.
3. Live weight IPC throttled и не должен спамить renderer/main.
4. Reconnect весов controlled через state-machine/backoff.
5. Serial write защищён queue + timeout + drain.

---

## Что всё ещё обязательно тестировать на моноблоке

Это hardware layer, поэтому финальная истина только на реальном железе:

1. Принтер:
   - тестовый чек из Diagnostics;
   - реальный чек оплаты;
   - русский магазин/товар/кассир/итого;
   - скорость raster printing;
   - ширина бумаги: если чек слишком широкий/узкий, менять `DEFAULT_WIDTH` в `bitmap-printer.cjs` (`576` для 80mm, `384` для 58mm).

2. Весы:
   - SUM1 на COM2/9600;
   - SUM2 на выбранном baud;
   - отключить/подключить USB/VCOM;
   - проверить reconnect без restart приложения;
   - проверить, что UI не лагает при live weight.

3. Serial:
   - LPT печать;
   - COM печать, если используется;
   - одновременная работа весов + принтера;
   - повторная печать/duplicate receipt.

---

## Финальная production hardware architecture

```text
Renderer UI
  ↓ IPC commands only
Electron main / device-manager
  ├─ Printer pipeline
  │   ├─ bitmap-printer: HTML → nativeImage → raster GS v 0
  │   ├─ serial-port: queued write + timeout + drain
  │   └─ text/codepage fallback only if bitmap fails
  │
  └─ Scale pipeline
      ├─ singleton ScaleManager
      ├─ one active COM owner
      ├─ non-blocking serial data events
      ├─ buffer parser SUM/text/raw digits
      ├─ throttled weight emit
      ├─ heartbeat stale detection
      └─ exponential reconnect
```

## Финальная команда сборки

```powershell
cd desktop
npm run dist
```
