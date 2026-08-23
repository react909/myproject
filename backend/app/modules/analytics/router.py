from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.access import require_owner
from app.core.security import get_current_user
from app.db.database import get_db_session
from app.db.models import Product, Sale, SaleItem, User

"""Аналитика — тоже дверь владельца: выручка, прибыль, топ товаров.

Проверка на маршрутизаторе целиком, как у финансов: сводки не должны приезжать
кассиру «на всякий случай», даже если интерфейс их не покажет.
"""
router = APIRouter(
    prefix="/api/analytics",
    tags=["analytics"],
    dependencies=[Depends(require_owner)],
)


class SummaryOut(BaseModel):
    revenue: float
    sales_count: int
    avg_check: float
    debt_total: float
    profit: float
    sold_qty: float


class ProductStat(BaseModel):
    product_id: int | None
    name: str
    sold_qty: float
    revenue: float
    profit: float


class DayStat(BaseModel):
    date: str
    revenue: float
    sales_count: int


def _parse_range(period: str, date_from: str | None, date_to: str | None) -> tuple[datetime | None, datetime | None]:
    now = datetime.now()
    if date_from or date_to:
        start = datetime.fromisoformat(date_from) if date_from else None
        end = datetime.fromisoformat(date_to) if date_to else None
        return start, end
    if period == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return start, None
    if period == "week":
        return now - timedelta(days=7), None
    if period == "month":
        return now - timedelta(days=30), None
    return None, None


@router.get("/summary", response_model=SummaryOut)
async def summary(
    period: str = Query(default="month"),
    date_from: str | None = None,
    date_to: str | None = None,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> SummaryOut:
    start, end = _parse_range(period, date_from, date_to)
    stmt = select(Sale).options(selectinload(Sale.items)).where(Sale.status.notin_(["canceled"]))
    if start:
        stmt = stmt.where(Sale.created_at >= start)
    if end:
        stmt = stmt.where(Sale.created_at <= end)
    sales = (await session.execute(stmt)).scalars().all()

    revenue = sum(float(s.total) for s in sales if s.status != "debt" or s.debt_balance < s.total)
    # count paid+debt+refund statuses that represent real sales
    sales_count = len([s for s in sales if s.status != "canceled"])
    debt_total = sum(float(s.debt_balance) for s in sales if s.status == "debt")
    profit = 0.0
    sold_qty = 0.0
    for s in sales:
        for item in s.items:
            cost = float(item.cost_price) * float(item.quantity)
            profit += float(item.line_total) - cost
            sold_qty += float(item.quantity)
    avg = revenue / sales_count if sales_count else 0
    return SummaryOut(
        revenue=round(revenue, 2),
        sales_count=sales_count,
        avg_check=round(avg, 2),
        debt_total=round(debt_total, 2),
        profit=round(profit, 2),
        sold_qty=round(sold_qty, 3),
    )


@router.get("/products", response_model=list[ProductStat])
async def product_stats(
    period: str = Query(default="month"),
    limit: int = Query(default=50, le=200),
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[ProductStat]:
    start, end = _parse_range(period, None, None)
    stmt = select(Sale).options(selectinload(Sale.items)).where(Sale.status.notin_(["canceled"]))
    if start:
        stmt = stmt.where(Sale.created_at >= start)
    if end:
        stmt = stmt.where(Sale.created_at <= end)
    sales = (await session.execute(stmt)).scalars().all()

    agg: dict[str, dict] = {}
    for s in sales:
        for item in s.items:
            key = str(item.product_id) if item.product_id else f"adhoc:{item.name}"
            bucket = agg.setdefault(
                key,
                {"product_id": item.product_id, "name": item.name, "sold_qty": 0.0, "revenue": 0.0, "profit": 0.0},
            )
            bucket["sold_qty"] += float(item.quantity)
            bucket["revenue"] += float(item.line_total)
            bucket["profit"] += float(item.line_total) - float(item.cost_price) * float(item.quantity)

    rows = sorted(agg.values(), key=lambda x: x["revenue"], reverse=True)[:limit]
    return [
        ProductStat(
            product_id=r["product_id"],
            name=r["name"],
            sold_qty=round(r["sold_qty"], 3),
            revenue=round(r["revenue"], 2),
            profit=round(r["profit"], 2),
        )
        for r in rows
    ]


@router.get("/daily", response_model=list[DayStat])
async def daily_stats(
    days: int = Query(default=14, le=90),
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[DayStat]:
    start = datetime.now() - timedelta(days=days)
    sales = (
        await session.execute(
            select(Sale).where(Sale.created_at >= start, Sale.status.notin_(["canceled"]))
        )
    ).scalars().all()
    by_day: dict[str, dict] = defaultdict(lambda: {"revenue": 0.0, "sales_count": 0})
    for s in sales:
        key = s.created_at.date().isoformat() if s.created_at else "unknown"
        by_day[key]["revenue"] += float(s.total)
        by_day[key]["sales_count"] += 1
    return [
        DayStat(date=k, revenue=round(v["revenue"], 2), sales_count=v["sales_count"])
        for k, v in sorted(by_day.items())
    ]


@router.get("/low-stock")
async def low_stock(
    threshold: float = Query(default=5),
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[dict]:
    rows = (
        await session.execute(
            select(Product).where(
                Product.is_active.is_(True),
                Product.kind != "service",
                Product.stock_qty <= threshold,
            ).order_by(Product.stock_qty)
        )
    ).scalars().all()
    return [
        {"id": p.id, "name": p.name, "stock_qty": p.stock_qty, "unit": p.unit, "kind": p.kind}
        for p in rows
    ]
