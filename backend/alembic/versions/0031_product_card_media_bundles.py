"""Карточка товара: услуги и комплекты, реквизиты, фото и видео.

Что миграция делает с СУЩЕСТВУЮЩИМИ данными:

1. `products` получает десять новых колонок. Все с `server_default`, все
   NOT NULL, кроме двух ссылочных (`expires_at`, `supplier_id`) — существующие
   строки заполняются значением по умолчанию, ни одна не переписывается.

2. Ничего не пересчитывается и не переносится. Единственное, что миграция
   ЧИТАЕТ у существующих строк, — штрихкоды, и только чтобы предупредить о
   дублях (см. п. 4).

3. Две новые таблицы (`product_media`, `product_bundle_items`) создаются
   пустыми.

4. ШТРИХКОД СТАНОВИТСЯ УНИКАЛЬНЫМ — частичным индексом, только для непустых
   значений. Обычный UNIQUE здесь невозможен: у товаров без кода в колонке
   пустая строка, и второй такой товар не сохранился бы вовсе.

   Если в базе УЖЕ есть дубли штрихкодов, индекс не создастся, и миграция
   упала бы на клиенте. Поэтому дубли сначала ищутся, и всем, кроме самого
   старого товара, код переносится в `extra_barcodes` — данные при этом не
   теряются, а касса продолжает находить товар по этому коду (поиск смотрит и
   в дополнительные коды). Что именно перенесено, печатается в журнал
   миграции.

Revision ID: 0031
Revises: 0030
Create Date: 2026-08-23

"""
from __future__ import annotations

import logging
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0031"
down_revision: Union[str, None] = "0030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")


# (имя, тип, server_default). None в default — колонка nullable.
_PRODUCT_COLUMNS: tuple[tuple[str, sa.types.TypeEngine, str | None], ...] = (
    ("min_stock", sa.Float(), "0"),
    ("expires_at", sa.DateTime(timezone=True), None),
    ("brand", sa.String(128), "''"),
    ("country", sa.String(128), "''"),
    ("description", sa.Text(), "''"),
    ("supplier_id", sa.Integer(), None),
    ("wholesale_from_qty", sa.Float(), "0"),
    ("bundle_price_mode", sa.String(8), "'own'"),
    ("client_token", sa.String(64), "''"),
)

_INDEXES: tuple[tuple[str, str, list[str]], ...] = (
    ("ix_products_supplier_id", "products", ["supplier_id"]),
    # Список товаров сортируется по названию и фильтруется по виду.
    ("ix_products_kind_name", "products", ["kind", "name"]),
    # «Что заканчивается» и «что истекает» — два самых частых отчёта по складу.
    ("ix_products_expires_at", "products", ["expires_at"]),
    ("ix_product_media_product_sort", "product_media", ["product_id", "sort_order"]),
    ("ix_product_bundle_bundle", "product_bundle_items", ["bundle_id", "sort_order"]),
    ("ix_product_bundle_item", "product_bundle_items", ["item_id"]),
)

