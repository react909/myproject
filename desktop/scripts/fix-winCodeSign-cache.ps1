# Fix winCodeSign cache extraction by extracting without symlinks
# This script manually extracts the winCodeSign archive without creating symlinks

$ErrorActionPreference = "Stop"

$cacheDir = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\winCodeSign"
$downloadUrl = "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z"
$archivePath = Join-Path $cacheDir "winCodeSign-2.6.0.7z"

Write-Host "Creating cache directory..."
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

# Check if 7z is available
$sevenZaPath = Join-Path $PSScriptRoot "..\node_modules\7zip-bin\win\x64\7za.exe"
if (-not (Test-Path $sevenZaPath)) {
    Write-Host "7za.exe not found at $sevenZaPath"
    exit 1
}

Write-Host "Downloading winCodeSign archive..."
Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath

# Extract WITHOUT symlinks (use -snl- to disable symlinks)
$extractDir = Join-Path $cacheDir "555862855"
Write-Host "Extracting to $extractDir without symlinks..."

# Use -snl- to disable symbolic links (correct syntax)
& $sevenZaPath x -snl- -bd $archivePath "-o$extractDir"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Successfully extracted winCodeSign cache without symlinks"
} else {
    Write-Host "Extraction failed with code $LASTEXITCODE"
    exit 1
}

Write-Host "Done!"