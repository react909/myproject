"""Общее приложение и база для тестов, которые ходят по API.

Приложение поднимается один раз на процесс: настройки и подключение к базе —
модульные синглтоны, и второй набор тестов, задавший свой путь к базе после
импорта, всё равно попал бы в первую. Раньше это выглядело как «System is
already configured» во втором модуле, который запускался.

Поэтому база одна на все API-тесты, а установка выполняется однократно: кто
первый дошёл — тот и настроил, остальные входят логином.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DB_PATH = Path(tempfile.gettempdir()) / "nurcrm-api-tests.db"

# Путь задаётся до импорта приложения: настройки читаются один раз при загрузке.
if "SQLITE_PATH" not in os.environ:
    if DB_PATH.exists():
        DB_PATH.unlink()
    os.environ["SQLITE_PATH"] = str(DB_PATH)
os.environ["NURCRM_DB_MODE"] = "sqlite_only"

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.modules.licensing.activation import generate_key  # noqa: E402

OWNER_EMAIL = "owner@example.kg"
# Пароль учётной записи: им входят в систему, и только им. Кабинет владельца он
# не открывает — это разные секреты, и тесты на это опираются.
OWNER_PASSWORD = "Parol12345"
# Пароль владельца: кабинет с финансами, аналитикой и сотрудниками.
OWNER_CABINET_PASSWORD = "Vladelec2026"
SERVICE_KEY = "Bimar2026"

_client: TestClient | None = None

# Лицензионный ключ установки. Он же сервисный: специалист приходит с ним, а не
# с секретом, который придумал владелец. Ключ генерируется при первой установке
# и запоминается здесь — тестам он нужен целиком, а из базы наружу отдаётся
# только маска.
LICENSE_KEY = ""


def client() -> TestClient:
    """Один клиент на процесс: он же держит жизненный цикл приложения."""
    global _client
    if _client is None:
        _client = TestClient(app)
        _client.__enter__()
    return _client


def onboarding_payload(**overrides) -> dict:
    payload = {
        "fiscalMode": "simple",
        "company": {"shortName": "Магазин Бимар"},
        "outlet": {"city": "Бишкек", "street": "Чуй 1"},
        "contacts": {"phone": "+996555123456"},
        "owner": {"firstName": "Иван", "lastName": "Петров", "email": OWNER_EMAIL},
    }
    payload.update(overrides)
    return payload


def ensure_setup(onboarding: dict | None = None, edition: str = "start") -> str:
    """Возвращает токен владельца, выполнив установку, если её ещё не было."""
    global LICENSE_KEY
    api = client()
    key = generate_key(get_settings().license_hmac_secret)
    token_response = api.post("/api/setup/activate", json={"license_key": key})
    assert token_response.status_code == 200, token_response.text

    created = api.post(
        "/api/setup/init",
        json={
            "setup_token": token_response.json()["setup_token"],
            "edition": edition,
            "onboarding": onboarding or onboarding_payload(),
            "account": {
                "email": OWNER_EMAIL,
                "password": OWNER_PASSWORD,
                "owner_password": OWNER_CABINET_PASSWORD,
                "service_key": SERVICE_KEY,
            },
        },
    )
    if created.status_code == 201:
        # Ключ этой установки — тот, которым она только что активирована.
        #
        # Присваивается на каждой удачной установке, а не однажды. Набор тестов
        # сброса стирает базу целиком, следующий набор ставит её заново и уже с
        # другим ключом: запомненный «первый» после этого не открыл бы ничего, а
        # выглядело бы это как сломанная проверка лицензии.
        LICENSE_KEY = key
        return created.json()["access_token"]

    # Установка уже выполнена другим набором тестов — входим обычным логином.
    assert created.status_code == 409, created.text
    logged = api.post(
        "/api/auth/login", json={"username": OWNER_EMAIL, "password": OWNER_PASSWORD}
    )
    assert logged.status_code == 200, logged.text
    token = logged.json()["access_token"]

    # …и приводим реквизиты к тому, что просил вызывающий: иначе набор тестов
    # видел бы данные соседнего и зависел от порядка запуска.
    if onboarding is not None:
        # Открываются обе двери, и это не перестраховка.
        #
        # Реквизиты поделены между владельцем и специалистом (field_access.py):
        # наименования, адрес и контакты правит владелец, логотипы и ККМ —
        # специалист. Здесь присылается объект целиком, то есть правка может
        # задеть любую половину, и одной двери для неё не хватает.
        #
        # Раньше открывалась только дверь специалиста, а проходило это лишь
        # потому, что предыдущий набор тестов случайно оставлял открытой дверь
        # владельца. Стоило соседнему набору закрыть за собой двери — и
        # установка падала с отказом на чужие поля.
        for secret in (OWNER_CABINET_PASSWORD, SERVICE_KEY):
            opened = api.post(
                "/api/auth/access/unlock",
                headers=auth_headers(token),
                json={"secret": secret},
            )
            assert opened.status_code == 200, opened.text
        patched = api.patch(
            "/api/settings/store",
            headers=auth_headers(token),
            json={"edition": edition, "onboarding": onboarding},
        )
        assert patched.status_code == 200, patched.text
    return token


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def ensure_shift(headers: dict[str, str], open_cash_tiyin: int = 0) -> dict:
    """Открытая смена. Без неё продажа не проходит — и это правильно.

    Раньше `/api/sales` открывал смену сам, если её не было, и тесты об этом
    не знали. Теперь продажа без смены получает 409: смена, заведённая молча,
    имеет нулевой размен и случайного кассира, а сверка в конце дня по ней не
    сходится. Тесты, которые продают, обязаны сперва открыть смену — ровно
    как настоящая касса.

    Возвращает уже открытую смену, если она есть: наборы тестов делят один
    процесс и одну базу, и вторая попытка открыть получила бы отказ.
    """
    api = client()
    current = api.get("/api/shifts/current", headers=headers)
    assert current.status_code == 200, current.text
    if current.json():
        return current.json()
    opened = api.post(
        "/api/shifts/open",
        headers=headers,
        json={"open_cash_tiyin": open_cash_tiyin, "cashier_name": "Тестовый кассир"},
    )
    assert opened.status_code == 201, opened.text
    return opened.json()
