"""Токен демо-магазина одной строкой в stdout. Используется скриптом съёмки."""

from __future__ import annotations

import json
import urllib.request

body = json.dumps({"username": "demo@kassir.kg", "password": "Parol12345"}).encode()
request = urllib.request.Request(
    "http://127.0.0.1:8000/api/auth/login", data=body, method="POST"
)
request.add_header("Content-Type", "application/json")
with urllib.request.urlopen(request, timeout=15) as response:
    print(json.load(response)["access_token"])
