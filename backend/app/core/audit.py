"""Журнал действий: кто, когда и что изменил.

Раньше запись велась только внутри auth/router.py и только про входы в скрытые
настройки. Этого мало: спор «настройки поменялись сами» или «кто удалил
сотрудника» разрешить входами нельзя — нужно старое и новое значение.

Здесь запись оформлена так, чтобы её было дёшево добавить в любой модуль:
одна функция, никаких зависимостей от роутера. Коммит намеренно не делается —
запись входит в ту же транзакцию, что и само изменение. Иначе возможен
результат хуже отсутствия журнала: изменение откатилось, а запись о нём
осталась.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditEntry, User

# Длина колонок old_value/new_value. Длинные значения (например, data URL
# логотипа) режутся: журнал должен оставаться читаемым, а не хранить копию
# картинки в каждой строке.
_VALUE_LIMIT = 2000


def _short(value: Any) -> str:
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    if len(text) <= _VALUE_LIMIT:
        return text
    return text[: _VALUE_LIMIT - 1] + "…"


async def write_audit(
    session: AsyncSession,
    *,
    actor: User | None,
    action: str,
    target: str = "",
    old_value: Any = None,
    new_value: Any = None,
    actor_kind: str = "owner",
) -> None:
    """Добавляет запись в журнал в текущую транзакцию.

    `action` — что произошло, точками: `staff.created`, `staff.pin_changed`,
    `expense.deleted`. `target` — над чем: имя сотрудника, название категории.
    """
    session.add(
        AuditEntry(
            actor_kind=actor.role if actor and actor.role in ("owner", "admin") else actor_kind,
            actor_name=actor.username if actor else "",
            action=action,
            target=_short(target),
            old_value=_short(old_value),
            new_value=_short(new_value),
        )
    )


def diff_fields(before: dict[str, Any], after: dict[str, Any]) -> tuple[str, str]:
    """Готовит пару «было / стало» только из полей, которые реально изменились.

    Писать в журнал объект целиком бессмысленно: среди тридцати неизменных
    полей правку одного не разглядеть.
    """
    changed = [key for key in after if before.get(key) != after.get(key)]
    old = "; ".join(f"{key}={before.get(key)!r}" for key in changed)
    new = "; ".join(f"{key}={after.get(key)!r}" for key in changed)
    return old, new
