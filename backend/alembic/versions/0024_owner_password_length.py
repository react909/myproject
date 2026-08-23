"""Длина пароля владельца — чтобы проверять его ровно один раз.

Зачем понадобилась. Проверка argon2id стоит около 120 мс процессорного времени
и 64 МБ памяти — так и задумано, в этом её защита от перебора. Но окно ввода
отправляет набранное само, без кнопки, и не знает, дописал человек пароль или
ещё набирает. Пока это определялось паузой, получалось либо медленно (ждём
паузу), либо разорительно (проверяем каждый набранный кусок, и каждый стоит
полные 120 мс и 64 МБ).

Так это устроено на телефоне: код там известной длины, и он уходит на проверку
ровно в момент ввода последнего символа — ни раньше, ни позже. Здесь то же
самое: зная длину, сервер отсекает всё, что заведомо не пароль, за доли
миллисекунды и не трогает argon2 вовсе. За один ввод пароля остаётся ровно одна
дорогая проверка вместо девяти.

Почему хранить длину не опасно. Она и так видна: окно рисует по кружку на
символ, и любой, кто стоит рядом, её просто считает глазами. У того, кто добрался
до файла базы, есть сам хэш, а против argon2id с 64 МБ памяти знание длины ничего
не решает — перебор упирается в память и время, а не в размер алфавита. Сам
пароль отсюда не восстанавливается никак: хранится только число.

Ноль означает «неизвестна». Так остаётся у всех, кто установился раньше: длину
не вывести ни из хэша, ни откуда-то ещё. Она проставится сама при первом же
успешном входе — единственный момент, когда пароль известен открытым текстом.

Revision ID: 0024
Revises: 0023
Create Date: 2026-08-19

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0024"
down_revision: Union[str, None] = "0023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMN = sa.Column(
    "owner_password_length", sa.Integer(), nullable=False, server_default="0"
)


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("store_settings")}


def upgrade() -> None:
    if "owner_password_length" not in _existing_columns():
        op.add_column("store_settings", _COLUMN)


def downgrade() -> None:
    if "owner_password_length" in _existing_columns():
        op.drop_column("store_settings", "owner_password_length")
