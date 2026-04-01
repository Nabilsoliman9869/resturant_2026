"""
Backend API Server for POS System
FastAPI Backend - متصل بقاعدة البيانات SQL Server
"""
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel
from typing import List, Optional
import pyodbc
from datetime import datetime
import uuid
import subprocess
import json
import os
import re
import tempfile
import unicodedata
from pathlib import Path
from config import get_connection_string, get_connection_string_driver13, DATABASE

try:
    XTRA_API_PORT = int(os.environ.get("XTRA_API_PORT", "2288"))
except ValueError:
    XTRA_API_PORT = 2288

# دخول تهيئة أولية: لا يقرأ MAT3AM_APP_USERS. يُعطّل تلقائياً عندما يوجد صف واحد على الأقل في ذلك الجدول.
MAT3AM_INITIAL_DEV_LOGIN = (os.environ.get("MAT3AM_INITIAL_DEV_LOGIN") or "dev").strip().strip("\ufeff")
MAT3AM_INITIAL_DEV_PIN = (os.environ.get("MAT3AM_INITIAL_DEV_PIN") or "dev@123").strip().strip("\ufeff")
MAT3AM_INITIAL_DEV_USER_ID = "00000000-0000-4000-8000-000000000001"

# أحرف اتجاه/عرض صفرية شائعة من لوحات عربية أو لصق من وورد — تكسر مطابقة dev / dev@123
_INVISIBLE_CHARS_RE = re.compile(r"[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\u00ad]+")


def _strip_invisible_chars(s: str) -> str:
    if not s:
        return s
    return _INVISIBLE_CHARS_RE.sub("", s)


def _norm_setup_login(s: str) -> str:
    raw = _strip_invisible_chars((s or "").strip())
    return unicodedata.normalize("NFKC", raw).casefold()


def _norm_setup_pin(s: str) -> str:
    raw = _strip_invisible_chars((s or "").strip())
    return unicodedata.normalize("NFKC", raw)


def _parse_login_from_json_body(data: object) -> tuple[str, str]:
    """يقرأ اسم الدخول والرمز من JSON مهما كانت حالة أحرف المفاتيح (Login/login، UserName، إلخ)."""
    if not isinstance(data, dict):
        return "", ""
    low: dict[str, object] = {}
    for k, v in data.items():
        if k is None:
            continue
        low[str(k).strip().casefold()] = v
    login_out = ""
    for key in ("login", "username", "userlogin", "loginname", "user", "email"):
        if key in low and low[key] is not None:
            login_out = str(low[key]).strip()
            if login_out:
                break
    pin_out = ""
    for key in ("pin", "password", "pwd", "pass"):
        if key in low and low[key] is not None:
            pin_out = str(low[key]).strip()
            if pin_out:
                break
    return login_out, pin_out


def _initial_setup_credentials_match(login_name: str, pin: str) -> bool:
    """يطابق اسم/رمز التهيئة مع قيمة البيئة أو الافتراضي الثابت dev / dev@123 (بدون حساسية لحالة الحروف للاسم)."""
    nl = _norm_setup_login(login_name)
    pw = _norm_setup_pin(pin)
    cfg_l = _norm_setup_login(MAT3AM_INITIAL_DEV_LOGIN)
    cfg_p = _norm_setup_pin(MAT3AM_INITIAL_DEV_PIN)
    if nl == cfg_l and pw == cfg_p:
        return True
    if nl == "dev" and pw == "dev@123":
        return True
    return False


def _looks_like_initial_setup_username(login_name: str) -> bool:
    nl = _norm_setup_login(login_name)
    return nl == "dev" or nl == _norm_setup_login(MAT3AM_INITIAL_DEV_LOGIN)

app = FastAPI(title="إكسترا ويب — نظام موازي", version="2.0.0")


@app.get("/__whoami__", include_in_schema=False)
def whoami():
    """اختبار: هل الخادم الذي يعمل هو هذا الملف؟"""
    return PlainTextResponse("api_server.py: WHOAMI OK")


# مسارات مطلقة مبنية على __file__ (تفادي 404 بسبب التشغيل من backend/)
BASE_DIR = Path(__file__).resolve().parents[1]
_root = str(BASE_DIR)
REST_DIR = BASE_DIR / "ui" / "restaurant"

# إعدادات الاتصال من ملف (إن وُجد) — يُحمّل من config/settings.json
_settings_path = os.path.normpath(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "settings.json"))


def _normalize_sql_port(port) -> Optional[int]:
    """يقبل المنفذ كرقم أو نص (مثل 1477 أو \"1477\") من JSON أو النموذج."""
    if port is None or port == "":
        return None
    if isinstance(port, (int, float)) and not isinstance(port, bool):
        p = int(port)
        return p if 1 <= p <= 65535 else None
    if isinstance(port, str):
        t = port.strip()
        if not t:
            return None
        try:
            p = int(t)
            return p if 1 <= p <= 65535 else None
        except ValueError:
            return None
    return None


def _sql_server_host(server: str, port: Optional[int]) -> str:
    s = (server or "").strip()
    if not s:
        return s
    if port is not None:
        return f"{s},{port}"
    return s


def _odbc_connection_string(server: str, port: Optional[int], db: str, uid: str, pwd: str) -> str:
    host = _sql_server_host(server, port)
    return (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={host};DATABASE={db};UID={uid};PWD={pwd};"
    )


def _get_connection_string_from_settings():
    if not os.path.exists(_settings_path):
        return None
    try:
        with open(_settings_path, "r", encoding="utf-8") as f:
            d = json.load(f)
        s = (d.get("server") or "").strip()
        port = _normalize_sql_port(d.get("port"))
        db = (d.get("database") or "").strip()
        uid = (d.get("uid") or "").strip()
        pwd = d.get("password") or ""
        if not s or not db:
            return None
        return _odbc_connection_string(s, port, db, uid, pwd)
    except Exception:
        return None

# مجلد الواجهة
static_dir = str(BASE_DIR / "ui")
if not os.path.isdir(static_dir):
    static_dir = os.path.dirname(os.path.abspath(__file__))

# تطبيق المطعم — حل SPA: assets من mount، وأي مسار آخر يرجع index.html
if REST_DIR.exists():
    print("REST_DIR:", REST_DIR, "exists:", REST_DIR.exists(), "index.html:", (REST_DIR / "index.html").exists())
    assets_dir = REST_DIR / "assets"
    if assets_dir.is_dir():
        app.mount("/static/restaurant/assets", StaticFiles(directory=str(assets_dir)), name="restaurant-assets")

    @app.get("/static/restaurant", include_in_schema=False)
    @app.get("/static/restaurant/", include_in_schema=False)
    @app.get("/static/restaurant/{path:path}", include_in_schema=False)
    def restaurant_spa(path: str = ""):
        index_file = REST_DIR / "index.html"
        if index_file.is_file():
            return FileResponse(index_file, media_type="text/html")
        raise HTTPException(status_code=503, detail="ui/restaurant/index.html غير موجود")

else:
    print("REST_DIR missing:", REST_DIR)

app.mount("/static", StaticFiles(directory=static_dir), name="static")
_modules_dir = os.path.join(static_dir, "modules")
if os.path.isdir(_modules_dir):
    app.mount("/modules", StaticFiles(directory=_modules_dir), name="modules")

# تشخيص ترتيب المسارات (لتحديد إن كان /static يسبق /static/restaurant)
print("ROUTES (أول 25):")
for i, r in enumerate(app.routes):
    if i >= 25:
        break
    p = getattr(r, "path", None)
    n = getattr(r, "name", None)
    print(" ", type(r).__name__, p, n)

# Routes للملفات HTML
@app.get("/")
def read_root():
    """الصفحة الرئيسية"""
    html_path = os.path.join(static_dir, "index.html")
    if os.path.exists(html_path):
        return FileResponse(html_path)
    return {"message": "POS System API", "docs": "/docs"}

@app.get("/pos_system.html")
def pos_system():
    """صفحة POS System"""
    html_path = os.path.join(static_dir, "pos_system.html")
    if os.path.exists(html_path):
        return FileResponse(html_path)
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/index.html")
def index():
    """صفحة Index"""
    html_path = os.path.join(static_dir, "index.html")
    if os.path.exists(html_path):
        return FileResponse(html_path)
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/custody.html")
def custody_window():
    """نافذة عهدة مستديمة جمعية"""
    html_path = os.path.join(static_dir, "custody_window.html")
    if os.path.exists(html_path):
        return FileResponse(html_path)
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/link-invoices.html")
@app.get("/link_invoices.html")
def link_invoices_window():
    """نافذة ربط الحوافظ"""
    html_path = os.path.join(static_dir, "link_invoices.html")
    if os.path.exists(html_path):
        return FileResponse(html_path)
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/create-agent.html")
@app.get("/create_agent.html")
def create_agent_window():
    """نافذة إنشاء عميل"""
    html_path = os.path.join(static_dir, "create_agent.html")
    if os.path.exists(html_path):
        return FileResponse(html_path)
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/dashboard.html")
@app.get("/dashboard")
def dashboard_window():
    """داشبورد الفواتير الجاهزة للارتباط"""
    html_path = os.path.join(static_dir, "dashboard.html")
    if os.path.exists(html_path):
        return FileResponse(html_path)
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/app-settings")
def app_settings_page():
    """صفحة إعدادات الاتصال"""
    html_path = os.path.join(static_dir, "app_settings.html")
    if os.path.exists(html_path):
        return FileResponse(html_path)
    raise HTTPException(status_code=404, detail="File not found")

# ========== إعدادات الاتصال (قاعدة البيانات) من الواجهة ==========
@app.get("/api/settings/connection")
def api_settings_connection_get():
    """قراءة إعدادات الاتصال من config/settings.json"""
    try:
        if os.path.exists(_settings_path):
            with open(_settings_path, "r", encoding="utf-8") as f:
                d = json.load(f)
            return {
                "server": d.get("server", ""),
                "port": d.get("port"),
                "database": d.get("database", ""),
                "uid": d.get("uid", ""),
                "password": d.get("password", ""),
            }
    except Exception:
        pass
    return {"server": "", "port": None, "database": "", "uid": "", "password": ""}

@app.put("/api/settings/connection")
def api_settings_connection_put(body: dict):
    """حفظ إعدادات الاتصال في config/settings.json"""
    try:
        os.makedirs(os.path.dirname(_settings_path), exist_ok=True)
        port_val = _normalize_sql_port(body.get("port"))
        with open(_settings_path, "w", encoding="utf-8") as f:
            json.dump({
                "server": body.get("server", ""),
                "port": port_val,
                "database": body.get("database", ""),
                "uid": body.get("uid", ""),
                "password": body.get("password", ""),
            }, f, indent=2, ensure_ascii=False)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/settings/test-connection")
def api_settings_test_connection(body: dict):
    """اختبار الاتصال بقاعدة البيانات بالمعاملات المرسلة"""
    s = (body.get("server") or "").strip()
    port = _normalize_sql_port(body.get("port"))
    db = (body.get("database") or "").strip()
    uid = (body.get("uid") or "").strip()
    pwd = body.get("password") or ""
    if not s or not db:
        return {"ok": False, "detail": "السيرفر وقاعدة البيانات مطلوبان"}
    if not uid:
        return {"ok": False, "detail": "اسم المستخدم مطلوب"}
    conn_str = _odbc_connection_string(s, port, db, uid, pwd)
    try:
        conn = pyodbc.connect(conn_str, timeout=10)
        conn.close()
        return {"ok": True}
    except Exception as e:
        err = str(e)
        if "Login failed" in err or "بيانات غير صحيحة" in err or "incorrect" in err.lower():
            return {"ok": False, "detail": "فشل تسجيل الدخول — تحقق من اسم المستخدم وكلمة المرور. تأكد أن SQL Server في وضع Mixed Mode."}
        if "Cannot open database" in err or "غير موجودة" in err:
            return {"ok": False, "detail": f"قاعدة البيانات '{db}' غير موجودة أو لا يملك المستخدم صلاحية الولوج إليها."}
        if "Timeout" in err or "258" in err or "10060" in err:
            return {
                "ok": False,
                "detail": "انتهت المهلة أو رفض الاتصال — تأكد أن خدمة SQL Server تعمل، وأن TCP/IP مفعّل، وأن المنفذ 1477 (أو المنفذ الفعلي في SQL Server Configuration Manager) مفتوح في الجدار الناري. جرّب أيضاً السيرفر 127.0.0.1 بدل localhost.",
            }
        if "IM002" in err or "ODBC Driver" in err and "not found" in err.lower():
            return {
                "ok": False,
                "detail": "تعذر العثور على ODBC Driver 17 for SQL Server — ثبّت «Microsoft ODBC Driver 17 for SQL Server» من موقع مايكروسوفت.",
            }
        return {"ok": False, "detail": err}

# CORS - للسماح للـ HTML بالاتصال
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


ALLOWED_ROLE_CODES = {
    "cashier",
    "accountant",
    "manager",
    "developer",
    "host",
    "waiter",
    "kitchen",
    "server",
}


def _audit_log(cursor, action: str, entity: str, entity_id: Optional[str], actor: Optional[str], details: Optional[str]):
    """تسجيل تدقيق لعمليات الإدارة والدخول."""
    try:
        _ensure_mat3am_dev_schema(cursor)
        cursor.execute(
            """
            INSERT INTO dbo.MAT3AM_AUDIT_LOG
            (ActionCode, EntityName, EntityId, ActorName, Details, LoggedAt)
            VALUES (?, ?, ?, ?, ?, SYSUTCDATETIME())
            """,
            (
                (action or "")[:80],
                (entity or "")[:80],
                (entity_id or "")[:100] or None,
                (actor or "")[:200] or None,
                (details or "")[:1000] or None,
            ),
        )
    except Exception:
        # لا نكسر العملية الأساسية بسبب فشل كتابة التدقيق
        pass


# Database Connection — يفضّل إعدادات config/settings.json إن وُجدت
def get_connection():
    """الاتصال بقاعدة البيانات"""
    conn_str = _get_connection_string_from_settings()
    if conn_str:
        try:
            return pyodbc.connect(conn_str, timeout=10)
        except Exception as e:
            print(f"[DB] فشل الاتصال من settings.json: {e}")
    try:
        conn_str = get_connection_string()
        return pyodbc.connect(conn_str, timeout=10)
    except Exception:
        try:
            conn_str = get_connection_string_driver13()
            return pyodbc.connect(conn_str, timeout=10)
        except Exception as e:
            print(f"خطأ الاتصال: {e}")
            return None


