from __future__ import annotations

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

# Legacy SQLite-only hand-rolled migrations. Kept only to carry forward
# pre-existing nurcrm.db files (installs that predate Alembic) to the same
# schema shape as the Alembic baseline (backend/alembic/versions/0001_*).
# Fresh databases — new SQLite files and every Postgres database — go
# straight through Alembic instead. See run_migrations() below.
LEGACY_SCHEMA_VERSION = 4

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"
_ALEMBIC_SCRIPT_LOCATION = _BACKEND_DIR / "alembic"


def _to_sync_dsn(dsn: str) -> str:
    """Alembic's own connection is synchronous — drop the async driver marker."""
    if dsn.startswith("sqlite+aiosqlite://"):
        return "sqlite://" + dsn[len("sqlite+aiosqlite://") :]
    return dsn


def _run_alembic(sync_dsn: str, *, stamp_only: bool, base_revision: str | None = None) -> None:
    cfg = Config(str(_ALEMBIC_INI))
    # alembic.ini's "script_location = alembic" is otherwise resolved
    # relative to the process's current working directory, not relative to
    # the ini file itself — fragile across invocation contexts (dev shell
    # cwd, PyInstaller bundle, tests). Pin it absolutely instead.
    cfg.set_main_option("script_location", str(_ALEMBIC_SCRIPT_LOCATION))
    cfg.attributes["target_dsn"] = sync_dsn
    if base_revision:
        # Mark this DB as already at base_revision (its actual shape,
        # produced by create_all + the legacy upgrades below) WITHOUT
        # running any migrations, then continue with a real upgrade below
        # so every revision after base_revision actually applies.
        command.stamp(cfg, base_revision)
    if stamp_only:
        command.stamp(cfg, "head")
    else:
        command.upgrade(cfg, "head")


def _create_all_tables(sync_conn) -> None:
    from app.db.models import Base

    Base.metadata.create_all(sync_conn)


async def run_migrations(engine: AsyncEngine) -> None:
    dialect = engine.dialect.name
    # hide_password=False: engine.url.__str__ masks the password by default,
    # which would make Alembic try to connect with the literal string "***".
    sync_dsn = _to_sync_dsn(engine.url.render_as_string(hide_password=False))

    if dialect == "sqlite" and await _has_legacy_schema(engine):
        # Pre-existing install from before Alembic: bring it up to the same
        # column shape the "0001" baseline expects (create_all fills in any
        # tables missing entirely, the legacy upgrades below add the
        # store_settings columns that were historically added piecemeal).
        # Stamp that shape as "0001" and then run a REAL upgrade to head —
        # not stamp-to-head — so 0002+ revisions actually apply here too.
        async with engine.begin() as conn:
            await conn.run_sync(_create_all_tables)
            await _apply_legacy_upgrades(conn)
        await asyncio.to_thread(_run_alembic, sync_dsn, stamp_only=False, base_revision="0001")
        return

    await asyncio.to_thread(_run_alembic, sync_dsn, stamp_only=False)


async def _has_legacy_schema(engine: AsyncEngine) -> bool:
    async with engine.connect() as conn:
        exists = (
            await conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
            )
        ).fetchone()
        if not exists:
            return False
        row = (await conn.execute(text("SELECT version FROM schema_version WHERE id = 1"))).fetchone()
        return row is not None


async def _apply_legacy_upgrades(conn: AsyncConnection) -> None:
    row = (await conn.execute(text("SELECT version FROM schema_version WHERE id = 1"))).fetchone()
    current = int(row[0]) if row else 0
    if current >= LEGACY_SCHEMA_VERSION:
        return
    await _apply_upgrades(conn, current, LEGACY_SCHEMA_VERSION)
    await conn.execute(
        text("UPDATE schema_version SET version = :v WHERE id = 1"),
        {"v": LEGACY_SCHEMA_VERSION},
    )


async def _apply_upgrades(conn: AsyncConnection, from_version: int, to_version: int) -> None:
    if from_version < 2 <= to_version:
        columns = {
            row[1]
            for row in (
                await conn.execute(text("PRAGMA table_info(store_settings)"))
            ).fetchall()
        }
        additions = {
            "installation_id": "VARCHAR(36) NOT NULL DEFAULT ''",
            "edition": "VARCHAR(16) NOT NULL DEFAULT 'start'",
            "company_name": "VARCHAR(255) NOT NULL DEFAULT ''",
            "inn": "VARCHAR(32) NOT NULL DEFAULT ''",
            "email": "VARCHAR(255) NOT NULL DEFAULT ''",
        }
        for name, definition in additions.items():
            if name not in columns:
                await conn.execute(
                    text(f"ALTER TABLE store_settings ADD COLUMN {name} {definition}")
                )
        await conn.execute(
            text(
                """
                UPDATE store_settings
                SET installation_id = lower(hex(randomblob(4))) || '-' ||
                    lower(hex(randomblob(2))) || '-4' ||
                    substr(lower(hex(randomblob(2))), 2) || '-a' ||
                    substr(lower(hex(randomblob(2))), 2) || '-' ||
                    lower(hex(randomblob(6)))
                WHERE installation_id = ''
                """
            )
        )
    if from_version < 3 <= to_version:
        columns = {
            row[1]
            for row in (
                await conn.execute(text("PRAGMA table_info(store_settings)"))
            ).fetchall()
        }
        if "setup_version" not in columns:
            # Existing installations must pass through the corrected setup
            # flow once. Newly completed setups write the current version.
            await conn.execute(
                text(
                    "ALTER TABLE store_settings "
                    "ADD COLUMN setup_version INTEGER NOT NULL DEFAULT 0"
                )
            )
    if from_version < 4 <= to_version:
        columns = {
            row[1]
            for row in (await conn.execute(text("PRAGMA table_info(store_settings)"))).fetchall()
        }
        additions = {
            "license_plan": "VARCHAR(16) NOT NULL DEFAULT 'start'",
            "license_revision": "INTEGER NOT NULL DEFAULT 1",
            "owner_first_name": "VARCHAR(128) NOT NULL DEFAULT ''",
            "owner_last_name": "VARCHAR(128) NOT NULL DEFAULT ''",
            "city": "VARCHAR(128) NOT NULL DEFAULT ''",
            "country": "VARCHAR(128) NOT NULL DEFAULT ''",
            "timezone": "VARCHAR(64) NOT NULL DEFAULT 'Asia/Bishkek'",
            "logo_path": "VARCHAR(512) NOT NULL DEFAULT ''",
            "primary_color": "VARCHAR(16) NOT NULL DEFAULT '#00f5bc'",
            "theme": "VARCHAR(16) NOT NULL DEFAULT 'light'",
        }
        for name, definition in additions.items():
            if name not in columns:
                await conn.execute(text(f"ALTER TABLE store_settings ADD COLUMN {name} {definition}"))
