"""Режим работы кассы, реквизиты QR-оплаты и подпись чека.

Главное здесь — `fiscal_mode`. Раньше мастер спрашивал фискальные реквизиты у
всех подряд, включая тех, у кого кассы в ГНС нет и не будет. Теперь режим
работы выбирается первым экраном и определяет, какие поля вообще существуют:
в простом режиме ИНН, СНО, координаты и номера ККМ не спрашиваются и в чек не
печатаются.

Установки, сделанные до появления режима, не переспрашиваем: о фискальности
говорят сами данные. Если заполнены и ИНН, и заводской номер ККМ — касса
фискальная, и режим проставляется автоматически. Поэтому CURRENT_SETUP_VERSION
не поднимается: гнать работающий магазин через мастер заново незачем.

Вместе с этим приезжают поля шага «Оплата», которого раньше не было:
QR-провайдер и второй экран покупателя, — и подпись в конце чека, до сих пор
захардкоженная в шаблоне печати.

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-12

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMNS: dict[str, "sa.Column"] = {
    "fiscal_mode": sa.Column(
        "fiscal_mode", sa.String(length=16), nullable=False, server_default="simple"
    ),
    "acquiring_qr_provider": sa.Column(
        "acquiring_qr_provider", sa.String(length=64), nullable=False, server_default=""
    ),
    "acquiring_second_screen": sa.Column(
        "acquiring_second_screen", sa.Boolean(), nullable=False, server_default=sa.false()
    ),
    "receipt_footer": sa.Column(
        "receipt_footer", sa.String(length=128), nullable=False, server_default=""
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

    # Магазин, у которого есть и ИНН, и заводской номер кассы, работает
    # фискально — иначе эти поля просто нечем было бы заполнить.
    op.execute(
        "UPDATE store_settings SET fiscal_mode = 'fiscal' "
        "WHERE fiscal_mode = 'simple' "
        "AND COALESCE(inn, '') <> '' "
        "AND COALESCE(kkm_serial_number, '') <> ''"
    )


def downgrade() -> None:
    existing = _existing_columns()
    for name in reversed(list(_COLUMNS)):
        if name in existing:
            op.drop_column("store_settings", name)
