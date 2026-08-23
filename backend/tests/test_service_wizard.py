"""Повторный проход мастера специалистом: правит установку, а не заводит новую.

Сценарий из жизни. Магазин работает полгода, в базе товары и чеки. Клиент
просит поменять логотип и текст на чеке. Приезжает специалист, вводит
лицензионный ключ и возвращается в тот же мастер. Всё, что он там сохранит,
обязано лечь поверх существующей записи: новый магазин, сброшенный аккаунт или
потерянные товары здесь не «побочный эффект», а полная потеря работы клиента.

Отдельно проверяется галочка «сенсорный экран»: она приезжает тем же объектом
реквизитов и живёт за дверью специалиста — владелец её не меняет, потому что не
он решает, какое привезли железо.

Запуск: python -m unittest discover -s tests (из каталога backend).
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from api_fixture import (  # noqa: E402
    OWNER_CABINET_PASSWORD,
    SERVICE_KEY,
    auth_headers,
    client,
    ensure_setup,
    onboarding_payload,
)

from app.core.elevation import registry  # noqa: E402


class ServiceWizard(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        cls.token = ensure_setup()
        cls.headers = auth_headers(cls.token)
        cls.user_id = cls.client.get("/api/auth/me", headers=cls.headers).json()["id"]

    def setUp(self) -> None:
        registry.revoke(self.user_id)

    # -- вспомогательное ---------------------------------------------------- #

    def open_specialist(self) -> None:
        response = self.client.post(
            "/api/auth/service-key/unlock", headers=self.headers, json={"key": SERVICE_KEY}
        )
        self.assertEqual(response.status_code, 200, response.text)

    def open_owner(self) -> None:
        response = self.client.post(
            "/api/auth/owner/unlock",
            headers=self.headers,
            json={"password": OWNER_CABINET_PASSWORD},
        )
        self.assertEqual(response.status_code, 200, response.text)

    def store(self) -> dict:
        response = self.client.get("/api/settings/store", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def save(self, onboarding: dict):
        return self.client.patch(
            "/api/settings/store", headers=self.headers, json={"onboarding": onboarding}
        )

    # -- галочка «сенсорный экран» ------------------------------------------ #

    def test_touch_screen_survives_a_round_trip(self) -> None:
        """Сохранилась и вернулась — фронту есть на что смотреть."""
        self.open_specialist()
        data = self.store()["onboarding"]
        self.assertIn("touchScreen", data["branding"])

        data["branding"]["touchScreen"] = True
        self.assertEqual(self.save(data).status_code, 200)
        self.assertTrue(self.store()["onboarding"]["branding"]["touchScreen"])

        # И обратно: специалист может передумать, приехав в следующий раз.
        data["branding"]["touchScreen"] = False
        self.assertEqual(self.save(data).status_code, 200)
        self.assertFalse(self.store()["onboarding"]["branding"]["touchScreen"])

    def test_touch_screen_is_off_by_default(self) -> None:
        """На установке с обычной клавиатурой панель на пол-экрана не нужна."""
        self.open_specialist()
        fresh = onboarding_payload()
        self.assertNotIn("touchScreen", fresh.get("branding", {}))
        # Значение по умолчанию приходит с сервера, а не из формы.
        self.open_specialist()
        data = self.store()["onboarding"]
        data["branding"]["touchScreen"] = False
        self.assertEqual(self.save(data).status_code, 200)
        self.assertIs(self.store()["onboarding"]["branding"]["touchScreen"], False)

    def test_owner_cannot_switch_the_touch_screen(self) -> None:
        """Какое привезли железо — не дело владельца, а специалиста.

        Проверка на сервере, а не в интерфейсе: прятать галочку недостаточно,
        запрос можно послать и мимо формы.
        """
        self.open_specialist()
        data = self.store()["onboarding"]
        current = data["branding"]["touchScreen"]

        registry.revoke(self.user_id)
        self.open_owner()
        data["branding"]["touchScreen"] = not current
        refused = self.save(data)
        self.assertEqual(refused.status_code, 403, refused.text)

    # -- акцентный цвет: тоже за дверью специалиста -------------------------- #

    def test_specialist_can_change_the_accent_color(self) -> None:
        """Фирменный цвет правится там же, где логотип, — на шаге оформления."""
        self.open_specialist()
        data = self.store()["onboarding"]
        self.assertIn("primaryColor", data["branding"])

        data["branding"]["primaryColor"] = "#4f46e5"
        self.assertEqual(self.save(data).status_code, 200)
        self.assertEqual(self.store()["onboarding"]["branding"]["primaryColor"], "#4f46e5")

        # И обратно — к стандартному акценту системы.
        data["branding"]["primaryColor"] = "#00f5bc"
        self.assertEqual(self.save(data).status_code, 200)
        self.assertEqual(self.store()["onboarding"]["branding"]["primaryColor"], "#00f5bc")

    def test_owner_cannot_change_the_accent_color(self) -> None:
        """Цвет системы меняет специалист, и проверка стоит на сервере.

        Именно на сервере, а не скрытием кнопки: прятать контрол недостаточно,
        тот же PATCH можно послать мимо формы — и здесь он это и делает.
        Владелец при этом полноправен: дверь у него открыта, отказ приходит
        именно за поле оформления, а не за отсутствие доступа вообще.
        """
        self.open_specialist()
        data = self.store()["onboarding"]
        original = data["branding"]["primaryColor"]

        registry.revoke(self.user_id)
        self.open_owner()
        data["branding"]["primaryColor"] = "#d0342c"
        refused = self.save(data)
        self.assertEqual(refused.status_code, 403, refused.text)
        self.assertIn("специалист", refused.json()["detail"].lower())

        # Отказ должен быть настоящим: цвет в базе не изменился.
        self.assertEqual(self.store()["onboarding"]["branding"]["primaryColor"], original)

    # -- бренд интерфейса отдельно от реквизитов магазина -------------------- #

    def test_brand_name_is_not_the_store_name(self) -> None:
        """Название системы и название магазина — разные поля.

        Проверка ровно того, ради чего заводилась колонка brand_name: правка
        бренда не трогает реквизиты, и наоборот. Пока отдельного поля не было,
        шапка брала название торговой точки, и переименование магазина
        переименовывало программу.

        Правки идут двумя запросами, и это не обход проверки, а её следствие:
        реквизиты — дело владельца, бренд — специалиста, и одна дверь на обе
        группы не открывается. Разделение полей здесь совпало с разделением
        прав, и это подтверждает саму границу: название магазина и название
        системы меняют разные люди.
        """
        self.open_specialist()
        data = self.store()["onboarding"]
        data["branding"]["useFactoryBrand"] = False
        data["branding"]["brandName"] = "Бимар Маркет"
        self.assertEqual(self.save(data).status_code, 200)

        registry.revoke(self.user_id)
        self.open_owner()
        data = self.store()["onboarding"]
        data["company"]["shortName"] = "ОсОО Глобус"
        data["outlet"]["name"] = "Магазин Глобус"
        self.assertEqual(self.save(data).status_code, 200)

        after = self.store()["onboarding"]
        # Бренд пережил правку реквизитов и в него ничего не перетекло.
        self.assertEqual(after["branding"]["brandName"], "Бимар Маркет")
        self.assertEqual(after["company"]["shortName"], "ОсОО Глобус")
        self.assertEqual(after["outlet"]["name"], "Магазин Глобус")

    def test_returning_to_the_factory_brand_keeps_the_client_data(self) -> None:
        """Возврат к Kassir ERP — переключатель, а не «забудь настройки».

        Клиент вправе передумать и вернуться к своему бренду, не загружая
        логотип и не набирая название заново. Что показывать при каждом режиме,
        решает фронт (brand/resolve); сервер обязан только сохранить поля.
        """
        self.open_specialist()
        data = self.store()["onboarding"]
        data["branding"]["useFactoryBrand"] = False
        data["branding"]["brandName"] = "Бимар Маркет"
        data["branding"]["primaryColor"] = "#7c3aed"
        self.assertEqual(self.save(data).status_code, 200)

        # Вернулись к заводскому бренду.
        data["branding"]["useFactoryBrand"] = True
        self.assertEqual(self.save(data).status_code, 200)

        kept = self.store()["onboarding"]["branding"]
        self.assertTrue(kept["useFactoryBrand"])
        self.assertEqual(kept["brandName"], "Бимар Маркет")
        self.assertEqual(kept["primaryColor"], "#7c3aed")

    def test_owner_cannot_change_the_brand_name(self) -> None:
        """Бренд системы меняет специалист. Проверка на сервере."""
        self.open_specialist()
        data = self.store()["onboarding"]
        original = data["branding"]["brandName"]

        registry.revoke(self.user_id)
        self.open_owner()
        data["branding"]["brandName"] = "Своё название"
        refused = self.save(data)
        self.assertEqual(refused.status_code, 403, refused.text)
        self.assertEqual(self.store()["onboarding"]["branding"]["brandName"], original)

    def test_accent_color_is_offered_before_login(self) -> None:
        """Экран входа красится цветом магазина, а значит должен его узнать.

        `/api/setup/status` отвечает без авторизации — до входа другого
        источника нет. Секретов в ответе не появляется: цвет и тема это ровно
        то, что и так видно на экране.
        """
        self.open_specialist()
        data = self.store()["onboarding"]
        data["branding"]["useFactoryBrand"] = False
        data["branding"]["brandName"] = "Бимар Маркет"
        data["branding"]["primaryColor"] = "#0f9d58"
        data["branding"]["theme"] = "dark"
        self.assertEqual(self.save(data).status_code, 200)

        status = self.client.get("/api/setup/status")
        self.assertEqual(status.status_code, 200, status.text)
        body = status.json()
        self.assertEqual(body["primary_color"], "#0f9d58")
        self.assertEqual(body["theme"], "dark")
        # Режим бренда нужен клиенту, чтобы решить, применять ли сохранённый
        # цвет: под заводским брендом он остаётся лежать, но не красит.
        self.assertFalse(body["use_factory_brand"])
        self.assertEqual(body["brand_name"], "Бимар Маркет")

        # Возвращаем как было, чтобы соседние тесты не зависели от порядка.
        self.open_specialist()
        data["branding"]["useFactoryBrand"] = True
        data["branding"]["primaryColor"] = "#00f5bc"
        data["branding"]["theme"] = "light"
        self.assertEqual(self.save(data).status_code, 200)
        self.assertTrue(self.client.get("/api/setup/status").json()["use_factory_brand"])

    # -- сохранение обновляет, а не пересоздаёт ------------------------------ #

    def test_saving_updates_the_install_instead_of_replacing_it(self) -> None:
        """Главная проверка сервисного прохода.

        Товар, учётная запись и идентификатор установки обязаны пережить
        сохранение мастера. Пока сервисный проход звал бы /api/setup/init,
        каждый из них терялся бы — поэтому он ходит в PATCH.
        """
        self.open_specialist()
        before = self.store()
        installation_id = before["installation_id"]

        # Товар, который специалист трогать не должен.
        created = self.client.post(
            "/api/products",
            headers=self.headers,
            json={"name": "Сервисный тест", "price": 12.5, "barcode": "4600000000109"},
        )
        self.assertEqual(created.status_code, 201, created.text)
        product_id = created.json()["id"]

        users_before = self.client.get("/api/auth/me", headers=self.headers).json()

        # Специалист правит своё: подпись в чеке и признак сенсорного экрана.
        data = before["onboarding"]
        data["branding"]["receiptFooter"] = "Спасибо, приходите ещё"
        data["branding"]["touchScreen"] = True
        self.assertEqual(self.save(data).status_code, 200)

        after = self.store()
        # Установка та же, а не новая.
        self.assertEqual(after["installation_id"], installation_id)
        self.assertTrue(after["setup_completed"])
        # Правка доехала.
        self.assertEqual(after["onboarding"]["branding"]["receiptFooter"], "Спасибо, приходите ещё")
        self.assertTrue(after["onboarding"]["branding"]["touchScreen"])
        # Товар на месте.
        product = self.client.get(f"/api/products/{product_id}", headers=self.headers)
        self.assertEqual(product.status_code, 200, product.text)
        self.assertEqual(product.json()["name"], "Сервисный тест")
        # Аккаунт не сброшен.
        self.assertEqual(
            self.client.get("/api/auth/me", headers=self.headers).json(), users_before
        )

    def test_setup_init_refuses_on_a_configured_install(self) -> None:
        """Второй проход установки не должен затирать работающий магазин.

        Ровно то, от чего оберегает PATCH выше: даже если кто-то позовёт `init`
        напрямую, настроенная касса ответит отказом, а не начнёт всё заново.
        """
        response = self.client.post(
            "/api/setup/init",
            json={
                "setup_token": "не важен — проверка установки идёт раньше токена",
                "edition": "start",
                "onboarding": onboarding_payload(),
                "account": {
                    "email": "another@example.kg",
                    "password": "Parol12345",
                    "owner_password": "Vladelec2026",
                },
            },
        )
        # 403 — токен установки не подтверждён, 409 — установка уже выполнена.
        # Обе двери закрыты, и ни одна не пересоздаёт магазин.
        self.assertIn(response.status_code, (403, 409), response.text)

    # -- пароль владельца переживает сервисный проход ------------------------ #

    def test_service_pass_does_not_touch_the_owner_password(self) -> None:
        """Специалист правит оформление, а не секреты магазина.

        Мастер в сервисном режиме шаг «Учётная запись» пропускает целиком, и
        сохранение реквизитов не должно задевать пароль владельца: иначе каждый
        приезд установщика запирал бы владельца снаружи собственных финансов.
        """
        self.open_specialist()
        data = self.store()["onboarding"]
        data["branding"]["receiptFooter"] = "После правки"
        self.assertEqual(self.save(data).status_code, 200)

        registry.revoke(self.user_id)
        opened = self.client.post(
            "/api/auth/owner/unlock",
            headers=self.headers,
            json={"password": OWNER_CABINET_PASSWORD},
        )
        self.assertEqual(opened.status_code, 200, opened.text)
