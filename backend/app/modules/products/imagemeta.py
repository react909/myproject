"""Что это за файл на самом деле — по его первым байтам.

Зачем это здесь. Уменьшение и сжатие картинок делает интерфейс, а сервер
принимает готовые байты. Значит СЕРВЕР НЕ МОЖЕТ ВЕРИТЬ ТОМУ, ЧТО ЕМУ СКАЗАЛИ:
`mime` приходит из запроса, а запрос можно послать любой. Без проверки в папку
рядом с базой лёг бы файл произвольного содержания, и первый же показ каталога
на нём споткнулся бы.

Проверяется три вещи:

  * сигнатура — файл действительно того типа, каким назвался;
  * размер в байтах — снаружи, в media.py;
  * размер в точках — здесь: картинка на 30 000 × 30 000 весит немного в
    сжатом виде, но при показе разворачивается в гигабайты памяти.

Без Pillow и без ffmpeg. Заголовки этих форматов простые, и читать их дешевле,
чем тащить в установку библиотеку обработки изображений: она нужна была бы
ровно ради двух чисел.

Длительность видео здесь НЕ определяется. Честно: без ffmpeg сервер её не
знает. Её проверяет интерфейс, а сервер ограничивает только тип и размер — так
и написано в отчёте, чтобы никто не рассчитывал на проверку, которой нет.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

#: Больше этого по любой стороне не принимаем. Интерфейс уменьшает до ~1200,
#: так что запас четырёхкратный: всё, что выше, — это сбой уменьшения или
#: запрос в обход интерфейса.
MAX_SIDE_PX = 5000

#: Ниже этого картинка бессмысленна: скорее всего прислали обрезок.
MIN_SIDE_PX = 8


@dataclass(frozen=True)
class ImageInfo:
    mime: str
    width: int
    height: int


def sniff_image(payload: bytes) -> ImageInfo | None:
    """Тип и размеры картинки по заголовку. `None` — это не картинка."""
    if len(payload) < 16:
        return None
    if payload.startswith(b"\x89PNG\r\n\x1a\n"):
        return _png(payload)
    if payload.startswith(b"\xff\xd8"):
        return _jpeg(payload)
    if payload[:4] == b"RIFF" and payload[8:12] == b"WEBP":
        return _webp(payload)
    return None


def is_video(payload: bytes, mime: str) -> bool:
    """Похож ли файл на видео заявленного типа.

    Проверка грубая — сигнатура контейнера, не разбор потока. Разобрать поток
    без ffmpeg нельзя, и притворяться, что мы это делаем, не нужно: сигнатура
    отсекает подсунутый исполняемый файл или архив, а больше от неё здесь
    ничего и не требуется.
    """
    if len(payload) < 12:
        return False
    if mime == "video/mp4":
        # ISO BMFF: размер бокса (4 байта), затем 'ftyp'.
        return payload[4:8] == b"ftyp"
    if mime == "video/webm":
        # Matroska EBML.
        return payload.startswith(b"\x1a\x45\xdf\xa3")
    return False


def _png(payload: bytes) -> ImageInfo | None:
    # IHDR идёт первым чанком: длина(4) + 'IHDR'(4) + ширина(4) + высота(4).
    if payload[12:16] != b"IHDR" or len(payload) < 24:
        return None
    width, height = struct.unpack(">II", payload[16:24])
    return ImageInfo("image/png", width, height)


#: Маркеры начала кадра. Из них берутся размеры; остальные пропускаются.
_SOF_MARKERS = {
    0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
    0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
}


def _jpeg(payload: bytes) -> ImageInfo | None:
    """Идём по маркерам до первого SOF — в нём и лежат размеры.

    Размеры JPEG нельзя прочитать по фиксированному смещению: перед кадром
    стоят таблицы квантования, EXIF и комментарии произвольной длины.
    """
    offset = 2
    total = len(payload)
    while offset + 4 <= total:
        if payload[offset] != 0xFF:
            # Рассинхронизация: дальше не заголовок, а мусор.
            return None
        marker = payload[offset + 1]
        # Заполнители 0xFF и маркеры без длины пропускаются по одному байту.
        if marker == 0xFF:
            offset += 1
            continue
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            offset += 2
            continue
        if offset + 4 > total:
            return None
        (length,) = struct.unpack(">H", payload[offset + 2 : offset + 4])
        if marker in _SOF_MARKERS:
            if offset + 9 > total:
                return None
            height, width = struct.unpack(">HH", payload[offset + 5 : offset + 9])
            return ImageInfo("image/jpeg", width, height)
        if length < 2:
            return None
        offset += 2 + length
    return None


def _webp(payload: bytes) -> ImageInfo | None:
    """Три подформата, у каждого свои байты с размерами."""
    chunk = payload[12:16]
    if chunk == b"VP8 ":
        # Кадр: 3 байта тега, 3 байта синхрокода, затем 14-битные размеры.
        if len(payload) < 30 or payload[23:26] != b"\x9d\x01\x2a":
            return None
        width = struct.unpack("<H", payload[26:28])[0] & 0x3FFF
        height = struct.unpack("<H", payload[28:30])[0] & 0x3FFF
        return ImageInfo("image/webp", width, height)
    if chunk == b"VP8L":
        if len(payload) < 25 or payload[20] != 0x2F:
            return None
        bits = struct.unpack("<I", payload[21:25])[0]
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
        return ImageInfo("image/webp", width, height)
    if chunk == b"VP8X":
        # Расширенный: флаги(4), затем размеры холста по 3 байта, минус один.
        if len(payload) < 30:
            return None
        width = int.from_bytes(payload[24:27], "little") + 1
        height = int.from_bytes(payload[27:30], "little") + 1
        return ImageInfo("image/webp", width, height)
    return None
