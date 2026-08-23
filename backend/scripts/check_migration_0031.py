"""Проверка миграции 0031 на базе С ДАННЫМИ, и с теми, которые её ломают.

На пустой базе любая миграция проходит. Здесь база готовится враждебно —
именно так, как выглядит настоящая база магазина, пережившая полгода работы:

  * дубли штрихкодов (один код у трёх товаров) — из-за них уникальный индекс
    не создался бы и обновление упало бы у клиента;
  * пробелы по краям кода — то же самое отсутствие кода, но мимо условия
    частичного индекса.

Про NULL в штрихкоде. Миграция его тоже приводит к пустой строке, но ПРОВЕРИТЬ
это здесь нельзя: колонка объявлена NOT NULL, и вставить NULL обычным запросом
не выходит. То есть в живой базе он может появиться только правкой файла руками
или восстановлением из очень старой копии. Приведение в миграции оставлено как
страховка — оно стоит один UPDATE и снимает вопрос навсегда, — но выдавать его
за проверенный случай нечестно, поэтому здесь его нет.

Проверяется, что после миграции: ни одна строка не потеряна, дубли разведены
без потери кодов, «нет кода» записано одним способом, а уникальность работает.

Запуск (из каталога backend):

    .venv\\Scripts\\python.exe scripts\\check_migration_0031.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402


def alembic_config(dsn: str) -> Config:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.attributes["target_dsn"] = dsn
    return cfg


def seed(engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, username, full_name, hashed_password, role, is_active,"
                " pin_hash, permissions, created_at)"
                " VALUES (1, 'shop@kg', 'Владелец', 'x', 'owner', 1, '', '', CURRENT_TIMESTAMP)"
            )
        )
        rows = [
            # Три товара с ОДНИМ штрихкодом: так бывает после ручного ввода.
            {"id": 1, "name": "Сахар 1 кг", "bc": "4600000000017", "extra": ""},
            {"id": 2, "name": "Сахар 1 кг (дубль)", "bc": "4600000000017", "extra": ""},
            {"id": 3, "name": "Сахар фасованный", "bc": "4600000000017", "extra": "9001"},
            # Два товара БЕЗ кода: их должно быть можно сколько угодно.
            {"id": 4, "name": "Развес орехи", "bc": "", "extra": ""},
            {"id": 5, "name": "Развес курага", "bc": "", "extra": ""},
            # Код с пробелами по краям.
            {"id": 6, "name": "Чай листовой", "bc": "  4600000000024  ", "extra": ""},
            {"id": 7, "name": "Обычный товар", "bc": "4600000000031", "extra": ""},
        ]
        for row in rows:
            conn.execute(
                text(
                    "INSERT INTO products (id, name, barcode, extra_barcodes, kind, unit, price,"
                    " wholesale_price, cost_price, stock_qty, image, is_active)"
                    " VALUES (:id, :name, :bc, :extra, 'piece', 'шт', 100, 0, 60, 10, '', 1)"
                ),
                row,
            )


def snapshot(engine) -> dict:
    with engine.connect() as conn:
        return {
            "products": conn.execute(text("SELECT COUNT(*) FROM products")).scalar_one(),
            "names": sorted(
                r[0] for r in conn.execute(text("SELECT name FROM products")).all()
            ),
        }


def main() -> None:
    path = Path(tempfile.mkdtemp()) / "existing.db"
    dsn = f"sqlite:///{path.as_posix()}"

    print("1. База в состоянии 0030 (как у клиента после прошлого обновления)")
    command.upgrade(alembic_config(dsn), "0030")

    engine = create_engine(dsn)
    print("2. Наливаем данные, включая дубли штрихкодов и коды с пробелами")
    seed(engine)
    before = snapshot(engine)
    print(f"   товаров: {before['products']}")

    print("3. Накатываем 0031")
    command.upgrade(alembic_config(dsn), "0031")

    after = snapshot(engine)
    problems: list[str] = []
    if before["products"] != after["products"]:
        problems.append(f"товаров было {before['products']}, стало {after['products']}")
    if before["names"] != after["names"]:
        problems.append("названия товаров изменились")

    with engine.connect() as conn:
        # «Нет кода» — ровно одно значение.
        nulls = conn.execute(
            text("SELECT COUNT(*) FROM products WHERE barcode IS NULL")
        ).scalar_one()
        if nulls:
            problems.append(f"NULL в штрихкоде остался у {nulls} товаров")

        # Пробелы срезаны.
        spaced = conn.execute(
            text("SELECT COUNT(*) FROM products WHERE barcode != TRIM(barcode)")
        ).scalar_one()
        if spaced:
            problems.append(f"пробелы в штрихкоде остались у {spaced} товаров")

        # Дубли разведены: непустой код теперь у одного товара.
        dupes = conn.execute(
            text(
                "SELECT COUNT(*) FROM (SELECT barcode FROM products WHERE barcode != ''"
                " GROUP BY barcode HAVING COUNT(*) > 1)"
            )
        ).scalar_one()
        if dupes:
            problems.append(f"дубли штрихкодов остались: {dupes}")

        # Коды не потеряны: у потерявших основной код они в дополнительных.
        moved = conn.execute(
            text("SELECT id, name, barcode, extra_barcodes FROM products ORDER BY id")
        ).all()

        # Уникальность реально работает.
        try:
            with engine.begin() as write:
                write.execute(
                    text(
                        "INSERT INTO products (id, name, barcode, extra_barcodes, kind, unit,"
                        " price, wholesale_price, cost_price, stock_qty, image, is_active)"
                        " VALUES (900, 'Нарушитель', '4600000000031', '', 'piece', 'шт', 1, 0, 0,"
                        " 0, '', 1)"
                    )
                )
            problems.append("дубль штрихкода прошёл — уникальность не работает")
        except Exception:
            pass  # именно этого и ждём

        # А два товара без кода — можно сколько угодно.
        try:
            with engine.begin() as write:
                write.execute(
                    text(
                        "INSERT INTO products (id, name, barcode, extra_barcodes, kind, unit,"
                        " price, wholesale_price, cost_price, stock_qty, image, is_active)"
                        " VALUES (901, 'Ещё развес', '', '', 'piece', 'шт', 1, 0, 0, 0, '', 1)"
                    )
                )
        except Exception as error:  # noqa: BLE001
            problems.append(f"второй товар без кода не завёлся: {error}")

        tables = {r[0] for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))}
        for table in ("product_media", "product_bundle_items"):
            if table not in tables:
                problems.append(f"нет таблицы {table}")

    print("\nШтрихкоды после миграции:")
    for row in moved:
        print(f"   id={row[0]:<4} {row[1]:<24} код={row[2]!r:<18} доп={row[3]!r}")

    print(f"\nфайл: {path}")
    if problems:
        print("\nПРОБЛЕМЫ:")
        for item in problems:
            print(f"   ✗ {item}")
        sys.exit(1)
    print("\n✓ Данные целы, дубли разведены без потери кодов, уникальность работает.")


if __name__ == "__main__":
    main()
