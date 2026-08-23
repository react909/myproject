"""Файлы фото и видео товара: где лежат, как попадают и как убираются.

ГЛАВНОЕ РЕШЕНИЕ: файлы на диске, в базе — только ссылка.

Пять фото и видео на товар при двадцати тысячах товаров — это десятки
гигабайт. В SQLite они превратили бы файл базы в неподъёмный: он копируется
целиком при каждой резервной копии, читается при каждом запросе к товару и
переносится при восстановлении. Касса при этом обязана отвечать мгновенно.

Лежат РЯДОМ с базой, а не в отдельном месте: так они попадают в ту же
резервную копию. База и картинки, разнесённые по разным папкам, рано или
поздно разъезжаются, и товар остаётся без фото.

Загрузка двухшаговая, и это единственный способ сохранить товар атомарно:

  1. файл кладётся во временную папку (`staged`), клиент получает токен;
  2. при сохранении товара запись в базе и ПЕРЕНОС файла в постоянную папку
     происходят внутри одной транзакции.

Оборвалось на середине — товара нет, в `staged` остался файл, который уберёт
`sweep_staged`. Обратный порядок (сначала товар, потом файлы) оставлял бы
товар без фото и без следа о том, что фото были.

Пережатия картинок здесь НЕТ намеренно. Уменьшение и сжатие делает интерфейс
через canvas — в проекте это уже есть. Питон обслуживает кассу, и грузить его
обработкой изображений ради экономии на одной зависимости нельзя.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
import shutil
import time
from dataclasses import dataclass
from pathlib import Path

from app.core.config import get_settings
from app.modules.products.imagemeta import MAX_SIDE_PX, MIN_SIDE_PX, is_video, sniff_image

logger = logging.getLogger("nurcrm.media")

#: Сколько фото и видео можно на один товар.
MAX_PHOTOS = 5
MAX_VIDEOS = 1

#: Потолки размера. Фото уже уменьшено интерфейсом, и пять мегабайт — это с
#: большим запасом; всё, что больше, означает, что уменьшение не сработало.
MAX_PHOTO_BYTES = 5 * 1024 * 1024
MAX_VIDEO_BYTES = 20 * 1024 * 1024

#: Предел длительности видео.
#:
#: ВАЖНО: СЕРВЕР ЕГО НЕ ПРОВЕРЯЕТ и проверить не может. Разобрать длительность
#: без ffmpeg нельзя, а тащить ffmpeg в установку ради одного числа — это
#: десятки мегабайт в инсталляторе и внешний двоичный файл в офлайновой кассе.
#:
#: Длительность меряет интерфейс (по элементу <video>) и присылает вместе с
#: файлом. Сервер сверяет присланное с этим потолком — то есть ловит честного
#: клиента, ошибшегося файлом, но НЕ ловит запрос в обход интерфейса. От
#: подделанного запроса защищают размер файла и проверка сигнатуры, а не это.
MAX_VIDEO_SECONDS = 30

PHOTO_MIMES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
VIDEO_MIMES = {"video/mp4": ".mp4", "video/webm": ".webm"}

#: Сколько живёт неприкаянный файл во временной папке.
STAGED_TTL_SECONDS = 6 * 3600

_SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")

#: Расширение спутника с данными о загруженном файле. Отдельной константой,
#: чтобы уборка не сочла его брошенным файлом и не убрала раньше времени.
META_SUFFIX = ".json"


class MediaError(Exception):
    """Файл не принят. Текст идёт человеку как есть."""


def media_root() -> Path:
    """Папка файлов — рядом с файлом базы, чтобы попасть в ту же копию."""
    root = Path(get_settings().sqlite_path).resolve().parent / "media" / "products"
    root.mkdir(parents=True, exist_ok=True)
    return root


def staged_root() -> Path:
    root = media_root() / "staged"
    root.mkdir(parents=True, exist_ok=True)
    return root


def safe_name(name: str) -> str:
    """Имя файла из базы — только то, что писали мы сами.

    Проверка не паранойя: имя приходит из строки таблицы, а строку может
    подменить кто угодно, у кого есть доступ к файлу базы. `../` в имени
    означал бы чтение любого файла на диске через открытый порт.
    """
    if not _SAFE_NAME.match(name or ""):
        raise MediaError("Недопустимое имя файла.")
    return name


def file_path(name: str) -> Path:
    return media_root() / safe_name(name)


@dataclass(frozen=True)
class StagedFile:
    """Загруженный, но ещё не привязанный к товару файл."""

    token: str
    kind: str  # photo|video
    mime: str
    bytes_size: int
    width: int
    height: int
    duration_ms: int

    @property
    def path(self) -> Path:
        return staged_root() / safe_name(self.token)


def check_upload(
    payload: bytes, *, kind: str, mime: str, duration_ms: int
) -> tuple[str, int, int]:
    """Принять файл или отказать. Возвращает расширение и размеры в точках.

    СЕРВЕР НЕ ВЕРИТ ТОМУ, ЧТО ЕМУ СКАЗАЛИ. Уменьшение и сжатие делает
    интерфейс, значит сюда приходят произвольные байты с произвольным `mime` в
    запросе. Проверяется поэтому не заявление, а сам файл:

      * сигнатура — это действительно картинка или видео названного типа;
      * размер в байтах;
      * размер в точках — картинка 30 000 × 30 000 весит немного сжатой, но
        при показе разворачивается в гигабайты памяти и кладёт каталог.

    Чего проверить НЕЛЬЗЯ — длительность видео: без ffmpeg сервер её не знает.
    Присланное значение сверяется с потолком, но это ловит только честную
    ошибку, а не подделанный запрос. См. MAX_VIDEO_SECONDS.
    """
    size = len(payload)
    if size == 0:
        raise MediaError("Пустой файл.")

    if kind == "photo":
        if mime not in PHOTO_MIMES:
            raise MediaError("Фото принимается в JPEG, PNG или WebP.")
        if size > MAX_PHOTO_BYTES:
            raise MediaError(f"Фото больше {MAX_PHOTO_BYTES // 1024 // 1024} МБ.")
        info = sniff_image(payload)
        if info is None:
            raise MediaError("Файл не похож на изображение.")
        if info.mime != mime:
            raise MediaError(f"Файл на самом деле {info.mime}, а не {mime}.")
        if info.width > MAX_SIDE_PX or info.height > MAX_SIDE_PX:
            raise MediaError(
                f"Изображение {info.width}×{info.height} — больше {MAX_SIDE_PX} точек по стороне."
            )
        if info.width < MIN_SIDE_PX or info.height < MIN_SIDE_PX:
            raise MediaError("Изображение слишком маленькое.")
        return PHOTO_MIMES[mime], info.width, info.height

    if kind == "video":
        if mime not in VIDEO_MIMES:
            raise MediaError("Видео принимается в MP4 или WebM.")
        if size > MAX_VIDEO_BYTES:
            raise MediaError(f"Видео больше {MAX_VIDEO_BYTES // 1024 // 1024} МБ.")
        if not is_video(payload, mime):
            raise MediaError("Файл не похож на видео.")
        # Заявленная интерфейсом длительность. Сервер её не измеряет.
        if duration_ms > MAX_VIDEO_SECONDS * 1000:
            raise MediaError(f"Видео длиннее {MAX_VIDEO_SECONDS} секунд.")
        return VIDEO_MIMES[mime], 0, 0

    raise MediaError("Неизвестный вид файла.")


def stage(payload: bytes, *, kind: str, mime: str, duration_ms: int) -> StagedFile:
    """Положить файл во временную папку и вернуть токен.

    Размеры в точках берутся ИЗ САМОГО ФАЙЛА, а не из запроса: присланные числа
    ничем не подтверждены, а по этим потом строится вёрстка списка.
    """
    extension, width, height = check_upload(
        payload, kind=kind, mime=mime, duration_ms=duration_ms
    )
    token = f"{secrets.token_hex(16)}{extension}"
    target = staged_root() / token
    target.write_bytes(payload)
    staged = StagedFile(
        token=token,
        kind=kind,
        mime=mime,
        bytes_size=len(payload),
        width=width,
        height=height,
        duration_ms=duration_ms,
    )
    # Спутник с уже проверенными данными: при привязке к товару их берут
    # отсюда, а не из нового запроса, которому верить нельзя.
    _meta_path(token).write_text(
        json.dumps(
            {
                "kind": staged.kind,
                "mime": staged.mime,
                "bytes_size": staged.bytes_size,
                "width": staged.width,
                "height": staged.height,
                "duration_ms": staged.duration_ms,
            }
        ),
        "utf-8",
    )
    return staged


def _meta_path(token: str) -> Path:
    return staged_root() / f"{safe_name(token)}.json"


def describe_staged(token: str) -> StagedFile:
    """Что за файл лежит во временной папке под этим токеном.

    Данные берутся из спутника — маленького JSON рядом с файлом, который
    пишется при загрузке. Почему не перечитать сам файл: тип и размеры из него
    вынуть можно, а ДЛИТЕЛЬНОСТЬ ВИДЕО — нет, её знает только тот, кто файл
    загружал. Спутник хранит уже проверенные значения, и повторно доверять
    запросу не приходится.
    """
    path = _meta_path(token)
    if not path.exists():
        raise MediaError("Загруженный файл не найден — повторите загрузку.")
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        raise MediaError("Загруженный файл повреждён — повторите загрузку.")
    return StagedFile(
        token=token,
        kind=str(data.get("kind", "photo")),
        mime=str(data.get("mime", "")),
        bytes_size=int(data.get("bytes_size", 0)),
        width=int(data.get("width", 0)),
        height=int(data.get("height", 0)),
        duration_ms=int(data.get("duration_ms", 0)),
    )


def promote(token: str) -> str:
    """Перенести файл из временной папки в постоянную. Возвращает имя.

    Перенос, а не копирование: файл уже на том же диске, и `rename` — это
    запись в каталог, а не чтение и запись двадцати мегабайт. На видео разница
    заметна.
    """
    source = staged_root() / safe_name(token)
    if not source.exists():
        raise MediaError("Загруженный файл не найден — повторите загрузку.")
    target = media_root() / token
    source.replace(target)
    # Спутник больше не нужен: данные уже в базе.
    _meta_path(token).unlink(missing_ok=True)
    return token


def remove(name: str) -> None:
    """Убрать файл. Отсутствие файла ошибкой не считается.

    Строка в базе и файл на диске могут разойтись: файл могли удалить руками
    или потерять при восстановлении из старой копии. Падать из-за этого при
    удалении товара нельзя — иначе товар станет неудаляемым.
    """
    try:
        file_path(name).unlink(missing_ok=True)
    except OSError:
        logger.exception("не удалось убрать файл %s", name)


def sweep_staged(now: float | None = None) -> int:
    """Убрать временные файлы, за которыми никто не пришёл.

    Каждый прерванный ввод товара оставляет здесь фото. Без уборки папка
    растёт молча, и заметят её через полгода по свободному месту на диске.
    """
    moment = now or time.time()
    removed = 0
    for item in staged_root().iterdir():
        if not item.is_file():
            continue
        try:
            if moment - item.stat().st_mtime > STAGED_TTL_SECONDS:
                item.unlink()
                # Спутник уходит вместе с файлом: оставшийся сам по себе, он
                # ссылался бы на то, чего нет.
                if not item.name.endswith(META_SUFFIX):
                    item.with_name(item.name + META_SUFFIX).unlink(missing_ok=True)
                removed += 1
        except OSError:
            logger.exception("не удалось убрать временный файл %s", item.name)
    if removed:
        logger.info("убрано временных файлов: %d", removed)
    return removed


def folder_size() -> tuple[int, int]:
    """Сколько файлов и сколько байт занимает папка. Для диагностики."""
    count = 0
    total = 0
    for item in media_root().rglob("*"):
        if item.is_file():
            count += 1
            total += item.stat().st_size
    return count, total


def reset_for_tests() -> None:
    """Стереть папку целиком. Только для тестов."""
    shutil.rmtree(media_root(), ignore_errors=True)
