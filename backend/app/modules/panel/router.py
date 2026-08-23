"""Маршруты панели управления.

Панель — рабочий инструмент смены. Здесь журнал чеков: список, показатели над
ним и карточка одного чека. Финансов и аналитики нет и не будет — они за
дверью владельца, и разделение проходит по маршрутам, а не по интерфейсу.

Доступ проверяется на сервере: `get_current_user` на весь маршрутизатор. Без
этого журнал чеков можно было бы прочитать прямым запросом.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import get_current_user
from app.db.database import get_db_session
from app.db.models import Sale, User
from app.modules.panel.repository import (
    ReceiptFilters,
    decode_cursor,
    fetch_cashiers,
    fetch_page,
    fetch_summary,
    stream_all,
)

# Человеческие подписи для выгрузки. В файле, который откроют в Excel, «paid» и
# «partial_refund» никому ничего не говорят.
STATUS_TITLES = {
    "paid": "Оплачен",
    "debt": "Долг",
    "canceled": "Отменён",
    "refunded": "Возврат",
    "partial_refund": "Частичный возврат",
}
PAYMENT_TITLES = {
    "cash": "Наличные",
    "card": "Карта",
    "mixed": "Смешанная",
    "debt": "В долг",
}


def _csv(value: str) -> str:
    """Поле CSV.

    Точка с запятой — разделитель (см. директиву `sep=`), поэтому её, кавычки и
    переносы строк нужно экранировать: имя клиента «ОсОО "Бимар"; Чуй 1» иначе
    развалило бы строку на три ячейки.
    """
    text = (value or "").replace('"', '""')
    return f'"{text}"' if any(ch in text for ch in ';"\r\n') else text


def _money(value: float) -> str:
    """Число для Excel в русской локали: запятая как десятичный разделитель."""
    return f"{value:.2f}".replace(".", ",")
from app.modules.panel.schema import (
    PANEL_PAGE_MAX,
    PanelReceiptDetails,
    PanelReceiptItem,
    PanelReceiptRow,
    PanelReceiptsPage,
    PanelReceiptsSummary,
    PAYMENT_PATTERN,
    STATUS_PATTERN,
)

router = APIRouter(
    prefix="/api/panel",
    tags=["panel"],
    dependencies=[Depends(get_current_user)],
)


def _parse_moment(raw: str | None, *, field: str) -> datetime | None:
    """ISO-строка в дату.

    Ошибку не проглатываем. Прежний список чеков молча игнорировал негодную
    дату (`except ValueError: pass`) и отдавал журнал без фильтра — человек
    видел чужие чеки и считал, что фильтр не работает. Явный 422 честнее.
    """
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail=f"Поле «{field}»: дата должна быть в формате ISO (2026-08-21 или 2026-08-21T10:00).",
        ) from error


def _filters(
    date_from: str | None,
    date_to: str | None,
    doc_number: str,
    client: str,
    product: str,
    cashier: str,
    sale_status: str,
    payment_method: str,
    product_kind: str,
) -> ReceiptFilters:
    return ReceiptFilters(
        date_from=_parse_moment(date_from, field="Дата с"),
        date_to=_parse_moment(date_to, field="Дата по"),
        doc_number=doc_number.strip(),
        client=client.strip(),
        product=product.strip(),
        cashier=cashier.strip(),
        status=sale_status.strip(),
        payment_method=payment_method.strip(),
        product_kind=product_kind,
    )


def _row(sale: Sale) -> PanelReceiptRow:
    return PanelReceiptRow(
        id=sale.id,
        doc_number=sale.doc_number,
        status=sale.status,
        payment_method=sale.payment_method,
        total=sale.total,
        discount_total=sale.discount_total,
        debt_balance=sale.debt_balance,
        client_name=sale.client_name,
        cashier_name=sale.cashier_name,
        created_at=sale.created_at,
    )


@router.get("/receipts", response_model=PanelReceiptsPage)
async def list_receipts(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    doc_number: str = Query(default=""),
    client: str = Query(default="", max_length=128),
    product: str = Query(default="", max_length=128),
    cashier: str = Query(default="", max_length=128),
    sale_status: str = Query(default="", alias="status", pattern=f"^$|{STATUS_PATTERN}"),
    payment_method: str = Query(default="", pattern=f"^$|{PAYMENT_PATTERN}"),
    product_kind: str = Query(default="all", pattern="^(all|weight|piece)$"),
    sort: str = Query(default="created_at", pattern="^(created_at|doc_number|total)$"),
    direction: str = Query(default="desc", pattern="^(asc|desc)$"),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=PANEL_PAGE_MAX),
    session: AsyncSession = Depends(get_db_session),
) -> PanelReceiptsPage:
    """Порция журнала по фильтрам.

    Весь журнал одним ответом не отдаётся ни при каких параметрах: потолок
    `limit` жёсткий. На кассе с двухлетней историей это двести тысяч строк —
    их некуда положить ни в ответ, ни в память окна.
    """
    rows, next_cursor = await fetch_page(
        session,
        _filters(
            date_from, date_to, doc_number, client, product, cashier,
            sale_status, payment_method, product_kind,
        ),
        limit=limit,
        cursor=decode_cursor(cursor),
        sort=sort,
        direction=direction,
    )
    return PanelReceiptsPage(rows=[_row(sale) for sale in rows], next_cursor=next_cursor)


@router.get("/receipts/summary", response_model=PanelReceiptsSummary)
async def receipts_summary(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    doc_number: str = Query(default=""),
    client: str = Query(default="", max_length=128),
    product: str = Query(default="", max_length=128),
    cashier: str = Query(default="", max_length=128),
    sale_status: str = Query(default="", alias="status", pattern=f"^$|{STATUS_PATTERN}"),
    payment_method: str = Query(default="", pattern=f"^$|{PAYMENT_PATTERN}"),
    product_kind: str = Query(default="all", pattern="^(all|weight|piece)$"),
    session: AsyncSession = Depends(get_db_session),
) -> PanelReceiptsSummary:
    """Показатели над журналом — по тем же фильтрам, одним запросом."""
    data = await fetch_summary(
        session,
        _filters(
            date_from, date_to, doc_number, client, product, cashier,
            sale_status, payment_method, product_kind,
        ),
    )
    return PanelReceiptsSummary(**data)


@router.get("/receipts/export")
async def export_receipts(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    doc_number: str = Query(default=""),
    client: str = Query(default="", max_length=128),
    product: str = Query(default="", max_length=128),
    cashier: str = Query(default="", max_length=128),
    sale_status: str = Query(default="", alias="status", pattern=f"^$|{STATUS_PATTERN}"),
    payment_method: str = Query(default="", pattern=f"^$|{PAYMENT_PATTERN}"),
    product_kind: str = Query(default="all", pattern="^(all|weight|piece)$"),
    session: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    """Выгрузка журнала по текущим фильтрам — в CSV, который открывает Excel.

    По фильтрам, а не по загруженной на фронт порции: в браузере лежит полсотни
    строк, а выгружают обычно месяц.

    CSV, а не XLSX. Excel открывает его двойным щелчком, и это ровно то, о чём
    просили; XLSX потребовал бы библиотеку (openpyxl — около 250 КБ) ради
    формата, который здесь ничем не лучше. Две уступки Excel всё же нужны:

      • BOM в начале — иначе Excel читает UTF-8 как ANSI, и кириллица
        превращается в кракозябры;
      • разделитель через директиву `sep=;` — русская локаль Excel ждёт точку с
        запятой, а не запятую, и без директивы кладёт всю строку в одну ячейку.

    Отдаётся потоком порциями по тысяче строк. На выгрузке за год это десятки
    тысяч записей: собрать их в памяти одним куском значило бы занять
    десятки мегабайт и подвесить процесс, пока касса ждёт продажу.
    """
    filters = _filters(
        date_from, date_to, doc_number, client, product, cashier,
        sale_status, payment_method, product_kind,
    )

    async def rows() -> AsyncIterator[str]:
        # Директива и BOM — до заголовков, иначе Excel их не увидит.
        yield "﻿sep=;\r\n"
        yield ";".join(
            ("Номер", "Дата", "Время", "Клиент", "Кассир", "Оплата", "Статус", "Скидка", "Сумма")
        ) + "\r\n"

        async for sale in stream_all(session, filters):
            moment = sale.created_at
            yield ";".join(
                (
                    str(sale.doc_number),
                    moment.strftime("%d.%m.%Y") if moment else "",
                    moment.strftime("%H:%M") if moment else "",
                    _csv(sale.client_name),
                    _csv(sale.cashier_name),
                    PAYMENT_TITLES.get(sale.payment_method, sale.payment_method),
                    STATUS_TITLES.get(sale.status, sale.status),
                    _money(sale.discount_total),
                    _money(sale.total),
                )
            ) + "\r\n"

    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M")
    return StreamingResponse(
        rows(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="receipts_{stamp}.csv"'},
    )


@router.get("/cashiers", response_model=list[str])
async def cashiers(session: AsyncSession = Depends(get_db_session)) -> list[str]:
    """Кассиры для фильтра — из базы, а не из загруженной страницы."""
    return await fetch_cashiers(session)


@router.get("/receipts/{sale_id}", response_model=PanelReceiptDetails)
async def receipt_details(
    sale_id: int,
    session: AsyncSession = Depends(get_db_session),
) -> PanelReceiptDetails:
    """Один чек с позициями.

    Позиции приезжают только сюда. В списке их нет намеренно: строка таблицы
    их не показывает, а на странице в пятьдесят чеков это лишние сотни строк
    в каждом ответе.
    """
    sale = (
        await session.execute(
            select(Sale).options(selectinload(Sale.items)).where(Sale.id == sale_id)
        )
    ).scalar_one_or_none()
    if sale is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Чек не найден.")

    return PanelReceiptDetails(
        **_row(sale).model_dump(),
        subtotal=sale.subtotal,
        cash_received=sale.cash_received,
        card_amount=sale.card_amount,
        change_amount=sale.change_amount,
        client_phone=sale.client_phone,
        paid_at=sale.paid_at,
        items=[
            PanelReceiptItem(
                id=item.id,
                name=item.name,
                is_weight=item.is_weight,
                quantity=item.quantity,
                unit_price=item.unit_price,
                discount=item.discount,
                line_total=item.line_total,
            )
            for item in (sale.items or [])
        ],
    )
