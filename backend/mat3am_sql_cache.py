"""تخزين مؤقت لقراءات SQL الثقيلة (TBL005، TBL006، TBL007، MAT3AM_APP_USERS) + مرآة JSON.

الهدف: تقليل فتح اتصال ODBC المتكرر من Railway إلى SQL Server (≈10–20 ثانية/طلب)
وإتاحة عرض بيانات قديمة من المرآة عند انقطاع مؤقت للاتصال.
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Callable, List, Optional, Tuple

_LOCK = threading.Lock()
_REFRESH_TAGS: set[str] = set()
_MIRROR_DIR: Optional[str] = None

_TBL005: dict = {"rows": None, "fetched_at": 0.0, "error": None, "from_mirror": False}
_TBL007: dict = {"rows": None, "fetched_at": 0.0, "error": None, "from_mirror": False}
_TBL006: dict = {"rows": None, "fetched_at": 0.0, "error": None, "from_mirror": False}
_USERS: dict = {"users": None, "fetched_at": 0.0, "error": None}

def _ttl_sec(name: str, default: float) -> float:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return max(15.0, min(600.0, float(raw)))
    except ValueError:
        return default


TBL005_TTL_SEC = _ttl_sec("MAT3AM_TBL005_CACHE_TTL", 120.0)
TBL007_TTL_SEC = _ttl_sec("MAT3AM_TBL007_CACHE_TTL", 300.0)
TBL006_TTL_SEC = _ttl_sec("MAT3AM_TBL006_CACHE_TTL", 300.0)
USERS_TTL_SEC = _ttl_sec("MAT3AM_USERS_CACHE_TTL", 90.0)

# عند التفعيل: قراءات GET المرجعية من الذاكرة/المرآة فقط — لا ODBC في الخلفية عند انتهاء TTL.
def reference_cache_only_enabled() -> bool:
    raw = (os.environ.get("MAT3AM_REFERENCE_CACHE_ONLY") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


ConnectionFactory = Callable[[], Any]


def configure_mirror_dir(base_data_dir: str) -> None:
    global _MIRROR_DIR
    p = os.path.join(base_data_dir, "config", "restaurant", "sql_mirror")
    os.makedirs(p, exist_ok=True)
    _MIRROR_DIR = p


def _mirror_path(name: str) -> Optional[str]:
    if not _MIRROR_DIR:
        return None
    return os.path.join(_MIRROR_DIR, f"{name}.json")


def _write_mirror(name: str, payload: dict) -> None:
    path = _mirror_path(name)
    if not path:
        return
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _read_mirror_rows(name: str) -> Optional[List[dict]]:
    path = _mirror_path(name)
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            d = json.load(f)
        rows = d.get("rows") if isinstance(d, dict) else None
        if isinstance(rows, list):
            return rows
    except Exception:
        pass
    return None


def _bg_refresh(tag: str, fn: Callable[[], None]) -> None:
    with _LOCK:
        if tag in _REFRESH_TAGS:
            return
        _REFRESH_TAGS.add(tag)

    def _run() -> None:
        try:
            fn()
        finally:
            with _LOCK:
                _REFRESH_TAGS.discard(tag)

    threading.Thread(target=_run, daemon=True, name=f"cache-refresh-{tag}").start()


def _load_rows_slot(
    slot: dict,
    mirror_name: str,
    fetch_live: Callable[[], Tuple[List[dict], Optional[str]]],
    *,
    now: Optional[float] = None,
) -> Tuple[List[dict], dict]:
    """جلب من SQL + تحديث الذاكرة والمرآة."""
    now = now if now is not None else time.time()
    rows, err = fetch_live()
    from_mirror = False
    if err and not rows:
        mirrored = _read_mirror_rows(mirror_name)
        if mirrored:
            rows = mirrored
            from_mirror = True
            err = f"live_failed_using_mirror: {err}"

    with _LOCK:
        slot["rows"] = rows
        slot["fetched_at"] = now
        slot["error"] = err if not rows else None
        slot["from_mirror"] = from_mirror

    if rows and not from_mirror:
        _write_mirror(mirror_name, {"rows": rows, "savedAt": now})

    if from_mirror:
        source = "mirror"
    elif rows:
        source = "sql"
    else:
        source = "none"
    return rows, {"source": source, "fromMirror": from_mirror, "error": err, "stale": False}


def _get_rows_cached(
    slot: dict,
    ttl: float,
    mirror_name: str,
    tag: str,
    fetch_live: Callable[[], Tuple[List[dict], Optional[str]]],
    *,
    force: bool = False,
    allow_live: bool = True,
) -> Tuple[List[dict], dict]:
    """ذاكرة + stale-while-revalidate: عند انتهاء TTL يُعاد الكاش القديم فوراً ويُحدَّث بالخلفية."""
    now = time.time()
    with _LOCK:
        rows = slot["rows"]
        fetched = float(slot["fetched_at"] or 0)
        age = (now - fetched) if rows is not None else None

    if rows is not None and not force:
        if age is not None and age < ttl:
            return list(rows), {
                "source": "memory",
                "fromMirror": bool(slot["from_mirror"]),
                "error": None,
                "stale": False,
            }
        if not allow_live:
            return list(rows), {
                "source": "memory-stale",
                "fromMirror": bool(slot["from_mirror"]),
                "error": slot.get("error"),
                "stale": True,
            }
        # منتهي TTL — أعد القديم الآن وحدّث بالخلفية
        _bg_refresh(tag, lambda: _load_rows_slot(slot, mirror_name, fetch_live))

        return list(rows), {
            "source": "memory-stale",
            "fromMirror": bool(slot["from_mirror"]),
            "error": slot.get("error"),
            "stale": True,
        }

    if not allow_live and not force:
        mirrored = _read_mirror_rows(mirror_name)
        if mirrored:
            with _LOCK:
                slot["rows"] = mirrored
                slot["fetched_at"] = now
                slot["error"] = None
                slot["from_mirror"] = True
            return list(mirrored), {
                "source": "mirror",
                "fromMirror": True,
                "error": None,
                "stale": False,
            }
        if rows is not None:
            return list(rows), {
                "source": "memory",
                "fromMirror": bool(slot["from_mirror"]),
                "error": slot.get("error"),
                "stale": True,
            }
        return [], {
            "source": "none",
            "fromMirror": False,
            "error": "reference_cache_empty",
            "stale": False,
        }

    return _load_rows_slot(slot, mirror_name, fetch_live, now=now)


def invalidate_tbl005() -> None:
    with _LOCK:
        _TBL005["rows"] = None
        _TBL005["fetched_at"] = 0.0
        _TBL005["error"] = None
        _TBL005["from_mirror"] = False


def invalidate_users() -> None:
    with _LOCK:
        _USERS["users"] = None
        _USERS["fetched_at"] = 0.0
        _USERS["error"] = None


def invalidate_tbl007() -> None:
    with _LOCK:
        _TBL007["rows"] = None
        _TBL007["fetched_at"] = 0.0
        _TBL007["error"] = None
        _TBL007["from_mirror"] = False


def invalidate_tbl006() -> None:
    with _LOCK:
        _TBL006["rows"] = None
        _TBL006["fetched_at"] = 0.0
        _TBL006["error"] = None
        _TBL006["from_mirror"] = False


def invalidate_menu_catalog() -> None:
    """بعد تعديل أصناف أو مجموعات."""
    invalidate_tbl007()
    invalidate_tbl006()


def status() -> dict:
    with _LOCK:
        now = time.time()
        t_age = (now - float(_TBL005["fetched_at"] or 0)) if _TBL005["rows"] is not None else None
        u_age = (now - float(_USERS["fetched_at"] or 0)) if _USERS["users"] is not None else None
        p_age = (now - float(_TBL007["fetched_at"] or 0)) if _TBL007["rows"] is not None else None
        g_age = (now - float(_TBL006["fetched_at"] or 0)) if _TBL006["rows"] is not None else None
        return {
            "tbl005": {
                "cached": _TBL005["rows"] is not None,
                "count": len(_TBL005["rows"] or []),
                "ageSec": round(t_age, 1) if t_age is not None else None,
                "fromMirror": bool(_TBL005["from_mirror"]),
                "lastError": _TBL005["error"],
            },
            "appUsers": {
                "cached": _USERS["users"] is not None,
                "count": len(_USERS["users"] or []),
                "ageSec": round(u_age, 1) if u_age is not None else None,
                "lastError": _USERS["error"],
            },
            "tbl007": {
                "cached": _TBL007["rows"] is not None,
                "count": len(_TBL007["rows"] or []),
                "ageSec": round(p_age, 1) if p_age is not None else None,
                "ttlSec": TBL007_TTL_SEC,
                "fromMirror": bool(_TBL007["from_mirror"]),
                "lastError": _TBL007["error"],
            },
            "tbl006": {
                "cached": _TBL006["rows"] is not None,
                "count": len(_TBL006["rows"] or []),
                "ageSec": round(g_age, 1) if g_age is not None else None,
                "ttlSec": TBL006_TTL_SEC,
                "fromMirror": bool(_TBL006["from_mirror"]),
                "lastError": _TBL006["error"],
            },
            "mirrorDir": _MIRROR_DIR,
            "referenceCacheOnly": reference_cache_only_enabled(),
        }


def _fetch_tbl005_live(get_connection: ConnectionFactory) -> Tuple[List[dict], Optional[str]]:
    conn = get_connection()
    if not conn:
        return [], "no_connection"
    try:
        cursor = conn.cursor()
        cursor.execute("SET LOCK_TIMEOUT 3000")
        cursor.execute(
            """
            SELECT CardGuide, CostCenter
            FROM dbo.TBL005
            WHERE CostCenter IS NOT NULL
              AND ISNULL(NotActive, 0) = 0
            ORDER BY CostCenter
            """
        )
        rows: List[dict] = []
        for row in cursor.fetchall() or []:
            gid = str(row[0] or "").strip()
            nm = str(row[1] or "").strip()
            if gid:
                rows.append({"id": gid, "name": nm})
        return rows, None
    except Exception as e:
        return [], str(e)[:400]
    finally:
        try:
            conn.close()
        except Exception:
            pass


def get_tbl005_cost_centers(
    get_connection: ConnectionFactory, *, force: bool = False, allow_live: Optional[bool] = None
) -> Tuple[List[dict], dict]:
    """قائمة مراكز التكلفة من SQL مع TTL؛ عند الفشل تُجرَّب مرآة JSON."""
    live = allow_live if allow_live is not None else (not reference_cache_only_enabled())
    return _get_rows_cached(
        _TBL005,
        TBL005_TTL_SEC,
        "tbl005",
        "tbl005",
        lambda: _fetch_tbl005_live(get_connection),
        force=force,
        allow_live=live,
    )


def _fetch_users_live(get_connection: ConnectionFactory) -> Tuple[List[dict], Optional[str]]:
    conn = get_connection()
    if not conn:
        return [], "no_connection"
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT TOP 500 Id, LoginName, DisplayName, RoleCode, IsActive, CreatedAt, PinHash, SpecialistStationCode
            FROM dbo.MAT3AM_APP_USERS
            ORDER BY CreatedAt DESC
            """
        )
        users: List[dict] = []
        for r in cursor.fetchall() or []:
            users.append(
                {
                    "id": str(r[0]),
                    "login": str(r[1] or ""),
                    "name": str(r[2] or r[1] or ""),
                    "role": str(r[3] or "").lower(),
                    "isActive": bool(r[4]) if r[4] is not None else True,
                    "createdAt": str(r[5]) if r[5] else "",
                    "pinHash": str(r[6] or "").strip() if len(r) > 6 else "",
                    "specialistStationCode": str(r[7] or "").strip().lower() if len(r) > 7 and r[7] else "",
                }
            )
        return users, None
    except Exception as e:
        return [], str(e)[:400]
    finally:
        try:
            conn.close()
        except Exception:
            pass


