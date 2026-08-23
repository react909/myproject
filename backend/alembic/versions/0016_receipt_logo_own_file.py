"""Отдельный файл логотипа для чека.

Разделения обрезки оказалось мало. На ленте магазину часто нужен вовсе не тот
знак, что в шапке приложения: цветной логотип с тонкими линиями и градиентом в
один бит на точку рассыпается, и на чек кладут упрощённый чёрно-белый вариант.
Это другая картинка, а не другая рамка вокруг той же — переобрезкой такое не
решается.

Поэтому у чека появляется собственный исходник. Пусто — как и было, берётся
файл из интерфейса, и ничего для существующих установок не меняется.

Revision ID: 0016
Revises: 0015
Create Date: 2026-08-12

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("store_settings")}


def upgrade() -> None:
    if "receipt_logo_file" not in _existing_columns():
        op.add_column(
            "store_settings",
            sa.Column("receipt_logo_file", sa.Text(), nullable=False, server_default=""),
        )


def downgrade() -> None:
    if "receipt_logo_file" in _existing_columns():
        op.drop_column("store_settings", "receipt_logo_file")
