$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$rustDir = Join-Path $root "rust-core"
$backendDir = Join-Path $root "backend"
$releaseDll = Join-Path $rustDir "target\release\rust_core.dll"
$releasePyd = Join-Path $rustDir "target\release\rust_core.pyd"
$backendPyd = Join-Path $backendDir "rust_core.pyd"

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Warning "Cargo not found."
    Write-Host "Install Rust in one line:"
    Write-Host 'powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest https://win.rustup.rs/x86_64 -OutFile rustup-init.exe; .\rustup-init.exe -y"'
    throw "Rust/Cargo is required to build rust_core.pyd."
}

Set-Location $rustDir
cargo build --release

if (Test-Path $releasePyd) {
    Copy-Item -Force $releasePyd $backendPyd
} elseif (Test-Path $releaseDll) {
    Copy-Item -Force $releaseDll $backendPyd
} else {
    throw "Rust build completed, but rust_core binary was not found in target\release."
}

Write-Host "Rust module copied to $backendPyd"
