"""Общий счётчик попыток для окна «Служебный доступ».

Окно одно на обе скрытые двери: введённое пробуется и как сервисный ключ, и как
пароль владельца. Счётчики при этом были раздельные — по одному на дверь, — и
один неверный ввод засчитывался обоим сразу. Пять опечаток закрывали не только
ту дверь, куда человек шёл, но и вторую, к которой он даже не прикасался.

Здесь заводится общая пара: попытка засчитывается один раз и только тогда,
когда не подошло ни то ни другое. Прежние колонки остаются: по ним по-прежнему
работают прямые двери — аккорд владельца и отдельная проверка ключа.

Revision ID: 0020
Revises: 0019
Create Date: 2026-08-15

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMNS: dict[str, "sa.Column"] = {
    "access_failed_attempts": sa.Column(
        "access_failed_attempts", sa.Integer(), nullable=False, server_default="0"
    ),
    "access_locked_until": sa.Column(
        "access_locked_until", sa.DateTime(timezone=True), nullable=True
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
