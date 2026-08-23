"""Логотип интерфейса и логотип чека — две независимые настройки.

Раньше настройка была одна на всё: тот же файл, та же обрезка, один тумблер.
Это неверно по существу. Экран и термолента — разные носители: у ленты своя
ширина, свои пропорции и один бит на точку, а решение «показывать знак в
шапке» и решение «печатать знак на чеке» магазин принимает порознь. Отсюда
`ui_logo` рядом с существующим `receipt_logo`, отдельный `receipt_logo_mark`
со своей обрезкой и `receipt_logo_variants` — готовые ч/б варианты под обе
ширины рулона.

`receipt_roll_width` вынесена в настройки, потому что от неё зависит не только
превью: логотип готовится в 384 точки для рулона 80 мм и в 288 для 58 мм, и
пересчитывать его в момент печати — значит задержать чек при покупателе.

Существующие установки ничего не теряют: `ui_logo` включается всем, у кого
логотип вообще показывался, а чековый знак остаётся пустым — это значит «тот
же файл, что и в интерфейсе», и печать идёт как раньше.

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-12

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMNS: dict[str, "sa.Column"] = {
    "ui_logo": sa.Column("ui_logo", sa.Boolean(), nullable=False, server_default=sa.true()),
    "receipt_logo_mark": sa.Column(
        "receipt_logo_mark", sa.Text(), nullable=False, server_default=""
    ),
    "receipt_logo_variants": sa.Column(
        "receipt_logo_variants", sa.Text(), nullable=False, server_default="{}"
    ),
    "receipt_roll_width": sa.Column(
        "receipt_roll_width", sa.String(length=4), nullable=False, server_default="80"
    ),
}


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("store_settings")}


def upgrade() -> None:
    existing = _existing_columns()
    fresh_roll_column = "receipt_roll_width" not in existing
    for name, column in _COLUMNS.items():
        if name not in existing:
            op.add_column("store_settings", column)

    # Кто работал без логотипа вовсе, того и в шапке он не касается.
    op.execute("UPDATE store_settings SET ui_logo = 0 WHERE logo_mode = 'none'")

    # 80 мм — значение по умолчанию для новых установок, но не для этих.
    # Приложение до сих пор печатало на 58 мм: это была единственная ширина в
    # локальных настройках принтера. Проставить работающей кассе 80 значило бы
    # молча испортить ей раскладку чека при первом же обновлении.
    if fresh_roll_column:
        op.execute("UPDATE store_settings SET receipt_roll_width = '58'")


def downgrade() -> None:
    existing = _existing_columns()
    for name in reversed(list(_COLUMNS)):
        if name in existing:
            op.drop_column("store_settings", name)
