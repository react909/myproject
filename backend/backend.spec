# -*- mode: python ; coding: utf-8 -*-

import os

block_cipher = None

# Alembic reads alembic.ini + alembic/env.py + alembic/versions/*.py from
# disk at runtime (app.core.migrations invokes it programmatically) — these
# aren't Python imports, so PyInstaller's import scanner can't find them on
# its own and they must be listed as data files explicitly.
_backend_dir = SPECPATH
_alembic_datas = [
    (os.path.join(_backend_dir, 'alembic.ini'), '.'),
    (os.path.join(_backend_dir, 'alembic'), 'alembic'),
]

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=_alembic_datas,
    hiddenimports=['app.main', 'psycopg', 'psycopg_binary', 'alembic'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
)
