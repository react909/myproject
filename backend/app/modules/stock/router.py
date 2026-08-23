from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_db_session
from app.db.models import Expense, Product, StockMove, User
from app.modules.finance.router import ensure_default_categories, purchase_category_id

router = APIRouter(prefix="/api/stock", tags=["stock"])


class StockAdjustRequest(BaseModel):
    product_id: int
    qty_delta: float
    note: str = ""
    # Себестоимость единицы для прихода. Пусто — берётся из карточки товара.
    # Приход по новой цене случается постоянно, и заставлять владельца сперва
    # править карточку значит получить расход по старой цене.
    unit_cost: float | None = None


class StockMoveOut(BaseModel):
    id: int
    product_id: int
    product_name: str | None = None
    qty_delta: float
    reason: str
    note: str
    created_at: str


@router.post("/adjust", status_code=status.HTTP_201_CREATED)
async def adjust_stock(
    payload: StockAdjustRequest,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> dict:
    """Приход или списание товара.

    Приход — это ещё и расход денег, поэтому вместе с движением по складу
    заводится запись в «Закупку товара». Требовать, чтобы владелец продублировал
    её руками в разделе «Финансы», значит гарантированно получить расхождение:
    товар на полке будет, а денег за него в отчёте — нет.

    Расход пишется независимо от режима аналитики: режим определяет, какая
    цифра главная на дашборде, а не что попадает в базу.
    """
    product = (
        await session.execute(select(Product).where(Product.id == payload.product_id))
    ).scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Товар не найден.")
    if product.kind == "service":
        raise HTTPException(status_code=400, detail="У услуги нет остатка.")
    product.stock_qty = float(product.stock_qty) + float(payload.qty_delta)
    move = StockMove(
        product_id=product.id,
        qty_delta=payload.qty_delta,
        reason="purchase" if payload.qty_delta > 0 else "adjust",
        ref_type="manual",
        note=payload.note,
        user_id=user.id,
    )
    session.add(move)
    await session.flush()

    unit_cost = (
        float(payload.unit_cost) if payload.unit_cost is not None else float(product.cost_price)
    )
    expense_amount = round(float(payload.qty_delta) * unit_cost, 2)
    # Списание расходом не является, и приход по нулевой себестоимости тоже:
    # запись на ноль сом только замусорила бы отчёт.
    if payload.qty_delta > 0 and expense_amount > 0:
        await ensure_default_categories(session)
        session.add(
            Expense(
                category_id=await purchase_category_id(session),
                amount=expense_amount,
                note=f"Приход: {product.name}",
                source="purchase",
                ref_type="stock_move",
                ref_id=str(move.id),
                user_id=user.id,
            )
        )

    await session.commit()
    return {"ok": True, "stock_qty": product.stock_qty, "expense": expense_amount}


@router.get("/moves", response_model=list[StockMoveOut])
async def list_moves(
    product_id: int | None = None,
    limit: int = 100,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> list[StockMoveOut]:
    stmt = (
        select(StockMove, Product.name)
        .outerjoin(Product, StockMove.product_id == Product.id)
        .order_by(StockMove.id.desc())
        .limit(min(limit, 500))
    )
    if product_id is not None:
        stmt = stmt.where(StockMove.product_id == product_id)
    rows = (await session.execute(stmt)).all()
    return [
        StockMoveOut(
            id=m.id,
            product_id=m.product_id,
            product_name=name,
            qty_delta=m.qty_delta,
            reason=m.reason,
            note=m.note,
            created_at=m.created_at.isoformat() if m.created_at else "",
        )
        for m, name in rows
    ]
