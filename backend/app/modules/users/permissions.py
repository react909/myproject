"""Права кассира: единственное место, где описан их набор.

Список фиксированный и намеренно короткий. Права отвечают на вопрос «что этому
человеку можно за кассой», а не «какие экраны ему показать»: экраны за паролем
владельца и сервисным ключом, а здесь только кассовые операции.

Хранятся строкой через запятую в users.permissions. Отдельная таблица тут была
бы дороже пользы: набор из четырёх флагов, а проверка прав происходит на каждой
операции, и join ради неё на слабой машине лишний.
"""

from __future__ import annotations

# Ключ → человеческое название. Порядок задаёт порядок галочек в интерфейсе.
PERMISSIONS: dict[str, str] = {
    "sell": "Продажа",
    "refund": "Возврат",
    "discount": "Скидка",
    "shift": "Открытие смены",
}

# Что получает новый кассир, если права не указали. Продавать — это то, ради
# чего его и заводят; возвраты и скидки владелец открывает осознанно.
DEFAULT_PERMISSIONS: tuple[str, ...] = ("sell",)


def normalize_permissions(values: list[str] | None) -> str:
    """Приводит список прав к строке для хранения.

    Неизвестные ключи отбрасываются молча: они приходят только от устаревшего
    клиента, и падать из-за лишнего флага, когда сотрудника уже заводят, хуже,
    чем его проигнорировать. Порядок берётся из PERMISSIONS, чтобы одна и та же
    комбинация всегда давала одну и ту же строку.
    """
    if not values:
        return ",".join(DEFAULT_PERMISSIONS)
    selected = {value.strip() for value in values if value and value.strip() in PERMISSIONS}
    return ",".join(key for key in PERMISSIONS if key in selected)


def parse_permissions(raw: str | None) -> list[str]:
    """Читает права из хранимой строки."""
    if not raw:
        return []
    return [key for key in PERMISSIONS if key in {part.strip() for part in raw.split(",")}]


def has_permission(raw: str | None, permission: str) -> bool:
    return permission in parse_permissions(raw)
