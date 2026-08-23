"""Разделение трёх ключей и журнал скрытых настроек.

До сих пор одна и та же дверь — сервисный PIN — открывала и кассовые операции,
и финансы, и настройки оборудования. Это ровно то, чего быть не должно: PIN
короткий, его набирают при покупателе по нескольку раз за смену, и он не может
охранять удаление базы.

Теперь ключей три, и у каждого своя дверь:

* пароль владельца — финансы, аналитика, сотрудники, удаление данных;
* PIN кассира — только кассовые операции;
* сервисный ключ лицензии — оборудование, режим работы, лицензия.

Отсюда две группы колонок. `owner_failed_attempts` и `owner_locked_until`
ограничивают перебор пароля пятью попытками: счётчик лежит в базе, а не в
памяти процесса, иначе защита обходилась бы перезапуском приложения.
`service_key_hash` хранит сервисный ключ хэшем — открытым текстом он не
сохраняется; колонка `activation_key` остаётся ради маски и переноса лицензии.

Таблица audit_entries пишет всё, что меняют за закрытой дверью: кто, когда,
что и во что. Владелец и специалист ходят в одни и те же разделы, и без
журнала спор «настройки поменялись сами» разрешить нечем.

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-12

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMNS: dict[str, "sa.Column"] = {
    "owner_failed_attempts": sa.Column(
        "owner_failed_attempts", sa.Integer(), nullable=False, server_default="0"
    ),
    "owner_locked_until": sa.Column("owner_locked_until", sa.DateTime(timezone=True), nullable=True),
    "service_key_hash": sa.Column(
        "service_key_hash", sa.String(length=255), nullable=False, server_default=""
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

    if "audit_entries" not in set(sa.inspect(op.get_bind()).get_table_names()):
        op.create_table(
            "audit_entries",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("actor_kind", sa.String(length=16), nullable=False, server_default="owner"),
            sa.Column("actor_name", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("action", sa.String(length=64), nullable=False),
            sa.Column("target", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("old_value", sa.Text(), nullable=False, server_default=""),
            sa.Column("new_value", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_audit_entries_action", "audit_entries", ["action"])
        op.create_index("ix_audit_entries_created_at", "audit_entries", ["created_at"])

    # Ключ существующих установок хэшируется при первом успешном вводе, а не
    # здесь: в миграции его открытый текст пришлось бы читать и переписывать,
    # оставляя след в журнале базы.


def downgrade() -> None:
    if "audit_entries" in set(sa.inspect(op.get_bind()).get_table_names()):
        op.drop_table("audit_entries")

    existing = _existing_columns()
    for name in reversed(list(_COLUMNS)):
        if name in existing:
            op.drop_column("store_settings", name)
