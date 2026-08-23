"""Offline vendor-side license key generator.

Not exposed via any API — only ever run by the vendor to hand keys to
customers. Uses the same HMAC secret the running app checks activation
keys against, so anything printed here verifies on a stock install.

Usage:
    python scripts/generate_license_keys.py [COUNT] [--secret SECRET]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.modules.licensing.activation import generate_key  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate offline-verifiable NurCRM license keys.")
    parser.add_argument("count", type=int, nargs="?", default=1)
    parser.add_argument(
        "--secret", default=None, help="Override the HMAC secret (defaults to the app's configured secret)."
    )
    args = parser.parse_args()
    secret = args.secret or get_settings().license_hmac_secret
    for _ in range(args.count):
        print(generate_key(secret))


if __name__ == "__main__":
    main()
