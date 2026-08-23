"""Фотофиксация входов в кабинет владельца.

Не распознавание и не защита: дверь по-прежнему открывает только пароль
владельца. Это след — владелец видит, кто заходил в его финансы.

Отсюда и то, что здесь проверяется: снимок принимается только от того, кто
действительно вошёл, только в разрешённом формате, старые снимки не копятся, а
смотреть их может один владелец.

Запуск: python -m unittest discover -s tests (из каталога backend).
"""

from __future__ import annotations

import base64
import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from api_fixture import (  # noqa: E402
    DB_PATH as _TEMP_DB,
    OWNER_CABINET_PASSWORD,
    auth_headers,
    client,
    ensure_setup,
)

from app.core.elevation import registry as elevation  # noqa: E402
from app.modules.auth.router import ENTRY_PHOTOS_KEPT  # noqa: E402

# Содержимое неважно: маршрут проверяет формат, а не картинку.
JPEG = "data:image/jpeg;base64," + base64.b64encode(b"jpeg-bytes").decode()


class OwnerEntryPhoto(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = client()
        cls.headers = auth_headers(ensure_setup())
        cls.user_id = cls.client.get("/api/auth/me", headers=cls.headers).json()["id"]

    def setUp(self) -> None:
        elevation.revoke(self.user_id)
        self.wipe()

    def wipe(self) -> None:
        con = sqlite3.connect(_TEMP_DB)
        try:
            con.execute("DELETE FROM owner_entry_photos")
            con.commit()
        finally:
            con.close()

    def stored(self) -> int:
        con = sqlite3.connect(_TEMP_DB)
        try:
            return con.execute("SELECT COUNT(*) FROM owner_entry_photos").fetchone()[0]
        finally:
            con.close()

    def open_owner(self) -> None:
        response = self.client.post(
            "/api/auth/owner/unlock",
            headers=self.headers,
            json={"password": OWNER_CABINET_PASSWORD},
        )
        self.assertEqual(response.status_code, 200, response.text)

    def send(self, image: str = JPEG):
        return self.client.post(
            "/api/auth/owner/entry-photo", headers=self.headers, json={"image": image}
        )

    # -- принимается только от вошедшего ------------------------------------- #

    def test_photo_is_stored_after_entering(self) -> None:
        self.open_owner()
        self.assertEqual(self.send().status_code, 201, "снимок не принят")
        self.assertEqual(self.stored(), 1)

    def test_photo_is_refused_without_entering(self) -> None:
        """Иначе журнал можно было бы засыпать чужими картинками, не зная
        ни одного секрета."""
        self.assertEqual(self.send().status_code, 403)
        self.assertEqual(self.stored(), 0)

    def test_photo_is_refused_without_a_session(self) -> None:
        self.assertEqual(
            self.client.post("/api/auth/owner/entry-photo", json={"image": JPEG}).status_code,
            401,
        )

    # -- формат --------------------------------------------------------------- #

    def test_only_jpeg_is_accepted(self) -> None:
        """SVG — исполняемая разметка, а снимок потом показывают владельцу."""
        self.open_owner()
        svg = "data:image/svg+xml;base64," + base64.b64encode(b"<svg/>").decode()
        self.assertEqual(self.send(svg).status_code, 400)
        self.assertEqual(self.send("не картинка вовсе").status_code, 400)
        self.assertEqual(self.stored(), 0)

    # -- журнал и уборка ------------------------------------------------------ #

    def test_entry_is_written_to_the_journal(self) -> None:
        self.open_owner()
        self.assertEqual(self.send().status_code, 201)
        con = sqlite3.connect(_TEMP_DB)
        try:
            count = con.execute(
                "SELECT COUNT(*) FROM audit_entries WHERE action = 'access.photo'"
            ).fetchone()[0]
        finally:
            con.close()
        self.assertGreaterEqual(count, 1)

    def test_old_photos_do_not_pile_up(self) -> None:
        """База ездит в резервных копиях — расти бесконечно ей нельзя."""
        self.open_owner()
        for _ in range(ENTRY_PHOTOS_KEPT + 5):
            self.assertEqual(self.send().status_code, 201)
        self.assertEqual(self.stored(), ENTRY_PHOTOS_KEPT)

    # -- смотрит только владелец ---------------------------------------------- #

    def test_listing_needs_the_owner_door(self) -> None:
        self.open_owner()
        self.assertEqual(self.send().status_code, 201)

        elevation.revoke(self.user_id)
        self.assertEqual(self.client.get("/api/auth/owner/entry-photo", headers=self.headers).status_code, 403)

        self.open_owner()
        listed = self.client.get("/api/auth/owner/entry-photo", headers=self.headers)
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(len(listed.json()), 1)
        self.assertEqual(listed.json()[0]["image"], JPEG)
