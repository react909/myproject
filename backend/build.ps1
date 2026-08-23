# Build local FastAPI backend into backend/dist/backend/backend.exe (onedir)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

python -m pip install -r requirements.txt -q
python -m pip install pyinstaller -q

if (Test-Path dist) { Remove-Item -Recurse -Force dist }
if (Test-Path build) { Remove-Item -Recurse -Force build }

pyinstaller `
  --noconfirm `
  --clean `
  --onedir `
  --name backend `
  --distpath dist `
  --workpath build `
  --hidden-import uvicorn.logging `
  --hidden-import uvicorn.loops `
  --hidden-import uvicorn.loops.auto `
  --hidden-import uvicorn.protocols `
  --hidden-import uvicorn.protocols.http `
  --hidden-import uvicorn.protocols.http.auto `
  --hidden-import uvicorn.protocols.websockets.auto `
  --hidden-import uvicorn.lifespan.on `
  --hidden-import aiosqlite `
  --collect-all uvicorn `
  --collect-all fastapi `
  --collect-all starlette `
  main.py

Write-Host "Built: $(Join-Path $PWD 'dist\backend\backend.exe')"
