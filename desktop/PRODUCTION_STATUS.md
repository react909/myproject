# NurCRM Manablock — статус готовности (честный отчёт)

Дата: 2026-05-20

## Production-ready (реализовано в коде)

| Область | Статус | Примечание |
|--------|--------|------------|
| Установщик NSIS | Готово к сборке | `oneClick: false`, ярлык, GUID — запуск только с ярлыка, не Setup.exe |
| Splash | ≤ ~1.6 с | Таймаут принудительного закрытия |
| `/8520` hotkey | Stripe-drag | Режим выбора + якорь на 1-й строке → протяжка вниз (не select all) |
| Офлайн-очередь | Архитектура | `localStorage` + retry каждые 5 с + sync при Online |
| Принтер ESC/POS | Hardware-ready | `serialport` + LPT1/COM, CP866, `receipt-template.cjs` |
| Весы COM | Hardware-ready | `scale-reader.cjs` — постоянное чтение порта, poll HEX-команды |
| IPC устройств | Готово | `devices-apply-settings`, live weight, print, diagnostics |
| Обновления UI | Упрощено | Один блок + modal «Что нового» + Install |
| Welcome toast | 1 раз / сессия | `sessionStorage` на кассе |
| Производительность UI | Улучшено | `startTransition`, memo каталога, быстрый exit списка чека |

## Требует проверки на реальном моноблоке (нельзя подтвердить без железа)

| Область | Что сделать на месте |
|--------|---------------------|
| Печать чека | Настройки → Принтер → LPT1/COM → тест → оплата |
| Чтение веса | Настройки → Весы → COM + baud + HEX команда из паспорта весов |
| USB-Serial адаптер | Убедиться, что порт в списке диагностики |
| Синхронизация CRM | Endpoint `POST http://127.0.0.1:8000/api/pos/sales` — нужен живой backend |

## Mock / dev-only (не для демо владельцам)

| Что | Где |
|-----|-----|
| Каталог товаров | `MOCK_PRODUCTS` + local panel products |
| Финансы / аналитика / чеки в панели | `Math.random` demo-данные |
| Dev-режим updater | В dev нет fake «доступно 1.1.0» в production UI |

## Ещё не сделано (честно)

| Что | Почему |
|-----|--------|
| Rust 20–30% | Не внедрён; план: парсер весов / ESC/POS в native |
| node-escpos пакет | Используется свой ESC/POS buffer (достаточно для 80 мм) |
| Виртуализация каталога 1000+ SKU | Не нужна пока mock-каталог небольшой |
| Полный CRM API | Контракт заложен, сервер должен ответить 200 OK |

## Как не опозориться на демо

1. Собрать: `npm run dist`
2. Установить **один раз** `NurCRM Manablock Setup x.x.x.exe`
3. Запускать только ярлык **NurCRM Manablock** (не Setup.exe)
4. Настройки → Весы / Принтер → Диагностика → Касса
5. `/` `8` `5` `2` `0` — сразу ведите пальцем вниз по чеку (полоса выделения)
6. Offline в топбаре — продажа сохранится локально

## Файлы железа

- `electron/devices/serial-port.cjs` — COM/LPT запись
- `electron/devices/scale-reader.cjs` — непрерывное чтение весов
- `electron/devices/device-manager.cjs` — оркестрация
- `electron/devices/receipt-template.cjs` — ESC/POS CP866
- `src/hooks/usePosCartKeyboard.ts` — POS клавиатура
- `src/services/offline/transaction-queue.ts` — офлайн очередь
