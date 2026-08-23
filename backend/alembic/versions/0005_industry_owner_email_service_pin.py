"""Business industry preset, owner email as login, service PIN.

Three changes land together because they all come from the reworked
onboarding:

* `industry` replaces `business_type` with a wider list of spheres. The sphere
  now drives the catalogue preset (product attributes, default units, product
  card template), so it is no longer a cosmetic label. `decimals` and
  `stock_mode` join it as the rest of the business profile.
* `owner_email` is the login. It is stored separately from the company's legal
  email even when the wizard links them, because the two diverge as soon as a
  shop gets an accountant.
* `service_pin_hash` replaces `master_password_hash`. Existing installs keep
  the old hash so they are not locked out of their own settings before an
  owner sets a PIN.

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-11

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMNS: dict[str, "sa.Column"] = {
    "industry": sa.Column("industry", sa.String(length=32), nullable=False, server_default="other"),
    "decimals": sa.Column("decimals", sa.Integer(), nullable=False, server_default="2"),
    "stock_mode": sa.Column("stock_mode", sa.String(length=16), nullable=False, server_default="tracked"),
    "owner_email": sa.Column("owner_email", sa.String(length=255), nullable=False, server_default=""),
    "owner_email_same_as_company": sa.Column(
        "owner_email_same_as_company", sa.Boolean(), nullable=False, server_default=sa.true()
    ),
    "service_pin_hash": sa.Column("service_pin_hash", sa.String(length=255), nullable=False, server_default=""),
}

# Старые профили ложатся на новые сферы: универсальный магазин и хозтовары
# ближе всего к «Другое», остальные совпадают один в один.
_INDUSTRY_FROM_BUSINESS_TYPE = {
    "clothing": "clothing",
    "cosmetics": "cosmetics",
    "household": "other",
    "universal": "other",
}


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("store_settings")}


def upgrade() -> None:
    existing = _existing_columns()
    for name, column in _COLUMNS.items():
        if name not in existing:
            op.add_column("store_settings", column)

    for business_type, industry in _INDUSTRY_FROM_BUSINESS_TYPE.items():
        op.execute(
            sa.text(
                "UPDATE store_settings SET industry = :industry "
                "WHERE business_type = :business_type AND industry = 'other'"
            ).bindparams(industry=industry, business_type=business_type)
        )

    # Логин существующих установок остаётся прежним, но поле email владельца
    # заполняем почтой компании — иначе экран реквизитов покажет пустоту.
    op.execute("UPDATE store_settings SET owner_email = email WHERE owner_email = '' AND email <> ''")


def downgrade() -> None:
    existing = _existing_columns()
    for name in reversed(list(_COLUMNS)):
        if name in existing:
            op.drop_column("store_settings", name)
