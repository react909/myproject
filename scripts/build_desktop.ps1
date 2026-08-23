$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$desktopDir = Join-Path $root "desktop"

Set-Location $desktopDir
npm install
npm run dist
