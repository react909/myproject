"""Убрать из демо-базы пустые черновики, оставшиеся от прогонов съёмки.

Каждый прогон снимка «новая закупка» заводит документ, и после десятка
прогонов список состоит из пустых черновиков — на снимке это выглядит как
мусор в системе, хотя мусор наш, а не её.

Только для демо-базы. В рабочей системе документы не удаляются физически, и
здесь это допустимо ровно потому, что база нужна на один снимок.

Запуск: python tools\\clean_demo_drafts.py <путь к demo.db>
"""

from __future__ import annotations

import sqlite3
import sys

if len(sys.argv) < 2:
    print("нужен путь к базе", file=sys.stderr)
    sys.exit(1)

connection = sqlite3.connect(sys.argv[1])
empty = "SELECT id FROM purchase_docs WHERE positions_count = 0 AND status = 'draft'"
ids = [row[0] for row in connection.execute(empty).fetchall()]
connection.execute(f"DELETE FROM purchase_lines WHERE doc_id IN ({empty})")
connection.execute(f"DELETE FROM purchase_docs WHERE id IN ({empty})")
connection.commit()
print(f"убрано пустых черновиков: {len(ids)}")
print(f"осталось документов: {connection.execute('SELECT COUNT(*) FROM purchase_docs').fetchone()[0]}")
