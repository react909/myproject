"""Хранилище картинок установки: логотипы и снимки QR.

Картинки живут в своей таблице байтами (см. StoreImage), а реквизиты хранят
только ссылку — вид и слот. Наружу, в интерфейс и в печать, они по-прежнему
уходят как data URL: чек печатается синхронно, в момент оплаты, и ходить за
картинкой отдельным запросом там нельзя.

Работа с сессией собрана здесь, а раскладка реквизитов по колонкам (schema.py)
остаётся чистой функцией: она получает уже вынутые картинки и складывает в них
новые. Иначе каждый вызов маппера пришлось бы делать асинхронным.
"""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import StoreImage

# logo_ui — картинки шапки приложения, logo_receipt — для ленты, qr — снимок
# способа оплаты.
KIND_LOGO_UI = "logo_ui"
KIND_LOGO_RECEIPT = "logo_receipt"
KIND_QR = "qr"

# Три сущности шапки приложения: знак, надпись и единая картинка, где знак и
# надпись уже сведены вместе. Все три — свой слот вида logo_ui, а не свой вид:
# знак уже лежит в слоте `mark` с миграции 0019, и заводить под него второй вид
# значило бы держать одну и ту же картинку в двух местах. Слоты — это и есть
# адрес картинки, менять их в одном месте нельзя.
SLOT_MARK = "mark"
SLOT_WORDMARK = "wordmark"
SLOT_COMBINED = "combined"

_DATA_URL = re.compile(r"^data:(?P<mime>[\w.+/-]+);base64,(?P<payload>.*)$", re.DOTALL)

DEFAULT_MIME = "image/png"


def parse_data_url(value: str) -> tuple[str, bytes] | None:
    """Разбирает data URL в пару «тип, байты». None — это не картинка."""
    match = _DATA_URL.match((value or "").strip())
    if not match:
        return None
    try:
        payload = base64.b64decode(match.group("payload"), validate=False)
    except (ValueError, TypeError):
        return None
    if not payload:
        return None
    return match.group("mime"), payload


def to_data_url(mime: str, data: bytes) -> str:
    if not data:
        return ""
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime or DEFAULT_MIME};base64,{encoded}"


@dataclass
class ImageBag:
    """Картинки установки, вынутые из базы в память.

    Отдельный «мешок» нужен, чтобы маппер реквизитов остался синхронным: он
    читает и пишет картинки здесь, а поход в базу делает вызывающий — до и
    после раскладки.
    """

    items: dict[tuple[str, str], str] = field(default_factory=dict)
    # Что менялось за время работы — по этому списку сохранение понимает, какие
    # строки трогать. Без него пришлось бы переписывать все картинки на каждую
    # правку реквизитов, а это мегабайты записи ради смены телефона.
    touched: set[tuple[str, str]] = field(default_factory=set)

    def get(self, kind: str, slot: str) -> str:
        return self.items.get((kind, slot), "")

    def set(self, kind: str, slot: str, data_url: str) -> None:
        key = (kind, slot)
        value = (data_url or "").strip()
        if self.items.get(key, "") == value:
            return
        if value:
            self.items[key] = value
        else:
            self.items.pop(key, None)
        self.touched.add(key)

    def slots(self, kind: str) -> list[str]:
        return [slot for (item_kind, slot) in self.items if item_kind == kind]


async def load_images(session: AsyncSession) -> ImageBag:
    """Достаёт все картинки установки. Их немного: логотипы и по одной на QR."""
    rows = (await session.execute(select(StoreImage))).scalars().all()
    bag = ImageBag()
    for row in rows:
        bag.items[(row.kind, row.slot)] = to_data_url(row.mime, row.data)
    return bag


async def save_images(session: AsyncSession, bag: ImageBag) -> None:
    """Записывает только изменённые картинки; опустевшие — удаляет."""
    if not bag.touched:
        return
    rows = (await session.execute(select(StoreImage))).scalars().all()
    existing = {(row.kind, row.slot): row for row in rows}

    for kind, slot in bag.touched:
        value = bag.items.get((kind, slot), "")
        row = existing.get((kind, slot))
        parsed = parse_data_url(value) if value else None
        if parsed is None:
            # Картинку убрали или прислали мусор вместо data URL — строки быть
            # не должно: пустая запись в таблице картинок ничем не лучше её
            # отсутствия, а читателю пришлось бы её отфильтровывать.
            if row is not None:
                await session.delete(row)
            continue
        mime, data = parsed
        if row is None:
            session.add(StoreImage(kind=kind, slot=slot, mime=mime, data=data))
        else:
            row.mime = mime
            row.data = data
    bag.touched.clear()
