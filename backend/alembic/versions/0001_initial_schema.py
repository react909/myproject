"""Baseline schema: everything models.py already describes, plus sync_log/sync_pk_map.

This is a new baseline, not a replay of the old hand-rolled SQLite
migration history (schema_version 1-4) — pre-existing SQLite files are
brought to this same shape by the legacy path in app/core/migrations.py and
then stamped to this revision instead of running through it.

Revision ID: 0001
Revises:
Create Date: 2026-08-09

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "store_settings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("installation_id", sa.String(length=36), nullable=False, unique=True),
        sa.Column("edition", sa.String(length=16), nullable=False, server_default="start"),
        sa.Column("license_plan", sa.String(length=16), nullable=False, server_default="start"),
        sa.Column("license_revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("company_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("store_name", sa.String(length=255), nullable=False, server_default="Мой магазин"),
        sa.Column("owner_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("inn", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("email", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("currency", sa.String(length=16), nullable=False, server_default="KGS"),
        sa.Column("currency_label", sa.String(length=32), nullable=False, server_default="сом"),
        sa.Column("address", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("phone", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("owner_first_name", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("owner_last_name", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("city", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("country", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="Asia/Bishkek"),
        sa.Column("logo_path", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("primary_color", sa.String(length=16), nullable=False, server_default="#2563eb"),
        sa.Column("theme", sa.String(length=16), nullable=False, server_default="light"),
        sa.Column("setup_completed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("setup_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=255), nullable=False, unique=True),
        sa.Column("full_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False, server_default="cashier"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_username", "users", ["username"])

    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=255), nullable=False, unique=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "products",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("barcode", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("extra_barcodes", sa.Text(), nullable=False, server_default=""),
        sa.Column("kind", sa.String(length=32), nullable=False, server_default="piece"),
        sa.Column("unit", sa.String(length=16), nullable=False, server_default="шт"),
        sa.Column("price", sa.Float(), nullable=False, server_default="0"),
        sa.Column("wholesale_price", sa.Float(), nullable=False, server_default="0"),
        sa.Column("cost_price", sa.Float(), nullable=False, server_default="0"),
        sa.Column("stock_qty", sa.Float(), nullable=False, server_default="0"),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=True),
        sa.Column("image", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_products_name", "products", ["name"])
    op.create_index("ix_products_barcode", "products", ["barcode"])

    op.create_table(
        "stock_moves",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("qty_delta", sa.Float(), nullable=False),
        sa.Column("reason", sa.String(length=64), nullable=False),
        sa.Column("ref_type", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("ref_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("note", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_stock_moves_product_id", "stock_moves", ["product_id"])

    op.create_table(
        "shifts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("open_cash", sa.Float(), nullable=False, server_default="0"),
        sa.Column("close_cash", sa.Float(), nullable=False, server_default="0"),
        sa.Column("sales_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sales_total", sa.Float(), nullable=False, server_default="0"),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("cashbox_name", sa.String(length=128), nullable=False, server_default="Основная"),
    )

    op.create_table(
        "sales",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("doc_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="paid"),
        sa.Column("payment_method", sa.String(length=32), nullable=False, server_default="cash"),
        sa.Column("subtotal", sa.Float(), nullable=False, server_default="0"),
        sa.Column("discount_total", sa.Float(), nullable=False, server_default="0"),
        sa.Column("total", sa.Float(), nullable=False, server_default="0"),
        sa.Column("cash_received", sa.Float(), nullable=False, server_default="0"),
        sa.Column("card_amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("change_amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("debt_balance", sa.Float(), nullable=False, server_default="0"),
        sa.Column("client_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("client_phone", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("shift_id", sa.Integer(), sa.ForeignKey("shifts.id"), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("cashier_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.String(length=512), nullable=False, server_default=""),
    )
    op.create_index("ix_sales_doc_number", "sales", ["doc_number"])
    op.create_index("ix_sales_created_at", "sales", ["created_at"])

    op.create_table(
        "sale_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("sale_id", sa.Integer(), sa.ForeignKey("sales.id"), nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("is_weight", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_service", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("quantity", sa.Float(), nullable=False, server_default="1"),
        sa.Column("unit_price", sa.Float(), nullable=False, server_default="0"),
        sa.Column("discount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("line_total", sa.Float(), nullable=False, server_default="0"),
        sa.Column("cost_price", sa.Float(), nullable=False, server_default="0"),
    )
    op.create_index("ix_sale_items_sale_id", "sale_items", ["sale_id"])

    op.create_table(
        "debt_payments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("sale_id", sa.Integer(), sa.ForeignKey("sales.id"), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("payment_method", sa.String(length=32), nullable=False, server_default="cash"),
        sa.Column("cash_received", sa.Float(), nullable=False, server_default="0"),
        sa.Column("change_amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("note", sa.String(length=255), nullable=False, server_default=""),
    )
    op.create_index("ix_debt_payments_sale_id", "debt_payments", ["sale_id"])

    op.create_table(
        "sale_counters",
        sa.Column("id", sa.Integer(), primary_key=True, default=1),
        sa.Column("last_number", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("id"),
    )

    op.create_table(
        "sync_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("table_name", sa.String(length=64), nullable=False),
        sa.Column("row_pk", sa.String(length=64), nullable=False),
        sa.Column("operation", sa.String(length=16), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("target", sa.String(length=24), nullable=False, server_default="postgres_reconcile"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=False, server_default=""),
        sa.Column("origin_engine", sa.String(length=16), nullable=False, server_default="sqlite"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_sync_log_table_name", "sync_log", ["table_name"])
    op.create_index("ix_sync_log_status", "sync_log", ["status"])

    op.create_table(
        "sync_pk_map",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("table_name", sa.String(length=64), nullable=False),
        sa.Column("sqlite_pk", sa.String(length=64), nullable=False),
        sa.Column("postgres_pk", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("table_name", "sqlite_pk"),
    )
    op.create_index("ix_sync_pk_map_table_name", "sync_pk_map", ["table_name"])


def downgrade() -> None:
    op.drop_table("sync_pk_map")
    op.drop_table("sync_log")
    op.drop_table("sale_counters")
    op.drop_table("debt_payments")
    op.drop_table("sale_items")
    op.drop_table("sales")
    op.drop_table("shifts")
    op.drop_table("stock_moves")
    op.drop_table("products")
    op.drop_table("categories")
    op.drop_table("users")
    op.drop_table("store_settings")
