$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $root "backend"
$backendBuildDir = Join-Path $root "build\backend"
$rustModulePath = Join-Path $backendDir "rust_core.pyd"

Write-Host "Installing Python dependencies..."
python -m pip install -U pip
python -m pip install -r (Join-Path $backendDir "requirements.txt")

Write-Host "Building backend.exe with PyInstaller..."
Set-Location $backendDir

$pyInstallerArgs = @(
    "--noconfirm",
    "--onefile",
    "--name", "backend",
    "--paths", ".",
    "--collect-submodules", "app",
    "--distpath", "dist",
    "--workpath", (Join-Path $root "build\pyinstaller"),
    "--specpath", (Join-Path $root "build\pyinstaller"),
    "app/main.py"
)

if (Test-Path $rustModulePath) {
    $pyInstallerArgs = @(
        "--add-data", "rust_core.pyd;."
    ) + $pyInstallerArgs
} else {
    Write-Warning "backend\\rust_core.pyd not found. backend.exe will be built with Python fallback for heavy orders."
}

python -m PyInstaller @pyInstallerArgs

New-Item -ItemType Directory -Force $backendBuildDir | Out-Null
Copy-Item -Force (Join-Path $backendDir "dist\backend.exe") (Join-Path $backendBuildDir "backend.exe")

Write-Host "Backend build complete:"
Write-Host " - $(Join-Path $backendDir 'dist\backend.exe')"
Write-Host " - $(Join-Path $backendBuildDir 'backend.exe')"
