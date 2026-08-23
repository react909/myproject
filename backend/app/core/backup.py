"""Резервные копии базы.

Снимок делает сам бэкенд, а не файловый менеджер снаружи, и это принципиально.
База работает в режиме WAL: часть уже подтверждённых транзакций в момент
копирования лежит не в `nurcrm.db`, а в соседнем `nurcrm.db-wal`. Копия одного
файла из трёх — это база без последних чеков, то есть худший вид бэкапа:
выглядит целым, а данных в нём нет.

`VACUUM INTO` решает это правильно — SQLite сам собирает согласованный снимок
со всеми подтверждёнными транзакциями в один файл, не блокируя запись. Заодно
копия выходит уплотнённой.

Копия делается при закрытии смены, не чаще раза в сутки: это единственный
момент, когда касса заведомо не в середине продажи, и он случается каждый день
сам собой — просить владельца «не забывать делать бэкап» бессмысленно.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import text

from app.core.config import get_settings
from app.db.database import sqlite_engine

logger = logging.getLogger("nurcrm.backup")

# Сколько копий держим. Семь — это неделя: поломку замечают в пределах
# нескольких дней, а хранить больше на кассовом моноблоке с малым диском
# незачем.
KEEP_BACKUPS = 7

_NAME_PATTERN = re.compile(r"^nurcrm-(\d{4}-\d{2}-\d{2})-(\d{6})\.db$")


@dataclass(frozen=True)
class BackupFile:
    name: str
    path: str
    size_bytes: int
    created_at: datetime


def backup_dir() -> Path:
    """Папка копий — рядом с базой, в профиле приложения."""
    directory = Path(get_settings().sqlite_path).resolve().parent / "backups"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def list_backups() -> list[BackupFile]:
    """Копии от свежих к старым."""
    found: list[BackupFile] = []
    for path in backup_dir().glob("nurcrm-*.db"):
        match = _NAME_PATTERN.match(path.name)
        if not match:
            continue
        try:
            stamp = datetime.strptime(f"{match.group(1)}-{match.group(2)}", "%Y-%m-%d-%H%M%S")
            stat = path.stat()
        except (ValueError, OSError):
            continue
        found.append(
            BackupFile(
                name=path.name,
                path=str(path),
                size_bytes=stat.st_size,
                created_at=stamp.replace(tzinfo=UTC),
            )
        )
    return sorted(found, key=lambda item: item.created_at, reverse=True)


def _prune() -> None:
    """Оставляет KEEP_BACKUPS свежих копий, остальные удаляет."""
    for stale in list_backups()[KEEP_BACKUPS:]:
        try:
            Path(stale.path).unlink()
        except OSError:
            logger.warning("не удалось удалить старую копию %s", stale.name)


def last_backup_age_hours() -> float | None:
    """Сколько часов назад делали копию. None — копий нет вовсе."""
    backups = list_backups()
    if not backups:
        return None
    return (datetime.now(UTC) - backups[0].created_at).total_seconds() / 3600


async def create_backup() -> BackupFile:
    """Делает снимок базы. Бросает исключение, если снимок не получился.

    Молча проглатывать ошибку нельзя: владелец должен узнать, что копий нет,
    сейчас, а не в тот день, когда они понадобятся.
    """
    stamp = datetime.now(UTC).strftime("%Y-%m-%d-%H%M%S")
    target = backup_dir() / f"nurcrm-{stamp}.db"
    if target.exists():
        target.unlink()

    # Путь подставляется в SQL строкой: параметры в VACUUM INTO SQLite не
    # принимает. Значение при этом наше собственное и построено из формата
    # выше — пользовательский ввод сюда не попадает.
    literal = str(target).replace("'", "''")
    async with sqlite_engine.connect() as conn:
        await conn.execute(text(f"VACUUM INTO '{literal}'"))

    _prune()
    stat = target.stat()
    logger.info("создана резервная копия %s (%d байт)", target.name, stat.st_size)
    return BackupFile(
        name=target.name,
        path=str(target),
        size_bytes=stat.st_size,
        created_at=datetime.now(UTC),
    )


async def create_daily_backup() -> BackupFile | None:
    """Суточная копия. Возвращает None, если сегодняшняя уже есть.

    Вызывается при закрытии смены. Смен за день бывает несколько, и снимать
    базу после каждой значило бы за неделю потерять историю: семь копий
    израсходовались бы за один насыщенный день.
    """
    age = last_backup_age_hours()
    if age is not None and age < 20:
        return None
    return await create_backup()
