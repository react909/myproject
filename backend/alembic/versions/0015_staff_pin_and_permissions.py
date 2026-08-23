"""PIN кассира и права переезжают к сотруднику.

Раньше PIN был один на установку и задавался на шаге регистрации. Оба решения
неверны.

PIN спрашивали тогда, когда кассиров ещё нет: магазин только заводится, нанимать
некого. Такой PIN к моменту появления первого кассира знают все, кто был рядом
при установке.

PIN был общим — значит, по журналу нельзя сказать, кто именно отменил чек или
провёл возврат. Ровно для этого журнал и ведётся, так что общий PIN лишал его
смысла. Теперь PIN у каждого сотрудника свой, живёт в его строке и задаётся при
добавлении в разделе «Сотрудники».

Права (`sell`, `refund`, `discount`, `shift`) хранятся строкой через запятую.
Отдельная таблица дороже пользы: набор из четырёх флагов фиксирован, а проверка
происходит на каждой кассовой операции — join ради неё на слабой машине лишний.

`store_settings.service_pin_hash` не удаляется: установки, обновившиеся с прошлой
версии, ещё не завели сотрудников, и без старого PIN они остались бы без способа
подтвердить возврат до первого нанятого кассира.

Revision ID: 0015
Revises: 0014
Create Date: 2026-08-12

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMNS: dict[str, "sa.Column"] = {
    "pin_hash": sa.Column("pin_hash", sa.String(length=255), nullable=False, server_default=""),
    "permissions": sa.Column(
        "permissions", sa.String(length=255), nullable=False, server_default=""
    ),
}


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("users")}


def upgrade() -> None:
    existing = _existing_columns()
    for name, column in _COLUMNS.items():
        if name not in existing:
            op.add_column("users", column)

    # Уже заведённые кассиры продолжают продавать. Возвраты и скидки не
    # раздаются задним числом: это решение владельца, и принять его за него
    # означало бы молча расширить права людям, которых мы не знаем.
    op.execute("UPDATE users SET permissions = 'sell' WHERE role = 'cashier' AND permissions = ''")
    op.execute(
        "UPDATE users SET permissions = 'sell,refund,discount,shift' "
        "WHERE role IN ('owner', 'admin') AND permissions = ''"
    )


def downgrade() -> None:
    existing = _existing_columns()
    for name in reversed(list(_COLUMNS)):
        if name in existing:
            op.drop_column("users", name)
