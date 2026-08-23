"""Смена, закупка, поставщики: новые таблицы, поля смены и индексы под фильтры.

Что делает миграция с СУЩЕСТВУЮЩИМИ данными — по порядку, потому что это
единственный вопрос, который к миграции есть.

1. Таблица `shifts` получает десять новых колонок. Все с `server_default`, все
   NOT NULL — существующие строки заполняются значением по умолчанию, ни одна
   не переписывается и не удаляется.

2. Три из них заполняются из уже имеющихся данных, а не нулями:

   * `open_cash_tiyin` — из `open_cash` умножением на 100 с округлением. Это
     та же сумма, только в целых тыйынах: смена, открытая с разменом 500 сом,
     после миграции имеет 50000 тыйынов, а не ноль;
   * `opened_by_name` — из `users.full_name` (а если пусто, то `username`) по
     `user_id`. Одним UPDATE ... FROM подзапросом, не построчно;
   * `number` — порядковый номер по возрастанию `id`. Нумерация начинается с
     единицы и совпадает с историческим порядком смен. Счётчик
     `shift_counters` ставится на максимум, чтобы следующая смена получила
     номер, а не столкнулась с существующим.

   `expected_cash_tiyin` и `variance_tiyin` у старых смен остаются нулями
   намеренно: у закрытой смены сверки не было, и выдумывать расчётную сумму
   задним числом нельзя — она была бы посчитана по сегодняшней формуле для
   данных, которых уже нет. В карточке такая смена показывает «сверка не
   проводилась».

3. Шесть новых таблиц создаются пустыми. Ни одна существующая строка их не
   касается.

4. Индексы строятся по существующим строкам. Данные не читаются приложением и
   не переписываются.

ПРОДАЖИ НЕ ТРОГАЮТСЯ ВОВСЕ. `sales.shift_id` уже существует и уже заполнен;
чеки, у которых смены нет, остаются с NULL — это и есть признак «смена не
указана». Раздавать им смены задним числом нельзя: смены, в которую они
попали бы, не было, и её показатели стали бы выдумкой.

Revision ID: 0030
Revises: 0029
Create Date: 2026-08-23

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0030"
down_revision: Union[str, None] = "0029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (имя колонки, тип, server_default). Все NOT NULL: у смены не бывает
# «неизвестного размена», бывает нулевой.
_SHIFT_COLUMNS: tuple[tuple[str, sa.types.TypeEngine, str], ...] = (
    ("number", sa.Integer(), "0"),
    ("open_cash_tiyin", sa.Integer(), "0"),
    ("counted_cash_tiyin", sa.Integer(), "0"),
    ("expected_cash_tiyin", sa.Integer(), "0"),
    ("variance_tiyin", sa.Integer(), "0"),
    ("variance_reason", sa.String(512), "''"),
    ("opened_by_name", sa.String(255), "''"),
    ("closed_by_name", sa.String(255), "''"),
    # Снимок показателей закрытой смены — см. модель Shift.
    ("revenue_tiyin", sa.Integer(), "0"),
    ("cash_tiyin", sa.Integer(), "0"),
    ("cashless_tiyin", sa.Integer(), "0"),
    ("refunds_tiyin", sa.Integer(), "0"),
)

# (имя, таблица, колонки). Порядок колонок в составных значим — под какой
# запрос каждый, расписано в шапке модуля закупок и смен.
_INDEXES: tuple[tuple[str, str, list[str]], ...] = (
    # Показатели смены считаются одним агрегатом по чекам этой смены.
    # Без индекса это полный скан `sales` на каждое открытие раздела.
    ("ix_sales_shift_status", "sales", ["shift_id", "status"]),
    # «Что из документа успели продать» ищет позиции чеков по товару. Без
    # этого индекса SQLite шёл от таблицы чеков и просматривал позиции для
    # каждого: замер на 120 000 чеков — 400 мс на один вопрос перед отменой
    # проведения. Вторая колонка делает подзапрос index-only.
    ("ix_sale_items_product_sale", "sale_items", ["product_id", "sale_id"]),
    ("ix_shifts_status", "shifts", ["status"]),
    ("ix_shifts_opened_at_id", "shifts", ["opened_at", "id"]),
    ("ix_shifts_user_opened", "shifts", ["user_id", "opened_at"]),
    ("ix_cash_movements_shift_created", "cash_movements", ["shift_id", "created_at"]),
    ("ix_purchase_docs_date_id", "purchase_docs", ["doc_date", "id"]),
    ("ix_purchase_docs_status_date", "purchase_docs", ["status", "doc_date"]),
    ("ix_purchase_docs_supplier_status", "purchase_docs", ["supplier_id", "status"]),
    ("ix_purchase_lines_doc_sort", "purchase_lines", ["doc_id", "sort_order"]),
    ("ix_purchase_lines_product_doc", "purchase_lines", ["product_id", "doc_id"]),
    ("ix_supplier_payments_supplier_paid", "supplier_payments", ["supplier_id", "paid_at"]),
)


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def _indexes(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {index["name"] for index in inspector.get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()

    # ── 1. Новые колонки смены ───────────────────────────────────────────────
    existing = _columns("shifts")
    if existing:
        for name, type_, default in _SHIFT_COLUMNS:
            if name in existing:
                continue
            op.add_column(
                "shifts",
                sa.Column(name, type_, nullable=False, server_default=sa.text(default)),
            )
        if "closed_by_user_id" not in existing:
            # Без ForeignKey в самом ALTER: SQLite не умеет добавлять
            # внешний ключ существующей таблице, а batch-режим ради одной
            # необязательной ссылки означал бы пересоздание таблицы смен —
            # то есть копирование всех данных. Ссылка описана в модели и
            # проверяется приложением.
            op.add_column("shifts", sa.Column("closed_by_user_id", sa.Integer(), nullable=True))

    # ── 2. Заполнение новых колонок из уже имеющихся данных ──────────────────
    if existing:
        # Размен: те же сомы, только целыми тыйынами. ROUND до целого —
        # иначе 500.0 * 100 в SQLite остаётся вещественным 50000.0.
        bind.execute(
            sa.text(
                "UPDATE shifts SET open_cash_tiyin = CAST(ROUND(COALESCE(open_cash, 0) * 100) AS INTEGER) "
                "WHERE open_cash_tiyin = 0"
            )
        )
        bind.execute(
            sa.text(
                "UPDATE shifts SET counted_cash_tiyin = CAST(ROUND(COALESCE(close_cash, 0) * 100) AS INTEGER) "
                "WHERE counted_cash_tiyin = 0 AND status = 'closed'"
            )
        )
        # Кто открыл. Одним подзапросом на всю таблицу, а не построчно.
        if "users" in _table_names():
            bind.execute(
                sa.text(
                    "UPDATE shifts SET opened_by_name = COALESCE(("
                    "  SELECT CASE WHEN u.full_name != '' THEN u.full_name ELSE u.username END"
                    "  FROM users u WHERE u.id = shifts.user_id"
                    "), '') WHERE opened_by_name = ''"
                )
            )
        # Номера по историческому порядку. Коррелированный подсчёт «сколько
        # смен с id не больше моего» — один проход, без временных таблиц.
        bind.execute(
            sa.text(
                "UPDATE shifts SET number = ("
                "  SELECT COUNT(*) FROM shifts s2 WHERE s2.id <= shifts.id"
                ") WHERE number = 0"
            )
        )
        # Снимок показателей для УЖЕ ЗАКРЫТЫХ смен.
        #
        # Без него история показала бы нули по всем сменам, накопленным до
        # обновления, — то есть выглядела бы как испорченные данные. Считается
        # один раз, здесь, одним проходом по чекам: дальше эти числа читаются
        # как есть, потому что закрытую смену править нельзя.
        #
        # Округление к каждой строке, а не к итогу: сумма одного чека — целое
        # число тыйынов, и складывать надо уже целые.
        #
        # Отсечение отрицательного — через CASE, а не через MAX(x, 0):
        # двухаргументный MAX есть в SQLite и нет в Postgres, где MAX это
        # агрегат. Миграция выполняется на обоих движках (см. init_db), и
        # запрос обязан быть портируемым.
        if "sales" in _table_names():
            bind.execute(
                sa.text(
                    """
                    UPDATE shifts SET
                      revenue_tiyin = COALESCE((
                        SELECT SUM(CAST(ROUND(s.total * 100) AS INTEGER)) FROM sales s
                        WHERE s.shift_id = shifts.id AND s.status IN ('paid', 'debt')), 0),
                      cash_tiyin = COALESCE((
                        SELECT SUM(CAST(ROUND((s.cash_received - s.change_amount) * 100) AS INTEGER))
                        FROM sales s WHERE s.shift_id = shifts.id AND s.status != 'canceled'), 0),
                      cashless_tiyin = COALESCE((
                        SELECT SUM(CAST(ROUND(s.card_amount * 100) AS INTEGER)) FROM sales s
                        WHERE s.shift_id = shifts.id), 0),
                      refunds_tiyin = COALESCE((
                        SELECT SUM(CAST(ROUND(
                          CASE WHEN s.subtotal - s.discount_total - s.total > 0
                               THEN s.subtotal - s.discount_total - s.total
                               ELSE 0 END * 100) AS INTEGER))
                        FROM sales s WHERE s.shift_id = shifts.id
                          AND s.status IN ('refunded', 'partial_refund')), 0)
                    WHERE status = 'closed'
                    """
                )
            )

    # ── 3. Новые таблицы ─────────────────────────────────────────────────────
    tables = _table_names()

    if "cash_movements" not in tables:
        op.create_table(
            "cash_movements",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("shift_id", sa.Integer(), sa.ForeignKey("shifts.id"), nullable=False),
            sa.Column("kind", sa.String(24), nullable=False),
            sa.Column("amount_tiyin", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("reason", sa.String(128), nullable=False, server_default=sa.text("''")),
            sa.Column("comment", sa.String(512), nullable=False, server_default=sa.text("''")),
            sa.Column("actor_name", sa.String(255), nullable=False, server_default=sa.text("''")),
            sa.Column("ref_type", sa.String(32), nullable=False, server_default=sa.text("''")),
            sa.Column("ref_id", sa.String(64), nullable=False, server_default=sa.text("''")),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )

    if "suppliers" not in tables:
        op.create_table(
            "suppliers",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("contact_person", sa.String(255), nullable=False, server_default=sa.text("''")),
            sa.Column("phone", sa.String(64), nullable=False, server_default=sa.text("''")),
            sa.Column("address", sa.String(512), nullable=False, server_default=sa.text("''")),
            sa.Column("comment", sa.String(1024), nullable=False, server_default=sa.text("''")),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
            sa.Column(
                "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
            ),
            sa.Column(
                "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
            ),
        )
        op.create_index("ix_suppliers_name", "suppliers", ["name"])
        op.create_index("ix_suppliers_phone", "suppliers", ["phone"])

    if "purchase_docs" not in tables:
        op.create_table(
            "purchase_docs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("number", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("kind", sa.String(16), nullable=False, server_default=sa.text("'purchase'")),
            sa.Column("supplier_id", sa.Integer(), sa.ForeignKey("suppliers.id"), nullable=True),
            sa.Column(
                "doc_date", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
            ),
            sa.Column("invoice_number", sa.String(64), nullable=False, server_default=sa.text("''")),
            sa.Column("comment", sa.String(1024), nullable=False, server_default=sa.text("''")),
            sa.Column("settlement", sa.String(16), nullable=False, server_default=sa.text("'paid'")),
            sa.Column("due_date", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(16), nullable=False, server_default=sa.text("'draft'")),
            sa.Column("total_tiyin", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("positions_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("total_qty", sa.Float(), nullable=False, server_default=sa.text("0")),
            sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("posted_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("source_doc_id", sa.Integer(), sa.ForeignKey("purchase_docs.id"), nullable=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column(
                "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
            ),
            sa.Column(
                "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
            ),
        )
        op.create_index("ix_purchase_docs_number", "purchase_docs", ["number"])

    if "purchase_lines" not in tables:
        op.create_table(
            "purchase_lines",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("doc_id", sa.Integer(), sa.ForeignKey("purchase_docs.id"), nullable=False),
            sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=True),
            sa.Column("name", sa.String(255), nullable=False, server_default=sa.text("''")),
            sa.Column("barcode", sa.String(64), nullable=False, server_default=sa.text("''")),
            sa.Column("unit", sa.String(16), nullable=False, server_default=sa.text("'шт'")),
            sa.Column("qty", sa.Float(), nullable=False, server_default=sa.text("0")),
            sa.Column("cost_tiyin", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("line_total_tiyin", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("retail_tiyin", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("before_qty", sa.Float(), nullable=False, server_default=sa.text("0")),
            sa.Column("before_cost_tiyin", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("before_retail_tiyin", sa.Integer(), nullable=False, server_default=sa.text("0")),
        )

    if "supplier_payments" not in tables:
        op.create_table(
            "supplier_payments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("supplier_id", sa.Integer(), sa.ForeignKey("suppliers.id"), nullable=False),
            sa.Column("amount_tiyin", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column(
                "paid_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
            ),
            sa.Column("method", sa.String(16), nullable=False, server_default=sa.text("'cash'")),
            sa.Column("comment", sa.String(512), nullable=False, server_default=sa.text("''")),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column(
                "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
            ),
        )

    for counter in ("purchase_counters", "shift_counters"):
        if counter not in tables:
            op.create_table(
                counter,
                sa.Column("id", sa.Integer(), primary_key=True),
                sa.Column("last_number", sa.Integer(), nullable=False, server_default=sa.text("0")),
                sa.UniqueConstraint("id"),
            )

    # Счётчик смен — на максимум уже существующих номеров, иначе первая смена
    # после обновления получила бы номер 1, уже занятый.
    if existing:
        bind.execute(
            sa.text(
                "INSERT INTO shift_counters (id, last_number) "
                "SELECT 1, COALESCE(MAX(number), 0) FROM shifts"
            )
        )

    # ── 4. Индексы ───────────────────────────────────────────────────────────
    tables = _table_names()
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
    tables = _table_names()

    for name, table, _columns_ in reversed(_INDEXES):
        if table in tables and name in _indexes(table):
            op.drop_index(name, table_name=table)

    for table in (
        "supplier_payments",
        "purchase_lines",
        "purchase_docs",
        "suppliers",
        "cash_movements",
        "purchase_counters",
        "shift_counters",
    ):
        if table in tables:
            op.drop_table(table)

    existing = _columns("shifts")
    for name, _type, _default in reversed(_SHIFT_COLUMNS):
        if name in existing:
            op.drop_column("shifts", name)
    if "closed_by_user_id" in existing:
        op.drop_column("shifts", "closed_by_user_id")
