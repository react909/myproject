"""Схемы панели управления.

Панель — рабочий инструмент смены: журнал чеков и отчёт по товарам. Денег
владельца здесь нет и быть не должно — ни прибыли, ни себестоимости, ни
трендов. Они живут за дверью владельца (analytics, finance), и отдельный набор
схем нужен в том числе затем, чтобы это разделение было видно в коде: сюда
нечего добавить «заодно», не заметив.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

# Наборы значений вынесены в константы: по ним строятся и проверки запроса, и
# индексы, и тесты. Разъехавшись, они дают тихий баг — фильтр молча ничего не
# находит, потому что во фронте статус называется иначе.
SALE_STATUSES = ("paid", "debt", "canceled", "refunded", "partial_refund")
PAYMENT_METHODS = ("cash", "card", "mixed", "debt")
PRODUCT_KINDS = ("all", "weight", "piece")
SORT_FIELDS = ("created_at", "doc_number", "total")
SORT_DIRECTIONS = ("asc", "desc")

# Потолок одной порции журнала.
#
# Двести — это примерно четыре экрана таблицы на моноблоке. Больше просить
# незачем: список виртуализирован и всё равно рисует только видимые строки, а
# ответ на тысячу чеков — это лишние сотни килобайт JSON на каждую прокрутку.
PANEL_PAGE_MAX = 200

STATUS_PATTERN = "^(" + "|".join(SALE_STATUSES) + ")$"
PAYMENT_PATTERN = "^(" + "|".join(PAYMENT_METHODS) + ")$"


class PanelReceiptItem(BaseModel):
    """Позиция чека. Отдаётся только в карточке одного чека, не в списке."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_weight: bool
    quantity: float
    unit_price: float
    discount: float
    line_total: float


class PanelReceiptRow(BaseModel):
    """Строка журнала.

    Без позиций намеренно. Строка таблицы их не показывает, а `selectinload`
    ради них тянул бы вторым запросом десятки тысяч записей на каждую страницу.
    Позиции приезжают по нажатию на чек — отдельным маршрутом.
    """

    id: int
    doc_number: int
    status: str
    payment_method: str
    total: float
    discount_total: float
    debt_balance: float
    client_name: str
    cashier_name: str
    created_at: datetime


class PanelReceiptsPage(BaseModel):
    """Порция журнала и курсор на следующую.

    Курсор, а не номер страницы. На offset-пагинации SQLite отсчитывает
    пропущенные строки заново на каждой странице: к сотой странице запрос
    начинает читать сотню тысяч строк, чтобы отдать полсотни. Курсор читает
    ровно свою порцию независимо от глубины.
    """

    rows: list[PanelReceiptRow]
    # Передаётся в следующий запрос как `cursor`. None — список кончился.
    next_cursor: str | None = None


class PanelReceiptsSummary(BaseModel):
    """Показатели над журналом — по тем же фильтрам, что и список.

    Считаются одним агрегирующим запросом. Раньше их считал фронт перебором
    трёхсот загруженных чеков, и цифры относились не к фильтру, а к тому, что
    успело приехать.
    """

    receipts_count: int
    revenue: float
    refunds: float
    avg_check: float


class PanelReceiptDetails(PanelReceiptRow):
    """Один чек целиком — для карточки и для возврата."""

    subtotal: float
    cash_received: float
    card_amount: float
    change_amount: float
    client_phone: str
    paid_at: datetime | None
    items: list[PanelReceiptItem] = Field(default_factory=list)
