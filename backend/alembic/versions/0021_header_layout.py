"""Компоновка шапки приложения: знак и надпись как две картинки.

Раньше в шапке стоял знак, а рядом приложение печатало название магазина
обычным текстом. Текст выглядел случайным: кегль, начертание и цвет подбирались
настройками, а рядом стоял готовый фирменный знак — две разные типографики в
одной полосе. Теперь надпись — тоже картинка, и владелец выбирает, как знак и
надпись стоят друг относительно друга.

Отсюда одна колонка `header_layout`:

* `combined`  — знак и надпись уже сведены в один файл (так чаще всего и
  присылает дизайнер: знак, под ним текст). Второго слота нет, картинка
  выводится целиком.
* `mark_left` — знак слева, надпись справа. Два отдельных файла в строку.
* `mark_top`  — знак сверху, надпись снизу. Два файла столбиком.
* `mark`      — только знак.
* `wordmark`  — только надпись.

Прежняя колонка `app_header` не удаляется: на существующих базах в ней лежат
данные, а удаление колонки в SQLite — это пересборка таблицы целиком. Её
значения разложены по новой колонке здесь и больше не читаются.

Сами картинки колонок не требуют: они живут в store_images (миграция 0019) под
видом `logo_ui` и слотами `wordmark` и `combined` — таблица заводится один раз,
новые слоты появляются в ней при первом сохранении. Знак остаётся тем же слотом
`mark`, что и был: заводить под него второй вид значило бы держать одну и ту же
картинку в двух местах.

Revision ID: 0021
Revises: 0020
Create Date: 2026-08-16

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0021"
down_revision: Union[str, None] = "0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMN = sa.Column(
    "header_layout", sa.String(length=16), nullable=False, server_default="mark_left"
)


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("store_settings")}


def upgrade() -> None:
    existing = _existing_columns()
    if "header_layout" not in existing:
        op.add_column("store_settings", _COLUMN)

    # Уже настроенная касса после обновления обязана выглядеть так же, как
    # выглядела: прежний режим шапки переносится один в один. Картинки надписи
    # у неё ещё нет, поэтому в компоновках с надписью название по-прежнему
    # рисуется текстом — до тех пор, пока владелец не загрузит файл.
    if "app_header" in existing:
        op.execute(
            """
            UPDATE store_settings
            SET header_layout = CASE app_header
                WHEN 'name' THEN 'wordmark'
                WHEN 'logo' THEN 'mark'
                ELSE 'mark_left'
            END
            """
        )


def downgrade() -> None:
    """Возвращает прежний режим шапки и убирает колонку.

    Компоновок пять, а режимов было три: столбик и единая картинка сходятся в
    прежнее «логотип и название» — ближайшее к ним по смыслу.
    """
    existing = _existing_columns()
    if "header_layout" not in existing:
        return
    if "app_header" in existing:
        op.execute(
            """
            UPDATE store_settings
            SET app_header = CASE header_layout
                WHEN 'wordmark' THEN 'name'
                WHEN 'mark' THEN 'logo'
                ELSE 'logo_name'
            END
            """
        )
    op.drop_column("store_settings", "header_layout")
