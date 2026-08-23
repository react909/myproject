from __future__ import annotations

from enum import StrEnum

from app.db.models import StoreSettings


class LicensePlan(StrEnum):
    START = "start"
    STANDARD = "standard"


class LicenseManager:
    """Owns edition changes without coupling them to setup or UI code."""

    def activate(self, store: StoreSettings, plan: LicensePlan) -> None:
        # The installation identifier and all business data remain unchanged.
        store.license_plan = plan.value
        store.edition = plan.value  # legacy compatibility for existing clients
        # A freshly-constructed StoreSettings() has license_revision=None in
        # Python until it's actually flushed (column defaults apply at
        # INSERT time, not on instantiation) — this runs before that flush.
        store.license_revision = (store.license_revision or 0) + 1

    def has_feature(self, store: StoreSettings, feature: str) -> bool:
        standard_only = {"advanced_reports", "extended_finance", "multi_workplace"}
        return feature not in standard_only or store.license_plan == LicensePlan.STANDARD
