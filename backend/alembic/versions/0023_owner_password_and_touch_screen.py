"""Пароль владельца отдельно от пароля входа; признак сенсорного экрана.

Две несвязанные колонки в одной ревизии только потому, что обе добавляются в
store_settings и обе приезжают с одним шагом мастера. Разбор по отдельности:

`owner_password_hash` — дверь владельца перестаёт открываться паролем учётной
записи. Так было с самого начала, и это стирало разделение ролей: на кассе
залогинен аккаунт владельца, а за клавиатурой стоит кассир, и пароль, который
владелец диктует по телефону («зайди под моим»), открывал заодно финансы,
аналитику и сотрудников. Теперь секретов два, и смена одного не трогает другой.

Существующим установкам хэш копируется с текущего владельца. Это осознанный
выбор в пользу непрерывности: магазин, обновившийся посреди смены, не должен
обнаружить, что владельца заперли снаружи собственных финансов до приезда
специалиста с лицензионным ключом. Секреты при этом уже разделены — начиная с
этой ревизии ни одна проверка не смотрит на users.hashed_password, и первая же
смена пароля входа их разведёт окончательно.

Копируется именно хэш, а не пароль: открытого пароля здесь нет ни в каком виде,
и argon2id-строка переносится как есть — она самодостаточна (соль и параметры
внутри неё).

`touch_screen` — стоит ли касса на моноблоке без клавиатуры. По нему окна ввода
секретов решают, показывать ли собственную экранную клавиатуру. Выключено по
умолчанию, в том числе на уже настроенных кассах: включить дешевле, чем убирать
непрошеную панель на пол-экрана с установки, где клавиатура есть.

Данные не теряются: обе колонки добавляются, ничего не пересоздаётся и не
удаляется.

Revision ID: 0023
Revises: 0022
Create Date: 2026-08-18

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0023"
down_revision: Union[str, None] = "0022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_OWNER_PASSWORD = sa.Column(
    "owner_password_hash", sa.String(length=255), nullable=False, server_default=""
)
_TOUCH_SCREEN = sa.Column(
    "touch_screen", sa.Boolean(), nullable=False, server_default=sa.false()
)


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("store_settings")}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    columns = _existing_columns()

    if "owner_password_hash" not in columns:
        op.add_column("store_settings", _OWNER_PASSWORD)
        # Перенос хэша с текущего владельца — только когда владелец есть.
        #
        # Условие в WHERE, а не в подзапросе: без него на свежей базе (мастер
        # ещё не проходили, users пуст) подзапрос вернул бы NULL, и вставка
        # упала бы на NOT NULL. Пустая строка в этом случае — правильное
        # значение: пароль владельца задаст мастер установки.
        if "users" in _tables():
            op.execute(
                sa.text(
                    """
                    UPDATE store_settings
                       SET owner_password_hash = (
                             SELECT hashed_password FROM users
                              WHERE role = 'owner' AND is_active = 1
                              ORDER BY id LIMIT 1
                           )
                     WHERE EXISTS (
                             SELECT 1 FROM users
                              WHERE role = 'owner' AND is_active = 1
                           )
                    """
                )
            )

    if "touch_screen" not in columns:
        op.add_column("store_settings", _TOUCH_SCREEN)


def downgrade() -> None:
    columns = _existing_columns()
    if "touch_screen" in columns:
        op.drop_column("store_settings", "touch_screen")
    if "owner_password_hash" in columns:
        op.drop_column("store_settings", "owner_password_hash")
