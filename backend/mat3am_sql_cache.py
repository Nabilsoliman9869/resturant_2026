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
        }


def _fetch_tbl005_live(get_connection: ConnectionFactory) -> Tuple[List[dict], Optional[str]]:
    conn = get_connection()
    if not conn:
        return [], "no_connection"
    try:
        cursor = conn.cursor()
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


def get_tbl005_cost_centers(get_connection: ConnectionFactory, *, force: bool = False) -> Tuple[List[dict], dict]:
    """قائمة مراكز التكلفة من SQL مع TTL؛ عند الفشل تُجرَّب مرآة JSON."""
    now = time.time()
    with _LOCK:
        if (
            not force
            and _TBL005["rows"] is not None
            and (now - float(_TBL005["fetched_at"] or 0)) < TBL005_TTL_SEC
        ):
            return list(_TBL005["rows"]), {
                "source": "memory",
                "fromMirror": bool(_TBL005["from_mirror"]),
                "error": None,
            }

    rows, err = _fetch_tbl005_live(get_connection)
    from_mirror = False
    if err and not rows:
        mirrored = _read_mirror_rows("tbl005")
        if mirrored:
            rows = mirrored
            from_mirror = True
            err = f"live_failed_using_mirror: {err}"

    with _LOCK:
        _TBL005["rows"] = rows
        _TBL005["fetched_at"] = now
        _TBL005["error"] = err if not rows else None
        _TBL005["from_mirror"] = from_mirror

    if rows and not from_mirror:
        _write_mirror("tbl005", {"rows": rows, "savedAt": time.time()})

    source = "mirror" if from_mirror else ("sql" if rows else "none")
    return rows, {"source": source, "fromMirror": from_mirror, "error": err}


def _fetch_users_live(get_connection: ConnectionFactory) -> Tuple[List[dict], Optional[str]]:
    conn = get_connection()
    if not conn:
        return [], "no_connection"
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT TOP 500 Id, LoginName, DisplayName, RoleCode, IsActive, CreatedAt
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
    get_connection: ConnectionFactory, *, force: bool = False
) -> Tuple[List[dict], dict]:
    """صفوف كتالوج الأصناف النشطة — يُبنى رد API في api_server."""
    now = time.time()
    with _LOCK:
        if (
            not force
            and _TBL007["rows"] is not None
            and (now - float(_TBL007["fetched_at"] or 0)) < TBL007_TTL_SEC
        ):
            return list(_TBL007["rows"]), {
                "source": "memory",
                "fromMirror": bool(_TBL007["from_mirror"]),
                "error": None,
            }

    rows, err = _fetch_tbl007_live(get_connection)
    from_mirror = False
    if err and not rows:
        mirrored = _read_mirror_rows("tbl007")
        if mirrored:
            rows = mirrored
            from_mirror = True
            err = f"live_failed_using_mirror: {err}"

    with _LOCK:
        _TBL007["rows"] = rows
        _TBL007["fetched_at"] = now
        _TBL007["error"] = err if not rows else None
        _TBL007["from_mirror"] = from_mirror

    if rows and not from_mirror:
        _write_mirror("tbl007", {"rows": rows, "savedAt": time.time()})

    source = "mirror" if from_mirror else ("sql" if rows else "none")
    return rows, {"source": source, "fromMirror": from_mirror, "error": err}


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
                    "SampleProductGuide": str(row[5]).strip() if len(row) > 5 and row[5] else None,
                    "SampleProductImageUrl": str(row[6]).strip() if len(row) > 6 and row[6] else None,
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
    get_connection: ConnectionFactory, *, force: bool = False
) -> Tuple[List[dict], dict]:
    now = time.time()
    with _LOCK:
        if (
            not force
            and _TBL006["rows"] is not None
            and (now - float(_TBL006["fetched_at"] or 0)) < TBL006_TTL_SEC
        ):
            return list(_TBL006["rows"]), {
                "source": "memory",
                "fromMirror": bool(_TBL006["from_mirror"]),
                "error": None,
            }

    rows, err = _fetch_tbl006_live(get_connection)
    from_mirror = False
    if err and not rows:
        mirrored = _read_mirror_rows("tbl006")
        if mirrored:
            rows = mirrored
            from_mirror = True
            err = f"live_failed_using_mirror: {err}"

    with _LOCK:
        _TBL006["rows"] = rows
        _TBL006["fetched_at"] = now
        _TBL006["error"] = err if not rows else None
        _TBL006["from_mirror"] = from_mirror

    if rows and not from_mirror:
        _write_mirror("tbl006", {"rows": rows, "savedAt": time.time()})

    source = "mirror" if from_mirror else ("sql" if rows else "none")
    return rows, {"source": source, "fromMirror": from_mirror, "error": err}


def warm(get_connection: ConnectionFactory) -> None:
    get_tbl005_cost_centers(get_connection, force=True)
    get_tbl007_catalog_rows(get_connection, force=True)
    get_tbl006_group_rows(get_connection, force=True)
    get_app_users(get_connection, force=True)
