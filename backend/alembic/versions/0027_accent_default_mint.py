"""Стандартный акцент системы — мятный #00f5bc.

Что здесь меняется: значение по умолчанию у колонки `store_settings.
primary_color`. Было `#2563eb` — синий, оставшийся от самой первой схемы. Фронт
при этом давно ставит `#00f5bc`, и два дефолта расходились: касса, заведённая
без прохода по шагу оформления, получала синий акцент, хотя вся система
рисовалась мятной.

Что здесь НЕ меняется: ни один уже сохранённый цвет. Магазин, выбравший свой
цвет, — и магазин, чья строка хранит старый синий, — остаются со своим. Ровнять
существующие значения под новый дефолт нельзя: отличить «выбрал синий
осознанно» от «досталось дефолтом» в базе нечем, и одно UPDATE на таблицу
перекрасило бы работающие кассы без спроса.

Способ. В SQLite нет ALTER COLUMN, поэтому дефолт меняется через
`batch_alter_table`: Alembic создаёт копию таблицы с новым определением,
переносит в неё строки и подменяет исходную. Это единственный доступный путь, и
он безопасен — вся операция идёт одной транзакцией, при отказе откатывается
целиком, а значения строк переносятся как есть.

Данные не теряются: строки копируются без изменений, а если колонки почему-то
нет (база старше первой схемы), миграция не делает ничего.

Revision ID: 0027
Revises: 0026
Create Date: 2026-08-21

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0027"
down_revision: Union[str, None] = "0026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "store_settings"
_COLUMN = "primary_color"

NEW_DEFAULT = "#00f5bc"
OLD_DEFAULT = "#2563eb"


def _column_info() -> dict | None:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return None
    for column in inspector.get_columns(_TABLE):
        if column["name"] == _COLUMN:
            return column
    return None


def _set_default(value: str) -> None:
    """Меняет server_default, не трогая существующие строки.

    На SQLite `alter_column` работает только внутри batch-режима — он делает
    копию таблицы с новым определением и переносит данные. Здесь это
    единственный доступный способ поменять дефолт, и он безопасен: копирование
    идёт в одной транзакции, а при отказе миграция откатывается целиком.

    `existing_*` обязательны: без них batch пересоздал бы колонку как
    nullable-строку без ограничения длины и молча ослабил схему.
    """
    with op.batch_alter_table(_TABLE) as batch:
        batch.alter_column(
            _COLUMN,
            existing_type=sa.String(length=16),
            existing_nullable=False,
            server_default=value,
        )


def upgrade() -> None:
    column = _column_info()
    if column is None:
        return
    _set_default(NEW_DEFAULT)


def downgrade() -> None:
    column = _column_info()
    if column is None:
        return
    _set_default(OLD_DEFAULT)
