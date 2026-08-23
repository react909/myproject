"""Запросы журнала чеков.

Отдельный слой от маршрутов по одной практической причине: здесь собирается
условие выборки, и оно обязано быть ОДНО на список и на показатели. Пока эти
два места собирали фильтр каждое по-своему, сумма над таблицей относилась не к
той выборке, что в таблице, — и заметить это можно было только сложением
столбца вручную.

Правила, которых держится модуль:

* ни одного запроса в цикле;
* показатели — одним агрегатом, а не перебором строк в Python;
* список — курсором, а не offset: на глубоких страницах offset заставляет
  SQLite пересчитывать всё, что пропускает.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Select, and_, case, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Sale, SaleItem

# Статусы, которые считаются возвратом. Возврат — не «отрицательная продажа»:
# у чека меняется статус, а сумма остаётся своей, поэтому в показателях они
# складываются отдельным столбцом, а не вычитаются из выручки.
REFUND_STATUSES = ("refunded", "partial_refund")

# Что считается выручкой: оплаченные чеки и долги. Отменённые — нет: по ним
# денег не было. Возвраты тоже нет — они выведены в свой показатель.
REVENUE_STATUSES = ("paid", "debt")


@dataclass(frozen=True)
class ReceiptFilters:
    """Всё, по чему журнал можно отфильтровать.

    Одна структура на список и на показатели: разойтись им нечем.
    """

    date_from: datetime | None = None
    date_to: datetime | None = None
    doc_number: str = ""
    client: str = ""
    product: str = ""
    cashier: str = ""
    status: str = ""
    payment_method: str = ""
    product_kind: str = "all"

    def is_empty(self) -> bool:
        """Ни одного фильтра — журнал за всё время."""
        return not any(
            (
                self.date_from,
                self.date_to,
                self.doc_number,
                self.client,
                self.product,
                self.cashier,
                self.status,
                self.payment_method,
                self.product_kind != "all",
            )
        )


def _product_condition(filters: ReceiptFilters, *, correlated: bool):
    """Условие по позициям чека.

    Форма подзапроса разная у списка и у показателей, и это не небрежность, а
    вывод из замеров на 200 000 чеков.

    JOIN отпадает сразу в обоих случаях: он размножил бы строку чека по числу
    подходящих позиций, и чек с тремя совпадениями попал бы в журнал трижды.
    Лечится `DISTINCT`, но тогда SQLite обязан материализовать и отсортировать
    всю выборку, прежде чем отдать первые пятьдесят строк.

    СПИСОК — коррелированный EXISTS (`correlated=True`). Списку нужны первые
    полсотни строк, и EXISTS проверяется ровно для них: обход прекращается,
    как только набралась страница. Замер: 8 мс.

    ПОКАЗАТЕЛИ — подзапрос IN (`correlated=False`). Здесь обойти надо всю
    выборку, и коррелированный EXISTS выполнился бы для каждого из двухсот
    тысяч чеков: замер дал 2686 мс. IN SQLite материализует один раз во
    временный индекс и дальше проверяет принадлежность поиском: 442 мс.

    Те же две формы в обратном порядке дают ровно обратный результат — IN на
    списке 445 мс, EXISTS на показателях 2686 мс. Поэтому выбор по месту, а не
    одна форма на оба запроса.
    """
    conditions = []
    if filters.product:
        conditions.append(SaleItem.name.ilike(f"%{filters.product}%"))
    if filters.product_kind == "weight":
        conditions.append(SaleItem.is_weight.is_(True))
    elif filters.product_kind == "piece":
        conditions.append(SaleItem.is_weight.is_(False))
    if not conditions:
        return None

    if correlated:
        return exists(
            select(SaleItem.id)
            .where(SaleItem.sale_id == Sale.id, *conditions)
            .correlate(Sale)
        )
    return Sale.id.in_(select(SaleItem.sale_id).where(*conditions))


def build_conditions(filters: ReceiptFilters, *, correlated: bool) -> list:
    """Условие выборки. Единственное место, где фильтры превращаются в SQL.

    `correlated` меняет только форму подзапроса по позициям — набор условий и
    их смысл одинаковы у списка и у показателей. Иначе сумма над таблицей
    относилась бы не к той выборке, что в таблице.
    """
    conditions: list = []

    if filters.date_from is not None:
        conditions.append(Sale.created_at >= filters.date_from)
    if filters.date_to is not None:
        conditions.append(Sale.created_at <= filters.date_to)

    if filters.doc_number:
        digits = "".join(ch for ch in filters.doc_number if ch.isdigit())
        if digits:
            # Точное совпадение номера, а не LIKE по строке: doc_number —
            # целое, и LIKE по нему заставил бы SQLite приводить каждую строку
            # к тексту, потеряв индекс.
            conditions.append(Sale.doc_number == int(digits))
        else:
            # В поле ввели буквы — совпасть не с чем. Возвращаем заведомо
            # ложное условие, а не игнорируем фильтр: иначе журнал показал бы
            # всё подряд, будто фильтра нет.
            conditions.append(Sale.id < 0)

    if filters.client:
        like = f"%{filters.client}%"
        conditions.append(or_(Sale.client_name.ilike(like), Sale.client_phone.ilike(like)))
    if filters.cashier:
        conditions.append(Sale.cashier_name == filters.cashier)
    if filters.status:
        conditions.append(Sale.status == filters.status)
    if filters.payment_method:
        conditions.append(Sale.payment_method == filters.payment_method)

    product = _product_condition(filters, correlated=correlated)
    if product is not None:
        conditions.append(product)

    return conditions


def _apply(stmt: Select, filters: ReceiptFilters, *, correlated: bool) -> Select:
    conditions = build_conditions(filters, correlated=correlated)
    return stmt.where(and_(*conditions)) if conditions else stmt


def encode_cursor(sale_id: int) -> str:
    """Курсор — это id последнего отданного чека.

    Годится потому, что журнал всегда упорядочен по id как по последнему
    ключу: id растёт вместе со временем продажи и уникален, поэтому пара
    «сортировка + id» задаёт строгий порядок без пропусков и повторов.
    """
    return str(sale_id)


def decode_cursor(raw: str | None) -> int | None:
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        # Испорченный курсор — не повод падать: отдаём первую страницу.
        return None


async def fetch_page(
    session: AsyncSession,
    filters: ReceiptFilters,
    *,
    limit: int,
    cursor: int | None,
    sort: str,
    direction: str,
) -> tuple[list[Sale], str | None]:
    """Одна порция журнала и курсор на следующую.

    Позиции чеков не подгружаются: строка таблицы их не показывает. Раньше
    список приезжал вместе с ними, и на пятидесяти чеках это был второй запрос
    на несколько сотен строк, который никто не читал.

    Порядок всегда доопределён по id. Без этого две продажи в одну секунду
    (обычное дело на кассе в час пик) могли бы поменяться местами между двумя
    страницами: одна попала бы в обе, другая — ни в одну.
    """
    column = {
        "created_at": Sale.created_at,
        "doc_number": Sale.doc_number,
        "total": Sale.total,
    }.get(sort, Sale.created_at)

    # Поиск по номеру документа сортируется по самому номеру, а не по времени.
    #
    # Это не косметика, а исправление замеренной просадки. Номер уникален, и
    # находится ровно один чек — но пока запрос просил порядок по времени,
    # SQLite брал индекс по created_at (он же обслуживает ORDER BY), читал
    # таблицу с конца и сравнивал doc_number построчно, пока не найдёт. На
    # двухстах тысячах чеков поиск по номеру занимал 1035 мс — дольше, чем
    # вообще без индексов.
    #
    # С порядком по doc_number планировщик берёт индекс по номеру и находит
    # строку сразу: 1035 мс → 0.2 мс. Смысл при этом не теряется — упорядочивать
    # по времени выборку из одного чека нечего.
    if filters.doc_number:
        column = Sale.doc_number

    descending = direction != "asc"
    order = (column.desc(), Sale.id.desc()) if descending else (column.asc(), Sale.id.asc())

    # Список — коррелированный EXISTS: он обрывается на набранной странице.
    stmt = _apply(select(Sale), filters, correlated=True).order_by(*order).limit(limit + 1)
    if cursor is not None:
        stmt = stmt.where(Sale.id < cursor) if descending else stmt.where(Sale.id > cursor)

    rows = list((await session.execute(stmt)).scalars().all())
    # Просим на одну строку больше, чем отдаём: так видно, есть ли следующая
    # страница, и не нужен отдельный COUNT ради одной этой мысли.
    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor = encode_cursor(page[-1].id) if has_more and page else None
    return page, next_cursor


#: Размер порции выгрузки. Отдельной величиной, а не числом в сигнатуре: так
#: тест может сделать её крошечной и проверить стык между порциями на пяти
#: чеках вместо тысячи. Ошибка курсора живёт ровно на этом стыке.
EXPORT_CHUNK = 1_000


async def stream_all(
    session: AsyncSession,
    filters: ReceiptFilters,
    *,
    chunk: int | None = None,
) -> AsyncIterator[Sale]:
    """Вся выборка по фильтрам — порциями, для выгрузки в файл.

    Единственное место, где журнал отдаётся целиком, и наружу оно не торчит:
    в HTTP-ответ уходит поток, а не список. Причина та же, по которой у списка
    жёсткий потолок страницы — выгрузка за год это десятки тысяч чеков, и
    собрать их в памяти одним куском значит занять десятки мегабайт и подвесить
    процесс, пока касса ждёт продажу.

    Порядок и курсор — по ОДНОМУ ключу, по номеру чека. Это важнее, чем
    кажется, и стоило одной найденной ошибки и одной почти-ошибки.

    Сначала здесь стояла сортировка по `(created_at DESC, id DESC)`, а курсор
    сравнивал один `id`. Это два разных порядка: совпадают они только там, где
    номера растут вместе со временем продажи. Стоит им разойтись — и после
    первой порции условие отсекает не то, что уже отдано. На двух тысячах чеков
    выгрузка дала 3916 строк вместо 2000: чеки шли в файл по два раза, а часть
    не шла вовсе. С фильтрами сходилось точно — отобранное помещалось в одну
    порцию, и второго запроса просто не было.

    Второй заход был сравнением пар (`ROW VALUES`): порядок тот же, что в
    сортировке, всё честно. И он тоже дал повторы — потому что сравнение
    времени в SQLite это сравнение ТЕКСТА, а текст зависит от того, кто писал
    строку: `'2026-03-05 10:00:00'` меньше, чем `'2026-03-05 10:00:00.000000'`,
    и пограничный чек возвращался ещё раз. Опираться на согласованность формата
    даты во всей базе — плохая опора для выгрузки, которую понесут в налоговую.

    `id` от формата не зависит, уникален и строг. Порядок по нему — это порядок,
    в котором чеки пробивали; для выгрузки чеков он не хуже времени, а на любой
    базе точен. Ни повторов, ни пропусков не может быть по построению.

    `yield_per` не используется намеренно: он держит открытым курсор SQLite на
    всё время выгрузки, а между порциями здесь ждут сеть. Отдельные короткие
    запросы освобождают базу между ними — касса в это время продаёт.
    """
    size = chunk or EXPORT_CHUNK
    after: int | None = None
    while True:
        stmt = _apply(select(Sale), filters, correlated=True).order_by(Sale.id.desc()).limit(size)
        if after is not None:
            stmt = stmt.where(Sale.id < after)

        rows = list((await session.execute(stmt)).scalars().all())
        if not rows:
            return
        for sale in rows:
            yield sale
        if len(rows) < size:
            return
        after = rows[-1].id


async def fetch_summary(session: AsyncSession, filters: ReceiptFilters) -> dict[str, float]:
    """Четыре показателя одним запросом.

    Именно одним. Раньше их считал фронт по трёмстам загруженным чекам —
    цифры относились не к фильтру, а к тому, что успело приехать. Четыре
    отдельных запроса тоже не годятся: каждый заново прошёл бы ту же выборку,
    а на двухстах тысячах строк это учетверённое время.

    `case` внутри агрегатов делит суммы по статусу за один проход: выручка
    считает оплаченные и долговые чеки, возвраты — возвращённые, и обход
    таблицы при этом всё равно один.
    """
    revenue = func.coalesce(
        func.sum(case((Sale.status.in_(REVENUE_STATUSES), Sale.total), else_=0.0)), 0.0
    )
    # Возвращённая сумма, а не остаток чека.
    #
    # Это исправление ошибки, найденной проходом «строка → карточка → возврат»
    # на живых данных. Возврат в кассе (sales/router.py) не заводит отдельной
    # записи на сумму: он УМЕНЬШАЕТ `total` самого чека — до нуля при полном
    # возврате. Поэтому `SUM(total) WHERE status = 'refunded'` складывал нули,
    # и плитка «Возвраты» после настоящего возврата не двигалась вовсе.
    #
    # Возвращено = сколько чек стоил минус сколько от него осталось. До возврата
    # `total = subtotal - discount_total`, и после возврата разность даёт ровно
    # возвращённую сумму — и для полного возврата, и для частичного.
    #
    # `max(0, …)` от порчи данных: если чек правили руками и остаток оказался
    # больше исходной суммы, «Возвраты» не должны уходить в минус.
    refunded_amount = func.max(Sale.subtotal - Sale.discount_total - Sale.total, 0.0)
    refunds = func.coalesce(
        func.sum(case((Sale.status.in_(REFUND_STATUSES), refunded_amount), else_=0.0)), 0.0
    )
    revenue_count = func.coalesce(
        func.sum(case((Sale.status.in_(REVENUE_STATUSES), 1), else_=0)), 0
    )

    stmt = _apply(
        select(
            func.count(Sale.id).label("receipts_count"),
            revenue.label("revenue"),
            refunds.label("refunds"),
            revenue_count.label("revenue_count"),
        ),
        filters,
        # Показатели обходят всю выборку — здесь IN, а не EXISTS. См. _product_condition.
        correlated=False,
    )
    row = (await session.execute(stmt)).one()

    # Средний чек считается по тем чекам, что дали выручку: делить её на все
    # строки вместе с отменёнными значило бы занижать средний чек тем сильнее,
    # чем больше отмен было в смене.
    revenue_value = float(row.revenue or 0.0)
    paid = int(row.revenue_count or 0)
    return {
        "receipts_count": int(row.receipts_count or 0),
        "revenue": revenue_value,
        "refunds": float(row.refunds or 0.0),
        "avg_check": revenue_value / paid if paid else 0.0,
    }


async def fetch_cashiers(session: AsyncSession) -> list[str]:
    """Кассиры для выпадающего списка — из базы, а не из загруженной страницы.

    Раньше список собирался из тех чеков, что приехали на фронт: кассир,
    который сегодня не продавал, из фильтра пропадал, и найти его смену было
    нечем.
    """
    stmt = (
        select(Sale.cashier_name)
        .where(Sale.cashier_name != "")
        .group_by(Sale.cashier_name)
        .order_by(Sale.cashier_name)
    )
    return [name for name in (await session.execute(stmt)).scalars().all() if name]
