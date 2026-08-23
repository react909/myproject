$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$issPath = Join-Path $root "installer\NurCRM.iss"

$candidatePaths = @(
    $env:INNO_SETUP_PATH,
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
) | Where-Object { $_ -and (Test-Path $_) }

if (-not $candidatePaths) {
    throw "Inno Setup not found. Install Inno Setup 6 and ensure ISCC.exe exists."
}

$iscc = $candidatePaths[0]
& $iscc $issPath
