"""Add legal_form (missing from the baseline) and master_password_hash.

legal_form has been declared on the StoreSettings model since the baseline
was written but never made it into a migration, so every freshly created
database was missing the column while the ORM kept selecting it — the very
first `SELECT ... FROM store_settings` (i.e. /api/setup/status) failed with
"no such column: store_settings.legal_form" and the whole install was dead
on arrival. Adding it here repairs new and existing databases alike.

master_password_hash carries the owner's second, "long" password that
unlocks the hidden sections (settings / analytics / finance).

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-11

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("store_settings")}


def upgrade() -> None:
    # Guarded: databases carried over from the pre-Alembic SQLite path were
    # built by metadata.create_all(), which already gave them legal_form.
    # Adding it twice would abort the upgrade for exactly those installs.
    columns = _existing_columns()
    if "legal_form" not in columns:
        op.add_column(
            "store_settings",
            sa.Column("legal_form", sa.String(length=32), nullable=False, server_default=""),
        )
    if "master_password_hash" not in columns:
        op.add_column(
            "store_settings",
            sa.Column("master_password_hash", sa.String(length=255), nullable=False, server_default=""),
        )


def downgrade() -> None:
    columns = _existing_columns()
    if "master_password_hash" in columns:
        op.drop_column("store_settings", "master_password_hash")
    if "legal_form" in columns:
        op.drop_column("store_settings", "legal_form")
