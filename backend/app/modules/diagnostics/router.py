from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import sync
from app.core.backup import KEEP_BACKUPS, BackupFile, backup_dir, create_backup, list_backups
from app.core.config import get_settings
from app.core.access import require_any_door, require_owner
from app.core.elevation import DOOR_OWNER, DOOR_SPECIALIST
from app.core.security import get_current_user
from app.db.database import current_db_mode, get_db_session, last_postgres_probe_ok
from app.db.models import Product, Sale, User

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])
settings = get_settings()


class DiagnosticsInfo(BaseModel):
    app_name: str
    app_version: str
    db_mode: str
    postgres_reachable: bool
    sync_pending_count: int
    sqlite_path: str
    sqlite_size_bytes: int
    users_count: int
    products_count: int
    sales_count: int
    db_ok: bool


@router.get("/info", response_model=DiagnosticsInfo)
async def diagnostics_info(
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> DiagnosticsInfo:
    db_path = Path(settings.sqlite_path)
    size = db_path.stat().st_size if db_path.exists() else 0
    users_count = (await session.execute(select(func.count()).select_from(User))).scalar_one()
    products_count = (await session.execute(select(func.count()).select_from(Product))).scalar_one()
    sales_count = (await session.execute(select(func.count()).select_from(Sale))).scalar_one()
    db_ok = True
    try:
        await session.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        db_ok = False
    return DiagnosticsInfo(
        app_name=settings.app_name,
        app_version=settings.app_version,
        db_mode=current_db_mode(),
        # Reused from the background prober rather than probed again here,
        # to avoid adding a network round trip to every diagnostics request.
        postgres_reachable=last_postgres_probe_ok(),
        sync_pending_count=await sync.pending_count(),
        sqlite_path=str(db_path),
        sqlite_size_bytes=size,
        users_count=int(users_count or 0),
        products_count=int(products_count or 0),
        sales_count=int(sales_count or 0),
        db_ok=db_ok,
    )


@router.get("/export-db")
async def export_db(
    _: User = Depends(require_owner),
) -> FileResponse:
    """Выгрузка базы одним файлом — дверь владельца.

    В диагностике кассиру оставлены статус оборудования, тестовая печать и
    логи. База — это все продажи, цены и контакты разом: её выгрузка не
    «диагностика», а вынос данных магазина.

    Снимок делается через VACUUM INTO, а не копированием файла: база работает
    в режиме WAL, и часть подтверждённых транзакций в момент копирования лежит
    в соседнем `-wal`. Копия одного файла из трёх выглядела бы целой, а
    последних чеков в ней не было бы.
    """
    if current_db_mode() == "postgres":
        raise HTTPException(
            status_code=409,
            detail=(
                "Основное хранилище — PostgreSQL, одного локального файла для выгрузки нет. "
                "Используйте pg_dump/pg_restore для настроенной базы Postgres."
            ),
        )
    try:
        snapshot = await create_backup()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Не удалось подготовить копию базы: {exc}") from exc
    return FileResponse(
        path=snapshot.path,
        filename=snapshot.name,
        media_type="application/octet-stream",
    )


# --------------------------------------------------------------------------- #
# Резервные копии                                                              #
# --------------------------------------------------------------------------- #


class BackupOut(BaseModel):
    name: str
    path: str
    size_bytes: int
    created_at: str


class BackupsResponse(BaseModel):
    directory: str
    keep: int
    items: list[BackupOut]


def _backup_out(item: BackupFile) -> BackupOut:
    return BackupOut(
        name=item.name,
        path=item.path,
        size_bytes=item.size_bytes,
        created_at=item.created_at.isoformat(),
    )


@router.get("/backups", response_model=BackupsResponse)
async def list_db_backups(_: User = Depends(require_any_door(DOOR_OWNER, DOOR_SPECIALIST))) -> BackupsResponse:
    return BackupsResponse(
        directory=str(backup_dir()),
        keep=KEEP_BACKUPS,
        items=[_backup_out(item) for item in list_backups()],
    )


@router.post("/backups", response_model=BackupOut, status_code=201)
async def make_db_backup(
    _: User = Depends(require_any_door(DOOR_OWNER, DOOR_SPECIALIST)),
) -> BackupOut:
    """Копия по кнопке. Автоматическая делается при закрытии смены.

    Операция меняет состояние (пишет файл и вытесняет старые копии), поэтому в
    «только чтение» диагностики кассира она не входит. Открыта обеим повышенным
    дверям: копию делают и перед обновлением (специалист), и перед опасными
    операциями владельца.
    """
    if current_db_mode() == "postgres":
        raise HTTPException(
            status_code=409,
            detail="Основное хранилище — PostgreSQL, копию делает pg_dump.",
        )
    try:
        return _backup_out(await create_backup())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Не удалось создать копию: {exc}") from exc
