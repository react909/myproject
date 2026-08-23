from __future__ import annotations

import asyncio
import contextlib
import logging
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from app.core import sync
from app.core.config import get_settings
from app.db.database import init_db
from app.modules.analytics.router import router as analytics_router
from app.modules.auth.router import router as auth_router
from app.modules.diagnostics.router import router as diagnostics_router
from app.modules.finance.router import router as finance_router
from app.modules.panel.router import router as panel_router
from app.modules.payments.router import router as payments_router
from app.modules.products import media as product_media
from app.modules.products.router import router as products_router
from app.modules.purchases.router import router as purchases_router
from app.modules.sales.router import router as sales_router
from app.modules.settings.router import router as settings_router
from app.modules.setup.router import router as setup_router
from app.modules.shifts.router import router as shifts_router
from app.modules.stock.router import router as stock_router
from app.modules.suppliers.router import router as suppliers_router
from app.modules.users.router import router as users_router

settings = get_settings()

app = FastAPI(title=settings.app_name, version=settings.app_version)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:4173",
        "http://localhost:4173",
        "file://",
        "null",
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup() -> None:
    await init_db()
    await sync.recover_stuck_entries()
    # Временные файлы фото и видео, за которыми никто не пришёл.
    #
    # Каждый прерванный ввод товара оставляет здесь снимок. Уборка на запуске,
    # а не по таймеру: касса перезапускается каждый день вместе с рабочим
    # местом, а фоновый таймер ради этого — лишняя задача в цикле событий,
    # который обслуживает продажи.
    try:
        await asyncio.to_thread(product_media.sweep_staged)
    except OSError:
        logging.getLogger("nurcrm.media").exception("уборка временных файлов не удалась")
    app.state.sync_task = asyncio.create_task(sync.sync_worker_loop())


@app.on_event("shutdown")
async def on_shutdown() -> None:
    task: asyncio.Task | None = getattr(app.state, "sync_task", None)
    if task is not None:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


@app.get("/health")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok", "app": settings.app_name, "version": settings.app_version}


app.include_router(setup_router)
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(products_router)
app.include_router(stock_router)
app.include_router(sales_router)
app.include_router(panel_router)
app.include_router(payments_router)
app.include_router(shifts_router)
app.include_router(purchases_router)
app.include_router(suppliers_router)
app.include_router(settings_router)
app.include_router(analytics_router)
app.include_router(finance_router)
app.include_router(diagnostics_router)