def get_app_users(get_connection: ConnectionFactory, *, force: bool = False) -> Tuple[List[dict], dict]:
    now = time.time()
    with _LOCK:
        if (
            not force
            and _USERS["users"] is not None
            and (now - float(_USERS["fetched_at"] or 0)) < USERS_TTL_SEC
        ):
            return list(_USERS["users"]), {"source": "memory", "error": None}

    users, err = _fetch_users_live(get_connection)
    with _LOCK:
        _USERS["users"] = users
        _USERS["fetched_at"] = now
        _USERS["error"] = err if not users else None

    if users:
        _write_mirror("app_users", {"users": users, "savedAt": time.time()})

    return users, {"source": "sql" if users else "none", "error": err}


def _fetch_tbl007_live(get_connection: ConnectionFactory) -> Tuple[List[dict], Optional[str]]:
    conn = get_connection()
    if not conn:
        return [], "no_connection"
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT CardGuide, ProductName, LatinName, EndUserPrice, AgentPrice, GroupGuid, ProductImageUrl, Hieght3
            FROM dbo.TBL007
            WHERE ProductName IS NOT NULL AND (NotActive = 0 OR NotActive IS NULL)
            ORDER BY ProductName
            """
        )
        rows: List[dict] = []
        for row in cursor.fetchall() or []:
            guid = str(row[0] or "").strip()
            if not guid:
                continue
            rows.append(
                {
                    "CardGuide": guid,
                    "ProductName": row[1],
                    "LatinName": row[2],
                    "EndUserPrice": row[3],
                    "AgentPrice": row[4],
                    "GroupGuid": str(row[5]).strip() if row[5] is not None else None,
                    "ProductImageUrl": str(row[6]).strip() if len(row) > 6 and row[6] else None,
                    "Hieght3": row[7] if len(row) > 7 else None,
                }
            )
        return rows, None
    except Exception as e:
        return [], str(e)[:400]
    finally:
        try:
            conn.close()
        except Exception:
            pass


def get_tbl007_catalog_rows(
    get_connection: ConnectionFactory, *, force: bool = False, allow_live: Optional[bool] = None
) -> Tuple[List[dict], dict]:
    """صفوف كتالوج الأصناف النشطة — يُبنى رد API في api_server."""
    live = allow_live if allow_live is not None else (not reference_cache_only_enabled())
    return _get_rows_cached(
        _TBL007,
        TBL007_TTL_SEC,
        "tbl007",
        "tbl007",
        lambda: _fetch_tbl007_live(get_connection),
        force=force,
        allow_live=live,
    )


def _fetch_tbl006_live(get_connection: ConnectionFactory) -> Tuple[List[dict], Optional[str]]:
    conn = get_connection()
    if not conn:
        return [], "no_connection"
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                g.CardGuide,
                g.MainGuide,
                g.LatinName,
                g.GroupName,
                g.GroupImageUrl,
                g.TextValue01,
                g.TextValue02,
                s.ProductGuide,
                s.ProductImageUrl
            FROM dbo.TBL006 g
            OUTER APPLY (
                SELECT TOP 1
                    p.CardGuide AS ProductGuide,
                    p.ProductImageUrl
                FROM dbo.TBL007 p
                WHERE p.GroupGuid = g.CardGuide AND (p.NotActive = 0 OR p.NotActive IS NULL)
                ORDER BY
                    CASE WHEN p.ProductImageUrl IS NULL OR LTRIM(RTRIM(p.ProductImageUrl)) = '' THEN 1 ELSE 0 END,
                    p.ProductName
            ) s
            WHERE g.GroupName IS NOT NULL
            ORDER BY g.GroupName
            """
        )
        rows: List[dict] = []
        for row in cursor.fetchall() or []:
            gid = str(row[0] or "").strip()
            if not gid:
                continue
            rows.append(
                {
                    "CardGuide": gid,
                    "MainGuide": str(row[1]).upper() if len(row) > 1 and row[1] else "",
                    "LatinName": row[2] or "",
                    "GroupName": row[3],
                    "GroupImageUrl": str(row[4]).strip() if len(row) > 4 and row[4] else None,
                    "TextValue01": str(row[5]).strip() if len(row) > 5 and row[5] else "",
                    "DisplayCategory": str(row[6]).strip() if len(row) > 6 and row[6] else "",
                    "SampleProductGuide": str(row[7]).strip() if len(row) > 7 and row[7] else None,
                    "SampleProductImageUrl": str(row[8]).strip() if len(row) > 8 and row[8] else None,
                }
            )
        return rows, None
    except Exception as e:
        return [], str(e)[:400]
    finally:
        try:
            conn.close()
        except Exception:
            pass


