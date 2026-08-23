# Один прогон съёмки: свежий токен, запуск Electron, вывод журнала.
#
# Отдельным файлом, потому что руками это четыре команды, и забытая переменная
# ELECTRON_RUN_AS_NODE в оболочке роняет Electron ещё до окна — без внятного
# сообщения.
param(
  [string]$Out = "$env:TEMP\kassir-shots"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

# Свежий токен: у прошлого мог истечь срок, а вход в кассу — единственное, что
# отделяет съёмку от экрана логина.
#
# Скриптом-файлом, а не через `python -c`: PowerShell снимает кавычки внутри
# аргумента, и код с двойными кавычками доезжает до Python сломанным.
$token = & "$root\backend\.venv\Scripts\python.exe" "$root\tools\demo_token.py"

# Electron, запущенный с этой переменной, стартует как обычный Node и окна не
# открывает вовсе.
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $Out | Out-Null
& "$root\desktop\node_modules\electron\dist\electron.exe" "$root\tools\shoot.cjs" $Out $token
Get-Content "$Out\shoot.log"
