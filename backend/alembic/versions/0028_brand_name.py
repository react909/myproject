"""Название системы в интерфейсе — отдельно от названия магазина.

Здесь проходит граница, которой в схеме не было. `company_name` и `store_name`
— это реквизиты: они печатаются в чеке и в документах. Названия программы среди
них не было вовсе, и шапка приложения брала для себя название торговой точки.
Магазин «Глобус» превращал кассу в программу «Глобус», хотя своего бренда не
заводил и не собирался.

Новая колонка `brand_name` хранит именно бренд интерфейса. Пусто — заводское
«Kassir ERP», и по умолчанию так и будет у всех: колонка добавляется пустой, а
не заполняется значением из реквизитов. Это осознанно. Перенести сюда
`company_name` значило бы узаконить ту самую путаницу и оставить каждую
работающую кассу подписанной именем магазина — ровно то, от чего уходим.

Данные не теряются: колонка добавляется, ничего не пересоздаётся и не
переписывается.

Revision ID: 0028
Revises: 0027
Create Date: 2026-08-21

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0028"
down_revision: Union[str, None] = "0027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "store_settings"
_COLUMN = sa.Column("brand_name", sa.String(length=64), nullable=False, server_default="")


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    if "brand_name" not in _existing_columns():
        op.add_column(_TABLE, _COLUMN)


def downgrade() -> None:
    if "brand_name" in _existing_columns():
        op.drop_column(_TABLE, "brand_name")
