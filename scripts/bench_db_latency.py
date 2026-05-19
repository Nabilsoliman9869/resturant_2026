#!/usr/bin/env python3
"""قياس بطء قاعدة البيانات — محلي أو عبر API.

أمثلة:
  python scripts/bench_db_latency.py
  python scripts/bench_db_latency.py --api http://127.0.0.1:2288
  python scripts/bench_db_latency.py --api http://127.0.0.1:2288 --cold
  python scripts/bench_db_latency.py --repeat 3
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(ROOT / "backend"))


def fetch_json(url: str, timeout: float = 120.0) -> tuple[float, dict]:
    t0 = time.perf_counter()
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8", errors="replace")
    ms = round((time.perf_counter() - t0) * 1000, 1)
    return ms, json.loads(body)


def run_via_api(base: str, cold: bool, repeat: int) -> int:
    base = base.rstrip("/")
    print(f"API base: {base}\n")
    try:
        ping_ms, ping = fetch_json(f"{base}/api/ping", timeout=15)
        print(f"  /api/ping                    {ping_ms:>8.1f} ms  ok={ping.get('ok')}")
    except Exception as e:
        print(f"  /api/ping FAILED: {e}")
        return 1

    for i in range(repeat):
        label = f"run {i + 1}/{repeat}"
        url = f"{base}/api/mat3am/perf-probe?cold={'1' if cold else '0'}"
        try:
            wall_ms, data = fetch_json(url, timeout=180)
        except urllib.error.HTTPError as e:
            print(f"  perf-probe HTTP {e.code}: {e.read().decode()[:500]}")
            return 1
        except Exception as e:
            print(f"  perf-probe FAILED: {e}")
            return 1

        print(f"\n=== {label} (HTTP wall {wall_ms} ms, probe total {data.get('totalMs')} ms) ===")
        for step in data.get("steps") or []:
            print(f"  {step.get('name', '?'):<42} {step.get('ms', 0):>8.1f} ms")
        interp = data.get("interpretation") or {}
        if interp:
            print("  flags:", ", ".join(k for k, v in interp.items() if v))
        for h in data.get("hints") or []:
            print(f"  → {h}")

    print("\nللمقارنة: شغّل مرة بـ --cold ومرة بدونه لرؤية فرق كاش TBL005.")
    return 0


def run_direct() -> int:
    """استدعاء مباشر بدون HTTP (يتطلب إعدادات backend صحيحة)."""
    try:
        import api_server as srv
    except Exception as e:
        print(f"تعذر استيراد api_server: {e}")
        return 1
    print("Direct probe (no HTTP):\n")
    data = srv._mat3am_perf_probe_sync(cold_cache=False)
    for step in data.get("steps") or []:
        print(f"  {step.get('name', '?'):<42} {step.get('ms', 0):>8.1f} ms")
    print(f"\n  totalMs={data.get('totalMs')}")
    for h in data.get("hints") or []:
        print(f"  → {h}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Bench DB/API latency for مطاعم")
    p.add_argument("--api", default="", help="مثال: http://127.0.0.1:2288")
    p.add_argument("--cold", action="store_true", help="إجبار جلب TBL005 من SQL")
    p.add_argument("--repeat", type=int, default=1, help="تكرار perf-probe")
    p.add_argument("--direct", action="store_true", help="استدعاء Python مباشر")
    args = p.parse_args()

    if args.direct:
        return run_direct()
    base = (args.api or "").strip() or "http://127.0.0.1:2288"
    return run_via_api(base, args.cold, max(1, args.repeat))


if __name__ == "__main__":
    raise SystemExit(main())
