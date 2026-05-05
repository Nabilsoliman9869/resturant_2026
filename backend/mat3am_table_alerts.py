"""
تنبيهات الطاولة الصريحة (من طلب، دور، نص) — جدول SQL مع احتياط JSON عند غياب الجدول.
يُستدعى من api_server فقط لتفادي تعقيد الاستيراد الدائري.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

TABLE_NAME = "MAT3AM_RESTAURANT_TABLE_ALERT"
JSON_FILENAME = "table_alerts.json"

# أنواع التنبيه المسموحة (يجب مزامنتها مع الواجهة)
VALID_ALERT_KINDS: Tuple[str, ...] = (
    "kitchen_urgent",
    "quick_clean",
    "waiter_add_order",
    "wrap_leftovers",
    "general_service",
)

ALERT_KIND_LABEL_AR: Dict[str, str] = {
    "kitchen_urgent": "استعجال المطبخ",
    "quick_clean": "نظافة سريعة",
    "waiter_add_order": "استدعاء جرسون الطلبات",
    "wrap_leftovers": "تغليف المتبقي",
    "general_service": "خدمة عامة",
}


def alerts_json_path(restaurant_dir: str) -> str:
    os.makedirs(restaurant_dir, exist_ok=True)
    return os.path.join(restaurant_dir, JSON_FILENAME)


def ensure_mat3am_restaurant_table_alert_schema(cursor) -> None:
    """إنشاء الجدول إن لم يكن موجوداً؛ إضافة أعمدة ناقصة فقط (لا تكرار)."""
    cursor.execute(
        f"""
        IF OBJECT_ID(N'dbo.{TABLE_NAME}', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.{TABLE_NAME} (
                Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
                SessionId NVARCHAR(120) NULL,
                TableId NVARCHAR(120) NOT NULL,
                AlertKind NVARCHAR(80) NOT NULL,
                Title NVARCHAR(260) NULL,
                BodyText NVARCHAR(MAX) NULL,
                RequestedByRole NVARCHAR(80) NULL,
                RequestedByName NVARCHAR(200) NULL,
                CreatedAt DATETIME2 NOT NULL,
                ClearedAt DATETIME2 NULL
            );
            CREATE INDEX IX_MAT3AM_TAL_TABLE ON dbo.{TABLE_NAME}(TableId);
            CREATE INDEX IX_MAT3AM_TAL_SESS ON dbo.{TABLE_NAME}(SessionId);
            CREATE INDEX IX_MAT3AM_TAL_CLR ON dbo.{TABLE_NAME}(ClearedAt);
        END
        """
    )
    # أعمدة اختيارية فقط — لا نضيف NOT NULL على جداول قديمة فارغة قد تحتاج ترحيلًا يدويًا
    alter_pairs = [
        ("SessionId", "NVARCHAR(120) NULL"),
        ("Title", "NVARCHAR(260) NULL"),
        ("BodyText", "NVARCHAR(MAX) NULL"),
        ("RequestedByRole", "NVARCHAR(80) NULL"),
        ("RequestedByName", "NVARCHAR(200) NULL"),
        ("ClearedAt", "DATETIME2 NULL"),
    ]
    for col, typ in alter_pairs:
        cursor.execute(
            f"""
            IF OBJECT_ID(N'dbo.{TABLE_NAME}', N'U') IS NOT NULL
              AND COL_LENGTH('dbo.{TABLE_NAME}', '{col}') IS NULL
            ALTER TABLE dbo.{TABLE_NAME} ADD [{col}] {typ};
            """
        )


def _row_to_dict(
    rid: Any,
    sid: Any,
    tid: Any,
    kind: Any,
    title: Any,
    body: Any,
    rrole: Any,
    rname: Any,
    cre: Any,
    clr: Any,
) -> Dict[str, Any]:
    k = str(kind or "").strip().lower()
    return {
        "id": str(rid),
        "sessionId": str(sid).strip() if sid else None,
        "tableId": str(tid or "").strip(),
        "alertKind": k,
        "alertKindLabel": ALERT_KIND_LABEL_AR.get(k, k),
        "title": str(title or "").strip() or None,
        "bodyText": str(body or "").strip() or None,
        "requestedByRole": str(rrole or "").strip() or None,
        "requestedByName": str(rname or "").strip() or None,
        "createdAt": cre.isoformat() if hasattr(cre, "isoformat") else str(cre or ""),
        "clearedAt": clr.isoformat() if clr and hasattr(clr, "isoformat") else (str(clr) if clr else None),
    }


def table_exists(cursor) -> bool:
    try:
        cursor.execute(f"SELECT OBJECT_ID(N'dbo.{TABLE_NAME}', N'U')")
        r = cursor.fetchone()
        return bool(r and r[0])
    except Exception:
        return False


def json_load_all(restaurant_dir: str) -> List[dict]:
    p = alerts_json_path(restaurant_dir)
    if not os.path.isfile(p):
        return []
    try:
        with open(p, "r", encoding="utf-8") as f:
            raw = json.load(f)
        rows = raw.get("alerts") if isinstance(raw, dict) else None
        return [x for x in rows if isinstance(x, dict)] if isinstance(rows, list) else []
    except Exception:
        return []


def json_save_all(restaurant_dir: str, rows: List[dict]) -> None:
    p = alerts_json_path(restaurant_dir)
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"alerts": rows}, f, ensure_ascii=False, indent=2)


def list_active_sql(cursor, table_id: Optional[str] = None, session_id: Optional[str] = None) -> List[dict]:
    tid = str(table_id or "").strip().upper()
    sid = str(session_id or "").strip()
    sql = (
        f"SELECT Id, SessionId, TableId, AlertKind, Title, BodyText, RequestedByRole, RequestedByName, CreatedAt, ClearedAt "
        f"FROM dbo.{TABLE_NAME} WHERE ClearedAt IS NULL "
    )
    params: Tuple = ()
    if tid and sid:
        sql += " AND (UPPER(TableId) = ? OR SessionId = ?)"
        params = (tid, sid)
    elif tid:
        sql += " AND UPPER(TableId) = ?"
        params = (tid,)
    elif sid:
        sql += " AND SessionId = ?"
        params = (sid,)
    sql += " ORDER BY CreatedAt DESC"
    cursor.execute(sql, params)
    out: List[dict] = []
    for row in cursor.fetchall() or []:
        out.append(_row_to_dict(*row))
    return out


def list_active_json(restaurant_dir: str, table_id: Optional[str] = None, session_id: Optional[str] = None) -> List[dict]:
    tid_u = str(table_id or "").strip().upper()
    sid = str(session_id or "").strip()
    out: List[dict] = []
    for r in json_load_all(restaurant_dir):
        if str(r.get("clearedAt") or "").strip():
            continue
        rt = str(r.get("tableId") or "").strip().upper()
        rs = str(r.get("sessionId") or "").strip()
        if tid_u and sid:
            if rt != tid_u and rs != sid:
                continue
        elif tid_u:
            if rt != tid_u:
                continue
        elif sid:
            if rs != sid:
                continue
        k = str(r.get("alertKind") or "").strip().lower()
        base = {
            "id": str(r.get("id") or ""),
            "sessionId": r.get("sessionId"),
            "tableId": rt or str(r.get("tableId") or ""),
            "alertKind": k,
            "alertKindLabel": ALERT_KIND_LABEL_AR.get(k, k),
            "title": r.get("title"),
            "bodyText": r.get("bodyText"),
            "requestedByRole": r.get("requestedByRole"),
            "requestedByName": r.get("requestedByName"),
            "createdAt": str(r.get("createdAt") or ""),
            "clearedAt": r.get("clearedAt"),
        }
        out.append(base)
    out.sort(key=lambda x: str(x.get("createdAt") or ""), reverse=True)
    return out


def insert_sql(
    cursor,
    *,
    table_id: str,
    session_id: Optional[str],
    alert_kind: str,
    title: Optional[str],
    body_text: Optional[str],
    requested_by_role: Optional[str],
    requested_by_name: Optional[str],
) -> str:
    rid = str(uuid.uuid4())
    now = datetime.now()
    cursor.execute(
        f"""
        INSERT INTO dbo.{TABLE_NAME}
        (Id, SessionId, TableId, AlertKind, Title, BodyText, RequestedByRole, RequestedByName, CreatedAt, ClearedAt)
        VALUES (CAST(? AS UNIQUEIDENTIFIER), ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        """,
        (
            rid,
            session_id or None,
            str(table_id or "").strip().upper(),
            alert_kind.lower().strip(),
            (title or None),
            (body_text or None),
            (requested_by_role or None),
            (requested_by_name or None),
            now,
        ),
    )
    return rid


def insert_json(
    restaurant_dir: str,
    *,
    table_id: str,
    session_id: Optional[str],
    alert_kind: str,
    title: Optional[str],
    body_text: Optional[str],
    requested_by_role: Optional[str],
    requested_by_name: Optional[str],
) -> str:
    rows = json_load_all(restaurant_dir)
    rid = str(uuid.uuid4())
    rows.append(
        {
            "id": rid,
            "sessionId": session_id or None,
            "tableId": str(table_id or "").strip().upper(),
            "alertKind": alert_kind.lower().strip(),
            "title": title or None,
            "bodyText": body_text or None,
            "requestedByRole": requested_by_role or None,
            "requestedByName": requested_by_name or None,
            "createdAt": datetime.now().isoformat(),
            "clearedAt": None,
        }
    )
    json_save_all(restaurant_dir, rows)
    return rid


def clear_sql(cursor, alert_id: str) -> bool:
    cursor.execute(
        f"UPDATE dbo.{TABLE_NAME} SET ClearedAt = SYSUTCDATETIME() WHERE Id = CAST(? AS UNIQUEIDENTIFIER) AND ClearedAt IS NULL",
        (str(alert_id).strip(),),
    )
    return cursor.rowcount > 0


def clear_json(restaurant_dir: str, alert_id: str) -> bool:
    aid = str(alert_id).strip()
    rows = json_load_all(restaurant_dir)
    changed = False
    now = datetime.now().isoformat()
    for r in rows:
        if str(r.get("id") or "") == aid and not str(r.get("clearedAt") or "").strip():
            r["clearedAt"] = now
            changed = True
    if changed:
        json_save_all(restaurant_dir, rows)
    return changed
