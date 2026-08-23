from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Kassir ERP"
    app_version: str = "1.0.0"
    jwt_secret: str = Field(
        default="nurcrm-offline-local-secret-change-me",
        validation_alias=AliasChoices("JWT_SECRET", "NURCRM_JWT_SECRET"),
    )
    jwt_algorithm: str = "HS256"
    jwt_hours: int = 72
    # Symmetric secret used to check the offline license-key checksum (see
    # app/modules/licensing/activation.py). Same insecure-local-default
    # posture as jwt_secret — override before a real production build ships,
    # or generated keys are predictable across every install.
    license_hmac_secret: str = Field(
        default="nurcrm-offline-license-hmac-secret-change-me",
        validation_alias=AliasChoices("LICENSE_HMAC_SECRET", "NURCRM_LICENSE_HMAC_SECRET"),
    )
    sqlite_path: str = Field(
        default=str(Path.cwd() / "nurcrm.db"),
        validation_alias=AliasChoices("SQLITE_PATH", "NURCRM_SQLITE_PATH"),
    )
    # Необязательное общее хранилище для магазинов с несколькими кассами.
    #
    # По умолчанию пусто, и это принципиально: касса офлайновая, её база —
    # SQLite в userData. Раньше здесь стоял localhost, и на машине с любым
    # запущенным Postgres касса молча писала туда, а файл в userData оставался
    # пустым. Владелец узнавал об этом при переустановке, когда данные не
    # находились ни в бэкапе, ни в экспорте.
    #
    # Заполняется только явно — из настроек специалиста или переменной среды.
    postgres_dsn: str = Field(
        default="",
        validation_alias=AliasChoices("POSTGRES_DSN", "NURCRM_POSTGRES_DSN", "DATABASE_URL"),
    )
    postgres_connect_timeout_seconds: float = Field(default=3.0, validation_alias="NURCRM_POSTGRES_TIMEOUT")
    postgres_probe_interval_seconds: float = Field(default=8.0, validation_alias="NURCRM_POSTGRES_PROBE_INTERVAL")
    sync_batch_size: int = Field(default=100, validation_alias="NURCRM_SYNC_BATCH_SIZE")
    sync_max_attempts: int = Field(default=5, validation_alias="NURCRM_SYNC_MAX_ATTEMPTS")
    # Lets ops/testing force a specific engine without touching the actual
    # Postgres service (e.g. to rehearse offline-fallback behavior).
    db_mode_override: Literal["auto", "postgres_only", "sqlite_only"] = Field(
        default="auto", validation_alias="NURCRM_DB_MODE"
    )
    host: str = "127.0.0.1"
    port: int = 8000

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def postgres_configured(self) -> bool:
        """Настроено ли общее хранилище. Пусто — работаем только на SQLite."""
        return bool(self.postgres_dsn.strip())

    @property
    def sqlite_dsn(self) -> str:
        path = Path(self.sqlite_path).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        # SQLAlchemy async sqlite URL
        return f"sqlite+aiosqlite:///{path.as_posix()}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
