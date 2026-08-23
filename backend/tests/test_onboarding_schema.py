"""Реквизиты магазина: раскладка по колонкам и проверка допустимых значений.

Проверяется то, на чём эта часть ломается: значение, введённое в мастере,
должно вернуться из базы тем же — иначе после перезапуска касса покажет чужой
тариф или чужое оформление. И наоборот: недопустимое значение обязано быть
отвергнуто сервером, а не только интерфейсом, — экран настроек можно обойти
запросом напрямую.

Запуск: python -m unittest discover -s tests (из каталога backend).
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import ValidationError  # noqa: E402

from app.db.models import StoreSettings  # noqa: E402
from app.modules.setup.images import (  # noqa: E402
    KIND_LOGO_RECEIPT,
    KIND_LOGO_UI,
    KIND_QR,
    SLOT_COMBINED,
    SLOT_MARK,
    SLOT_WORDMARK,
    ImageBag,
    parse_data_url,
    to_data_url,
)
from app.modules.setup.schema import (  # noqa: E402
    AcquiringData,
    BrandingData,
    CompanyData,
    ContactsData,
    OnboardingData,
    apply_to_store,
    from_store,
)

PNG = "data:image/png;base64,iVBORw0KGgo="
JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
# Надпись и единая картинка — свои файлы, а не размеры знака: в тестах они
# намеренно отличаются от PNG, иначе подмена одного другим осталась бы незаметной.
WORDMARK = "data:image/png;base64,iVBORw0KGgoAAAA="
COMBINED = "data:image/webp;base64,UklGRhIAAABXRUJQ"


def filled() -> OnboardingData:
    """Онбординг с заполненным оформлением — то, что собирает мастер."""
    return OnboardingData(
        fiscal_mode="simple",
        edition="standard",
        company=CompanyData(short_name="Магазин Бимар", legal_name="ОсОО Бимар", inn="12345678901234"),
        contacts=ContactsData(phone="+996555123456", email="shop@example.kg"),
        acquiring=AcquiringData(
            providers=[
                {"id": "qr-static-1", "kind": "qr-static", "title": "QR банка", "imageDataUrl": JPEG},
                {"id": "terminal-1", "kind": "terminal", "title": "Терминал"},
            ]
        ),
        branding=BrandingData(
            use_factory_brand=False,
            mode="image",
            header_layout="mark_top",
            logo_shape="circle",
            logo_emboss=False,
            logo=PNG,
            logo_mark=PNG,
            logo_wordmark=WORDMARK,
            logo_combined=COMBINED,
            logo_text_template="round",
            logo_text_size="l",
            receipt_logo=True,
            receipt_header="logo",
            receipt_logo_shape="circle",
            receipt_logo_style="contrast",
            receipt_logo_threshold=200,
            receipt_roll_width="58",
        ),
    )


class OnboardingRoundTrip(unittest.TestCase):
    """Что записали — то и прочитали."""

    def setUp(self) -> None:
        self.store = StoreSettings()
        self.images = ImageBag()
        # Первая установка ещё не завершена: тариф в этот момент ставит
        # SetupService из подтверждённого лицензией токена.
        self.store.setup_completed = True
        self.store.edition = "start"
        self.store.license_plan = "start"

    def test_tariff_survives_round_trip(self) -> None:
        apply_to_store(self.store, filled(), self.images)
        self.assertEqual(self.store.edition, "standard")
        # Право работать определяет license_plan — он обязан идти вместе с
        # тарифом, иначе касса пообещает то, чего не включит.
        self.assertEqual(self.store.license_plan, "standard")
        self.assertEqual(from_store(self.store, self.images).edition, "standard")

    def test_branding_survives_round_trip(self) -> None:
        apply_to_store(self.store, filled(), self.images)
        branding = from_store(self.store, self.images).branding
        self.assertEqual(branding.header_layout, "mark_top")
        self.assertEqual(branding.logo_shape, "circle")
        # Выключенный объём обязан пережить круг: булево «выключено» легко
        # потерять по дороге, и настройка молча вернулась бы включённой.
        self.assertIs(branding.logo_emboss, False)
        self.assertEqual(branding.receipt_logo_shape, "circle")
        self.assertEqual(branding.logo_text_template, "round")
        self.assertEqual(branding.logo_text_size, "l")
        self.assertEqual(branding.receipt_roll_width, "58")
        self.assertEqual(branding.receipt_logo_threshold, 200)
        self.assertEqual(branding.logo_mark, PNG)

    def test_defaults_for_old_rows(self) -> None:
        """Строка из базы, где новых колонок ещё не было, читается дефолтами."""
        store = StoreSettings()
        # Заполняем строку так, как её оставила бы прежняя версия приложения…
        apply_to_store(store, OnboardingData(), ImageBag())
        # …а новые колонки после миграции могут быть пустыми.
        store.header_layout = ""
        store.logo_shape = ""
        store.receipt_logo_shape = ""
        store.edition = ""
        data = from_store(store, ImageBag())
        self.assertEqual(data.branding.header_layout, "mark_left")
        self.assertEqual(data.branding.logo_shape, "square")
        # Объём включён по умолчанию — в том числе на базе, где колонки ещё нет.
        self.assertIs(data.branding.logo_emboss, True)
        self.assertEqual(data.branding.receipt_logo_shape, "square")
        self.assertEqual(data.edition, "start")

    def test_setup_not_completed_keeps_license_untouched(self) -> None:
        """До завершения установки тариф ставит только мастер."""
        store = StoreSettings()
        store.setup_completed = False
        store.edition = "start"
        store.license_plan = "start"
        apply_to_store(store, filled(), ImageBag())
        self.assertEqual(store.license_plan, "start")


class ImageStorage(unittest.TestCase):
    """Картинки лежат отдельно от реквизитов, а наружу уходят как раньше."""

    def setUp(self) -> None:
        self.store = StoreSettings()
        self.store.setup_completed = True
        self.images = ImageBag()
        apply_to_store(self.store, filled(), self.images)

    def test_columns_no_longer_carry_base64(self) -> None:
        """Ради этого всё и затевалось: строка настроек — не мегабайт base64."""
        self.assertEqual(self.store.logo_image, "")
        self.assertEqual(self.store.logo_mark, "")
        self.assertEqual(self.store.receipt_logo_file, "")
        self.assertEqual(self.store.receipt_logo_mark, "")
        self.assertNotIn("imageDataUrl", self.store.payment_providers)

    def test_images_land_in_their_slots(self) -> None:
        self.assertEqual(self.images.get(KIND_LOGO_UI, SLOT_MARK), PNG)
        self.assertEqual(self.images.get(KIND_LOGO_UI, "main"), PNG)
        # Снимок QR принадлежит своему способу оплаты, а не реквизитам вообще.
        self.assertEqual(self.images.get(KIND_QR, "qr-static-1"), JPEG)
        self.assertEqual(self.images.get(KIND_QR, "terminal-1"), "")

    def test_header_pictures_are_three_separate_entities(self) -> None:
        """Знак, надпись и единая картинка — три разных слота, а не один файл."""
        self.assertEqual(self.images.get(KIND_LOGO_UI, SLOT_MARK), PNG)
        self.assertEqual(self.images.get(KIND_LOGO_UI, SLOT_WORDMARK), WORDMARK)
        self.assertEqual(self.images.get(KIND_LOGO_UI, SLOT_COMBINED), COMBINED)

    def test_header_pictures_come_back_where_interface_expects_them(self) -> None:
        branding = from_store(self.store, self.images).branding
        self.assertEqual(branding.logo_wordmark, WORDMARK)
        self.assertEqual(branding.logo_combined, COMBINED)

    def test_dropped_wordmark_leaves_no_row(self) -> None:
        """Картинку убрали — слот пустеет, а не хранит прошлую надпись."""
        data = filled()
        data.branding.logo_wordmark = ""
        apply_to_store(self.store, data, self.images)
        self.assertEqual(self.images.get(KIND_LOGO_UI, SLOT_WORDMARK), "")
        # Соседние слоги при этом целы: слоты независимы.
        self.assertEqual(self.images.get(KIND_LOGO_UI, SLOT_COMBINED), COMBINED)
        self.assertEqual(self.images.get(KIND_LOGO_UI, SLOT_MARK), PNG)

    def test_reading_returns_images_where_interface_expects_them(self) -> None:
        data = from_store(self.store, self.images)
        self.assertEqual(data.branding.logo_mark, PNG)
        providers = {p["id"]: p for p in data.acquiring.providers}
        self.assertEqual(providers["qr-static-1"]["imageDataUrl"], JPEG)
        self.assertNotIn("imageDataUrl", providers["terminal-1"])

    def test_removed_provider_loses_its_image(self) -> None:
        data = filled()
        data.acquiring.providers = [
            {"id": "terminal-1", "kind": "terminal", "title": "Терминал"}
        ]
        apply_to_store(self.store, data, self.images)
        self.assertEqual(self.images.get(KIND_QR, "qr-static-1"), "")

    def test_receipt_logo_kept_apart_from_ui_logo(self) -> None:
        """Две независимые картинки — два разных вида, а не один на всё."""
        data = filled()
        data.branding.receipt_logo_file = JPEG
        apply_to_store(self.store, data, self.images)
        self.assertEqual(self.images.get(KIND_LOGO_RECEIPT, "file"), JPEG)
        self.assertEqual(self.images.get(KIND_LOGO_UI, "mark"), PNG)

    def test_data_url_round_trip(self) -> None:
        parsed = parse_data_url(JPEG)
        assert parsed is not None
        mime, raw = parsed
        self.assertEqual(mime, "image/jpeg")
        self.assertEqual(to_data_url(mime, raw), JPEG)

    def test_garbage_is_not_an_image(self) -> None:
        self.assertIsNone(parse_data_url("не картинка"))
        self.assertIsNone(parse_data_url(""))


class OnboardingValidation(unittest.TestCase):
    """Недопустимое значение отвергается сервером, а не только экраном."""

    def test_rejects_unknown_edition(self) -> None:
        with self.assertRaises(ValidationError):
            OnboardingData(edition="premium")

    def test_rejects_unknown_header_layout(self) -> None:
        with self.assertRaises(ValidationError):
            BrandingData(header_layout="banner")
        # Прежние значения режима шапки тоже не проходят: компоновок теперь
        # пять, и старое «logo_name» ничего не означает.
        with self.assertRaises(ValidationError):
            BrandingData(header_layout="logo_name")

    def test_rejects_unknown_logo_shape(self) -> None:
        with self.assertRaises(ValidationError):
            BrandingData(logo_shape="triangle")
        with self.assertRaises(ValidationError):
            BrandingData(receipt_logo_shape="triangle")

    def test_rejects_unknown_roll_width(self) -> None:
        with self.assertRaises(ValidationError):
            BrandingData(receipt_roll_width="120")

    def test_rejects_threshold_out_of_range(self) -> None:
        with self.assertRaises(ValidationError):
            BrandingData(receipt_logo_threshold=300)

    def test_rejects_oversized_image(self) -> None:
        """Картинка сверх предела — отказ, а не запись мегабайтов в колонку."""
        with self.assertRaises(ValidationError):
            BrandingData(logo="d" * 1_500_001)


if __name__ == "__main__":
    unittest.main()
