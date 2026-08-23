"""Приём безналичной оплаты.

Через сервер идёт только динамический QR, и на то три причины: мерчант-ключ не
должен попадать в интерфейс и в localStorage; банковский API не принимает
запросы со страницы, открытой из файла; статус платежа надо опрашивать даже
когда экран оплаты закрыли.

Наличные и статический QR сюда не обращаются вовсе — они работают офлайн, и
это принципиально: касса обязана продавать при мёртвом интернете.

Про контракт с банком. Реализован обобщённый REST-адаптер: запросы и разбор
ответа описаны ниже одним местом. Боевые адреса, заголовки и имена полей
выдаёт банк вместе с договором — подставить их за него нельзя, иначе касса
молча стучалась бы не туда. Пока провайдер не настроен, запрос честно
завершается ошибкой, и кассир уходит на другой способ оплаты.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access import require_owner, require_specialist
from app.core.security import get_current_user
from app.db.database import get_db_session
from app.db.models import (
    PaymentEvent,
    PaymentIntent,
    PaymentSecret,
    Sale,
    StoreSettings,
    User,
)

router = APIRouter(prefix="/api/payments", tags=["payments"])

# Банк отвечает за секунды; больше ждать нельзя — за кассой стоит покупатель.
BANK_TIMEOUT_SECONDS = 8.0


class CreateIntentRequest(BaseModel):
    provider_id: str = Field(min_length=1, max_length=64)
    amount: float = Field(gt=0)
    order_id: str = Field(min_length=1, max_length=64)


class CreateIntentResponse(BaseModel):
    payment_id: str
    qr_payload: str | None = None
    deeplink: str | None = None
    reference: str | None = None
    expires_in_seconds: int | None = None


class IntentStatusResponse(BaseModel):
    status: str
    reference: str | None = None


class SecretRequest(BaseModel):
    api_key: str = Field(min_length=1, max_length=512)


class PaymentEventRequest(BaseModel):
    provider_id: str = Field(max_length=64)
    order_id: str = Field(max_length=64)
    amount: float = Field(ge=0)
    event: str = Field(pattern="^(canceled|timeout)$")


async def _store(session: AsyncSession) -> StoreSettings:
    row = (await session.execute(select(StoreSettings).limit(1))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=400, detail="Магазин ещё не настроен.")
    return row


def _provider_config(store: StoreSettings, provider_id: str) -> dict:
    """Настройка провайдера из реквизитов магазина.

    Список провайдеров хранится там же, где остальной онбординг: он часть
    настройки магазина, а не отдельная сущность со своей жизнью.
    """
    try:
        onboarding = json.loads(store.payment_providers or "[]")
    except json.JSONDecodeError:
        onboarding = []
    for item in onboarding:
        if item.get("id") == provider_id:
            return item
    raise HTTPException(status_code=404, detail=f"Способ оплаты «{provider_id}» не настроен.")


async def _secret(session: AsyncSession, provider_id: str) -> str:
    row = (
        await session.execute(select(PaymentSecret).where(PaymentSecret.provider_id == provider_id))
    ).scalar_one_or_none()
    if row is None or not row.api_key:
        raise HTTPException(
            status_code=400,
            detail="Мерчант-ключ не задан. Укажите его в разделе «Реквизиты» или примите оплату иначе.",
        )
    return row.api_key


def _normalize_status(raw: object) -> str:
    """Приводит ответ банка к нашим четырём состояниям.

    Неизвестный ответ — это `pending`, а не `paid`: закрыть чек по чужому
    словарю значит отдать товар без денег.
    """
    value = str(raw or "").strip().lower()
    if value in {"paid", "success", "succeeded", "approved", "completed"}:
        return "paid"
    if value in {"failed", "declined", "error", "rejected"}:
        return "failed"
    if value in {"canceled", "cancelled", "expired"}:
        return "canceled"
    return "pending"


@router.post("/intents", response_model=CreateIntentResponse, status_code=status.HTTP_201_CREATED)
async def create_intent(
    payload: CreateIntentRequest,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
) -> CreateIntentResponse:
    store = await _store(session)
    config = _provider_config(store, payload.provider_id)
    if config.get("kind") != "qr-dynamic":
        raise HTTPException(status_code=400, detail="Этот способ оплаты не требует запроса к банку.")

    base_url = (config.get("baseUrl") or "").strip().rstrip("/")
    merchant_id = (config.get("merchantId") or "").strip()
    if not base_url or not merchant_id:
        raise HTTPException(
            status_code=400,
            detail="Для этого банка не заданы адрес API или идентификатор мерчанта.",
        )
    api_key = await _secret(session, payload.provider_id)

    payment_id = uuid.uuid4().hex
    # Сумма уходит в минимальных единицах: дробь по дороге теряется у всех.
    body = {
        "merchantId": merchant_id,
        "amount": int(round(payload.amount * 100)),
        "currency": store.currency or "KGS",
        "orderId": payload.order_id,
        "paymentId": payment_id,
    }

    try:
        async with httpx.AsyncClient(timeout=BANK_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{base_url}/payments",
                json=body,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Банк недоступен: {error}. Примите оплату другим способом.",
        ) from error

    qr_payload = data.get("qrPayload") or data.get("payload") or data.get("qr")
    if not qr_payload:
        raise HTTPException(status_code=502, detail="Банк не вернул QR-payload.")

    intent = PaymentIntent(
        payment_id=payment_id,
        provider_id=payload.provider_id,
        order_id=payload.order_id,
        amount=payload.amount,
        status="pending",
        reference=str(data.get("reference") or data.get("id") or ""),
        user_id=user.id,
        created_at=datetime.now(UTC),
    )
    session.add(intent)
    await session.commit()

    return CreateIntentResponse(
        payment_id=payment_id,
        qr_payload=str(qr_payload),
        deeplink=data.get("deeplink"),
        reference=intent.reference or None,
        expires_in_seconds=data.get("expiresIn"),
    )


@router.get("/intents/{payment_id}", response_model=IntentStatusResponse)
async def get_intent_status(
    payment_id: str,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> IntentStatusResponse:
    intent = (
        await session.execute(select(PaymentIntent).where(PaymentIntent.payment_id == payment_id))
    ).scalar_one_or_none()
    if intent is None:
        raise HTTPException(status_code=404, detail="Платёж не найден.")
    # Окончательный статус повторно у банка не спрашиваем.
    if intent.status != "pending":
        return IntentStatusResponse(status=intent.status, reference=intent.reference or None)

    store = await _store(session)
    config = _provider_config(store, intent.provider_id)
    base_url = (config.get("baseUrl") or "").strip().rstrip("/")
    api_key = await _secret(session, intent.provider_id)

    try:
        async with httpx.AsyncClient(timeout=BANK_TIMEOUT_SECONDS) as client:
            response = await client.get(
                f"{base_url}/payments/{payment_id}",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError:
        # Обрыв связи не меняет состояния платежа: касса продолжит опрашивать,
        # а по таймауту кассир отменит вручную.
        return IntentStatusResponse(status="pending", reference=intent.reference or None)

    intent.status = _normalize_status(data.get("status"))
    reference = data.get("reference")
    if reference:
        intent.reference = str(reference)
    if intent.status != "pending":
        intent.settled_at = datetime.now(UTC)
    await session.commit()
    return IntentStatusResponse(status=intent.status, reference=intent.reference or None)


@router.post("/intents/{payment_id}/cancel")
async def cancel_intent(
    payment_id: str,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> dict:
    intent = (
        await session.execute(select(PaymentIntent).where(PaymentIntent.payment_id == payment_id))
    ).scalar_one_or_none()
    if intent is None:
        return {"ok": True}

    store = await _store(session)
    config = _provider_config(store, intent.provider_id)
    base_url = (config.get("baseUrl") or "").strip().rstrip("/")
    if base_url and intent.status == "pending":
        try:
            api_key = await _secret(session, intent.provider_id)
            async with httpx.AsyncClient(timeout=BANK_TIMEOUT_SECONDS) as client:
                await client.post(
                    f"{base_url}/payments/{payment_id}/cancel",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
        except (httpx.HTTPError, HTTPException):
            # Банк мог закрыть платёж сам — для кассы он всё равно отменён.
            pass

    intent.status = "canceled"
    intent.settled_at = datetime.now(UTC)
    session.add(
        PaymentEvent(
            provider_id=intent.provider_id,
            order_id=intent.order_id,
            amount=intent.amount,
            event="canceled",
            created_at=datetime.now(UTC),
        )
    )
    await session.commit()
    return {"ok": True}


@router.post("/events", status_code=status.HTTP_201_CREATED)
async def record_event(
    payload: PaymentEventRequest,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(get_current_user),
) -> dict:
    """Отменённые и просроченные попытки оплаты.

    Без этой записи отменённый QR не оставляет следа, и разобраться, почему
    покупатель ушёл без чека, потом нечем.
    """
    session.add(
        PaymentEvent(
            provider_id=payload.provider_id,
            order_id=payload.order_id,
            amount=payload.amount,
            event=payload.event,
            created_at=datetime.now(UTC),
        )
    )
    await session.commit()
    return {"ok": True}


@router.get("/manual-confirmations")
async def manual_confirmations(
    days: int = 30,
    session: AsyncSession = Depends(get_db_session),
    # Отчёт о деньгах и о работе кассиров — дверь владельца.
    _: User = Depends(require_owner),
) -> dict:
    """Продажи, где оплату подтвердил кассир, а не банк.

    Это отчёт про конкретный риск: при статическом QR кассир принимает
    решение по экрану чужого телефона, и скриншот чужого платежа отличить
    нельзя. Отдельного места, где такие продажи видны рядом, до сих пор не
    было — а без него разговор про переход на динамический QR не на чем
    строить.
    """
    since = datetime.now(UTC) - timedelta(days=max(1, min(365, days)))
    rows = (
        (
            await session.execute(
                select(Sale)
                .where(
                    Sale.created_at >= since,
                    Sale.payment_confirmation == "manual",
                    # Наличные подтверждает кассир по определению — риска здесь
                    # нет, деньги уже в ящике.
                    Sale.payment_method != "cash",
                    Sale.payment_method != "debt",
                )
                .order_by(Sale.created_at.desc())
                .limit(500)
            )
        )
        .scalars()
        .all()
    )

    total = sum(float(row.total) for row in rows)
    events = (
        (
            await session.execute(
                select(PaymentEvent)
                .where(PaymentEvent.created_at >= since)
                .order_by(PaymentEvent.created_at.desc())
                .limit(200)
            )
        )
        .scalars()
        .all()
    )

    return {
        "since": since.isoformat(),
        "count": len(rows),
        "total": round(total, 2),
        "sales": [
            {
                "id": row.id,
                "doc_number": row.doc_number,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "cashier_name": row.cashier_name,
                "total": float(row.total),
                "provider": row.payment_provider_title or row.payment_provider,
                "payment_ref": row.payment_ref,
            }
            for row in rows
        ],
        "canceled_attempts": [
            {
                "created_at": item.created_at.isoformat() if item.created_at else None,
                "provider_id": item.provider_id,
                "order_id": item.order_id,
                "amount": float(item.amount),
                "event": item.event,
            }
            for item in events
        ],
    }


@router.get("/providers/secrets")
async def list_secret_flags(
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(require_specialist),
) -> dict:
    """Какие ключи заданы. Сами ключи наружу не отдаются никогда.

    Эквайринг настраивает специалист, поэтому и флаги за его дверью: кассиру
    знать, у какого банка заведён мерчант-ключ, незачем.
    """
    rows = (await session.execute(select(PaymentSecret))).scalars().all()
    return {"secrets": {row.provider_id: bool(row.api_key) for row in rows}}


@router.put("/providers/{provider_id}/secret")
async def set_secret(
    provider_id: str,
    payload: SecretRequest,
    session: AsyncSession = Depends(get_db_session),
    _: User = Depends(require_specialist),
) -> dict:
    row = (
        await session.execute(select(PaymentSecret).where(PaymentSecret.provider_id == provider_id))
    ).scalar_one_or_none()
    if row is None:
        row = PaymentSecret(provider_id=provider_id)
        session.add(row)
    row.api_key = payload.api_key
    row.updated_at = datetime.now(UTC)
    await session.commit()
    return {"ok": True}
