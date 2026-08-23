from __future__ import annotations

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.models import Base  # noqa: E402

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _to_sync_dsn(dsn: str) -> str:
    """Alembic's own connection is synchronous — drop the async driver marker."""
    if dsn.startswith("sqlite+aiosqlite://"):
        return "sqlite://" + dsn[len("sqlite+aiosqlite://") :]
    return dsn


def _resolve_url() -> str:
    # Set programmatically by app/core/migrations.py before calling
    # command.upgrade()/command.stamp() — this is the normal runtime path.
    injected = config.attributes.get("target_dsn")
    if injected:
        return _to_sync_dsn(injected)
    configured = config.get_main_option("sqlalchemy.url")
    if configured:
        return _to_sync_dsn(configured)
    # Bare `alembic upgrade head` from a dev shell: fall back to the app's
    # own configured Postgres DSN.
    from app.core.config import get_settings

    return _to_sync_dsn(get_settings().postgres_dsn)


def run_migrations_offline() -> None:
    url = _resolve_url()
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = _resolve_url()
    connectable = engine_from_config(
        {"sqlalchemy.url": url},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
