"""Режим склада убран, на его месте — режим аналитики.

Выбор «с остатками / без остатков» был ложным. Отчёт по остаткам нужен любому
магазину, а точка, отключившая склад при установке, оставалась без него
навсегда: движения товара не записывались, и восстановить их задним числом
нечем. Остатки теперь ведутся всегда, а товар без остатка описывается на
уровне товара — у услуги остатка нет по природе.

На освободившееся место встал выбор главной цифры дашборда. Подчеркнём, чего
эта колонка НЕ означает: это не второй способ вести учёт. Продажи и расходы
пишутся в базу одинаково при любом её значении, меняется только то, что
показано первым. Поэтому переключение ничего не пересчитывает, ничего не
теряет и разрешено в любой момент.

Установки, работавшие без остатков, при обновлении начинают их вести. Задним
числом остатки не выдумываются: количество берётся таким, какое есть в
карточке товара, а история движений начинается с этого дня.

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-12

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("store_settings")}


def upgrade() -> None:
    existing = _existing_columns()
    if "analytics_mode" not in existing:
        op.add_column(
            "store_settings",
            sa.Column(
                "analytics_mode", sa.String(length=16), nullable=False, server_default="revenue"
            ),
        )
    if "stock_mode" in existing:
        op.drop_column("store_settings", "stock_mode")


def downgrade() -> None:
    existing = _existing_columns()
    if "stock_mode" not in existing:
        op.add_column(
            "store_settings",
            sa.Column("stock_mode", sa.String(length=16), nullable=False, server_default="tracked"),
        )
    if "analytics_mode" in existing:
        op.drop_column("store_settings", "analytics_mode")
