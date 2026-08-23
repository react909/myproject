"""Картинки установки — в свою таблицу, байтами.

Логотипы и снимки QR лежали строками base64 прямо в реквизитах: интерфейсный
знак и четыре его размера, чековый знак со своими вариантами, плюс по снимку на
каждый способ оплаты внутри JSON провайдеров. Один знак 512×512 — это порядка
200 КБ текста; строка настроек разрасталась до мегабайтов, и её целиком тянул
каждый запрос реквизитов, включая те, где нужен один телефон.

Здесь заводится таблица store_images: вид (logo_ui | logo_receipt | qr), слот
(размер или идентификатор способа оплаты), тип содержимого и сами байты. Данные
переносятся из колонок и из JSON провайдеров, колонки после переноса чистятся —
держать одну и ту же картинку в двух местах значит однажды напечатать старую.

Байтами, а не файлами на диске: файл не попадает в резервную копию базы, не
переживает переустановку и не реплицируется на вторую кассу.

Revision ID: 0019
Revises: 0018
Create Date: 2026-08-15

"""
from __future__ import annotations

import base64
import json
import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DATA_URL = re.compile(r"^data:(?P<mime>[\w.+/-]+);base64,(?P<payload>.*)$", re.DOTALL)


def _decode(value: str | None) -> tuple[str, bytes] | None:
    match = _DATA_URL.match((value or "").strip())
    if not match:
        return None
    try:
        payload = base64.b64decode(match.group("payload"), validate=False)
    except (ValueError, TypeError):
        return None
    return (match.group("mime"), payload) if payload else None


def _variant(raw: str | None, key: str) -> str:
    """Достаёт один размер из JSON с вариантами логотипа."""
    try:
        parsed = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return ""
    return parsed.get(key, "") if isinstance(parsed, dict) else ""


def upgrade() -> None:
    images = op.create_table(
        "store_images",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("slot", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("mime", sa.String(length=64), nullable=False, server_default="image/png"),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("kind", "slot", name="uq_store_images_kind_slot"),
    )

    bind = op.get_bind()
    row = bind.execute(
        sa.text(
            "SELECT logo_image, logo_mark, logo_variants, receipt_logo_file,"
            " receipt_logo_mark, receipt_logo_variants, payment_providers"
            " FROM store_settings LIMIT 1"
        )
    ).fetchone()
    if row is None:
        return

    (
        logo_image,
        logo_mark,
        logo_variants,
        receipt_file,
        receipt_mark,
        receipt_variants,
        providers_raw,
    ) = row

    payload: list[tuple[str, str, str]] = [
        ("logo_ui", "main", logo_image),
        ("logo_ui", "mark", logo_mark),
        ("logo_ui", "s512", _variant(logo_variants, "s512")),
        ("logo_ui", "s128", _variant(logo_variants, "s128")),
        ("logo_ui", "s64", _variant(logo_variants, "s64")),
        ("logo_ui", "receipt", _variant(logo_variants, "receipt")),
        ("logo_receipt", "file", receipt_file),
        ("logo_receipt", "mark", receipt_mark),
        ("logo_receipt", "w384", _variant(receipt_variants, "w384")),
        ("logo_receipt", "w288", _variant(receipt_variants, "w288")),
    ]

    # Снимки QR лежали внутри JSON способов оплаты — вынимаем их оттуда же.
    cleaned_providers: list[dict] | None = None
    try:
        providers = json.loads(providers_raw or "[]")
    except json.JSONDecodeError:
        providers = []
    if isinstance(providers, list):
        cleaned_providers = []
        for provider in providers:
            if not isinstance(provider, dict):
                continue
            item = dict(provider)
            image = item.pop("imageDataUrl", "")
            provider_id = str(item.get("id") or "")
            if provider_id and isinstance(image, str) and image:
                payload.append(("qr", provider_id, image))
            cleaned_providers.append(item)

    rows = []
    for kind, slot, value in payload:
        decoded = _decode(value)
        if decoded is None:
            continue
        mime, data = decoded
        rows.append({"kind": kind, "slot": slot, "mime": mime, "data": data})
    if rows:
        op.bulk_insert(images, rows)

    # Колонки чистим только после успешного переноса.
    bind.execute(
        sa.text(
            "UPDATE store_settings SET logo_image = '', logo_mark = '',"
            " logo_variants = '{}', receipt_logo_file = '', receipt_logo_mark = '',"
            " receipt_logo_variants = '{}'"
        )
    )
    if cleaned_providers is not None:
        bind.execute(
            sa.text("UPDATE store_settings SET payment_providers = :value"),
            {"value": json.dumps(cleaned_providers, ensure_ascii=False)},
        )


def downgrade() -> None:
    """Возвращает картинки обратно в колонки и убирает таблицу."""
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT kind, slot, mime, data FROM store_images")).fetchall()
    by_key = {
        (kind, slot): f"data:{mime};base64," + base64.b64encode(data).decode("ascii")
        for kind, slot, mime, data in rows
    }
    bind.execute(
        sa.text(
            "UPDATE store_settings SET logo_image = :logo, logo_mark = :mark,"
            " logo_variants = :variants, receipt_logo_file = :file,"
            " receipt_logo_mark = :receipt_mark, receipt_logo_variants = :receipt_variants"
        ),
        {
            "logo": by_key.get(("logo_ui", "main"), ""),
            "mark": by_key.get(("logo_ui", "mark"), ""),
            "variants": json.dumps(
                {
                    "s512": by_key.get(("logo_ui", "s512"), ""),
                    "s128": by_key.get(("logo_ui", "s128"), ""),
                    "s64": by_key.get(("logo_ui", "s64"), ""),
                    "receipt": by_key.get(("logo_ui", "receipt"), ""),
                }
            ),
            "file": by_key.get(("logo_receipt", "file"), ""),
            "receipt_mark": by_key.get(("logo_receipt", "mark"), ""),
            "receipt_variants": json.dumps(
                {
                    "w384": by_key.get(("logo_receipt", "w384"), ""),
                    "w288": by_key.get(("logo_receipt", "w288"), ""),
                }
            ),
        },
    )
    op.drop_table("store_images")
