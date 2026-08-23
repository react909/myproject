from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import delete, func, insert, select, text, update
from sqlalchemy.dialects.sqlite import insert as sqlite_upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.core.migrations import run_migrations
from app.db.database import (
    current_db_mode,
    is_connectivity_error,
    postgres_engine,
    set_db_mode,
    set_last_postgres_probe_ok,
    sqlite_engine,
)
from app.db.models import (
    Category,
    DebtPayment,
    Product,
    Sale,
    SaleItem,
    Shift,
    StockMove,
    StoreImage,
    StoreSettings,
    SyncLogEntry,
    SyncPkMap,
    User,
)

logger = logging.getLogger("nurcrm.sync")
settings = get_settings()

_SqliteSession = async_sessionmaker(bind=sqlite_engine, expire_on_commit=False, class_=AsyncSession)

_MODEL_BY_TABLE = {
    "store_settings": StoreSettings,
    # Логотипы и снимки QR лежат отдельной таблицей, но принадлежат тем же
    # реквизитам: без них вторая касса печатала бы чеки без знака.
    "store_images": StoreImage,
    "users": User,
    "categories": Category,
    "products": Product,
    "stock_moves": StockMove,
    "shifts": Shift,
    "sales": Sale,
    "sale_items": SaleItem,
    "debt_payments": DebtPayment,
}

# Which FK columns on each table need remapping through sync_pk_map before
# replay (the referenced row may have been assigned a fresh Postgres PK
# during this same offline episode).
_FK_REMAP: dict[str, dict[str, str]] = {
    "products": {"category_id": "categories"},
    "stock_moves": {"product_id": "products", "user_id": "users"},
    "shifts": {"user_id": "users"},
    "sales": {"shift_id": "shifts", "user_id": "users"},
    "sale_items": {"sale_id": "sales", "product_id": "products"},
    "debt_payments": {"sale_id": "sales", "user_id": "users"},
}

# Reference data mirrored from Postgres into SQLite whenever Postgres is
# healthy, so the fallback engine can actually keep the till operational
# (log in, look up products) the moment Postgres drops — not just accept
# new rows into an otherwise-empty database. Transactional tables
# (sales/stock_moves/...) are intentionally NOT mirrored: new ones are
# created fresh during an outage and drained back via sync_log instead.
_MIRROR_MODELS = (StoreSettings, User, Category, Product, StoreImage)

_sync_lock = asyncio.Lock()


async def recover_stuck_entries() -> None:
    """Run once at startup: a hard restart can leave rows stuck 'syncing'."""
    async with _SqliteSession() as session:
        await session.execute(
            update(SyncLogEntry).where(SyncLogEntry.status == "syncing").values(status="pending")
        )
        await session.commit()


async def sync_worker_loop() -> None:
    # Общего хранилища нет — синхронизировать не с чем. Цикл не запускается
    # вовсе, а не крутится вхолостую: на слабой машине лишний таймер каждые
    # восемь секунд это не бесплатно, а записи в outbox дождутся своего часа,
    # если магазин когда-нибудь подключит вторую кассу.
    if postgres_engine is None:
        logger.info("Общее хранилище не настроено — синхронизация не запускается.")
        return
    while True:
        try:
            await _probe_and_sync()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("sync worker tick failed")
        await asyncio.sleep(settings.postgres_probe_interval_seconds)


async def _probe_and_sync() -> None:
    if _sync_lock.locked() or postgres_engine is None:
        return
    async with _sync_lock:
        reachable = await _probe_postgres()
        set_last_postgres_probe_ok(reachable)

        if not reachable:
            if current_db_mode() == "postgres":
                set_db_mode("sqlite")
            return

        if current_db_mode() == "sqlite":
            try:
                await run_migrations(postgres_engine)
            except Exception:
                logger.exception("Postgres migration failed during reconnect attempt")
                return
            set_db_mode("postgres")
            logger.warning("Postgres reachable again — reconnected.")

        await _mirror_reference_tables()
        await _drain_pending()


async def _probe_postgres() -> bool:
    # Вызывается только из _probe_and_sync, который уже отсёк отсутствие
    # общего хранилища. Проверка оставлена, чтобы прямой вызов падал внятно.
    if postgres_engine is None:
        return False
    try:
        async with asyncio.timeout(settings.postgres_connect_timeout_seconds):
            async with postgres_engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


async def _mirror_reference_tables() -> None:
    assert postgres_engine is not None, "вызывается только при настроенном общем хранилище"
    async with postgres_engine.connect() as pg_conn:
        snapshots: dict[type, list[dict]] = {}
        for model in _MIRROR_MODELS:
            rows = (await pg_conn.execute(select(model.__table__))).mappings().all()
            snapshots[model] = [dict(r) for r in rows]

    async with sqlite_engine.begin() as sq_conn:
        for model in _MIRROR_MODELS:
            rows = snapshots[model]
            if not rows:
                continue
            table = model.__table__
            stmt = sqlite_upsert(table)
            update_cols = {c.name: stmt.excluded[c.name] for c in table.columns if c.name != "id"}
            stmt = stmt.on_conflict_do_update(index_elements=["id"], set_=update_cols)
            await sq_conn.execute(stmt, rows)


