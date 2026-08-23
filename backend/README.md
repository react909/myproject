# Kassir ERP — Local Backend

Local FastAPI POS API. PostgreSQL is the primary store; SQLite is an
automatic offline fallback used only while Postgres is unreachable, with
changes replayed back via `sync_log` once it recovers (see
`app/core/database.py` and `app/core/sync.py`). No internet connection is
required either way — Postgres runs locally on the shop's computer.

## Dev

```bash
cd backend
pip install -r requirements.txt
set SQLITE_PATH=%USERPROFILE%\AppData\Roaming\NurCRM Manablock\nurcrm.db
set NURCRM_POSTGRES_DSN=postgresql+psycopg://postgres:postgres@127.0.0.1:5432/nurcrm
python main.py
```

If Postgres isn't reachable at startup, the backend logs a warning and
keeps running on the SQLite fallback until it is. Force a specific engine
for testing with `NURCRM_DB_MODE=postgres_only` or `NURCRM_DB_MODE=sqlite_only`.

API: `http://127.0.0.1:8000`  
Health: `GET /health`  
First run: `GET /api/setup/status`, `POST /api/setup/init`

## Build exe (for Electron packaging)

```powershell
.\build.ps1
```

Output: `dist/backend/backend.exe` (bundled by electron-builder as `resources/backend`).
