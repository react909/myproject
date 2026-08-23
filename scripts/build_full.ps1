$ErrorActionPreference = "Stop"

$scriptsDir = $PSScriptRoot

try {
    & (Join-Path $scriptsDir "build_rust.ps1")
} catch {
    Write-Warning "Rust build skipped or failed. Continuing with Python fallback for heavy orders."
}

& (Join-Path $scriptsDir "build_backend.ps1")
& (Join-Path $scriptsDir "build_desktop.ps1")
& (Join-Path $scriptsDir "build_installer.ps1")
