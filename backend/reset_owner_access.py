"""Восстановление доступа владельца к локальной кассе.

Касса офлайновая: слать «восстановление пароля по почте» здесь некуда, и
единственный способ вернуть доступ — сделать это на самой машине, у локальной
базы. Скрипт для владельца и установщика, а не для кассира: он требует доступа
к файлу базы, то есть к компьютеру, на котором касса стоит.

Что умеет:

    python reset_owner_access.py --show
    python reset_owner_access.py --password "новый-пароль"
    python reset_owner_access.py --pin 4821
    python reset_owner_access.py --unlock
    python reset_owner_access.py --wipe --yes

`--unlock` снимает счётчик неудачных попыток и блокировку на 15 минут, не
трогая сами секреты.

`--wipe` стирает установку целиком — владельца, реквизиты, товары и продажи, —
после чего приложение снова открывается мастером первого запуска. Требует
явного `--yes`: это ровно та кнопка, которую нельзя нажать случайно. Схема базы
при этом сохраняется, миграции заново не прогоняются.
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
import time
from pathlib import Path

# Тот же контекст хэширования, что и у приложения: иначе сервер не примет
# записанный здесь хэш.
try:
    from app.core.security import hash_password
except ModuleNotFoundError:  # запуск не из каталога backend
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from app.core.security import hash_password

MIN_PASSWORD_LENGTH = 8


def resolve_db(explicit: str | None) -> Path:
    """Ищет базу там же, где её ищет приложение."""
    if explicit:
        return Path(explicit).resolve()

    candidates = [
        Path(__file__).resolve().parent / "nurcrm.db",
        Path.cwd() / "nurcrm.db",
    ]
    appdata = Path.home() / "AppData" / "Roaming"
    if appdata.exists():
        # Electron кладёт базу в userData, имя каталога — productName.
        candidates += sorted(appdata.glob("*/nurcrm.db"))

    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise SystemExit(
        "База не найдена. Укажите путь явно: --db C:\\путь\\к\\nurcrm.db"
    )


def show(con: sqlite3.Connection) -> None:
    owner = con.execute(
        "SELECT id, username, role, is_active FROM users WHERE role = 'owner'"
    ).fetchall()
    store = con.execute(
        "SELECT setup_completed, owner_failed_attempts, owner_locked_until, "
        "length(service_pin_hash), activation_key FROM store_settings"
    ).fetchone()

    print("Владелец (логин = email):", owner or "не найден")
    if store:
        completed, attempts, locked, pin_len, key = store
        print("Установка завершена:", bool(completed))
        print("Неудачных попыток подряд:", attempts)
        print("Заблокировано до:", locked or "нет")
        print("Сервисный PIN задан:", bool(pin_len))
        print("Ключ активации:", key or "нет")


"""Таблицы, которые чистит --wipe.

Порядок важен: сначала зависимые строки, потом то, на что они ссылаются, —
иначе внешние ключи не дадут удалить. alembic_version намеренно не трогаем:
схема остаётся на месте, и приложение не начнёт прогонять миграции заново.
"""
WIPE_ORDER = (
    "debt_payments",
    "sale_items",
    "sales",
    "sale_counters",
    "stock_moves",
    "shifts",
    "products",
    "categories",
    "payment_events",
    "payment_intents",
    "payment_secrets",
    "audit_entries",
    "sync_log",
    "sync_pk_map",
    "users",
    "store_settings",
)


def wipe(con: sqlite3.Connection) -> None:
    con.execute("PRAGMA foreign_keys = OFF")
    for table in WIPE_ORDER:
        try:
            removed = con.execute(f'DELETE FROM "{table}"').rowcount
            if removed:
                print(f"  {table}: удалено {removed}")
        except sqlite3.OperationalError:
            # Таблицы может не быть на старой схеме — это не повод падать.
            pass
    con.execute("PRAGMA foreign_keys = ON")
    print("\nУстановка стёрта. При следующем запуске откроется мастер первого запуска.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Восстановление доступа владельца.")
    parser.add_argument("--db", help="Путь к nurcrm.db, если он нестандартный")
    parser.add_argument("--show", action="store_true", help="Показать состояние доступа")
    parser.add_argument("--password", help="Новый пароль владельца (минимум 8 символов)")
    parser.add_argument("--pin", help="Новый сервисный PIN (4–6 цифр)")
    parser.add_argument("--unlock", action="store_true", help="Снять блокировку по попыткам")
    parser.add_argument("--wipe", action="store_true", help="Стереть установку и начать заново")
    parser.add_argument("--yes", action="store_true", help="Подтвердить --wipe")
    args = parser.parse_args()

    db_path = resolve_db(args.db)
    print("База:", db_path)
    con = sqlite3.connect(db_path)

    if args.wipe:
        if not args.yes:
            show(con)
            raise SystemExit(
                "\n--wipe стирает владельца, реквизиты, товары и продажи.\n"
                "Сделайте копию nurcrm.db и повторите с --yes, если это то, что нужно."
            )
        # Копия рядом с базой: восстановиться после случайного стирания должно
        # быть можно без разговоров с разработчиком.
        backup = db_path.with_suffix(f".db.before-wipe-{int(time.time())}")
        shutil.copy2(db_path, backup)
        print("Копия базы:", backup)
        wipe(con)
        con.commit()
        return

    changing = args.password or args.pin or args.unlock
    if args.show or not changing:
        show(con)
        if not changing:
            print("\nНичего не изменено. Добавьте --password, --pin, --unlock или --wipe.")
        return

    if args.password:
        if len(args.password) < MIN_PASSWORD_LENGTH:
            raise SystemExit(f"Пароль короче {MIN_PASSWORD_LENGTH} символов.")
        updated = con.execute(
            "UPDATE users SET hashed_password = ? WHERE role = 'owner'",
            (hash_password(args.password),),
        ).rowcount
        if updated == 0:
            raise SystemExit("Владелец в базе не найден — менять пароль некому.")
        print(f"Пароль владельца обновлён (записей: {updated}).")

    if args.pin:
        if not (args.pin.isdigit() and 4 <= len(args.pin) <= 6):
            raise SystemExit("PIN должен состоять из 4–6 цифр.")
        con.execute(
            "UPDATE store_settings SET service_pin_hash = ?, master_password_hash = ''",
            (hash_password(args.pin),),
        )
        print("Сервисный PIN обновлён.")

    if args.unlock or args.password:
        # После смены пароля блокировку снимаем всегда: иначе владелец задал
        # новый пароль и всё равно упирается в счётчик старых попыток.
        con.execute(
            "UPDATE store_settings SET owner_failed_attempts = 0, owner_locked_until = NULL"
        )
        print("Блокировка по неудачным попыткам снята.")

    con.commit()
    print("\nГотово. Перезапускать сервер не нужно — секреты читаются из базы при каждой проверке.")


if __name__ == "__main__":
    main()
