"""Шаблон обработки логотипа под термопечать и порог ч/б.

Термопринтер знает только «жечь» и «не жечь» — один бит на точку. Свести к
этому любой логотип одним способом нельзя: светлый знак при обычном пороге
выходит пустым пятном, а сплошная цветная заливка — чёрным прямоугольником,
который и нечитаем, и зря греет головку.

Отсюда четыре шаблона (standard, contrast, dither, outline) и порог 0–255 для
ручной подстройки. Значения по умолчанию повторяют прежнее поведение, поэтому
существующие установки печатают ровно так же, как печатали.

Revision ID: 0017
Revises: 0016
Create Date: 2026-08-13

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMNS: dict[str, "sa.Column"] = {
    "receipt_logo_style": sa.Column(
        "receipt_logo_style", sa.String(length=16), nullable=False, server_default="standard"
    ),
    "receipt_logo_threshold": sa.Column(
        "receipt_logo_threshold", sa.Integer(), nullable=False, server_default="176"
    ),
}


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("store_settings")}


def upgrade() -> None:
    existing = _existing_columns()
    for name, column in _COLUMNS.items():
        if name not in existing:
            op.add_column("store_settings", column)


def downgrade() -> None:
    existing = _existing_columns()
    for name in reversed(list(_COLUMNS)):
        if name in existing:
            op.drop_column("store_settings", name)