def get_tbl006_group_rows(
    get_connection: ConnectionFactory, *, force: bool = False, allow_live: Optional[bool] = None
) -> Tuple[List[dict], dict]:
    live = allow_live if allow_live is not None else (not reference_cache_only_enabled())
    return _get_rows_cached(
        _TBL006,
        TBL006_TTL_SEC,
        "tbl006",
        "tbl006",
        lambda: _fetch_tbl006_live(get_connection),
        force=force,
        allow_live=live,
    )


def warm_catalog_only(get_connection: ConnectionFactory) -> None:
    """تسخين الكتالوج أولاً — أهم مسار لسرعة صفحة الطلب."""
    get_tbl007_catalog_rows(get_connection, force=True, allow_live=True)
    get_tbl006_group_rows(get_connection, force=True, allow_live=True)
    get_tbl005_cost_centers(get_connection, force=True, allow_live=True)


def warm(get_connection: ConnectionFactory) -> None:
    warm_catalog_only(get_connection)
    get_app_users(get_connection, force=True)


def refresh_all_reference_data(
    get_connection: ConnectionFactory, *, include_users: bool = True
) -> dict:
    """إعادة بناء كامل للبيانات المرجعية من SQL (مدير/مطوّر — زر «تحديث الآن»)."""
    import time as _time

    t0 = _time.perf_counter()
    p_rows, p_meta = get_tbl007_catalog_rows(get_connection, force=True, allow_live=True)
    g_rows, g_meta = get_tbl006_group_rows(get_connection, force=True, allow_live=True)
    t_rows, t_meta = get_tbl005_cost_centers(get_connection, force=True, allow_live=True)
    u_count = 0
    u_meta: dict = {"skipped": True}
    if include_users:
        users, u_meta = get_app_users(get_connection, force=True)
        u_count = len(users or [])
    elapsed_ms = round((_time.perf_counter() - t0) * 1000, 1)
    return {
        "ok": True,
        "elapsedMs": elapsed_ms,
        "tbl007": {"count": len(p_rows or []), "source": p_meta.get("source"), "error": p_meta.get("error")},
        "tbl006": {"count": len(g_rows or []), "source": g_meta.get("source"), "error": g_meta.get("error")},
        "tbl005": {"count": len(t_rows or []), "source": t_meta.get("source"), "error": t_meta.get("error")},
        "appUsers": {"count": u_count, "source": u_meta.get("source"), "error": u_meta.get("error"), "skipped": u_meta.get("skipped")},
        "cache": status(),
    }


def find_user_for_login(
    get_connection: ConnectionFactory, login_name: str, pin: str
) -> Tuple[Optional[dict], str]:
    """
    تحقق سريع من الذاكرة/المرآة أولاً (بدون DDL).
    يُرجع (صف مستخدم داخلي أو None, مصدر: memory|sql-miss|invalid).
    """
    ln = str(login_name or "").strip().lower()
    pw = str(pin or "").strip()
    if not ln or not pw:
        return None, "empty"

    users, meta = get_app_users(get_connection)
    if users and meta.get("source") in ("memory", "memory-stale", "sql", "mirror"):
        for u in users:
            if str(u.get("login") or "").strip().lower() != ln:
                continue
            if u.get("isActive") is False:
                return None, "inactive"
            if str(u.get("pinHash") or "").strip() != pw:
                return None, "bad-pin"
            return u, "memory"
    return None, "sql-miss"
