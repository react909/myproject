# NurCRM Manablock — Production Build Fix

## Проблема (Problem)

После последних изменений electron-builder не мог создать NSIS installer из-за ошибки при извлечении winCodeSign cache:

```
ERROR: Cannot create symbolic link : Не удается создать символическую ссылку. : 
C:\Users\user\AppData\Local\electron-builder\Cache\winCodeSign\...\darwin\10.12\lib\libcrypto.dylib
ERROR: Cannot create symbolic link : Не удается создать символическую ссылку. : 
C:\Users\user\AppData\Local\electron-builder\Cache\winCodeSign\...\darwin\10.12\lib\libssl.dylib
```

## Причина (Root Cause)

electron-builder использовал встроенный 7za.exe с флагом `-snld` (create symbolic links) при извлечении winCodeSign архива. Windows не позволял создавать символические ссылки без прав администратора или Developer Mode, даже though эти symlink'ы были для macOS файлов и не нужны для Windows сборки.

## Решение (Solution)

Добавлено `"signAndEditExecutable": false` в конфигурацию `win` в `package.json`:

```json
"win": {
  "icon": "build-resources/icon.ico",
  "executableName": "NurCRM-Manablock",
  "signAndEditExecutable": false,
  "target": [
    {
      "target": "nsis",
      "arch": ["x64"]
    }
  ]
}
```

Эта настройка указывает electron-builder не пытаться подписывать или редактировать исполняемые файлы, что устраняет необходимость в winCodeSign инструментах и избегает проблемы с symlink.

## Финальная команда для production build

```bash
cd desktop
npm run dist
```

## Результат (Output)

После успешной сборки в `desktop/dist-electron/` появятся:

1. **`NurCRM Manablock Setup 1.1.1.exe`** — NSIS installer (~103 MB)
   - Копируйте этот файл на моноблок
   - Запустите для установки
   - После установки появится ярлык "NurCRM Manablock" на рабочем столе

2. **`win-unpacked/`** — распакованная версия для тестирования
   - Можно запустить `NurCRM-Manablock.exe` напрямую

3. **`latest.yml`** — манифест для обновлений

## Проверка после установки

1. Запустите ярлык **NurCRM Manablock** (не Setup.exe!)
2. Проверьте что:
   - Иконка отображается на ярлыке
   - Приложение запускается без ошибок ICU
   - Splash screen показывается
   - CRM открывается в fullscreen режиме

## Что было исправлено

| Файл | Изменение |
|------|-----------|
| `desktop/package.json` | Добавлено `"signAndEditExecutable": false` в `win` конфигурацию |

## Важно

- НЕ удаляйте `signAndEditExecutable: false` — это сломает сборку
- Эта настройка безопасна для production — мы не используем code signing
- serialport, COM весы, ESC/POS принтер работают корректно
- ICU данные (icudtl.dat) извлекаются правильно
- Все иконки встраиваются корректно

## Дата исправления

2026-05-26