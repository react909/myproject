"""Маршруты закупки: список документов, черновик, проведение, отмена, ценники.

Разделение обязанностей: здесь только приём запроса, проверка прав и форма
ответа. Всё, что меняет склад и цены, — в `service.py`, одной транзакцией.

Списки постраничные, фильтры и сортировка в SQL, итоги одним агрегатом. Ни
одного запроса в цикле: список документов идёт со снимком итогов в самом
документе, список строк — одним `IN` по товарам.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.money import line_total, markup_percent, to_tiyin
from app.core.security import get_current_user
from app.db.database import get_db_session
from app.db.models import (
    Product,
    PurchaseDoc,
    PurchaseLine,
    Supplier,
    User,
)
from app.modules.purchases import service
from app.modules.purchases.service import (
    KIND_PURCHASE,
    STATUS_CANCELED,
    STATUS_DRAFT,
    STATUS_POSTED,
    PostingError,
)

router = APIRouter(prefix="/api/purchases", tags=["purchases"])

MAX_PAGE = 200
#: Потолок строк в одном документе. Накладная на тысячу позиций — это не
#: накладная, а импорт, и грузить её одним запросом нельзя: транзакция
#: проведения держала бы базу, пока касса ждёт продажу.
MAX_LINES = 500


# ── Схемы ─────────────────────────────────────────────────────────────────────


class LineIn(BaseModel):
    product_id: int | None = None
    name: str = Field(default="", max_length=255)
    barcode: str = Field(default="", max_length=64)
    unit: str = Field(default="шт", max_length=16)
    qty: float = Field(gt=0)
    cost_tiyin: int = Field(ge=0)
    retail_tiyin: int = Field(default=0, ge=0)


class LineOut(BaseModel):
    id: int
    product_id: int | None
    name: str
    barcode: str
    unit: str
    qty: float
    cost_tiyin: int
    line_total_tiyin: int
    retail_tiyin: int
    #: Наценка процентом. Не хранится — считается из двух цен: два источника
    #: одной величины рано или поздно разойдутся.
    markup_percent: float
    #: Прибыль с единицы при текущей розничной цене.
    unit_profit_tiyin: int
    #: Остаток товара сейчас — чтобы кассир видел, к чему добавляет.
    stock_qty: float


class DocHeaderIn(BaseModel):
    supplier_id: int | None = None
    doc_date: str = ""
    invoice_number: str = Field(default="", max_length=64)
    comment: str = Field(default="", max_length=1024)
    settlement: str = Field(default="paid", pattern="^(paid|credit)$")
    due_date: str | None = None
    kind: str = Field(default=KIND_PURCHASE, pattern="^(purchase|return)$")
    source_doc_id: int | None = None


class DocSaveIn(DocHeaderIn):
    lines: list[LineIn] = Field(default_factory=list, max_length=MAX_LINES)


class DocRow(BaseModel):
    id: int
    number: int
    kind: str
    doc_date: str
    supplier_id: int | None
    supplier_name: str
    positions_count: int
    total_tiyin: int
    status: str
    settlement: str
    due_date: str | None
    overdue: bool


class DocPage(BaseModel):
    items: list[DocRow]
    next_cursor: str | None = None


class DocSummary(BaseModel):
    docs_count: int
    total_tiyin: int
    draft_count: int
    posted_count: int
    credit_tiyin: int


class DocOut(BaseModel):
    id: int
    number: int
    kind: str
    doc_date: str
    supplier_id: int | None
    supplier_name: str
    invoice_number: str
    comment: str
    settlement: str
    due_date: str | None
    status: str
    total_tiyin: int
    positions_count: int
    total_qty: float
    posted_at: str | None
    source_doc_id: int | None
    lines: list[LineOut]
    #: Ожидаемая прибыль при текущих розничных ценах строк. Прибыль ДОКУМЕНТА,
    #: а не магазина: общая прибыль магазина живёт в кабинете владельца, и
    #: здесь её быть не должно.
    expected_profit_tiyin: int


class SoldAfterRow(BaseModel):
    product_id: int
    name: str
    qty: float
    receipts: int


class LabelRow(BaseModel):
    product_id: int | None
    name: str
    barcode: str
    price_tiyin: int
    qty: float
    unit: str


class LastCostOut(BaseModel):
    """Последняя закупочная цена товара. Пусто — товар берут впервые."""

    cost_tiyin: int | None = None
    doc_date: str | None = None
    supplier_name: str = ""


# ── Преобразования ────────────────────────────────────────────────────────────


def _parse_moment(raw: str | None, *, field: str) -> datetime | None:
    if not raw:
        return None
    try:
        moment = datetime.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Неверная дата: {field}.")
    # Даты хранятся в UTC. Пришедшее без пояса считаем UTC, а не местным:
    # иначе документ, заведённый в 23:30, попал бы во вчера или в завтра в
    # зависимости от того, где стоит касса.
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _line_out(line: PurchaseLine, product: Product | None) -> LineOut:
    return LineOut(
        id=line.id,
        product_id=line.product_id,
        name=line.name,
        barcode=line.barcode,
        unit=line.unit,
        qty=line.qty,
        cost_tiyin=line.cost_tiyin,
        line_total_tiyin=line.line_total_tiyin,
        retail_tiyin=line.retail_tiyin,
        markup_percent=markup_percent(line.cost_tiyin, line.retail_tiyin),
        unit_profit_tiyin=max(0, int(line.retail_tiyin) - int(line.cost_tiyin))
        if line.retail_tiyin
        else 0,
        stock_qty=float(product.stock_qty) if product else 0.0,
    )


async def _doc_out(session: AsyncSession, doc: PurchaseDoc) -> DocOut:
    lines = list(
        (
            await session.execute(
                select(PurchaseLine)
                .where(PurchaseLine.doc_id == doc.id)
                .order_by(PurchaseLine.sort_order, PurchaseLine.id)
            )
        ).scalars().all()
    )
    products = await service.load_products(session, lines)
    supplier_name = ""
    if doc.supplier_id:
        supplier_name = (
            await session.execute(select(Supplier.name).where(Supplier.id == doc.supplier_id))
        ).scalar_one_or_none() or ""

    rendered = [_line_out(line, products.get(int(line.product_id or 0))) for line in lines]
    return DocOut(
        id=doc.id,
        number=doc.number,
        kind=doc.kind,
        doc_date=doc.doc_date.isoformat() if doc.doc_date else "",
        supplier_id=doc.supplier_id,
        supplier_name=supplier_name,
        invoice_number=doc.invoice_number,
        comment=doc.comment,
        settlement=doc.settlement,
        due_date=doc.due_date.isoformat() if doc.due_date else None,
        status=doc.status,
        total_tiyin=doc.total_tiyin,
        positions_count=doc.positions_count,
        total_qty=doc.total_qty,
        posted_at=doc.posted_at.isoformat() if doc.posted_at else None,
        source_doc_id=doc.source_doc_id,
        lines=rendered,
        expected_profit_tiyin=sum(
            int(line.unit_profit_tiyin * line.qty) for line in rendered
        ),
    )


async def _load(session: AsyncSession, doc_id: int) -> PurchaseDoc:
    doc = (
        await session.execute(select(PurchaseDoc).where(PurchaseDoc.id == doc_id))
    ).scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="Документ не найден.")
    return doc


def _conditions(
    date_from: str | None,
    date_to: str | None,
    supplier_id: int | None,
    doc_status: str,
    kind: str,
) -> list:
    """Условие выборки. Одно на список и на итоги — разойтись им нечем."""
    conditions: list = []
    moment_from = _parse_moment(date_from, field="начало периода")
    moment_to = _parse_moment(date_to, field="конец периода")
    if moment_from is not None:
        conditions.append(PurchaseDoc.doc_date >= moment_from)
    if moment_to is not None:
        conditions.append(PurchaseDoc.doc_date <= moment_to)
    if supplier_id is not None:
        conditions.append(PurchaseDoc.supplier_id == supplier_id)
    if doc_status:
        conditions.append(PurchaseDoc.status == doc_status)
    if kind:
        conditions.append(PurchaseDoc.kind == kind)
    return conditions


# ── Маршруты ──────────────────────────────────────────────────────────────────
#
# `/summary` и `/last-cost` объявлены ВЫШЕ `/{doc_id}`: иначе FastAPI разберёт
# слово «summary» как номер документа и ответит 422.


@router.get("/summary", response_model=DocSummary)
async def summary(
    date_from: str | None = None,
    date_to: str | None = None,
    supplier_id: int | None = None,
    doc_status: str = Query(default="", alias="status"),
    kind: str = "",
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> DocSummary:
    """Итоги по выбранным документам — ОДНИМ агрегатом.

    По тем же фильтрам, что и список: иначе сумма над таблицей относилась бы
    не к тому, что в таблице.
    """
    conditions = _conditions(date_from, date_to, supplier_id, doc_status, kind)
    row = (
        await session.execute(
            select(
                func.count(PurchaseDoc.id).label("docs"),
                func.coalesce(func.sum(PurchaseDoc.total_tiyin), 0).label("total"),
                func.coalesce(
                    func.sum(case((PurchaseDoc.status == STATUS_DRAFT, 1), else_=0)), 0
                ).label("drafts"),
                func.coalesce(
                    func.sum(case((PurchaseDoc.status == STATUS_POSTED, 1), else_=0)), 0
                ).label("posted"),
                func.coalesce(func.sum(service.debt_delta_expression()), 0).label("credit"),
            ).where(*conditions)
        )
    ).one()
    return DocSummary(
        docs_count=int(row.docs or 0),
        total_tiyin=int(row.total or 0),
        draft_count=int(row.drafts or 0),
        posted_count=int(row.posted or 0),
        credit_tiyin=int(row.credit or 0),
    )


@router.get("/last-cost", response_model=LastCostOut)
async def last_cost(
    product_id: int,
    supplier_id: int | None = None,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> LastCostOut:
    """Последняя закупочная цена этого товара — чтобы сразу видеть, подорожал ли.

    У ЭТОГО поставщика, если он указан: цена одного и того же товара у разных
    поставщиков отличается, и сравнивать надо с той, по которой брали у него.
    Если у него не брали ни разу, отдаём пусто, а не цену от соседа: чужая
    цена в подсказке хуже отсутствующей.
    """
    conditions = [
        PurchaseLine.product_id == product_id,
        PurchaseDoc.status == STATUS_POSTED,
        PurchaseDoc.kind == KIND_PURCHASE,
    ]
    if supplier_id is not None:
        conditions.append(PurchaseDoc.supplier_id == supplier_id)
    row = (
        await session.execute(
            select(PurchaseLine.cost_tiyin, PurchaseDoc.doc_date, Supplier.name)
            .join(PurchaseDoc, PurchaseLine.doc_id == PurchaseDoc.id)
            .outerjoin(Supplier, PurchaseDoc.supplier_id == Supplier.id)
            .where(*conditions)
            .order_by(PurchaseDoc.doc_date.desc(), PurchaseDoc.id.desc())
            .limit(1)
        )
    ).first()
    if row is None:
        return LastCostOut()
    cost, moment, name = row
    return LastCostOut(
        cost_tiyin=int(cost),
        doc_date=moment.isoformat() if moment else None,
        supplier_name=name or "",
    )


@router.get("/catalog", response_model=list[dict])
async def catalog(
    q: str = "",
    limit: int = Query(default=20, ge=1, le=50),
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[dict]:
    """Подсказка товаров при вводе накладной: поиск по первым буквам и по коду.

    Не привязана к поставщику намеренно. Строку накладной начинают вводить до
    того, как выбран поставщик, и подсказка, требующая его заранее, ломала бы
    самый частый порядок работы: считал код — подставился товар.

    Отдаёт заодно текущие цены и остаток: строка их сразу подставляет, и
    второго запроса на выбранный товар не нужно.
    """
    like = f"%{q.strip()}%"
    conditions = [Product.is_active.is_(True), Product.kind != "service"]
    if q.strip():
        conditions.append(
            or_(
                Product.name.ilike(like),
                Product.barcode.ilike(like),
                Product.extra_barcodes.ilike(like),
            )
        )
    rows = (
        await session.execute(
            select(Product).where(*conditions).order_by(Product.name).limit(limit)
        )
    ).scalars().all()
    return [
        {
            "id": p.id,
            "name": p.name,
            "barcode": p.barcode,
            "unit": p.unit,
            "stock_qty": float(p.stock_qty),
            "price_tiyin": to_tiyin(p.price),
            "cost_tiyin": to_tiyin(p.cost_price),
        }
        for p in rows
    ]


@router.get("", response_model=DocPage)
async def list_docs(
    date_from: str | None = None,
    date_to: str | None = None,
    supplier_id: int | None = None,
    doc_status: str = Query(default="", alias="status"),
    kind: str = "",
    sort: str = Query(default="doc_date", pattern="^(doc_date|number|total)$"),
    direction: str = Query(default="desc", pattern="^(asc|desc)$"),
    limit: int = Query(default=50, ge=1, le=MAX_PAGE),
    cursor: str | None = None,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> DocPage:
    """Список документов: фильтры, сортировка и страницы — в SQL.

    Имя поставщика приходит `outerjoin`-ом в том же запросе, а не отдельным
    запросом на строку: пятьдесят документов иначе дали бы пятьдесят походов
    в справочник.

    Курсор по `id`, а не по дате: две накладные одним днём (обычное дело)
    иначе могли бы поменяться местами между страницами — одна попала бы в обе,
    другая ни в одну.
    """
    conditions = _conditions(date_from, date_to, supplier_id, doc_status, kind)
    if cursor:
        try:
            conditions.append(PurchaseDoc.id < int(cursor))
        except ValueError:
            pass

    column = {
        "doc_date": PurchaseDoc.doc_date,
        "number": PurchaseDoc.number,
        "total": PurchaseDoc.total_tiyin,
    }[sort]
    descending = direction == "desc"
    order = (
        (column.desc(), PurchaseDoc.id.desc()) if descending else (column.asc(), PurchaseDoc.id.asc())
    )

    rows = list(
        (
            await session.execute(
                select(PurchaseDoc, Supplier.name)
                .outerjoin(Supplier, PurchaseDoc.supplier_id == Supplier.id)
                .where(*conditions)
                .order_by(*order)
                .limit(limit + 1)
            )
        ).all()
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    now = datetime.now(UTC)
    items = [
        DocRow(
            id=doc.id,
            number=doc.number,
            kind=doc.kind,
            doc_date=doc.doc_date.isoformat() if doc.doc_date else "",
            supplier_id=doc.supplier_id,
            supplier_name=name or "",
            positions_count=doc.positions_count,
            total_tiyin=doc.total_tiyin,
            status=doc.status,
            settlement=doc.settlement,
            due_date=doc.due_date.isoformat() if doc.due_date else None,
            overdue=bool(
                doc.settlement == "credit"
                and doc.status == STATUS_POSTED
                and doc.due_date is not None
                and (doc.due_date.replace(tzinfo=UTC) if doc.due_date.tzinfo is None else doc.due_date)
                < now
            ),
        )
        for doc, name in rows
    ]
    return DocPage(items=items, next_cursor=str(rows[-1][0].id) if has_more and rows else None)


@router.post("", response_model=DocOut, status_code=status.HTTP_201_CREATED)
async def create_doc(
    payload: DocSaveIn,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> DocOut:
    """Создать документ. Всегда черновиком.

    Черновик не влияет ни на остатки, ни на цены, ни на долг. Проведение —
    отдельное осознанное действие: накладную вводят долго, и документ,
    применяющийся по мере ввода, оставлял бы склад в промежуточном состоянии
    на всё это время.
    """
    doc = PurchaseDoc(
        number=await service.next_doc_number(session),
        kind=payload.kind,
        supplier_id=payload.supplier_id,
        doc_date=_parse_moment(payload.doc_date, field="дата документа") or datetime.now(UTC),
        invoice_number=payload.invoice_number.strip(),
        comment=payload.comment.strip(),
        settlement=payload.settlement,
        due_date=_parse_moment(payload.due_date, field="срок оплаты"),
        source_doc_id=payload.source_doc_id,
        status=STATUS_DRAFT,
        user_id=user.id,
    )
    session.add(doc)
    await session.flush()
    await _replace_lines(session, doc, payload.lines)
    await session.commit()
    await session.refresh(doc)
    return await _doc_out(session, doc)


async def _replace_lines(
    session: AsyncSession, doc: PurchaseDoc, incoming: list[LineIn]
) -> list[PurchaseLine]:
    """Переписать строки документа целиком.

    Именно целиком, а не построчным сравнением: таблица ввода на фронте —
    электронная таблица, строки в ней двигают, вставляют и удаляют, и
    сопоставлять их по id значило бы вести ещё один учёт того, что и так
    приезжает готовым списком. Документов со строками у нас сотни, не миллионы.

    Старые строки удаляются ОДНИМ запросом, новые вставляются пачкой. Ни
    одного запроса в цикле.
    """
    await session.execute(
        PurchaseLine.__table__.delete().where(PurchaseLine.doc_id == doc.id)
    )
    lines: list[PurchaseLine] = []
    # Названия и штрихкоды берём из карточек товара одним запросом: строка
    # хранит снимок, а присылать его с фронта значило бы верить фронту в том,
    # что попадёт в накладную.
    ids = {int(line.product_id) for line in incoming if line.product_id}
    products: dict[int, Product] = {}
    if ids:
        products = {
            product.id: product
            for product in (
                await session.execute(select(Product).where(Product.id.in_(ids)))
            ).scalars().all()
        }
    for order, item in enumerate(incoming):
        product = products.get(int(item.product_id or 0))
        line = PurchaseLine(
            doc_id=doc.id,
            product_id=item.product_id,
            name=(product.name if product else item.name).strip()[:255],
            barcode=(product.barcode if product else item.barcode).strip()[:64],
            unit=(product.unit if product else item.unit).strip()[:16] or "шт",
            qty=item.qty,
            cost_tiyin=item.cost_tiyin,
            # Сумма строки считается ЗДЕСЬ, а не принимается с фронта: иначе
            # итог документа зависел бы от того, как округлил браузер.
            line_total_tiyin=line_total(item.cost_tiyin, item.qty),
            retail_tiyin=item.retail_tiyin,
            sort_order=order,
        )
        session.add(line)
        lines.append(line)
    service.recalc_totals(doc, lines)
    return lines


@router.get("/{doc_id}", response_model=DocOut)
async def get_doc(
    doc_id: int,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> DocOut:
    return await _doc_out(session, await _load(session, doc_id))


@router.put("/{doc_id}", response_model=DocOut)
async def save_doc(
    doc_id: int,
    payload: DocSaveIn,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> DocOut:
    """Сохранить черновик. Проведённый документ изменить нельзя.

    Проведённый документ уже изменил остатки и цены; правка его строк оставила
    бы склад применённым по одним числам, а документ — с другими, и отмена
    проведения вернула бы не то, что применяла.
    """
    doc = await _load(session, doc_id)
    if doc.status != STATUS_DRAFT:
        raise HTTPException(
            status_code=409,
            detail=f"Документ №{doc.number} проведён — правка недоступна.",
        )
    doc.supplier_id = payload.supplier_id
    doc.doc_date = _parse_moment(payload.doc_date, field="дата документа") or doc.doc_date
    doc.invoice_number = payload.invoice_number.strip()
    doc.comment = payload.comment.strip()
    doc.settlement = payload.settlement
    doc.due_date = _parse_moment(payload.due_date, field="срок оплаты")
    await _replace_lines(session, doc, payload.lines)
    await session.commit()
    await session.refresh(doc)
    return await _doc_out(session, doc)


@router.post("/{doc_id}/post", response_model=DocOut)
async def post_doc(
    doc_id: int,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> DocOut:
    """Провести документ — одной транзакцией.

    Повторное нажатие получает 409 и склада не касается: провести можно только
    черновик, а проведённый документ уже не черновик. Это не «защита от
    двойного клика» поверх логики, а сама логика — обойти её нечем.
    """
    doc = await _load(session, doc_id)
    try:
        await service.post_document(session, doc, user)
    except PostingError as error:
        await session.rollback()
        raise HTTPException(status_code=409 if error.conflict else 400, detail=error.message)
    await session.commit()
    await session.refresh(doc)
    return await _doc_out(session, doc)


@router.get("/{doc_id}/sold-after", response_model=list[SoldAfterRow])
async def sold_after(
    doc_id: int,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[SoldAfterRow]:
    """Что из документа продано после проведения. Спрашивается перед отменой."""
    doc = await _load(session, doc_id)
    return [SoldAfterRow(**row) for row in await service.sold_after_posting(session, doc)]


@router.post("/{doc_id}/unpost", response_model=DocOut)
async def unpost_doc(
    doc_id: int,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> DocOut:
    """Отменить проведение: остатки и цены возвращаются, документ — в отменённые.

    Предупреждение о проданном товаре показывает интерфейс по `/sold-after`;
    здесь отмена не запрещается. Запретить её нельзя: товар мог быть продан по
    ошибке, и тогда отмена — как раз то, что нужно. Решение за человеком, дело
    системы — показать ему, что именно продано.
    """
    doc = await _load(session, doc_id)
    try:
        await service.unpost_document(session, doc, user)
    except PostingError as error:
        await session.rollback()
        raise HTTPException(status_code=409 if error.conflict else 400, detail=error.message)
    await session.commit()
    await session.refresh(doc)
    return await _doc_out(session, doc)


@router.delete("/{doc_id}", response_model=DocOut)
async def cancel_doc(
    doc_id: int,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> DocOut:
    """Отменить черновик. Физически документ не удаляется никогда.

    У номера документа есть история: на него ссылается движение по складу, его
    называют в разговоре с поставщиком. Удалённая строка превратила бы всё это
    в ссылки в пустоту.
    """
    doc = await _load(session, doc_id)
    if doc.status == STATUS_POSTED:
        raise HTTPException(
            status_code=409,
            detail=f"Документ №{doc.number} проведён. Сначала отмените проведение.",
        )
    doc.status = STATUS_CANCELED
    await session.commit()
    await session.refresh(doc)
    return await _doc_out(session, doc)


@router.get("/{doc_id}/labels", response_model=list[LabelRow])
async def labels(
    doc_id: int,
    only: str = Query(default="", description="Идентификаторы строк через запятую"),
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[LabelRow]:
    """Данные ценников на товары документа: все позиции или отмеченные.

    Цена берётся из строки документа (`retail_tiyin`), а если её там нет — из
    карточки товара. Печатать ценник с нулём нельзя, такие строки выпадают:
    ценник без цены хуже отсутствующего.
    """
    doc = await _load(session, doc_id)
    conditions = [PurchaseLine.doc_id == doc.id]
    if only.strip():
        try:
            picked = [int(part) for part in only.split(",") if part.strip()]
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный список строк.")
        if picked:
            conditions.append(PurchaseLine.id.in_(picked))
    lines = list(
        (
            await session.execute(
                select(PurchaseLine)
                .where(*conditions)
                .order_by(PurchaseLine.sort_order, PurchaseLine.id)
            )
        ).scalars().all()
    )
    products = await service.load_products(session, lines)
    rows: list[LabelRow] = []
    for line in lines:
        product = products.get(int(line.product_id or 0))
        price = int(line.retail_tiyin) or (to_tiyin(product.price) if product else 0)
        if price <= 0:
            continue
        rows.append(
            LabelRow(
                product_id=line.product_id,
                name=line.name,
                barcode=line.barcode or (product.barcode if product else ""),
                price_tiyin=price,
                qty=line.qty,
                unit=line.unit,
            )
        )
    return rows


@router.get("/product/{product_id}/suppliers", response_model=list[dict])
async def product_price_comparison(
    product_id: int,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[dict]:
    """У кого и по какой цене закупался этот товар.

    Одним запросом с группировкой по поставщику: последняя цена, дата и число
    поставок. Перебором документов это был бы запрос на поставщика.
    """
    rows = (
        await session.execute(
            select(
                PurchaseDoc.supplier_id,
                func.coalesce(func.min(Supplier.name), "").label("supplier_name"),
                func.count(PurchaseDoc.id).label("deliveries"),
                func.min(PurchaseLine.cost_tiyin).label("min_cost"),
                func.max(PurchaseLine.cost_tiyin).label("max_cost"),
                func.max(PurchaseDoc.doc_date).label("last_date"),
            )
            .join(PurchaseDoc, PurchaseLine.doc_id == PurchaseDoc.id)
            .outerjoin(Supplier, PurchaseDoc.supplier_id == Supplier.id)
            .where(
                PurchaseLine.product_id == product_id,
                PurchaseDoc.status == STATUS_POSTED,
                PurchaseDoc.kind == KIND_PURCHASE,
            )
            .group_by(PurchaseDoc.supplier_id)
            .order_by(func.max(PurchaseDoc.doc_date).desc())
        )
    ).all()

    # Последняя цена у каждого поставщика — вторым запросом на всех сразу, а
    # не по запросу на поставщика. `MAX(cost)` в группировке выше не годится:
    # нужна цена ПОСЛЕДНЕЙ поставки, а она может быть и не самой большой.
    last_costs: dict[int | None, int] = {}
    if rows:
        latest = (
            await session.execute(
                select(PurchaseDoc.supplier_id, PurchaseLine.cost_tiyin, PurchaseDoc.doc_date)
                .join(PurchaseDoc, PurchaseLine.doc_id == PurchaseDoc.id)
                .where(
                    PurchaseLine.product_id == product_id,
                    PurchaseDoc.status == STATUS_POSTED,
                    PurchaseDoc.kind == KIND_PURCHASE,
                )
                .order_by(PurchaseDoc.doc_date.desc(), PurchaseDoc.id.desc())
            )
        ).all()
        for supplier_id, cost, _moment in latest:
            last_costs.setdefault(supplier_id, int(cost))

    return [
        {
            "supplier_id": row.supplier_id,
            "supplier_name": row.supplier_name or "Без поставщика",
            "deliveries": int(row.deliveries or 0),
            "last_cost_tiyin": last_costs.get(row.supplier_id, int(row.max_cost or 0)),
            "min_cost_tiyin": int(row.min_cost or 0),
            "max_cost_tiyin": int(row.max_cost or 0),
            "last_date": row.last_date.isoformat() if row.last_date else None,
        }
        for row in rows
    ]
