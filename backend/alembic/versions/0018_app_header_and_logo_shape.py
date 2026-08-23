"""Название в шапке приложения отдельно от знака и форма логотипа.

Раньше название магазина запекалось в саму картинку логотипа (logo_text,
logo_text_enabled, logo_text_position), а шапка приложения рядом печатала
название ещё раз — выходило два названия подряд. Теперь картинка несёт только
знак, название рисует интерфейс текстом из реквизитов, а настройкой остаётся
лишь то, что показывать в шапке: знак, название или и то и другое.

Отсюда три колонки:

* `app_header` — режим шапки приложения (logo | logo_name | name). Отдельно от
  `receipt_header`: экран и лента — разные носители и разные решения владельца.
* `logo_shape` — форма экранного знака (square | circle).
* `receipt_logo_shape` — форма чекового знака. Круглая маска накладывается до
  перевода в один бит, а прозрачное печать заливает белым: иначе вокруг круга
  печатался бы чёрный квадрат.

Старые колонки подписи намеренно не удаляются: на существующих базах в них
лежат данные, а удаление колонки в SQLite — это пересборка таблицы целиком.
Значения по умолчанию повторяют прежнее поведение, поэтому уже настроенные
установки после обновления выглядят так же, как выглядели.

Revision ID: 0018
Revises: 0017
Create Date: 2026-08-15

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMNS: dict[str, "sa.Column"] = {
    "app_header": sa.Column(
        "app_header", sa.String(length=16), nullable=False, server_default="logo_name"
    ),
    "logo_shape": sa.Column(
        "logo_shape", sa.String(length=8), nullable=False, server_default="square"
    ),
    "receipt_logo_shape": sa.Column(
        "receipt_logo_shape", sa.String(length=8), nullable=False, server_default="square"
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

    # Установки, которые уже работали с подписью в картинке, продолжают
    # показывать название — только теперь текстом. Те, кто подпись не включал,
    # получают режим «только логотип»: иначе после обновления у них в шапке
    # появилось бы название, которого они там не заводили.
    op.execute(
        """
        UPDATE store_settings
        SET app_header = CASE
            WHEN logo_mode = 'none' OR COALESCE(ui_logo, 1) = 0 THEN 'name'
            WHEN COALESCE(logo_text_enabled, 0) = 1 THEN 'logo_name'
            ELSE 'logo'
        END
        """
    )


def downgrade() -> None:
    existing = _existing_columns()
    for name in reversed(list(_COLUMNS)):
        if name in existing:
            op.drop_column("store_settings", name)
