"""Объёмный вид логотипа в шапке — выключаемое оформление.

Знак в шапке лежит плоско на тёмной полосе. Объём ему добавляет не обработка
файла, а оформление по альфа-каналу: светлая кромка сверху, тёмная снизу и
мягкая тень под знаком. Поэтому здесь одна колонка-переключатель, а не новая
картинка: сам файл не меняется, эффект снимается и возвращается в любой момент
и ничего не пересобирает.

Включено по умолчанию — в том числе на уже настроенных кассах: эффект мягкий и
работает на любом знаке с прозрачностью, а выключить его дешевле, чем не
заметить, что он вообще есть.

Revision ID: 0022
Revises: 0021
Create Date: 2026-08-16

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0022"
down_revision: Union[str, None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMN = sa.Column(
    "logo_emboss", sa.Boolean(), nullable=False, server_default=sa.true()
)


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("store_settings")}


def upgrade() -> None:
    if "logo_emboss" not in _existing_columns():
        op.add_column("store_settings", _COLUMN)


def downgrade() -> None:
    if "logo_emboss" in _existing_columns():
        op.drop_column("store_settings", "logo_emboss")
