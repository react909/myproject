"""Способы безналичной оплаты, платежи банка и подтверждение оплаты.

Шаг «Оплата» перестал быть парой полей «банк» и «терминал ID». Теперь у
магазина есть список способов расчёта с тремя уровнями интеграции: картинка
QR банка, динамический QR через банк и платёжный терминал. Он хранится в
store_settings.payment_providers как JSON — это часть настройки магазина, а не
отдельная сущность со своей жизнью.

Мерчант-ключи в этот JSON не попадают и лежат в отдельной таблице
payment_secrets. Причина простая: реквизиты магазина кассовая часть кэширует в
браузерном хранилище, чтобы поднимать экран оплаты без сети, и ключу банка там
не место.

Продажа получает четыре колонки о том, как именно приняли безнал. Главная из
них — payment_confirmation. `manual` означает, что банк подтверждения не
присылал и кассир принял решение по экрану телефона покупателя: отличить
скриншот чужого платежа в этот момент нельзя. Такие продажи владелец смотрит
отдельным отчётом. Значение по умолчанию — именно `manual`, потому что
осторожная сторона здесь безопаснее оптимистичной: старые продажи никто
автоматически не подтверждал.

Revision ID: 0008
Revises: 0007
Create Date: 2026-08-12

"""
from __future__ import annotations

import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_STORE_COLUMNS: dict[str, "sa.Column"] = {
    "payment_providers": sa.Column(
        "payment_providers", sa.Text(), nullable=False, server_default="[]"
    ),
}

_SALE_COLUMNS: dict[str, "sa.Column"] = {
    "payment_provider": sa.Column(
        "payment_provider", sa.String(length=64), nullable=False, server_default=""
    ),
    "payment_provider_title": sa.Column(
        "payment_provider_title", sa.String(length=128), nullable=False, server_default=""
    ),
    "payment_ref": sa.Column(
        "payment_ref", sa.String(length=128), nullable=False, server_default=""
    ),
    "payment_confirmation": sa.Column(
        "payment_confirmation", sa.String(length=16), nullable=False, server_default="manual"
    ),
}


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    existing_store = _columns("store_settings")
    for name, column in _STORE_COLUMNS.items():
        if name not in existing_store:
            op.add_column("store_settings", column)

    existing_sales = _columns("sales")
    for name, column in _SALE_COLUMNS.items():
        if name not in existing_sales:
            op.add_column("sales", column)

    tables = _tables()

    if "payment_secrets" not in tables:
        op.create_table(
            "payment_secrets",
            sa.Column("provider_id", sa.String(length=64), primary_key=True),
            sa.Column("api_key", sa.String(length=512), nullable=False, server_default=""),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )

    if "payment_intents" not in tables:
        op.create_table(
            "payment_intents",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("payment_id", sa.String(length=64), nullable=False),
            sa.Column("provider_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("order_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("amount", sa.Float(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
            sa.Column("reference", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_payment_intents_payment_id", "payment_intents", ["payment_id"], unique=True)
        op.create_index("ix_payment_intents_order_id", "payment_intents", ["order_id"])

    if "payment_events" not in tables:
        op.create_table(
            "payment_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("provider_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("order_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("amount", sa.Float(), nullable=False, server_default="0"),
            sa.Column("event", sa.String(length=16), nullable=False, server_default="canceled"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_payment_events_created_at", "payment_events", ["created_at"])

    # Установки, где уже был загружен статический QR, получают готовый
    # провайдер: иначе после обновления безнал у них молча пропал бы с экрана
    # оплаты, хотя картинка на месте.
    #
    # JSON уходит связанным параметром, а не строкой в тексте запроса:
    # двоеточие перед `true` SQLAlchemy принимает за плейсхолдер и запрос
    # падает на пустом значении.
    default_provider = json.dumps(
        [{"id": "qr-static-1", "kind": "qr-static", "title": "QR банка", "enabled": True}],
        ensure_ascii=False,
    )
    op.execute(
        sa.text(
            "UPDATE store_settings SET payment_providers = :providers "
            "WHERE payment_providers IN ('', '[]')"
        ).bindparams(providers=default_provider)
    )


def downgrade() -> None:
    tables = _tables()
    for table in ("payment_events", "payment_intents", "payment_secrets"):
        if table in tables:
            op.drop_table(table)

    existing_sales = _columns("sales")
    for name in reversed(list(_SALE_COLUMNS)):
        if name in existing_sales:
            op.drop_column("sales", name)

    existing_store = _columns("store_settings")
    for name in reversed(list(_STORE_COLUMNS)):
        if name in existing_store:
            op.drop_column("store_settings", name)
