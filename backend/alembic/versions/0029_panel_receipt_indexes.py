"""Индексы под фильтры журнала чеков.

Журнал панели фильтруется по дате, номеру документа, кассиру, статусу, способу
оплаты и товару. До этой миграции на `sales` было два индекса — `doc_number` и
`created_at`, — и любой другой фильтр шёл полным сканом таблицы. На кассе с
двухлетней историей это двести тысяч строк на каждое нажатие в фильтре.

Что добавляется и почему именно так:

* `ix_sales_created_at_id` — составной, (created_at DESC, id DESC). Журнал
  всегда отсортирован по времени, а курсорная пагинация доопределяет порядок
  по id. Одиночного индекса по created_at для этого мало: SQLite взял бы его
  для сортировки, но добирал бы id из таблицы построчно.

* `ix_sales_status_total` — составной (status, total), и вторая колонка здесь
  не для фильтрации, а чтобы индекс ПОКРЫВАЛ показатели. Суммы над журналом
  считаются одним запросом `SUM(CASE status …)`, и по этому индексу SQLite
  читает узкое дерево из двух полей вместо всей таблицы с логотипами клиентов
  и реквизитами оплаты. Замер: сводка за неделю 53 → 14 мс.

* `ix_sales_payment_method` — фильтр по способу оплаты. Малоселективен сам по
  себе (карта — треть чеков), и на нём одном планировщик его справедливо не
  берёт; работает в паре с диапазоном дат.

* `ix_sales_cashier_created` — составной (cashier_name, created_at). «Смена
  такого-то за неделю» — самый частый вопрос к журналу. Замер: 53 → 2 мс.

* `ix_sale_items_name_sale` — составной (name, sale_id). Фильтр по товару идёт
  через EXISTS по позициям; вторая колонка делает подзапрос index-only — он
  находит sale_id прямо в индексе и в таблицу позиций не заглядывает.
  Замер: 506 → 8 мс.

* `ix_sale_items_sale_kind` — составной (sale_id, is_weight) для переключателя
  «весовые / штучные», который проверяется тем же EXISTS. Замер: 241 → 2 мс.

Индекс по `doc_number` уже был и остаётся: поиск по номеру опирается на него.

Данные не трогаются: индексы строятся по существующим строкам, ни одна запись
не читается приложением и не переписывается. На пустой базе миграция
мгновенная, на двухстах тысячах чеков — несколько секунд разово.

Revision ID: 0029
Revises: 0028
Create Date: 2026-08-21

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0029"
down_revision: Union[str, None] = "0028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (имя, таблица, колонки). Порядок колонок в составных значим — см. шапку.
_INDEXES: tuple[tuple[str, str, list[str]], ...] = (
    ("ix_sales_created_at_id", "sales", ["created_at", "id"]),
    ("ix_sales_status_total", "sales", ["status", "total"]),
    ("ix_sales_payment_method", "sales", ["payment_method"]),
    ("ix_sales_cashier_created", "sales", ["cashier_name", "created_at"]),
    ("ix_sale_items_name_sale", "sale_items", ["name", "sale_id"]),
    ("ix_sale_items_sale_kind", "sale_items", ["sale_id", "is_weight"]),
)


def _existing(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {index["name"] for index in inspector.get_indexes(table)}


def upgrade() -> None:
    seen: dict[str, set[str]] = {}
    for name, table, columns in _INDEXES:
        if table not in seen:
            seen[table] = _existing(table)
        if not seen[table]:
            # Таблицы нет вовсе — база старше первой схемы, строить нечего.
            inspector = sa.inspect(op.get_bind())
            if table not in inspector.get_table_names():
                continue
        if name in seen[table]:
            continue
        op.create_index(name, table, columns)
        seen[table].add(name)


def downgrade() -> None:
    for name, table, _columns in reversed(_INDEXES):
        if name in _existing(table):
            op.drop_index(name, table_name=table)
