"""Расходы магазина: справочник категорий и сами записи.

Ключевое, что задаёт этот модуль: расходы пишутся всегда — и в режиме «только
продажи», и в режиме «выручка минус расходы». Режим аналитики это способ
показать данные, а не способ их вести. Двух систем учёта здесь нет, поэтому
владелец может переключить режим в любой момент: пересчитывать нечего, вся
история уже на месте.

Отчёт по периоду отдаёт и выручку, и расходы, и прибыль сразу. Какая из этих
цифр станет главной на дашборде, решает интерфейс по настройке
`analytics_mode`, а не сервер: считать одно и то же двумя разными запросами
значит рано или поздно получить два разных ответа.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.access import require_owner
from app.core.audit import write_audit
from app.core.security import get_current_user
from app.db.database import get_db_session
from app.db.models import Expense, ExpenseCategory, Sale, User

"""Финансы целиком живут за дверью владельца.

Зависимость висит на маршрутизаторе, а не на каждом обработчике: расходы,
категории и сводка — это деньги магазина, и забыть проверку в новом эндпоинте
здесь стоит слишком дорого. Кассир получает 403 на любой из них, даже зная
адрес.
"""
router = APIRouter(
    prefix="/api/finance",
    tags=["finance"],
    dependencies=[Depends(require_owner)],
)


# Категории по умолчанию. Список редактируемый — это стартовый набор, а не
# закрытый перечень. `slug` заполнен, чтобы код находил «Закупку товара», куда
# автоматически падает оприходование прихода.
DEFAULT_EXPENSE_CATEGORIES: tuple[tuple[str, str], ...] = (
    ("purchase", "Закупка товара"),
    ("taxes", "Налоги"),
    ("rent", "Аренда"),
    ("utilities", "Коммунальные (свет, вода)"),
    ("salary", "Зарплата"),
    ("meals", "Питание"),
    ("transport", "Транспорт"),
    ("other", "Прочее"),
)

# Куда падает закупка товара при оприходовании прихода.
PURCHASE_SLUG = "purchase"


async def ensure_default_categories(session: AsyncSession) -> None:
    """Заводит стартовый набор категорий, если его ещё нет.

    Вызывается и при установке, и при первом обращении к разделу: установки,
    обновившиеся со старых версий, справочника ещё не имеют, а отправлять их
    владельца заполнять его руками — значит встретить пустой экран вместо
    раздела.
    """
    existing = set(
        (await session.execute(select(ExpenseCategory.name))).scalars().all()
    )
    added = False
    for order, (slug, name) in enumerate(DEFAULT_EXPENSE_CATEGORIES):
        if name in existing:
            continue
        session.add(ExpenseCategory(name=name, slug=slug, sort_order=order))
        added = True
    if added:
        await session.commit()


async def purchase_category_id(session: AsyncSession) -> int | None:
    """Категория «Закупка товара». Переименованную находим по slug."""
    row = (
        await session.execute(
            select(ExpenseCategory).where(ExpenseCategory.slug == PURCHASE_SLUG).limit(1)
        )
    ).scalar_one_or_none()
    return row.id if row else None


# --------------------------------------------------------------------------- #
# Справочник категорий                                                         #
# --------------------------------------------------------------------------- #


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    sort_order: int = 0
    is_active: bool = True


class CategoryOut(BaseModel):
    id: int
    name: str
    slug: str
    sort_order: int
    is_active: bool


@router.get("/expense-categories", response_model=list[CategoryOut])
async def list_expense_categories(
    include_hidden: bool = Query(default=False),
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[CategoryOut]:
    await ensure_default_categories(session)
    stmt = select(ExpenseCategory).order_by(ExpenseCategory.sort_order, ExpenseCategory.id)
    if not include_hidden:
        stmt = stmt.where(ExpenseCategory.is_active.is_(True))
    rows = (await session.execute(stmt)).scalars().all()
    return [
        CategoryOut(
            id=c.id, name=c.name, slug=c.slug, sort_order=c.sort_order, is_active=c.is_active
        )
        for c in rows
    ]


@router.post("/expense-categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
async def create_expense_category(
    payload: CategoryIn,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> CategoryOut:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Название категории не может быть пустым.")
    clash = (
        await session.execute(select(ExpenseCategory).where(ExpenseCategory.name == name))
    ).scalar_one_or_none()
    if clash:
        raise HTTPException(status_code=400, detail="Категория с таким названием уже есть.")
    category = ExpenseCategory(name=name, sort_order=payload.sort_order, is_active=payload.is_active)
    session.add(category)
    await session.commit()
    await session.refresh(category)
    return CategoryOut(
        id=category.id,
        name=category.name,
        slug=category.slug,
        sort_order=category.sort_order,
        is_active=category.is_active,
    )


@router.patch("/expense-categories/{category_id}", response_model=CategoryOut)
async def update_expense_category(
    category_id: int,
    payload: CategoryIn,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> CategoryOut:
    category = (
        await session.execute(select(ExpenseCategory).where(ExpenseCategory.id == category_id))
    ).scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Категория не найдена.")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Название категории не может быть пустым.")
    category.name = name
    category.sort_order = payload.sort_order
    category.is_active = payload.is_active
    await session.commit()
    await session.refresh(category)
    return CategoryOut(
        id=category.id,
        name=category.name,
        slug=category.slug,
        sort_order=category.sort_order,
        is_active=category.is_active,
    )


@router.delete("/expense-categories/{category_id}")
async def delete_expense_category(
    category_id: int,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> dict:
    """Удаляет категорию, а если по ней уже есть расходы — прячет.

    Стирать категорию вместе с историей нельзя: суммы прошлых месяцев после
    этого перестали бы сходиться, и объяснить владельцу, куда делись деньги,
    было бы нечем.
    """
    category = (
        await session.execute(select(ExpenseCategory).where(ExpenseCategory.id == category_id))
    ).scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Категория не найдена.")
    used = (
        await session.execute(
            select(func.count(Expense.id)).where(Expense.category_id == category_id)
        )
    ).scalar_one()
    if used:
        category.is_active = False
        await session.commit()
        return {"ok": True, "hidden": True, "expenses": int(used)}
    await session.delete(category)
    await session.commit()
    return {"ok": True, "hidden": False, "expenses": 0}


# --------------------------------------------------------------------------- #
# Расходы                                                                      #
# --------------------------------------------------------------------------- #


class ExpenseIn(BaseModel):
    category_id: int | None = None
    amount: float = Field(gt=0)
    note: str = Field(default="", max_length=512)
    # ISO-дата. Пусто — сегодня. Аренду за прошлый месяц заносят задним числом,
    # и в отчёт она обязана попасть своим месяцем.
    spent_at: str = ""


class ExpenseOut(BaseModel):
    id: int
    category_id: int | None
    category_name: str
    amount: float
    note: str
    source: str
    spent_at: str


def _expense_out(expense: Expense) -> ExpenseOut:
    return ExpenseOut(
        id=expense.id,
        category_id=expense.category_id,
        category_name=expense.category.name if expense.category else "Без категории",
        amount=round(float(expense.amount), 2),
        note=expense.note,
        source=expense.source,
        spent_at=expense.spent_at.isoformat() if expense.spent_at else "",
    )


def _parse_range(
    period: str, date_from: str | None, date_to: str | None
) -> tuple[datetime | None, datetime | None]:
    """Тот же разбор периода, что и в аналитике: цифры обязаны совпадать."""
    now = datetime.now()
    if date_from or date_to:
        start = datetime.fromisoformat(date_from) if date_from else None
        end = datetime.fromisoformat(date_to) if date_to else None
        return start, end
    if period == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0), None
    if period == "week":
        return now - timedelta(days=7), None
    if period == "month":
        return now - timedelta(days=30), None
    return None, None


@router.get("/expenses", response_model=list[ExpenseOut])
async def list_expenses(
    period: str = Query(default="month"),
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = Query(default=200, le=1000),
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[ExpenseOut]:
    start, end = _parse_range(period, date_from, date_to)
    stmt = (
        select(Expense)
        .options(selectinload(Expense.category))
        .order_by(Expense.spent_at.desc(), Expense.id.desc())
        .limit(limit)
    )
    if start:
        stmt = stmt.where(Expense.spent_at >= start)
    if end:
        stmt = stmt.where(Expense.spent_at <= end)
    rows = (await session.execute(stmt)).scalars().all()
    return [_expense_out(row) for row in rows]


@router.post("/expenses", response_model=ExpenseOut, status_code=status.HTTP_201_CREATED)
async def create_expense(
    payload: ExpenseIn,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> ExpenseOut:
    """Ручной расход. Пишется в журнал: это движение денег."""
    if payload.category_id is not None:
        exists = (
            await session.execute(
                select(ExpenseCategory.id).where(ExpenseCategory.id == payload.category_id)
            )
        ).scalar_one_or_none()
        if exists is None:
            raise HTTPException(status_code=400, detail="Категория расхода не найдена.")

    spent_at = datetime.now(UTC)
    if payload.spent_at.strip():
        try:
            spent_at = datetime.fromisoformat(payload.spent_at)
        except ValueError:
            raise HTTPException(status_code=400, detail="Не удалось разобрать дату расхода.")

    expense = Expense(
        category_id=payload.category_id,
        amount=payload.amount,
        note=payload.note.strip(),
        source="manual",
        spent_at=spent_at,
        user_id=user.id,
    )
    session.add(expense)
    await write_audit(
        session,
        actor=user,
        action="expense.created",
        target=payload.note.strip() or "расход без комментария",
        new_value=f"{payload.amount} · категория {payload.category_id}",
    )
    await session.commit()
    result = (
        await session.execute(
            select(Expense).options(selectinload(Expense.category)).where(Expense.id == expense.id)
        )
    ).scalar_one()
    return _expense_out(result)


@router.delete("/expenses/{expense_id}")
async def delete_expense(
    expense_id: int,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> dict:
    expense = (
        await session.execute(select(Expense).where(Expense.id == expense_id))
    ).scalar_one_or_none()
    if not expense:
        raise HTTPException(status_code=404, detail="Расход не найден.")
    if expense.source != "manual":
        # Закупка товара — обратная сторона прихода на склад. Удалить её
        # отдельно значит развести склад и деньги: товар на полке остался,
        # а расхода на него нет.
        raise HTTPException(
            status_code=400,
            detail="Этот расход создан приходом на склад. Отмените приход, а не расход.",
        )
    await write_audit(
        session,
        actor=user,
        action="expense.deleted",
        target=expense.note or "расход без комментария",
        old_value=f"{expense.amount} · категория {expense.category_id}",
    )
    await session.delete(expense)
    await session.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Сводка периода                                                               #
# --------------------------------------------------------------------------- #


class CategoryTotal(BaseModel):
    category_id: int | None
    name: str
    amount: float


class FinanceSummaryOut(BaseModel):
    """Все три цифры сразу — выбирает главную интерфейс, а не сервер."""

    revenue: float
    expenses: float
    profit: float
    by_category: list[CategoryTotal]


@router.get("/summary", response_model=FinanceSummaryOut)
async def finance_summary(
    period: str = Query(default="month"),
    date_from: str | None = None,
    date_to: str | None = None,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> FinanceSummaryOut:
    start, end = _parse_range(period, date_from, date_to)

    sales_stmt = select(func.coalesce(func.sum(Sale.total), 0.0)).where(
        Sale.status.notin_(["canceled"])
    )
    if start:
        sales_stmt = sales_stmt.where(Sale.created_at >= start)
    if end:
        sales_stmt = sales_stmt.where(Sale.created_at <= end)
    revenue = float((await session.execute(sales_stmt)).scalar_one() or 0.0)

    totals_stmt = (
        select(
            Expense.category_id,
            func.coalesce(ExpenseCategory.name, "Без категории"),
            func.coalesce(func.sum(Expense.amount), 0.0),
        )
        .outerjoin(ExpenseCategory, Expense.category_id == ExpenseCategory.id)
        .group_by(Expense.category_id, ExpenseCategory.name)
    )
    if start:
        totals_stmt = totals_stmt.where(Expense.spent_at >= start)
    if end:
        totals_stmt = totals_stmt.where(Expense.spent_at <= end)
    rows = (await session.execute(totals_stmt)).all()

    by_category = [
        CategoryTotal(category_id=cid, name=name, amount=round(float(amount), 2))
        for cid, name, amount in rows
    ]
    by_category.sort(key=lambda row: row.amount, reverse=True)
    expenses = round(sum(row.amount for row in by_category), 2)

    return FinanceSummaryOut(
        revenue=round(revenue, 2),
        expenses=expenses,
        profit=round(revenue - expenses, 2),
        by_category=by_category,
    )
