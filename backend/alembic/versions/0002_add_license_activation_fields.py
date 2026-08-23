"""Add license activation fields and business_type to store_settings.

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-10

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "store_settings",
        sa.Column("business_type", sa.String(length=32), nullable=False, server_default="universal"),
    )
    op.add_column(
        "store_settings",
        sa.Column("activation_key", sa.String(length=32), nullable=False, server_default=""),
    )
    op.add_column(
        "store_settings",
        sa.Column("hardware_id", sa.String(length=64), nullable=False, server_default=""),
    )
    op.add_column(
        "store_settings",
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("store_settings", "activated_at")
    op.drop_column("store_settings", "hardware_id")
    op.drop_column("store_settings", "activation_key")
    op.drop_column("store_settings", "business_type")
