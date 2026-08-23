"""Признак «к кассе подключена камера».

Отдельно от сенсорного экрана: одно про то, чем на кассе вводят, другое — есть
ли чем снимать. Камера бывает не у всякой установки, и разделы, которым нужна
съёмка, на устройстве без неё показываться не должны — предлагать снять лицо
там, где камеры нет, хуже, чем не предлагать вовсе.

Выключено по умолчанию, в том числе на уже настроенных кассах: включить дешевле,
чем объяснять, почему касса просит доступ к камере, которой нет.

Данные не теряются: колонка добавляется, ничего не пересоздаётся.

Revision ID: 0025
Revises: 0024
Create Date: 2026-08-19

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0025"
down_revision: Union[str, None] = "0024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMN = sa.Column("has_camera", sa.Boolean(), nullable=False, server_default=sa.false())


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("store_settings")}


def upgrade() -> None:
    if "has_camera" not in _existing_columns():
        op.add_column("store_settings", _COLUMN)


def downgrade() -> None:
    if "has_camera" in _existing_columns():
        op.drop_column("store_settings", "has_camera")
