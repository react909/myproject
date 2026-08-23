from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import StoreSettings, User


class SetupRepository:
    """Database operations for the first-run workflow only."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_store(self) -> StoreSettings | None:
        return (await self._session.execute(select(StoreSettings).limit(1))).scalar_one_or_none()

    async def get_administrator(self) -> User | None:
        statement = select(User).where(User.is_active.is_(True), User.role.in_(("owner", "admin"))).limit(1)
        return (await self._session.execute(statement)).scalar_one_or_none()

    async def get_user_by_username(self, username: str) -> User | None:
        return (await self._session.execute(select(User).where(User.username == username))).scalar_one_or_none()

    def add_store(self, store: StoreSettings) -> None:
        self._session.add(store)

    def add_user(self, user: User) -> None:
        self._session.add(user)

    @property
    def session(self) -> AsyncSession:
        """Сессия для работы с картинками установки — см. images.py."""
        return self._session

    async def save(self) -> None:
        await self._session.commit()

    async def refresh(self, entity: StoreSettings | User) -> None:
        await self._session.refresh(entity)
