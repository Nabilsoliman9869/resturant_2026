"""
تصدير لقطة من جداول TBL الأساسية إلى JSON بصيغة قريبة من tbl_seed_pack_v1.json
لدمجها يدوياً أو استبدال config/tbl_seed_pack_v1.json بعد المراجعة.

الاستخدام (من مجلد backend):
  python tools/export_tbl_seed_from_db.py

يعتمد على backend/config.py (نفس اتصال api_server). يُخرج:
  ../config/tbl_seed_pack_from_db.generated.json

لا يعدّل قاعدة البيانات — قراءة فقط.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

import pyodbc  # noqa: E402

from config import get_connection_string  # noqa: E402


def _rows(cursor, sql, params=()):
    cursor.execute(sql, params)
    cols = [d[0] for d in cursor.description] if cursor.description else []
    out = []
    for row in cursor.fetchall():
        out.append({cols[i]: row[i] for i in range(len(cols))})
    return out


def main() -> None:
    conn = pyodbc.connect(get_connection_string())
    try:
        cur = conn.cursor()
        pack = {
            "meta": {
                "version": "from-db-generated",
                "generator": "export_tbl_seed_from_db.py",
                "warning": "راجع قبل الاستبدال — دمج يدوي مع tbl_seed_pack_v1.json",
            },
            "tables": {},
        }

        t004 = _rows(
            cur,
            """
            SELECT TOP 80 CardCode, AccountName, LatinName, NotActive
            FROM dbo.TBL004
            ORDER BY ID
            """,
        )
        pack["tables"]["TBL004"] = {"business_key": ["CardCode"], "rows": t004}

        t005 = _rows(
            cur,
            """
            SELECT TOP 60 CostCenter, LatinName, CardType, NotActive
            FROM dbo.TBL005
            ORDER BY ID
            """,
        )
        pack["tables"]["TBL005"] = {"business_key": ["CostCenter"], "rows": t005}

        t006 = _rows(
            cur,
            """
            SELECT TOP 400 g.GroupName, g.LatinName, p.GroupName AS MainGroupName
            FROM dbo.TBL006 g
            LEFT JOIN dbo.TBL006 p ON g.MainGuide = p.CardGuide
            ORDER BY g.ID
            """,
        )
        pack["tables"]["TBL006"] = {"business_key": ["GroupName", "MainGroupName"], "rows": t006}

        t007 = _rows(
            cur,
            """
            SELECT TOP 800 p.CardCode, p.ProductName, p.LatinName, g.GroupName,
                   p.AgentPrice, p.EndUserPrice, p.StockProduct, p.NotActive
            FROM dbo.TBL007 p
            INNER JOIN dbo.TBL006 g ON p.GroupGuid = g.CardGuide
            ORDER BY p.ID
            """,
        )
        pack["tables"]["TBL007"] = {"business_key": ["CardCode"], "rows": t007}

        out_path = ROOT / "config" / "tbl_seed_pack_from_db.generated.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(pack, f, ensure_ascii=False, indent=2)
        print(f"OK: wrote {out_path} (rows: TBL004={len(t004)} TBL005={len(t005)} TBL006={len(t006)} TBL007={len(t007)})")
    finally:
        try:
            conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
