#!/usr/bin/env python3
"""رفع floor_plan.json المحلي إلى خادم الإنتاج (نفس مسار PUT من محرّر الإعدادات)."""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PLAN = ROOT / "config" / "restaurant" / "floor_plan.json"
DEFAULT_URL = os.environ.get(
    "MAT3AM_PROD_URL", "https://resturant2026-production.up.railway.app"
).rstrip("/")


def main() -> int:
    ap = argparse.ArgumentParser(description="PUT floor plan to production API")
    ap.add_argument("--plan", type=Path, default=DEFAULT_PLAN)
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument(
        "--skip-sync",
        action="store_true",
        help="غير مدعوم على الخادم — PUT دائماً يزامن TBL005",
    )
    args = ap.parse_args()
    if not args.plan.is_file():
        print(f"ملف غير موجود: {args.plan}", file=sys.stderr)
        return 1
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    if not isinstance(plan, dict):
        print("JSON غير صالح", file=sys.stderr)
        return 1
    body = json.dumps({"plan": plan}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{args.url}/api/restaurant/floor-plan",
        data=body,
        method="PUT",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=args.timeout) as resp:
            out = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code}: {err}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"فشل الاتصال: {e}", file=sys.stderr)
        return 1
    meta = out.get("meta") or {}
    print("ok:", out.get("ok"))
    print("path:", meta.get("path"))
    print("tables:", meta.get("tableCount"))
    print("sha256:", meta.get("sha256"))
    print("size:", meta.get("sizeBytes"))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
