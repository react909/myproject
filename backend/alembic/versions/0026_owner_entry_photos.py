"""Снимки тех, кто открывал кабинет владельца.

Не распознавание и не защита: дверь по-прежнему открывает только пароль
владельца. Это след — владелец видит, кто именно заходил в его финансы. Для
магазина, где деньги смотрит один человек, а за кассой стоит смена, след
работает не хуже замка: подобрать пароль незаметно больше нельзя.

Отдельная таблица, а не колонка в audit_entries: снимок это десятки килобайт, и
держать их в журнале, который читают постранично ради текста, значило бы его
раздуть. Запись в журнале всё равно появляется — здесь только картинка, и по
времени они сходятся.

Число снимков ограничено в самом маршруте (ENTRY_PHOTOS_KEPT): база ездит в
резервных копиях, и расти ей бесконечно нельзя.

Ничего существующего не трогается: таблица добавляется пустой.

Revision ID: 0026
Revises: 0025
Create Date: 2026-08-19

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0026"
down_revision: Union[str, None] = "0025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "owner_entry_photos"


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if _TABLE in _tables():
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("actor_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("image", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    # По времени читают всегда: «покажи последние двадцать».
    op.create_index(f"ix_{_TABLE}_created_at", _TABLE, ["created_at"])


def downgrade() -> None:
    if _TABLE not in _tables():
        return
    op.drop_index(f"ix_{_TABLE}_created_at", table_name=_TABLE)
    op.drop_table(_TABLE)
