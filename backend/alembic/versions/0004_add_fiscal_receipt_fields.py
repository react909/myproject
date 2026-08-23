"""Add every field a fiscal receipt has to print.

The receipt header carries data the setup wizard never collected: the outlet's
parsed address and coordinates, the tax regime and rates, the cash register's
serial/registration/fiscal-module numbers, the acquiring terminal, and the
cashier's tax code. Without these columns a receipt cannot be printed at all,
so they are part of onboarding rather than optional settings.

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-11

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# name -> column factory. Guarded the same way as 0003: databases carried over
# from the pre-Alembic path were built by metadata.create_all() and may already
# have some of these.
_COLUMNS: dict[str, "sa.Column"] = {
    "company_legal_name": sa.Column("company_legal_name", sa.String(length=255), nullable=False, server_default=""),
    "postal_code": sa.Column("postal_code", sa.String(length=16), nullable=False, server_default=""),
    "street": sa.Column("street", sa.String(length=255), nullable=False, server_default=""),
    "building": sa.Column("building", sa.String(length=64), nullable=False, server_default=""),
    "latitude": sa.Column("latitude", sa.String(length=32), nullable=False, server_default=""),
    "longitude": sa.Column("longitude", sa.String(length=32), nullable=False, server_default=""),
    "tax_regime": sa.Column("tax_regime", sa.String(length=32), nullable=False, server_default="simplified_single"),
    "vat_rate": sa.Column("vat_rate", sa.Float(), nullable=False, server_default="0"),
    "sales_tax_rate": sa.Column("sales_tax_rate", sa.Float(), nullable=False, server_default="0"),
    "kkm_serial_number": sa.Column("kkm_serial_number", sa.String(length=32), nullable=False, server_default=""),
    "kkm_registration_number": sa.Column(
        "kkm_registration_number", sa.String(length=32), nullable=False, server_default=""
    ),
    "kkm_fiscal_module": sa.Column("kkm_fiscal_module", sa.String(length=32), nullable=False, server_default=""),
    "kkm_ffd_version": sa.Column("kkm_ffd_version", sa.String(length=16), nullable=False, server_default="1.0"),
    "kkm_sw_version": sa.Column(
        "kkm_sw_version", sa.String(length=32), nullable=False, server_default="NewCas-F 1.0"
    ),
    "kkm_pos_number": sa.Column("kkm_pos_number", sa.String(length=8), nullable=False, server_default="1"),
    "acquiring_bank": sa.Column("acquiring_bank", sa.String(length=128), nullable=False, server_default=""),
    "acquiring_terminal_id": sa.Column(
        "acquiring_terminal_id", sa.String(length=64), nullable=False, server_default=""
    ),
    "payment_methods": sa.Column(
        "payment_methods", sa.String(length=128), nullable=False, server_default="cash,card"
    ),
    "cashier_full_name": sa.Column("cashier_full_name", sa.String(length=255), nullable=False, server_default=""),
    "cashier_code": sa.Column("cashier_code", sa.String(length=32), nullable=False, server_default=""),
    "logo_image": sa.Column("logo_image", sa.Text(), nullable=False, server_default=""),
    "logo_mode": sa.Column("logo_mode", sa.String(length=16), nullable=False, server_default="monogram"),
    "logo_text": sa.Column("logo_text", sa.String(length=128), nullable=False, server_default=""),
}


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("store_settings")}


def upgrade() -> None:
    existing = _existing_columns()
    for name, column in _COLUMNS.items():
        if name not in existing:
            op.add_column("store_settings", column)

    # Существующие установки уже показывали название магазина в чеке —
    # переносим его в полное наименование, чтобы шапка не осталась пустой.
    op.execute(
        "UPDATE store_settings SET company_legal_name = company_name "
        "WHERE company_legal_name = '' AND company_name <> ''"
    )


def downgrade() -> None:
    existing = _existing_columns()
    for name in reversed(list(_COLUMNS)):
        if name in existing:
            op.drop_column("store_settings", name)