async def _drain_pending() -> None:
    async with _SqliteSession() as session:
        entries = (
            (
                await session.execute(
                    select(SyncLogEntry)
                    .where(SyncLogEntry.target == "postgres_reconcile")
                    .where(SyncLogEntry.status.in_(["pending", "failed_retryable"]))
                    .order_by(SyncLogEntry.id.asc())
                    .limit(settings.sync_batch_size)
                )
            )
            .scalars()
            .all()
        )

    for entry in entries:
        entry_id, table_name, operation, row_pk, payload = (
            entry.id,
            entry.table_name,
            entry.operation,
            entry.row_pk,
            entry.payload,
        )

        async with _SqliteSession() as session:
            await session.execute(
                update(SyncLogEntry)
                .where(SyncLogEntry.id == entry_id)
                .values(status="syncing", attempts=SyncLogEntry.attempts + 1)
            )
            await session.commit()

        try:
            await _replay_entry(table_name, operation, row_pk, dict(payload))
        except Exception as exc:
            if is_connectivity_error(exc):
                async with _SqliteSession() as session:
                    await session.execute(
                        update(SyncLogEntry).where(SyncLogEntry.id == entry_id).values(status="pending")
                    )
                    await session.commit()
                logger.warning("Postgres dropped mid-drain, resuming next tick: %s", exc)
                return  # abort rest of this batch
            async with _SqliteSession() as session:
                current_attempts = (
                    await session.execute(select(SyncLogEntry.attempts).where(SyncLogEntry.id == entry_id))
                ).scalar_one()
                next_status = (
                    "failed_retryable" if current_attempts < settings.sync_max_attempts else "failed_permanent"
                )
                await session.execute(
                    update(SyncLogEntry)
                    .where(SyncLogEntry.id == entry_id)
                    .values(status=next_status, error_message=str(exc)[:2000])
                )
                await session.commit()
            logger.warning("sync_log entry %s (%s.%s) failed: %s", entry_id, table_name, operation, exc)
            continue
        else:
            async with _SqliteSession() as session:
                await session.execute(
                    update(SyncLogEntry)
                    .where(SyncLogEntry.id == entry_id)
                    .values(status="synced", synced_at=datetime.now(UTC))
                )
                await session.commit()


async def _replay_entry(table_name: str, operation: str, row_pk: str, payload: dict) -> None:
    model = _MODEL_BY_TABLE.get(table_name)
    if model is None:
        raise ValueError(f"unknown syncable table: {table_name}")
    table = model.__table__

    remapped = await _remap_payload_fks(table_name, payload)
    remapped.pop("id", None)

    assert postgres_engine is not None, "вызывается только при настроенном общем хранилище"
    async with postgres_engine.begin() as pg_conn:
        if operation == "insert":
            result = await pg_conn.execute(insert(table).returning(table.c.id), remapped)
            new_pk = result.scalar_one()
            await _record_pk_map(table_name, row_pk, str(new_pk))
        elif operation == "update":
            target_pk = await _resolve_target_pk(table_name, row_pk)
            if remapped:
                await pg_conn.execute(update(table).where(table.c.id == target_pk).values(**remapped))
        elif operation == "delete":
            target_pk = await _resolve_target_pk(table_name, row_pk)
            await pg_conn.execute(delete(table).where(table.c.id == target_pk))
        else:
            raise ValueError(f"unknown sync operation: {operation}")


async def _remap_payload_fks(table_name: str, payload: dict) -> dict:
    for col, target_table in _FK_REMAP.get(table_name, {}).items():
        value = payload.get(col)
        if value is None:
            continue
        payload[col] = await _resolve_target_pk(target_table, str(value))
    return payload


async def _resolve_target_pk(table_name: str, sqlite_pk: str) -> int:
    async with _SqliteSession() as session:
        mapped = (
            await session.execute(
                select(SyncPkMap.postgres_pk).where(
                    SyncPkMap.table_name == table_name, SyncPkMap.sqlite_pk == sqlite_pk
                )
            )
        ).scalar_one_or_none()
    # No mapping means this row predates the offline episode (it was mirrored
    # down from Postgres, or created there directly) — its SQLite-side id is
    # already the real Postgres id.
    return int(mapped) if mapped is not None else int(sqlite_pk)


async def _record_pk_map(table_name: str, sqlite_pk: str, postgres_pk: str) -> None:
    async with _SqliteSession() as session:
        stmt = sqlite_upsert(SyncPkMap.__table__).values(
            table_name=table_name, sqlite_pk=sqlite_pk, postgres_pk=postgres_pk
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["table_name", "sqlite_pk"], set_={"postgres_pk": postgres_pk}
        )
        await session.execute(stmt)
        await session.commit()


async def pending_count() -> int:
    async with _SqliteSession() as session:
        result = await session.execute(
            select(func.count())
            .select_from(SyncLogEntry)
            .where(
                SyncLogEntry.target == "postgres_reconcile",
                SyncLogEntry.status.in_(["pending", "syncing", "failed_retryable"]),
            )
        )
        return int(result.scalar_one())


async def last_success_at() -> str | None:
    async with _SqliteSession() as session:
        value = (await session.execute(select(func.max(SyncLogEntry.synced_at)))).scalar_one()
        return value.isoformat() if value else None
