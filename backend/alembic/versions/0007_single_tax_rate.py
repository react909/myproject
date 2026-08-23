"""Ставка единого налога упрощённой системы.

Шаг «Бизнес и налоги» перестал требовать от владельца знания налогового
кодекса: при выборе СНО ставки подставляются сами. Для упрощённой системы
такой ставкой оказался единый налог (0,5% для торговли), которому в схеме
места не было — НДС и НСП его не заменяют.

В чек ставка не печатается: строка «СНО» в шапке уже описывает режим. Она
нужна владельцу, чтобы посчитать платёж, поэтому живёт рядом с остальными
ставками, а не в отдельной таблице.

Существующим установкам на упрощённой системе проставляем 0,5% — это ставка
для торговли, к которой относится подавляющее большинство магазинов. Кому не
подходит, поправит в реквизитах: поле обычное и редактируемое.

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-12

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("store_settings")}


def upgrade() -> None:
    if "single_tax_rate" not in _existing_columns():
        op.add_column(
            "store_settings",
            sa.Column("single_tax_rate", sa.Float(), nullable=False, server_default="0"),
        )

    op.execute(
        "UPDATE store_settings SET single_tax_rate = 0.5 "
        "WHERE tax_regime = 'simplified_single' AND single_tax_rate = 0"
    )


def downgrade() -> None:
    if "single_tax_rate" in _existing_columns():
        op.drop_column("store_settings", "single_tax_rate")
