"""Расходы магазина: справочник категорий и сами записи.

Расходы нужны обоим режимам аналитики. В режиме «выручка минус расходы» из них
складывается главная цифра, в режиме «только продажи» они показываются
отдельным блоком ниже. Пишутся они одинаково и всегда — иначе переключение
режима означало бы дыру в истории, а не смену представления.

Справочник редактируемый: стартовый набор покрывает типовой магазин, но у
каждого находится своё — маркетинг, ремонт, доставка. Список заводится кодом
при первом обращении к разделу (см. finance/router.py: ensure_default_categories),
а не здесь: установки, обновившиеся со старых версий, должны получить его так
же, как новые, и одной вставкой в миграции это не покрывается.

Категория с историей не удаляется, а прячется: стереть её вместе с расходами
значит получить отчёт, в котором суммы прошлых месяцев перестали сходиться.

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-12

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    tables = _tables()

    if "expense_categories" not in tables:
        op.create_table(
            "expense_categories",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("name", sa.String(length=128), nullable=False),
            # Заполнен только у категорий из стартового набора: по нему код
            # находит «Закупку товара» даже после переименования владельцем.
            sa.Column("slug", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column(
                "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name"),
        )
        op.create_index(
            "ix_expense_categories_slug", "expense_categories", ["slug"], unique=False
        )

    if "expenses" not in tables:
        op.create_table(
            "expenses",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("category_id", sa.Integer(), nullable=True),
            sa.Column("amount", sa.Float(), nullable=False, server_default="0"),
            sa.Column("note", sa.String(length=512), nullable=False, server_default=""),
            # manual — занёс владелец; purchase — приход на склад.
            sa.Column("source", sa.String(length=16), nullable=False, server_default="manual"),
            sa.Column("ref_type", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("ref_id", sa.String(length=64), nullable=False, server_default=""),
            # Отдельно от created_at: аренду за прошлый месяц заносят сегодня,
            # а в отчёт она должна попасть прошлым месяцем.
            sa.Column(
                "spent_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True
            ),
            sa.Column(
                "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True
            ),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["category_id"], ["expense_categories.id"]),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_expenses_category_id", "expenses", ["category_id"], unique=False)
        op.create_index("ix_expenses_spent_at", "expenses", ["spent_at"], unique=False)


def downgrade() -> None:
    tables = _tables()
    if "expenses" in tables:
        op.drop_index("ix_expenses_spent_at", table_name="expenses")
        op.drop_index("ix_expenses_category_id", table_name="expenses")
        op.drop_table("expenses")
    if "expense_categories" in tables:
        op.drop_index("ix_expense_categories_slug", table_name="expense_categories")
        op.drop_table("expense_categories")