@app.post("/api/auth/login")
async def api_auth_login(request: Request):
    """تسجيل الدخول: دخول تهيئة أولية (dev) بدون الاعتماد على MAT3AM_APP_USERS، أو من الجدول."""
    try:
        raw = await request.json()
    except Exception:
        raw = {}
    lo, pw = _parse_login_from_json_body(raw)
    login_name = _strip_invisible_chars(lo.strip())
    pin = _strip_invisible_chars(pw.strip())
    if not login_name or not pin:
        raise HTTPException(status_code=400, detail="اسم المستخدم والرمز مطلوبان")

    if _looks_like_initial_setup_username(login_name) and not _initial_setup_credentials_match(login_name, pin):
        raise HTTPException(
            status_code=401,
            detail="رمز دخول التهيئة الأولية غير صحيح. المتوقع للاسم dev: dev@123 (أو القيمة في MAT3AM_INITIAL_DEV_PIN).",
        )

    if _initial_setup_credentials_match(login_name, pin):
        conn_dev = get_connection()
        if conn_dev:
            try:
                cur = conn_dev.cursor()
                try:
                    cur.execute("SELECT COUNT(*) FROM dbo.MAT3AM_APP_USERS")
                    dev_cnt = int((cur.fetchone() or [0])[0] or 0)
                except Exception:
                    dev_cnt = 0
                if dev_cnt > 0:
                    raise HTTPException(
                        status_code=401,
                        detail="تمت تهيئة مستخدمي التطبيق — سجّل الدخول بحساب من القاعدة (مثل cashier / 1001) وليس dev.",
                    )
            finally:
                try:
                    conn_dev.close()
                except Exception:
                    pass
        return {
            "ok": True,
            "user": {
                "id": MAT3AM_INITIAL_DEV_USER_ID,
                "name": "تهيئة أولية",
                "login": MAT3AM_INITIAL_DEV_LOGIN,
                "role": "developer",
            },
        }

    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_mat3am_dev_schema(cursor)
        cursor.execute(
            """
            SELECT TOP 1 Id, LoginName, DisplayName, RoleCode, PinHash, IsActive
            FROM dbo.MAT3AM_APP_USERS
            WHERE LoginName = ?
            ORDER BY CreatedAt DESC
            """,
            (login_name,),
        )
        row = cursor.fetchone()
        if not row:
            msg = "مستخدم غير موجود — الاسم غير مسجّل في MAT3AM_APP_USERS."
            try:
                cursor.execute("SELECT COUNT(*) FROM dbo.MAT3AM_APP_USERS")
                cnt = int((cursor.fetchone() or [0])[0] or 0)
                if cnt == 0:
                    msg += (
                        " العدد في الجدول: 0 (فارغ). للمرة الأولى: سجّل دخول تهيئة بـ dev / dev@123 ثم من لوحة المطوّر نفّذ التهيئة، أو POST /api/dev/bootstrap."
                    )
                else:
                    cursor.execute(
                        "SELECT TOP 12 LoginName FROM dbo.MAT3AM_APP_USERS ORDER BY LoginName"
                    )
                    names = [str(r[0] or "").strip() for r in cursor.fetchall() if r and r[0]]
                    snip = "، ".join(names[:10])
                    if len(names) > 10:
                        snip += "، …"
                    msg += (
                        f" العدد في الجدول: {cnt}. لا يوجد صف باسم «{login_name}». أسماء مسجّلة (عيّنة): {snip}."
                        " لإضافة مستخدم أو إعادة الافتراضيين: امسح الجدول أو أضف صفاً من لوحة «مستخدمون وأدوار» ثم أعد المحاولة."
                    )
            except Exception as ex:
                msg += f" (تعذر قراءة تشخيص الجدول: {ex})"
            raise HTTPException(status_code=401, detail=msg)
        if row[5] is not None and int(row[5]) == 0:
            raise HTTPException(status_code=401, detail="المستخدم غير مفعل")
        db_pin = str(row[4] or "").strip()
        if not db_pin or db_pin != pin:
            _audit_log(cursor, "LOGIN_FAIL", "MAT3AM_APP_USERS", str(row[0]), login_name, "invalid pin")
            raise HTTPException(status_code=401, detail="رمز الدخول غير صحيح")
        role_code = str(row[3] or "").strip().lower()
        if role_code not in ALLOWED_ROLE_CODES:
            raise HTTPException(status_code=403, detail=f"الدور غير مدعوم: {role_code}")
        _audit_log(cursor, "LOGIN_OK", "MAT3AM_APP_USERS", str(row[0]), login_name, f"role={role_code}")
        conn.commit()
        display = row[2]
        login_nm = row[1]
        name_out = ""
        try:
            if display is not None and str(display).strip():
                name_out = str(display).strip()
            elif login_nm is not None:
                name_out = str(login_nm).strip()
        except Exception:
            name_out = str(login_nm or "").strip()
        return {
            "ok": True,
            "user": {
                "id": str(row[0]),
                "name": name_out,
                "login": str(login_nm or "").strip(),
                "role": role_code,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"تعذر تسجيل الدخول: {str(e)}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.get("/api/auth/users")
def api_auth_users():
    """قائمة مستخدمي النظام من MAT3AM_APP_USERS."""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_mat3am_dev_schema(cursor)
        cursor.execute(
            """
            SELECT TOP 500 Id, LoginName, DisplayName, RoleCode, IsActive, CreatedAt
            FROM dbo.MAT3AM_APP_USERS
            ORDER BY CreatedAt DESC
            """
        )
        rows = cursor.fetchall()
        users = []
        for r in rows:
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
        return {"users": users}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"تعذر قراءة المستخدمين: {str(e)}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.post("/api/auth/users")
def api_auth_user_create(body: dict):
    """إضافة مستخدم جديد."""
    login_name = (body.get("login") or "").strip()
    pin = str(body.get("pin") or "").strip()
    role = str(body.get("role") or "").strip().lower()
    display_name = (body.get("name") or login_name).strip()
    if not login_name or not pin or not role:
        raise HTTPException(status_code=400, detail="login و pin و role مطلوبة")
    if role not in ALLOWED_ROLE_CODES:
        raise HTTPException(status_code=400, detail=f"الدور غير مدعوم: {role}")
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_mat3am_dev_schema(cursor)
        cursor.execute("SELECT COUNT(*) FROM dbo.MAT3AM_APP_USERS WHERE LoginName = ?", (login_name,))
        if int((cursor.fetchone() or [0])[0] or 0) > 0:
            raise HTTPException(status_code=409, detail="اسم المستخدم موجود بالفعل")
        new_id = str(uuid.uuid4()).upper()
        cursor.execute(
            """
            INSERT INTO dbo.MAT3AM_APP_USERS
            (Id, LoginName, PinHash, RoleCode, DisplayName, IsActive, CreatedAt)
            VALUES (CAST(? AS uniqueidentifier), ?, ?, ?, ?, 1, SYSUTCDATETIME())
            """,
            (new_id, login_name, pin, role, display_name),
        )
        _audit_log(cursor, "CREATE_USER", "MAT3AM_APP_USERS", new_id, login_name, f"role={role}")
        conn.commit()
        return {"ok": True, "id": new_id}
    except HTTPException:
        raise
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"تعذر إنشاء المستخدم: {str(e)}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.patch("/api/auth/users/{user_id}")
def api_auth_user_update(user_id: str, body: dict):
    """تحديث مستخدم: تفعيل/تعطيل، تغيير الدور، تغيير الرمز."""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_mat3am_dev_schema(cursor)
        updates = []
        params = []
        if "name" in body:
            updates.append("DisplayName = ?")
            params.append((body.get("name") or "").strip() or None)
        if "role" in body:
            role = str(body.get("role") or "").strip().lower()
            if role not in ALLOWED_ROLE_CODES:
                raise HTTPException(status_code=400, detail=f"الدور غير مدعوم: {role}")
            updates.append("RoleCode = ?")
            params.append(role)
        if "pin" in body:
            pin = str(body.get("pin") or "").strip()
            if not pin:
                raise HTTPException(status_code=400, detail="الرمز لا يمكن أن يكون فارغاً")
            updates.append("PinHash = ?")
            params.append(pin)
        if "isActive" in body:
            updates.append("IsActive = ?")
            params.append(1 if bool(body.get("isActive")) else 0)
        if not updates:
            return {"ok": True, "message": "لا تغييرات"}
        sql = "UPDATE dbo.MAT3AM_APP_USERS SET " + ", ".join(updates) + " WHERE Id = CAST(? AS uniqueidentifier)"
        params.append(user_id)
        cursor.execute(sql, tuple(params))
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="المستخدم غير موجود")
        _audit_log(cursor, "UPDATE_USER", "MAT3AM_APP_USERS", user_id, str(body.get("actor") or ""), "patch update")
        conn.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"تعذر تحديث المستخدم: {str(e)}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.delete("/api/auth/users/{user_id}")
def api_auth_user_delete(user_id: str):
    """حذف مستخدم من جدول MAT3AM_APP_USERS."""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_mat3am_dev_schema(cursor)
        cursor.execute(
            "SELECT TOP 1 LoginName, RoleCode FROM dbo.MAT3AM_APP_USERS WHERE Id = CAST(? AS uniqueidentifier)",
            (user_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="المستخدم غير موجود")
        login_name = str(row[0] or "")
        role = str(row[1] or "")
        cursor.execute("DELETE FROM dbo.MAT3AM_APP_USERS WHERE Id = CAST(? AS uniqueidentifier)", (user_id,))
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="المستخدم غير موجود")
        _audit_log(cursor, "DELETE_USER", "MAT3AM_APP_USERS", user_id, login_name, f"role={role}")
        conn.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"تعذر حذف المستخدم: {str(e)}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.get("/api/auth/audit")
def api_auth_audit(limit: int = 200):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    safe_limit = max(1, min(int(limit), 2000))
    try:
        cursor = conn.cursor()
        _ensure_mat3am_dev_schema(cursor)
        cursor.execute(
            """
            SELECT TOP (?) Id, ActionCode, EntityName, EntityId, ActorName, Details, LoggedAt
            FROM dbo.MAT3AM_AUDIT_LOG
            ORDER BY LoggedAt DESC, Id DESC
            """,
            (safe_limit,),
        )
        rows = cursor.fetchall()
        return {
            "audit": [
                {
                    "id": int(r[0]),
                    "action": r[1] or "",
                    "entity": r[2] or "",
                    "entityId": r[3] or "",
                    "actor": r[4] or "",
                    "details": r[5] or "",
                    "loggedAt": str(r[6]) if r[6] else "",
                }
                for r in rows
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"تعذر قراءة التدقيق: {str(e)}")
    finally:
        try:
            conn.close()
        except Exception:
            pass

# ========== Models ==========
class AgentGroup(BaseModel):
    CardGuide: str
    GroupName: str

class Agent(BaseModel):
    CardGuide: str
    AgentName: str
    CardNumber: Optional[str] = None
    Phone: Optional[str] = None
    Mobile: Optional[str] = None
    TaxCode: Optional[str] = None
    AccountID: Optional[str] = None

class Product(BaseModel):
    CardGuide: str
    ProductName: str
    Price: float
    GroupGuid: Optional[str] = None

class Project(BaseModel):
    CardGuide: str
    ProjectName: str

class CostCenter(BaseModel):
    CardGuide: str
    CostCenter: str

class InvoiceItem(BaseModel):
    ProductGuide: str
    ProductName: str
    Quantity: float
    Unit: str
    UnitPrice: float
    TotalValue: float

class InvoiceHeader(BaseModel):
    BillNumber: Optional[int] = None
    BillDate: str
    DoneIn: str
    AgentGuide: str
    Project: Optional[str] = None
    CostCenter: Optional[str] = None
    Notes: Optional[str] = None
    SourceBill: Optional[str] = None  # جيد الحافظة المصدر عند الربط (TBL022/TBL023)
    InvoiceType: Optional[str] = None
    Discount: float = 0.0
    TaxValue: float = 0.0
    LocalAdministrativeTax: float = 0.0
    PaymentMethod: str = "بطاقات مصرفيه"
    Items: List[InvoiceItem]


def _normalize_pos_invoice_line(it: object) -> Optional[dict]:
    """يحوّل بند السلة من الواجهة (camelCase) إلى مفاتيح InvoiceItem (PascalCase)."""
    if not isinstance(it, dict):
        return None
    qty = float(it.get("Quantity", it.get("quantity", 0)) or 0)
    unit_price = float(it.get("UnitPrice", it.get("unitPrice", 0)) or 0)
    tv_raw = it.get("TotalValue", it.get("totalValue", it.get("lineNet")))
    if tv_raw is None:
        total_value = qty * unit_price
    else:
        total_value = float(tv_raw)
    pg = it.get("ProductGuide") or it.get("productGuide") or it.get("menuItemId") or ""
    pname = it.get("ProductName") or it.get("productName") or it.get("name") or ""
    unit = it.get("Unit") or it.get("unit") or "وحدة"
    return {
        "ProductGuide": str(pg),
        "ProductName": str(pname),
        "Quantity": qty,
        "Unit": str(unit),
        "UnitPrice": unit_price,
        "TotalValue": total_value,
    }


class InvoiceSearch(BaseModel):
    InvoiceType: str
    LockRelations: bool = False
    LinkedInvoices: bool = False
    LinkedVouchers: bool = False
    CashInvoices: bool = True
    MaterialsOnly: bool = False
    Paid: bool = False
    FromDate: Optional[str] = None
    ToDate: Optional[str] = None
    BillNumber: Optional[int] = None
    AgentGuide: Optional[str] = None

# ========== API Endpoints ==========


def _ensure_costing_and_stock_schema(cursor):
    """جداول دعم التكاليف والمخزون لحساب حركة الداخل/الخارج."""
    cursor.execute(
        """
        IF OBJECT_ID(N'dbo.MAT3AM_RECIPE_HDR', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_RECIPE_HDR (
                RecipeGuid UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
                ProductGuide UNIQUEIDENTIFIER NULL,
                ProductName NVARCHAR(255) NOT NULL,
                SalePrice FLOAT NOT NULL DEFAULT 0,
                OverheadPercent FLOAT NOT NULL DEFAULT 0,
                AdminShareValue FLOAT NOT NULL DEFAULT 0,
                IsActive BIT NOT NULL DEFAULT 1,
                UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
            CREATE INDEX IX_MAT3AM_RECIPE_HDR_ProductGuide ON dbo.MAT3AM_RECIPE_HDR(ProductGuide);
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID(N'dbo.MAT3AM_RECIPE_LINE', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_RECIPE_LINE (
                Id BIGINT IDENTITY(1,1) PRIMARY KEY,
                RecipeGuid UNIQUEIDENTIFIER NOT NULL,
                ComponentProductGuide UNIQUEIDENTIFIER NULL,
                ComponentName NVARCHAR(255) NOT NULL,
                Quantity FLOAT NOT NULL DEFAULT 0,
                UnitCode NVARCHAR(20) NOT NULL DEFAULT N'EA',
                UnitCost FLOAT NOT NULL DEFAULT 0
            );
            CREATE INDEX IX_MAT3AM_RECIPE_LINE_RecipeGuid ON dbo.MAT3AM_RECIPE_LINE(RecipeGuid);
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('MAT3AM_RECIPE_LINE', 'ComponentProductGuide') IS NULL
        BEGIN
            ALTER TABLE dbo.MAT3AM_RECIPE_LINE ADD ComponentProductGuide UNIQUEIDENTIFIER NULL;
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID(N'dbo.MAT3AM_STOCK_MOVEMENT', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_STOCK_MOVEMENT (
                Id BIGINT IDENTITY(1,1) PRIMARY KEY,
                MovementAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                MovementType NVARCHAR(30) NOT NULL,
                ReferenceId NVARCHAR(64) NULL,
                InvoiceGuid UNIQUEIDENTIFIER NULL,
                InvoiceTypeGuid UNIQUEIDENTIFIER NULL,
                WarehouseGuid UNIQUEIDENTIFIER NULL,
                ProductGuide UNIQUEIDENTIFIER NULL,
                ItemName NVARCHAR(255) NOT NULL,
                QtyIn FLOAT NOT NULL DEFAULT 0,
                QtyOut FLOAT NOT NULL DEFAULT 0,
                UnitCode NVARCHAR(20) NULL,
                UnitCost FLOAT NOT NULL DEFAULT 0,
                TotalCost FLOAT NOT NULL DEFAULT 0,
                Notes NVARCHAR(500) NULL
            );
            CREATE INDEX IX_MAT3AM_STOCK_MOVEMENT_ProductGuide ON dbo.MAT3AM_STOCK_MOVEMENT(ProductGuide);
            CREATE INDEX IX_MAT3AM_STOCK_MOVEMENT_MovementAt ON dbo.MAT3AM_STOCK_MOVEMENT(MovementAt DESC);
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID(N'dbo.MAT3AM_POS_POLICY', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_POS_POLICY (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                IsActive BIT NOT NULL DEFAULT 1,
                ServicePercent FLOAT NOT NULL DEFAULT 12,
                VatPercent FLOAT NOT NULL DEFAULT 14,
                ApplyDiscountBeforeTax BIT NOT NULL DEFAULT 1,
                ServiceBeforeVat BIT NOT NULL DEFAULT 1,
                UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
            INSERT INTO dbo.MAT3AM_POS_POLICY
            (IsActive, ServicePercent, VatPercent, ApplyDiscountBeforeTax, ServiceBeforeVat)
            VALUES (1, 12, 14, 1, 1);
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID(N'dbo.MAT3AM_PROMOTION', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_PROMOTION (
                Id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
                PromoName NVARCHAR(200) NOT NULL,
                PromoType NVARCHAR(40) NOT NULL,
                PriorityNo INT NOT NULL DEFAULT 100,
                IsActive BIT NOT NULL DEFAULT 1,
                IsStackable BIT NOT NULL DEFAULT 1,
                StartAt DATETIME2 NULL,
                EndAt DATETIME2 NULL,
                BranchGuid UNIQUEIDENTIFIER NULL,
                ScopeType NVARCHAR(20) NULL,
                PayloadJson NVARCHAR(MAX) NULL,
                Notes NVARCHAR(500) NULL,
                UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
            CREATE INDEX IX_MAT3AM_PROMOTION_Active ON dbo.MAT3AM_PROMOTION(IsActive, PriorityNo);
        END
        """
    )


def _get_invoice_type_name(cursor, invoice_type_guid: Optional[str]) -> str:
    if not invoice_type_guid:
        return ""
    try:
        cursor.execute(
            "SELECT InvoiceName FROM TBL020 WHERE CardGuide = CAST(? AS uniqueidentifier)",
            (invoice_type_guid,),
        )
        row = cursor.fetchone()
        return (row[0] or "").strip() if row else ""
    except Exception:
        return ""


def _is_purchase_invoice(invoice_name: str) -> bool:
    n = (invoice_name or "").strip().lower()
    return any(k in n for k in ["مشتري", "وارد", "شراء", "توريد"])


def _insert_stock_movement(
    cursor,
    movement_type: str,
    reference_id: str,
    invoice_guid: Optional[str],
    invoice_type_guid: Optional[str],
    product_guide: Optional[str],
    item_name: str,
    qty_in: float,
    qty_out: float,
    unit_code: Optional[str],
    unit_cost: float,
    total_cost: float,
    notes: Optional[str] = None,
):
    cursor.execute(
        """
        INSERT INTO dbo.MAT3AM_STOCK_MOVEMENT
        (MovementType, ReferenceId, InvoiceGuid, InvoiceTypeGuid, ProductGuide, ItemName, QtyIn, QtyOut, UnitCode, UnitCost, TotalCost, Notes)
        VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            movement_type,
            reference_id,
            invoice_guid,
            invoice_type_guid,
            product_guide,
            item_name,
            float(qty_in or 0),
            float(qty_out or 0),
            unit_code or None,
            float(unit_cost or 0),
            float(total_cost or 0),
            notes or None,
        ),
    )

@app.get("/")
def root():
    """الرئيسية"""
    return {"message": "POS System API", "status": "running", "version": "1.0.0"}

@app.get("/api")
def api_root():
    """API الرئيسية"""
    return {"message": "POS System API", "endpoints": "/api/health, /api/agents, /api/products, etc."}

@app.get("/api/health")
def health_check():
    """فحص الاتصال بقاعدة البيانات"""
    conn = None
    try:
        conn = get_connection()
        if conn:
            db_label = DATABASE
            if os.path.exists(_settings_path):
                try:
                    with open(_settings_path, "r", encoding="utf-8") as f:
                        _d = json.load(f)
                    if (_d.get("database") or "").strip():
                        db_label = (_d.get("database") or "").strip()
                except Exception:
                    pass
            return {"status": "connected", "database": db_label}
        return {"status": "disconnected", "error": "فشل الاتصال بقاعدة البيانات"}
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.get("/api/db-check")
def api_db_check():
    """فحص الاتصال بقاعدة البيانات"""
    conn_str = _get_connection_string_from_settings()
    if not conn_str:
        return {"ok": False, "detail": "ملف الإعدادات غير موجود أو فارغ", "path": _settings_path}
    try:
        conn = pyodbc.connect(conn_str, timeout=10)
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.fetchone()
        cur.close()
        conn.close()
        return {"ok": True, "detail": "الاتصال ناجح"}
    except Exception as e:
        return {"ok": False, "detail": str(e), "path": _settings_path}

@app.get("/api/ping")
def api_ping():
    """للتأكد أن السيرفر يعمل — افتح: /api/ping على منفذ XTRA_API_PORT"""
    return {"server": "api_server", "ok": True, "port": XTRA_API_PORT}


def _mat3am_db_probe_for_ready() -> dict:
    """فحص سريع اختياري للقاعدة — لا يمنع تشغيل الواجهة إن فشل."""
    conn_str = _get_connection_string_from_settings()
    if not conn_str:
        return {"status": "not_configured", "detail": None}
    try:
        conn = pyodbc.connect(conn_str, timeout=4)
        try:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchone()
            cur.close()
        finally:
            conn.close()
        return {"status": "ok", "detail": None}
    except Exception as e:
        return {"status": "unreachable", "detail": str(e)[:400]}


@app.get("/api/ready")
def api_ready(check_db: int = 0):
    """
    جاهزية خفيفة للإقلاع: لا تتصل بقاعدة البيانات افتراضياً (تفادي تعليق أو بطء عند عدم ربط SQL).
    للفحص الاختياري: ?check_db=1
    """
    rdir = os.path.join(_root, "config", "restaurant")
    fp = os.path.join(rdir, "floor_plan.json")
    payload = {
        "ok": True,
        "service": "mat3am-api",
        "port": XTRA_API_PORT,
        "restaurant": {"floor_plan": os.path.isfile(fp)},
    }
    if check_db:
        payload["database"] = _mat3am_db_probe_for_ready()
    else:
        payload["database"] = {"status": "not_checked", "detail": None}
    return payload


# ========== Agent Groups ==========
@app.get("/api/agent-groups")
def get_agent_groups():
    """الحصول على مجموعات العملاء من TBL015"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        query = """
        SELECT CardGuide, GroupName
        FROM TBL015
        WHERE GroupName IS NOT NULL
        ORDER BY GroupName
        """
        cursor.execute(query)
        groups = []
        for row in cursor.fetchall():
            groups.append({
                "CardGuide": str(row[0]),
                "GroupName": row[1]
            })
        return {"groups": groups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.post("/api/agent-groups")
def create_agent_group(body: dict):
    """إضافة مجموعة عملاء (TBL015)"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    name = (body.get("GroupName") or body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="اسم المجموعة مطلوب")
    try:
        cursor = conn.cursor()
        g = str(uuid.uuid4()).upper()
        cursor.execute("INSERT INTO TBL015 (CardGuide, GroupName) VALUES (?, ?)", (g, name))
        conn.commit()
        return {"success": True, "CardGuide": g, "GroupName": name}
    except Exception as e:
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn: conn.close()
        except Exception: pass

# ========== Agents ==========
@app.get("/api/agents")
def get_agents(group_guide: Optional[str] = None):
    """الحصول على العملاء/المشتركين من TBL016 (ماعدا الموردين)"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        # استبعاد الموردين: CardGuide <> '26CBD95C-98CB-48F3-8EEA-EE5D2B0D0500'
        supplier_guide = '26CBD95C-98CB-48F3-8EEA-EE5D2B0D0500'
        
        if group_guide:
            query = """
            SELECT TOP 200 CardGuide, AgentName, CardNumber, AccountID, Phone, Mobile, FullAdress, TaxCode, NotActive
            FROM TBL016
            WHERE AgentName IS NOT NULL 
            AND MainGroupGuide = ?
            AND CardGuide <> CAST(? AS uniqueidentifier)
            ORDER BY AgentName
            """
            cursor.execute(query, (group_guide, supplier_guide))
        else:
            query = """
            SELECT TOP 200 CardGuide, AgentName, CardNumber, AccountID, Phone, Mobile, FullAdress, TaxCode, NotActive
            FROM TBL016
            WHERE AgentName IS NOT NULL
            AND CardGuide <> CAST(? AS uniqueidentifier)
            ORDER BY AgentName
            """
            cursor.execute(query, supplier_guide)
        
        agents = []
        for row in cursor.fetchall():
            card_guide, agent_name, card_number, account_id, phone, mobile, address, tax_code, not_active = row
            # تصفية NotActive = 1
            if not_active and not_active == 1:
                continue
            agents.append({
                "CardGuide": str(card_guide),
                "AgentName": agent_name,
                "CardNumber": str(card_number) if card_number else "",
                "AccountID": str(account_id) if account_id else "",
                "Phone": str(phone) if phone else "",
                "Mobile": str(mobile) if mobile else "",
                "Address": str(address) if address else "",
                "TaxCode": str(tax_code) if tax_code else "",
                "NotActive": not_active if not_active else 0
            })
        return {"agents": agents}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.get("/api/agents/search")
def search_agents(search_text: str):
    """البحث عن العملاء/المشتركين (ماعدا الموردين)"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        supplier_guide = '26CBD95C-98CB-48F3-8EEA-EE5D2B0D0500'
        search_pattern = f"%{search_text}%"
        query = """
        SELECT TOP 50 CardGuide, AgentName, CardNumber, AccountID, Phone, Mobile, FullAdress, TaxCode
        FROM TBL016
        WHERE (AgentName LIKE ? OR 
               CAST(CardNumber AS NVARCHAR) LIKE ? OR 
               Phone LIKE ? OR 
               Mobile LIKE ? OR
               TaxCode LIKE ?)
          AND AgentName IS NOT NULL
          AND CardGuide <> CAST(? AS uniqueidentifier)
        ORDER BY AgentName
        """
        cursor.execute(query, (search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, supplier_guide))
        
        agents = []
        for row in cursor.fetchall():
            agents.append({
                "CardGuide": str(row[0]),
                "AgentName": row[1],
                "CardNumber": str(row[2]) if row[2] else "",
                "Phone": str(row[3]) if row[3] else "",
                "Mobile": str(row[4]) if row[4] else "",
                "TaxCode": str(row[7]) if row[7] else ""
            })
        return {"agents": agents}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


@app.get("/api/agents/by-phone")
def get_agent_by_phone(phone: str):
    """البحث عن عميل/مورد برقم الهاتف أو الموبايل (تطابق كامل أو جزئي)."""
    norm = (phone or "").strip()
    if not norm:
        raise HTTPException(status_code=400, detail="رقم الهاتف مطلوب")
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT TOP 20 CardGuide, AgentName, Phone, Mobile, FullAdress, TaxCode
            FROM TBL016
            WHERE (Phone = ? OR Mobile = ? OR Phone LIKE ? OR Mobile LIKE ?)
              AND AgentName IS NOT NULL
              AND (NotActive IS NULL OR NotActive = 0)
            ORDER BY AgentName
            """,
            (norm, norm, f"%{norm}%", f"%{norm}%"),
        )
        rows = cursor.fetchall()
        return {
            "agents": [
                {
                    "CardGuide": str(r[0]),
                    "AgentName": r[1] or "",
                    "Phone": str(r[2]) if r[2] else "",
                    "Mobile": str(r[3]) if r[3] else "",
                    "Address": str(r[4]) if r[4] else "",
                    "TaxCode": str(r[5]) if r[5] else "",
                }
                for r in rows
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.post("/api/agents/delivery-upsert")
def delivery_upsert_agent(body: dict):
    """استدعاء/إنشاء عميل دليفري سريعاً من الهاتف."""
    name = (body.get("AgentName") or body.get("name") or "").strip()
    phone = (body.get("Phone") or body.get("phone") or "").strip()
    mobile = (body.get("Mobile") or body.get("mobile") or "").strip()
    address = (body.get("FullAdress") or body.get("address") or "").strip()
    if not phone and not mobile:
        raise HTTPException(status_code=400, detail="رقم الهاتف أو الموبايل مطلوب")
    key_phone = phone or mobile
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT TOP 1 CardGuide, AgentName, Phone, Mobile, FullAdress
            FROM TBL016
            WHERE (Phone = ? OR Mobile = ?)
              AND AgentName IS NOT NULL
            ORDER BY ID DESC
            """,
            (key_phone, key_phone),
        )
        row = cursor.fetchone()
        if row:
            card_guide = str(row[0])
            if name or address:
                cursor.execute(
                    """
                    UPDATE TBL016
                    SET AgentName = ISNULL(?, AgentName),
                        FullAdress = ISNULL(?, FullAdress),
                        Phone = ISNULL(?, Phone),
                        Mobile = ISNULL(?, Mobile)
                    WHERE CardGuide = CAST(? AS uniqueidentifier)
                    """,
                    (
                        name or None,
                        address or None,
                        phone or None,
                        mobile or None,
                        card_guide,
                    ),
                )
                conn.commit()
            return {"success": True, "CardGuide": card_guide, "AgentName": name or (row[1] or "")}

        card_guide = str(uuid.uuid4()).upper()
        if not name:
            name = f"عميل دليفري {key_phone}"
        cursor.execute(
            """
            INSERT INTO TBL016 (CardGuide, AgentName, Phone, Mobile, FullAdress, NotActive)
            VALUES (?, ?, ?, ?, ?, 0)
            """,
            (card_guide, name, phone or None, mobile or None, address or None),
        )
        conn.commit()
        return {"success": True, "CardGuide": card_guide, "AgentName": name}
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"خطأ في حفظ عميل الدليفري: {str(e)}")
    finally:
        try:
            conn.close()
        except Exception:
            pass

@app.post("/api/agents")
def create_agent(agent: dict):
    """إنشاء عميل جديد في TBL016"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        
        # إنشاء CardGuide جديد
        card_guide = str(uuid.uuid4()).upper()
        
        # إعداد القيم
        agent_name = agent.get('AgentName', '').strip()
        if not agent_name:
            raise HTTPException(status_code=400, detail="اسم العميل مطلوب")
        
        # تحويل التواريخ
        birthdate = None
        if agent.get('Birthdate'):
            try:
                birthdate = datetime.strptime(agent.get('Birthdate'), '%Y-%m-%d')
            except:
                pass
        
        date_value3 = None
        if agent.get('DateValue3'):
            try:
                date_value3 = datetime.strptime(agent.get('DateValue3'), '%Y-%m-%d')
            except:
                pass
        
        # تحويل Category05 (M/F) إلى Gender (0/1)
        gender = 0
        if agent.get('Category05') == 'M':
            gender = 1
        elif agent.get('Category05') == 'F':
            gender = 0
        
        # استعلام INSERT شامل
        query = """
        INSERT INTO TBL016 
        (CardGuide, AgentName, CardNumber, AccountID, Phone, Mobile, Phone2, FullAdress, TaxCode, 
         MainGroupGuide, NotActive, IDNumber, Birthdate, LastName, EMail, Employer, 
         TextValue3, TextValue10, Category01, Category02, Category03, Category05, DateValue3, Gender)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        
        cursor.execute(query, (
            card_guide,
            agent_name,
            agent.get('CardNumber') or None,
            agent.get('AccountID') or None,
            agent.get('Phone') or None,
            agent.get('Mobile') or None,
            agent.get('Phone2') or None,
            agent.get('FullAdress') or None,
            agent.get('TaxCode') or None,
            agent.get('MainGroupGuide') or None,
            agent.get('NotActive', 0),
            agent.get('IDNumber') or None,
            birthdate,
            agent.get('LastName') or None,
            agent.get('EMail') or None,
            agent.get('Employer') or None,
            agent.get('TextValue3') or None,
            agent.get('TextValue10') or None,
            agent.get('Category01') or None,
            agent.get('Category02') or None,
            agent.get('Category03') or None,
            agent.get('Category05') or None,
            date_value3,
            gender
        ))
        
        conn.commit()
        
        # الحصول على AccountID المُنشأ
        account_id = agent.get('AccountID')
        if not account_id:
            cursor.execute("SELECT AccountID FROM TBL016 WHERE CardGuide = ?", card_guide)
            result = cursor.fetchone()
            if result:
                account_id = result[0]
        
        return {
            "success": True,
            "CardGuide": card_guide,
            "AccountID": str(account_id) if account_id else None,
            "message": "تم إنشاء العضو بنجاح"
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"خطأ في الحفظ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

# ========== Products ==========
# ========== Service Groups ==========
@app.get("/api/service-groups")
def get_service_groups():
    """الحصول على مجموعات الخدمات من TBL006"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        query = """
        SELECT CardGuide, GroupName, LatinName
        FROM TBL006
        WHERE MainGuide = CAST('580E3705-337F-47B8-958E-F8FAF1EFB1E1' AS uniqueidentifier)
        AND GroupName IS NOT NULL
        ORDER BY GroupName
        """
        cursor.execute(query)
        
        groups = []
        for row in cursor.fetchall():
            groups.append({
                "CardGuide": str(row[0]),
                "GroupName": row[1],
                "LatinName": row[2] if row[2] else ""
            })
        
        return {"service_groups": groups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.get("/api/products")
def get_products(group_guide: Optional[str] = None):
    """الحصول على المنتجات/الخدمات من TBL007"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        if group_guide:
            query = """
            SELECT TOP 100 CardGuide, ProductName, LatinName, AgentPrice, GroupGuid
            FROM TBL007
            WHERE ProductName IS NOT NULL AND NotActive = 0 AND GroupGuid = CAST(? AS uniqueidentifier)
            ORDER BY ProductName
            """
            cursor.execute(query, group_guide)
        else:
            query = """
            SELECT TOP 100 CardGuide, ProductName, LatinName, AgentPrice, GroupGuid
            FROM TBL007
            WHERE ProductName IS NOT NULL AND NotActive = 0
            ORDER BY ProductName
            """
            cursor.execute(query)
        
        products = []
        for row in cursor.fetchall():
            products.append({
                "CardGuide": str(row[0]),
                "ProductName": row[1],
                "Price": float(row[3]) if row[3] else 0.0,
                "GroupGuid": str(row[4]) if row[4] else None
            })
        return {"products": products}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.post("/api/products")
def create_product(body: dict):
    """إضافة صنف/منتج (TBL007)"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    name = (body.get("ProductName") or body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="اسم الصنف مطلوب")
    try:
        cursor = conn.cursor()
        g = str(uuid.uuid4()).upper()
        group_guid = body.get("GroupGuid") or body.get("group") or None
        price = float(body.get("AgentPrice") or body.get("Price") or body.get("price") or 0)
        latin = (body.get("LatinName") or "").strip() or None
        cursor.execute(
            "INSERT INTO TBL007 (CardGuide, ProductName, LatinName, GroupGuid, AgentPrice, NotActive) VALUES (?, ?, ?, ?, ?, 0)",
            (g, name, latin, group_guid, price)
        )
        conn.commit()
        return {"success": True, "CardGuide": g, "ProductName": name}
    except Exception as e:
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn: conn.close()
        except Exception: pass

@app.get("/api/products/search")
def search_products(search_text: str):
    """البحث عن المنتجات"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        search_pattern = f"%{search_text}%"
        query = """
        SELECT TOP 50 CardGuide, ProductName, AgentPrice
        FROM TBL007
        WHERE ProductName LIKE ? AND NotActive = 0
        ORDER BY ProductName
        """
        cursor.execute(query, search_pattern)
        
        products = []
        for row in cursor.fetchall():
            products.append({
                "CardGuide": str(row[0]),
                "ProductName": row[1],
                "Price": float(row[2]) if row[2] else 0.0
            })
        return {"products": products}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

# ========== Product Groups ==========
@app.get("/api/product-groups")
def get_product_groups():
    """الحصول على مجموعات المنتجات من TBL006"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        query = """
        SELECT CardGuide, GroupName
        FROM TBL006
        WHERE GroupName IS NOT NULL
        ORDER BY GroupName
        """
        cursor.execute(query)
        
        groups = []
        for row in cursor.fetchall():
            groups.append({
                "CardGuide": str(row[0]),
                "GroupName": row[1]
            })
        return {"groups": groups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.post("/api/product-groups")
def create_product_group(body: dict):
    """إضافة مجموعة منتجات/أصناف (TBL006)"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    name = (body.get("GroupName") or body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="اسم المجموعة مطلوب")
    try:
        cursor = conn.cursor()
        g = str(uuid.uuid4()).upper()
        cursor.execute("INSERT INTO TBL006 (CardGuide, GroupName) VALUES (?, ?)", (g, name))
        conn.commit()
        return {"success": True, "CardGuide": g, "GroupName": name}
    except Exception as e:
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn: conn.close()
        except Exception: pass

# ========== Projects ==========
@app.get("/api/projects")
def get_projects():
    """الحصول على المشاريع/طرق الدفع من TBL049 (بدون تكرار)"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        # استخدام DISTINCT لإزالة التكرار
        query = """
        SELECT DISTINCT CardGuide, ProjectName
        FROM TBL049
        WHERE ProjectName IS NOT NULL
        ORDER BY ProjectName
        """
        cursor.execute(query)
        
        projects = []
        seen_names = set()  # لتجنب التكرار
        for row in cursor.fetchall():
            project_name = row[1]
            if project_name not in seen_names:
                seen_names.add(project_name)
                projects.append({
                    "CardGuide": str(row[0]),
                    "ProjectName": project_name
                })
        return {"projects": projects}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.post("/api/projects")
def create_project(body: dict):
    """إضافة مشروع (TBL049)"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    name = (body.get("ProjectName") or body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="اسم المشروع مطلوب")
    try:
        cursor = conn.cursor()
        g = str(uuid.uuid4()).upper()
        cursor.execute("INSERT INTO TBL049 (CardGuide, ProjectName) VALUES (?, ?)", (g, name))
        conn.commit()
        return {"success": True, "CardGuide": g, "ProjectName": name}
    except Exception as e:
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn: conn.close()
        except Exception: pass

# ========== Cost Centers ==========
@app.get("/api/cost-centers")
def get_cost_centers():
    """الحصول على مراكز التكلفة من TBL005"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        query = """
        SELECT CardGuide, CostCenter
        FROM TBL005
        WHERE CostCenter IS NOT NULL
        ORDER BY CostCenter
        """
        cursor.execute(query)
        
        cost_centers = []
        for row in cursor.fetchall():
            cost_centers.append({
                "CardGuide": str(row[0]),
                "CostCenter": row[1]
            })
        return {"cost_centers": cost_centers}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.post("/api/cost-centers")
def create_cost_center(body: dict):
    """إضافة مركز تكلفة (TBL005)"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    name = (body.get("CostCenter") or body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="اسم مركز التكلفة مطلوب")
    try:
        cursor = conn.cursor()
        g = str(uuid.uuid4()).upper()
        cursor.execute("INSERT INTO TBL005 (CardGuide, CostCenter) VALUES (?, ?)", (g, name))
        conn.commit()
        return {"success": True, "CardGuide": g, "CostCenter": name}
    except Exception as e:
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn: conn.close()
        except Exception: pass

# ========== محطة الخرسانة — عربيات الخلط (مراكز كلفة TBL005) ==========
# البادئة TRUCK|لوحة|سعة|سائق|هاتف — لتمييز عربيات الخلط عن مراكز كلفة أخرى
TRUCK_PREFIX = "TRUCK|"

@app.get("/api/concrete/trucks")
def get_concrete_trucks():
    """عربيات الخلط من TBL005 — مراكز كلفة ببادئة TRUCK|"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات. تحقق من config/settings.json وتشغيل SQL Server، ثم أعد تشغيل خادم إكسترا.")
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT CardGuide, CostCenter FROM TBL005
            WHERE CostCenter IS NOT NULL AND CostCenter LIKE ?
            ORDER BY CostCenter
        """, (TRUCK_PREFIX + "%",))
        trucks = []
        for row in cursor.fetchall():
            parts = (row[1] or "").split("|")
            trucks.append({
                "CardGuide": str(row[0]),
                "plateNumber": parts[1] if len(parts) > 1 else "",
                "capacity": parts[2] if len(parts) > 2 else "",
                "driver": parts[3] if len(parts) > 3 else "",
                "driverPhone": parts[4] if len(parts) > 4 else "",
                "costCenterName": parts[1] if len(parts) > 1 else row[1],
            })
        return {"trucks": trucks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn: conn.close()
        except Exception: pass

@app.post("/api/concrete/trucks")
def create_concrete_truck(body: dict):
    """إضافة عربية خلط — تُسجّل كمركز تكلفة (TBL005)"""
    plate = (body.get("plateNumber") or body.get("plate") or "").strip()
    if not plate:
        raise HTTPException(status_code=400, detail="رقم اللوحة مطلوب")
    capacity = (body.get("capacity") or body.get("capacityM3") or "").strip()
    driver = (body.get("driver") or "").strip()
    phone = (body.get("driverPhone") or body.get("phone") or "").strip()
    cost_center_value = TRUCK_PREFIX + "|".join([plate, capacity, driver, phone])
    return create_cost_center({"CostCenter": cost_center_value})


# ========== محطة الخرسانة — الطلبات (فواتير TBL022/TBL023) ==========
# الطلب = فاتورة توريد — إنشاء وعرض طلبات الخرسانة
def _get_default_invoice_type_guide():
    """نوع فاتورة افتراضي لمحطة الخرسانة — حافظة توريد أو فاتورة مبيعات"""
    conn = get_connection()
    if not conn:
        return "3478A885-6D69-4058-892E-8A57496DB9BC"  # فاتورة مبيعات
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT TOP 1 CardGuide FROM TBL020
            WHERE InvoiceName IS NOT NULL
              AND (InvoiceName LIKE N'%توريد%' OR InvoiceName LIKE N'%حافظة%' OR InvoiceName LIKE N'%مبيعات%')
            ORDER BY InvoiceName
        """)
        row = cursor.fetchone()
        if row:
            return str(row[0]).strip().upper()
    except Exception:
        pass
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass
    return "3478A885-6D69-4058-892E-8A57496DB9BC"


@app.get("/api/concrete/orders")
def get_concrete_orders(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    invoice_type: Optional[str] = None,
    limit: int = 100,
):
    """قائمة طلبات الخرسانة — من الفواتير (TBL022)"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        inv_type = invoice_type
        q = """
        SELECT TOP (?)
            TBL022.CardGuide, TBL022.BillNumber, TBL022.BillDate, TBL022.Notes,
            TBL022.LockRelations,
            TBL016.AgentName, TBL049.ProjectName,
            TBL005.CostCenter,
            (SELECT ISNULL(SUM(Quantity), 0) FROM TBL023 WHERE MainGuide = TBL022.CardGuide) AS TotalQty
        FROM TBL022
        LEFT JOIN TBL016 ON TBL016.CardGuide = TBL022.AgentGuide
        LEFT JOIN TBL049 ON TBL049.CardGuide = TBL022.Project
        LEFT JOIN TBL005 ON TBL005.CardGuide = TBL022.CostCenter
        WHERE 1=1
        """
        params = [limit]
        if inv_type:
            q += " AND TBL022.MainGuide = CAST(? AS uniqueidentifier)"
            params.append(inv_type)
        if from_date:
            q += " AND TBL022.BillDate >= ?"
            params.append(from_date)
        if to_date:
            q += " AND TBL022.BillDate <= ?"
            params.append(to_date)
        q += " ORDER BY TBL022.BillDate DESC, TBL022.BillNumber DESC"
        cursor.execute(q, params)
        rows = cursor.fetchall()
        orders = []
        for r in rows:
            status = "مكتمل" if (r[4] if len(r) > 4 else 0) else "قيد التنفيذ"
            qty = float(r[8]) if len(r) > 8 and r[8] is not None else 0
            orders.append({
                "id": str(r[0]),
                "orderNumber": f"ORD-{r[1]}" if r[1] else "",
                "customer": r[5] or "",
                "project": r[6] or "",
                "costCenter": (r[7] or "").replace(TRUCK_PREFIX, "").split("|")[0] if r[7] else "",
                "deliveryDate": str(r[2])[:10] if r[2] else "",
                "notes": r[3] or "",
                "status": status,
                "billNumber": r[1],
                "quantity": qty,
            })
        return {"orders": orders}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


@app.post("/api/concrete/orders")
def create_concrete_order(body: dict):
    """إنشاء طلب خرسانة — يُسجّل كفاتورة (TBL022/TBL023)"""
    agent_guide = (body.get("agentGuide") or body.get("AgentGuide") or "").strip()
    if not agent_guide:
        raise HTTPException(status_code=400, detail="العميل مطلوب")
    items = body.get("items") or body.get("Items") or []
    if not items:
        raise HTTPException(status_code=400, detail="يجب تحديد صنف واحد على الأقل")

    inv_type = _get_default_invoice_type_guide()
    bill_num_resp = get_next_invoice_number(inv_type)
    bill_num = bill_num_resp.get("next_number", 1)

    today = datetime.now().strftime("%d-%m-%Y")
    delivery = (body.get("deliveryDate") or body.get("deliveryTime") or "")
    if delivery and len(delivery) >= 10:
        try:
            dt = datetime.strptime(delivery[:10], "%Y-%m-%d")
            bill_date = dt.strftime("%d-%m-%Y")
        except Exception:
            bill_date = today
    else:
        bill_date = today

    inv_items = []
    for it in items:
        qty = float(it.get("quantity") or it.get("Quantity") or 0)
        unit_price = float(it.get("unitPrice") or it.get("UnitPrice") or it.get("Price") or 0)
        inv_items.append({
            "ProductGuide": it.get("productGuide") or it.get("ProductGuide"),
            "ProductName": it.get("productName") or it.get("ProductName") or "",
            "Quantity": qty,
            "Unit": "1",  # TBL023.Unit = tinyint — 1 = وحدة/م³
            "UnitPrice": unit_price,
            "TotalValue": qty * unit_price,
        })

    inv = InvoiceHeader(
        BillNumber=bill_num,
        BillDate=bill_date,
        DoneIn=bill_date,
        AgentGuide=agent_guide,
        Project=body.get("projectGuide") or body.get("Project") or None,
        CostCenter=body.get("costCenterGuide") or body.get("CostCenter") or None,
        Notes=(body.get("notes") or body.get("Notes") or "").strip() or None,
        InvoiceType=inv_type,
        Discount=0.0,
        TaxValue=0.0,
        LocalAdministrativeTax=0.0,
        PaymentMethod="آجل",
        Items=[InvoiceItem(**x) for x in inv_items],
    )
    return save_invoice(inv)


# ========== Dashboard - عدد الفواتير الجاهزة للارتباط ==========
@app.get("/api/dashboard/unlocked-invoices")
def get_unlocked_invoices_count():
    """الحصول على عدد الفواتير الجاهزة للارتباط لكل نمط"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        
        # جلب أنواع الفواتير (الحوافظ) من TBL020 - أولاً التي تحتوي "حافظة"
        invoice_types_query = """
        SELECT CardGuide, InvoiceName
        FROM TBL020
        WHERE InvoiceName IS NOT NULL
          AND (InvoiceName LIKE N'%حافظة توريد%' OR InvoiceName LIKE N'%حافظة%')
        ORDER BY InvoiceName
        """
        cursor.execute(invoice_types_query)
        invoice_types = cursor.fetchall()
        
        # إن لم يوجد أي "حافظة" نعرض كل أنواع الفواتير من TBL020
        if not invoice_types:
            invoice_types_query = """
            SELECT CardGuide, InvoiceName
            FROM TBL020
            WHERE InvoiceName IS NOT NULL
            ORDER BY InvoiceName
            """
            cursor.execute(invoice_types_query)
            invoice_types = cursor.fetchall()
        
        dashboard_data = []
        
        for invoice_type in invoice_types:
            card_guide = invoice_type[0]
            invoice_name = invoice_type[1]
            
            # الداشبورد: غير المرتبط فقط (LockRelations = 0)
            try:
                count_query = """
                SELECT COUNT(*) 
                FROM TBL022 
                WHERE MainGuide = CAST(? AS uniqueidentifier)
                  AND (LockRelations = 0 OR LockRelations IS NULL)
                """
                cursor.execute(count_query, str(card_guide))
                count = cursor.fetchone()[0]
            except Exception:
                count = 0
            
            dashboard_data.append({
                "InvoiceName": invoice_name or "بدون اسم",
                "CardGuide": str(card_guide),
                "UnlockedCount": count
            })
        
        return {"dashboard": dashboard_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

# ========== Invoice Types ==========
@app.get("/api/invoice-types")
def get_invoice_types():
    """الحصول على أنواع الفواتير من TBL020"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        # جلب جميع أنواع الفواتير التي لها Fields (نوافذ فعلية)
        query = """
        SELECT InvoiceName, CardGuide
        FROM TBL020
        WHERE Fields IS NOT NULL AND InvoiceName IS NOT NULL
        ORDER BY InvoiceName
        """
        cursor.execute(query)
        
        invoice_types = []
        for row in cursor.fetchall():
            invoice_name = row[0]
            card_guide = row[1]
            
            # التأكد من أن البيانات صحيحة
            if invoice_name and card_guide:
                invoice_types.append({
                    "InvoiceName": str(invoice_name).strip(),
                    "CardGuide": str(card_guide).strip().upper()
                })
        
        # إذا لم نجد أي أنواع، نعيد على الأقل المبيعات
        if not invoice_types:
            # محاولة جلب أي نوع فاتورة موجود
            query2 = """
            SELECT TOP 1 InvoiceName, CardGuide
            FROM TBL020
            WHERE InvoiceName IS NOT NULL
            ORDER BY InvoiceName
            """
            cursor.execute(query2)
            row = cursor.fetchone()
            if row:
                invoice_types.append({
                    "InvoiceName": str(row[0]).strip(),
                    "CardGuide": str(row[1]).strip().upper()
                })
        
        return {"invoice_types": invoice_types}
    except Exception as e:
        import traceback
        error_detail = f"خطأ: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"خطأ في جلب أنواع الفواتير: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

# ========== Search Invoices ==========
@app.post("/api/invoices/link")
def link_invoice(invoice_guide: str, link_to_guide: Optional[str] = None):
    """ربط فاتورة بفاتورة أخرى"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        
        # تحديث LockRelations = 1 (مرتبط)
        update_query = """
        UPDATE TBL022
        SET LockRelations = 1
        WHERE CardGuide = CAST(? AS uniqueidentifier)
        """
        cursor.execute(update_query, invoice_guide)
        
        conn.commit()
        
        return {
            "success": True,
            "message": "تم ربط الفاتورة بنجاح"
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"خطأ في الربط: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.post("/api/invoices/search")
def search_invoices(search: InvoiceSearch):
    """البحث عن الفواتير من qry101
    الشرط: qry101.InvoiceGuide = TBL020.CardGuide (نوع الفاتورة)
    و TBL022.MainGuide = qry101.MainBillGuide (ربط الفاتورة)
    """
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        invoice_guide = search.InvoiceType  # CardGuide من TBL020
        
        print("=" * 80)
        print("🔍 🔍 🔍 بدء البحث عن الفواتير 🔍 🔍 🔍")
        print("=" * 80)
        print(f"📋 InvoiceGuide (نوع الفاتورة): {invoice_guide}")
        print(f"📋 LockRelations: {search.LockRelations if hasattr(search, 'LockRelations') else 'None'}")
        print(f"📋 جميع المعاملات المستلمة:")
        print(f"   - InvoiceType: {search.InvoiceType}")
        print(f"   - LockRelations: {getattr(search, 'LockRelations', 'غير محدد')}")
        print(f"   - FromDate: {getattr(search, 'FromDate', 'غير محدد')}")
        print(f"   - ToDate: {getattr(search, 'ToDate', 'غير محدد')}")
        print(f"   - BillNumber: {getattr(search, 'BillNumber', 'غير محدد')}")
        print(f"   - AgentGuide: {getattr(search, 'AgentGuide', 'غير محدد')}")
        print("=" * 80)
        
        # التحقق من وجود فواتير في TBL022
        # ملاحظة: MainGuide في TBL022 = CardGuide في TBL020 (نوع الفاتورة)
        check_tbl022_query = """
        SELECT COUNT(*) 
        FROM TBL022 
        WHERE TBL022.MainGuide = CAST(? AS uniqueidentifier)
        """
        cursor.execute(check_tbl022_query, invoice_guide)
        tbl022_count = cursor.fetchone()[0]
        print(f"📊 عدد الفواتير في TBL022 لهذا النوع (MainGuide): {tbl022_count}")
        
        # اختبار: جلب عينة من TBL022 مباشرة
        sample_query = """
        SELECT TOP 3 TBL022.MainGuide, TBL022.BillNumber, TBL022.AgentGuide, TBL022.BillDate
        FROM TBL022 
        WHERE TBL022.MainGuide = CAST(? AS uniqueidentifier)
        """
        cursor.execute(sample_query, invoice_guide)
        samples = cursor.fetchall()
        print(f"📋 عينة من TBL022 (أول 3 صفوف):")
        for i, sample in enumerate(samples, 1):
            print(f"   صف {i}: MainGuide={sample[0]}, BillNumber={sample[1]}, AgentGuide={sample[2]}, BillDate={sample[3]}")
        
        # الاستعلام: عرض الغير مرتبط فقط (LockRelations = 0 أو NULL) لتحويل الحافظة لنقطة البيع للتحصيل
        query = """
        SELECT DISTINCT
            TBL022.CardGuide AS MainBillGuide,
            TBL022.BillNumber,
            TBL016.AgentName,
            TBL022.BillDate
        FROM TBL022
        LEFT JOIN TBL016 ON TBL016.CardGuide = TBL022.AgentGuide
        WHERE TBL022.MainGuide = CAST(? AS uniqueidentifier)
          AND (TBL022.LockRelations = 0 OR TBL022.LockRelations IS NULL)
        ORDER BY TBL022.BillDate DESC
        """
        params = [invoice_guide]
        
        print("=" * 80)
        print("🔍 البحث عن الفواتير من TBL022 (مع ربط TBL016)")
        print("=" * 80)
        
        print("=" * 80)
        print("📝 الاستعلام الذي سيتم تنفيذه:")
        print("=" * 80)
        print(query)
        print("=" * 80)
        print(f"📋 المعاملات: {params}")
        print("=" * 80)
        
        
        # طباعة الاستعلام الكامل مع المعاملات (للتشخيص - يمكن نسخه وتجربته في Management Studio)
        debug_query = query.replace('?', f"'{invoice_guide}'")
        print("=" * 80)
        print("🔍 الاستعلام الكامل - انسخه وجربه في Management Studio:")
        print("=" * 80)
        print(debug_query)
        print("=" * 80)
        
        print("=" * 80)
        print("🚀 جارٍ تنفيذ الاستعلام الرئيسي...")
        print("=" * 80)
        try:
            cursor.execute(query, params)
            rows = cursor.fetchall()
            print(f"📋 عدد الفواتير المسترجعة من الاستعلام: {len(rows)}")
            if len(rows) > 0:
                print(f"📋 أول صف: MainGuide={rows[0][0]}, BillNumber={rows[0][1]}, AgentName={rows[0][2]}, BillDate={rows[0][3]}")
        except Exception as query_error:
            print(f"❌ خطأ في تنفيذ الاستعلام: {query_error}")
            import traceback
            traceback.print_exc()
            rows = []
        print("=" * 80)
        
        # Logging مفصل - التحقق من النتائج
        print("=" * 80)
        if len(rows) == 0:
            print("⚠️ ⚠️ ⚠️ لا توجد نتائج من الاستعلام الرئيسي")
            print("=" * 80)
            print("🔍 جارٍ التحقق من الأسباب المحتملة...")
            print("=" * 80)
            
            
        else:
            print(f"✅ تم العثور على {len(rows)} فاتورة")
            # طباعة أول 3 نتائج
            print("=" * 80)
            print("📋 أول 3 فواتير:")
            for i, row in enumerate(rows[:3], 1):
                print(f"   فاتورة {i}: BillNumber={row[1]}, CustomerName={row[2]}, Date={row[3]}")
        print("=" * 80)
        
        
        invoices = []
        print(f"🔄 جارٍ معالجة {len(rows)} صف...")
        for idx, row in enumerate(rows, 1):
            try:
                # الترتيب: MainGuide, BillNumber, AgentName, BillDate
                bill_date = row[3]
                # تنسيق التاريخ مع اليوم - مطابق للصورة: "Tuesday: 2-7-2"
                date_str = ""
                if bill_date:
                    try:
                        days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
                        day_name = days[bill_date.weekday()]
                        # تنسيق بدون أصفار: "2-7-2" بدلاً من "02-07-2002"
                        day = str(bill_date.day)
                        month = str(bill_date.month)
                        year = str(bill_date.year)[-1]  # آخر رقم من السنة
                        date_str = f"{day_name}: {day}-{month}-{year}"
                    except Exception as date_error:
                        print(f"⚠️ خطأ في تنسيق التاريخ: {date_error}")
                        date_str = bill_date.strftime("%d-%m-%Y") if hasattr(bill_date, 'strftime') else str(bill_date)
                
                invoices.append({
                    "MainBillGuide": str(row[0]) if row[0] else "",  # CardGuide من TBL022
                    "MainGuide": str(row[0]) if row[0] else "",  # نفس القيمة - المعرف الفريد للفاتورة
                    "BillNumber": row[1] if row[1] else 0,
                    "CustomerName": row[2] or "",
                    "BillDate": date_str,
                    "PointOfSale": "",
                    "CostCenter": "",
                    "Project": "",
                    "Branch": "",
                    "Notes": "",
                    "Currency": "EGP",
                    "CreditAccount": ""
                })
                if idx <= 3:
                    print(f"   ✅ تمت معالجة فاتورة {idx}: BillNumber={row[1]}, Customer={row[2]}")
            except Exception as row_error:
                print(f"   ❌ خطأ في معالجة صف {idx}: {row_error}")
                print(f"      البيانات: {row}")
                import traceback
                traceback.print_exc()
                continue
        
        print(f"✅ تم إرجاع {len(invoices)} فاتورة")
        print("=" * 80)
        return {"invoices": invoices}
    except Exception as e:
        import traceback
        error_detail = f"خطأ: {str(e)}\n{traceback.format_exc()}"
        print(f"❌ {error_detail}")
        raise HTTPException(status_code=500, detail=f"خطأ في البحث عن الفواتير: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

# ========== List Invoices (لإدارة الفواتير) ==========
@app.get("/api/invoices/list")
def list_invoices(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    invoice_type: Optional[str] = None,
    limit: int = 200,
):
    """قائمة الفواتير مع فلترة اختيارية (من تاريخ، إلى تاريخ، نوع فاتورة)"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        q = """
        SELECT TOP (?)
            TBL022.CardGuide, TBL022.BillNumber, TBL022.BillDate, TBL022.Notes,
            TBL016.AgentName, TBL020.InvoiceName
        FROM TBL022
        LEFT JOIN TBL016 ON TBL016.CardGuide = TBL022.AgentGuide
        LEFT JOIN TBL020 ON TBL020.CardGuide = TBL022.MainGuide
        WHERE 1=1
        """
        params = [limit]
        if invoice_type:
            q += " AND TBL022.MainGuide = CAST(? AS uniqueidentifier)"
            params.append(invoice_type)
        if from_date:
            q += " AND TBL022.BillDate >= ?"
            params.append(from_date)
        if to_date:
            q += " AND TBL022.BillDate <= ?"
            params.append(to_date)
        q += " ORDER BY TBL022.BillDate DESC"
        cursor.execute(q, params)
        rows = cursor.fetchall()
        # TotalValue من مجموع البنود — اختصار: جلب من TBL023 إن أردنا، هنا نرجع بدون إجمالي أو نجمعه
        out = []
        for r in rows:
            out.append({
                "CardGuide": str(r[0]),
                "BillNumber": r[1],
                "BillDate": str(r[2]) if r[2] else None,
                "Notes": r[3] or "",
                "AgentName": r[4] or "",
                "InvoiceTypeName": r[5] or "",
            })
        # إضافة TotalValue إن أمكن (استعلام فرعي أو جلب لاحق)
        return {"invoices": out}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

# ========== Load Invoice ==========
@app.get("/api/invoices/{main_guide}")
def get_invoice(main_guide: str):
    """تحميل فاتورة كاملة من TBL022 و TBL023"""
    print("=" * 80)
    print(f"🔍 طلب تحميل فاتورة - CardGuide (المعرف الفريد): {main_guide}")
    print("=" * 80)
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        print(f"📋 جارٍ تحميل الفاتورة من TBL022 و TBL023...")
        
        # رأس الفاتورة (MainGuide = نوع الفاتورة من TBL020، SourceBill = جيد الحافظة المصدر إن وُجد)
        header_query = """
        SELECT MainGuide, SourceBill, BillNumber, BillDate, DoneIn, AgentGuide, Project, CostCenter, Notes,
               Discount, TaxValue, LocalAdministrativeTax
        FROM TBL022
        WHERE CardGuide = CAST(? AS uniqueidentifier)
        """
        cursor.execute(header_query, main_guide)
        header_row = cursor.fetchone()
        
        if not header_row:
            print(f"❌ الفاتورة غير موجودة في TBL022 - CardGuide: {main_guide}")
            # محاولة البحث في TBL022 لمعرفة ما هو موجود
            debug_query = "SELECT TOP 5 CardGuide, MainGuide, BillNumber FROM TBL022 WHERE CardGuide LIKE ? OR MainGuide LIKE ?"
            cursor.execute(debug_query, (f"%{main_guide[:8]}%", f"%{main_guide[:8]}%"))
            debug_rows = cursor.fetchall()
            print(f"🔍 عينة من TBL022 (أول 5 صفوف):")
            for row in debug_rows:
                print(f"   CardGuide={row[0]}, MainGuide={row[1]}, BillNumber={row[2]}")
            raise HTTPException(status_code=404, detail="الفاتورة غير موجودة")
        
        main_guide_tbl022 = header_row[0]   # MainGuide = نوع الفاتورة (TBL020)
        source_bill = header_row[1]         # SourceBill إن وُجد
        bill_num = header_row[2]
        
        # اسم نوع الفاتورة من TBL020 (للملاحظة "مرتبط ب (اسم الحافظة ورقمها)")
        invoice_type_name = ""
        if main_guide_tbl022:
            try:
                cursor.execute("SELECT InvoiceName FROM TBL020 WHERE CardGuide = ?", (str(main_guide_tbl022),))
                t = cursor.fetchone()
                if t:
                    invoice_type_name = t[0] or ""
            except Exception:
                pass
        # اسم العميل من TBL016
        agent_name = ""
        agent_guide = header_row[5]
        if agent_guide:
            try:
                cursor.execute("SELECT AgentName FROM TBL016 WHERE CardGuide = ?", (str(agent_guide),))
                a = cursor.fetchone()
                if a:
                    agent_name = a[0] or ""
            except Exception:
                pass
        
        # الأصناف
        # ملاحظة: MainGuide في TBL023 = CardGuide في TBL022 (المعرف الفريد للفاتورة)
        items_query = """
        SELECT ProductGuide, Quantity, Unit, TotalValue, RelatedAgent
        FROM TBL023
        WHERE MainGuide = CAST(? AS uniqueidentifier)
        """
        cursor.execute(items_query, main_guide)
        items_rows = cursor.fetchall()
        
        items = []
        for row in items_rows:
            product_guide = str(row[0])
            quantity = float(row[1])
            unit = row[2] or "PK"
            total_value = float(row[3])
            
            # الحصول على اسم المنتج من TBL007
            product_name = "غير معروف"
            try:
                product_query = "SELECT ProductName FROM TBL007 WHERE CardGuide = ?"
                cursor.execute(product_query, product_guide)
                product_row = cursor.fetchone()
                if product_row:
                    product_name = product_row[0]
            except:
                pass
            
            # حساب UnitPrice
            unit_price = total_value / quantity if quantity > 0 else 0
            
            items.append({
                "ProductGuide": product_guide,
                "ProductName": product_name,
                "Quantity": quantity,
                "Unit": unit,
                "UnitPrice": unit_price,
                "TotalValue": total_value,
                "RelatedAgent": str(row[4]) if row[4] else ""
            })
        
        return {
            "MainGuide": main_guide,
            "BillNumber": bill_num,
            "BillDate": header_row[3].strftime("%d-%m-%Y") if header_row[3] else "",
            "DoneIn": header_row[4].strftime("%d-%m-%Y") if header_row[4] else "",
            "AgentGuide": str(agent_guide) if agent_guide else "",
            "AgentName": agent_name,
            "Project": str(header_row[6]) if header_row[6] else "",
            "CostCenter": str(header_row[7]) if header_row[7] else "",
            "Notes": header_row[8] or "",
            "Discount": float(header_row[9]) if header_row[9] else 0.0,
            "TaxValue": float(header_row[10]) if header_row[10] else 0.0,
            "LocalAdministrativeTax": float(header_row[11]) if header_row[11] else 0.0,
            "InvoiceTypeName": invoice_type_name,
            "SourceBill": str(source_bill) if source_bill else "",
            "SourceBillNumber": bill_num,
            "Items": items
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

# ========== Save Invoice ==========
@app.post("/api/invoices")
def save_invoice(invoice: InvoiceHeader):
    """حفظ فاتورة جديدة في TBL022 و TBL023"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        _ensure_costing_and_stock_schema(cursor)
        
        # إنشاء MainGuide جديد
        main_guide = str(uuid.uuid4()).upper()
        # CardGuide من نوع الفاتورة/الإيصال
        # إذا لم يتم تحديد InvoiceType، استخدم فاتورة الكترونية كافتراضي
        invoice_type = invoice.InvoiceType or "3478A885-6D69-4058-892E-8A57496DB9BC"
        
        # حساب الإجمالي
        total_value = sum(item.TotalValue for item in invoice.Items)
        
        # تحويل التواريخ
        try:
            bill_date = datetime.strptime(invoice.BillDate, "%d-%m-%Y")
        except:
            bill_date = datetime.now()
        
        try:
            done_in = datetime.strptime(invoice.DoneIn, "%d-%m-%Y")
        except:
            done_in = datetime.now()
        
        # طريقة الدفع
        payment_method_map = {
            'نقدي': 0,
            'بطاقات مصرفيه': 1,
            'شيك': 2,
            'آجل': 3,
            'بنك مصر': 4,
            'دفع نقدي': 5,
            'سوبر كاش': 6
        }
        pay_method = payment_method_map.get(invoice.PaymentMethod, 0)
        
        # الفاتورة المصدر (حافظة المرتبطة) للربط في TBL022 و TBL023
        source_bill_guid = invoice.SourceBill.strip() if invoice.SourceBill else None
        
        # حفظ رأس الفاتورة
        # ملاحظة: CardGuide في TBL022 = MainGuide (المعرف الفريد)
        # MainGuide في TBL022 = CardGuide من TBL020 (نوع الفاتورة)
        # SourceBill = جيد الحافظة التي تم التحصيل عنها
        if source_bill_guid:
            header_query = """
            INSERT INTO TBL022 
            (CardGuide, MainGuide, BillNumber, BillDate, DoneIn, AgentGuide, Project, CostCenter, Notes, 
             Discount, TaxValue, LocalAdministrativeTax, LockRelations, InsertedIn, Paid, PayMethod, SourceBill)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """
            cursor.execute(header_query, (
                main_guide,
                invoice_type,
                invoice.BillNumber,
                bill_date,
                done_in,
                invoice.AgentGuide,
                invoice.Project or None,
                invoice.CostCenter or None,
                invoice.Notes or None,
                invoice.Discount,
                invoice.TaxValue,
                invoice.LocalAdministrativeTax,
                False,
                datetime.now(),
                0.0,
                pay_method,
                source_bill_guid
            ))
        else:
            header_query = """
            INSERT INTO TBL022 
            (CardGuide, MainGuide, BillNumber, BillDate, DoneIn, AgentGuide, Project, CostCenter, Notes, 
             Discount, TaxValue, LocalAdministrativeTax, LockRelations, InsertedIn, Paid, PayMethod)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """
            cursor.execute(header_query, (
                main_guide,
                invoice_type,
                invoice.BillNumber,
                bill_date,
                done_in,
                invoice.AgentGuide,
                invoice.Project or None,
                invoice.CostCenter or None,
                invoice.Notes or None,
                invoice.Discount,
                invoice.TaxValue,
                invoice.LocalAdministrativeTax,
                False,
                datetime.now(),
                0.0,
                pay_method
            ))
        
        # حفظ الأصناف (مع SourceBill = جيد الحافظة إن وُجد)
        for item in invoice.Items:
            if source_bill_guid:
                item_query = """
                INSERT INTO TBL023 
                (MainGuide, ProductGuide, Quantity, Unit, TotalValue, InsertedIn, RelatedAgent, SourceBill)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """
                cursor.execute(item_query, (
                    main_guide,
                    item.ProductGuide,
                    item.Quantity,
                    item.Unit,
                    item.TotalValue,
                    datetime.now(),
                    invoice.AgentGuide,
                    source_bill_guid
                ))
            else:
                item_query = """
                INSERT INTO TBL023 
                (MainGuide, ProductGuide, Quantity, Unit, TotalValue, InsertedIn, RelatedAgent)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """
                cursor.execute(item_query, (
                    main_guide,
                    item.ProductGuide,
                    item.Quantity,
                    item.Unit,
                    item.TotalValue,
                    datetime.now(),
                    invoice.AgentGuide
                ))

        # ربط الفواتير بحركة المخزون:
        # - المشتريات: حركة داخلة للصنف المباع في الفاتورة
        # - المبيعات: حركة خارجة للمشتقات حسب Recipe/BOM للمنتج النهائي
        invoice_type_name = _get_invoice_type_name(cursor, invoice_type)
        is_purchase = _is_purchase_invoice(invoice_type_name)
        ref = str(main_guide)
        for item in invoice.Items:
            item_product_guide = (item.ProductGuide or "").strip() or None
            item_name = (item.ProductName or "").strip() or "صنف"
            qty = float(item.Quantity or 0)
            unit_code = item.Unit if hasattr(item, "Unit") else None
            unit_price = float(item.UnitPrice or 0)
            total_value_line = float(item.TotalValue or (qty * unit_price))
            if qty <= 0:
                continue
            if is_purchase:
                _insert_stock_movement(
                    cursor=cursor,
                    movement_type="PURCHASE_IN",
                    reference_id=ref,
                    invoice_guid=main_guide,
                    invoice_type_guid=invoice_type,
                    product_guide=item_product_guide,
                    item_name=item_name,
                    qty_in=qty,
                    qty_out=0,
                    unit_code=unit_code,
                    unit_cost=unit_price,
                    total_cost=total_value_line,
                    notes=f"مشتريات - {invoice_type_name or 'وارد'}",
                )
                continue

            # مبيعات: خصم مكونات الوصفة تلقائياً
            recipe_guid = None
            if item_product_guide:
                try:
                    cursor.execute(
                        """
                        SELECT TOP 1 RecipeGuid
                        FROM dbo.MAT3AM_RECIPE_HDR
                        WHERE ProductGuide = CAST(? AS uniqueidentifier) AND IsActive = 1
                        ORDER BY UpdatedAt DESC
                        """,
                        (item_product_guide,),
                    )
                    rr = cursor.fetchone()
                    recipe_guid = str(rr[0]) if rr and rr[0] else None
                except Exception:
                    recipe_guid = None

            if recipe_guid:
                cursor.execute(
                    """
                    SELECT ComponentName, Quantity, UnitCode, UnitCost, ComponentProductGuide
                    FROM dbo.MAT3AM_RECIPE_LINE
                    WHERE RecipeGuid = CAST(? AS uniqueidentifier)
                    """,
                    (recipe_guid,),
                )
                recipe_lines = cursor.fetchall()
                for ln in recipe_lines:
                    comp_name = (ln[0] or "").strip() or "مكون"
                    comp_qty = float(ln[1] or 0) * qty
                    comp_unit = (ln[2] or "EA")
                    comp_unit_cost = float(ln[3] or 0)
                    comp_pg = ln[4] if len(ln) > 4 else None
                    comp_product_guide = str(comp_pg).strip() if comp_pg else None
                    comp_total = comp_qty * comp_unit_cost
                    if comp_qty <= 0:
                        continue
                    _insert_stock_movement(
                        cursor=cursor,
                        movement_type="SALE_RECIPE_OUT",
                        reference_id=ref,
                        invoice_guid=main_guide,
                        invoice_type_guid=invoice_type,
                        product_guide=comp_product_guide,
                        item_name=comp_name,
                        qty_in=0,
                        qty_out=comp_qty,
                        unit_code=comp_unit,
                        unit_cost=comp_unit_cost,
                        total_cost=comp_total,
                        notes=f"خصم مشتقات بيع الصنف {item_name}",
                    )
            else:
                # fallback: خصم المنتج النهائي نفسه إذا لم توجد وصفة
                _insert_stock_movement(
                    cursor=cursor,
                    movement_type="SALE_PRODUCT_OUT",
                    reference_id=ref,
                    invoice_guid=main_guide,
                    invoice_type_guid=invoice_type,
                    product_guide=item_product_guide,
                    item_name=item_name,
                    qty_in=0,
                    qty_out=qty,
                    unit_code=unit_code,
                    unit_cost=unit_price,
                    total_cost=total_value_line,
                    notes="خصم مباشر لعدم وجود Recipe",
                )
        
        conn.commit()
        
        return {
            "success": True,
            "MainGuide": main_guide,
            "BillNumber": invoice.BillNumber,
            "message": "تم حفظ الفاتورة بنجاح"
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"خطأ في الحفظ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

# ========== Generate Invoice Number ==========
@app.get("/api/invoices/next-number")
def get_next_invoice_number(invoice_type: Optional[str] = None):
    """الحصول على رقم فاتورة جديد حسب النمط"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        
        # إذا لم يتم تحديد النمط، استخدم المبيعات كافتراضي
        if not invoice_type:
            invoice_type = "3478A885-6D69-4058-892E-8A57496DB9BC"  # فاتورة الكترونية
        
        # البحث عن أكبر رقم فاتورة من نفس النمط
        # MainGuide في TBL022 = CardGuide في TBL020 (نوع الفاتورة)
        query = """
        SELECT MAX(BillNumber) 
        FROM TBL022 
        WHERE MainGuide = CAST(? AS uniqueidentifier)
        """
        cursor.execute(query, invoice_type)
        result = cursor.fetchone()
        max_num = int(result[0]) if result[0] else 0
        next_number = max_num + 1
        return {"next_number": next_number}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

# ========== Submit Electronic Invoice ==========
@app.post("/api/invoices/{main_guide}/submit-electronic")
def submit_electronic_invoice(main_guide: str):
    """إرسال فاتورة إلكترونية باستخدام EInvoiceCLI.exe"""
    from config import EINVOICE_CLI_PATH, create_einvoice_settings_json
    
    einvoice_cli_path = EINVOICE_CLI_PATH
    einvoice_dir = os.path.dirname(einvoice_cli_path)
    settings_json_path = os.path.join(einvoice_dir, "settings.json")
    
    # إنشاء/تحديث settings.json إذا لم يكن موجوداً أو كان قديماً
    try:
        if not os.path.exists(settings_json_path):
            print(f"📝 إنشاء ملف settings.json في: {settings_json_path}")
            with open(settings_json_path, 'w', encoding='utf-8') as f:
                f.write(create_einvoice_settings_json())
        else:
            # تحديث الملف إذا كان موجوداً (اختياري - يمكن تعطيله)
            print(f"✅ ملف settings.json موجود: {settings_json_path}")
    except Exception as e:
        print(f"⚠️  تحذير: لم يتم إنشاء/تحديث settings.json: {e}")
    
    if not os.path.exists(einvoice_cli_path):
        raise HTTPException(
            status_code=500, 
            detail=f"برنامج الفاتورة الإلكترونية غير موجود: {einvoice_cli_path}"
        )
    
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        
        # قراءة بيانات الفاتورة من TBL022
        header_query = """
        SELECT BillNumber, BillDate, DoneIn, AgentGuide, Project, CostCenter, Notes,
               Discount, TaxValue, LocalAdministrativeTax
        FROM TBL022
        WHERE CardGuide = CAST(? AS uniqueidentifier)
        """
        cursor.execute(header_query, main_guide)
        header_row = cursor.fetchone()
        
        if not header_row:
            raise HTTPException(status_code=404, detail="الفاتورة غير موجودة")
        
        bill_number, bill_date, done_in, agent_guide, project, cost_center, notes, \
        discount, tax_value, local_tax = header_row
        
        # قراءة بيانات العميل من TBL016
        agent_name = ""
        agent_tax_code = ""
        if agent_guide:
            agent_query = """
            SELECT AgentName, TaxCode FROM TBL016 WHERE CardGuide = CAST(? AS uniqueidentifier)
            """
            cursor.execute(agent_query, agent_guide)
            agent_row = cursor.fetchone()
            if agent_row:
                agent_name = agent_row[0] or ""
                agent_tax_code = agent_row[1] or ""
        
        # قراءة الأصناف من TBL023
        items_query = """
        SELECT ProductGuide, Quantity, Unit, TotalValue
        FROM TBL023
        WHERE MainGuide = CAST(? AS uniqueidentifier)
        """
        cursor.execute(items_query, main_guide)
        items_rows = cursor.fetchall()
        
        items = []
        for row in items_rows:
            product_guide, quantity, unit, total_value = row
            
            # قراءة بيانات المنتج من TBL007
            product_name = "غير معروف"
            product_code = ""
            try:
                product_query = """
                SELECT ProductName, ProductCode FROM TBL007 WHERE CardGuide = CAST(? AS uniqueidentifier)
                """
                cursor.execute(product_query, product_guide)
                product_row = cursor.fetchone()
                if product_row:
                    product_name = product_row[0] or "غير معروف"
                    product_code = product_row[1] or ""
            except:
                pass
            
            items.append({
                "ProductGuide": str(product_guide),
                "ProductName": product_name,
                "ProductCode": product_code,
                "Quantity": float(quantity),
                "Unit": unit or "PK",
                "TotalValue": float(total_value)
            })
        
        # بناء JSON للفاتورة الإلكترونية
        invoice_json = {
            "BillNumber": int(bill_number) if bill_number else 0,
            "BillDate": bill_date.strftime("%Y-%m-%d") if bill_date else datetime.now().strftime("%Y-%m-%d"),
            "DoneIn": done_in.strftime("%Y-%m-%d") if done_in else datetime.now().strftime("%Y-%m-%d"),
            "AgentGuide": str(agent_guide) if agent_guide else "",
            "AgentName": agent_name,
            "AgentTaxCode": agent_tax_code,
            "Project": str(project) if project else "",
            "CostCenter": str(cost_center) if cost_center else "",
            "Notes": notes or "",
            "Discount": float(discount) if discount else 0.0,
            "TaxValue": float(tax_value) if tax_value else 0.0,
            "LocalAdministrativeTax": float(local_tax) if local_tax else 0.0,
            "Items": items
        }
        
        # إنشاء ملف JSON مؤقت
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
            json.dump(invoice_json, f, ensure_ascii=False, indent=2)
            json_file_path = f.name
        
        result_file_path = json_file_path + ".result"
        
        try:
            # استدعاء EInvoiceCLI.exe
            print(f"🚀 جارٍ إرسال الفاتورة الإلكترونية: {main_guide}")
            print(f"📄 ملف JSON: {json_file_path}")
            
            process = subprocess.run(
                [einvoice_cli_path, "/submit_json", json_file_path],
                capture_output=True,
                text=True,
                timeout=60
            )
            
            # قراءة النتيجة
            result = {}
            if os.path.exists(result_file_path):
                with open(result_file_path, 'r', encoding='utf-8') as f:
                    result = json.load(f)
            else:
                result = {
                    "success": False,
                    "message": "لم يتم إنشاء ملف النتيجة",
                    "stdout": process.stdout,
                    "stderr": process.stderr
                }
            
            # تنظيف الملفات المؤقتة
            try:
                if os.path.exists(json_file_path):
                    os.remove(json_file_path)
                if os.path.exists(result_file_path):
                    os.remove(result_file_path)
            except:
                pass
            
            return {
                "success": result.get("success", False),
                "submissionId": result.get("submissionId", ""),
                "uuid": result.get("uuid", ""),
                "status": result.get("status", "Unknown"),
                "message": result.get("message", ""),
                "details": result.get("details", ""),
                "signStatus": result.get("signStatus", "")
            }
            
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=500, detail="انتهت مهلة إرسال الفاتورة الإلكترونية")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"خطأ في إرسال الفاتورة: {str(e)}")
        finally:
            # تنظيف الملفات المؤقتة في حالة الخطأ
            try:
                if os.path.exists(json_file_path):
                    os.remove(json_file_path)
                if os.path.exists(result_file_path):
                    os.remove(result_file_path)
            except:
                pass
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

# ========== Custody (عهدة مستديمة) ==========

class CustodyItem(BaseModel):
    ID: Optional[int] = None
    DebitRate: float  # مدين
    CreditRate: float = 0.0  # دائن
    AccountGuide: str  # الحساب (مثل: 55002-ضيافة-)
    Notes: Optional[str] = None
    Photo1: Optional[str] = None  # صورة
    Photo2: Optional[str] = None  # PDF
    Img02: Optional[str] = None  # TBL038_img02

class CustodyHeader(BaseModel):
    BondNumber: int  # رقم السند
    InDate: str  # التاريخ
    DoneIn: str  # تمت في
    Currency: str = "EGP"  # العملة
    Rate: float = 1.0  # سعر الصرف
    AccountGuide: str  # الحساب (179014-عهدة مصروفات الجمعية-)
    CostCenter: Optional[str] = None  # مركز الكلفة
    Project: Optional[str] = None  # المشروع
    CheckNumber: Optional[str] = None  # رقم شيك العهدة
    Notes: str  # ملاحظات
    Notes2: Optional[str] = None  # ملاحظات سندات 2
    Items: List[CustodyItem]  # الأصناف

@app.get("/api/custody")
def get_custody_list():
    """الحصول على قائمة سندات العهدة"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        # البحث في TBL022 عن سندات العهدة
        # (نحتاج معرف نوع سند العهدة من TBL020)
        query = """
        SELECT TOP 50 TBL022.CardGuide, TBL022.BillNumber, TBL022.BillDate, TBL022.Notes
        FROM TBL022
        WHERE TBL022.Notes LIKE '%عهدة%' OR TBL022.Notes LIKE '%سلفة%'
        ORDER BY TBL022.BillDate DESC
        """
        cursor.execute(query)
        
        custody_list = []
        for row in cursor.fetchall():
            custody_list.append({
                "CardGuide": str(row[0]),
                "BondNumber": row[1],
                "Date": row[2].strftime("%d-%m-%Y") if row[2] else "",
                "Notes": row[3] or ""
            })
        return {"custody_list": custody_list}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.get("/api/custody/{card_guide}")
def get_custody(card_guide: str):
    """تحميل سند عهدة كامل"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        
        # قراءة رأس السند من TBL022
        header_query = """
        SELECT BillNumber, BillDate, DoneIn, Project, CostCenter, Notes, 
               Discount, TaxValue, LocalAdministrativeTax
        FROM TBL022
        WHERE CardGuide = CAST(? AS uniqueidentifier)
        """
        cursor.execute(header_query, card_guide)
        header_row = cursor.fetchone()
        
        if not header_row:
            raise HTTPException(status_code=404, detail="سند العهدة غير موجود")
        
        # قراءة الأصناف من TBL038 (أو TBL023 إذا كان نفس البنية)
        # نحاول TBL038 أولاً
        items_query = """
        SELECT ID, DebitRate, CreditRate, AccountGuide, Notes, Photo1, Photo2, Img02
        FROM TBL038
        WHERE MainGuide = CAST(? AS uniqueidentifier)
        ORDER BY ID
        """
        cursor.execute(items_query, card_guide)
        items_rows = cursor.fetchall()
        
        items = []
        for row in items_rows:
            items.append({
                "ID": row[0],
                "DebitRate": float(row[1]) if row[1] else 0.0,
                "CreditRate": float(row[2]) if row[2] else 0.0,
                "AccountGuide": row[3] or "",
                "Notes": row[4] or "",
                "Photo1": row[5] or "",
                "Photo2": row[6] or "",
                "Img02": row[7] or ""
            })
        
        # إذا لم نجد في TBL038، نحاول TBL023
        if not items:
            items_query2 = """
            SELECT ProductGuide, TotalValue, Notes
            FROM TBL023
            WHERE MainGuide = CAST(? AS uniqueidentifier)
            """
            cursor.execute(items_query2, card_guide)
            items_rows2 = cursor.fetchall()
            
            for idx, row in enumerate(items_rows2, 1):
                items.append({
                    "ID": idx,
                    "DebitRate": float(row[1]) if row[1] else 0.0,
                    "CreditRate": 0.0,
                    "AccountGuide": str(row[0]) if row[0] else "",
                    "Notes": row[2] or "",
                    "Photo1": "",
                    "Photo2": "",
                    "Img02": ""
                })
        
        # حساب الإجماليات
        total_debit = sum(item["DebitRate"] for item in items)
        total_credit = sum(item["CreditRate"] for item in items)
        difference = total_debit - total_credit
        
        return {
            "CardGuide": card_guide,
            "BondNumber": header_row[0],
            "InDate": header_row[1].strftime("%d-%m-%Y") if header_row[1] else "",
            "DoneIn": header_row[2].strftime("%d-%m-%Y") if header_row[2] else "",
            "Project": str(header_row[3]) if header_row[3] else "",
            "CostCenter": str(header_row[4]) if header_row[4] else "",
            "Notes": header_row[5] or "",
            "Items": items,
            "TotalDebit": total_debit,
            "TotalCredit": total_credit,
            "Difference": difference
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.post("/api/custody")
def save_custody(custody: CustodyHeader):
    """حفظ سند عهدة جديد"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        
        # إنشاء CardGuide جديد
        card_guide = str(uuid.uuid4()).upper()
        
        # نوع سند العهدة (نحتاج معرفه من TBL020)
        # افتراضياً نستخدم نوع "عهدة مستديمة"
        custody_type_guid = "AB6C8F10-E217-4DBE-8974-7FDDE186ECA3"  # من HTML
        
        # تحويل التواريخ
        try:
            in_date = datetime.strptime(custody.InDate, "%d-%m-%Y")
        except:
            in_date = datetime.now()
        
        try:
            done_in = datetime.strptime(custody.DoneIn, "%d-%m-%Y")
        except:
            done_in = datetime.now()
        
        # حفظ رأس السند في TBL022
        header_query = """
        INSERT INTO TBL022 
        (CardGuide, MainGuide, BillNumber, BillDate, DoneIn, Project, CostCenter, Notes, 
         LockRelations, InsertedIn, Paid, PayMethod)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        cursor.execute(header_query, (
            card_guide,
            custody_type_guid,
            custody.BondNumber,
            in_date,
            done_in,
            custody.Project or None,
            custody.CostCenter or None,
            custody.Notes or None,
            False,
            datetime.now(),
            0.0,
            0  # نقدي
        ))
        
        # حفظ الأصناف في TBL038 (أو TBL023)
        # نحاول TBL038 أولاً
        for idx, item in enumerate(custody.Items, 1):
            try:
                item_query = """
                INSERT INTO TBL038 
                (MainGuide, ID, DebitRate, CreditRate, AccountGuide, Notes, Photo1, Photo2, Img02, InsertedIn)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """
                cursor.execute(item_query, (
                    card_guide,
                    item.ID or idx,
                    item.DebitRate,
                    item.CreditRate,
                    item.AccountGuide,
                    item.Notes or None,
                    item.Photo1 or None,
                    item.Photo2 or None,
                    item.Img02 or None,
                    datetime.now()
                ))
            except:
                # إذا فشل TBL038، نحفظ في TBL023
                item_query2 = """
                INSERT INTO TBL023 
                (MainGuide, ProductGuide, TotalValue, Notes, InsertedIn)
                VALUES (?, ?, ?, ?, ?)
                """
                cursor.execute(item_query2, (
                    card_guide,
                    item.AccountGuide,  # نستخدم AccountGuide كـ ProductGuide
                    item.DebitRate,
                    item.Notes or None,
                    datetime.now()
                ))
        
        conn.commit()
        
        # حساب الإجماليات
        total_debit = sum(item.DebitRate for item in custody.Items)
        total_credit = sum(item.CreditRate for item in custody.Items)
        difference = total_debit - total_credit
        
        return {
            "success": True,
            "CardGuide": card_guide,
            "BondNumber": custody.BondNumber,
            "TotalDebit": total_debit,
            "TotalCredit": total_credit,
            "Difference": difference,
            "message": "تم حفظ سند العهدة بنجاح"
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"خطأ في الحفظ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.get("/api/custody/next-number")
def get_next_custody_number():
    """الحصول على رقم سند عهدة جديد"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        # البحث عن أكبر رقم سند عهدة
        query = """
        SELECT MAX(BillNumber) 
        FROM TBL022 
        WHERE Notes LIKE '%عهدة%' OR Notes LIKE '%سلفة%'
        """
        cursor.execute(query)
        result = cursor.fetchone()
        max_num = int(result[0]) if result[0] else 0
        next_number = max_num + 1
        return {"next_number": next_number}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.get("/api/accounts")
def get_accounts():
    """الحصول على قائمة الحسابات (للعهدة)"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        # البحث في TBL004 (الحسابات)
        query = """
        SELECT TOP 100 CardGuide, AccountName, CardCode
        FROM TBL004
        WHERE AccountName IS NOT NULL
        ORDER BY CardCode
        """
        cursor.execute(query)
        
        accounts = []
        for row in cursor.fetchall():
            accounts.append({
                "CardGuide": str(row[0]),
                "AccountName": row[1],
                "CardCode": str(row[2]) if row[2] else "",
                "DisplayName": f"{row[2] or ''}-{row[1]}" if row[2] else row[1]
            })
        return {"accounts": accounts}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.get("/api/accounts/sub")
def get_sub_accounts(
    active_only: bool = True,
    leaves_only: bool = False,
):
    """دليل الحسابات — فرعي (CardGuide <> MainAccount).

    - active_only (افتراضي True): ISNULL(NotActive,0)=0
    - leaves_only: حسابات ورقة فقط — لا يوجد صف آخر MainAccount = هذا.CardGuide
    - يُرجع حقول اختيارية من TBL004 مع أسماء من TBL001 / TBL005 / TBL050 / TBL049
    """
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")

    try:
        cursor = conn.cursor()
        leaf_sql = ""
        if leaves_only:
            leaf_sql = """
              AND NOT EXISTS (
                SELECT 1 FROM TBL004 c2
                WHERE c2.MainAccount = a.CardGuide AND c2.CardGuide <> a.CardGuide
              )
            """
        active_sql = " AND ISNULL(a.NotActive, 0) = 0 " if active_only else ""

        query = f"""
        SELECT
            a.CardGuide,
            a.AccountName,
            a.CardCode,
            a.MainAccount,
            a.DefaultCurrency,
            a.DefaultCostCenter,
            a.DefaultBranch,
            a.DefaultProject,
            a.LatinName,
            a.TaxCode,
            a.MaxDebit,
            a.MaxCredit,
            a.Security,
            cur.CurrencyName,
            cur.LatinName,
            cc.CostCenter,
            br.BronchName,
            pr.ProjectName
        FROM TBL004 a
        LEFT JOIN TBL001 cur ON cur.CardGuide = a.DefaultCurrency
        LEFT JOIN TBL005 cc ON cc.CardGuide = a.DefaultCostCenter
        LEFT JOIN TBL050 br ON br.CardGuide = a.DefaultBranch
        LEFT JOIN TBL049 pr ON pr.CardGuide = a.DefaultProject
        WHERE a.CardGuide <> a.MainAccount
        {active_sql}
        {leaf_sql}
        ORDER BY a.CardCode
        """
        cursor.execute(query)

        def _fnum(v):
            if v is None:
                return None
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        accounts = []
        for row in cursor.fetchall():
            code = str(row[2]) if row[2] is not None else ""
            name = row[1] or ""
            accounts.append({
                "CardGuide": str(row[0]),
                "AccountName": row[1],
                "CardCode": code,
                "MainAccount": str(row[3]) if row[3] else None,
                "DisplayName": f"{code}-{name}".strip("-") if code else name,
                "DefaultCurrency": str(row[4]) if row[4] else None,
                "DefaultCurrencyName": row[13] or None,
                "DefaultCurrencyLatin": row[14] or None,
                "DefaultCostCenter": str(row[5]) if row[5] else None,
                "DefaultCostCenterName": row[15] or None,
                "DefaultBranch": str(row[6]) if row[6] else None,
                "DefaultBranchName": row[16] or None,
                "DefaultProject": str(row[7]) if row[7] else None,
                "DefaultProjectName": row[17] or None,
                "LatinName": row[8] or None,
                "TaxCode": row[9] or None,
                "MaxDebit": _fnum(row[10]),
                "MaxCredit": _fnum(row[11]),
                "Security": int(row[12]) if row[12] is not None else None,
            })
        return {"accounts": accounts}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


# ========== أنواع القيود (TBL009) — لسندات صرف/قبض/قيد ==========
@app.get("/api/entry-types")
def get_entry_types():
    """أنواع القيود من TBL009 (صرف، قبض، قيد...)"""
    conn = None
    try:
        conn = get_connection()
        if not conn:
            raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
        cursor = conn.cursor()
        cursor.execute("""
            SELECT CardGuide, EntryName, EntryLatinName, EntryType
            FROM TBL009
            WHERE EntryName IS NOT NULL
            ORDER BY EntryName
        """)
        rows = cursor.fetchall()
        return {"entry_types": [{"CardGuide": str(r[0]), "EntryName": r[1], "EntryLatinName": (r[2] or ""), "EntryType": (r[3] or 0)} for r in rows]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.post("/api/entry-types")
def create_entry_type(body: dict):
    """إضافة نوع قيد/سند (TBL009)"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    name = (body.get("EntryName") or body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="اسم نوع القيد مطلوب")
    try:
        cursor = conn.cursor()
        g = str(uuid.uuid4()).upper()
        latin = (body.get("EntryLatinName") or "").strip() or None
        etype = int(body.get("EntryType") or body.get("type") or 0)
        cursor.execute("INSERT INTO TBL009 (CardGuide, EntryName, EntryLatinName, EntryType) VALUES (?, ?, ?, ?)", (g, name, latin, etype))
        conn.commit()
        return {"success": True, "CardGuide": g, "EntryName": name}
    except Exception as e:
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn: conn.close()
        except Exception: pass

# ========== العملات TBL001 ==========
@app.get("/api/currencies")
def get_currencies():
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT CardGuide, CurrencyName, LatinName, Rate, Partity FROM TBL001 WHERE CurrencyName IS NOT NULL ORDER BY CurrencyName")
        rows = cursor.fetchall()
        return {"currencies": [{"CardGuide": str(r[0]), "CurrencyName": r[1], "LatinName": (r[2] or ""), "Rate": float(r[3] or 1), "Partity": float(r[4] or 1)} for r in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.post("/api/currencies")
def create_currency(body: dict):
    """إضافة عملة (TBL001)"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    name = (body.get("CurrencyName") or body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="اسم العملة مطلوب")
    try:
        cursor = conn.cursor()
        g = str(uuid.uuid4()).upper()
        rate = float(body.get("Rate") or 1)
        partity = float(body.get("Partity") or 1)
        latin = (body.get("LatinName") or "").strip() or None
        part_name = (body.get("CurrencyPartName") or "").strip() or None
        cursor.execute(
            "INSERT INTO TBL001 (CardGuide, CurrencyName, LatinName, CurrencyPartName, Rate, Partity) VALUES (?, ?, ?, ?, ?, ?)",
            (g, name, latin, part_name, rate, partity)
        )
        conn.commit()
        return {"success": True, "CardGuide": g, "CurrencyName": name}
    except Exception as e:
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn: conn.close()
        except Exception: pass

# ========== الحسابات الختامية TBL002 ==========
@app.get("/api/closing-accounts")
def get_closing_accounts():
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT CardGuide, ClosingAccountName, ClosingAccountLatinName, CardCode FROM TBL002 WHERE ClosingAccountName IS NOT NULL ORDER BY CardCode")
        rows = cursor.fetchall()
        return {"closing_accounts": [{"CardGuide": str(r[0]), "ClosingAccountName": r[1], "LatinName": (r[2] or ""), "CardCode": (r[3] or "")} for r in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

# ========== الفروع TBL050 ==========
@app.get("/api/branches")
def get_branches():
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT CardGuide, BronchName, LatinName, CardCode FROM TBL050 WHERE BronchName IS NOT NULL ORDER BY CardCode")
        rows = cursor.fetchall()
        return {"branches": [{"CardGuide": str(r[0]), "BranchName": r[1], "LatinName": (r[2] or ""), "CardCode": (r[3] or "")} for r in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.post("/api/branches")
def create_branch(body: dict):
    """إضافة فرع (TBL050) — العمود في القاعدة: BronchName"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    name = (body.get("BranchName") or body.get("BronchName") or body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="اسم الفرع مطلوب")
    try:
        cursor = conn.cursor()
        g = str(uuid.uuid4()).upper()
        latin = (body.get("LatinName") or "").strip() or None
        code = (body.get("CardCode") or "").strip() or None
        cursor.execute("INSERT INTO TBL050 (CardGuide, BronchName, LatinName, CardCode) VALUES (?, ?, ?, ?)", (g, name, latin, code))
        conn.commit()
        return {"success": True, "CardGuide": g, "BranchName": name}
    except Exception as e:
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn: conn.close()
        except Exception: pass

# ========== المستودعات TBL008 ==========
@app.get("/api/warehouses")
def get_warehouses():
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT CardGuide, WarehouseName, LatinName FROM TBL008 WHERE WarehouseName IS NOT NULL ORDER BY WarehouseName")
        rows = cursor.fetchall()
        return {"warehouses": [{"CardGuide": str(r[0]), "WarehouseName": r[1], "LatinName": (r[2] or "")} for r in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.post("/api/warehouses")
def create_warehouse(body: dict):
    """إضافة مستودع (TBL008)"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    name = (body.get("WarehouseName") or body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="اسم المستودع مطلوب")
    try:
        cursor = conn.cursor()
        g = str(uuid.uuid4()).upper()
        latin = (body.get("LatinName") or "").strip() or None
        cursor.execute("INSERT INTO TBL008 (CardGuide, WarehouseName, LatinName) VALUES (?, ?, ?)", (g, name, latin))
        conn.commit()
        return {"success": True, "CardGuide": g, "WarehouseName": name}
    except Exception as e:
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn: conn.close()
        except Exception: pass

# ========== قائمة السندات TBL010 + TBL009 ==========
@app.get("/api/bonds")
def get_bonds_list(main_guide: Optional[str] = None, limit: int = 100):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        if main_guide:
            cursor.execute("SELECT TOP (?) b.CardGuide, b.MainGuide, b.BondNumber, b.BondDate, b.Rate, b.Notes, e.EntryName FROM TBL010 b LEFT JOIN TBL009 e ON e.CardGuide = b.MainGuide WHERE b.MainGuide = CAST(? AS uniqueidentifier) ORDER BY b.BondDate DESC, b.BondNumber DESC", (int(limit), main_guide))
        else:
            cursor.execute("SELECT TOP (?) b.CardGuide, b.MainGuide, b.BondNumber, b.BondDate, b.Rate, b.Notes, e.EntryName FROM TBL010 b LEFT JOIN TBL009 e ON e.CardGuide = b.MainGuide ORDER BY b.BondDate DESC, b.BondNumber DESC", (int(limit),))
        rows = cursor.fetchall()
        return {"bonds": [{"CardGuide": str(r[0]), "MainGuide": str(r[1]), "BondNumber": int(r[2]) if r[2] else 0, "BondDate": r[3], "Rate": float(r[4] or 1), "Notes": (r[5] or ""), "EntryTypeName": (r[6] or "")} for r in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.get("/api/bonds/next-number")
def get_bonds_next_number(main_guide: str):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT ISNULL(MAX(BondNumber), 0) + 1 FROM TBL010 WHERE MainGuide = CAST(? AS uniqueidentifier)", (main_guide,))
        r = cursor.fetchone()
        return {"next_number": int(r[0]) if r else 1}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.get("/api/bonds/{card_guide}")
def get_bond_by_id(card_guide: str):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT CardGuide, MainGuide, BondNumber, BondDate, Rate, CurrencyGuide, AccountGuide, AgentGuide, AccountGuide2, Notes FROM TBL010 WHERE CardGuide = CAST(? AS uniqueidentifier)", (card_guide,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="السند غير موجود")
        cursor.execute("SELECT AccountGuide, Debit, Credit, Notes FROM TBL038 WHERE MainGuide = CAST(? AS uniqueidentifier) ORDER BY ID", (card_guide,))
        details = [{"AccountGuide": str(r[0]), "Debit": float(r[1] or 0), "Credit": float(r[2] or 0), "Notes": (r[3] or "")} for r in cursor.fetchall()]
        return {"header": {"CardGuide": str(row[0]), "MainGuide": str(row[1]), "BondNumber": int(row[2]), "BondDate": row[3], "Rate": float(row[4] or 1), "CurrencyGuide": str(row[5]) if row[5] else None, "AccountGuide": str(row[6]) if row[6] else None, "AgentGuide": str(row[7]) if row[7] else None, "AccountGuide2": str(row[8]) if row[8] else None, "Notes": (row[9] or "")}, "details": details}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

# ========== القيود TBL011 + TBL012 ==========
@app.get("/api/entries")
def get_entries_list(limit: int = 100):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT TOP (?) CardGuide, EntryNumber, EntryDate, Rate, Notes, BillGuide, BondGuide FROM TBL011 ORDER BY EntryDate DESC, EntryNumber DESC", (int(limit),))
        rows = cursor.fetchall()
        return {"entries": [{"CardGuide": str(r[0]), "EntryNumber": int(r[1]) if r[1] else 0, "EntryDate": r[2], "Rate": float(r[3] or 1), "Notes": (r[4] or ""), "BillGuide": str(r[5]) if r[5] else None, "BondGuide": str(r[6]) if r[6] else None} for r in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.get("/api/entries/next-number")
def get_entries_next_number():
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT ISNULL(MAX(EntryNumber), 0) + 1 FROM TBL011")
        r = cursor.fetchone()
        return {"next_number": int(r[0]) if r else 1}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.get("/api/entries/{card_guide}")
def get_entry_by_id(card_guide: str):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT CardGuide, EntryNumber, EntryDate, Rate, Notes, CurrencyGuide, BillGuide, BondGuide FROM TBL011 WHERE CardGuide = CAST(? AS uniqueidentifier)", (card_guide,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="القيد غير موجود")
        cursor.execute("SELECT AccountGuide, Debit, Credit, Description FROM TBL012 WHERE MainGuide = CAST(? AS uniqueidentifier) ORDER BY ID", (card_guide,))
        details = [{"AccountGuide": str(r[0]), "Debit": float(r[1] or 0), "Credit": float(r[2] or 0), "Description": (r[3] or "")} for r in cursor.fetchall()]
        return {"header": {"CardGuide": str(row[0]), "EntryNumber": int(row[1]), "EntryDate": row[2], "Rate": float(row[3] or 1), "Notes": (row[4] or ""), "CurrencyGuide": str(row[5]) if row[5] else None, "BillGuide": str(row[6]) if row[6] else None, "BondGuide": str(row[7]) if row[7] else None}, "details": details}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


# ========== العمليات — اعادة توليد قيود (مثل إكسترا) ==========
@app.get("/api/operations/needing-rebuild")
def get_entries_needing_rebuild(limit: int = 200):
    """قيود لها رأس (TBL011) لكن بلا بنود (TBL012) — أو فواتير/سندات يمكن إعادة توليد قيودها.
    يُرجع: CardGuide (القيد), BillGuide, BondGuide, EntryNumber, EntryDate لاستخدامها في اعادة التوليد."""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT e.CardGuide, e.BillGuide, e.BondGuide, e.EntryNumber, e.EntryDate, e.Notes
            FROM TBL011 e
            LEFT JOIN TBL012 d ON d.MainGuide = e.CardGuide
            WHERE d.ID IS NULL
            ORDER BY e.EntryDate DESC, e.EntryNumber DESC
        """)
        rows = cursor.fetchall()
        out = []
        for r in rows:
            out.append({
                "EntryGuide": str(r[0]),
                "BillGuide": str(r[1]) if r[1] else None,
                "BondGuide": str(r[2]) if r[2] else None,
                "EntryNumber": int(r[3]) if r[3] else 0,
                "EntryDate": str(r[4]) if r[4] else "",
                "Notes": (r[5] or "")[:80],
            })
        return {"items": out[: int(limit)], "count": len(out)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


@app.post("/api/operations/rebuild-entries")
def run_rebuild_entries(body: dict):
    """تنفيذ اعادة توليد القيود — يستدعي Prc008 للفواتير و Prc027 للسندات (إن وُجدت في القاعدة).
    Body: { "bill_guides": ["uuid", ...], "bond_guides": ["uuid", ...] }"""
    bill_guides = body.get("bill_guides") or []
    bond_guides = body.get("bond_guides") or []
    if not bill_guides and not bond_guides:
        return {"success": True, "message": "لم يتم اختيار فواتير أو سندات", "processed": 0, "errors": []}
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    errors = []
    processed = 0
    try:
        cursor = conn.cursor()
        for bg in bill_guides:
            if not bg:
                continue
            try:
                cursor.execute("EXEC dbo.Prc008 ?, ?, ?, ?", (bg, "", "", 0))
                conn.commit()
                processed += 1
            except Exception as e:
                errors.append({"type": "bill", "guide": bg, "error": str(e)})
        for bg in bond_guides:
            if not bg:
                continue
            try:
                cursor.execute("EXEC dbo.Prc027 ?", (bg,))
                conn.commit()
                processed += 1
            except Exception as e:
                errors.append({"type": "bond", "guide": bg, "error": str(e)})
        return {"success": True, "processed": processed, "errors": errors}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


# ========== التقارير ==========
@app.get("/api/securities")
def get_securities():
    """الأوراق المالية — إن وُجد جدول في القاعدة"""
    conn = get_connection()
    if not conn:
        return {"securities": [], "message": "فشل الاتصال بقاعدة البيانات"}
    try:
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT CardGuide, SecurityName, SecurityCode, IssueDate, FaceValue FROM TBL_Securities ORDER BY SecurityCode")
        except Exception:
            try:
                cursor.execute("SELECT ID, SecurityName, SecurityCode, IssueDate, FaceValue FROM Securities ORDER BY SecurityCode")
            except Exception:
                return {"securities": [], "message": "جدول الأوراق المالية غير موجود (TBL_Securities أو Securities)."}
        rows = cursor.fetchall()
        cols = [d[0] for d in cursor.description]
        def _ser(x):
            if x is None: return None
            if hasattr(x, 'hex'): return str(x)
            if hasattr(x, 'isoformat'): return x.isoformat()
            return x
        return {"securities": [dict(zip(cols, [_ser(x) for x in r])) for r in rows]}
    except Exception as e:
        return {"securities": [], "message": str(e)}
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.get("/api/reports")
def get_reports_list():
    """قائمة التقارير المتاحة — محاكاة إكسترا"""
    return {
        "reports": [
            {"id": "trial_balance", "name_ar": "ميزان المراجعة", "name_en": "Trial Balance", "params": ["from_date", "to_date"]},
            {"id": "general_ledger", "name_ar": "دفتر الأستاذ العام", "name_en": "General Ledger", "params": ["account_guide", "from_date", "to_date"]},
            {"id": "customer_statement", "name_ar": "كشف حساب عميل", "name_en": "Customer Statement", "params": ["agent_guide", "from_date", "to_date", "currency_guide", "show_opening_balance", "posted_only"]},
            {"id": "relations_quantities", "name_ar": "مراقبة كميات الارتباطات", "name_en": "Relations Quantities Monitoring", "params": ["from_date", "to_date", "show_only_unlinked"]},
            {"id": "invoice_aging", "name_ar": "أعمار زمنية — فواتير مصدر ومولودة", "name_en": "Invoice Aging by Source", "params": ["agent_guide", "from_date", "to_date", "source_bill_guide", "show_opening_balance"]},
            {"id": "daily_movement", "name_ar": "الحركة اليومية", "name_en": "Daily Movement", "params": ["from_date", "to_date"]},
            {"id": "item_movement", "name_ar": "تقرير حركة صنف", "name_en": "Item Movement", "params": ["product_guide", "from_date", "to_date"]},
            {"id": "inventory", "name_ar": "تقرير جرد", "name_en": "Inventory Report", "params": []},
            {"id": "accounts_list", "name_ar": "قائمة الحسابات", "name_en": "Accounts List", "params": []},
            {"id": "bonds_list", "name_ar": "قائمة السندات", "name_en": "Bonds List", "params": []},
            {"id": "entries_list", "name_ar": "قائمة القيود", "name_en": "Entries List", "params": []},
        ]
    }

@app.get("/api/reports/{report_id}/run")
def run_report(
    report_id: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    account_guide: Optional[str] = None,
    agent_guide: Optional[str] = None,
    product_guide: Optional[str] = None,
    currency_guide: Optional[str] = None,
    show_opening_balance: Optional[str] = None,
    posted_only: Optional[str] = None,
    show_only_unlinked: Optional[str] = None,
    source_bill_guide: Optional[str] = None,
):
    """تشغيل تقرير — محاكاة إكسترا (كشف حساب عميل، مراقبة كميات الارتباطات، أعمار زمنية، ...)"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        fd = from_date or "1900-01-01"
        td = to_date or "2099-12-31"

        if report_id == "accounts_list":
            cursor.execute("SELECT CardGuide, CardCode, AccountName, LatinName FROM TBL004 WHERE AccountName IS NOT NULL ORDER BY CardCode")
            rows = cursor.fetchall()
            return {"columns": ["CardGuide", "CardCode", "AccountName", "LatinName"], "rows": [[str(r[0]), r[1] or "", r[2] or "", r[3] or ""] for r in rows]}

        if report_id == "bonds_list":
            cursor.execute("SELECT TOP 200 b.CardGuide, b.BondNumber, b.BondDate, b.Notes, e.EntryName FROM TBL010 b LEFT JOIN TBL009 e ON e.CardGuide = b.MainGuide ORDER BY b.BondDate DESC")
            rows = cursor.fetchall()
            return {"columns": ["CardGuide", "BondNumber", "BondDate", "Notes", "EntryTypeName"], "rows": [[str(r[0]), r[1], str(r[2]) if r[2] else "", r[3] or "", r[4] or ""] for r in rows]}

        if report_id == "entries_list":
            cursor.execute("SELECT TOP 200 CardGuide, EntryNumber, EntryDate, Notes FROM TBL011 ORDER BY EntryDate DESC")
            rows = cursor.fetchall()
            return {"columns": ["CardGuide", "EntryNumber", "EntryDate", "Notes"], "rows": [[str(r[0]), r[1], str(r[2]) if r[2] else "", r[3] or ""] for r in rows]}

        # ميزان المراجعة — إجمالي مدين/دائن لكل حساب من TBL012 ضمن الفترة
        if report_id == "trial_balance":
            q = """
            SELECT a.CardGuide, a.CardCode, a.AccountName,
                   ISNULL(SUM(d.Debit),0), ISNULL(SUM(d.Credit),0),
                   ISNULL(SUM(d.Debit),0)-ISNULL(SUM(d.Credit),0)
            FROM TBL004 a
            LEFT JOIN TBL012 d ON d.AccountGuide = a.CardGuide
            LEFT JOIN TBL011 h ON h.CardGuide = d.MainGuide
            WHERE a.AccountName IS NOT NULL
              AND (h.EntryDate IS NULL OR (CONVERT(date, h.EntryDate) >= ? AND CONVERT(date, h.EntryDate) <= ?))
            GROUP BY a.CardGuide, a.CardCode, a.AccountName
            HAVING ISNULL(SUM(d.Debit),0) <> 0 OR ISNULL(SUM(d.Credit),0) <> 0
            ORDER BY a.CardCode
            """
            cursor.execute(q, (fd, td))
            rows = cursor.fetchall()
            return {"columns": ["CardGuide", "CardCode", "AccountName", "إجمالي_مدين", "إجمالي_دائن", "الرصيد"], "rows": [[str(r[0]), r[1] or "", r[2] or "", float(r[3] or 0), float(r[4] or 0), float(r[5] or 0)] for r in rows]}

        # دفتر الأستاذ العام — حركات حساب واحد مع رصيد متراكم
        if report_id == "general_ledger":
            if not account_guide:
                cursor.execute("SELECT TOP 100 CardGuide, CardCode, AccountName FROM TBL004 WHERE AccountName IS NOT NULL ORDER BY CardCode")
                rows = cursor.fetchall()
                return {"columns": ["CardGuide", "CardCode", "AccountName"], "rows": [[str(r[0]), r[1] or "", r[2] or ""] for r in rows], "message": "أرسل account_guide لحركات الحساب"}
            q = """
            SELECT h.EntryNumber, h.EntryDate, h.Notes, d.Description, d.Debit, d.Credit
            FROM TBL012 d
            INNER JOIN TBL011 h ON h.CardGuide = d.MainGuide
            WHERE d.AccountGuide = ? AND CONVERT(date, h.EntryDate) >= ? AND CONVERT(date, h.EntryDate) <= ?
            ORDER BY h.EntryDate, h.EntryNumber
            """
            cursor.execute(q, (account_guide, fd, td))
            rows = cursor.fetchall()
            balance = 0.0
            out_rows = []
            for r in rows:
                deb, cred = float(r[4] or 0), float(r[5] or 0)
                balance += deb - cred
                out_rows.append([r[0], str(r[1]) if r[1] else "", r[2] or "", r[3] or "", deb, cred, round(balance, 2)])
            return {"columns": ["رقم_القيد", "التاريخ", "البيان", "وصف_البند", "مدين", "دائن", "الرصيد"], "rows": out_rows}

        # كشف حساب عميل — بكل الخيارات: من/إلى تاريخ، عميل، عملة، رصيد افتتاحي، مرحل فقط
        if report_id == "customer_statement":
            if not agent_guide:
                cursor.execute("SELECT TOP 100 CardGuide, AgentName, CardNumber FROM TBL016 WHERE AgentName IS NOT NULL AND CardGuide <> CAST('26CBD95C-98CB-48F3-8EEA-EE5D2B0D0500' AS uniqueidentifier) ORDER BY AgentName")
                rows = cursor.fetchall()
                return {"columns": ["CardGuide", "AgentName", "CardNumber"], "rows": [[str(r[0]), r[1] or "", r[2] or ""] for r in rows], "message": "أرسل agent_guide لكشف الحساب"}
            inv_where = "AgentGuide = ? AND CONVERT(date, TBL022.BillDate) >= ? AND CONVERT(date, TBL022.BillDate) <= ?"
            inv_params = [agent_guide, fd, td]
            if currency_guide:
                try:
                    cursor.execute("SELECT TOP 1 CurrencyGuide FROM TBL022")
                    inv_where += " AND (TBL022.CurrencyGuide = ? OR TBL022.CurrencyGuide IS NULL)"
                    inv_params.append(currency_guide)
                except Exception:
                    pass
            if str(posted_only).strip().lower() in ("1", "true", "yes", "نعم"):
                inv_where += " AND (TBL022.LockRelations = 1)"
            cursor.execute("""
            SELECT TBL022.BillDate, TBL022.BillNumber, 'فاتورة', (SELECT ISNULL(SUM(TotalValue),0) FROM TBL023 WHERE MainGuide = TBL022.CardGuide)
            FROM TBL022
            WHERE """ + inv_where + """
            ORDER BY TBL022.BillDate
            """, tuple(inv_params))
            inv_rows = cursor.fetchall()
            bond_where = "AgentGuide = ? AND CONVERT(date, BondDate) >= ? AND CONVERT(date, BondDate) <= ?"
            bond_params = [agent_guide, fd, td]
            if currency_guide:
                bond_where += " AND (CurrencyGuide = ? OR CurrencyGuide IS NULL)"
                bond_params.append(currency_guide)
            if str(posted_only).strip().lower() in ("1", "true", "yes", "نعم"):
                bond_where += " AND EXISTS (SELECT 1 FROM TBL011 e WHERE e.BondGuide = TBL010.CardGuide)"
            cursor.execute("""
            SELECT BondDate, BondNumber, Notes, (SELECT ISNULL(SUM(Debit),0)+ISNULL(SUM(Credit),0) FROM TBL038 WHERE MainGuide = TBL010.CardGuide)
            FROM TBL010
            WHERE """ + bond_where + """
            ORDER BY BondDate
            """, tuple(bond_params))
            bond_rows = cursor.fetchall()
            opening = 0.0
            if str(show_opening_balance).strip().lower() in ("1", "true", "yes", "نعم"):
                cursor.execute("""
                SELECT ISNULL(SUM(v),0) FROM (
                    SELECT (SELECT ISNULL(SUM(TotalValue),0) FROM TBL023 WHERE MainGuide = TBL022.CardGuide) AS v
                    FROM TBL022 WHERE AgentGuide = ? AND CONVERT(date, TBL022.BillDate) < ?
                ) x
                """, (agent_guide, fd))
                opening += float((cursor.fetchone() or [0])[0] or 0)
                cursor.execute("""
                SELECT ISNULL(SUM((SELECT ISNULL(SUM(Debit),0)+ISNULL(SUM(Credit),0) FROM TBL038 WHERE MainGuide = TBL010.CardGuide)),0)
                FROM TBL010 WHERE AgentGuide = ? AND CONVERT(date, BondDate) < ?
                """, (agent_guide, fd))
                opening -= float((cursor.fetchone() or [0])[0] or 0)
            rows_combined = []
            if opening != 0.0:
                rows_combined.append(("", "", "رصيد افتتاحي", opening if opening > 0 else 0.0, -opening if opening < 0 else 0.0))
            for r in inv_rows:
                rows_combined.append((str(r[0]) if r[0] else "", r[1] or "", "فاتورة", float(r[3] or 0), 0.0))
            for r in bond_rows:
                rows_combined.append((str(r[0]) if r[0] else "", r[1] or "", r[2] or "سند", 0.0, float(r[3] or 0)))
            rows_combined.sort(key=lambda x: (x[0] or "1900-01-01", x[1]))
            balance = 0.0
            out_rows = []
            for r in rows_combined:
                balance += r[3] - r[4]
                out_rows.append([r[0], r[1], r[2], r[3], r[4], round(balance, 2)])
            return {"columns": ["التاريخ", "الرقم", "البيان", "مدين", "دائن", "الرصيد"], "rows": out_rows}

        # مراقبة كميات الارتباطات — فواتير مع كميات وحالة الربط بالقيد (مرحل/غير مرحل)
        if report_id == "relations_quantities":
            only_unlinked = str(show_only_unlinked).strip().lower() in ("1", "true", "yes", "نعم")
            q = """
            SELECT b.CardGuide, b.BillNumber, b.BillDate, a.AgentName,
                   ISNULL((SELECT SUM(Quantity) FROM TBL023 WHERE MainGuide = b.CardGuide),0),
                   ISNULL((SELECT SUM(TotalValue) FROM TBL023 WHERE MainGuide = b.CardGuide),0),
                   CASE WHEN e.CardGuide IS NOT NULL THEN 1 ELSE 0 END
            FROM TBL022 b
            LEFT JOIN TBL016 a ON a.CardGuide = b.AgentGuide
            LEFT JOIN TBL011 e ON e.BillGuide = b.CardGuide
            WHERE CONVERT(date, b.BillDate) >= ? AND CONVERT(date, b.BillDate) <= ?
            """
            params = [fd, td]
            if only_unlinked:
                q += " AND e.CardGuide IS NULL"
            q += " ORDER BY b.BillDate, b.BillNumber"
            cursor.execute(q, params)
            rows = cursor.fetchall()
            cols = ["CardGuide", "رقم_الفاتورة", "التاريخ", "العميل", "مجموع_الكميات", "مجموع_القيمة", "مرتبط_بقيد"]
            return {"columns": cols, "rows": [[str(r[0]), r[1] or "", str(r[2]) if r[2] else "", r[3] or "", float(r[4] or 0), float(r[5] or 0), "نعم" if r[6] else "لا"] for r in rows]}

        # أعمار زمنية — فواتير مصدر ومولودة + تسديدات + تحليل المتبقي بأعمار (0-7، 7-15، 15-21، 21-28، 28+)
        if report_id == "invoice_aging":
            if not agent_guide:
                cursor.execute("SELECT TOP 100 CardGuide, AgentName, CardNumber FROM TBL016 WHERE AgentName IS NOT NULL ORDER BY AgentName")
                rows = cursor.fetchall()
                return {"columns": ["CardGuide", "AgentName", "CardNumber"], "rows": [[str(r[0]), r[1] or "", r[2] or ""] for r in rows], "message": "أرسل agent_guide لتقرير الأعمار الزمنية"}
            from datetime import date as _date_type, datetime as _dt_type
            try:
                as_of = _date_type.today()
            except Exception:
                try:
                    as_of = _dt_type.strptime(str(fd or "")[:10], "%Y-%m-%d").date()
                except Exception:
                    as_of = _date_type.today()
            out_rows = []
            show_open = str(show_opening_balance).strip().lower() in ("1", "true", "yes", "نعم")
            if show_open:
                cursor.execute("""
                SELECT ISNULL(SUM(v),0) FROM (
                    SELECT (SELECT ISNULL(SUM(TotalValue),0) FROM TBL023 WHERE MainGuide = TBL022.CardGuide) AS v
                    FROM TBL022 WHERE AgentGuide = ? AND CONVERT(date, TBL022.BillDate) < ?
                ) x
                """, (agent_guide, fd))
                open_inv = float((cursor.fetchone() or [0])[0] or 0)
                cursor.execute("""
                SELECT ISNULL(SUM((SELECT ISNULL(SUM(Debit),0)+ISNULL(SUM(Credit),0) FROM TBL038 WHERE MainGuide = TBL010.CardGuide)),0)
                FROM TBL010 WHERE AgentGuide = ? AND CONVERT(date, BondDate) < ?
                """, (agent_guide, fd))
                open_bnd = float((cursor.fetchone() or [0])[0] or 0)
                opening = open_inv - open_bnd
                if opening != 0.0:
                    out_rows.append(["", "رصيد افتتاحي", "", "", "", "", "", round(opening, 2), "", "رصيد افتتاحي"])
            mothers = []
            if source_bill_guide:
                cursor.execute("""
                SELECT m.CardGuide, m.BillNumber, m.BillDate, ty.InvoiceName,
                       ISNULL((SELECT SUM(TotalValue) FROM TBL023 WHERE MainGuide = m.CardGuide),0)
                FROM TBL022 m
                LEFT JOIN TBL020 ty ON ty.CardGuide = m.MainGuide
                WHERE m.CardGuide = ?
                """, (source_bill_guide,))
                r = cursor.fetchone()
                if r:
                    mothers = [(str(r[0]), r[1] or "", str(r[2]) if r[2] else "", r[3] or "فاتورة مصدر", float(r[4] or 0))]
                else:
                    mothers = [(source_bill_guide, "", "", "فاتورة مصدر", 0.0)]
            else:
                cursor.execute("""
                SELECT DISTINCT m.CardGuide, m.BillNumber, m.BillDate, ty.InvoiceName,
                       ISNULL((SELECT SUM(TotalValue) FROM TBL023 WHERE MainGuide = m.CardGuide),0)
                FROM TBL022 c
                INNER JOIN TBL022 m ON m.CardGuide = c.SourceBill
                LEFT JOIN TBL020 ty ON ty.CardGuide = m.MainGuide
                WHERE c.SourceBill IS NOT NULL AND c.AgentGuide = ?
                  AND CONVERT(date, c.BillDate) >= ? AND CONVERT(date, c.BillDate) <= ?
                """, (agent_guide, fd, td))
                mothers = [(str(r[0]), r[1] or "", str(r[2]) if r[2] else "", r[3] or "فاتورة مصدر", float(r[4] or 0)) for r in cursor.fetchall()]
            has_bill_guide = True
            try:
                cursor.execute("SELECT TOP 1 BillGuide FROM TBL010 WHERE BillGuide IS NOT NULL")
            except Exception:
                has_bill_guide = False
            for m_guide, m_num, m_date, m_type, m_val in mothers:
                cursor.execute("""
                SELECT c.CardGuide, c.BillNumber, c.BillDate
                FROM TBL022 c
                WHERE c.SourceBill = ? AND c.AgentGuide = ?
                  AND CONVERT(date, c.BillDate) >= ? AND CONVERT(date, c.BillDate) <= ?
                ORDER BY c.BillDate, c.BillNumber
                """, (m_guide, agent_guide, fd, td))
                children = cursor.fetchall()
                for ch in children:
                    ch_guide, ch_num, ch_date = str(ch[0]), ch[1] or "", str(ch[2]) if ch[2] else ""
                    cursor.execute("SELECT ISNULL(SUM(TotalValue),0) FROM TBL023 WHERE MainGuide = ?", (ch[0],))
                    ch_val = float((cursor.fetchone() or [0])[0] or 0)
                    settlements = 0.0
                    if has_bill_guide:
                        try:
                            cursor.execute("""
                            SELECT ISNULL(SUM(amt),0) FROM (
                                SELECT (SELECT ISNULL(SUM(Debit),0)+ISNULL(SUM(Credit),0) FROM TBL038 WHERE MainGuide = b.CardGuide) AS amt
                                FROM TBL010 b WHERE b.BillGuide = ?
                            ) x
                            """, (ch[0],))
                            settlements = float((cursor.fetchone() or [0])[0] or 0)
                        except Exception:
                            pass
                    remaining = ch_val - settlements
                    days = 0
                    try:
                        bd = ch[2]
                        if bd and str(bd or "")[:10]:
                            bd_date = bd.date() if hasattr(bd, 'date') else _dt_type.strptime(str(bd)[:10], "%Y-%m-%d").date()
                            ref = as_of if isinstance(as_of, _date_type) else _dt_type.strptime(str(as_of)[:10], "%Y-%m-%d").date()
                            days = (ref - bd_date).days
                    except Exception:
                        pass
                    if days <= 7:
                        bucket = "0-7 أيام"
                    elif days <= 15:
                        bucket = "7-15 يوم"
                    elif days <= 21:
                        bucket = "15-21 يوم"
                    elif days <= 28:
                        bucket = "21-28 يوم"
                    else:
                        bucket = "أكثر من 28 يوم"
                    out_rows.append([m_num, m_type, round(m_val, 2), ch_num, ch_date, round(ch_val, 2), round(settlements, 2), round(remaining, 2), days, bucket])
            return {"columns": ["أم_رقم", "أم_النوع", "أم_القيمة", "مولودة_رقم", "مولودة_تاريخ", "مولودة_قيمة", "تسديدات", "متبقي", "أيام", "فئة_العمر"], "rows": out_rows}

        # الحركة اليومية — قيود (TBL011+TBL012) وسندات (TBL010+TBL038) في الفترة بكل الحقول
        if report_id == "daily_movement":
            out_rows = []
            cursor.execute("""
            SELECT h.EntryDate, N'قيد', h.EntryNumber, h.Notes, acc.AccountName, d.Description, ISNULL(d.Debit,0), ISNULL(d.Credit,0), h.CurrencyGuide, h.Rate
            FROM TBL012 d
            INNER JOIN TBL011 h ON h.CardGuide = d.MainGuide
            LEFT JOIN TBL004 acc ON acc.CardGuide = d.AccountGuide
            WHERE CONVERT(date, h.EntryDate) >= ? AND CONVERT(date, h.EntryDate) <= ?
            ORDER BY h.EntryDate, h.EntryNumber
            """, (fd, td))
            for r in cursor.fetchall():
                out_rows.append([str(r[0]) if r[0] else "", r[1], r[2], r[3] or "", r[4] or "", r[5] or "", float(r[6] or 0), float(r[7] or 0), str(r[8]) if r[8] else "", float(r[9] or 1)])
            cursor.execute("""
            SELECT b.BondDate, et.EntryName, b.BondNumber, b.Notes, acc.AccountName, d.Notes, ISNULL(d.Debit,0), ISNULL(d.Credit,0), b.CurrencyGuide, b.Rate
            FROM TBL038 d
            INNER JOIN TBL010 b ON b.CardGuide = d.MainGuide
            LEFT JOIN TBL009 et ON et.CardGuide = b.MainGuide
            LEFT JOIN TBL004 acc ON acc.CardGuide = d.AccountGuide
            WHERE CONVERT(date, b.BondDate) >= ? AND CONVERT(date, b.BondDate) <= ?
            ORDER BY b.BondDate, b.BondNumber
            """, (fd, td))
            for r in cursor.fetchall():
                out_rows.append([str(r[0]) if r[0] else "", r[1] or "سند", r[2], r[3] or "", r[4] or "", r[5] or "", float(r[6] or 0), float(r[7] or 0), str(r[8]) if r[8] else "", float(r[9] or 1)])
            out_rows.sort(key=lambda x: (x[0], 0 if x[1] == "قيد" else 1, x[2]))
            return {"columns": ["التاريخ", "النوع", "الرقم", "البيان", "الحساب", "وصف_البند", "مدين", "دائن", "العملة", "سعر_الصرف"], "rows": out_rows}

        # تقرير حركة صنف — حركات من TBL023 (تفاصيل فواتير)
        if report_id == "item_movement":
            if not product_guide:
                cursor.execute("SELECT TOP 100 CardGuide, ProductName, LatinName FROM TBL007 WHERE ProductName IS NOT NULL AND NotActive=0 ORDER BY ProductName")
                rows = cursor.fetchall()
                return {"columns": ["CardGuide", "ProductName", "LatinName"], "rows": [[str(r[0]), r[1] or "", r[2] or ""] for r in rows], "message": "أرسل product_guide لحركة الصنف"}
            cursor.execute("""
            SELECT CONVERT(date, h.BillDate), h.BillNumber, i.Quantity, i.TotalValue
            FROM TBL023 i
            INNER JOIN TBL022 h ON h.CardGuide = i.MainGuide
            WHERE i.ProductGuide = ? AND CONVERT(date, h.BillDate) >= ? AND CONVERT(date, h.BillDate) <= ?
            ORDER BY h.BillDate
            """, (product_guide, fd, td))
            rows = cursor.fetchall()
            qty_balance = 0.0
            out_rows = []
            for r in rows:
                qty = float(r[2] or 0)
                qty_balance -= qty
                out_rows.append([str(r[0]) if r[0] else "", r[1] or "", qty, float(r[3] or 0), round(qty_balance, 2)])
            return {"columns": ["التاريخ", "رقم_الفاتورة", "الكمية", "القيمة", "رصيد_الكمية"], "rows": out_rows}

        # تقرير جرد — أصناف مع كمية مبيعات من TBL023
        if report_id == "inventory":
            cursor.execute("""
            SELECT p.CardGuide, p.CardCode, p.ProductName, p.AgentPrice,
                   (SELECT ISNULL(SUM(i.Quantity),0) FROM TBL023 i WHERE i.ProductGuide = p.CardGuide) AS QtyOut
            FROM TBL007 p
            WHERE p.ProductName IS NOT NULL AND p.NotActive = 0
            ORDER BY p.ProductName
            """)
            rows = cursor.fetchall()
            return {"columns": ["CardGuide", "CardCode", "ProductName", "السعر", "كمية_المبيعات"], "rows": [[str(r[0]), r[1] or "", r[2] or "", float(r[3] or 0), float(r[4] or 0)] for r in rows]}

        raise HTTPException(status_code=404, detail="تقرير غير معروف")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

# ========== الموارد البشرية (من TBL016 + TBL015 — مجموعة موظفين) ==========
@app.get("/api/hr/employees")
def get_hr_employees():
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT a.CardGuide, a.AgentName, a.CardNumber, a.Barcode, g.GroupName
            FROM TBL016 a
            LEFT JOIN TBL015 g ON g.CardGuide = a.MainGroupGuide
            WHERE a.AgentName IS NOT NULL
            ORDER BY a.AgentName
        """)
        rows = cursor.fetchall()
        return {"employees": [{"CardGuide": str(r[0]), "AgentName": r[1], "CardNumber": (r[2] or ""), "Barcode": (r[3] or ""), "GroupName": (r[4] or "")} for r in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.post("/api/hr/employees")
def create_hr_employee(body: dict):
    """إضافة موظف (سجل في TBL016 — نفس جدول العملاء مع اختيار المجموعة)"""
    # توجيه لإنشاء عميل مع إمكانية تحديد المجموعة
    agent = dict(body)
    agent.setdefault("MainGroupGuide", body.get("MainGroupGuide") or body.get("group_guide"))
    return create_agent(agent)

# ========== نوافذ الموارد البشرية (من ملف البرنامج — Terms Lang01) ==========
def _hr_table(conn, table_sql_map, list_key):
    """جلب بيانات من جدول إن وُجد"""
    if not conn:
        return {list_key: [], "message": "فشل الاتصال بقاعدة البيانات"}
    try:
        cursor = conn.cursor()
        for q in table_sql_map:
            try:
                cursor.execute(q["sql"])
                rows = cursor.fetchall()
                cols = [d[0] for d in cursor.description]
                def _s(x):
                    if x is None: return None
                    if hasattr(x, 'hex'): return str(x)
                    if hasattr(x, 'isoformat'): return x.isoformat()
                    return x
                return {list_key: [dict(zip(cols, [_s(x) for x in r])) for r in rows]}
            except Exception:
                continue
        return {list_key: [], "message": table_sql_map[-1].get("msg", "جدول غير موجود")}
    except Exception as e:
        return {list_key: [], "message": str(e)}
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.get("/api/hr/attendance")
def get_hr_attendance(from_date: Optional[str] = None, to_date: Optional[str] = None):
    """عرض التفقد — سجل الحضور والانصراف"""
    conn = get_connection()
    queries = [
        {"sql": "SELECT TOP 500 * FROM HR_Attendance ORDER BY AttendanceDate DESC, CheckInTime DESC", "msg": "جدول الحضور غير موجود (HR_Attendance)."},
        {"sql": "SELECT TOP 500 * FROM TBL_Attendance ORDER BY AttendanceDate DESC", "msg": "جدول الحضور غير موجود (TBL_Attendance)."},
    ]
    return _hr_table(conn, queries, "attendance")

@app.get("/api/hr/vacations")
def get_hr_vacations():
    """الاجازات — قائمة إجازات الموظفين"""
    conn = get_connection()
    queries = [
        {"sql": "SELECT TOP 500 * FROM HR_Vacations ORDER BY StartDate DESC", "msg": "جدول الإجازات غير موجود (HR_Vacations)."},
        {"sql": "SELECT TOP 500 * FROM TBL_Vacations ORDER BY StartDate DESC", "msg": "جدول الإجازات غير موجود (TBL_Vacations)."},
    ]
    return _hr_table(conn, queries, "vacations")

@app.get("/api/hr/holidays")
def get_hr_holidays():
    """العطل الرسمية"""
    conn = get_connection()
    queries = [
        {"sql": "SELECT * FROM HR_Holidays ORDER BY HolidayDate", "msg": "جدول العطل غير موجود (HR_Holidays)."},
        {"sql": "SELECT * FROM TBL_Holidays ORDER BY HolidayDate", "msg": "جدول العطل غير موجود (TBL_Holidays)."},
    ]
    return _hr_table(conn, queries, "holidays")

@app.get("/api/hr/missions")
def get_hr_missions():
    """المهام الخارجية"""
    conn = get_connection()
    queries = [
        {"sql": "SELECT TOP 500 * FROM HR_Missions ORDER BY MissionDate DESC", "msg": "جدول المهام الخارجية غير موجود (HR_Missions)."},
        {"sql": "SELECT TOP 500 * FROM TBL_Missions ORDER BY MissionDate DESC", "msg": "جدول المهام غير موجود (TBL_Missions)."},
    ]
    return _hr_table(conn, queries, "missions")

@app.get("/api/hr/attendance-options")
def get_hr_attendance_options():
    """خيارات التفقد — تحديد نوع الحضور حسب أيام الأسبوع"""
    conn = get_connection()
    queries = [
        {"sql": "SELECT * FROM HR_AttendanceOptions ORDER BY WeekDay", "msg": "جدول خيارات التفقد غير موجود (HR_AttendanceOptions)."},
        {"sql": "SELECT * FROM TBL_AttendanceTypes ORDER BY ID", "msg": "جدول أنواع التفقد غير موجود (TBL_AttendanceTypes)."},
    ]
    return _hr_table(conn, queries, "options")

@app.get("/api/hr/payroll")
def get_hr_payroll(month: Optional[str] = None, year: Optional[str] = None):
    """مسير الرواتب — قائمة/تقرير رواتب"""
    conn = get_connection()
    queries = [
        {"sql": "SELECT TOP 500 * FROM HR_Payroll ORDER BY PayrollDate DESC", "msg": "جدول مسير الرواتب غير موجود (HR_Payroll)."},
        {"sql": "SELECT TOP 500 * FROM TBL_Payroll ORDER BY PayrollDate DESC", "msg": "جدول الرواتب غير موجود (TBL_Payroll)."},
    ]
    return _hr_table(conn, queries, "payroll")

# ========== الأصول الثابتة (جدول إن وُجد — قد يكون TBL051 أو اسم مخصص) ==========
@app.get("/api/fixed-assets")
def get_fixed_assets():
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT CardGuide, AssetName, AssetCode, AcquisitionDate, OriginalValue FROM TBL051 ORDER BY AssetCode")
        except Exception:
            try:
                cursor.execute("SELECT ID, AssetName, AssetCode, AcquisitionDate, OriginalValue FROM FixedAssets ORDER BY AssetCode")
            except Exception:
                return {"fixed_assets": [], "message": "جدول الأصول الثابتة غير موجود. إنشئ جدول TBL051 أو FixedAssets في قاعدة البيانات."}
        rows = cursor.fetchall()
        cols = [d[0] for d in cursor.description]
        def _ser(x):
            if x is None: return None
            if hasattr(x, 'hex'): return str(x)
            if hasattr(x, 'isoformat'): return x.isoformat()
            return x
        return {"fixed_assets": [dict(zip(cols, [_ser(x) for x in r])) for r in rows]}
    except Exception as e:
        return {"fixed_assets": [], "message": str(e)}
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


# ========== Costing/Recipes + Stock ==========
@app.get("/api/costing/recipes")
def get_costing_recipe(product_guide: Optional[str] = None):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_costing_and_stock_schema(cursor)
        if product_guide:
            cursor.execute(
                """
                SELECT TOP 1 RecipeGuid, ProductGuide, ProductName, SalePrice, OverheadPercent, AdminShareValue, UpdatedAt
                FROM dbo.MAT3AM_RECIPE_HDR
                WHERE ProductGuide = CAST(? AS uniqueidentifier) AND IsActive = 1
                ORDER BY UpdatedAt DESC
                """,
                (product_guide,),
            )
            h = cursor.fetchone()
            if not h:
                return {"recipe": None}
            recipe_guid = str(h[0])
            cursor.execute(
                """
                SELECT Id, ComponentName, Quantity, UnitCode, UnitCost, ComponentProductGuide
                FROM dbo.MAT3AM_RECIPE_LINE
                WHERE RecipeGuid = CAST(? AS uniqueidentifier)
                ORDER BY Id
                """,
                (recipe_guid,),
            )
            lines = [
                {
                    "id": int(r[0]),
                    "componentName": r[1] or "",
                    "quantity": float(r[2] or 0),
                    "unitCode": r[3] or "EA",
                    "unitCost": float(r[4] or 0),
                    "componentProductGuide": str(r[5]).upper() if r[5] else "",
                }
                for r in cursor.fetchall()
            ]
            return {
                "recipe": {
                    "recipeGuid": recipe_guid,
                    "productGuide": str(h[1]) if h[1] else "",
                    "productName": h[2] or "",
                    "salePrice": float(h[3] or 0),
                    "overheadPercent": float(h[4] or 0),
                    "adminShareValue": float(h[5] or 0),
                    "updatedAt": str(h[6]) if h[6] else "",
                    "lines": lines,
                }
            }
        cursor.execute(
            """
            SELECT TOP 200 RecipeGuid, ProductGuide, ProductName, SalePrice, OverheadPercent, AdminShareValue, UpdatedAt
            FROM dbo.MAT3AM_RECIPE_HDR
            WHERE IsActive = 1
            ORDER BY UpdatedAt DESC
            """
        )
        rows = cursor.fetchall()
        return {
            "recipes": [
                {
                    "recipeGuid": str(r[0]),
                    "productGuide": str(r[1]) if r[1] else "",
                    "productName": r[2] or "",
                    "salePrice": float(r[3] or 0),
                    "overheadPercent": float(r[4] or 0),
                    "adminShareValue": float(r[5] or 0),
                    "updatedAt": str(r[6]) if r[6] else "",
                }
                for r in rows
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.post("/api/costing/recipes/save")
def save_costing_recipe(body: dict):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    product_guide = (body.get("productGuide") or "").strip()
    product_name = (body.get("productName") or "").strip()
    if not product_guide:
        raise HTTPException(status_code=400, detail="productGuide مطلوب")
    if not product_name:
        raise HTTPException(status_code=400, detail="productName مطلوب")
    lines = body.get("lines") or []
    if not isinstance(lines, list):
        lines = []
    try:
        cursor = conn.cursor()
        _ensure_costing_and_stock_schema(cursor)
        cursor.execute(
            """
            SELECT TOP 1 RecipeGuid FROM dbo.MAT3AM_RECIPE_HDR
            WHERE ProductGuide = CAST(? AS uniqueidentifier) AND IsActive = 1
            ORDER BY UpdatedAt DESC
            """,
            (product_guide,),
        )
        row = cursor.fetchone()
        if row and row[0]:
            recipe_guid = str(row[0])
            cursor.execute(
                """
                UPDATE dbo.MAT3AM_RECIPE_HDR
                SET ProductName=?, SalePrice=?, OverheadPercent=?, AdminShareValue=?, UpdatedAt=SYSUTCDATETIME()
                WHERE RecipeGuid = CAST(? AS uniqueidentifier)
                """,
                (
                    product_name,
                    float(body.get("salePrice") or 0),
                    float(body.get("overheadPercent") or 0),
                    float(body.get("adminShareValue") or 0),
                    recipe_guid,
                ),
            )
            cursor.execute("DELETE FROM dbo.MAT3AM_RECIPE_LINE WHERE RecipeGuid = CAST(? AS uniqueidentifier)", (recipe_guid,))
        else:
            recipe_guid = str(uuid.uuid4()).upper()
            cursor.execute(
                """
                INSERT INTO dbo.MAT3AM_RECIPE_HDR
                (RecipeGuid, ProductGuide, ProductName, SalePrice, OverheadPercent, AdminShareValue, IsActive, UpdatedAt)
                VALUES (CAST(? AS uniqueidentifier), CAST(? AS uniqueidentifier), ?, ?, ?, ?, 1, SYSUTCDATETIME())
                """,
                (
                    recipe_guid,
                    product_guide,
                    product_name,
                    float(body.get("salePrice") or 0),
                    float(body.get("overheadPercent") or 0),
                    float(body.get("adminShareValue") or 0),
                ),
            )
        for ln in lines:
            comp_pg = (ln.get("componentProductGuide") or ln.get("componentGuide") or "").strip() or None
            comp_name = (ln.get("componentName") or ln.get("name") or "").strip()
            if comp_pg:
                try:
                    cursor.execute(
                        "SELECT TOP 1 ProductName FROM TBL007 WHERE CardGuide = CAST(? AS uniqueidentifier)",
                        (comp_pg,),
                    )
                    prow = cursor.fetchone()
                    if prow and (prow[0] or "").strip():
                        comp_name = (prow[0] or "").strip()
                except Exception:
                    pass
            if not comp_name:
                continue
            qty = float(ln.get("quantity") or 0)
            if qty <= 0:
                continue
            unit_code = (ln.get("unitCode") or ln.get("unit") or "EA").strip()[:20]
            unit_cost = float(ln.get("unitCost") or 0)
            cursor.execute(
                """
                INSERT INTO dbo.MAT3AM_RECIPE_LINE
                (RecipeGuid, ComponentProductGuide, ComponentName, Quantity, UnitCode, UnitCost)
                VALUES (CAST(? AS uniqueidentifier), ?, ?, ?, ?, ?)
                """,
                (recipe_guid, comp_pg, comp_name, qty, unit_code, unit_cost),
            )
        conn.commit()
        return {"ok": True, "recipeGuid": recipe_guid}
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.get("/api/stock/movements")
def get_stock_movements(limit: int = 200):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    safe_limit = max(1, min(int(limit), 2000))
    try:
        cursor = conn.cursor()
        _ensure_costing_and_stock_schema(cursor)
        cursor.execute(
            """
            SELECT TOP (?)
            Id, MovementAt, MovementType, ReferenceId, ProductGuide, ItemName, QtyIn, QtyOut, UnitCode, UnitCost, TotalCost, Notes
            FROM dbo.MAT3AM_STOCK_MOVEMENT
            ORDER BY MovementAt DESC, Id DESC
            """,
            (safe_limit,),
        )
        rows = cursor.fetchall()
        return {
            "movements": [
                {
                    "id": int(r[0]),
                    "movementAt": str(r[1]) if r[1] else "",
                    "movementType": r[2] or "",
                    "referenceId": r[3] or "",
                    "productGuide": str(r[4]) if r[4] else "",
                    "itemName": r[5] or "",
                    "qtyIn": float(r[6] or 0),
                    "qtyOut": float(r[7] or 0),
                    "unitCode": r[8] or "",
                    "unitCost": float(r[9] or 0),
                    "totalCost": float(r[10] or 0),
                    "notes": r[11] or "",
                }
                for r in rows
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.get("/api/stock/balance")
def get_stock_balance():
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_costing_and_stock_schema(cursor)
        cursor.execute(
            """
            SELECT
                ISNULL(CAST(ProductGuide AS NVARCHAR(36)), N'') AS ProductGuideText,
                ItemName,
                ISNULL(UnitCode, N'') AS UnitCode,
                SUM(ISNULL(QtyIn,0)) AS QtyIn,
                SUM(ISNULL(QtyOut,0)) AS QtyOut,
                SUM(ISNULL(QtyIn,0) - ISNULL(QtyOut,0)) AS QtyBalance,
                SUM(ISNULL(TotalCost,0)) AS CostValue
            FROM dbo.MAT3AM_STOCK_MOVEMENT
            GROUP BY ProductGuide, ItemName, UnitCode
            HAVING SUM(ISNULL(QtyIn,0)) <> 0 OR SUM(ISNULL(QtyOut,0)) <> 0
            ORDER BY ItemName
            """
        )
        rows = cursor.fetchall()
        return {
            "balances": [
                {
                    "productGuide": r[0] or "",
                    "itemName": r[1] or "",
                    "unitCode": r[2] or "",
                    "qtyIn": float(r[3] or 0),
                    "qtyOut": float(r[4] or 0),
                    "qtyBalance": float(r[5] or 0),
                    "costValue": float(r[6] or 0),
                }
                for r in rows
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.get("/api/pos/policy")
def get_pos_policy():
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_costing_and_stock_schema(cursor)
        cursor.execute(
            """
            SELECT TOP 1 ServicePercent, VatPercent, ApplyDiscountBeforeTax, ServiceBeforeVat
            FROM dbo.MAT3AM_POS_POLICY
            WHERE IsActive = 1
            ORDER BY UpdatedAt DESC, Id DESC
            """
        )
        r = cursor.fetchone()
        if not r:
            return {"servicePercent": 12.5, "vatPercent": 14.0, "applyDiscountBeforeTax": True, "serviceBeforeVat": True}
        return {
            "servicePercent": float(r[0] or 0),
            "vatPercent": float(r[1] or 0),
            "applyDiscountBeforeTax": bool(r[2]),
            "serviceBeforeVat": bool(r[3]),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.put("/api/pos/policy")
def save_pos_policy(body: dict):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_costing_and_stock_schema(cursor)
        service_percent = float(body.get("servicePercent") or 12)
        vat_percent = float(body.get("vatPercent") or 14)
        apply_discount_before_tax = 1 if bool(body.get("applyDiscountBeforeTax", True)) else 0
        service_before_vat = 1 if bool(body.get("serviceBeforeVat", True)) else 0
        cursor.execute(
            """
            INSERT INTO dbo.MAT3AM_POS_POLICY
            (IsActive, ServicePercent, VatPercent, ApplyDiscountBeforeTax, ServiceBeforeVat)
            VALUES (1, ?, ?, ?, ?)
            """,
            (service_percent, vat_percent, apply_discount_before_tax, service_before_vat),
        )
        conn.commit()
        return {"ok": True}
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.get("/api/pos/promotions")
def list_pos_promotions(active_only: bool = True):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_costing_and_stock_schema(cursor)
        if active_only:
            cursor.execute(
                """
                SELECT Id, PromoName, PromoType, PriorityNo, IsActive, IsStackable, StartAt, EndAt, ScopeType, PayloadJson, Notes
                FROM dbo.MAT3AM_PROMOTION
                WHERE IsActive = 1 AND (StartAt IS NULL OR StartAt <= SYSUTCDATETIME()) AND (EndAt IS NULL OR EndAt >= SYSUTCDATETIME())
                ORDER BY PriorityNo ASC, UpdatedAt DESC
                """
            )
        else:
            cursor.execute(
                """
                SELECT TOP 300 Id, PromoName, PromoType, PriorityNo, IsActive, IsStackable, StartAt, EndAt, ScopeType, PayloadJson, Notes
                FROM dbo.MAT3AM_PROMOTION
                ORDER BY UpdatedAt DESC
                """
            )
        rows = cursor.fetchall()
        out = []
        for r in rows:
            payload = None
            try:
                payload = json.loads(r[9]) if r[9] else None
            except Exception:
                payload = None
            out.append(
                {
                    "id": str(r[0]),
                    "name": r[1] or "",
                    "type": r[2] or "",
                    "priority": int(r[3] or 100),
                    "isActive": bool(r[4]),
                    "isStackable": bool(r[5]),
                    "startAt": str(r[6]) if r[6] else None,
                    "endAt": str(r[7]) if r[7] else None,
                    "scopeType": r[8] or "",
                    "payload": payload,
                    "notes": r[10] or "",
                }
            )
        return {"promotions": out}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.post("/api/pos/promotions")
def create_pos_promotion(body: dict):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_costing_and_stock_schema(cursor)
        name = (body.get("name") or "").strip()
        ptype = (body.get("type") or "").strip()
        if not name or not ptype:
            raise HTTPException(status_code=400, detail="name و type مطلوبان")
        pid = str(uuid.uuid4()).upper()
        payload_json = body.get("payload")
        if payload_json is not None and not isinstance(payload_json, str):
            payload_json = json.dumps(payload_json, ensure_ascii=False)
        cursor.execute(
            """
            INSERT INTO dbo.MAT3AM_PROMOTION
            (Id, PromoName, PromoType, PriorityNo, IsActive, IsStackable, StartAt, EndAt, ScopeType, PayloadJson, Notes, UpdatedAt)
            VALUES (CAST(? AS uniqueidentifier), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, SYSUTCDATETIME())
            """,
            (
                pid,
                name,
                ptype,
                int(body.get("priority") or 100),
                1 if bool(body.get("isActive", True)) else 0,
                1 if bool(body.get("isStackable", True)) else 0,
                body.get("startAt"),
                body.get("endAt"),
                (body.get("scopeType") or "").strip() or None,
                payload_json,
                (body.get("notes") or "").strip() or None,
            ),
        )
        conn.commit()
        return {"ok": True, "id": pid}
    except HTTPException:
        raise
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ========== Restaurant POS — ربط مشروع المطعم بقاعدة البيانات ==========
_restaurant_dir = os.path.join(_root, "config", "restaurant")
def _restaurant_path(name: str) -> str:
    os.makedirs(_restaurant_dir, exist_ok=True)
    return os.path.join(_restaurant_dir, name + ".json")


def _bootstrap_mat3am_runtime() -> None:
    """تهيئة مجلدات وملفات التشغيل عند إقلاع الخادم — دون الاعتماد على فحص يدوي من المشغّل."""
    try:
        import shutil

        os.makedirs(_restaurant_dir, exist_ok=True)
        fp = _restaurant_path("floor_plan")
        if not os.path.exists(fp):
            template = os.path.join(str(BASE_DIR), "config", "restaurant", "floor_plan.json")
            if os.path.isfile(template):
                shutil.copy2(template, fp)
                print("[mat3am] bootstrap: تم نسخ floor_plan.json الافتراضي")
            else:
                minimal = {
                    "id": "main-floor",
                    "name": "Main Hall",
                    "width": 1000,
                    "height": 700,
                    "shell": {"type": "polygon", "points": [[0, 0], [800, 0], [800, 600], [0, 600]]},
                    "tables": [],
                }
                with open(fp, "w", encoding="utf-8") as f:
                    json.dump(minimal, f, ensure_ascii=False, indent=2)
                print("[mat3am] bootstrap: تم إنشاء floor_plan.json أولي")
    except Exception as e:
        print("[mat3am] bootstrap warning:", e)


@app.on_event("startup")
def _mat3am_startup_bootstrap():
    _bootstrap_mat3am_runtime()


def _restaurant_load(name: str, default: list):
    p = _restaurant_path(name)
    if not os.path.exists(p):
        return default
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def _restaurant_save(name: str, data: list):
    p = _restaurant_path(name)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _restaurant_venue_path() -> str:
    os.makedirs(_restaurant_dir, exist_ok=True)
    return os.path.join(_restaurant_dir, "venue.json")


def _restaurant_read_venue() -> dict:
    """نوع المنشأ: restaurant | coffee_shop — يغيّر افتراضيات الواجهة دون تفرع مشروع."""
    p = _restaurant_venue_path()
    if not os.path.exists(p):
        return {"venueType": "restaurant"}
    try:
        with open(p, "r", encoding="utf-8") as f:
            d = json.load(f)
        if not isinstance(d, dict):
            return {"venueType": "restaurant"}
        vt = str(d.get("venueType") or "restaurant").strip().lower().replace("-", "_")
        aliases_coffee = ("coffee_shop", "coffeeshop", "coffee", "cafe", "café")
        if vt in aliases_coffee:
            vt = "coffee_shop"
        elif vt != "restaurant":
            vt = "restaurant"
        return {"venueType": vt}
    except Exception:
        return {"venueType": "restaurant"}


def _restaurant_write_venue(body: dict) -> dict:
    vt = str((body or {}).get("venueType") or "restaurant").strip().lower().replace("-", "_")
    if vt in ("coffee_shop", "coffeeshop", "coffee", "cafe", "café"):
        vt = "coffee_shop"
    else:
        vt = "restaurant"
    out = {"venueType": vt}
    with open(_restaurant_venue_path(), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    return out


@app.get("/api/restaurant/venue")
def restaurant_get_venue():
    return _restaurant_read_venue()


@app.put("/api/restaurant/venue")
def restaurant_put_venue(body: dict):
    return _restaurant_write_venue(body if isinstance(body, dict) else {})


@app.get("/api/restaurant/floor-plan")
def restaurant_floor_plan_get():
    """مخطط الصالة v1 (مضلع + طاولات) — config/restaurant/floor_plan.json"""
    p = _restaurant_path("floor_plan")
    if not os.path.exists(p):
        return {"plan": None}
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return {"plan": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"plan": None}


def _floor_plan_single_floor_valid(flo: dict) -> bool:
    if not isinstance(flo, dict) or not isinstance(flo.get("shell"), dict):
        return False
    sh = flo["shell"]
    if sh.get("type") != "polygon":
        return False
    pts = sh.get("points")
    if not isinstance(pts, list) or len(pts) < 3:
        return False
    for p in pts:
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            return False
        if not all(isinstance(c, (int, float)) for c in p):
            return False
    if not isinstance(flo.get("tables"), list):
        return False
    for k in ("id", "name", "width", "height"):
        if k not in flo:
            return False
    return True


@app.put("/api/restaurant/floor-plan")
def restaurant_floor_plan_put(body: dict):
    """استبدال كامل لـ floor_plan.json — الجسم إما المخطط مباشرة أو { \"plan\": { ... } }.
    يدعم schemaVersion: 2 مع مصفوفة floors (عدة طوابق)."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="يتوقع كائن JSON")
    plan = body.get("plan") if isinstance(body.get("plan"), dict) else body
    if not isinstance(plan, dict):
        raise HTTPException(status_code=400, detail="مخطط غير صالح")

    if plan.get("schemaVersion") == 2:
        fls = plan.get("floors")
        if not isinstance(fls, list) or len(fls) == 0:
            raise HTTPException(status_code=400, detail="schemaVersion 2 يلزم floors غير فارغة")
        for i, fl in enumerate(fls):
            if not isinstance(fl, dict) or not _floor_plan_single_floor_valid(fl):
                raise HTTPException(status_code=400, detail=f"طابق غير صالح في index={i}")
        p = _restaurant_path("floor_plan")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(plan, f, ensure_ascii=False, indent=2)
        return {"ok": True}

    if not _floor_plan_single_floor_valid(plan):
        raise HTTPException(status_code=400, detail="مخطط غير صالح: يلزم shell (مضلع ≥3 نقاط) و tables و id و name و width و height")
    p = _restaurant_path("floor_plan")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=2)
    return {"ok": True}


def _restaurant_kds_settings_default():
    return {"prepTargetMinutes": 20.0, "warnBeforeEndMinutes": 5.0}


def _restaurant_read_kds_settings() -> dict:
    d = _restaurant_kds_settings_default()
    try:
        p = _restaurant_path("kds_settings")
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                if raw.get("prepTargetMinutes") is not None:
                    d["prepTargetMinutes"] = float(raw.get("prepTargetMinutes") or d["prepTargetMinutes"])
                if raw.get("warnBeforeEndMinutes") is not None:
                    d["warnBeforeEndMinutes"] = float(raw.get("warnBeforeEndMinutes") or d["warnBeforeEndMinutes"])
    except Exception:
        pass
    return d


def _restaurant_write_kds_settings(body: dict) -> dict:
    cur = _restaurant_read_kds_settings()
    if isinstance(body, dict):
        if body.get("prepTargetMinutes") is not None:
            cur["prepTargetMinutes"] = max(1.0, min(240.0, float(body.get("prepTargetMinutes"))))
        if body.get("warnBeforeEndMinutes") is not None:
            cur["warnBeforeEndMinutes"] = max(0.5, min(30.0, float(body.get("warnBeforeEndMinutes"))))
    p = _restaurant_path("kds_settings")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(cur, f, ensure_ascii=False, indent=2)
    return cur


@app.get("/api/restaurant/kds-settings")
def restaurant_kds_settings_get():
    """زمن التحضير الافتراضي (دقيقة) ونافذة التنبيه قبل النهاية (دقيقة) — لوحة المطبخ."""
    return _restaurant_read_kds_settings()


@app.put("/api/restaurant/kds-settings")
def restaurant_kds_settings_put(body: dict):
    return _restaurant_write_kds_settings(body if isinstance(body, dict) else {})


def _restaurant_default_tables():
    """طاولات افتراضية حتى تظهر القائمة حتى بدون قاعدة أو ملف"""
    return [
        {"id": "t1", "number": 1, "name": "طاولة 1", "seats": 4, "status": "available", "position": {"x": 100, "y": 100}, "features": {"canAddChildSeat": True, "nearBalcony": False, "nearBathroom": False, "smokingArea": False, "vipSection": False}},
        {"id": "t2", "number": 2, "name": "طاولة 2", "seats": 2, "status": "available", "position": {"x": 300, "y": 100}, "features": {"canAddChildSeat": True, "nearBalcony": False, "nearBathroom": False, "smokingArea": False, "vipSection": False}},
        {"id": "t3", "number": 3, "name": "طاولة 3", "seats": 6, "status": "available", "position": {"x": 100, "y": 300}, "features": {"canAddChildSeat": True, "nearBalcony": False, "nearBathroom": False, "smokingArea": False, "vipSection": False}},
        {"id": "t4", "number": 4, "name": "طاولة 4", "seats": 4, "status": "available", "position": {"x": 300, "y": 300}, "features": {"canAddChildSeat": True, "nearBalcony": False, "nearBathroom": False, "smokingArea": False, "vipSection": False}},
        {"id": "t5", "number": 5, "name": "طاولة 5", "seats": 8, "status": "available", "position": {"x": 500, "y": 200}, "features": {"canAddChildSeat": True, "nearBalcony": False, "nearBathroom": False, "smokingArea": False, "vipSection": False}},
    ]

@app.get("/api/restaurant/tables")
def restaurant_get_tables():
    """جلب الطاولات — من ملف أو مراكز التكلفة أو افتراضي"""
    data = _restaurant_load("tables", [])
    if data:
        return {"tables": data}
    conn = get_connection()
    if conn:
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT CardGuide, CostCenter FROM TBL005 WHERE CostCenter IS NOT NULL ORDER BY CostCenter")
            rows = cursor.fetchall()
            tables = []
            for i, row in enumerate(rows, 1):
                tables.append({
                    "id": str(row[0]),
                    "number": i,
                    "name": row[1] or ("طاولة " + str(i)),
                    "seats": 4,
                    "status": "available",
                    "position": {"x": 50 + (i % 5) * 120, "y": 50 + (i // 5) * 100},
                    "features": {"canAddChildSeat": True, "nearBalcony": False, "nearBathroom": False, "smokingArea": False, "vipSection": False},
                })
            conn.close()
            if tables:
                return {"tables": tables}
        except Exception:
            pass
    return {"tables": _restaurant_default_tables()}

@app.post("/api/restaurant/tables")
def restaurant_save_table(body: dict):
    """حفظ/إنشاء طاولة"""
    data = _restaurant_load("tables", [])
    tid = body.get("id") or str(uuid.uuid4())
    rec = {
        "id": tid,
        "number": body.get("number", len(data) + 1),
        "name": body.get("name", "طاولة " + str(len(data) + 1)),
        "seats": body.get("seats", 4),
        "status": body.get("status", "available"),
        "position": body.get("position", {"x": 0, "y": 0}),
        "features": body.get("features", {"canAddChildSeat": True, "nearBalcony": False, "nearBathroom": False, "smokingArea": False, "vipSection": False}),
    }
    existing = [i for i, t in enumerate(data) if t.get("id") == tid]
    if existing:
        data[existing[0]] = rec
    else:
        data.append(rec)
    _restaurant_save("tables", data)
    return rec

@app.delete("/api/restaurant/tables/{table_id}")
def restaurant_delete_table(table_id: str):
    """حذف طاولة من ملف التهيئة (مزامنة مع واجهة التخطيط)"""
    data = _restaurant_load("tables", [])
    new_data = [t for t in data if str(t.get("id")) != str(table_id)]
    if len(new_data) == len(data):
        raise HTTPException(status_code=404, detail="الطاولة غير موجودة في الملف المحلي")
    _restaurant_save("tables", new_data)
    return {"ok": True, "id": table_id}

@app.patch("/api/restaurant/tables/{table_id}/status")
def restaurant_update_table_status(table_id: str, body: dict):
    """تحديث حالة طاولة"""
    status = (body.get("status") or "").strip() or "available"
    data = _restaurant_load("tables", [])
    for t in data:
        if t.get("id") == table_id:
            t["status"] = status
            _restaurant_save("tables", data)
            return t
    conn = get_connection()
    if conn:
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT CardGuide, CostCenter FROM TBL005 WHERE CardGuide = CAST(? AS uniqueidentifier)", (table_id,))
            row = cursor.fetchone()
            conn.close()
            if row:
                return {"id": table_id, "status": status, "name": row[1]}
        except Exception:
            pass
    return {"id": table_id, "status": status}

@app.get("/api/restaurant/table-sessions")
def restaurant_get_sessions(status: Optional[str] = None):
    """جلسات الطاولات"""
    data = _restaurant_load("table_sessions", [])
    if status:
        data = [s for s in data if s.get("status") == status]
    return {"sessions": data}

@app.post("/api/restaurant/table-sessions")
def restaurant_create_session(body: dict):
    """إنشاء جلسة طاولة (إسكان)"""
    data = _restaurant_load("table_sessions", [])
    sid = str(uuid.uuid4())
    rec = {
        "id": sid,
        "tableId": body.get("tableId"),
        "projectId": body.get("projectId"),
        "hostId": body.get("hostId"),
        "guestCount": body.get("guestCount", 1),
        "childrenCount": body.get("childrenCount", 0),
        "preferences": body.get("preferences", {}),
        "startTime": datetime.now().isoformat(),
        "status": "active",
    }
    data.append(rec)
    _restaurant_save("table_sessions", data)
    return rec

@app.patch("/api/restaurant/table-sessions/{session_id}/complete")
def restaurant_complete_session(session_id: str):
    data = _restaurant_load("table_sessions", [])
    for s in data:
        if s.get("id") == session_id:
            s["endTime"] = datetime.now().isoformat()
            s["status"] = "completed"
            _restaurant_save("table_sessions", data)
            return s
    raise HTTPException(status_code=404, detail="الجلسة غير موجودة")

@app.get("/api/restaurant/orders")
def restaurant_get_orders(session_id: Optional[str] = None, status: Optional[str] = None):
    """الطلبات — session_id أو status (pending, preparing, ready, served, paid)"""
    data = _restaurant_load("orders", [])
    if session_id:
        data = [o for o in data if o.get("sessionId") == session_id]
    if status:
        data = [o for o in data if o.get("status") == status]
    return {"orders": data}

@app.post("/api/restaurant/orders")
def restaurant_create_order(body: dict):
    """إنشاء طلب"""
    data = _restaurant_load("orders", [])
    oid = str(uuid.uuid4())
    ptm = body.get("prepTargetMinutes")
    try:
        ptm_f = float(ptm) if ptm is not None and str(ptm).strip() != "" else None
    except (TypeError, ValueError):
        ptm_f = None
    if ptm_f is not None and (ptm_f < 1 or ptm_f > 240):
        ptm_f = None
    rec = {
        "id": oid,
        "sessionId": body.get("sessionId"),
        "tableId": body.get("tableId"),
        "waiterId": body.get("waiterId"),
        "items": body.get("items", []),
        "status": "pending",
        "createdAt": datetime.now().isoformat(),
        "prepTargetMinutes": ptm_f,
    }
    data.append(rec)
    _restaurant_save("orders", data)
    return rec

@app.patch("/api/restaurant/orders/{order_id}/status")
def restaurant_update_order_status(order_id: str, body: dict):
    status = (body.get("status") or "").strip()
    data = _restaurant_load("orders", [])
    for o in data:
        if o.get("id") == order_id:
            o["status"] = status
            if status == "preparing":
                o["prepStartTime"] = datetime.now().isoformat()
            elif status == "ready":
                o["prepEndTime"] = datetime.now().isoformat()
            _restaurant_save("orders", data)
            return o
    raise HTTPException(status_code=404, detail="الطلب غير موجود")

@app.get("/api/restaurant/kitchen-notifications")
def restaurant_get_kitchen_notifications(status: Optional[str] = None):
    data = _restaurant_load("kitchen_notifications", [])
    if status:
        data = [n for n in data if n.get("status") == status]
    return {"notifications": data}

@app.post("/api/restaurant/kitchen-notifications")
def restaurant_create_kitchen_notification(body: dict):
    data = _restaurant_load("kitchen_notifications", [])
    nid = str(uuid.uuid4())
    rec = {
        "id": nid,
        "orderId": body.get("orderId"),
        "tableNumber": body.get("tableNumber", 0),
        "items": body.get("items", []),
        "status": "new",
        "estimatedTime": body.get("estimatedTime", 15),
        "createdAt": datetime.now().isoformat(),
    }
    data.append(rec)
    _restaurant_save("kitchen_notifications", data)
    return rec

@app.patch("/api/restaurant/kitchen-notifications/{notification_id}")
def restaurant_update_kitchen_notification(notification_id: str, body: dict):
    data = _restaurant_load("kitchen_notifications", [])
    for n in data:
        if n.get("id") == notification_id:
            n["status"] = body.get("status", n["status"])
            if "actualTime" in body:
                n["actualTime"] = body["actualTime"]
            _restaurant_save("kitchen_notifications", data)
            return n
    raise HTTPException(status_code=404, detail="الإشعار غير موجود")

@app.post("/api/restaurant/invoices")
def restaurant_create_invoice(body: dict):
    """إنشاء فاتورة المطعم — تحويل لـ POST /api/invoices (XTRA)"""
    session_id = body.get("sessionId")
    orders = body.get("orders", [])
    subtotal = float(body.get("subtotal", 0))
    tax = float(body.get("tax", 0))
    service_charge = float(body.get("serviceCharge", 0))
    discount_value = float(body.get("discountValue", 0))
    total = float(body.get("total", 0))
    payment_method = body.get("paymentMethod") or "cash"
    order_type = (body.get("orderType") or "table").strip().lower()  # table|takeaway|delivery
    delivery = body.get("delivery") or {}
    agent_guide = body.get("agentGuide")
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        if not agent_guide and order_type == "delivery":
            d_phone = str(delivery.get("phone") or "").strip()
            d_mobile = str(delivery.get("mobile") or "").strip()
            d_name = str(delivery.get("name") or "").strip()
            d_address = str(delivery.get("address") or "").strip()
            if d_phone or d_mobile:
                # محاولة استدعاء العميل أولاً
                cursor.execute(
                    """
                    SELECT TOP 1 CardGuide
                    FROM TBL016
                    WHERE (Phone = ? OR Mobile = ?)
                    ORDER BY ID DESC
                    """,
                    (d_phone or d_mobile, d_phone or d_mobile),
                )
                row_agent = cursor.fetchone()
                if row_agent and row_agent[0]:
                    agent_guide = str(row_agent[0])
                else:
                    new_agent = str(uuid.uuid4()).upper()
                    agent_name = d_name or f"عميل دليفري {d_phone or d_mobile}"
                    cursor.execute(
                        """
                        INSERT INTO TBL016 (CardGuide, AgentName, Phone, Mobile, FullAdress, NotActive)
                        VALUES (?, ?, ?, ?, ?, 0)
                        """,
                        (
                            new_agent,
                            agent_name,
                            d_phone or None,
                            d_mobile or None,
                            d_address or None,
                        ),
                    )
                    conn.commit()
                    agent_guide = new_agent

        if not agent_guide:
            cursor.execute("SELECT TOP 1 CardGuide FROM TBL016")
            r = cursor.fetchone()
            agent_guide = str(r[0]) if r and r[0] else None
        if not agent_guide:
            raise HTTPException(status_code=400, detail="لا يوجد عميل افتراضي. أضف عميلاً في النظام أو أرسل agentGuide.")
        cursor.execute("SELECT ISNULL(MAX(BillNumber), 0) + 1 FROM TBL022 WHERE MainGuide = (SELECT TOP 1 CardGuide FROM TBL020)")
        r = cursor.fetchone()
        bill_num = int(r[0]) if r else 1
        today = datetime.now()
        bill_date = today.strftime("%d-%m-%Y")
        pay_ar = {"cash": "نقدي", "card": "بطاقات مصرفيه", "digital": "نقدي"}
        items_body = list(body.get("items", []))
        if not items_body and orders:
            order_list = orders if (isinstance(orders, list) and orders and isinstance(orders[0], dict)) else []
            if not order_list and isinstance(orders, list):
                all_orders = _restaurant_load("orders", [])
                for oid in orders:
                    o = next((x for x in all_orders if x.get("id") == oid), None)
                    if o:
                        order_list.append(o)
            for o in order_list:
                for it in o.get("items", []):
                    qty = float(it.get("quantity", 1))
                    price = float(it.get("unitPrice", 0))
                    items_body.append({
                        "ProductGuide": it.get("menuItemId") or it.get("productGuide") or "",
                        "ProductName": it.get("name", ""),
                        "Quantity": qty,
                        "Unit": "وحدة",
                        "UnitPrice": price,
                        "TotalValue": qty * price,
                    })
        normalized_items = []
        for raw in items_body:
            line = _normalize_pos_invoice_line(raw)
            if line:
                normalized_items.append(line)
        items_body = normalized_items
        if not items_body:
            raise HTTPException(status_code=400, detail="لا توجد بنود للفاتورة")
        delivery_note = ""
        if order_type == "delivery":
            delivery_note = (
                f" | دليفري: هاتف={delivery.get('phone') or delivery.get('mobile') or ''}"
                f" | عنوان={delivery.get('address') or ''}"
                f" | وقت التسليم={delivery.get('deliveryTime') or ''}"
                f" | دفع={delivery.get('payment') or payment_method}"
            )
        elif order_type == "takeaway":
            delivery_note = " | سفري"

        inv = {
            "BillNumber": bill_num,
            "BillDate": bill_date,
            "DoneIn": bill_date,
            "AgentGuide": agent_guide,
            "Notes": ("مطعم - جلسة " + (session_id or "")) + delivery_note,
            "PaymentMethod": pay_ar.get(payment_method, "نقدي"),
            "Discount": discount_value,
            "Items": items_body,
            "TaxValue": tax,
            "LocalAdministrativeTax": service_charge,
        }
        invoice_header = InvoiceHeader(**inv)
        result = save_invoice(invoice_header)
        inv_list = _restaurant_load("invoices", [])
        inv_list.append({"sessionId": session_id, "invoiceId": result.get("MainGuide"), "total": total, "paidAt": datetime.now().isoformat()})
        _restaurant_save("invoices", inv_list)
        return {"id": result.get("MainGuide"), "sessionId": session_id, "subtotal": subtotal, "tax": tax, "total": total, "paidAt": datetime.now().isoformat()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

# ========== سندات الصرف/القبض — POST /api/cashflow/transaction ==========
class CashflowLine(BaseModel):
    itemId: Optional[str] = None
    amount: float
    note: Optional[str] = None
    accountGl: Optional[str] = None  # CardGuide أو CardCode من TBL004

class CashflowHeader(BaseModel):
    date: str  # YYYY-MM-DD
    memo: Optional[str] = None
    branchId: Optional[str] = None
    costCenterId: Optional[str] = None
    projectId: Optional[str] = None

class CashflowTransaction(BaseModel):
    type: str  # DISB | RECP | JRNL
    channel: Optional[str] = None
    channelAccountId: Optional[str] = None
    channelAccountGl: Optional[str] = None  # حساب الصندوق/البنك (CardGuide أو CardCode)
    header: CashflowHeader
    lines: List[CashflowLine]

def _resolve_account_guide(cursor, gl: str):
    """تحويل accountGl (CardGuide أو CardCode) إلى CardGuide من TBL004"""
    if not gl or not str(gl).strip():
        return None
    gl = str(gl).strip()
    if len(gl) == 36 and gl.count("-") == 4:
        cursor.execute("SELECT CardGuide FROM TBL004 WHERE CardGuide = CAST(? AS uniqueidentifier)", (gl,))
    else:
        cursor.execute("SELECT CardGuide FROM TBL004 WHERE CardCode = ?", (gl,))
    row = cursor.fetchone()
    return str(row[0]) if row else None

@app.post("/api/cashflow/transaction")
def post_cashflow_transaction(body: dict):
    """تسجيل سند صرف أو قبض في TBL010 + TBL038"""
    conn = None
    try:
        conn = get_connection()
        if not conn:
            raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
        cursor = conn.cursor()

        tx = body.get("transaction") or body
        t = (tx.get("type") or "").strip().upper()
        if t not in ("DISB", "RECP"):
            return {"success": False, "message": "النوع يجب أن يكون DISB (صرف) أو RECP (قبض)"}
        header = tx.get("header") or {}
        lines = tx.get("lines") or []
        if not lines:
            return {"success": False, "message": "أضف بنداً واحداً على الأقل"}
        bond_date_str = (header.get("date") or "").strip()
        if not bond_date_str:
            return {"success": False, "message": "تاريخ السند مطلوب"}
        try:
            bond_date = datetime.strptime(bond_date_str[:10], "%Y-%m-%d")
        except Exception:
            return {"success": False, "message": "صيغة التاريخ غير صحيحة (YYYY-MM-DD)"}

        # نوع السند من TBL009: صرف أو قبض
        entry_name = "صرف" if t == "DISB" else "قبض"
        cursor.execute(
            "SELECT CardGuide FROM TBL009 WHERE EntryName = ?",
            (entry_name,)
        )
        main_row = cursor.fetchone()
        if not main_row:
            return {"success": False, "message": f"نوع القيد '{entry_name}' غير موجود في TBL009"}
        main_guide = str(main_row[0])

        # رقم السند التالي لهذا النوع
        cursor.execute(
            "SELECT ISNULL(MAX(BondNumber), 0) + 1 FROM TBL010 WHERE MainGuide = CAST(? AS uniqueidentifier)",
            (main_guide,)
        )
        bond_number = cursor.fetchone()[0]

        # حساب القناة (صندوق/بنك)
        channel_gl = (tx.get("channelAccountGl") or "").strip() or None
        if not channel_gl:
            return {"success": False, "message": "حساب القناة (channelAccountGl) مطلوب — اختر من إعدادات الربط وأرسل GL"}
        account_guide_channel = _resolve_account_guide(cursor, channel_gl)
        if not account_guide_channel:
            return {"success": False, "message": f"حساب القناة غير موجود في TBL004: {channel_gl}"}

        # عملة افتراضية من TBL001
        cursor.execute("SELECT TOP 1 CardGuide FROM TBL001")
        cur_row = cursor.fetchone()
        currency_guide = str(cur_row[0]) if cur_row else None
        if not currency_guide:
            return {"success": False, "message": "لا توجد عملة في TBL001"}

        bond_guide = str(uuid.uuid4())
        notes = (header.get("memo") or "")[:255] if header.get("memo") else ""
        rate = 1.0

        # إدراج رأس السند TBL010
        cursor.execute("""
            INSERT INTO TBL010 (CardGuide, MainGuide, BondNumber, Rate, BondDate, CurrencyGuide, AccountGuide, AgentGuide, AccountGuide2, Notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
        """, (bond_guide, main_guide, bond_number, rate, bond_date, currency_guide, account_guide_channel, notes))
        conn.commit()

        # بنود TBL038: لكل بند مدين (حساب المستفيد) ودائن (حساب القناة)
        total_amount = 0.0
        for ln in lines:
            amt = float(ln.get("amount") or 0)
            if amt <= 0:
                continue
            line_gl = (ln.get("accountGl") or "").strip() or None
            if not line_gl:
                return {"success": False, "message": "كل بند يحتاج accountGl (حساب من دليل الحسابات)"}
            account_guide_line = _resolve_account_guide(cursor, line_gl)
            if not account_guide_line:
                return {"success": False, "message": f"حساب البند غير موجود في TBL004: {line_gl}"}
            note_ln = (ln.get("note") or "")[:255] if ln.get("note") else ""

            # صرف DISB: مدين حساب المستفيد، دائن الصندوق
            # قبض RECP: مدين الصندوق، دائن حساب العميل
            if t == "DISB":
                cursor.execute("""
                    INSERT INTO TBL038 (MainGuide, AccountGuide, CurrencyGuide, ContraAccount, CostCenter, Project, Branch, Notes, Debit, Credit, DebitRate, CreditRate)
                    VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 0, ?, 0)
                """, (bond_guide, account_guide_line, currency_guide, account_guide_channel, note_ln, amt, amt * rate))
                cursor.execute("""
                    INSERT INTO TBL038 (MainGuide, AccountGuide, CurrencyGuide, ContraAccount, CostCenter, Project, Branch, Notes, Debit, Credit, DebitRate, CreditRate)
                    VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, 0, ?, 0, ?)
                """, (bond_guide, account_guide_channel, currency_guide, account_guide_line, "", amt, amt * rate))
            else:
                cursor.execute("""
                    INSERT INTO TBL038 (MainGuide, AccountGuide, CurrencyGuide, ContraAccount, CostCenter, Project, Branch, Notes, Debit, Credit, DebitRate, CreditRate)
                    VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 0, ?, 0)
                """, (bond_guide, account_guide_channel, currency_guide, account_guide_line, "", amt, amt * rate))
                cursor.execute("""
                    INSERT INTO TBL038 (MainGuide, AccountGuide, CurrencyGuide, ContraAccount, CostCenter, Project, Branch, Notes, Debit, Credit, DebitRate, CreditRate)
                    VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, 0, ?, 0, ?)
                """, (bond_guide, account_guide_line, currency_guide, account_guide_channel, note_ln, amt, amt * rate))
            total_amount += amt
            conn.commit()

        return {"success": True, "id": bond_number, "card_guide": bond_guide, "message": f"تم تسجيل السند رقم {bond_number}"}
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        return {"success": False, "message": str(e)}
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


# ========== أدوات المطور: تهيئة ونظام لوج ==========
# مستخدمون افتراضيون — جزء من حزمة التهيئة (POST /api/dev/bootstrap) وأول اتصال بـ MAT3AM_APP_USERS الفارغ.
# يُفضّل إبقاء نفس القائمة متطابقة مع backend/init_concreet_db.py (إدراج عند تهيئة القاعدة التجريبية).
MAT3AM_BOOTSTRAP_DEFAULT_USERS = [
    ("cashier", "1001", "cashier", "كاشير 1"),
    ("accountant", "2001", "accountant", "محاسب 1"),
    ("manager", "3001", "manager", "مدير 1"),
    ("developer", "9001", "developer", "مطوّر"),
    ("host", "123", "host", "جارسون الاستقبال"),
    ("waiter", "123", "waiter", "جارسون الطلبات"),
    ("kitchen", "123", "kitchen", "المطبخ"),
    ("server", "123", "server", "جارسون المناولة"),
]


def _seed_mat3am_default_users_if_empty(cursor) -> int:
    """إن كان جدول المستخدمين فارغاً يُدرَج المستخدمون الافتراضيون. يعيد عدد الصفوف المُدرَجة بنجاح."""
    try:
        cursor.execute("SELECT COUNT(*) FROM dbo.MAT3AM_APP_USERS")
        n = int((cursor.fetchone() or [1])[0] or 0)
        if n > 0:
            return 0
    except Exception:
        return 0
    inserted = 0
    for login_name, pin, role_code, display_name in MAT3AM_BOOTSTRAP_DEFAULT_USERS:
        new_id = str(uuid.uuid4()).upper()
        try:
            cursor.execute(
                """
                INSERT INTO dbo.MAT3AM_APP_USERS
                (Id, LoginName, PinHash, RoleCode, DisplayName, IsActive, CreatedAt)
                VALUES (CAST(? AS uniqueidentifier), ?, ?, ?, ?, 1, SYSUTCDATETIME())
                """,
                (new_id, login_name, pin, role_code, display_name),
            )
            inserted += 1
        except Exception:
            pass
    return inserted


def _ensure_mat3am_dev_schema(cursor) -> int:
    """إنشاء جداول التطبيق المساندة إن لم تكن موجودة. يعيد عدد مستخدمي التطبيق المُدرَجين (إن وُجدت تعبئة).

    ملاحظة: جدول MAT3AM_APP_USERS يُنفَّذ ويُثبَّت بـ COMMIT منفصل أولاً حتى لا يُفقَد بفشل لاحق
    في جداول التكلفة/المخزون ضمن نفس المعاملة.
    """
    ddl_users_only = """
        IF OBJECT_ID(N'dbo.MAT3AM_APP_USERS', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_APP_USERS (
                Id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
                LoginName NVARCHAR(100) NOT NULL,
                PinHash NVARCHAR(256) NULL,
                RoleCode NVARCHAR(20) NOT NULL,
                DisplayName NVARCHAR(200) NULL,
                IsActive BIT NOT NULL DEFAULT 1,
                CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
        END
        """
    cursor.execute(ddl_users_only)
    try:
        cursor.connection.commit()
    except Exception:
        pass

    ddl = [
        """
        IF OBJECT_ID(N'dbo.MAT3AM_ERROR_LOG', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_ERROR_LOG (
                Id BIGINT IDENTITY(1,1) PRIMARY KEY,
                ErrorAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                LevelCode NVARCHAR(20) NOT NULL DEFAULT N'ERROR',
                SourceName NVARCHAR(100) NULL,
                RoleCode NVARCHAR(20) NULL,
                UserName NVARCHAR(200) NULL,
                RoutePath NVARCHAR(500) NULL,
                Message NVARCHAR(MAX) NULL,
                StackTrace NVARCHAR(MAX) NULL,
                PayloadJson NVARCHAR(MAX) NULL,
                ClientTime NVARCHAR(64) NULL
            );
            CREATE INDEX IX_MAT3AM_ERROR_LOG_ErrorAt ON dbo.MAT3AM_ERROR_LOG(ErrorAt DESC);
        END
        """,
        """
        IF OBJECT_ID(N'dbo.MAT3AM_AUDIT_LOG', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_AUDIT_LOG (
                Id BIGINT IDENTITY(1,1) PRIMARY KEY,
                ActionCode NVARCHAR(80) NOT NULL,
                EntityName NVARCHAR(80) NOT NULL,
                EntityId NVARCHAR(100) NULL,
                ActorName NVARCHAR(200) NULL,
                Details NVARCHAR(1000) NULL,
                LoggedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
            CREATE INDEX IX_MAT3AM_AUDIT_LOG_LoggedAt ON dbo.MAT3AM_AUDIT_LOG(LoggedAt DESC);
        END
        """,
        """
        IF OBJECT_ID(N'dbo.MAT3AM_RECIPE_HDR', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_RECIPE_HDR (
                RecipeGuid UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
                ProductGuide UNIQUEIDENTIFIER NULL,
                ProductName NVARCHAR(255) NOT NULL,
                SalePrice FLOAT NOT NULL DEFAULT 0,
                OverheadPercent FLOAT NOT NULL DEFAULT 0,
                AdminShareValue FLOAT NOT NULL DEFAULT 0,
                IsActive BIT NOT NULL DEFAULT 1,
                UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
        END
        """,
        """
        IF OBJECT_ID(N'dbo.MAT3AM_RECIPE_LINE', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_RECIPE_LINE (
                Id BIGINT IDENTITY(1,1) PRIMARY KEY,
                RecipeGuid UNIQUEIDENTIFIER NOT NULL,
                ComponentProductGuide UNIQUEIDENTIFIER NULL,
                ComponentName NVARCHAR(255) NOT NULL,
                Quantity FLOAT NOT NULL DEFAULT 0,
                UnitCode NVARCHAR(20) NOT NULL DEFAULT N'EA',
                UnitCost FLOAT NOT NULL DEFAULT 0
            );
            CREATE INDEX IX_MAT3AM_RECIPE_LINE_RecipeGuid ON dbo.MAT3AM_RECIPE_LINE(RecipeGuid);
        END
        """,
    ]
    for sql in ddl:
        cursor.execute(sql)
    try:
        cursor.connection.commit()
    except Exception:
        pass

    try:
        _ensure_costing_and_stock_schema(cursor)
        cursor.connection.commit()
    except Exception as e:
        try:
            cursor.connection.rollback()
        except Exception:
            pass
        print(f"[MAT3AM] تحذير: تعذر إكمال جداول التكلفة/المخزون (يتم الاستمرار لجدول المستخدمين): {e}")

    users_inserted = _seed_mat3am_default_users_if_empty(cursor)
    try:
        cursor.connection.commit()
    except Exception:
        pass
    return users_inserted


@app.post("/api/dev/bootstrap")
def developer_bootstrap():
    """تهيئة جداول دعم التطبيق + مستخدمو التطبيق الافتراضيون إن كان الجدول فارغاً (حزمة التهيئة)."""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        default_users_inserted = _ensure_mat3am_dev_schema(cursor)
        conn.commit()
        default_users_spec = [
            {"login": a, "pin": b, "role": c, "displayName": d}
            for a, b, c, d in MAT3AM_BOOTSTRAP_DEFAULT_USERS
        ]
        return {
            "ok": True,
            "message": "تمت تهيئة جداول الدعم بنجاح",
            "tables": [
                "MAT3AM_APP_USERS",
                "MAT3AM_ERROR_LOG",
                "MAT3AM_AUDIT_LOG",
                "MAT3AM_RECIPE_HDR",
                "MAT3AM_RECIPE_LINE",
                "MAT3AM_STOCK_MOVEMENT",
                "MAT3AM_POS_POLICY",
                "MAT3AM_PROMOTION",
            ],
            "defaultAppUsersInserted": default_users_inserted,
            "defaultAppUsersSpec": default_users_spec,
            "defaultAppUsersNote": "يُدرَج هؤلاء فقط عندما يكون جدول MAT3AM_APP_USERS فارغاً تماماً.",
        }
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"فشل التهيئة: {str(e)}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.post("/api/dev/error-logs")
def create_dev_error_log(body: dict):
    """تسجيل خطأ Frontend/Backend مع تنظيف تلقائي لسجلات أقدم من 30 يوماً."""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    keep_days = int(body.get("keep_days") or 30)
    if keep_days < 1:
        keep_days = 1
    if keep_days > 365:
        keep_days = 365
    try:
        cursor = conn.cursor()
        _ensure_mat3am_dev_schema(cursor)
        cursor.execute(
            "DELETE FROM dbo.MAT3AM_ERROR_LOG WHERE ErrorAt < DATEADD(day, ?, SYSUTCDATETIME())",
            (-keep_days,),
        )
        payload_json = body.get("payload")
        if payload_json is not None and not isinstance(payload_json, str):
            payload_json = json.dumps(payload_json, ensure_ascii=False)
        cursor.execute(
            """
            INSERT INTO dbo.MAT3AM_ERROR_LOG
            (LevelCode, SourceName, RoleCode, UserName, RoutePath, Message, StackTrace, PayloadJson, ClientTime)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(body.get("level") or "ERROR")[:20],
                str(body.get("source") or "frontend")[:100],
                str(body.get("role") or "")[:20] or None,
                str(body.get("user") or "")[:200] or None,
                str(body.get("route") or "")[:500] or None,
                str(body.get("message") or "")[:4000] or "",
                str(body.get("stack") or "")[:4000] or None,
                payload_json,
                str(body.get("client_time") or "")[:64] or None,
            ),
        )
        conn.commit()
        return {"ok": True}
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"تعذر حفظ اللوج: {str(e)}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.get("/api/dev/error-logs")
def list_dev_error_logs(limit: int = 200):
    """استعراض آخر أخطاء التطبيق من جدول MAT3AM_ERROR_LOG."""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    safe_limit = max(1, min(limit, 2000))
    try:
        cursor = conn.cursor()
        _ensure_mat3am_dev_schema(cursor)
        cursor.execute(
            """
            SELECT TOP (?) Id, ErrorAt, LevelCode, SourceName, RoleCode, UserName, RoutePath, Message
            FROM dbo.MAT3AM_ERROR_LOG
            ORDER BY ErrorAt DESC
            """,
            (safe_limit,),
        )
        rows = cursor.fetchall()
        logs = []
        for r in rows:
            logs.append(
                {
                    "id": int(r[0]),
                    "error_at": str(r[1]) if r[1] else "",
                    "level": r[2] or "",
                    "source": r[3] or "",
                    "role": r[4] or "",
                    "user": r[5] or "",
                    "route": r[6] or "",
                    "message": r[7] or "",
                }
            )
        return {"logs": logs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"تعذر قراءة اللوج: {str(e)}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    print(f"تشغيل خادم إكسترا ويب على http://127.0.0.1:{XTRA_API_PORT} (غيّر المنفذ: set XTRA_API_PORT=...)")
    uvicorn.run(app, host="0.0.0.0", port=XTRA_API_PORT)
