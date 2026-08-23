"""Заводской бренд, композиция логотипа и вид чека.

Шаг «Оформление» перестал требовать логотип от всех подряд: заводской бренд
Kassir ERP выбран по умолчанию, и точка, которой брендирование не нужно,
проходит шаг нажатием «Далее». Флаг `use_factory_brand` — это и есть развилка.

Логотип теперь хранится в двух видах. `logo_mark` — исходный знак, `logo_image`
— готовая композиция знака с подписью. Разделение обязательное: настройки
подписи правят после загрузки файла, и накладывать текст на уже подписанную
картинку значит получать его дважды с каждой правкой.

`logo_variants` — готовые 512/128/64 и чековый вариант в один бит на точку.
Собираются один раз в редакторе: пережимать логотип на каждом экране заново
значит получить четыре разных логотипа, а полутона на термоленте — грязь.

Существующие установки помечаются как работающие под своим брендом, если у них
уже загружен логотип: молча вернуть им заводской Kassir ERP было бы подменой
того, что они годами печатали в чеке.

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-12

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMNS: dict[str, "sa.Column"] = {
    "use_factory_brand": sa.Column(
        "use_factory_brand", sa.Boolean(), nullable=False, server_default=sa.true()
    ),
    "logo_mark": sa.Column("logo_mark", sa.Text(), nullable=False, server_default=""),
    "logo_variants": sa.Column("logo_variants", sa.Text(), nullable=False, server_default="{}"),
    "logo_text_enabled": sa.Column(
        "logo_text_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
    ),
    "logo_text_position": sa.Column(
        "logo_text_position", sa.String(length=16), nullable=False, server_default="below"
    ),
    "logo_text_template": sa.Column(
        "logo_text_template", sa.String(length=16), nullable=False, server_default="strict"
    ),
    "logo_text_size": sa.Column(
        "logo_text_size", sa.String(length=4), nullable=False, server_default="m"
    ),
    "logo_text_color": sa.Column(
        "logo_text_color", sa.String(length=16), nullable=False, server_default=""
    ),
    "receipt_logo": sa.Column(
        "receipt_logo", sa.Boolean(), nullable=False, server_default=sa.true()
    ),
    "receipt_header": sa.Column(
        "receipt_header", sa.String(length=16), nullable=False, server_default="logo_name"
    ),
}


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("store_settings")}


def upgrade() -> None:
    existing = _existing_columns()
    for name, column in _COLUMNS.items():
        if name not in existing:
            op.add_column("store_settings", column)

    # У кого логотип уже есть — тот работает под своим брендом.
    op.execute(
        "UPDATE store_settings SET use_factory_brand = 0 "
        "WHERE COALESCE(logo_image, '') <> '' AND logo_mode <> 'none'"
    )
    # Загруженный ранее логотип становится и знаком: подписи у него ещё нет,
    # значит композиция совпадает с исходником.
    op.execute("UPDATE store_settings SET logo_mark = logo_image WHERE COALESCE(logo_mark, '') = ''")
    # Режим image_text означал ровно «есть подпись под знаком».
    op.execute("UPDATE store_settings SET logo_text_enabled = 1 WHERE logo_mode = 'image_text'")
    # Кто печатал без логотипа, продолжает печатать без него.
    op.execute("UPDATE store_settings SET receipt_logo = 0, receipt_header = 'name' WHERE logo_mode = 'none'")


def downgrade() -> None:
    existing = _existing_columns()
    for name in reversed(list(_COLUMNS)):
        if name in existing:
            op.drop_column("store_settings", name)
