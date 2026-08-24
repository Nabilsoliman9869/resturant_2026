"""
قاعدة التوأم الضريبية — مسار الحفظ اليومي + تهيئة أولى + دفعات فواتير.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Callable, Optional

ALIAS_LABEL = "مسار الحفظ اليومي"
DELAY_HOURS = 6
MAX_BATCH_SIZE = 100
PUBLISHER_INTERVAL_SEC = 15 * 60

MASTER_SYNC_TABLES = (
    "TBL004",
    "TBL005",
    "TBL006",
    "TBL007",
    "TBL015",
    "TBL016",
    "TBL020",
)

_lock = threading.RLock()
_publisher_started = False
_last_publisher_result: dict[str, Any] = {}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime] = None) -> str:
    d = dt or _utcnow()
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def default_tax_twin_cfg() -> dict[str, Any]:
    return {
        "alias": ALIAS_LABEL,
        "dailySavePath": "",
        "server": "",
        "port": None,
        "database": "",
        "uid": "",
        "password": "",
        "bootstrapDone": False,
        "bootstrapAt": None,
        "bootstrapError": None,
        "fingerprint": "",
        "syncEnabled": True,
        "delayHours": DELAY_HOURS,
        "maxBatchSize": MAX_BATCH_SIZE,
        "lastParentBatchId": 0,
        "lastTwinConfirmedBatchId": 0,
        "cutoverAt": None,
    }


def _normalize_port(raw: Any) -> Optional[int]:
    if raw is None or raw == "":
        return None
    try:
        p = int(str(raw).strip())
        return p if 1 <= p <= 65535 else None
    except ValueError:
        return None


def fingerprint_of(cfg: dict[str, Any]) -> str:
    parts = [
        str(cfg.get("dailySavePath") or "").strip().lower(),
        str(cfg.get("server") or "").strip().lower(),
        str(cfg.get("port") or ""),
        str(cfg.get("database") or "").strip().lower(),
    ]
    return "|".join(parts)


def load_tax_twin(settings_path: str) -> dict[str, Any]:
    base = default_tax_twin_cfg()
    try:
        if not os.path.isfile(settings_path):
            return base
        with open(settings_path, "r", encoding="utf-8") as f:
            d = json.load(f)
        raw = d.get("taxTwin") if isinstance(d, dict) else None
        if not isinstance(raw, dict):
            return base
        base.update({k: raw.get(k, base[k]) for k in base.keys()})
        base["alias"] = ALIAS_LABEL
        base["port"] = _normalize_port(base.get("port"))
        base["delayHours"] = int(base.get("delayHours") or DELAY_HOURS)
        base["maxBatchSize"] = int(base.get("maxBatchSize") or MAX_BATCH_SIZE)
        return base
    except Exception:
        return base


def save_tax_twin(settings_path: str, patch: dict[str, Any], *, merge_connection_defaults: Optional[dict] = None) -> dict[str, Any]:
    os.makedirs(os.path.dirname(settings_path) or ".", exist_ok=True)
    merged_file: dict[str, Any] = {}
    if os.path.isfile(settings_path):
        try:
            with open(settings_path, "r", encoding="utf-8") as f:
                merged_file = json.load(f)
            if not isinstance(merged_file, dict):
                merged_file = {}
        except Exception:
            merged_file = {}

    cur = load_tax_twin(settings_path)
    for k in default_tax_twin_cfg().keys():
        if k in patch:
            cur[k] = patch[k]

    # وراثة اتصال الأم إن تُرك حقل فارغاً
    if merge_connection_defaults:
        if not str(cur.get("server") or "").strip():
            cur["server"] = merge_connection_defaults.get("server") or ""
        if cur.get("port") is None and merge_connection_defaults.get("port") is not None:
            cur["port"] = _normalize_port(merge_connection_defaults.get("port"))
        if not str(cur.get("uid") or "").strip():
            cur["uid"] = merge_connection_defaults.get("uid") or ""
        if cur.get("password") in (None, "") and merge_connection_defaults.get("password") not in (None,):
            cur["password"] = merge_connection_defaults.get("password") or ""
        if not str(cur.get("database") or "").strip():
            parent_db = str(merge_connection_defaults.get("database") or "").strip()
            if parent_db:
                cur["database"] = f"{parent_db}_TAX"

    cur["alias"] = ALIAS_LABEL
    cur["port"] = _normalize_port(cur.get("port"))
    cur["dailySavePath"] = str(cur.get("dailySavePath") or "").strip()
    cur["server"] = str(cur.get("server") or "").strip()
    cur["database"] = str(cur.get("database") or "").strip()
    cur["uid"] = str(cur.get("uid") or "").strip()
    cur["password"] = cur.get("password") or ""

    fp = fingerprint_of(cur)
    if fp and fp != str(cur.get("fingerprint") or ""):
        # مسار/هدف جديد → إعادة تهيئة عند أول اتصال ناجح
        cur["bootstrapDone"] = False
        cur["bootstrapAt"] = None
        cur["bootstrapError"] = None
        cur["cutoverAt"] = None
        cur["lastParentBatchId"] = 0
        cur["lastTwinConfirmedBatchId"] = 0
    cur["fingerprint"] = fp

    merged_file["taxTwin"] = cur
    dirpath = os.path.dirname(os.path.abspath(settings_path))
    fd, tmp_path = tempfile.mkstemp(prefix="settings_tax_", suffix=".json", dir=dirpath)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(merged_file, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, settings_path)
    except Exception:
        try:
            if os.path.isfile(tmp_path):
                os.unlink(tmp_path)
        except Exception:
            pass
        raise
    return cur


def _connect(server: str, port: Optional[int], database: str, uid: str, pwd: str, timeout: int = 15):
    from odbc_driver import pyodbc_connect_compat

    return pyodbc_connect_compat(server, port, database, uid, pwd, timeout=timeout)


def test_server_reachable(cfg: dict[str, Any]) -> dict[str, Any]:
    s = str(cfg.get("server") or "").strip()
    port = _normalize_port(cfg.get("port"))
    uid = str(cfg.get("uid") or "").strip()
    pwd = cfg.get("password") or ""
    twin_db = str(cfg.get("database") or "").strip()
    path = str(cfg.get("dailySavePath") or "").strip()
    if not path:
        return {"ok": False, "detail": f"«{ALIAS_LABEL}» مطلوب (مجلد حفظ النسخ)."}
    if not s:
        return {"ok": False, "detail": "سيرفر SQL للتوأم مطلوب."}
    if not uid:
        return {"ok": False, "detail": "اسم مستخدم SQL مطلوب."}
    if not twin_db:
        return {"ok": False, "detail": "اسم قاعدة التوأم مطلوب."}
    try:
        os.makedirs(path, exist_ok=True)
    except Exception as e:
        return {"ok": False, "detail": f"تعذر إنشاء/الوصول لمسار الحفظ: {e}"}
    try:
        conn = _connect(s, port, "master", uid, pwd, timeout=8)
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.fetchone()
        # هل قاعدة التوأم موجودة؟
        cur.execute("SELECT DB_ID(?)", (twin_db,))
        row = cur.fetchone()
        exists = bool(row and row[0])
        conn.close()
        return {"ok": True, "twinExists": exists, "path": path, "database": twin_db}
    except Exception as e:
        return {"ok": False, "detail": str(e)}


def _bracket(name: str) -> str:
    n = str(name or "").strip()
    if not n or not re.match(r"^[A-Za-z0-9_\-]+$", n):
        raise ValueError(f"اسم قاعدة غير صالح: {name!r}")
    return f"[{n}]"


def _ensure_sync_schema(cursor) -> None:
    cursor.execute(
        """
        IF OBJECT_ID(N'dbo.MAT3AM_TAX_TWIN_STATE', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_TAX_TWIN_STATE (
                Id INT NOT NULL CONSTRAINT PK_MAT3AM_TAX_TWIN_STATE PRIMARY KEY DEFAULT 1,
                LastConfirmedBatchId INT NOT NULL DEFAULT 0,
                CutoverAt NVARCHAR(40) NULL,
                UpdatedAt NVARCHAR(40) NULL
            );
            INSERT INTO dbo.MAT3AM_TAX_TWIN_STATE (Id, LastConfirmedBatchId) VALUES (1, 0);
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID(N'dbo.MAT3AM_TAX_TWIN_BATCH', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_TAX_TWIN_BATCH (
                BatchId INT NOT NULL CONSTRAINT PK_MAT3AM_TAX_TWIN_BATCH PRIMARY KEY,
                Status NVARCHAR(20) NOT NULL,
                InvoiceCount INT NOT NULL DEFAULT 0,
                PayloadJson NVARCHAR(MAX) NULL,
                CreatedAt NVARCHAR(40) NULL,
                ConfirmedAt NVARCHAR(40) NULL,
                ErrorText NVARCHAR(MAX) NULL
            );
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID(N'dbo.MAT3AM_TAX_TWIN_MASTER_QUEUE', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_TAX_TWIN_MASTER_QUEUE (
                QueueId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MAT3AM_TAX_TWIN_MQ PRIMARY KEY,
                TableName NVARCHAR(64) NOT NULL,
                RowGuide UNIQUEIDENTIFIER NULL,
                Op CHAR(1) NOT NULL DEFAULT 'U',
                CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                DoneAt DATETIME2 NULL,
                ErrorText NVARCHAR(MAX) NULL
            );
            CREATE INDEX IX_MAT3AM_TAX_TWIN_MQ_PENDING
                ON dbo.MAT3AM_TAX_TWIN_MASTER_QUEUE (DoneAt, QueueId);
        END
        """
    )


def _install_master_triggers(cursor) -> list[str]:
    installed: list[str] = []
    for table in MASTER_SYNC_TABLES:
        # تأكد أن الجدول موجود
        cursor.execute(
            "SELECT 1 FROM sys.tables WHERE name = ? AND schema_id = SCHEMA_ID('dbo')",
            (table,),
        )
        if not cursor.fetchone():
            continue
        # هل يوجد عمود CardGuide؟
        cursor.execute(
            """
            SELECT 1 FROM sys.columns
            WHERE object_id = OBJECT_ID(?) AND name = 'CardGuide'
            """,
            (f"dbo.{table}",),
        )
        if not cursor.fetchone():
            continue
        trig = f"TR_MAT3AM_TAX_TWIN_{table}"
        cursor.execute(
            f"""
            IF OBJECT_ID(N'dbo.{trig}', N'TR') IS NOT NULL
                DROP TRIGGER dbo.[{trig}];
            """
        )
        cursor.execute(
            f"""
            CREATE TRIGGER dbo.[{trig}] ON dbo.[{table}]
            AFTER INSERT, UPDATE, DELETE
            AS
            BEGIN
                SET NOCOUNT ON;
                BEGIN TRY
                    INSERT INTO dbo.MAT3AM_TAX_TWIN_MASTER_QUEUE (TableName, RowGuide, Op)
                    SELECT '{table}', i.CardGuide, 'U'
                    FROM inserted i
                    WHERE i.CardGuide IS NOT NULL;
                    INSERT INTO dbo.MAT3AM_TAX_TWIN_MASTER_QUEUE (TableName, RowGuide, Op)
                    SELECT '{table}', d.CardGuide, 'D'
                    FROM deleted d
                    WHERE d.CardGuide IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM inserted i WHERE i.CardGuide = d.CardGuide);
                END TRY
                BEGIN CATCH
                    -- لا تُسقط معاملة الأم
                END CATCH
            END
            """
        )
        installed.append(table)
    return installed


def _filelist(cursor, bak_path: str) -> list[tuple[str, str]]:
    cursor.execute(f"RESTORE FILELISTONLY FROM DISK = ?", (bak_path,))
    rows = cursor.fetchall()
    out: list[tuple[str, str]] = []
    for r in rows:
        logical = str(r[0])
        typ = str(r[2]).upper() if len(r) > 2 else "D"
        out.append((logical, typ))
    return out


def bootstrap_twin(
    *,
    settings_path: str,
    parent_cfg: dict[str, Any],
    get_parent_connection: Callable,
) -> dict[str, Any]:
    """نسخ احتياطي من الأم → استعادة على قاعدة التوأم تحت مسار الحفظ اليومي."""
    with _lock:
        twin = load_tax_twin(settings_path)
        probe = test_server_reachable(twin)
        if not probe.get("ok"):
            twin["bootstrapError"] = probe.get("detail")
            save_tax_twin(settings_path, twin)
            return {"ok": False, "detail": probe.get("detail"), "cfg": twin}

        path = str(twin.get("dailySavePath") or "").strip()
        twin_db = str(twin.get("database") or "").strip()
        twin_server = str(twin.get("server") or "").strip()
        twin_port = _normalize_port(twin.get("port"))
        twin_uid = str(twin.get("uid") or "").strip()
        twin_pwd = twin.get("password") or ""

        parent_db = str(parent_cfg.get("database") or "").strip()
        if not parent_db:
            return {"ok": False, "detail": "قاعدة الأم غير معرّفة في إعدادات الاتصال."}
        if twin_db.lower() == parent_db.lower() and str(twin_server).lower() == str(parent_cfg.get("server") or "").lower():
            return {"ok": False, "detail": "قاعدة التوأم يجب أن تختلف عن قاعدة الأم."}

        bak_path = os.path.join(path, f"{parent_db}_twin_seed.bak")
        mdf_path = os.path.join(path, f"{twin_db}.mdf")
        ldf_path = os.path.join(path, f"{twin_db}_log.ldf")

        steps: list[str] = []
        try:
            # 1) BACKUP من اتصال الأم
            pconn = get_parent_connection()
            try:
                pconn.autocommit = True
            except Exception:
                pass
            pcur = pconn.cursor()
            steps.append("backup_start")
            pcur.execute(
                f"BACKUP DATABASE {_bracket(parent_db)} TO DISK = ? WITH COPY_ONLY, INIT, STATS = 10",
                (bak_path,),
            )
            while pcur.nextset():
                pass
            steps.append(f"backup_ok:{bak_path}")

            # تثبيت مخطط التتبع + تريجرات على الأم
            try:
                pconn.autocommit = False
            except Exception:
                pass
            _ensure_sync_schema(pcur)
            installed = _install_master_triggers(pcur)
            pconn.commit()
            steps.append(f"parent_triggers:{','.join(installed)}")
            try:
                pconn.close()
            except Exception:
                pass

            # 2) RESTORE على سيرفر التوأم عبر master
            tconn = _connect(twin_server, twin_port, "master", twin_uid, twin_pwd, timeout=60)
            try:
                tconn.autocommit = True
            except Exception:
                pass
            tcur = tconn.cursor()
            tcur.execute("SELECT DB_ID(?)", (twin_db,))
            exists_row = tcur.fetchone()
            if exists_row and exists_row[0]:
                steps.append("twin_exists_drop")
                tcur.execute(
                    f"ALTER DATABASE {_bracket(twin_db)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE"
                )
                while tcur.nextset():
                    pass
                tcur.execute(f"DROP DATABASE {_bracket(twin_db)}")
                while tcur.nextset():
                    pass

            files = _filelist(tcur, bak_path)
            if not files:
                raise RuntimeError("RESTORE FILELISTONLY لم يُرجع ملفات.")
            data_logical = next((n for n, t in files if t.startswith("D")), files[0][0])
            log_logical = next((n for n, t in files if t.startswith("L")), files[-1][0])

            steps.append("restore_start")
            tcur.execute(
                f"""
                RESTORE DATABASE {_bracket(twin_db)}
                FROM DISK = ?
                WITH REPLACE,
                     MOVE ? TO ?,
                     MOVE ? TO ?,
                     STATS = 10
                """,
                (bak_path, data_logical, mdf_path, log_logical, ldf_path),
            )
            while tcur.nextset():
                pass
            steps.append("restore_ok")
            try:
                tconn.close()
            except Exception:
                pass

            # 3) مخطط التتبع على التوأم + cutover
            tconn2 = _connect(twin_server, twin_port, twin_db, twin_uid, twin_pwd, timeout=30)
            tcur2 = tconn2.cursor()
            _ensure_sync_schema(tcur2)
            cutover = _iso()
            tcur2.execute(
                """
                UPDATE dbo.MAT3AM_TAX_TWIN_STATE
                SET LastConfirmedBatchId = 0, CutoverAt = ?, UpdatedAt = ?
                WHERE Id = 1
                """,
                (cutover, cutover),
            )
            tconn2.commit()
            try:
                tconn2.close()
            except Exception:
                pass

            twin["bootstrapDone"] = True
            twin["bootstrapAt"] = cutover
            twin["bootstrapError"] = None
            twin["cutoverAt"] = cutover
            twin["lastParentBatchId"] = 0
            twin["lastTwinConfirmedBatchId"] = 0
            twin["syncEnabled"] = True
            twin["fingerprint"] = fingerprint_of(twin)
            save_tax_twin(settings_path, twin)
            return {
                "ok": True,
                "cfg": twin,
                "steps": steps,
                "bakPath": bak_path,
                "mdfPath": mdf_path,
                "ldfPath": ldf_path,
                "triggers": installed,
            }
        except Exception as e:
            twin["bootstrapDone"] = False
            twin["bootstrapError"] = str(e)
            save_tax_twin(settings_path, twin)
            return {"ok": False, "detail": str(e), "steps": steps, "cfg": twin}


def _table_columns(cursor, table: str) -> list[str]:
    cursor.execute(
        """
        SELECT c.name
        FROM sys.columns c
        WHERE c.object_id = OBJECT_ID(?)
        ORDER BY c.column_id
        """,
        (f"dbo.{table}",),
    )
    return [str(r[0]) for r in cursor.fetchall()]


def _drain_master_queue(
    *,
    parent_conn,
    twin_cfg: dict[str, Any],
    limit: int = 200,
) -> dict[str, Any]:
    pcur = parent_conn.cursor()
    pcur.execute(
        """
        SELECT TOP (?) QueueId, TableName, RowGuide, Op
        FROM dbo.MAT3AM_TAX_TWIN_MASTER_QUEUE
        WHERE DoneAt IS NULL
        ORDER BY QueueId
        """,
        (limit,),
    )
    rows = pcur.fetchall()
    if not rows:
        return {"ok": True, "processed": 0}

    twin_conn = _connect(
        str(twin_cfg["server"]),
        _normalize_port(twin_cfg.get("port")),
        str(twin_cfg["database"]),
        str(twin_cfg["uid"]),
        twin_cfg.get("password") or "",
        timeout=30,
    )
    tcur = twin_conn.cursor()
    done = 0
    errors = 0
    for qid, table, guide, op in rows:
        table_s = str(table)
        op_s = str(op or "U").upper()[:1]
        try:
            if guide is None:
                pcur.execute(
                    "UPDATE dbo.MAT3AM_TAX_TWIN_MASTER_QUEUE SET DoneAt = SYSUTCDATETIME(), ErrorText = ? WHERE QueueId = ?",
                    ("null guide", qid),
                )
                continue
            if op_s == "D":
                tcur.execute(
                    f"DELETE FROM dbo.[{table_s}] WHERE CardGuide = CAST(? AS uniqueidentifier)",
                    (str(guide),),
                )
            else:
                cols = _table_columns(pcur, table_s)
                if not cols:
                    raise RuntimeError(f"no columns for {table_s}")
                col_list = ", ".join(f"[{c}]" for c in cols)
                pcur.execute(
                    f"SELECT {col_list} FROM dbo.[{table_s}] WHERE CardGuide = CAST(? AS uniqueidentifier)",
                    (str(guide),),
                )
                src = pcur.fetchone()
                if not src:
                    pcur.execute(
                        "UPDATE dbo.MAT3AM_TAX_TWIN_MASTER_QUEUE SET DoneAt = SYSUTCDATETIME(), ErrorText = ? WHERE QueueId = ?",
                        ("missing on parent", qid),
                    )
                    continue
                tcur.execute(
                    f"DELETE FROM dbo.[{table_s}] WHERE CardGuide = CAST(? AS uniqueidentifier)",
                    (str(guide),),
                )
                placeholders = ", ".join("?" for _ in cols)
                tcur.execute(
                    f"INSERT INTO dbo.[{table_s}] ({col_list}) VALUES ({placeholders})",
                    tuple(src),
                )
            pcur.execute(
                "UPDATE dbo.MAT3AM_TAX_TWIN_MASTER_QUEUE SET DoneAt = SYSUTCDATETIME(), ErrorText = NULL WHERE QueueId = ?",
                (qid,),
            )
            done += 1
        except Exception as e:
            errors += 1
            try:
                pcur.execute(
                    "UPDATE dbo.MAT3AM_TAX_TWIN_MASTER_QUEUE SET ErrorText = ? WHERE QueueId = ?",
                    (str(e)[:2000], qid),
                )
            except Exception:
                pass
    parent_conn.commit()
    twin_conn.commit()
    try:
        twin_conn.close()
    except Exception:
        pass
    return {"ok": True, "processed": done, "errors": errors, "queued": len(rows)}


def _parse_paid_at(raw: Any) -> Optional[datetime]:
    s = str(raw or "").strip()
    if not s:
        return None
    try:
        if s.endswith("Z"):
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _load_local_invoices(data_dir: str) -> list[dict]:
    path = os.path.join(data_dir, "config", "restaurant", "invoices.json")
    try:
        if not os.path.isfile(path):
            return []
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, list):
            return [x for x in raw if isinstance(x, dict)]
        if isinstance(raw, dict) and isinstance(raw.get("invoices"), list):
            return [x for x in raw["invoices"] if isinstance(x, dict)]
    except Exception:
        pass
    return []


def _eligible_tax_invoices(invoices: list[dict], *, delay_hours: int, cutover_at: Optional[str]) -> list[dict]:
    now = _utcnow()
    cutover_dt = _parse_paid_at(cutover_at) if cutover_at else None
    out: list[dict] = []
    for inv in invoices:
        if int(inv.get("checkID01") or inv.get("CheckID01") or 0) != 1:
            continue
        paid = _parse_paid_at(inv.get("paidAt"))
        if not paid:
            continue
        if cutover_dt and paid < cutover_dt:
            continue
        if paid + timedelta(hours=delay_hours) > now:
            continue
        if inv.get("taxTwinBatchId"):
            continue
        out.append(inv)
    out.sort(key=lambda x: str(x.get("paidAt") or ""))
    return out


def _twin_last_confirmed(twin_cfg: dict[str, Any]) -> int:
    conn = _connect(
        str(twin_cfg["server"]),
        _normalize_port(twin_cfg.get("port")),
        str(twin_cfg["database"]),
        str(twin_cfg["uid"]),
        twin_cfg.get("password") or "",
        timeout=15,
    )
    try:
        cur = conn.cursor()
        cur.execute("SELECT ISNULL(LastConfirmedBatchId, 0) FROM dbo.MAT3AM_TAX_TWIN_STATE WHERE Id = 1")
        row = cur.fetchone()
        return int(row[0] or 0) if row else 0
    finally:
        conn.close()


def _copy_invoice_to_twin(parent_conn, twin_conn, invoice_guid: str) -> dict[str, Any]:
    """نسخ TBL022/023 بنفس CardGuide مع BillNumber جديد من عدّاد التوأم."""
    pcur = parent_conn.cursor()
    tcur = twin_conn.cursor()

    tcur.execute(
        "SELECT 1 FROM dbo.TBL022 WHERE CardGuide = CAST(? AS uniqueidentifier)",
        (invoice_guid,),
    )
    if tcur.fetchone():
        return {"ok": True, "skipped": True, "reason": "already_on_twin"}

    cols22 = _table_columns(pcur, "TBL022")
    if not cols22:
        raise RuntimeError("TBL022 غير موجود على الأم")
    col_list = ", ".join(f"[{c}]" for c in cols22)
    pcur.execute(
        f"SELECT {col_list} FROM dbo.TBL022 WHERE CardGuide = CAST(? AS uniqueidentifier)",
        (invoice_guid,),
    )
    row22 = pcur.fetchone()
    if not row22:
        return {"ok": False, "detail": "فاتورة غير موجودة في TBL022 على الأم"}

    data = {cols22[i]: row22[i] for i in range(len(cols22))}
    main_guide = data.get("MainGuide")
    # رقم جديد من التوأم
    if main_guide is not None:
        tcur.execute(
            "SELECT ISNULL(MAX(BillNumber), 0) + 1 FROM dbo.TBL022 WHERE MainGuide = CAST(? AS uniqueidentifier)",
            (str(main_guide),),
        )
    else:
        tcur.execute("SELECT ISNULL(MAX(BillNumber), 0) + 1 FROM dbo.TBL022")
    new_bill = int((tcur.fetchone() or [1])[0] or 1)
    if "BillNumber" in data:
        data["BillNumber"] = new_bill

    placeholders = ", ".join("?" for _ in cols22)
    tcur.execute(
        f"INSERT INTO dbo.TBL022 ({col_list}) VALUES ({placeholders})",
        tuple(data[c] for c in cols22),
    )

    cols23 = _table_columns(pcur, "TBL023")
    if cols23:
        cl23 = ", ".join(f"[{c}]" for c in cols23)
        pcur.execute(
            f"SELECT {cl23} FROM dbo.TBL023 WHERE MainGuide = CAST(? AS uniqueidentifier)",
            (invoice_guid,),
        )
        for line in pcur.fetchall():
            line_data = {cols23[i]: line[i] for i in range(len(cols23))}
            # generatenew line CardGuide if present to avoid PK clash across restores — keep if unique per invoice
            if "CardGuide" in line_data and line_data["CardGuide"] is not None:
                # keep same line guid (idempotent); delete first if partial
                pass
            ph = ", ".join("?" for _ in cols23)
            try:
                tcur.execute(
                    f"INSERT INTO dbo.TBL023 ({cl23}) VALUES ({ph})",
                    tuple(line_data[c] for c in cols23),
                )
            except Exception:
                # تجاهل تكرار بند إن وُجد
                pass

    return {"ok": True, "billNumber": new_bill, "invoiceGuid": invoice_guid}


def _mark_batch_on_twin(twin_conn, batch_id: int, invoice_ids: list[str], status: str, err: str | None = None) -> None:
    cur = twin_conn.cursor()
    cur.execute("SELECT 1 FROM dbo.MAT3AM_TAX_TWIN_BATCH WHERE BatchId = ?", (batch_id,))
    payload = json.dumps({"invoiceIds": invoice_ids}, ensure_ascii=False)
    now = _iso()
    if cur.fetchone():
        cur.execute(
            """
            UPDATE dbo.MAT3AM_TAX_TWIN_BATCH
            SET Status = ?, InvoiceCount = ?, PayloadJson = ?, ConfirmedAt = CASE WHEN ? = 'confirmed' THEN ? ELSE ConfirmedAt END,
                ErrorText = ?
            WHERE BatchId = ?
            """,
            (status, len(invoice_ids), payload, status, now, err, batch_id),
        )
    else:
        cur.execute(
            """
            INSERT INTO dbo.MAT3AM_TAX_TWIN_BATCH (BatchId, Status, InvoiceCount, PayloadJson, CreatedAt, ConfirmedAt, ErrorText)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (batch_id, status, len(invoice_ids), payload, now, now if status == "confirmed" else None, err),
        )
    if status == "confirmed":
        cur.execute(
            """
            UPDATE dbo.MAT3AM_TAX_TWIN_STATE
            SET LastConfirmedBatchId = CASE WHEN ? > LastConfirmedBatchId THEN ? ELSE LastConfirmedBatchId END,
                UpdatedAt = ?
            WHERE Id = 1
            """,
            (batch_id, batch_id, now),
        )


def _persist_invoice_batch_marks(data_dir: str, invoice_ids: list[str], batch_id: int) -> None:
    path = os.path.join(data_dir, "config", "restaurant", "invoices.json")
    try:
        if not os.path.isfile(path):
            return
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        items = raw if isinstance(raw, list) else (raw.get("invoices") if isinstance(raw, dict) else None)
        if not isinstance(items, list):
            return
        want = set(invoice_ids)
        for inv in items:
            if not isinstance(inv, dict):
                continue
            iid = str(inv.get("invoiceId") or inv.get("id") or inv.get("cardGuide") or "")
            if iid in want:
                inv["taxTwinBatchId"] = batch_id
                inv["taxTwinSentAt"] = _iso()
        with open(path, "w", encoding="utf-8") as f:
            json.dump(raw, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def run_publisher_once(
    *,
    settings_path: str,
    data_dir: str,
    parent_cfg: dict[str, Any],
    get_parent_connection: Callable,
) -> dict[str, Any]:
    global _last_publisher_result
    twin = load_tax_twin(settings_path)
    if not twin.get("bootstrapDone") or not twin.get("syncEnabled"):
        result = {"ok": True, "skipped": True, "reason": "not_ready", "cfg": twin}
        _last_publisher_result = result
        return result

    try:
        parent_conn = get_parent_connection()
    except Exception as e:
        result = {"ok": False, "detail": f"parent connect: {e}"}
        _last_publisher_result = result
        return result

    try:
        mq = _drain_master_queue(parent_conn=parent_conn, twin_cfg=twin)
    except Exception as e:
        mq = {"ok": False, "detail": str(e)}

    try:
        twin_confirmed = _twin_last_confirmed(twin)
    except Exception as e:
        result = {"ok": False, "detail": f"twin state: {e}", "masterQueue": mq}
        _last_publisher_result = result
        return result

    twin["lastTwinConfirmedBatchId"] = twin_confirmed
    parent_last = int(twin.get("lastParentBatchId") or 0)

    # إعادة إرسال الفجوات: إن الأم > التوأم المؤكد
    # الدفعات الناقصة تُعاد عبر إعادة بناء من الفواتير غير المعلّمة إن لزم — هنا نتابع تسلسل الأم
    delay = int(twin.get("delayHours") or DELAY_HOURS)
    max_batch = int(twin.get("maxBatchSize") or MAX_BATCH_SIZE)
    invoices = _load_local_invoices(data_dir)
    eligible = _eligible_tax_invoices(invoices, delay_hours=delay, cutover_at=twin.get("cutoverAt"))

    # فواتير معلّمة بباتش > twin_confirmed ولم تُؤكد → إعادة
    resend: list[dict] = []
    for inv in invoices:
        bid = inv.get("taxTwinBatchId")
        if bid is None:
            continue
        try:
            b = int(bid)
        except Exception:
            continue
        if b > twin_confirmed and int(inv.get("checkID01") or 0) == 1:
            resend.append(inv)
    resend.sort(key=lambda x: (int(x.get("taxTwinBatchId") or 0), str(x.get("paidAt") or "")))

    sent_batches: list[int] = []
    errors: list[str] = []

    twin_conn = _connect(
        str(twin["server"]),
        _normalize_port(twin.get("port")),
        str(twin["database"]),
        str(twin["uid"]),
        twin.get("password") or "",
        timeout=60,
    )

    def _send_group(batch_id: int, group: list[dict]) -> None:
        ids = []
        for inv in group:
            guid = str(inv.get("cardGuide") or inv.get("invoiceGuid") or inv.get("invoiceId") or "").strip()
            if not guid:
                continue
            try:
                uuid.UUID(guid)
            except Exception:
                # قد يكون رقم محلي — حاول sqlCardGuide
                guid = str(inv.get("sqlCardGuide") or "").strip()
                try:
                    uuid.UUID(guid)
                except Exception:
                    errors.append(f"no guid for {inv.get('invoiceId')}")
                    continue
            try:
                _copy_invoice_to_twin(parent_conn, twin_conn, guid)
                ids.append(str(inv.get("invoiceId") or guid))
            except Exception as e:
                errors.append(f"{guid}: {e}")
        if not ids and not group:
            return
        ok = len(errors) == 0 or len(ids) > 0
        status = "confirmed" if ids and not any(str(inv.get("invoiceId") or "") in "".join(errors) for inv in group) else (
            "confirmed" if ids else "failed"
        )
        # أبسط: confirmed إذا نُسخ عنصر واحد على الأقل ولم تفشل كل المجموعة
        status = "confirmed" if ids else "failed"
        _mark_batch_on_twin(twin_conn, batch_id, ids, status, "; ".join(errors[-5:]) if errors else None)
        twin_conn.commit()
        if status == "confirmed":
            _persist_invoice_batch_marks(data_dir, ids, batch_id)
            sent_batches.append(batch_id)
            twin["lastParentBatchId"] = max(int(twin.get("lastParentBatchId") or 0), batch_id)
            twin["lastTwinConfirmedBatchId"] = max(int(twin.get("lastTwinConfirmedBatchId") or 0), batch_id)

    # إعادة دفعات من twin_confirmed+1 … parent_last
    if parent_last > twin_confirmed:
        by_batch: dict[int, list[dict]] = {}
        for inv in resend:
            b = int(inv.get("taxTwinBatchId") or 0)
            if twin_confirmed < b <= parent_last:
                by_batch.setdefault(b, []).append(inv)
        for b in range(twin_confirmed + 1, parent_last + 1):
            group = by_batch.get(b) or []
            if group:
                _send_group(b, group)

    # دفعة جديدة من المستحق غير المعلّم
    twin_confirmed2 = int(twin.get("lastTwinConfirmedBatchId") or twin_confirmed)
    parent_last2 = int(twin.get("lastParentBatchId") or 0)
    if parent_last2 <= twin_confirmed2 and eligible:
        chunk = eligible[:max_batch]
        new_id = max(parent_last2, twin_confirmed2) + 1
        _send_group(new_id, chunk)

    try:
        twin_conn.close()
    except Exception:
        pass
    try:
        parent_conn.close()
    except Exception:
        pass

    save_tax_twin(settings_path, twin)
    result = {
        "ok": True,
        "masterQueue": mq,
        "sentBatches": sent_batches,
        "eligible": len(eligible),
        "twinConfirmed": twin.get("lastTwinConfirmedBatchId"),
        "parentBatch": twin.get("lastParentBatchId"),
        "errors": errors[:20],
        "cfg": twin,
    }
    _last_publisher_result = result
    return result


def save_and_maybe_bootstrap(
    *,
    settings_path: str,
    patch: dict[str, Any],
    parent_cfg: dict[str, Any],
    get_parent_connection: Callable,
) -> dict[str, Any]:
    cfg = save_tax_twin(settings_path, patch, merge_connection_defaults=parent_cfg)
    probe = test_server_reachable(cfg)
    if not probe.get("ok"):
        return {"ok": False, "saved": True, "detail": probe.get("detail"), "cfg": cfg, "bootstrapped": False}
    if cfg.get("bootstrapDone"):
        return {"ok": True, "saved": True, "cfg": cfg, "bootstrapped": False, "probe": probe}
    boot = bootstrap_twin(
        settings_path=settings_path,
        parent_cfg=parent_cfg,
        get_parent_connection=get_parent_connection,
    )
    return {
        "ok": bool(boot.get("ok")),
        "saved": True,
        "bootstrapped": bool(boot.get("ok")),
        "bootstrap": boot,
        "cfg": boot.get("cfg") or load_tax_twin(settings_path),
        "probe": probe,
        "detail": boot.get("detail"),
    }


def ensure_publisher_thread(
    *,
    settings_path: str,
    data_dir: str,
    parent_cfg_loader: Callable[[], dict[str, Any]],
    get_parent_connection: Callable,
) -> None:
    global _publisher_started
    with _lock:
        if _publisher_started:
            return
        _publisher_started = True

    def _loop():
        while True:
            try:
                twin = load_tax_twin(settings_path)
                if twin.get("bootstrapDone") and twin.get("syncEnabled"):
                    run_publisher_once(
                        settings_path=settings_path,
                        data_dir=data_dir,
                        parent_cfg=parent_cfg_loader(),
                        get_parent_connection=get_parent_connection,
                    )
            except Exception as e:
                print(f"[tax-twin] publisher: {e}", flush=True)
            time.sleep(PUBLISHER_INTERVAL_SEC)

    threading.Thread(target=_loop, name="mat3am-tax-twin-publisher", daemon=True).start()


def status_snapshot(settings_path: str) -> dict[str, Any]:
    cfg = load_tax_twin(settings_path)
    return {
        "alias": ALIAS_LABEL,
        "cfg": cfg,
        "lastPublisher": _last_publisher_result,
    }