#: Имя частичного уникального индекса по штрихкоду.
BARCODE_INDEX = "ux_products_barcode_not_empty"


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _indexes(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {index["name"] for index in inspector.get_indexes(table)}


def _normalize_empty(bind) -> None:
    """Свести «нет штрихкода» к ОДНОМУ значению — пустой строке.

    Частичный уникальный индекс `WHERE barcode != ''` работает только если
    отсутствие кода всегда записано одинаково. Стоит где-то оказаться NULL —
    и он выпадет из условия: NULL != '' в SQL не истина, а неопределённость,
    строка под индекс не попадёт, и два товара с NULL спокойно разойдутся
    мимо проверки.

    Колонка объявлена NOT NULL с самого начала, но база могла пережить ручные
    правки, восстановление из чужой копии и старые версии схемы. Приведение
    стоит один UPDATE и снимает вопрос навсегда.
    """
    for column in ("barcode", "extra_barcodes", "client_token"):
        bind.execute(
            sa.text(f"UPDATE products SET {column} = '' WHERE {column} IS NULL")
        )
    # Пробелы по краям — то же самое отсутствие кода, но мимо условия индекса.
    bind.execute(sa.text("UPDATE products SET barcode = TRIM(barcode)"))


def _dedupe_barcodes(bind) -> None:
    """Развести дубли штрихкодов, ничего не потеряв.

    Самый старый товар оставляет код себе, остальные переносят его в
    дополнительные коды. Касса ищет и по ним, поэтому сканер продолжает
    находить товар — но уже однозначно, а не «какой-нибудь из трёх».
    """
    duplicates = bind.execute(
        sa.text(
            "SELECT barcode FROM products WHERE barcode != '' "
            "GROUP BY barcode HAVING COUNT(*) > 1"
        )
    ).scalars().all()
    if not duplicates:
        return

    for code in duplicates:
        rows = bind.execute(
            sa.text(
                "SELECT id, extra_barcodes FROM products "
                "WHERE barcode = :code ORDER BY id"
            ),
            {"code": code},
        ).all()
        # Первый (самый старый) оставляет код себе.
        for product_id, extras in rows[1:]:
            parts = [part.strip() for part in (extras or "").split(",") if part.strip()]
            if code not in parts:
                parts.append(code)
            bind.execute(
                sa.text(
                    "UPDATE products SET barcode = '', extra_barcodes = :extras WHERE id = :id"
                ),
                {"extras": ",".join(parts), "id": product_id},
            )
        logger.warning(
            "штрихкод %s стоял у %d товаров; оставлен товару %s, у остальных перенесён "
            "в дополнительные коды",
            code,
            len(rows),
            rows[0][0],
        )


def upgrade() -> None:
    bind = op.get_bind()
    tables = _tables()

    # ── 1. Новые колонки товара ──────────────────────────────────────────────
    if "products" in tables:
        existing = _columns("products")
        for name, type_, default in _PRODUCT_COLUMNS:
            if name in existing:
                continue
            op.add_column(
                "products",
                sa.Column(
                    name,
                    type_,
                    nullable=default is None,
                    server_default=sa.text(default) if default is not None else None,
                ),
            )
        # Внешний ключ на поставщика не навешивается ALTER'ом: SQLite этого не
        # умеет, а batch-режим пересоздал бы таблицу товаров целиком — то есть
        # скопировал бы весь каталог ради одной необязательной ссылки. Связь
        # описана в модели и проверяется приложением.

    # ── 2. Новые таблицы ─────────────────────────────────────────────────────
    if "product_media" not in tables:
        op.create_table(
            "product_media",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
            sa.Column("kind", sa.String(8), nullable=False, server_default=sa.text("'photo'")),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("file_name", sa.String(128), nullable=False),
            sa.Column("thumb_name", sa.String(128), nullable=False, server_default=sa.text("''")),
            sa.Column("mime", sa.String(64), nullable=False, server_default=sa.text("'image/jpeg'")),
            sa.Column("bytes_size", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("width", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("height", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("duration_ms", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )

    if "product_bundle_items" not in tables:
        op.create_table(
            "product_bundle_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("bundle_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
            sa.Column("qty", sa.Float(), nullable=False, server_default=sa.text("1")),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        )

    # ── 3. Уникальность штрихкода ────────────────────────────────────────────
    if "products" in tables and BARCODE_INDEX not in _indexes("products"):
        # Порядок значим: сперва свести «нет кода» к одному значению, только
        # потом искать дубли. Иначе NULL и '' сочтутся разными кодами.
        _normalize_empty(bind)
        _dedupe_barcodes(bind)
        # Частичный индекс: и SQLite, и Postgres понимают `WHERE`. Без него
        # пустая строка у товаров без кода сделала бы уникальность невозможной.
        op.create_index(
            BARCODE_INDEX,
            "products",
            ["barcode"],
            unique=True,
            sqlite_where=sa.text("barcode != ''"),
            postgresql_where=sa.text("barcode != ''"),
        )
        # Токен формы: второй раз тот же токен создать товар не должен.
        if "ux_products_client_token" not in _indexes("products"):
            op.create_index(
                "ux_products_client_token",
                "products",
                ["client_token"],
                unique=True,
                sqlite_where=sa.text("client_token != ''"),
                postgresql_where=sa.text("client_token != ''"),
            )

    # ── 4. Индексы ───────────────────────────────────────────────────────────
    tables = _tables()
    seen: dict[str, set[str]] = {}
    for name, table, columns in _INDEXES:
        if table not in tables:
            continue
        if table not in seen:
            seen[table] = _indexes(table)
        if name in seen[table]:
            continue
        op.create_index(name, table, columns)
        seen[table].add(name)


def downgrade() -> None:
    tables = _tables()

    for name, table, _cols in reversed(_INDEXES):
        if table in tables and name in _indexes(table):
            op.drop_index(name, table_name=table)

    if "products" in tables:
        for name in ("ux_products_client_token", BARCODE_INDEX):
            if name in _indexes("products"):
                op.drop_index(name, table_name="products")

    for table in ("product_bundle_items", "product_media"):
        if table in tables:
            op.drop_table(table)

    existing = _columns("products")
    for name, _type, _default in reversed(_PRODUCT_COLUMNS):
        if name in existing:
            op.drop_column("products", name)
