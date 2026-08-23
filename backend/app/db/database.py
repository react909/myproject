from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

from sqlalchemy import event, text
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.core.migrations import run_migrations
from app.core.sync_capture import register_sync_capture

logger = logging.getLogger("nurcrm.db")

settings = get_settings()

# Основное хранилище кассы — SQLite-файл в userData. Касса офлайновая, и её
# данные обязаны лежать на её же диске: это то, что попадает в бэкап, в
# экспорт и переживает переустановку.
sqlite_engine: AsyncEngine = create_async_engine(
    settings.sqlite_dsn,
    echo=False,
    future=True,
    connect_args={"check_same_thread": False},
)

# Необязательное общее хранилище для магазина с несколькими кассами. Движок
# создаётся, только если DSN задан явно: раньше здесь стоял localhost по
# умолчанию, и на машине с любым запущенным Postgres касса молча писала туда.
postgres_engine: AsyncEngine | None = (
    create_async_engine(
        settings.postgres_dsn,
        echo=False,
        future=True,
        pool_pre_ping=True,
        connect_args={"connect_timeout": max(1, int(settings.postgres_connect_timeout_seconds))},
    )
    if settings.postgres_configured
    else None
)

_PgSessionLocal = (
    async_sessionmaker(bind=postgres_engine, expire_on_commit=False, class_=AsyncSession)
    if postgres_engine is not None
    else None
)
_SqliteSessionLocal = async_sessionmaker(bind=sqlite_engine, expire_on_commit=False, class_=AsyncSession)


def postgres_available() -> bool:
    """Настроено ли общее хранилище вообще. Не то же, что «доступно сейчас»."""
    return postgres_engine is not None

# Writes made while running on the SQLite fallback get queued into sync_log
# for later replay into Postgres — see app/core/sync.py for the drain side.
register_sync_capture()


@event.listens_for(sqlite_engine.sync_engine, "connect")
def _configure_sqlite_connection(dbapi_connection, connection_record) -> None:  # type: ignore[no-untyped-def]
    """Apply concurrency settings to every SQLite connection, not just migrations."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()

    # Поиск по-русски без учёта регистра.
    #
    # Встроенные `lower`/`upper` в SQLite работают ТОЛЬКО С ЛАТИНИЦЕЙ — это
    # прямо написано в её документации. SQLAlchemy превращает `ilike` в
    # `lower(поле) LIKE lower(образец)`, и на кириллице это превращается в
    # поиск с учётом регистра: «Чай» находит «Чай чёрный», а «чай» — уже нет.
    #
    # Замечено на живых данных: в подсказке товара при вводе накладной набор
    # строчными не находил ничего, хотя товар в базе есть. Касается всего
    # поиска в системе — товаров, поставщиков, клиентов в журнале чеков, — то
    # есть самой частой операции.
    #
    # Подменяем `lower` питоновским: он знает Юникод целиком. SQLite позволяет
    # переопределять встроенные функции, и это чинит ВСЕ запросы разом, не
    # переписывая ни одного из них.
    #
    # `deterministic=True` разрешает SQLite кешировать результат для одного и
    # того же входа и использовать функцию в индексных выражениях; без него
    # она считалась бы заново на каждую строку.
    dbapi_connection.create_function("lower", 1, _unicode_lower, deterministic=True)
    dbapi_connection.create_function("upper", 1, _unicode_upper, deterministic=True)


def _unicode_lower(value):  # type: ignore[no-untyped-def]
    """`lower`, знающий кириллицу. `None` пропускается насквозь, как в SQL."""
    return value.lower() if isinstance(value, str) else value


def _unicode_upper(value):  # type: ignore[no-untyped-def]
    return value.upper() if isinstance(value, str) else value


class _EngineState:
    mode: str = "sqlite"
    last_postgres_probe_ok: bool = False


_state = _EngineState()


def current_db_mode() -> str:
    return _state.mode


def set_db_mode(mode: str) -> None:
    if mode not in ("postgres", "sqlite"):
        raise ValueError(f"invalid db mode: {mode!r}")
    if _state.mode != mode:
        logger.warning("database mode -> %s", mode)
    _state.mode = mode


def last_postgres_probe_ok() -> bool:
    return _state.last_postgres_probe_ok


def set_last_postgres_probe_ok(ok: bool) -> None:
    _state.last_postgres_probe_ok = ok


def is_connectivity_error(exc: BaseException) -> bool:
    """Narrow classification: a dropped connection, not an application error.

    Must NOT match IntegrityError/ordinary validation failures — those are
    real request errors, not a reason to fall back to SQLite.
    """
    if isinstance(exc, (OSError, TimeoutError)):
        return True
    if isinstance(exc, DBAPIError):
        return bool(exc.connection_invalidated) or isinstance(exc, OperationalError)
    return False


async def init_db() -> None:
    # Основное хранилище мигрируется всегда и первым: именно на нём касса
    # работает по умолчанию, и оно обязано быть готово к первому же запросу.
    await run_migrations(sqlite_engine)

    if postgres_engine is None:
        set_db_mode("sqlite")
        logger.info("Общее хранилище не настроено — касса работает на локальной базе SQLite.")
        return

    if settings.db_mode_override == "sqlite_only":
        set_db_mode("sqlite")
        logger.warning("NURCRM_DB_MODE=sqlite_only — Postgres connection skipped by config.")
        return

    try:
        async with asyncio.timeout(settings.postgres_connect_timeout_seconds):
            async with postgres_engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        await run_migrations(postgres_engine)
    except Exception as exc:
        if settings.db_mode_override == "postgres_only":
            raise
        set_db_mode("sqlite")
        logger.warning("Postgres unreachable at startup (%s) — using SQLite fallback until it recovers.", exc)
        return

    set_last_postgres_probe_ok(True)
    set_db_mode("postgres")


async def get_db_session() -> AsyncIterator[AsyncSession]:
    mode = _state.mode
    factory = (
        _PgSessionLocal if mode == "postgres" and _PgSessionLocal is not None else _SqliteSessionLocal
    )
    async with factory() as session:
        try:
            yield session
        except Exception as exc:
            if mode == "postgres" and is_connectivity_error(exc):
                set_last_postgres_probe_ok(False)
                set_db_mode("sqlite")
                logger.warning("Postgres unreachable mid-request (%s) — falling back to SQLite.", exc)
            raise
