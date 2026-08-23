"""Сервисный ключ задаёт владелец: минимум 8 символов, буквы и цифры.

Раньше сервисный доступ упирался в шесть цифр. Шестизначный код перебирается
за считанные минуты, а открывает он настройки специалиста и повторный проход
мастера регистрации — то есть всё устройство целиком. Теперь ключ задаёт
владелец при установке, ограничение — минимум 8 символов, обязательно и буква,
и цифра.

Здесь же появляется защита от перебора для этой двери: пять попыток, дальше
блокировка на четверть часа. Счётчик отдельный от владельческого намеренно —
блокировка одной двери не должна закрывать другую, иначе кассир, промахнувшийся
мимо своей, запирает владельца снаружи собственных финансов. Счётчик живёт в
базе, а не в памяти процесса: иначе защита обходилась бы выключением питания.

Существующие установки ключ не теряют: пока `service_key_hash` пуст, дверь
открывает ключ активации, и при первом же успешном входе он превращается в
хэш (см. auth/router.py: service_key_unlock).

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-12

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMNS: dict[str, "sa.Column"] = {
    "service_failed_attempts": sa.Column(
        "service_failed_attempts", sa.Integer(), nullable=False, server_default="0"
    ),
    "service_locked_until": sa.Column(
        "service_locked_until", sa.DateTime(timezone=True), nullable=True
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
