from __future__ import annotations

from datetime import datetime

from sqlalchemy import event, insert, inspect
from sqlalchemy.orm import Session as SyncSession

from app.db.models import (
    Category,
    DebtPayment,
    Product,
    Sale,
    SaleItem,
    Shift,
    StockMove,
    StoreSettings,
    SyncLogEntry,
    User,
)

# Deliberately excludes SaleCounter: an internal document-number counter,
# not durable customer data — losing precise replay ordering for it is fine.
SYNCABLE_MODELS = (StoreSettings, User, Category, Product, StockMove, Shift, Sale, SaleItem, DebtPayment)

# Insertion order into sync_log must be FK-safe for replay (a Sale must be
# replayed before its SaleItems, etc.) — session.new/dirty/deleted are
# unordered sets, so we sort captured rows by this rank before writing them.
_TABLE_RANK = {
    "store_settings": 0,
    "users": 1,
    "categories": 2,
    "products": 3,
    "stock_moves": 4,
    "shifts": 5,
    "sales": 6,
    "sale_items": 7,
    "debt_payments": 8,
}

_registered = False


def _json_safe(value: object) -> object:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _snapshot(instance: object) -> dict:
    mapper = inspect(instance).mapper
    return {col.key: _json_safe(getattr(instance, col.key)) for col in mapper.columns}


def _pk_value(instance: object) -> str:
    mapper = inspect(instance).mapper
    values = [getattr(instance, col.key) for col in mapper.primary_key]
    return str(values[0]) if len(values) == 1 else ",".join(str(v) for v in values)


def register_sync_capture() -> None:
    """Register the after_flush hook that queues sync_log rows.

    Idempotent — safe to call more than once (e.g. re-imports during tests).
    Only meaningfully active while the flushing session is bound to the
    SQLite fallback engine: writes that land directly on a healthy Postgres
    are already the source of truth and need no "reconcile into Postgres"
    entry. See app/core/sync.py for the drain side of this queue.
    """

    global _registered
    if _registered:
        return
    _registered = True

    @event.listens_for(SyncSession, "after_flush")
    def _capture_changes(session: SyncSession, flush_context: object) -> None:  # noqa: ARG001
        bind = session.get_bind()
        if bind.dialect.name != "sqlite":
            return

        captured: list[tuple[int, dict]] = []

        def _collect(instances: object, operation: str) -> None:
            for instance in instances:
                if not isinstance(instance, SYNCABLE_MODELS):
                    continue
                table_name = instance.__tablename__
                captured.append(
                    (
                        _TABLE_RANK.get(table_name, 99),
                        {
                            "table_name": table_name,
                            "row_pk": _pk_value(instance),
                            "operation": operation,
                            "payload": _snapshot(instance),
                            "target": "postgres_reconcile",
                            "status": "pending",
                            "origin_engine": "sqlite",
                        },
                    )
                )

        _collect(session.new, "insert")
        _collect(session.dirty, "update")
        _collect(session.deleted, "delete")

        if not captured:
            return

        captured.sort(key=lambda pair: pair[0])
        session.execute(insert(SyncLogEntry), [row for _, row in captured])
