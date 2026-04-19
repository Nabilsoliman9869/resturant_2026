"""
Backend API Server for POS System
FastAPI Backend - متصل بقاعدة البيانات SQL Server
"""
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response
from pydantic import BaseModel, model_validator
from typing import List, Optional, Tuple
import pyodbc
from datetime import datetime
import uuid
import subprocess
import json
import os
import re
import sys
import tempfile
import unicodedata
from pathlib import Path
from config import get_connection_string, get_connection_string_driver13, DATABASE

try:
    XTRA_API_PORT = int(os.environ.get("XTRA_API_PORT", "2288"))
except ValueError:
    XTRA_API_PORT = 2288

# دخول تهيئة / مطوّر: لا يعتمد على MAT3AM_APP_USERS ولا يُعطّل أبداً بعد التهيئة (dev / dev@123 أو MAT3AM_INITIAL_DEV_*).
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


@app.get("/__whoami", include_in_schema=False)
def whoami_typo_redirect():
    """كثيراً ما يُنسى الشرطتان الأخيرتان — نفس محتوى التحقق عبر إعادة توجيه."""
    return RedirectResponse(url="/__whoami__", status_code=307)


@app.get("/__whoami__", include_in_schema=False)
def whoami():
    """اختبار: هل الخادم الذي يعمل هو هذا الملف؟ (سطر MAT3AM يظهر فقط في نسخة مطاعم الحالية)"""
    try:
        _mt = int(os.path.getmtime(__file__))
    except Exception:
        _mt = 0
    body = (
        "api_server.py: WHOAMI OK\n"
        "MAT3AM_API=1 DEV_LOGIN_ALWAYS=1\n"
        f"API_FILE_MTIME_UNIX={_mt}\n"
    )
    return PlainTextResponse(body)


# مسارات التشغيل:
# - Dev: يعتمد على جذر المشروع
# - PyInstaller onefile: يعتمد على sys._MEIPASS (ملفات مدمجة داخل EXE)
_env_base = (os.environ.get("MAT3AM_BASE_DIR") or "").strip()
if _env_base:
    BASE_DIR = Path(_env_base).resolve()
elif getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    BASE_DIR = Path(getattr(sys, "_MEIPASS")).resolve()
else:
    BASE_DIR = Path(__file__).resolve().parents[1]
_root = str(BASE_DIR)
REST_DIR = BASE_DIR / "ui" / "restaurant"

# إعدادات الاتصال من ملف (إن وُجد) — يُحمّل من config/settings.json
_settings_path = str(BASE_DIR / "config" / "settings.json")


def _load_mat3am_settings() -> dict:
    """قسم اختياري mat3am داخل config/settings.json (عملة افتراضية، مطابقة أسماء، إلخ)."""
    if not os.path.exists(_settings_path):
        return {}
    try:
        with open(_settings_path, "r", encoding="utf-8") as f:
            d = json.load(f)
        m = d.get("mat3am")
        return m if isinstance(m, dict) else {}
    except Exception:
        return {}


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
        # دعم ملفات build التي تشير إلى /assets/... مباشرة (لتفادي الشاشة البيضاء)
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="restaurant-root-assets")

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

# —— Product images local storage under config/restaurant/product_images ——
_product_images_dir_path = str(BASE_DIR / "config" / "restaurant" / "product_images")
_product_images_manifest_path = str(BASE_DIR / "config" / "restaurant" / "product_images.json")
_group_images_dir_path = str(BASE_DIR / "config" / "restaurant" / "group_images")
_group_images_manifest_path = str(BASE_DIR / "config" / "restaurant" / "group_images.json")
def _product_images_dir() -> str:
    os.makedirs(_product_images_dir_path, exist_ok=True)
    return _product_images_dir_path


def _product_images_manifest_load() -> dict:
    try:
        if os.path.isfile(_product_images_manifest_path):
            with open(_product_images_manifest_path, "r", encoding="utf-8") as f:
                d = json.load(f)
            if isinstance(d, dict):
                imgs = d.get("images")
                if isinstance(imgs, dict):
                    return {"images": imgs}
    except Exception:
        pass
    return {"images": {}}


def _product_images_manifest_save(d: dict) -> None:
    os.makedirs(os.path.dirname(_product_images_manifest_path), exist_ok=True)
    with open(_product_images_manifest_path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)


def _product_images_manifest_set(card_guide: str, image_url: str) -> None:
    m = _product_images_manifest_load()
    imgs = m.get("images")
    if not isinstance(imgs, dict):
        imgs = {}
        m["images"] = imgs
    gid = str(card_guide).upper()
    imgs[gid] = {
        "image": image_url,
        "updatedAt": datetime.now().isoformat(),
    }
    _product_images_manifest_save(m)


def _product_images_manifest_get(card_guide: str) -> Optional[str]:
    m = _product_images_manifest_load()
    imgs = m.get("images")
    if not isinstance(imgs, dict):
        return None
    rec = imgs.get(str(card_guide).upper())
    if isinstance(rec, dict):
        v = rec.get("image")
        if v:
            return str(v)
    return None


def _group_images_dir() -> str:
    os.makedirs(_group_images_dir_path, exist_ok=True)
    return _group_images_dir_path


def _group_images_manifest_load() -> dict:
    try:
        if os.path.isfile(_group_images_manifest_path):
            with open(_group_images_manifest_path, "r", encoding="utf-8") as f:
                d = json.load(f)
            if isinstance(d, dict):
                imgs = d.get("images")
                if isinstance(imgs, dict):
                    return {"images": imgs}
    except Exception:
        pass
    return {"images": {}}


def _group_images_manifest_save(d: dict) -> None:
    os.makedirs(os.path.dirname(_group_images_manifest_path), exist_ok=True)
    with open(_group_images_manifest_path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)


def _group_images_manifest_set(card_guide: str, image_url: str) -> None:
    m = _group_images_manifest_load()
    imgs = m.get("images")
    if not isinstance(imgs, dict):
        imgs = {}
        m["images"] = imgs
    gid = str(card_guide).upper()
    imgs[gid] = {
        "image": image_url,
        "updatedAt": datetime.now().isoformat(),
    }
    _group_images_manifest_save(m)


def _group_images_manifest_get(card_guide: str) -> Optional[str]:
    m = _group_images_manifest_load()
    imgs = m.get("images")
    if not isinstance(imgs, dict):
        return None
    rec = imgs.get(str(card_guide).upper())
    if isinstance(rec, dict):
        v = rec.get("image")
        if v:
            return str(v)
    return None


def _ensure_menu_tables(cursor) -> None:
    cursor.execute(
        """
        IF OBJECT_ID('dbo.TBL006','U') IS NULL
        BEGIN
            CREATE TABLE dbo.TBL006(
                CardGuide uniqueidentifier NOT NULL PRIMARY KEY,
                GroupName nvarchar(255) NULL,
                LatinName nvarchar(255) NULL,
                CardImage varbinary(max) NULL,
                GroupImageUrl nvarchar(500) NULL
            );
        END
        """
    )
    cursor.execute(
        """
        IF OBJECT_ID('dbo.TBL007','U') IS NULL
        BEGIN
            CREATE TABLE dbo.TBL007(
                CardGuide uniqueidentifier NOT NULL PRIMARY KEY,
                ProductName nvarchar(255) NULL,
                LatinName nvarchar(255) NULL,
                GroupGuid uniqueidentifier NULL,
                AgentPrice decimal(18,2) NULL,
                NotActive bit NOT NULL DEFAULT(0),
                CardImage varbinary(max) NULL,
                ProductImageUrl nvarchar(500) NULL
            );
        END
        """
    )
    cursor.execute(
        """
        IF COL_LENGTH('dbo.TBL006','CardImage') IS NULL
            ALTER TABLE dbo.TBL006 ADD CardImage varbinary(max) NULL;
        IF COL_LENGTH('dbo.TBL006','GroupImageUrl') IS NULL
            ALTER TABLE dbo.TBL006 ADD GroupImageUrl nvarchar(500) NULL;
        IF COL_LENGTH('dbo.TBL007','CardImage') IS NULL
            ALTER TABLE dbo.TBL007 ADD CardImage varbinary(max) NULL;
        IF COL_LENGTH('dbo.TBL007','ProductImageUrl') IS NULL
            ALTER TABLE dbo.TBL007 ADD ProductImageUrl nvarchar(500) NULL;
        """
    )


def _enrich_invoice_lines_from_menu(cursor, lines: list) -> list:
    cache = {}
    out = []
    for ln in lines:
        if not isinstance(ln, dict):
            continue
        pg = str(ln.get("ProductGuide") or "").strip()
        rec = None
        if pg:
            rec = cache.get(pg)
            if rec is None:
                try:
                    cursor.execute(
                        "SELECT TOP 1 ProductName, AgentPrice FROM TBL007 WHERE CardGuide = CAST(? AS uniqueidentifier)",
                        (pg,),
                    )
                    r = cursor.fetchone()
                    rec = {
                        "name": str(r[0]) if r and r[0] else "",
                        "price": float(r[1]) if r and r[1] is not None else None,
                    }
                except Exception:
                    rec = {"name": "", "price": None}
                cache[pg] = rec
        x = dict(ln)
        menu_name = (rec or {}).get("name") or ""
        menu_price = (rec or {}).get("price")
        if not str(x.get("ProductName") or "").strip() and menu_name:
            x["ProductName"] = menu_name
        if (float(x.get("UnitPrice") or 0) <= 0) and (menu_price is not None):
            qty = float(x.get("Quantity") or 0)
            x["UnitPrice"] = float(menu_price)
            x["TotalValue"] = float(menu_price) * qty
        out.append(x)
    return out

def _guess_image_ext(data: bytes) -> tuple[str, str]:
    if data.startswith(b"\xFF\xD8\xFF"):
        return ("jpg", "image/jpeg")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ("png", "image/png")
    if data.startswith(b"GIF8"):
        return ("gif", "image/gif")
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ("webp", "image/webp")
    return ("bin", "application/octet-stream")

def _find_product_image_file(card_guide: str) -> tuple[str | None, str | None]:
    d = _product_images_dir()
    gid = str(card_guide).upper()
    for ext, ctype in (("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("png", "image/png"), ("gif", "image/gif"), ("webp", "image/webp")):
        p = os.path.join(d, f"{gid}.{ext}")
        if os.path.isfile(p):
            return (p, ctype)
    return (None, None)


def _find_group_image_file(card_guide: str) -> tuple[str | None, str | None]:
    d = _group_images_dir()
    gid = str(card_guide).upper()
    for ext, ctype in (("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("png", "image/png"), ("gif", "image/gif"), ("webp", "image/webp")):
        p = os.path.join(d, f"{gid}.{ext}")
        if os.path.isfile(p):
            return (p, ctype)
    return (None, None)


def _auto_group_svg(group_name: str) -> bytes:
    nm = str(group_name or "Group").strip()[:42] or "Group"
    en = "Group"
    low = nm.lower()
    if "soup" in low or "شور" in low:
        en = "Soup"
    elif "pizza" in low or "بيتزا" in low:
        en = "Pizza"
    elif "pasta" in low or "باستا" in low:
        en = "Pasta"
    elif "chicken" in low or "دجاج" in low:
        en = "Chicken"
    elif "dessert" in low or "حلو" in low or "حلويات" in low:
        en = "Dessert"
    elif "drink" in low or "مشروبات" in low or "قهوة" in low:
        en = "Drinks"
    elif "grill" in low or "مشويات" in low:
        en = "Grills"
    elif "sand" in low or "ساند" in low:
        en = "Sandwiches"
    elif "appet" in low or "مقبل" in low:
        en = "Appetizers"
    elif "salad" in low or "سلط" in low:
        en = "Salads"
    svg = f"""<svg xmlns='http://www.w3.org/2000/svg' width='520' height='220' viewBox='0 0 520 220'>
<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#d9f99d'/><stop offset='100%' stop-color='#86efac'/></linearGradient></defs>
<rect x='3' y='3' rx='26' ry='26' width='514' height='214' fill='url(#g)' stroke='#16a34a' stroke-width='6'/>
<rect x='20' y='34' rx='18' ry='18' width='150' height='150' fill='#fff' stroke='#22c55e' stroke-width='4'/>
<text x='95' y='124' text-anchor='middle' font-family='Segoe UI, Tahoma' font-size='62' font-weight='800' fill='#166534'>{en[:1]}</text>
<text x='188' y='90' text-anchor='start' font-family='Segoe UI, Tahoma' font-size='42' font-weight='900' fill='#052e16'>{nm}</text>
<text x='188' y='138' text-anchor='start' font-family='Segoe UI, Tahoma' font-size='34' font-weight='700' fill='#14532d'>{en}</text>
</svg>"""
    return svg.encode("utf-8")

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
    """حفظ إعدادات الاتصال في config/settings.json (يُحفَظ قسم mat3am وغيره إن وُجد دون مسحه)."""
    try:
        os.makedirs(os.path.dirname(_settings_path), exist_ok=True)
        port_val = _normalize_sql_port(body.get("port"))
        merged: dict = {}
        if os.path.exists(_settings_path):
            try:
                with open(_settings_path, "r", encoding="utf-8") as f:
                    merged = json.load(f)
                if not isinstance(merged, dict):
                    merged = {}
            except Exception:
                merged = {}
        merged["server"] = body.get("server", "")
        merged["port"] = port_val
        merged["database"] = body.get("database", "")
        merged["uid"] = body.get("uid", "")
        merged["password"] = body.get("password", "")
        with open(_settings_path, "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=2, ensure_ascii=False)
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


# ========== TBL007 — بطاقة المادة (إكسترا) ديناميكي حسب أعمدة الجدول ==========
_TBL007_COLUMNS_CACHE = None


def _reset_tbl007_columns_cache():
    global _TBL007_COLUMNS_CACHE
    _TBL007_COLUMNS_CACHE = None


def _fetch_tbl007_columns(cursor) -> set:
    """أسماء أعمدة TBL007 من قاعدة البيانات (تخزين مؤقت لكل عملية الخادم)."""
    global _TBL007_COLUMNS_CACHE
    if _TBL007_COLUMNS_CACHE is not None:
        return _TBL007_COLUMNS_CACHE
    try:
        cursor.execute(
            """
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'TBL007'
            ORDER BY ORDINAL_POSITION
            """
        )
        _TBL007_COLUMNS_CACHE = {r[0] for r in cursor.fetchall()}
    except Exception:
        _TBL007_COLUMNS_CACHE = set()
    return _TBL007_COLUMNS_CACHE


def _tbl007_pick_column(cols: set, *candidates: str):
    for c in candidates:
        if c in cols:
            return c
    return None


def _serialize_cell(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat() if hasattr(v, "isoformat") else str(v)
    if isinstance(v, bytes):
        return None
    if isinstance(v, (int, float, bool)):
        return v
    return v


def _row_to_dict(cursor, row) -> dict:
    if row is None:
        return {}
    names = [d[0] for d in cursor.description]
    return {names[i]: _serialize_cell(row[i]) for i in range(len(names))}


def _parse_guid_val(s):
    if s is None:
        return None
    if isinstance(s, str) and not s.strip():
        return None
    s = str(s).strip()
    try:
        uuid.UUID(s)
        return s
    except Exception:
        return None


def _apply_xtra_product_body_to_columns(body: dict, cols: set) -> dict:
    """يحوّل مفاتيح واجهة إكسترا / أسماء أعمدة إلى قيم للـ UPDATE/INSERT."""
    updates = {}

    def put(col, val):
        if col and col in cols:
            updates[col] = val

    name = (body.get("ProductName") or body.get("TxItemName") or "").strip()
    if name or "ProductName" in body or "TxItemName" in body:
        put("ProductName", name or None)

    lat = (body.get("LatinName") or body.get("TxLatinName") or "").strip() or None
    if body.get("LatinName") is not None or body.get("TxLatinName") is not None or lat:
        put("LatinName", lat)

    code = (body.get("CardCode") or body.get("TxCode") or "").strip() or None
    if body.get("CardCode") is not None or body.get("TxCode") is not None or code:
        put("CardCode", code)

    stmt_col = _tbl007_pick_column(cols, "StatementName", "BillStatementName", "Statement")
    if stmt_col and (
        body.get("StatementName") is not None or body.get("TxStatementName") is not None
    ):
        v = (body.get("StatementName") or body.get("TxStatementName") or "").strip() or None
        put(stmt_col, v)

    if "GroupGuid" in body or "group_guid" in body:
        g = body.get("GroupGuid") or body.get("group_guid")
        put("GroupGuid", _parse_guid_val(g) if g else None)

    if "DefaultCurrency" in body or "default_currency" in body:
        g = body.get("DefaultCurrency") or body.get("default_currency")
        put("DefaultCurrency", _parse_guid_val(g) if g else None)

    acol = _tbl007_pick_column(
        cols, "AccountGuide", "SalesAccount", "PurchaseAccount", "DefaultAccount", "ProductAccount"
    )
    if acol and (body.get("AccountGuide") is not None or body.get("account_guide") is not None):
        g = body.get("AccountGuide") or body.get("account_guide")
        put(acol, _parse_guid_val(g) if g else None)

    for json_k, num_k, candidates in [
        ("EndUserPrice", "end_user_price", ("EndUserPrice",)),
        ("AgentPrice", "agent_price", ("AgentPrice",)),
    ]:
        v = body.get(json_k) if json_k in body else body.get(num_k)
        if v is not None and str(v).strip() != "":
            col = _tbl007_pick_column(cols, *candidates)
            if col:
                try:
                    put(col, float(v))
                except (TypeError, ValueError):
                    pass

    prep = body.get("PrepMinutes")
    if prep is None:
        prep = body.get("NmbPrepMinutes")
    if prep is None:
        prep = body.get("Hieght3")
    if prep is not None and str(prep).strip() != "":
        c = _tbl007_pick_column(cols, "Hieght3")
        if c:
            try:
                put(c, float(prep))
            except (TypeError, ValueError):
                pass

    it = body.get("ItemType") or body.get("item_type") or body.get("CmbItemType")
    if it is not None:
        s = str(it)
        is_service = "خدمية" in s or "service" in s.lower()
        c_int = _tbl007_pick_column(cols, "ItemType", "ProductType", "Kind", "ItemKind")
        if c_int:
            try:
                put(c_int, 1 if is_service else 0)
            except Exception:
                pass
        c_bit = _tbl007_pick_column(cols, "IsService", "ServiceItem", "NotInventory")
        if c_bit:
            put(c_bit, 1 if is_service else 0)
        c_inv = _tbl007_pick_column(cols, "StorageItem", "InventoryItem", "IsStockItem")
        if c_inv:
            put(c_inv, 0 if is_service else 1)

    tax = body.get("TaxRatio") or body.get("NmbTax") or body.get("tax_ratio")
    if tax is not None and str(tax).strip() != "":
        tcol = _tbl007_pick_column(cols, "TaxRatio", "TaxPercent", "Tax", "VatRatio", "TaxValue")
        if tcol:
            try:
                put(tcol, float(tax))
            except (TypeError, ValueError):
                pass

    mn = body.get("MinLimit") or body.get("enterNumberData15")
    mx = body.get("MaxLimit") or body.get("enterNumberData16")
    if mn is not None and str(mn).strip() != "":
        c = _tbl007_pick_column(
            cols, "MinimumQuantity", "MinLimit", "MinStock", "ReorderLevel", "MinQuantity"
        )
        if c:
            try:
                put(c, float(mn))
            except (TypeError, ValueError):
                pass
    if mx is not None and str(mx).strip() != "":
        c = _tbl007_pick_column(cols, "MaximumQuantity", "MaxLimit", "MaxStock", "MaxQuantity")
        if c:
            try:
                put(c, float(mx))
            except (TypeError, ValueError):
                pass

    ra = body.get("RelatedAgent") or body.get("related_agent")
    if ra is not None:
        c = _tbl007_pick_column(cols, "RelatedAgent", "DefaultAgent", "CustomerGuide", "LinkedAgent")
        if c:
            put(c, _parse_guid_val(ra) if ra else None)

    ex = body.get("DefaultExpiryDate") or body.get("EDDefaultExpiryDate")
    if ex is not None and str(ex).strip() != "":
        c = _tbl007_pick_column(cols, "DefaultExpiryDate", "ExpiryDate", "DefaultExp")
        if c:
            put(c, str(ex).strip())

    if body.get("Specifications") is not None or body.get("enterTextData4") is not None:
        v = (body.get("Specifications") or body.get("enterTextData4") or "").strip() or None
        c = _tbl007_pick_column(cols, "Specifications", "ProductSpecs", "Description", "TechSpecs")
        put(c, v)

    if body.get("SourceText") is not None or body.get("enterTextData5") is not None:
        v = (body.get("SourceText") or body.get("enterTextData5") or "").strip() or None
        c = _tbl007_pick_column(cols, "SourceText", "ProductSource", "SourceName", "Origin")
        put(c, v)

    text_map = [
        (9, ("CustomText1", "Text01", "EnterTextData9", "UserField9")),
        (10, ("CustomText2", "Text02", "EnterTextData10", "UserField10")),
        (11, ("CustomText3", "Text03", "EnterTextData11", "UserField11")),
        (12, ("CustomText4", "Text04", "EnterTextData12", "UserField12")),
        (13, ("CustomText5", "Text05", "EnterTextData13", "UserField13")),
    ]
    for num, candidates in text_map:
        k = f"enterTextData{num}"
        if k in body or f"custom_text_{num}" in body:
            raw = body.get(k) if k in body else body.get(f"custom_text_{num}")
            v = (str(raw).strip() if raw is not None else None) or None
            col = _tbl007_pick_column(cols, *candidates)
            put(col, v)

    for i in range(1, 6):
        gk = f"category{i}_guid"
        if gk not in body and f"Category{i:02d}" not in body:
            continue
        g = body.get(gk) or body.get(f"Category{i:02d}")
        col = _tbl007_pick_column(
            cols,
            f"Category{i:02d}",
            f"Category0{i}",
            f"ItemCardCategory{i}",
            f"Classification{i}",
            f"ClassGuide{i}",
        )
        put(col, _parse_guid_val(g) if g else None)

    return updates


def _product_card_displays(cursor, cols: set, values: dict) -> dict:
    """نصوص عرض لمربعات البحث (مجموعة، عملة، حساب، عميل، تصنيفات)."""
    disp = {}

    def fmt_acc(g):
        if not g:
            return ""
        cursor.execute(
            """
            SELECT TOP 1 CardCode, AccountName FROM TBL004
            WHERE CardGuide = CAST(? AS uniqueidentifier)
            """,
            (g,),
        )
        r = cursor.fetchone()
        if not r:
            return str(g)
        c, n = r[0], r[1]
        return f"{c or ''}-{n or ''}".strip("-") or str(g)

    def fmt_cur(g):
        if not g:
            return ""
        cursor.execute(
            "SELECT TOP 1 CurrencyName, LatinName FROM TBL001 WHERE CardGuide = CAST(? AS uniqueidentifier)",
            (g,),
        )
        r = cursor.fetchone()
        if not r:
            return str(g)
        return (r[0] or r[1] or str(g)) if r else str(g)

    def fmt_agent(g):
        if not g:
            return ""
        cursor.execute(
            "SELECT TOP 1 AgentName, CardNumber FROM TBL016 WHERE CardGuide = CAST(? AS uniqueidentifier)",
            (g,),
        )
        r = cursor.fetchone()
        if not r:
            return str(g)
        return f"{r[1] or ''}-{r[0] or ''}".strip("-") or str(g)

    gg = values.get("GroupGuid")
    if gg:
        cursor.execute(
            "SELECT TOP 1 CardCode, GroupName FROM TBL006 WHERE CardGuide = CAST(? AS uniqueidentifier)",
            (gg,),
        )
        r = cursor.fetchone()
        disp["SrhGroup"] = f"{r[0] or ''}-{r[1] or ''}".strip("-") if r else str(gg)
    else:
        disp["SrhGroup"] = ""

    dg = values.get("DefaultCurrency")
    disp["SrhDefaultCurrency"] = fmt_cur(dg) if dg else ""

    ag = None
    for c in ("AccountGuide", "SalesAccount", "PurchaseAccount", "DefaultAccount", "ProductAccount"):
        if c in values and values.get(c):
            ag = values.get(c)
            break
    disp["TxAcc"] = fmt_acc(ag) if ag else ""

    rag = values.get("RelatedAgent") or values.get("DefaultAgent") or values.get("CustomerGuide")
    disp["xtrSearchData8"] = fmt_agent(rag) if rag else ""

    for i in range(1, 6):
        col = _tbl007_pick_column(
            cols,
            f"Category{i:02d}",
            f"Category0{i}",
            f"ItemCardCategory{i}",
            f"Classification{i}",
            f"ClassGuide{i}",
        )
        if col and values.get(col):
            disp[f"SrhItemCardCategory{i}"] = fmt_acc(values[col])
        else:
            disp[f"SrhItemCardCategory{i}"] = ""

    return disp


def _product_card_guides(cols: set, values: dict) -> dict:
    """معرفات GUID للحقول المرتبطة (للواجهة — حقول مخفية)."""
    out = {
        "GroupGuid": values.get("GroupGuid"),
        "DefaultCurrency": values.get("DefaultCurrency"),
    }
    ac = _tbl007_pick_column(
        cols, "AccountGuide", "SalesAccount", "PurchaseAccount", "DefaultAccount", "ProductAccount"
    )
    out["AccountGuide"] = values.get(ac) if ac else None
    rc = _tbl007_pick_column(cols, "RelatedAgent", "DefaultAgent", "CustomerGuide", "LinkedAgent")
    out["RelatedAgent"] = values.get(rc) if rc else None
    cats = {}
    for i in range(1, 6):
        cc = _tbl007_pick_column(
            cols,
            f"Category{i:02d}",
            f"Category0{i}",
            f"ItemCardCategory{i}",
            f"Classification{i}",
            f"ClassGuide{i}",
        )
        cats[str(i)] = values.get(cc) if cc else None
    out["categories"] = cats
    return out


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
        return {
            "ok": True,
            "user": {
                "id": MAT3AM_INITIAL_DEV_USER_ID,
                "name": "مطوّر / تهيئة",
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
            # self-heal: insert default operational users if login matches defaults
            defaults = {
                str(login).strip().lower(): (str(pin0), str(role0), str(name0))
                for login, pin0, role0, name0 in MAT3AM_BOOTSTRAP_DEFAULT_USERS
            }
            d = defaults.get(login_name.lower())
            if d and pin == d[0]:
                try:
                    cursor.execute(
                        """
                        INSERT INTO dbo.MAT3AM_APP_USERS
                        (Id, LoginName, PinHash, RoleCode, DisplayName, IsActive, CreatedAt)
                        VALUES (CAST(? AS uniqueidentifier), ?, ?, ?, ?, 1, SYSUTCDATETIME())
                        """,
                        (str(uuid.uuid4()).upper(), login_name.lower(), d[0], d[1], d[2]),
                    )
                    conn.commit()
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
                except Exception:
                    row = None
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


def _mat3am_tbl023_unit_as_tinyint(unit_raw: object) -> int:
    """TBL023.Unit = tinyint في SQL Server؛ أي نص (مثل «وحدة» أو وسم عرض) يُحوَّل إلى رقم آمن."""
    if unit_raw is None:
        return 1
    s0 = str(unit_raw).strip()
    if not s0:
        return 1
    s = unicodedata.normalize("NFKC", s0)
    for zw in ("\ufeff", "\u200c", "\u200d", "\u2060", "\xa0"):
        s = s.replace(zw, "")
    s = s.strip()
    if not s:
        return 1
    try:
        v = int(float(s.replace(",", ".")))
        if 0 <= v <= 255:
            return v
    except (TypeError, ValueError, ArithmeticError):
        pass
    sl = s.casefold()
    # كلمات شائعة للوحدة (عربي/إنجليزي) — لا تُمرَّر كنص إلى SQL
    unit_aliases = (
        "وحدة",
        "وحدات",
        "قطعة",
        "قطع",
        "صنف",
        "عدد",
        "كيلو",
        "كجم",
        "متر",
        "لتر",
        "ea",
        "pcs",
        "pc",
        "pk",
        "each",
        "unit",
        "kg",
    )
    if sl in ("u", "m", "l"):
        return 1
    for a in unit_aliases:
        if a in sl or a in s:
            return 1
    if re.search(r"[\u0600-\u06FF]", s):
        return 1
    if re.fullmatch(r"[A-Za-z]{1,8}", s):
        return 1
    return 1


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
    unit_raw = it.get("Unit") if it.get("Unit") is not None else it.get("unit")
    unit_ti = _mat3am_tbl023_unit_as_tinyint(unit_raw if unit_raw is not None else "1")
    return {
        "ProductGuide": str(pg),
        "ProductName": str(pname),
        "Quantity": qty,
        "Unit": str(unit_ti),
        "UnitPrice": unit_price,
        "TotalValue": total_value,
    }


class InvoiceItem(BaseModel):
    ProductGuide: str
    ProductName: str
    Quantity: float
    Unit: str
    UnitPrice: float
    TotalValue: float

    @model_validator(mode="before")
    @classmethod
    def _coerce_pos_line(cls, data: object):
        """قبول بنود الواجهة (productGuide، quantity، …) عند بناء الفاتورة."""
        if isinstance(data, dict):
            line = _normalize_pos_invoice_line(data)
            if line is not None:
                return line
        return data

    @model_validator(mode="after")
    def _unit_row_tinyint_only(self) -> "InvoiceItem":
        u = _mat3am_tbl023_unit_as_tinyint(self.Unit)
        return self.model_copy(update={"Unit": str(u)})


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
    # اختياري: تجاوز المخزن/العملة (وإلا يُحسب من نمط الفاتورة وإعدادات mat3am في settings.json)
    StoreGuide: Optional[str] = None
    CurrencyGuide: Optional[str] = None


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


# احتياطي إن لم تُشغَّل تهيئة أنواع المطعم بعد
FALLBACK_INVOICE_TYPE_GUID = "3478A885-6D69-4058-892E-8A57496DB9BC"

# ستة أنماط مطعم — الاسم العربي في TBL020.InvoiceName (مفتاح التمييز بعد التهيئة).
# TBL020.CardGuide يُولَّد جديداً لكل نوع (NEWID / uuid4) حتى يقبل SQL Server دون GUID ثابت.
# TBL022.MainGuide = CardGuide من TBL020 لذلك النوع (يُسترجع عبر MAT3AM أو WHERE InvoiceName = الاسم المعروف).
# معرف الفاتورة نفسه في TBL022.CardGuide يُولَّد جديداً لكل عملية بيع (save_invoice).
MAT3AM_RESTAURANT_ORDER_KINDS: Tuple[str, ...] = (
    "table",
    "takeaway",
    "delivery",
    "purchase",
    "bar_quick",
    "catering",
)
MAT3AM_ORDERKIND_INVOICE_DISPLAY_AR: dict[str, str] = {
    "table": "مطاعم — طاولات داخلية",
    "takeaway": "مطاعم — سفري",
    "delivery": "مطاعم — دليفري",
    "purchase": "مطاعم — مشتريات",
    "bar_quick": "مطاعم — بار / طلب سريع",
    "catering": "مطاعم — مناسبات وكاترينج",
}
# نفس LatinName المستخدم في تهيئة TBL020 — يُستخدم لـ TBL008.LatinName (توحيد مع النمط).
MAT3AM_ORDERKIND_INVOICE_DISPLAY_LATIN: dict[str, str] = {
    "table": "MAT3AM Table",
    "takeaway": "MAT3AM Takeaway",
    "delivery": "MAT3AM Delivery",
    "purchase": "MAT3AM Purchase",
    "bar_quick": "MAT3AM Bar",
    "catering": "MAT3AM Catering",
}
MAT3AM_RESTAURANT_ORDER_KINDS_SET = frozenset(MAT3AM_RESTAURANT_ORDER_KINDS)

# يُكتب في TextValue01 عند إنشاء الصف في TBL020 (تمييز/تدقيق)
MAT3AM_ORDERKIND_TEXTVALUE01: dict[str, str] = {
    "table": "MAT3AM_ORDER_TABLE",
    "takeaway": "MAT3AM_ORDER_TAKEAWAY",
    "delivery": "MAT3AM_ORDER_DELIVERY",
    "purchase": "MAT3AM_ORDER_PURCHASE",
    "bar_quick": "MAT3AM_ORDER_BAR",
    "catering": "MAT3AM_ORDER_CATERING",
}


def _mat3am_restaurant_kind_seed_specs() -> list[tuple[str, str, str, str]]:
    """مصدر واحد لتهيئة TBL020 وTBL008: (OrderKind, InvoiceName/WarehouseName عربي, LatinName, TextValue01)."""
    return [
        (
            kind,
            MAT3AM_ORDERKIND_INVOICE_DISPLAY_AR[kind],
            MAT3AM_ORDERKIND_INVOICE_DISPLAY_LATIN[kind],
            MAT3AM_ORDERKIND_TEXTVALUE01[kind],
        )
        for kind in MAT3AM_RESTAURANT_ORDER_KINDS
    ]


def _normalize_restaurant_order_kind(raw: Optional[str]) -> str:
    s = (raw or "").strip().lower()
    if s in MAT3AM_RESTAURANT_ORDER_KINDS_SET:
        return s
    if s in ("table", "dinein", "hall", "صالة", "طاولات", "طاولة", "مبيعات الصالة"):
        return "table"
    if s in ("takeaway", "to-go", "safari", "سفري", "سفارى", "سفاري", "مبيعات السفري", "مبيعات السفاري"):
        return "takeaway"
    if s in ("delivery", "دليفري", "توصيل", "مبيعات الدليفري"):
        return "delivery"
    if s in ("bar", "bar_quick", "بار"):
        return "bar_quick"
    if s in ("catering", "كاترينج", "مناسبات"):
        return "catering"
    if s in ("purchase", "مشتريات"):
        return "purchase"
    return "table"


def _mat3am_tbl020_cardguide_by_name_like(cursor, name_hint: str) -> Optional[str]:
    hint = (name_hint or "").strip()
    if not hint:
        return None
    try:
        cursor.execute(
            "SELECT TOP (1) CardGuide FROM dbo.TBL020 WHERE InvoiceName LIKE ? ORDER BY CardGuide",
            (f"%{hint}%",),
        )
        row = cursor.fetchone()
        if row and row[0] is not None:
            return str(row[0]).strip()
    except Exception:
        pass
    return None


def _mat3am_tbl020_column_names(cursor) -> set[str]:
    cursor.execute(
        """
        SELECT c.name FROM sys.columns c
        WHERE c.object_id = OBJECT_ID(N'dbo.TBL020') AND c.is_identity = 0
        """
    )
    return {str(r[0]) for r in cursor.fetchall() if r and r[0]}


# شكل إكسترا الكامل لـ TBL020 (إلزامي لبعض قواعد إكسترا — أعمدة POS/الفاتورة)
_MAT3AM_T020_XTRA_POS_COLUMNS: frozenset[str] = frozenset(
    {
        "CardGuide",
        "CardNumber",
        "InvoiceName",
        "LatinName",
        "QtyCalculation",
        "BillType",
        "BillKind",
        "PriceType",
        "PriceType2",
        "POSType",
        "DefaultPayType",
        "WithoutItemTax",
        "InvoiceMovementSide",
        "AgentAccountSide",
        "Fields",
    }
)


def _mat3am_try_insert_tbl020_xtra_pos_row(cursor, inv_ar: str, inv_lat: str) -> bool:
    """
    INSERT يطابق تعريف المستخدم لـ TBL020: NEWID() + قيم افتراضية للأعمدة الإدارية/السعر.
    CardNumber = MAX+1 وليس رقماً ثابتاً.
    """
    cols = _mat3am_tbl020_column_names(cursor)
    if not _MAT3AM_T020_XTRA_POS_COLUMNS.issubset(cols):
        return False
    sql = """
    INSERT INTO dbo.TBL020 (
        CardGuide,
        CardNumber,
        InvoiceName,
        LatinName,
        QtyCalculation,
        BillType,
        BillKind,
        PriceType,
        PriceType2,
        POSType,
        DefaultPayType,
        WithoutItemTax,
        InvoiceMovementSide,
        AgentAccountSide,
        Fields
    )
    VALUES (
        NEWID(),
        (SELECT ISNULL(MAX(x.CardNumber), 0) + 1 FROM dbo.TBL020 AS x),
        ?,
        ?,
        0,
        2,
        0,
        1,
        0,
        1,
        2,
        0,
        -1,
        1,
        N'ProductGuide,Quantity,Unit,Description'
    )
    """
    try:
        cursor.execute(sql, (inv_ar, inv_lat))
        return _mat3am_tbl020_cardguide_by_invoice_name(cursor, inv_ar) is not None
    except Exception:
        return False


def _mat3am_try_insert_tbl020_newid_only(
    cursor, inv_ar: str, inv_lat: str, text_value01: Optional[str]
) -> bool:
    """
    إدراج صف بنفس InvoiceName باستخدام NEWID() داخل T-SQL فقط (لا CAST(? AS uniqueidentifier) من بايثون).
    يحل فشل التحويل 8169 مع بعض برامج التشغيل/الربط.
    """
    if _mat3am_try_insert_tbl020_xtra_pos_row(cursor, inv_ar, inv_lat):
        return True
    cols = _mat3am_tbl020_column_names(cursor)
    has_cn = "CardNumber" in cols
    has_tv = "TextValue01" in cols
    has_fields = "Fields" in cols
    trials: list[tuple[str, tuple]] = []

    if has_cn:
        trials.append(
            (
                """INSERT INTO dbo.TBL020 (CardGuide, CardNumber, InvoiceName, LatinName)
                   VALUES (NEWID(), (SELECT ISNULL(MAX(x.CardNumber), 0) + 1 FROM dbo.TBL020 AS x), ?, ?)""",
                (inv_ar, inv_lat),
            )
        )
        if has_tv and text_value01:
            trials.append(
                (
                    """INSERT INTO dbo.TBL020 (CardGuide, CardNumber, InvoiceName, LatinName, TextValue01)
                       VALUES (NEWID(), (SELECT ISNULL(MAX(x.CardNumber), 0) + 1 FROM dbo.TBL020 AS x), ?, ?, ?)""",
                    (inv_ar, inv_lat, (text_value01 or "")[:255]),
                )
            )
    if has_fields:
        trials.append(
            (
                "INSERT INTO dbo.TBL020 (CardGuide, InvoiceName, LatinName, Fields) VALUES (NEWID(), ?, ?, NULL)",
                (inv_ar, inv_lat),
            )
        )
        if has_tv and text_value01:
            trials.append(
                (
                    "INSERT INTO dbo.TBL020 (CardGuide, InvoiceName, LatinName, Fields, TextValue01) VALUES (NEWID(), ?, ?, NULL, ?)",
                    (inv_ar, inv_lat, (text_value01 or "")[:255]),
                )
            )
    trials.append(
        (
            "INSERT INTO dbo.TBL020 (CardGuide, InvoiceName, LatinName) VALUES (NEWID(), ?, ?)",
            (inv_ar, inv_lat),
        )
    )
    if has_tv and text_value01:
        trials.append(
            (
                "INSERT INTO dbo.TBL020 (CardGuide, InvoiceName, LatinName, TextValue01) VALUES (NEWID(), ?, ?, ?)",
                (inv_ar, inv_lat, (text_value01 or "")[:255]),
            )
        )

    for sql, params in trials:
        try:
            cursor.execute(sql, params)
            if _mat3am_tbl020_cardguide_by_invoice_name(cursor, inv_ar):
                return True
        except Exception:
            continue
    return False


def _mat3am_insert_tbl020_one_row_minimal(
    cursor, card_guid: str, inv_ar: str, inv_lat: str, text_value01: Optional[str]
) -> bool:
    """إدراج صف واحد بأبسط أعمدة ممكنة؛ يناسب قاعدة جديدة. يعيد False إن فشلت كل المحاولات."""
    if _mat3am_try_insert_tbl020_newid_only(cursor, inv_ar, inv_lat, text_value01):
        return True
    cols = _mat3am_tbl020_column_names(cursor)
    has_cn = "CardNumber" in cols
    has_tv = "TextValue01" in cols
    has_fields = "Fields" in cols
    g = str(card_guid).strip().upper()
    trials: list[tuple[str, tuple]] = []

    if has_cn:
        trials.append(
            (
                """INSERT INTO dbo.TBL020 (CardGuide, CardNumber, InvoiceName, LatinName)
                   VALUES (CAST(? AS uniqueidentifier),
                    (SELECT ISNULL(MAX(x.CardNumber), 0) + 1 FROM dbo.TBL020 AS x), ?, ?)""",
                (g, inv_ar, inv_lat),
            )
        )
        if has_tv and text_value01:
            trials.append(
                (
                    """INSERT INTO dbo.TBL020 (CardGuide, CardNumber, InvoiceName, LatinName, TextValue01)
                       VALUES (CAST(? AS uniqueidentifier),
                        (SELECT ISNULL(MAX(x.CardNumber), 0) + 1 FROM dbo.TBL020 AS x), ?, ?, ?)""",
                    (g, inv_ar, inv_lat, (text_value01 or "")[:255]),
                )
            )
    if has_fields:
        trials.append(
            (
                "INSERT INTO dbo.TBL020 (CardGuide, InvoiceName, LatinName, Fields) VALUES (CAST(? AS uniqueidentifier), ?, ?, NULL)",
                (g, inv_ar, inv_lat),
            )
        )
        if has_tv and text_value01:
            trials.append(
                (
                    "INSERT INTO dbo.TBL020 (CardGuide, InvoiceName, LatinName, Fields, TextValue01) VALUES (CAST(? AS uniqueidentifier), ?, ?, NULL, ?)",
                    (g, inv_ar, inv_lat, (text_value01 or "")[:255]),
                )
            )
    trials.append(
        (
            "INSERT INTO dbo.TBL020 (CardGuide, InvoiceName, LatinName) VALUES (CAST(? AS uniqueidentifier), ?, ?)",
            (g, inv_ar, inv_lat),
        )
    )
    if has_tv and text_value01:
        trials.append(
            (
                "INSERT INTO dbo.TBL020 (CardGuide, InvoiceName, LatinName, TextValue01) VALUES (CAST(? AS uniqueidentifier), ?, ?, ?)",
                (g, inv_ar, inv_lat, (text_value01 or "")[:255]),
            )
        )

    for sql, params in trials:
        try:
            cursor.execute(sql, params)
            if _mat3am_tbl020_row_exists(cursor, g):
                return True
        except Exception:
            continue
    return False


def _mat3am_insert_tbl020_minimal_template_row(cursor) -> str:
    """قالب مؤقت لنسخ باقي الأعمدة من إكسترا — فقط عندما يفشل الإدراج المباشر للستة صفوف."""
    template_guid = str(uuid.uuid4()).upper()
    if not _mat3am_insert_tbl020_one_row_minimal(
        cursor, template_guid, "مطاعم — قالب تهيئة", "MAT3AM Seed Template", None
    ):
        raise RuntimeError(
            "تعذر إدراج أي صف في TBL020 الفارغ — أعمدة إلزامية في إكسترا غير مغطاة. عرّف أول نوع فاتورة من البرنامج الأصلي ثم أعد التهيئة."
        )
    return template_guid


def _mat3am_norm_guid_key(g: object) -> str:
    s = str(g or "").strip().upper().replace("{", "").replace("}", "")
    return s


def _mat3am_guid_sql_param(g: object) -> str:
    """نص موحّد لربط uniqueidentifier في T-SQL (بدون أقواس)."""
    return _mat3am_norm_guid_key(g)


def _mat3am_tbl020_row_exists(cursor, card_guid: object) -> bool:
    g = _mat3am_guid_sql_param(card_guid)
    if not g:
        return False
    cursor.execute(
        "SELECT 1 FROM dbo.TBL020 WHERE CardGuide = CAST(? AS uniqueidentifier)",
        (g,),
    )
    return cursor.fetchone() is not None


def _mat3am_tbl020_cardguide_by_invoice_name(cursor, invoice_name_ar: str) -> Optional[str]:
    """CardGuide من TBL020 حسب InvoiceName (مرحلة ربط TBL022.MainGuide)."""
    name = (invoice_name_ar or "").strip()
    if not name:
        return None
    try:
        cursor.execute(
            "SELECT TOP (1) CardGuide FROM dbo.TBL020 WHERE InvoiceName = ? ORDER BY CardGuide",
            (name,),
        )
        row = cursor.fetchone()
        if row and row[0] is not None:
            return str(row[0]).strip()
    except Exception:
        pass
    return None


def _mat3am_map_seeded_cardguides(cursor) -> set[str]:
    """معرّفات TBL020 المسجّلة في خريطة المطعم (لا نستخدمها كقالب نسخ من إكسترا)."""
    out: set[str] = set()
    try:
        cursor.execute("SELECT Tbl020CardGuide FROM dbo.MAT3AM_RESTAURANT_INVOICE_TYPES")
        for r in cursor.fetchall() or []:
            if r and r[0] is not None:
                out.add(_mat3am_norm_guid_key(r[0]))
    except Exception:
        pass
    return out


def _mat3am_pick_tbl020_template_guid(cursor) -> Optional[str]:
    """صف قالب للنسخ: يُفضَّل صف إكسترا أصلي وليس صفاً مسجّلاً في MAT3AM_RESTAURANT_INVOICE_TYPES."""
    fixed = _mat3am_map_seeded_cardguides(cursor)
    try:
        cursor.execute("SELECT CardGuide FROM dbo.TBL020 ORDER BY CardGuide")
        rows = cursor.fetchall() or []
    except Exception:
        return None
    for row in rows:
        if not row or row[0] is None:
            continue
        raw = row[0]
        if _mat3am_norm_guid_key(raw) in fixed:
            continue
        return str(raw)
    for row in rows:
        if row and row[0] is not None:
            return str(row[0])
    return None


def _mat3am_clone_tbl020_row(
    cursor,
    template_card_guid: str,
    new_card_guid: str,
    invoice_name: str,
    latin_name: str,
    text_value01_tag: str,
) -> None:
    """INSERT صف في TBL020 بنسخ أعمدة من صف قالب (أول نوع موجود في إكسترا) مع CardGuide وأسماء جديدة."""
    cursor.execute(
        """
        SELECT c.name, CAST(c.is_identity AS int)
        FROM sys.columns c
        WHERE c.object_id = OBJECT_ID(N'dbo.TBL020') AND c.is_computed = 0
        ORDER BY c.column_id
        """
    )
    col_rows = cursor.fetchall()
    if not col_rows:
        raise RuntimeError("تعذر قراءة أعمدة TBL020")
    insert_cols: list[str] = []
    for name, is_identity in col_rows:
        if int(is_identity or 0):
            continue
        insert_cols.append(str(name))

    tpl = _mat3am_guid_sql_param(template_card_guid)
    newg = _mat3am_guid_sql_param(new_card_guid)
    if not tpl or not newg:
        raise RuntimeError("GUID قالب أو هدف غير صالح لنسخ TBL020")

    select_parts: list[str] = []
    params: list = []
    for c in insert_cols:
        if c == "CardGuide":
            select_parts.append("CAST(? AS uniqueidentifier)")
            params.append(newg)
        elif c == "InvoiceName":
            select_parts.append("?")
            params.append((invoice_name or "")[:255])
        elif c == "LatinName":
            select_parts.append("?")
            params.append((latin_name or "")[:255])
        elif c == "TextValue01":
            select_parts.append("?")
            params.append((text_value01_tag or "")[:255] or None)
        elif c == "CardNumber":
            select_parts.append("(SELECT ISNULL(MAX(CardNumber), 0) + 1 FROM dbo.TBL020)")
        else:
            select_parts.append(f"[src].[{c}]")

    colnames_sql = ", ".join(f"[{c}]" for c in insert_cols)
    select_sql = ", ".join(select_parts)
    sql = f"""
    INSERT INTO dbo.TBL020 ({colnames_sql})
    SELECT {select_sql}
    FROM dbo.TBL020 AS [src]
    WHERE [src].[CardGuide] = CAST(? AS uniqueidentifier)
    """
    cursor.execute(
        "SELECT 1 FROM dbo.TBL020 WHERE CardGuide = CAST(? AS uniqueidentifier)",
        (tpl,),
    )
    if cursor.fetchone() is None:
        raise RuntimeError(
            f"قالب TBL020 غير موجود (CardGuide={tpl}) — تعذر النسخ."
        )
    params.append(tpl)
    cursor.execute(sql, tuple(params))
    if not _mat3am_tbl020_row_exists(cursor, newg):
        raise RuntimeError(
            f"INSERT…SELECT لم يُدرج صفاً في TBL020 للـ CardGuide={newg} "
            f"(قالب={tpl}). غالباً القالب لا يطابق الاستعلام أو قيود الجدول."
        )


def _get_restaurant_invoice_type_guid(cursor, order_kind: str, explicit_guid: Optional[str] = None) -> str:
    """
    TBL022.MainGuide = نوع الفاتورة من TBL020:
    أولاً من MAT3AM_RESTAURANT_INVOICE_TYPES، وإلا SELECT CardGuide FROM TBL020 WHERE InvoiceName = الاسم المعروف.
    """
    if explicit_guid and str(explicit_guid).strip():
        exp = str(explicit_guid).strip()
        try:
            uuid.UUID(exp)
            return exp.upper()
        except Exception:
            cg = _mat3am_tbl020_cardguide_by_invoice_name(cursor, exp)
            if not cg:
                cg = _mat3am_tbl020_cardguide_by_name_like(cursor, exp)
            if cg:
                return _mat3am_guid_sql_param(cg)
    k = _normalize_restaurant_order_kind(order_kind)
    try:
        cursor.execute(
            "SELECT Tbl020CardGuide FROM dbo.MAT3AM_RESTAURANT_INVOICE_TYPES WHERE OrderKind = ?",
            (k,),
        )
        row = cursor.fetchone()
        if row and row[0] is not None:
            return _mat3am_guid_sql_param(row[0])
    except Exception:
        pass
    inv_ar = MAT3AM_ORDERKIND_INVOICE_DISPLAY_AR.get(k)
    if inv_ar:
        cg = _mat3am_tbl020_cardguide_by_invoice_name(cursor, inv_ar)
        if cg:
            return _mat3am_guid_sql_param(cg)
    # fallback أوسع حسب الاسم التجاري
    alt_hints = {
        "table": ["طاولات داخلية", "الصالة", "مطاعم"],
        "takeaway": ["سفري", "سفاري"],
        "delivery": ["دليفري", "توصيل"],
        "bar_quick": ["بار", "طلب سريع"],
        "catering": ["كاترينج", "مناسبات"],
        "purchase": ["مشتريات"],
    }
    for h in alt_hints.get(k, []):
        cg = _mat3am_tbl020_cardguide_by_name_like(cursor, h)
        if cg:
            return _mat3am_guid_sql_param(cg)
    return str(FALLBACK_INVOICE_TYPE_GUID).upper()


def _get_purchase_invoice_type_guid(cursor) -> Optional[str]:
    try:
        cursor.execute(
            "SELECT Tbl020CardGuide FROM dbo.MAT3AM_RESTAURANT_INVOICE_TYPES WHERE OrderKind = N'purchase'",
        )
        row = cursor.fetchone()
        if row and row[0] is not None:
            return _mat3am_guid_sql_param(row[0])
    except Exception:
        pass
    cg = _mat3am_tbl020_cardguide_by_invoice_name(
        cursor, MAT3AM_ORDERKIND_INVOICE_DISPLAY_AR.get("purchase", "")
    )
    return _mat3am_guid_sql_param(cg) if cg else None


def _seed_mat3am_restaurant_invoice_types(cursor) -> dict:
    """
    تهيئة: 6 صفوف في TBL020 بـ CardGuide جديد (uuid4) لكل نوع، مع InvoiceName عربي مميّز.
    TBL022.MainGuide يُستمد لاحقاً من Tbl020CardGuide (MAT3AM) أو من SELECT CardGuide FROM TBL020 WHERE InvoiceName = ...
    قاعدة فارغة: إدراج مباشر؛ إن تعذّر يُنسَخ من قالب مؤقت أو من صف موجود.
    """
    out: dict = {
        "ok": True,
        "created": [],
        "skipped": [],
        "errors": [],
        "note": None,
        "tbl020SeededGuids": {},
        "tbl020SeededDirect": False,
        "tbl020TemplateInserted": False,
    }
    specs = _mat3am_restaurant_kind_seed_specs()
    remove_template: Optional[str] = None
    used_direct_six = False
    template_guid: Optional[str] = None
    try:
        try:
            cursor.execute("SELECT COUNT(*) FROM dbo.TBL020")
            n020 = int((cursor.fetchone() or [0])[0] or 0)
        except Exception as e:
            out["ok"] = False
            out["note"] = str(e)
            return out

        if n020 == 0:
            inserted_guids: list[str] = []
            direct_ok = True
            for kind, inv_ar, inv_lat, tag in specs:
                if _mat3am_try_insert_tbl020_newid_only(cursor, inv_ar, inv_lat, tag):
                    cg0 = _mat3am_tbl020_cardguide_by_invoice_name(cursor, inv_ar)
                    if cg0:
                        inserted_guids.append(_mat3am_guid_sql_param(cg0))
                    else:
                        direct_ok = False
                        break
                    continue
                card_guid = str(uuid.uuid4()).upper()
                if _mat3am_insert_tbl020_one_row_minimal(cursor, card_guid, inv_ar, inv_lat, tag):
                    inserted_guids.append(str(card_guid).strip().upper())
                else:
                    direct_ok = False
                    break
            if direct_ok:
                used_direct_six = True
                out["tbl020SeededDirect"] = True
            else:
                for gid in inserted_guids:
                    try:
                        cursor.execute(
                            "DELETE FROM dbo.TBL020 WHERE CardGuide = CAST(? AS uniqueidentifier)",
                            (gid,),
                        )
                    except Exception:
                        pass
                try:
                    remove_template = _mat3am_insert_tbl020_minimal_template_row(cursor)
                    out["tbl020TemplateInserted"] = True
                except Exception as e:
                    out["ok"] = False
                    out["note"] = str(e)
                    return out

        if not used_direct_six:
            template_guid = _mat3am_pick_tbl020_template_guid(cursor)
            if not template_guid:
                out["ok"] = False
                out["note"] = "TBL020 بلا صفوف مناسب للنسخ — راجع هيكل الجدول."
                return out
            out["debugTemplateGuid"] = _mat3am_guid_sql_param(template_guid)

        # خريطة دون صف TBL020 بنفس InvoiceName المعروف — حذف الخريطة لإعادة الإدراج
        for kind, inv_ar, inv_lat, tag in specs:
            try:
                if not _mat3am_tbl020_cardguide_by_invoice_name(cursor, inv_ar):
                    cursor.execute(
                        "DELETE FROM dbo.MAT3AM_RESTAURANT_INVOICE_TYPES WHERE OrderKind = ?",
                        (kind,),
                    )
            except Exception:
                pass

        for kind, inv_ar, inv_lat, tag in specs:
            try:
                existing = _mat3am_tbl020_cardguide_by_invoice_name(cursor, inv_ar)
                tbl_exists = existing is not None
                card_guid = _mat3am_guid_sql_param(existing) if existing else ""

                cursor.execute("SELECT 1 FROM dbo.MAT3AM_RESTAURANT_INVOICE_TYPES WHERE OrderKind = ?", (kind,))
                map_exists = cursor.fetchone() is not None

                if tbl_exists and map_exists:
                    out["skipped"].append(kind)
                    continue

                did_tbl = False
                did_map = False
                if not tbl_exists:
                    if _mat3am_try_insert_tbl020_newid_only(cursor, inv_ar, inv_lat, tag):
                        cg_ins = _mat3am_tbl020_cardguide_by_invoice_name(cursor, inv_ar)
                        card_guid = _mat3am_guid_sql_param(cg_ins) if cg_ins else ""
                        did_tbl = True
                    else:
                        card_guid = str(uuid.uuid4()).upper()
                        tpl = template_guid
                        if tpl is None:
                            tpl = _mat3am_pick_tbl020_template_guid(cursor)
                        if tpl is None:
                            out["errors"].append(
                                {
                                    "orderKind": kind,
                                    "detail": "تعذر إنشاء نوع الفاتورة في TBL020 (إدراج NEWID() فشل ولا قالب للنسخ).",
                                }
                            )
                            out["ok"] = False
                            continue
                        try:
                            _mat3am_clone_tbl020_row(cursor, tpl, card_guid, inv_ar, inv_lat, tag)
                            did_tbl = True
                        except Exception as ex_clone:
                            out["errors"].append(
                                {
                                    "orderKind": kind,
                                    "detail": f"فشل إدراج TBL020: {ex_clone}",
                                }
                            )
                            out["ok"] = False
                            continue

                if not map_exists:
                    cursor.execute(
                        """
                        INSERT INTO dbo.MAT3AM_RESTAURANT_INVOICE_TYPES (OrderKind, Tbl020CardGuide, InvoiceDisplayName)
                        VALUES (?, ?, ?)
                        """,
                        (kind, _mat3am_guid_sql_param(card_guid), inv_ar),
                    )
                    did_map = True

                if did_tbl or did_map:
                    out["created"].append(
                        {
                            "orderKind": kind,
                            "tbl020CardGuide": _mat3am_guid_sql_param(card_guid),
                            "invoiceName": inv_ar,
                            "textValue01": tag,
                        }
                    )
            except Exception as ex:
                out["errors"].append({"orderKind": kind, "detail": str(ex)})
                out["ok"] = False

        try:
            for kind in MAT3AM_RESTAURANT_ORDER_KINDS:
                cursor.execute(
                    "SELECT Tbl020CardGuide FROM dbo.MAT3AM_RESTAURANT_INVOICE_TYPES WHERE OrderKind = ?",
                    (kind,),
                )
                r = cursor.fetchone()
                if r and r[0] is not None:
                    out["tbl020SeededGuids"][kind] = _mat3am_guid_sql_param(r[0])
        except Exception:
            pass
    finally:
        if remove_template:
            try:
                cursor.execute(
                    "DELETE FROM dbo.TBL020 WHERE CardGuide = CAST(? AS uniqueidentifier)",
                    (remove_template,),
                )
            except Exception:
                pass
    return out


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
        _ensure_menu_tables(cursor)
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
        _ensure_menu_tables(cursor)
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
        _ensure_menu_tables(cursor)
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
        _ensure_menu_tables(cursor)
        if group_guide:
            query = """
            SELECT CardGuide, ProductName, LatinName, EndUserPrice, AgentPrice, GroupGuid, ProductImageUrl, Hieght3
            FROM TBL007
            WHERE ProductName IS NOT NULL AND NotActive = 0 AND GroupGuid = CAST(? AS uniqueidentifier)
            ORDER BY ProductName
            """
            cursor.execute(query, group_guide)
        else:
            query = """
            SELECT CardGuide, ProductName, LatinName, EndUserPrice, AgentPrice, GroupGuid, ProductImageUrl, Hieght3
            FROM TBL007
            WHERE ProductName IS NOT NULL AND NotActive = 0
            ORDER BY ProductName
            """
            cursor.execute(query)
        
        products = []
        for row in cursor.fetchall():
            guid = str(row[0])
            img_manifest = _product_images_manifest_get(guid)
            img_db = str(row[6]) if len(row) > 6 and row[6] else None
            products.append({
                "CardGuide": guid,
                "ProductName": row[1],
                "Price": float(row[3]) if row[3] else (float(row[4]) if row[4] else 0.0),
                "BaseEndUserPrice": float(row[3]) if row[3] else 0.0,
                "AgentPrice": float(row[4]) if row[4] else 0.0,
                "GroupGuid": str(row[5]) if row[5] else None,
                "image": f"/api/products/{guid}/image",
                "imageUrl": img_manifest or img_db or f"/api/products/{guid}/image",
                "PrepMinutes": float(row[7]) if len(row) > 7 and row[7] is not None else 0.0,
                "Hieght3": float(row[7]) if len(row) > 7 and row[7] is not None else 0.0,
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
        _ensure_menu_tables(cursor)
        g = str(uuid.uuid4()).upper()
        group_guid = body.get("GroupGuid") or body.get("group") or None
        price = float(body.get("AgentPrice") or body.get("Price") or body.get("price") or 0)
        latin = (body.get("LatinName") or "").strip() or None
        image_url = str(body.get("imageUrl") or body.get("ProductImageUrl") or "").strip() or None
        prep_minutes = body.get("PrepMinutes")
        if prep_minutes is None:
            prep_minutes = body.get("Hieght3")
        try:
            prep_minutes = float(prep_minutes or 0)
        except (TypeError, ValueError):
            prep_minutes = 0.0
        cursor.execute(
            "INSERT INTO TBL007 (CardGuide, ProductName, LatinName, GroupGuid, AgentPrice, NotActive, ProductImageUrl, Hieght3) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
            (g, name, latin, group_guid, price, image_url, prep_minutes)
        )
        conn.commit()
        if image_url:
            _product_images_manifest_set(g, image_url)
        return {"success": True, "CardGuide": g, "ProductName": name, "imageUrl": image_url}
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
        _ensure_menu_tables(cursor)
        search_pattern = f"%{search_text}%"
        query = """
        SELECT TOP 100 CardGuide, ProductName, AgentPrice, ProductImageUrl, Hieght3
        FROM TBL007
        WHERE ProductName LIKE ? AND NotActive = 0
        ORDER BY ProductName
        """
        cursor.execute(query, search_pattern)
        
        products = []
        for row in cursor.fetchall():
            guid = str(row[0])
            img_manifest = _product_images_manifest_get(guid)
            img_db = str(row[3]) if len(row) > 3 and row[3] else None
            products.append({
                "CardGuide": guid,
                "ProductName": row[1],
                "Price": float(row[2]) if row[2] else 0.0,
                "AgentPrice": float(row[2]) if row[2] else 0.0,
                "image": f"/api/products/{guid}/image",
                "imageUrl": img_manifest or img_db or f"/api/products/{guid}/image",
                "PrepMinutes": float(row[4]) if len(row) > 4 and row[4] is not None else 0.0,
                "Hieght3": float(row[4]) if len(row) > 4 and row[4] is not None else 0.0,
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


@app.get("/api/products/{card_guide}/xtra")
def get_product_xtra_card(card_guide: str):
    """بطاقة مادة كاملة — قراءة صف TBL007 + نصوص العرض للحقول المرتبطة."""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cols = _fetch_tbl007_columns(cursor)
        if not cols:
            raise HTTPException(status_code=500, detail="جدول TBL007 غير موجود أو غير قابل للقراءة")
        cg = card_guide.strip()
        cursor.execute(
            "SELECT * FROM TBL007 WHERE CardGuide = CAST(? AS uniqueidentifier)",
            (cg,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="المادة غير موجودة")
        d = _row_to_dict(cursor, row)
        disp = _product_card_displays(cursor, cols, d)
        guides_raw = _product_card_guides(cols, d)
        guides = {
            "GroupGuid": str(guides_raw["GroupGuid"]) if guides_raw.get("GroupGuid") else None,
            "DefaultCurrency": str(guides_raw["DefaultCurrency"]) if guides_raw.get("DefaultCurrency") else None,
            "AccountGuide": str(guides_raw["AccountGuide"]) if guides_raw.get("AccountGuide") else None,
            "RelatedAgent": str(guides_raw["RelatedAgent"]) if guides_raw.get("RelatedAgent") else None,
            "categories": {a: (str(b) if b is not None else None) for a, b in (guides_raw.get("categories") or {}).items()},
        }
        return {"values": d, "display": disp, "guides": guides, "tbl007_columns": sorted(cols)}
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


@app.put("/api/products/{card_guide}/xtra")
def put_product_xtra_card(card_guide: str, body: dict):
    """تحديث بطاقة مادة — يكتب فقط الأعمدة الموجودة في TBL007."""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cols = _fetch_tbl007_columns(cursor)
        if not cols:
            raise HTTPException(status_code=500, detail="جدول TBL007 غير موجود")
        updates = _apply_xtra_product_body_to_columns(body, cols)
        updates.pop("CardGuide", None)
        colnames = [c for c in updates if c in cols and c != "CardGuide"]
        if not colnames:
            return {"success": True, "updated": 0, "message": "لا حقول للتحديث"}
        set_sql = ", ".join(f"[{c}] = ?" for c in colnames)
        vals = [updates[c] for c in colnames]
        vals.append(card_guide.strip())
        cursor.execute(
            f"UPDATE TBL007 SET {set_sql} WHERE CardGuide = CAST(? AS uniqueidentifier)",
            vals,
        )
        conn.commit()
        return {"success": True, "updated": cursor.rowcount, "columns_written": colnames}
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


@app.post("/api/products/xtra")
def post_product_xtra_card(body: dict):
    """إنشاء بطاقة مادة — إدراج ديناميكي حسب أعمدة TBL007."""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cols = _fetch_tbl007_columns(cursor)
        if not cols:
            raise HTTPException(status_code=500, detail="جدول TBL007 غير موجود")
        new_id = str(uuid.uuid4()).upper()
        updates = _apply_xtra_product_body_to_columns(body, cols)
        updates["CardGuide"] = new_id
        pn = updates.get("ProductName")
        if not pn or not str(pn).strip():
            raise HTTPException(status_code=400, detail="اسم المادة مطلوب")
        if "NotActive" in cols and "NotActive" not in updates:
            updates["NotActive"] = 0
        colnames = [c for c in updates if c in cols]
        vals = [updates[c] for c in colnames]
        ph = ",".join(["?"] * len(colnames))
        br = ",".join(f"[{c}]" for c in colnames)
        cursor.execute(f"INSERT INTO TBL007 ({br}) VALUES ({ph})", vals)
        conn.commit()
        return {"success": True, "CardGuide": new_id, "columns_written": colnames}
    except HTTPException:
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


@app.get("/api/products/{card_guide}/components")
def get_product_components(card_guide: str):
    """مشتقات الصنف من جدول BOM الفعلي (TBL063/TBL062)."""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        bom = _bom_table_cols(cursor)
        written = 0
        if not bom:
            return {"components": []}
        unit_sel = f"ISNULL(c.[{bom['unit']}],1)" if bom.get("unit") else "1"
        price_sel = f"ISNULL(c.[{bom['price']}],0)" if bom.get("price") else "0"
        uq_sel = f"ISNULL(c.[{bom['unit_qty']}],0)" if bom.get("unit_qty") else "0"
        cursor.execute(
            f"""
            SELECT
                c.ID,
                c.[{bom['item']}],
                ISNULL(p.ProductName, N'') AS ItemName,
                {unit_sel} AS UnitNo,
                ISNULL(c.[{bom['qty']}], 0) AS Quantity,
                {price_sel} AS PriceRatio,
                {uq_sel} AS UnitQuantity
            FROM dbo.[{bom['table']}] c
            LEFT JOIN dbo.TBL007 p ON p.CardGuide = c.[{bom['item']}]
            WHERE c.[{bom['main']}] = CAST(? AS uniqueidentifier)
            ORDER BY c.ID
            """,
            (card_guide.strip(),),
        )
        rows = cursor.fetchall()
        return {
            "components": [
                {
                    "id": int(r[0]),
                    "itemGuide": str(r[1]) if r[1] else "",
                    "itemName": r[2] or "",
                    "unit": int(r[3] or 1),
                    "quantity": float(r[4] or 0),
                    "priceRatio": float(r[5] or 0),
                    "unitQuantity": float(r[6] or 0),
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


@app.put("/api/products/{card_guide}/components")
def put_product_components(card_guide: str, body: dict):
    """استبدال مشتقات الصنف في جدول BOM الفعلي بالكامل وفق القائمة المرسلة."""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    rows = body.get("components") if isinstance(body, dict) else []
    if not isinstance(rows, list):
        rows = []
    try:
        cursor = conn.cursor()
        bom = _bom_table_cols(cursor)
        if not bom:
            raise HTTPException(status_code=500, detail="لا يوجد جدول BOM متوافق (TBL063/TBL062)")
        main_guide = card_guide.strip()
        cursor.execute(f"DELETE FROM dbo.[{bom['table']}] WHERE [{bom['main']}] = CAST(? AS uniqueidentifier)", (main_guide,))
        inserted = 0
        for ln in rows:
            if not isinstance(ln, dict):
                continue
            item_guide = str(ln.get("itemGuide") or ln.get("componentProductGuide") or "").strip()
            if not item_guide:
                continue
            qty = float(ln.get("quantity") or 0)
            if qty <= 0:
                continue
            try:
                unit_no = int(float(ln.get("unit") or ln.get("unitCode") or 1))
            except Exception:
                unit_no = 1
            price_ratio = float(ln.get("priceRatio") or ln.get("unitCost") or 0)
            unit_qty = float(ln.get("unitQuantity") or 0)
            cols = [bom["item"], bom["main"], bom["qty"]]
            vals = [item_guide, main_guide, qty]
            if bom.get("unit"):
                cols.append(bom["unit"]); vals.append(unit_no)
            if bom.get("price"):
                cols.append(bom["price"]); vals.append(price_ratio)
            if bom.get("unit_qty"):
                cols.append(bom["unit_qty"]); vals.append(unit_qty)
            col_sql = ", ".join(f"[{c}]" for c in cols)
            ph = ", ".join("CAST(? AS uniqueidentifier)" if c in (bom["item"], bom["main"]) else "?" for c in cols)
            cursor.execute(f"INSERT INTO dbo.[{bom['table']}] ({col_sql}) VALUES ({ph})", tuple(vals))
            inserted += 1
        conn.commit()
        return {"ok": True, "mainGuide": main_guide, "inserted": inserted}
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


@app.post("/api/products/xtra-bundle-upsert")
def post_xtra_bundle_upsert(body: dict):
    """
    Upsert سريع بصيغة إكسترا:
    - mainItem/mainCode/mainName
    - subItems: [{cardGuide, cardCode, productName, quantity, priceRatio, unit}]
    """
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="يتوقع JSON")
    main_item = str(body.get("mainItem") or "").strip()
    if not main_item:
        raise HTTPException(status_code=400, detail="mainItem مطلوب")
    sub_items = body.get("subItems") or []
    if not isinstance(sub_items, list):
        sub_items = []
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        main_code = str(body.get("mainCode") or "").strip() or None
        main_name = str(body.get("mainName") or "").strip() or None
        if main_name:
            cursor.execute("UPDATE TBL007 SET ProductName = ? WHERE CardGuide = CAST(? AS uniqueidentifier)", (main_name, main_item))
            if cursor.rowcount == 0:
                cursor.execute(
                    "INSERT INTO TBL007 (CardGuide, CardCode, ProductName, StockProduct, ProductType, NotActive) VALUES (CAST(? AS uniqueidentifier), ?, ?, 1, 0, 0)",
                    (main_item, main_code, main_name),
                )
        bom = _bom_table_cols(cursor)
        if not bom:
            raise HTTPException(status_code=500, detail="لا يوجد جدول BOM متوافق (TBL063/TBL062)")
        cursor.execute(f"DELETE FROM dbo.[{bom['table']}] WHERE [{bom['main']}] = CAST(? AS uniqueidentifier)", (main_item,))
        links = 0
        for s in sub_items:
            if not isinstance(s, dict):
                continue
            sg = str(s.get("cardGuide") or "").strip()
            if not sg:
                continue
            scode = str(s.get("cardCode") or "").strip() or None
            sname = str(s.get("productName") or "").strip() or None
            if sname:
                cursor.execute("UPDATE TBL007 SET ProductName = ? WHERE CardGuide = CAST(? AS uniqueidentifier)", (sname, sg))
                if cursor.rowcount == 0:
                    cursor.execute(
                        "INSERT INTO TBL007 (CardGuide, CardCode, ProductName, StockProduct, ProductType, NotActive) VALUES (CAST(? AS uniqueidentifier), ?, ?, 1, 1, 0)",
                        (sg, scode, sname),
                    )
            qty = float(s.get("quantity") or 0)
            if qty <= 0:
                continue
            price_ratio = float(s.get("priceRatio") or 0)
            try:
                unit_no = int(float(s.get("unit") or 1))
            except Exception:
                unit_no = 1
            cols = [bom["item"], bom["main"], bom["qty"]]
            vals = [sg, main_item, qty]
            if bom.get("unit"):
                cols.append(bom["unit"]); vals.append(unit_no)
            if bom.get("price"):
                cols.append(bom["price"]); vals.append(price_ratio)
            col_sql = ", ".join(f"[{c}]" for c in cols)
            ph = ", ".join("CAST(? AS uniqueidentifier)" if c in (bom["item"], bom["main"]) else "?" for c in cols)
            cursor.execute(f"INSERT INTO dbo.[{bom['table']}] ({col_sql}) VALUES ({ph})", tuple(vals))
            links += 1
        conn.commit()
        return {"ok": True, "mainItem": main_item, "componentsWritten": links}
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


@app.get("/api/products/{card_guide}/image")
def get_product_image(card_guide: str, request: Request):
    """إرجاع صورة الصنف من ملف محلي إن وُجد، وإلا من TBL007.CardImage.
    يدعم ETag وCache-Control.
    """
    try:
        fp, ctype_hint = _find_product_image_file(card_guide)
        if fp:
            with open(fp, "rb") as f:
                data = f.read()
            import hashlib
            etag = 'W/"' + hashlib.sha1(data).hexdigest() + '"'
            inm = request.headers.get("if-none-match") or request.headers.get("If-None-Match")
            if inm and inm == etag:
                return Response(status_code=304)
            headers = {"Cache-Control": "public, max-age=3600", "ETag": etag}
            return Response(content=data, media_type=ctype_hint or "application/octet-stream", headers=headers)

        conn = get_connection()
        if not conn:
            raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
        cursor = conn.cursor()
        _ensure_menu_tables(cursor)
        cursor.execute("SELECT TOP 1 CardImage FROM TBL007 WHERE CardGuide = CAST(? AS uniqueidentifier)", card_guide)
        row = cursor.fetchone()
        if not row or row[0] is None:
            raise HTTPException(status_code=404, detail="لا توجد صورة لهذا الصنف")
        blob = row[0]
        try:
            data = bytes(blob)
        except Exception:
            data = blob

        # ETag
        import hashlib
        etag = 'W/"' + hashlib.sha1(data).hexdigest() + '"'
        inm = request.headers.get("if-none-match") or request.headers.get("If-None-Match")
        if inm and inm == etag:
            return Response(status_code=304)

        # Sniff content type
        ctype = "application/octet-stream"
        if data.startswith(b"\xFF\xD8\xFF"):
            ctype = "image/jpeg"
        elif data.startswith(b"\x89PNG\r\n\x1a\n"):
            ctype = "image/png"
        elif data.startswith(b"GIF8"):
            ctype = "image/gif"
        elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            ctype = "image/webp"

        headers = {"Cache-Control": "public, max-age=3600", "ETag": etag}
        return Response(content=data, media_type=ctype, headers=headers)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            conn  # may be undefined if file path existed
        except NameError:
            return
        try:
            if conn:
                conn.close()
        except Exception:
            pass

@app.post("/api/products/{card_guide}/image")
async def upload_product_image(card_guide: str, file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="ملف فارغ")
    ext, _ctype = _guess_image_ext(data)
    d = _product_images_dir()
    gid = str(card_guide).upper()
    for ext_old in ("jpg", "jpeg", "png", "gif", "webp", "bin"):
        p_old = os.path.join(d, f"{gid}.{ext_old}")
        if os.path.exists(p_old):
            try:
                os.remove(p_old)
            except Exception:
                pass
    p = os.path.join(d, f"{gid}.{ext}")
    with open(p, "wb") as f:
        f.write(data)
    image_url = f"/api/products/{gid}/image"
    _product_images_manifest_set(gid, image_url)
    conn = get_connection()
    if conn:
        try:
            cur = conn.cursor()
            _ensure_menu_tables(cur)
            cur.execute("UPDATE TBL007 SET ProductImageUrl = ? WHERE CardGuide = CAST(? AS uniqueidentifier)", (image_url, gid))
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
        finally:
            try:
                conn.close()
            except Exception:
                pass
    return {"ok": True, "image": image_url, "imageUrl": image_url}


@app.get("/api/products/image-manifest")
def product_image_manifest_get():
    return _product_images_manifest_load()


@app.post("/api/products/{card_guide}/image-link")
def product_image_link_set(card_guide: str, body: dict):
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="يتوقع JSON")
    image_url = str(body.get("imageUrl") or body.get("image") or "").strip()
    if not image_url:
        raise HTTPException(status_code=400, detail="imageUrl مطلوب")
    gid = str(card_guide).upper()
    _product_images_manifest_set(gid, image_url)
    conn = get_connection()
    if not conn:
        return {"ok": True, "imageUrl": image_url, "dbUpdated": False}
    try:
        cur = conn.cursor()
        _ensure_menu_tables(cur)
        cur.execute("UPDATE TBL007 SET ProductImageUrl = ? WHERE CardGuide = CAST(? AS uniqueidentifier)", (image_url, gid))
        conn.commit()
        return {"ok": True, "imageUrl": image_url, "dbUpdated": True}
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


@app.post("/api/products/image-manifest/sync-to-db")
def product_image_manifest_sync_to_db():
    m = _product_images_manifest_load()
    imgs = m.get("images")
    if not isinstance(imgs, dict):
        return {"ok": True, "updated": 0}
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    updated = 0
    try:
        cur = conn.cursor()
        _ensure_menu_tables(cur)
        for gid, rec in imgs.items():
            if not isinstance(rec, dict):
                continue
            image_url = str(rec.get("image") or "").strip()
            if not image_url:
                continue
            cur.execute("UPDATE TBL007 SET ProductImageUrl = ? WHERE CardGuide = CAST(? AS uniqueidentifier)", (image_url, str(gid).upper()))
            updated += 1
        conn.commit()
        return {"ok": True, "updated": updated}
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


@app.post("/api/menu/bootstrap")
def menu_bootstrap():
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cur = conn.cursor()
        _ensure_menu_tables(cur)
        conn.commit()
        return {"ok": True, "message": "تم التأكد من جداول المنيو TBL006/TBL007 وحقول الصور."}
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

# ========== Product Groups ==========
@app.get("/api/product-groups")
def get_product_groups():
    """الحصول على مجموعات المنتجات من TBL006"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        _ensure_menu_tables(cursor)
        query = """
        SELECT
            g.CardGuide,
            g.MainGuide,
            g.LatinName,
            g.GroupName,
            g.GroupImageUrl,
            s.ProductGuide,
            s.ProductImageUrl
        FROM TBL006 g
        OUTER APPLY (
            SELECT TOP 1
                p.CardGuide AS ProductGuide,
                p.ProductImageUrl
            FROM TBL007 p
            WHERE p.GroupGuid = g.CardGuide AND p.NotActive = 0
            ORDER BY
                CASE WHEN p.ProductImageUrl IS NULL OR LTRIM(RTRIM(p.ProductImageUrl)) = '' THEN 1 ELSE 0 END,
                p.ProductName
        ) s
        WHERE g.GroupName IS NOT NULL
        ORDER BY g.GroupName
        """
        cursor.execute(query)
        
        groups = []
        for row in cursor.fetchall():
            gid = str(row[0])
            img_manifest = _group_images_manifest_get(gid)
            img_db = str(row[4]) if len(row) > 4 and row[4] else None
            groups.append({
                "CardGuide": gid,
                "MainGuide": str(row[1]).upper() if len(row) > 1 and row[1] else "",
                "LatinName": row[2] or "",
                "GroupName": row[3],
                "image": f"/api/product-groups/{gid}/image",
                "imageUrl": img_manifest or img_db or f"/api/product-groups/{gid}/image-auto",
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
        _ensure_menu_tables(cursor)
        g = str(uuid.uuid4()).upper()
        image_url = str(body.get("imageUrl") or body.get("GroupImageUrl") or "").strip() or None
        cursor.execute("INSERT INTO TBL006 (CardGuide, GroupName, GroupImageUrl) VALUES (?, ?, ?)", (g, name, image_url))
        conn.commit()
        if image_url:
            _group_images_manifest_set(g, image_url)
        return {"success": True, "CardGuide": g, "GroupName": name, "imageUrl": image_url}
    except Exception as e:
        if conn: conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            if conn: conn.close()
        except Exception: pass


@app.get("/api/product-groups/{group_guide}/image")
def get_product_group_image(group_guide: str, request: Request):
    try:
        fp, ctype_hint = _find_group_image_file(group_guide)
        if fp:
            with open(fp, "rb") as f:
                data = f.read()
            import hashlib
            etag = 'W/"' + hashlib.sha1(data).hexdigest() + '"'
            inm = request.headers.get("if-none-match") or request.headers.get("If-None-Match")
            if inm and inm == etag:
                return Response(status_code=304)
            headers = {"Cache-Control": "public, max-age=3600", "ETag": etag}
            return Response(content=data, media_type=ctype_hint or "application/octet-stream", headers=headers)
        conn = get_connection()
        if not conn:
            raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
        cur = conn.cursor()
        _ensure_menu_tables(cur)
        cur.execute("SELECT TOP 1 CardImage FROM TBL006 WHERE CardGuide = CAST(? AS uniqueidentifier)", group_guide)
        row = cur.fetchone()
        if not row or row[0] is None:
            raise HTTPException(status_code=404, detail="لا توجد صورة لهذه المجموعة")
        blob = row[0]
        try:
            data = bytes(blob)
        except Exception:
            data = blob
        import hashlib
        etag = 'W/"' + hashlib.sha1(data).hexdigest() + '"'
        inm = request.headers.get("if-none-match") or request.headers.get("If-None-Match")
        if inm and inm == etag:
            return Response(status_code=304)
        ctype = "application/octet-stream"
        if data.startswith(b"\xFF\xD8\xFF"):
            ctype = "image/jpeg"
        elif data.startswith(b"\x89PNG\r\n\x1a\n"):
            ctype = "image/png"
        elif data.startswith(b"GIF8"):
            ctype = "image/gif"
        elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            ctype = "image/webp"
        headers = {"Cache-Control": "public, max-age=3600", "ETag": etag}
        return Response(content=data, media_type=ctype, headers=headers)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            conn
        except NameError:
            return
        try:
            if conn:
                conn.close()
        except Exception:
            pass


@app.get("/api/product-groups/{group_guide}/image-auto")
def get_product_group_image_auto(group_guide: str, request: Request):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cur = conn.cursor()
        _ensure_menu_tables(cur)
        cur.execute("SELECT TOP 1 GroupName FROM TBL006 WHERE CardGuide = CAST(? AS uniqueidentifier)", group_guide)
        row = cur.fetchone()
        nm = str(row[0]) if row and row[0] else "Group"
        data = _auto_group_svg(nm)
        import hashlib
        etag = 'W/"' + hashlib.sha1(data).hexdigest() + '"'
        inm = request.headers.get("if-none-match") or request.headers.get("If-None-Match")
        if inm and inm == etag:
            return Response(status_code=304)
        return Response(content=data, media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=3600", "ETag": etag})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.post("/api/product-groups/{group_guide}/image")
async def upload_product_group_image(group_guide: str, file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="ملف فارغ")
    ext, _ctype = _guess_image_ext(data)
    d = _group_images_dir()
    gid = str(group_guide).upper()
    for ext_old in ("jpg", "jpeg", "png", "gif", "webp", "bin"):
        p_old = os.path.join(d, f"{gid}.{ext_old}")
        if os.path.exists(p_old):
            try:
                os.remove(p_old)
            except Exception:
                pass
    p = os.path.join(d, f"{gid}.{ext}")
    with open(p, "wb") as f:
        f.write(data)
    image_url = f"/api/product-groups/{gid}/image"
    _group_images_manifest_set(gid, image_url)
    conn = get_connection()
    if conn:
        try:
            cur = conn.cursor()
            _ensure_menu_tables(cur)
            cur.execute("UPDATE TBL006 SET GroupImageUrl = ? WHERE CardGuide = CAST(? AS uniqueidentifier)", (image_url, gid))
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
        finally:
            try:
                conn.close()
            except Exception:
                pass
    return {"ok": True, "image": image_url, "imageUrl": image_url}


@app.get("/api/product-groups/image-manifest")
def product_group_image_manifest_get():
    return _group_images_manifest_load()


@app.post("/api/product-groups/{group_guide}/image-link")
def product_group_image_link_set(group_guide: str, body: dict):
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="يتوقع JSON")
    image_url = str(body.get("imageUrl") or body.get("image") or "").strip()
    if not image_url:
        raise HTTPException(status_code=400, detail="imageUrl مطلوب")
    gid = str(group_guide).upper()
    _group_images_manifest_set(gid, image_url)
    conn = get_connection()
    if not conn:
        return {"ok": True, "imageUrl": image_url, "dbUpdated": False}
    try:
        cur = conn.cursor()
        _ensure_menu_tables(cur)
        cur.execute("UPDATE TBL006 SET GroupImageUrl = ? WHERE CardGuide = CAST(? AS uniqueidentifier)", (image_url, gid))
        conn.commit()
        return {"ok": True, "imageUrl": image_url, "dbUpdated": True}
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


@app.post("/api/product-groups/image-manifest/sync-to-db")
def product_group_image_manifest_sync_to_db():
    m = _group_images_manifest_load()
    imgs = m.get("images")
    if not isinstance(imgs, dict):
        return {"ok": True, "updated": 0}
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    updated = 0
    try:
        cur = conn.cursor()
        _ensure_menu_tables(cur)
        for gid, rec in imgs.items():
            if not isinstance(rec, dict):
                continue
            image_url = str(rec.get("image") or "").strip()
            if not image_url:
                continue
            cur.execute("UPDATE TBL006 SET GroupImageUrl = ? WHERE CardGuide = CAST(? AS uniqueidentifier)", (image_url, str(gid).upper()))
            updated += 1
        conn.commit()
        return {"ok": True, "updated": updated}
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

def _resolve_existing_usguide(cur, preferred: Optional[str]) -> Optional[str]:
    try:
        if preferred:
            cur.execute("SELECT TOP 1 UsGuide FROM TBL013 WHERE UsGuide = ?", preferred)
            r = cur.fetchone()
            if r and r[0]:
                return str(r[0])
    except Exception:
        pass
    try:
        cur.execute("SELECT TOP 1 UsGuide FROM TBL013 ORDER BY UsGuide")
        r = cur.fetchone()
        if r and r[0]:
            return str(r[0])
    except Exception:
        pass
    return None


def _upsert_cost_center_by_name(name: str, main_cost_center: Optional[str] = None, card_code: Optional[str] = None) -> Optional[str]:
    """Upsert to TBL005 with sensible defaults for a restaurant table cost center.
    Returns CardGuide (existing or newly created)."""
    name = (name or "").strip()
    if not name:
        return None
    conn = get_connection()
    if not conn:
        return None
    try:
        cur = conn.cursor()
        # Exists by CostCenter
        cur.execute("SELECT CardGuide FROM TBL005 WHERE CostCenter = ?", name)
        row = cur.fetchone()
        if row and row[0]:
            gid_existing = str(row[0])
            if main_cost_center:
                try:
                    cur.execute("UPDATE TBL005 SET MainCostCenter = ? WHERE CardGuide = ?", (main_cost_center, gid_existing))
                    conn.commit()
                except Exception:
                    pass
            return gid_existing

        # Prepare defaults
        card_guide = str(uuid.uuid4()).upper()
        not_active = 0
        # Derive a compact card code from name (e.g., "#101" -> "101")
        if card_code:
            code = str(card_code)
        else:
            try:
                code = re.sub(r"[^A-Za-z0-9]+", "", name)
            except Exception:
                code = name
        security = 0
        latin_name = None
        card_type = 0
        def_account = None
        def_account2 = None
        def_account3 = None
        parent_cost_center = main_cost_center
        default_value = 0.0
        int_value = 0
        notes = "Auto from floor_plan"
        card_image = None
        notes2 = notes3 = notes4 = notes5 = notes6 = notes7 = notes8 = notes9 = None
        used_in_hr = 0
        by_user = _resolve_existing_usguide(cur, MAT3AM_INITIAL_DEV_USER_ID) or MAT3AM_INITIAL_DEV_USER_ID
        by_group = None

        # Full insert with explicit columns (others left NULL)
        cur.execute(
            """
            INSERT INTO TBL005 (
                CardGuide, NotActive, CardCode, Security, CostCenter, LatinName, CardType,
                DefaultAccount, DefaultAccount2, DefaultAccount3, MainCostCenter,
                DefaultValue, IntValue, Notes, CardImage,
                CostCenterNotes2, CostCenterNotes3, CostCenterNotes4, CostCenterNotes5,
                CostCenterNotes6, CostCenterNotes7, CostCenterNotes8, CostCenterNotes9,
                UsedInHR, ByUser, ByGroup
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                card_guide, not_active, code, security, name, latin_name, card_type,
                def_account, def_account2, def_account3, parent_cost_center,
                default_value, int_value, notes, card_image,
                notes2, notes3, notes4, notes5,
                notes6, notes7, notes8, notes9,
                used_in_hr, by_user, by_group,
            ),
        )
        conn.commit()
        return card_guide
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass

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

def _tbl022_column_names_map(cursor) -> dict[str, str]:
    """اسم العمود الفعلي في TBL022: مفتاح lower() → الاسم كما في sys.columns (مطابقة StoreGuide دون حساسية لحالة الأحرف)."""
    m: dict[str, str] = {}
    try:
        cursor.execute(
            """
            SELECT c.name
            FROM sys.columns c
            INNER JOIN sys.tables t ON c.object_id = t.object_id
            INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE LOWER(t.name) = N'tbl022' AND LOWER(s.name) = N'dbo'
            """
        )
        for r in cursor.fetchall():
            if r and r[0]:
                n = str(r[0])
                m[n.lower()] = n
    except Exception:
        try:
            cursor.execute(
                "SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID(N'dbo.TBL022')"
            )
            for r in cursor.fetchall():
                if r and r[0]:
                    n = str(r[0])
                    m[n.lower()] = n
        except Exception:
            pass
    if not m:
        try:
            cursor.execute(
                """
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'TBL022'
                """
            )
            for r in cursor.fetchall():
                if r and r[0]:
                    n = str(r[0])
                    m[n.lower()] = n
        except Exception:
            pass
    return m


def _tbl022_column_names(cursor) -> set[str]:
    return set(_tbl022_column_names_map(cursor).values())


# TBL019 = طرق الدفع (PayTerm). FK_TBL022_TBL019 → TBL019.ID
# القيم الشائعة في إكسترا: -1 None | 1 Cash | 2 By Credit | 3 Bank Card | 4 Cheque
MAT3AM_TBL019_VALID_IDS = frozenset((-1, 1, 2, 3, 4))
# افتراض طلب التشغيل عند عدم المطابقة أو قيمة قديمة خاطئة (0، 5، …): By Credit
MAT3AM_INVOICE_TBL019_PAYTERM_ID = 2


def _mat3am_tbl022_parent_columns_fk_to_tbl019(cursor) -> list[str]:
    """أعمدة dbo.TBL022 التي يفرض FK (مثل FK_TBL022_TBL019) وجودها في dbo.TBL019.ID."""
    out: list[str] = []
    try:
        cursor.execute(
            """
            SELECT c.name
            FROM sys.foreign_keys AS f
            INNER JOIN sys.foreign_key_columns AS fc ON f.object_id = fc.constraint_object_id
            INNER JOIN sys.columns AS c
                ON fc.parent_object_id = c.object_id AND fc.parent_column_id = c.column_id
            INNER JOIN sys.tables AS tp ON f.parent_object_id = tp.object_id
            INNER JOIN sys.schemas AS sp ON tp.schema_id = sp.schema_id
            INNER JOIN sys.tables AS tr ON f.referenced_object_id = tr.object_id
            INNER JOIN sys.schemas AS sr ON tr.schema_id = sr.schema_id
            INNER JOIN sys.columns AS cr
                ON fc.referenced_object_id = cr.object_id AND fc.referenced_column_id = cr.column_id
            WHERE LOWER(tp.name) = N'tbl022' AND LOWER(sp.name) = N'dbo'
              AND LOWER(tr.name) = N'tbl019' AND LOWER(sr.name) = N'dbo'
              AND LOWER(cr.name) = N'id'
            """
        )
        for r in cursor.fetchall():
            if r and r[0]:
                out.append(str(r[0]))
    except Exception:
        pass
    return out


def _mat3am_coerce_int_id(v: object) -> Optional[int]:
    try:
        if v is None:
            return None
        return int(float(v))
    except Exception:
        return None


def _mat3am_apply_tbl022_fk_tbl019_columns(
    cursor, cols: list[str], vals: list, tbl022_m: dict[str, str]
) -> None:
    """
    أعمدة TBL022 المربوطة بـ TBL019.ID: إن كانت القيمة غير موجودة في TBL019 (مثل 0 من خريطة قديمة)
    نستبدلها بـ MAT3AM_INVOICE_TBL019_PAYTERM_ID؛ وإن كان العمود غير مُدرَج نُضيفه.
    """
    fk_parents = _mat3am_tbl022_parent_columns_fk_to_tbl019(cursor)
    if not fk_parents:
        return
    for raw in fk_parents:
        low = raw.lower()
        actual = tbl022_m.get(low, raw)
        idx = next((i for i, c in enumerate(cols) if c.lower() == low), -1)
        if idx >= 0:
            cv = _mat3am_coerce_int_id(vals[idx])
            if cv is None or cv not in MAT3AM_TBL019_VALID_IDS:
                vals[idx] = MAT3AM_INVOICE_TBL019_PAYTERM_ID
            continue
        if low not in tbl022_m:
            continue
        cols.append(actual)
        vals.append(MAT3AM_INVOICE_TBL019_PAYTERM_ID)


def _tbl008_column_names_map(cursor) -> dict[str, str]:
    """مثل TBL022: dbo.TBL008 — يصلح حالات فشل OBJECT_ID(N'dbo.TBL008')."""
    m: dict[str, str] = {}
    try:
        cursor.execute(
            """
            SELECT c.name
            FROM sys.columns c
            INNER JOIN sys.tables t ON c.object_id = t.object_id
            INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE LOWER(t.name) = N'tbl008' AND LOWER(s.name) = N'dbo'
            """
        )
        for r in cursor.fetchall():
            if r and r[0]:
                n = str(r[0])
                m[n.lower()] = n
    except Exception:
        pass
    if not m:
        try:
            cursor.execute(
                "SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID(N'dbo.TBL008')"
            )
            for r in cursor.fetchall():
                if r and r[0]:
                    n = str(r[0])
                    m[n.lower()] = n
        except Exception:
            pass
    if not m:
        try:
            cursor.execute(
                """
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'TBL008'
                """
            )
            for r in cursor.fetchall():
                if r and r[0]:
                    n = str(r[0])
                    m[n.lower()] = n
        except Exception:
            pass
    return m


def _tbl008_column_names(cursor) -> set[str]:
    return set(_tbl008_column_names_map(cursor).values())


def _mat3am_get_or_create_default_store_guid(cursor) -> str:
    """مستودع افتراضي لـ TBL022.StoreGuide: أول صف في TBL008 أو إدراج بنفس آلية إكسترا."""
    try:
        cursor.execute(
            "SELECT TOP (1) CardGuide FROM dbo.TBL008 ORDER BY CardGuide"
        )
        row = cursor.fetchone()
        if row and row[0]:
            return _mat3am_guid_sql_param(row[0])
    except Exception:
        pass
    c8 = _tbl008_column_names(cursor)
    full = {"CardGuide", "CardCode", "Security", "WarehouseName", "LatinName", "NotActive"}
    if full.issubset(c8):
        try:
            cursor.execute(
                """
                INSERT INTO dbo.TBL008 (CardGuide, CardCode, Security, WarehouseName, LatinName, NotActive)
                VALUES (
                    NEWID(),
                    (SELECT ISNULL(MAX(x.CardCode), 0) + 1 FROM dbo.TBL008 AS x),
                    1,
                    N'مطاعم — مستودع افتراضي',
                    N'MAT3AM Default Warehouse',
                    0
                )
                """
            )
            cursor.execute(
                "SELECT TOP (1) CardGuide FROM dbo.TBL008 ORDER BY CardGuide DESC"
            )
            row = cursor.fetchone()
            if row and row[0]:
                return _mat3am_guid_sql_param(row[0])
        except Exception:
            pass
    if {"CardGuide", "WarehouseName"}.issubset(c8):
        g = str(uuid.uuid4()).upper()
        try:
            ln = "LatinName" in c8
            if ln:
                cursor.execute(
                    "INSERT INTO dbo.TBL008 (CardGuide, WarehouseName, LatinName) VALUES (?, ?, ?)",
                    (g, "مطاعم — مستودع افتراضي", "MAT3AM Default Warehouse"),
                )
            else:
                cursor.execute(
                    "INSERT INTO dbo.TBL008 (CardGuide, WarehouseName) VALUES (?, ?)",
                    (g, "مطاعم — مستودع افتراضي"),
                )
            return _mat3am_guid_sql_param(g)
        except Exception:
            pass
    raise RuntimeError(
        "تعذر إنشاء أو جلب مستودع (TBL008) — عمود StoreGuide في TBL022 إلزامي."
    )


def _mat3am_tbl008_cardguide_by_warehouse_name(cursor, warehouse_name: str) -> Optional[str]:
    try:
        cursor.execute(
            "SELECT TOP (1) CardGuide FROM dbo.TBL008 WHERE WarehouseName = ?",
            (warehouse_name,),
        )
        row = cursor.fetchone()
        if row and row[0]:
            return _mat3am_guid_sql_param(row[0])
    except Exception:
        pass
    return None


def _mat3am_insert_tbl008_row_for_name(cursor, warehouse_name_ar: str, latin_name: str) -> str:
    """إدراج صف في TBL008 بعدة استراتيجيات SQL (OUTPUT INSERTED) مع أخطاء مجمّعة إن فشل الكل."""
    cmap = _tbl008_column_names_map(cursor)
    c8 = set(cmap.values())
    if not c8:
        raise RuntimeError("TBL008: لا تُقرأ أعمدة الجدول — تحقق من dbo.TBL008 في القاعدة المتصلة.")

    errs: list[str] = []

    def _col(*candidates: str) -> Optional[str]:
        for c in candidates:
            if c in c8:
                return c
            low = c.lower()
            if low in cmap:
                return cmap[low]
        return None

    cg = _col("CardGuide")
    wn = _col("WarehouseName")
    ln = _col("LatinName")
    cc = _col("CardCode")
    sec = _col("Security")
    na = _col("NotActive")

    def _try_output(label: str, sql: str, params: tuple) -> Optional[str]:
        try:
            cursor.execute(sql, params)
            row = cursor.fetchone()
            if row and row[0]:
                return _mat3am_guid_sql_param(row[0])
        except Exception as e:
            errs.append(f"{label}: {e}")
        return None

    if all((cg, cc, sec, wn, ln, na)):
        sql_tc = f"""
        INSERT INTO dbo.TBL008 ([{cg}], [{cc}], [{sec}], [{wn}], [{ln}], [{na}])
        OUTPUT INSERTED.[{cg}]
        VALUES (
            NEWID(),
            (SELECT COALESCE(MAX(TRY_CAST(x.[{cc}] AS INT)), 0) + 1 FROM dbo.TBL008 AS x),
            1, ?, ?, 0
        )
        """
        got = _try_output("tbl008_try_cast", sql_tc, (warehouse_name_ar, latin_name))
        if got:
            return got
        sql_mx = f"""
        INSERT INTO dbo.TBL008 ([{cg}], [{cc}], [{sec}], [{wn}], [{ln}], [{na}])
        OUTPUT INSERTED.[{cg}]
        VALUES (
            NEWID(),
            (SELECT ISNULL(MAX(x.[{cc}]), 0) + 1 FROM dbo.TBL008 AS x),
            1, ?, ?, 0
        )
        """
        got = _try_output("tbl008_max_cardcode", sql_mx, (warehouse_name_ar, latin_name))
        if got:
            return got

    if cg and wn and ln:
        sql3 = f"""
        INSERT INTO dbo.TBL008 ([{cg}], [{wn}], [{ln}])
        OUTPUT INSERTED.[{cg}]
        VALUES (NEWID(), ?, ?)
        """
        got = _try_output("tbl008_min3", sql3, (warehouse_name_ar, latin_name))
        if got:
            return got
    if cg and wn:
        sql2 = f"""
        INSERT INTO dbo.TBL008 ([{cg}], [{wn}])
        OUTPUT INSERTED.[{cg}]
        VALUES (NEWID(), ?)
        """
        got = _try_output("tbl008_min2", sql2, (warehouse_name_ar,))
        if got:
            return got

    g = str(uuid.uuid4()).upper()
    cols: list[str] = []
    vals: list = []
    if cg:
        cols.append(cg)
        vals.append(g)
    if wn:
        cols.append(wn)
        vals.append(warehouse_name_ar)
    if ln:
        cols.append(ln)
        vals.append(latin_name)
    if sec:
        cols.append(sec)
        vals.append(1)
    if na:
        cols.append(na)
        vals.append(0)
    if cc and cc not in cols:
        try:
            cursor.execute(f"SELECT ISNULL(MAX(CAST([{cc}] AS FLOAT)), 0) FROM dbo.TBL008")
            mx = cursor.fetchone()
            nxt = int(float(mx[0] or 0)) + 1 if mx else 1
        except Exception:
            nxt = 1
        cols.append(cc)
        vals.append(nxt)
    if len(cols) < 2:
        raise RuntimeError("TBL008 لا يحتوي أعمدة كافية لإدراج مستودع. " + " | ".join(errs[-3:]))
    ph = ", ".join(["?"] * len(vals))
    try:
        cursor.execute(f"INSERT INTO dbo.TBL008 ({', '.join('[' + c + ']' for c in cols)}) VALUES ({ph})", tuple(vals))
        return _mat3am_guid_sql_param(g)
    except Exception as e:
        errs.append(f"dynamic_bind: {e}")
    raise RuntimeError("فشل إدراج TBL008 بعد كل المحاولات: " + " | ".join(errs[-6:]))


def _mat3am_ensure_warehouse_row(cursor, warehouse_name_ar: str, latin_name: str) -> str:
    """يضمن وجود صف TBL008 بالاسم المعرّف (كما في التهيئة) ويعيد CardGuide."""
    found = _mat3am_tbl008_cardguide_by_warehouse_name(cursor, warehouse_name_ar)
    if found:
        return found
    return _mat3am_insert_tbl008_row_for_name(cursor, warehouse_name_ar, latin_name)


def _mat3am_order_kind_for_invoice_type_guid(cursor, tbl020_card_guide: str) -> Optional[str]:
    try:
        cursor.execute(
            """
            SELECT OrderKind FROM dbo.MAT3AM_RESTAURANT_INVOICE_TYPES
            WHERE Tbl020CardGuide = CAST(? AS uniqueidentifier)
            """,
            (_mat3am_guid_sql_param(tbl020_card_guide),),
        )
        row = cursor.fetchone()
        if row and row[0]:
            return str(row[0]).strip()
    except Exception:
        pass
    return None


def _mat3am_store_guid_for_invoice_main_guide(cursor, invoice_type_guid: str) -> str:
    """
    TBL022.StoreGuide: نفس منطق التوحيد مع نمط الفاتورة —
    SELECT CardGuide FROM dbo.TBL008 WHERE WarehouseName = اسم النمط (MAT3AM_ORDERKIND_INVOICE_DISPLAY_AR).
    ثم خريطة MAT3AM_RESTAURANT_STORES، ثم إنشاء الصف إن لم يوجد، ثم احتياطي افتراضي.
    """
    kind = _mat3am_order_kind_for_invoice_type_guid(cursor, invoice_type_guid)
    if not kind:
        kind = "table"
    wn = MAT3AM_ORDERKIND_INVOICE_DISPLAY_AR.get(kind)
    lat = MAT3AM_ORDERKIND_INVOICE_DISPLAY_LATIN.get(kind, "MAT3AM Store")
    if wn:
        try:
            cursor.execute(
                "SELECT TOP (1) CardGuide FROM dbo.TBL008 WHERE WarehouseName = ?",
                (wn,),
            )
            row = cursor.fetchone()
            if row and row[0]:
                return _mat3am_guid_sql_param(row[0])
        except Exception:
            pass
    try:
        cursor.execute(
            "SELECT Tbl008CardGuide FROM dbo.MAT3AM_RESTAURANT_STORES WHERE OrderKind = ?",
            (kind,),
        )
        row = cursor.fetchone()
        if row and row[0]:
            return _mat3am_guid_sql_param(row[0])
    except Exception:
        pass
    if wn:
        return _mat3am_ensure_warehouse_row(cursor, wn, lat)
    return _mat3am_get_or_create_default_store_guid(cursor)


def _seed_mat3am_restaurant_stores(cursor) -> dict:
    """تهيئة: صفوف TBL008 بنفس أسماء أنماط TBL020 (WarehouseName = InvoiceName) + MAT3AM_RESTAURANT_STORES."""
    out: dict = {"ok": True, "created": [], "skipped": [], "errors": [], "note": None}
    for kind, wn, lat, _tag in _mat3am_restaurant_kind_seed_specs():
        if not wn:
            continue
        try:
            guid = _mat3am_ensure_warehouse_row(cursor, wn, lat)
            try:
                cursor.execute(
                    "SELECT 1 FROM dbo.MAT3AM_RESTAURANT_STORES WHERE OrderKind = ?",
                    (kind,),
                )
                existed = cursor.fetchone() is not None
                if existed:
                    cursor.execute(
                        """
                        UPDATE dbo.MAT3AM_RESTAURANT_STORES
                        SET Tbl008CardGuide = CAST(? AS uniqueidentifier), WarehouseDisplayName = ?
                        WHERE OrderKind = ?
                        """,
                        (guid, wn, kind),
                    )
                    out["skipped"].append(kind)
                else:
                    cursor.execute(
                        """
                        INSERT INTO dbo.MAT3AM_RESTAURANT_STORES (OrderKind, Tbl008CardGuide, WarehouseDisplayName)
                        VALUES (?, CAST(? AS uniqueidentifier), ?)
                        """,
                        (kind, guid, wn),
                    )
                    out["created"].append({"orderKind": kind, "tbl008CardGuide": guid, "warehouseName": wn})
            except Exception as ex:
                out["errors"].append({"orderKind": kind, "detail": str(ex)})
                out["ok"] = False
            try:
                cursor.connection.commit()
            except Exception:
                pass
        except Exception as ex:
            out["errors"].append({"orderKind": kind, "detail": str(ex)})
            out["ok"] = False
            out["note"] = str(ex)
            try:
                cursor.connection.commit()
            except Exception:
                pass
    try:
        cursor.execute(
            "SELECT COUNT(*) FROM dbo.TBL008 WHERE WarehouseName LIKE N'مطاعم —%'"
        )
        out["tbl008Mat3amNameRows"] = int((cursor.fetchone() or [0])[0] or 0)
    except Exception:
        out["tbl008Mat3amNameRows"] = None
    return out


def _parse_invoice_header_datetime(s: Optional[str]) -> datetime:
    """قبول تاريخ/وقت بصيغ متعددة؛ إن وُجد التاريخ فقط يُدمَج وقت اليوم الحالي (تفادي منتصف الليل الخاطئ)."""
    raw = (s or "").strip()
    if not raw:
        return datetime.now()
    fmts_dt = (
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
    )
    fmts_date_only = ("%d-%m-%Y", "%Y-%m-%d")
    for fmt in fmts_dt:
        try:
            return datetime.strptime(raw[:29], fmt)
        except ValueError:
            continue
    for fmt in fmts_date_only:
        try:
            d0 = datetime.strptime(raw[:10], fmt)
            n = datetime.now()
            return d0.replace(hour=n.hour, minute=n.minute, second=n.second, microsecond=n.microsecond)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        pass
    return datetime.now()


def _mat3am_currency_guid_from_settings(cursor, ms: dict) -> Optional[str]:
    """Guid صريح من الإعدادات إن وُجد وصالح في TBL001."""
    g = (ms.get("defaultCurrencyGuid") or ms.get("currencyGuide") or "").strip()
    if not g:
        return None
    try:
        cursor.execute(
            "SELECT 1 FROM dbo.TBL001 WHERE CardGuide = CAST(? AS uniqueidentifier)",
            (_mat3am_guid_sql_param(g),),
        )
        if cursor.fetchone():
            return _mat3am_guid_sql_param(g)
    except Exception:
        pass
    return None


def _mat3am_default_egp_currency_guid(cursor) -> Optional[str]:
    """TBL022.CurrencyGuide: جنيه مصري + LatinName يوافق Egypt Pound أو EGP (كما في إكسترا)."""
    try:
        cursor.execute(
            """
            SELECT TOP (1) CardGuide FROM dbo.TBL001
            WHERE CurrencyName IN (N'جنيه مصري', N'جنية مصرى')
              AND (
                    UPPER(LTRIM(RTRIM(ISNULL(LatinName, N'')))) = N'EGYPT POUND'
                 OR UPPER(LTRIM(RTRIM(ISNULL(LatinName, N'')))) LIKE N'%EGP%'
                  )
            ORDER BY CurrencyName
            """
        )
        row = cursor.fetchone()
        if row and row[0]:
            return _mat3am_guid_sql_param(row[0])
    except Exception:
        pass
    try:
        cursor.execute(
            """
            SELECT TOP (1) CardGuide FROM dbo.TBL001
            WHERE CurrencyName IN (N'جنيه مصري', N'جنية مصرى')
            ORDER BY CurrencyName
            """
        )
        row = cursor.fetchone()
        if row and row[0]:
            return _mat3am_guid_sql_param(row[0])
    except Exception:
        pass
    return None


def _mat3am_default_currency_guid_for_invoice(cursor) -> str:
    """عملة افتراضية لـ TBL022.CurrencyGuide: إعدادات mat3am ثم جنيه مصري/EGP ثم تفضيل أسماء ثم مطابقة جزئية ثم TOP 1 من TBL001 ثم فاتورة سابقة."""
    ms = _load_mat3am_settings()
    cg = _mat3am_currency_guid_from_settings(cursor, ms)
    if cg:
        return cg
    cg = _mat3am_default_egp_currency_guid(cursor)
    if cg:
        return cg
    preferred = ms.get("currencyPreferredNames")
    if not isinstance(preferred, list):
        preferred = ["جنيه مصري", "جنية مصرى"]
    for name in preferred:
        n = (name or "").strip()
        if not n:
            continue
        try:
            cursor.execute(
                "SELECT TOP (1) CardGuide FROM dbo.TBL001 WHERE CurrencyName = ?",
                (n,),
            )
            row = cursor.fetchone()
            if row and row[0]:
                return _mat3am_guid_sql_param(row[0])
        except Exception:
            pass
    contains = ms.get("currencyNameContains")
    if not isinstance(contains, list):
        contains = ["جنيه", "egp", "egp ", "ج.م"]
    for sub in contains:
        s = (sub or "").strip()
        if not s:
            continue
        pat = f"%{s}%"
        try:
            cursor.execute(
                """
                SELECT TOP (1) CardGuide FROM dbo.TBL001
                WHERE (CurrencyName LIKE ? OR LatinName LIKE ? OR CurrencyPartName LIKE ?)
                ORDER BY CurrencyName
                """,
                (pat, pat, pat),
            )
            row = cursor.fetchone()
            if row and row[0]:
                return _mat3am_guid_sql_param(row[0])
        except Exception:
            try:
                cursor.execute(
                    """
                    SELECT TOP (1) CardGuide FROM dbo.TBL001
                    WHERE (CurrencyName LIKE ? OR LatinName LIKE ?)
                    ORDER BY CurrencyName
                    """,
                    (pat, pat),
                )
                row = cursor.fetchone()
                if row and row[0]:
                    return _mat3am_guid_sql_param(row[0])
            except Exception:
                pass
    try:
        cursor.execute(
            "SELECT TOP (1) CardGuide FROM dbo.TBL001 WHERE CurrencyName IS NOT NULL ORDER BY CurrencyName"
        )
        row = cursor.fetchone()
        if row and row[0]:
            return _mat3am_guid_sql_param(row[0])
    except Exception:
        pass
    try:
        cursor.execute(
            "SELECT TOP (1) CurrencyGuide FROM dbo.TBL022 WHERE CurrencyGuide IS NOT NULL"
        )
        row = cursor.fetchone()
        if row and row[0]:
            return _mat3am_guid_sql_param(row[0])
    except Exception:
        pass
    raise RuntimeError(
        "تعذر تحديد عملة افتراضية — أضف عملة في TBL001 أو عرّف mat3am.defaultCurrencyGuid في config/settings.json."
    )


def _mat3am_insert_tbl023_invoice_lines_xtra_style(
    cursor,
    main_guide: str,
    invoice: InvoiceHeader,
    source_bill_guid: Optional[str],
) -> None:
    """
    نفس بنية INSERT بنود الفاتورة في المصدر الأصلي:
    ``XTRA_WEB/backend/api_server.py`` → ``save_invoice`` (حوالي 1799–1831).

    الفرق الوحيد المطلوب لقواعد إكسترا الحديثة (مثل oya_Mohandessin): عمود ``Unit``
    في ``TBL023`` قد يكون ``tinyint``؛ المرجع الأصلي يمرّر ``item.Unit`` كنص، بينما
    عمود ``Unit`` يُمرَّر كـ ``tinyint`` عبر ``CAST`` بعد ``_mat3am_tbl023_unit_as_tinyint``.
    """
    for item in invoice.Items:
        unit_val = int(_mat3am_tbl023_unit_as_tinyint(item.Unit))
        if source_bill_guid:
            cursor.execute(
                """
                INSERT INTO TBL023
                (MainGuide, ProductGuide, Quantity, Unit, TotalValue, InsertedIn, RelatedAgent, SourceBill)
                VALUES (?, ?, ?, CAST(? AS tinyint), ?, ?, ?, ?)
                """,
                (
                    main_guide,
                    item.ProductGuide,
                    item.Quantity,
                    unit_val,
                    item.TotalValue,
                    datetime.now(),
                    invoice.AgentGuide,
                    source_bill_guid,
                ),
            )
        else:
            cursor.execute(
                """
                INSERT INTO TBL023
                (MainGuide, ProductGuide, Quantity, Unit, TotalValue, InsertedIn, RelatedAgent)
                VALUES (?, ?, ?, CAST(? AS tinyint), ?, ?, ?)
                """,
                (
                    main_guide,
                    item.ProductGuide,
                    item.Quantity,
                    unit_val,
                    item.TotalValue,
                    datetime.now(),
                    invoice.AgentGuide,
                ),
            )


# =============================================================================
# حفظ الفاتورة — مرجع التصميم الأساسي:
#   ``E:/XTRA_WEB/backend/api_server.py``  الدالة ``save_invoice`` (~1697–1848)
#
# توسيعات مطاعم (بعد مطابقة قاعدة العميل، وليست في الملف الأصلي):
#   - رأس TBL022 ديناميكي: StoreGuide, CurrencyGuide, DateValue01 عند وجود الأعمدة
#   - PayMethod يطابق TBL019.ID (جدول طرق الدفع) بسبب FK_TBL022_TBL019
#   - ``_mat3am_apply_tbl022_fk_tbl019_columns`` لأي عمود FK إضافي لـ TBL019
#   - بعد الـ commit: حركة مخزون MAT3AM_STOCK_MOVEMENT + ``_ensure_costing_and_stock_schema``
# =============================================================================
@app.post("/api/invoices")
def save_invoice(invoice: InvoiceHeader):
    """حفظ فاتورة جديدة في TBL022 و TBL023 (مرجع إكسترا + توسيعات مطاعم لقاعدة SQL الفعلية)"""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    
    try:
        cursor = conn.cursor()
        try:
            _ensure_costing_and_stock_schema(cursor)
        except Exception as _sch_e:
            print("[mat3am] save_invoice: تهيئة جداول المخزون (غير حرجة):", _sch_e)

        # إنشاء MainGuide جديد
        main_guide = str(uuid.uuid4()).upper()
        # CardGuide من نوع الفاتورة/الإيصال
        # إذا لم يتم تحديد InvoiceType، استخدم فاتورة الكترونية كافتراضي
        invoice_type = invoice.InvoiceType or FALLBACK_INVOICE_TYPE_GUID
        
        # حساب الإجمالي
        total_value = sum(item.TotalValue for item in invoice.Items)
        
        bill_date = _parse_invoice_header_datetime(invoice.BillDate)
        done_in = _parse_invoice_header_datetime(invoice.DoneIn)
        
        # المرجع الأصلي (XTRA_WEB/backend): خريطة 0..6 على PayMethod — لا تصلح مع FK → TBL019.ID
        # TBL019 عند العميل: 1 Cash, 2 By Credit, 3 Bank Card, 4 Cheque, -1 None
        payment_method_map = {
            "نقدي": 1,
            "دفع نقدي": 1,
            "بطاقات مصرفيه": 3,
            "بنك مصر": 3,
            "شيك": 4,
            "آجل": 2,
            "سوبر كاش": 1,
            "cash": 1,
            "card": 3,
            "digital": 3,
        }
        pm_key = (invoice.PaymentMethod or "").strip()
        pay_method = payment_method_map.get(
            pm_key,
            payment_method_map.get(pm_key.casefold(), MAT3AM_INVOICE_TBL019_PAYTERM_ID),
        )
        
        # الفاتورة المصدر (حافظة المرتبطة) للربط في TBL022 و TBL023
        source_bill_guid = invoice.SourceBill.strip() if invoice.SourceBill else None
        
        # حفظ رأس الفاتورة
        # TBL022.CardGuide = main_guide؛ TBL022.MainGuide = نوع الفاتورة من TBL020
        # StoreGuide / CurrencyGuide: إلزامي في بعض قواعد إكسترا — يُملآن تلقائياً
        tbl022_m = _tbl022_column_names_map(cursor)
        store_col = tbl022_m.get("storeguide")
        currency_col = tbl022_m.get("currencyguide")
        date_value_col = tbl022_m.get("datevalue01")

        store_gv: Optional[str] = None
        if store_col:
            sg_override = (invoice.StoreGuide or "").strip()
            if sg_override:
                try:
                    cursor.execute(
                        "SELECT 1 FROM dbo.TBL008 WHERE CardGuide = CAST(? AS uniqueidentifier)",
                        (_mat3am_guid_sql_param(sg_override),),
                    )
                    if cursor.fetchone():
                        store_gv = _mat3am_guid_sql_param(sg_override)
                except Exception:
                    store_gv = None
            if not store_gv:
                try:
                    store_gv = _mat3am_store_guid_for_invoice_main_guide(cursor, invoice_type)
                except Exception:
                    store_gv = None
            if not store_gv:
                store_gv = _mat3am_get_or_create_default_store_guid(cursor)

        cur_gv: Optional[str] = None
        if currency_col:
            cg_override = (invoice.CurrencyGuide or "").strip()
            if cg_override:
                try:
                    cursor.execute(
                        "SELECT 1 FROM dbo.TBL001 WHERE CardGuide = CAST(? AS uniqueidentifier)",
                        (_mat3am_guid_sql_param(cg_override),),
                    )
                    if cursor.fetchone():
                        cur_gv = _mat3am_guid_sql_param(cg_override)
                except Exception:
                    cur_gv = None
            if not cur_gv:
                try:
                    cur_gv = _mat3am_default_currency_guid_for_invoice(cursor)
                except Exception:
                    try:
                        cursor.execute(
                            "SELECT TOP (1) CardGuide FROM dbo.TBL001 WHERE CardGuide IS NOT NULL"
                        )
                        rr = cursor.fetchone()
                        if rr and rr[0]:
                            cur_gv = _mat3am_guid_sql_param(rr[0])
                    except Exception:
                        pass

        cols = ["CardGuide"]
        vals: list = [main_guide]
        if store_col and store_gv:
            cols.append(store_col)
            vals.append(store_gv)
        elif store_col and not store_gv:
            raise HTTPException(
                status_code=500,
                detail="عمود StoreGuide إلزامي ولم يُحلّ معرف المخزن — نفّذ POST /api/dev/bootstrap ثم تحقق من TBL008 وMAT3AM_RESTAURANT_STORES.",
            )
        if currency_col and cur_gv:
            cols.append(currency_col)
            vals.append(cur_gv)
        cols.extend(
            [
                "MainGuide",
                "BillNumber",
                "BillDate",
                "DoneIn",
                "AgentGuide",
                "Project",
                "CostCenter",
                "Notes",
                "Discount",
                "TaxValue",
                "LocalAdministrativeTax",
                "LockRelations",
                "InsertedIn",
                "Paid",
                "PayMethod",
            ]
        )
        vals.extend(
            [
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
            ]
        )
        if source_bill_guid:
            cols.append("SourceBill")
            vals.append(source_bill_guid)

        if date_value_col:
            cols.append(date_value_col)
            vals.append(bill_date)

        # FK إلى TBL019.ID — تصحيح 0/5/6 القديمة أو عمود إضافي غير مُدرَج
        _mat3am_apply_tbl022_fk_tbl019_columns(cursor, cols, vals, tbl022_m)

        colnames_sql = ", ".join(cols)
        placeholders = ", ".join(["?"] * len(vals))
        header_query = f"INSERT INTO TBL022 ({colnames_sql}) VALUES ({placeholders})"
        cursor.execute(header_query, tuple(vals))

        # بنود TBL023: مطابقة نص SQL للمرجع الأصلي (انظر ``_mat3am_insert_tbl023_invoice_lines_xtra_style``)
        _mat3am_insert_tbl023_invoice_lines_xtra_style(
            cursor, main_guide, invoice, source_bill_guid
        )

        # إتمام الفاتورة أولاً — حركة MAT3AM_STOCK_MOVEMENT لاحقاً ولا تُلغي الحفظ
        conn.commit()

        stock_movement_ok = True
        stock_movement_detail: Optional[str] = None
        try:
            sc = conn.cursor()
            try:
                _ensure_costing_and_stock_schema(sc)
            except Exception as _e2:
                print("[mat3am] stock schema before movement:", _e2)
            invoice_type_name = _get_invoice_type_name(sc, invoice_type)
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
                        cursor=sc,
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

                has_tbl062_components = False
                if item_product_guide:
                    bom_src = _bom_table_cols(sc)
                    try:
                        if bom_src:
                            unit_sel = f"[{bom_src['unit']}]" if bom_src.get("unit") else "NULL"
                            price_sel = f"[{bom_src['price']}]" if bom_src.get("price") else "0"
                            sc.execute(
                                f"""
                                SELECT [{bom_src['item']}], {unit_sel}, [{bom_src['qty']}], {price_sel}
                                FROM dbo.[{bom_src['table']}]
                                WHERE [{bom_src['main']}] = CAST(? AS uniqueidentifier)
                                """,
                                (item_product_guide,),
                            )
                            recipe_lines = sc.fetchall()
                        else:
                            recipe_lines = []
                    except Exception:
                        recipe_lines = []
                    for ln in recipe_lines:
                        comp_pg = str(ln[0]).strip() if ln and ln[0] else None
                        comp_unit = str(int(ln[1])) if ln and ln[1] is not None else "1"
                        comp_qty = float(ln[2] or 0) * qty
                        comp_unit_cost = float(ln[3] or 0)
                        if not comp_pg or comp_qty <= 0:
                            continue
                        has_tbl062_components = True
                        comp_name = "مكون"
                        try:
                            sc.execute(
                                "SELECT TOP 1 ProductName, AgentPrice FROM TBL007 WHERE CardGuide = CAST(? AS uniqueidentifier)",
                                (comp_pg,),
                            )
                            pr = sc.fetchone()
                            if pr:
                                comp_name = (pr[0] or "").strip() or comp_name
                                if comp_unit_cost <= 0:
                                    comp_unit_cost = float(pr[1] or 0)
                        except Exception:
                            pass
                        comp_total = comp_qty * comp_unit_cost
                        _insert_stock_movement(
                            cursor=sc,
                            movement_type="SALE_RECIPE_OUT",
                            reference_id=ref,
                            invoice_guid=main_guide,
                            invoice_type_guid=invoice_type,
                            product_guide=comp_pg,
                            item_name=comp_name,
                            qty_in=0,
                            qty_out=comp_qty,
                            unit_code=comp_unit,
                            unit_cost=comp_unit_cost,
                            total_cost=comp_total,
                            notes=f"خصم مشتقات TBL062 للصنف {item_name}",
                        )
                if not has_tbl062_components:
                    _insert_stock_movement(
                        cursor=sc,
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
                        notes="خصم مباشر لعدم وجود مشتقات في TBL062",
                    )
            conn.commit()
        except Exception as e_stock:
            stock_movement_ok = False
            stock_movement_detail = str(e_stock)
            try:
                conn.rollback()
            except Exception:
                pass
            print("[mat3am] الفاتورة حُفظت في TBL022/TBL023؛ فشل تسجيل حركة المخزون:", e_stock)

        return {
            "success": True,
            # main_guide هنا = TBL022.CardGuide (معرّف الفاتورة نفسها)؛ TBL023.MainGuide يطابقه
            "MainGuide": main_guide,
            "CardGuide": main_guide,
            "InvoiceTypeGuid": invoice_type,
            "BillNumber": invoice.BillNumber,
            "message": "تم حفظ الفاتورة بنجاح",
            "stockMovementOk": stock_movement_ok,
            **({"stockMovementWarning": stock_movement_detail} if stock_movement_detail else {}),
        }
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
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
def _bom_table_cols(cursor):
    """يحدد جدول BOM الفعلي تلقائياً: TBL063 أولاً ثم TBL062."""
    def cols_of(tbl: str):
        cursor.execute(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=?",
            (tbl,),
        )
        return {str(r[0]) for r in cursor.fetchall()}
    def pick(*names):
        for n in names:
            if n in cols:
                return n
        return None
    for tbl in ("TBL063", "TBL062"):
        try:
            cols = cols_of(tbl)
        except Exception:
            continue
        m = pick("MainGuide", "MainGuid", "ParentGuide", "RecipeGuide")
        i = pick("ItemGuide", "SubItemGuide", "ComponentGuide", "ProductGuide")
        q = pick("Quantity", "Qty", "QTY")
        u = pick("Unit", "UnitNo", "DefaultUnit")
        p = pick("PriceRatio", "UnitCost", "Cost", "Price")
        uq = pick("UnitQuantity", "UnitQty")
        if m and i and q:
            return {"table": tbl, "main": m, "item": i, "qty": q, "unit": u, "price": p, "unit_qty": uq}
    return None


@app.get("/api/costing/recipes")
def get_costing_recipe(product_guide: Optional[str] = None):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        bom = _bom_table_cols(cursor)
        if product_guide:
            cursor.execute("SELECT TOP 1 ProductName, AgentPrice FROM TBL007 WHERE CardGuide = CAST(? AS uniqueidentifier)", (product_guide,))
            h = cursor.fetchone()
            if not h:
                return {"recipe": None}
            rows = []
            if bom:
                unit_sel = f"[{bom['unit']}]" if bom.get("unit") else "NULL"
                price_sel = f"[{bom['price']}]" if bom.get("price") else "0"
                cursor.execute(
                    f"""
                    SELECT [{bom['item']}], {unit_sel}, [{bom['qty']}], {price_sel}
                    FROM dbo.[{bom['table']}]
                    WHERE [{bom['main']}] = CAST(? AS uniqueidentifier)
                    ORDER BY ID
                    """,
                    (product_guide,),
                )
                rows = cursor.fetchall()
            else:
                _ensure_costing_and_stock_schema(cursor)
                cursor.execute(
                    """
                    SELECT TOP 1 RecipeGuid
                    FROM dbo.MAT3AM_RECIPE_HDR
                    WHERE ProductGuide = CAST(? AS uniqueidentifier) AND IsActive = 1
                    ORDER BY UpdatedAt DESC
                    """,
                    (product_guide,),
                )
                hr = cursor.fetchone()
                if hr and hr[0]:
                    cursor.execute(
                        """
                        SELECT ComponentProductGuide, UnitCode, Quantity, UnitCost
                        FROM dbo.MAT3AM_RECIPE_LINE
                        WHERE RecipeGuid = CAST(? AS uniqueidentifier)
                        ORDER BY Id
                        """,
                        (str(hr[0]),),
                    )
                    rows = cursor.fetchall()
            lines = []
            for i, r in enumerate(rows, 1):
                comp_pg = str(r[0]).upper() if r and r[0] else ""
                comp_name = ""
                if comp_pg:
                    try:
                        cursor.execute("SELECT TOP 1 ProductName, AgentPrice FROM TBL007 WHERE CardGuide = CAST(? AS uniqueidentifier)", (comp_pg,))
                        pr = cursor.fetchone()
                        if pr:
                            comp_name = (pr[0] or "").strip()
                            price_fallback = float(pr[1] or 0)
                        else:
                            price_fallback = 0.0
                    except Exception:
                        price_fallback = 0.0
                else:
                    price_fallback = 0.0
                lines.append(
                    {
                        "id": i,
                        "componentName": comp_name or "مكون",
                        "quantity": float(r[2] or 0),
                        "unitCode": str(int(r[1])) if r[1] is not None else "1",
                        "unitCost": float(r[3] or 0) if float(r[3] or 0) > 0 else price_fallback,
                        "componentProductGuide": comp_pg,
                    }
                )
            return {
                "recipe": {
                    "recipeGuid": f"{'TBL062' if bom else 'MAT3AM'}:{product_guide}",
                    "productGuide": product_guide,
                    "productName": h[0] or "",
                    "salePrice": float(h[1] or 0),
                    "overheadPercent": 0.0,
                    "adminShareValue": 0.0,
                    "updatedAt": "",
                    "lines": lines,
                }
            }
        if bom:
            cursor.execute(
                f"""
                SELECT TOP 400 DISTINCT m.[{bom['main']}], p.ProductName, p.AgentPrice
                FROM dbo.[{bom['table']}] m
                LEFT JOIN dbo.TBL007 p ON p.CardGuide = m.[{bom['main']}]
                ORDER BY p.ProductName
                """
            )
            rows = cursor.fetchall()
        else:
            _ensure_costing_and_stock_schema(cursor)
            cursor.execute(
                """
                SELECT TOP 400 ProductGuide, ProductName, SalePrice
                FROM dbo.MAT3AM_RECIPE_HDR
                WHERE IsActive = 1
                ORDER BY UpdatedAt DESC
                """
            )
            rows = cursor.fetchall()
        return {
            "recipes": [
                {
                    "recipeGuid": f"{'TBL062' if bom else 'MAT3AM'}:{str(r[0])}",
                    "productGuide": str(r[0]) if r[0] else "",
                    "productName": r[1] or "",
                    "salePrice": float(r[2] or 0),
                    "overheadPercent": 0.0,
                    "adminShareValue": 0.0,
                    "updatedAt": "",
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
    if not product_guide:
        raise HTTPException(status_code=400, detail="productGuide مطلوب")
    lines = body.get("lines") or []
    if not isinstance(lines, list):
        lines = []
    try:
        cursor = conn.cursor()
        bom = _bom_table_cols(cursor)
        written = 0
        # مزامنة سعر البيع داخل بطاقة الصنف (اختياري)
        try:
            cursor.execute(
                "UPDATE TBL007 SET AgentPrice = ? WHERE CardGuide = CAST(? AS uniqueidentifier)",
                (float(body.get("salePrice") or 0), product_guide),
            )
        except Exception:
            pass
        if bom:
            cursor.execute(f"DELETE FROM dbo.[{bom['table']}] WHERE [{bom['main']}] = CAST(? AS uniqueidentifier)", (product_guide,))
            for ln in lines:
                comp_pg = (ln.get("componentProductGuide") or ln.get("componentGuide") or "").strip() or None
                if not comp_pg:
                    continue
                qty = float(ln.get("quantity") or 0)
                if qty <= 0:
                    continue
                unit_raw = str(ln.get("unitCode") or ln.get("unit") or "1").strip()
                try:
                    unit_no = int(float(unit_raw))
                except Exception:
                    unit_no = 1
                unit_cost = float(ln.get("unitCost") or 0)
                cols = [bom["item"], bom["main"], bom["qty"]]
                vals = [comp_pg, product_guide, qty]
                if bom.get("unit"):
                    cols.append(bom["unit"]); vals.append(unit_no)
                if bom.get("price"):
                    cols.append(bom["price"]); vals.append(unit_cost)
                col_sql = ", ".join(f"[{c}]" for c in cols)
                ph = ", ".join("CAST(? AS uniqueidentifier)" if c in (bom["item"], bom["main"]) else "?" for c in cols)
                cursor.execute(f"INSERT INTO dbo.[{bom['table']}] ({col_sql}) VALUES ({ph})", tuple(vals))
                written += 1
        else:
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
                        str(body.get("productName") or ""),
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
                        str(body.get("productName") or ""),
                        float(body.get("salePrice") or 0),
                        float(body.get("overheadPercent") or 0),
                        float(body.get("adminShareValue") or 0),
                    ),
                )
            for ln in lines:
                comp_pg = (ln.get("componentProductGuide") or ln.get("componentGuide") or "").strip() or None
                comp_name = (ln.get("componentName") or ln.get("name") or "").strip() or "مكون"
                qty = float(ln.get("quantity") or 0)
                if qty <= 0:
                    continue
                unit_code = str(ln.get("unitCode") or ln.get("unit") or "EA").strip()[:20]
                unit_cost = float(ln.get("unitCost") or 0)
                cursor.execute(
                    """
                    INSERT INTO dbo.MAT3AM_RECIPE_LINE
                    (RecipeGuid, ComponentProductGuide, ComponentName, Quantity, UnitCode, UnitCost)
                    VALUES (CAST(? AS uniqueidentifier), ?, ?, ?, ?, ?)
                    """,
                    (recipe_guid, comp_pg, comp_name, qty, unit_code, unit_cost),
                )
                written += 1
        if lines and written == 0:
            raise HTTPException(status_code=400, detail="لم يتم إدراج أي سطر مكونات. تحقق من اختيار الصنف/المجموعة.")
        conn.commit()
        return {
            "ok": True,
            "recipeGuid": f"{(bom['table'] if bom else 'MAT3AM')}:{product_guide}",
            "targetTable": (bom["table"] if bom else "MAT3AM_RECIPE_LINE"),
            "written": int(written),
        }
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


@app.get("/api/costing/raw-material-prices")
def get_raw_material_prices():
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_costing_and_stock_schema(cursor)
        cursor.execute(
            """
            WITH latest_purchase AS (
                SELECT
                    ProductGuide,
                    ItemName,
                    UnitCode,
                    UnitCost,
                    MovementAt,
                    ROW_NUMBER() OVER (
                        PARTITION BY ProductGuide
                        ORDER BY MovementAt DESC, Id DESC
                    ) AS rn
                FROM dbo.MAT3AM_STOCK_MOVEMENT
                WHERE
                    ProductGuide IS NOT NULL
                    AND ISNULL(QtyIn,0) > 0
                    AND ISNULL(UnitCost,0) > 0
                    AND UPPER(ISNULL(MovementType, N'')) = N'PURCHASE_IN'
            )
            SELECT
                CAST(ProductGuide AS NVARCHAR(36)) AS ProductGuideText,
                ISNULL(ItemName, N'') AS ItemName,
                ISNULL(UnitCode, N'') AS UnitCode,
                ISNULL(UnitCost, 0) AS LatestUnitCost,
                MovementAt
            FROM latest_purchase
            WHERE rn = 1
            ORDER BY ItemName
            """
        )
        rows = cursor.fetchall()
        return {
            "prices": [
                {
                    "productGuide": str(r[0] or ""),
                    "itemName": r[1] or "",
                    "unitCode": r[2] or "",
                    "latestUnitCost": float(r[3] or 0),
                    "latestAt": str(r[4]) if r[4] else "",
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


@app.get("/api/costing/raw-groups")
def get_costing_raw_groups():
    """
    مجموعات خامات الطبخ فقط:
    SELECT * FROM TBL006 WHERE MainGuide = Root(CardGuide)
    Root: GroupName/LatinName = خامات الطبخ / Cooking ingredients
    """
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            ;WITH Canonical AS (
                SELECT N'خضروات طازجة' AS GroupName
                UNION ALL SELECT N'حبوب وبقوليات'
                UNION ALL SELECT N'لحوم حمراء'
                UNION ALL SELECT N'دواجن وبيض'
                UNION ALL SELECT N'أسماك ومأكولات بحرية'
                UNION ALL SELECT N'ألبان وأجبان'
                UNION ALL SELECT N'زيوت ودهون وصوصات'
                UNION ALL SELECT N'توابل وأعشاب جافة'
                UNION ALL SELECT N'معلبات ومجمدات ومكسرات'
            ),
            Root AS (
                SELECT TOP (1) r.CardGuide
                FROM dbo.TBL006 r
                WHERE
                    (
                        r.GroupName LIKE N'%خامات الطبخ بالمطعم%'
                        OR r.GroupName LIKE N'%خامات الطبخ%'
                        OR r.GroupName LIKE N'%مواد الطبخ%'
                        OR r.GroupName LIKE N'%الخامات%'
                        OR r.LatinName LIKE N'%Cooking ingredients%'
                    )
                    AND r.MainGuide IS NULL
                ORDER BY
                    CASE
                        WHEN r.GroupName LIKE N'%خامات الطبخ بالمطعم%' THEN 0
                        WHEN r.LatinName LIKE N'%Cooking ingredients%' THEN 1
                        ELSE 2
                    END,
                    r.ID
            ),
            RootFallback AS (
                SELECT CAST('8A5CB706-B2D5-4CB6-8FE9-08ECFBEDF2D8' AS uniqueidentifier) AS CardGuide
                WHERE NOT EXISTS (SELECT 1 FROM Root)
            ),
            RootFinal AS (
                SELECT CardGuide FROM Root
                UNION ALL
                SELECT CardGuide FROM RootFallback
            ),
            Children AS (
                SELECT
                    g.CardGuide,
                    g.GroupName,
                    ISNULL(g.LatinName, N'') AS LatinName,
                    g.MainGuide
                FROM dbo.TBL006 g
                INNER JOIN RootFinal rt ON g.MainGuide = rt.CardGuide
                WHERE g.GroupName IS NOT NULL
            ),
            CanonicalRows AS (
                SELECT
                    g.CardGuide,
                    g.GroupName,
                    ISNULL(g.LatinName, N'') AS LatinName,
                    g.MainGuide
                FROM dbo.TBL006 g
                INNER JOIN Canonical c ON c.GroupName = g.GroupName
            )
            SELECT
                x.CardGuide,
                x.GroupName,
                x.LatinName,
                x.MainGuide
            FROM (
                SELECT * FROM Children
                UNION
                SELECT * FROM CanonicalRows
            ) x
            ORDER BY x.GroupName
            """
        )
        rows = cursor.fetchall()
        return {
            "groups": [
                {
                    "CardGuide": str(r[0]) if r[0] else "",
                    "GroupName": r[1] or "",
                    "LatinName": r[2] or "",
                    "MainGuide": str(r[3]) if r[3] else "",
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


@app.get("/api/costing/raw-products")
def get_costing_raw_products(group_guid: Optional[str] = None):
    """
    أصناف خامات الطبخ من TBL007 بدلالة مجموعات خامات الطبخ.
    - ALL: كل الأصناف التابعة لفروع Root.
    - group_guid: أصناف مجموعة محددة بشرط أنها ضمن فروع Root.
    """
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        gg = (group_guid or "ALL").strip()
        if gg and gg.upper() != "ALL":
            cursor.execute(
                """
                ;WITH Canonical AS (
                    SELECT N'خضروات طازجة' AS GroupName
                    UNION ALL SELECT N'حبوب وبقوليات'
                    UNION ALL SELECT N'لحوم حمراء'
                    UNION ALL SELECT N'دواجن وبيض'
                    UNION ALL SELECT N'أسماك ومأكولات بحرية'
                    UNION ALL SELECT N'ألبان وأجبان'
                    UNION ALL SELECT N'زيوت ودهون وصوصات'
                    UNION ALL SELECT N'توابل وأعشاب جافة'
                    UNION ALL SELECT N'معلبات ومجمدات ومكسرات'
                ),
                Root AS (
                    SELECT TOP (1) r.CardGuide
                    FROM dbo.TBL006 r
                    WHERE
                        (
                            r.GroupName LIKE N'%خامات الطبخ بالمطعم%'
                            OR r.GroupName LIKE N'%خامات الطبخ%'
                            OR r.GroupName LIKE N'%مواد الطبخ%'
                            OR r.GroupName LIKE N'%الخامات%'
                            OR r.LatinName LIKE N'%Cooking ingredients%'
                        )
                        AND r.MainGuide IS NULL
                    ORDER BY
                        CASE
                            WHEN r.GroupName LIKE N'%خامات الطبخ بالمطعم%' THEN 0
                            WHEN r.LatinName LIKE N'%Cooking ingredients%' THEN 1
                            ELSE 2
                        END,
                        r.ID
                ),
                RootFallback AS (
                    SELECT CAST('8A5CB706-B2D5-4CB6-8FE9-08ECFBEDF2D8' AS uniqueidentifier) AS CardGuide
                    WHERE NOT EXISTS (SELECT 1 FROM Root)
                ),
                RootFinal AS (
                    SELECT CardGuide FROM Root
                    UNION ALL
                    SELECT CardGuide FROM RootFallback
                ),
                AllowedGroups AS (
                    SELECT g.CardGuide
                    FROM dbo.TBL006 g
                    INNER JOIN RootFinal rt ON g.MainGuide = rt.CardGuide
                    UNION
                    SELECT g.CardGuide
                    FROM dbo.TBL006 g
                    INNER JOIN Canonical c ON c.GroupName = g.GroupName
                )
                SELECT TOP 5000
                    p.CardGuide,
                    p.ProductName,
                    p.LatinName,
                    p.AgentPrice,
                    p.GroupGuid,
                    p.ProductImageUrl,
                    p.Hieght3
                FROM dbo.TBL007 p
                INNER JOIN AllowedGroups ag ON p.GroupGuid = ag.CardGuide
                WHERE
                    p.GroupGuid = CAST(? AS uniqueidentifier)
                    AND ISNULL(p.NotActive, 0) = 0
                ORDER BY p.ProductName
                """,
                (gg,),
            )
        else:
            cursor.execute(
                """
                ;WITH Canonical AS (
                    SELECT N'خضروات طازجة' AS GroupName
                    UNION ALL SELECT N'حبوب وبقوليات'
                    UNION ALL SELECT N'لحوم حمراء'
                    UNION ALL SELECT N'دواجن وبيض'
                    UNION ALL SELECT N'أسماك ومأكولات بحرية'
                    UNION ALL SELECT N'ألبان وأجبان'
                    UNION ALL SELECT N'زيوت ودهون وصوصات'
                    UNION ALL SELECT N'توابل وأعشاب جافة'
                    UNION ALL SELECT N'معلبات ومجمدات ومكسرات'
                ),
                Root AS (
                    SELECT TOP (1) r.CardGuide
                    FROM dbo.TBL006 r
                    WHERE
                        (
                            r.GroupName LIKE N'%خامات الطبخ بالمطعم%'
                            OR r.GroupName LIKE N'%خامات الطبخ%'
                            OR r.GroupName LIKE N'%مواد الطبخ%'
                            OR r.GroupName LIKE N'%الخامات%'
                            OR r.LatinName LIKE N'%Cooking ingredients%'
                        )
                        AND r.MainGuide IS NULL
                    ORDER BY
                        CASE
                            WHEN r.GroupName LIKE N'%خامات الطبخ بالمطعم%' THEN 0
                            WHEN r.LatinName LIKE N'%Cooking ingredients%' THEN 1
                            ELSE 2
                        END,
                        r.ID
                ),
                RootFallback AS (
                    SELECT CAST('8A5CB706-B2D5-4CB6-8FE9-08ECFBEDF2D8' AS uniqueidentifier) AS CardGuide
                    WHERE NOT EXISTS (SELECT 1 FROM Root)
                ),
                RootFinal AS (
                    SELECT CardGuide FROM Root
                    UNION ALL
                    SELECT CardGuide FROM RootFallback
                ),
                AllowedGroups AS (
                    SELECT g.CardGuide
                    FROM dbo.TBL006 g
                    INNER JOIN RootFinal rt ON g.MainGuide = rt.CardGuide
                    UNION
                    SELECT g.CardGuide
                    FROM dbo.TBL006 g
                    INNER JOIN Canonical c ON c.GroupName = g.GroupName
                )
                SELECT TOP 5000
                    p.CardGuide,
                    p.ProductName,
                    p.LatinName,
                    p.AgentPrice,
                    p.GroupGuid,
                    p.ProductImageUrl,
                    p.Hieght3
                FROM dbo.TBL007 p
                INNER JOIN AllowedGroups ag ON p.GroupGuid = ag.CardGuide
                WHERE ISNULL(p.NotActive, 0) = 0
                ORDER BY p.ProductName
                """
            )
        rows = cursor.fetchall()
        return {
            "products": [
                {
                    "CardGuide": str(r[0]) if r[0] else "",
                    "ProductName": r[1] or "",
                    "LatinName": r[2] or "",
                    "Price": float(r[3] or 0),
                    "GroupGuid": str(r[4]) if r[4] else "",
                    "imageUrl": r[5] or "",
                    "PrepMinutes": float(r[6] or 0),
                    "Hieght3": float(r[6] or 0),
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


def _ensure_price_list_schema(cursor):
    cursor.execute(
        """
        IF OBJECT_ID(N'dbo.MAT3AM_PRICE_LIST_HDR', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_PRICE_LIST_HDR (
                PriceListGuid UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
                NameAr NVARCHAR(200) NULL,
                NameEn NVARCHAR(200) NULL,
                DateFrom DATE NULL,
                DateTo DATE NULL,
                DecisionNo NVARCHAR(100) NULL,
                DecisionDate DATE NULL,
                DecisionText NVARCHAR(MAX) NULL,
                IncreasePercent FLOAT NOT NULL DEFAULT(0),
                GroupGuid UNIQUEIDENTIFIER NULL,
                CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
        END
        IF OBJECT_ID(N'dbo.MAT3AM_PRICE_LIST_LINE', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_PRICE_LIST_LINE (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                PriceListGuid UNIQUEIDENTIFIER NOT NULL,
                ProductGuide UNIQUEIDENTIFIER NOT NULL,
                OldEndUserPrice FLOAT NOT NULL DEFAULT(0),
                NewEndUserPrice FLOAT NOT NULL DEFAULT(0),
                Applied BIT NOT NULL DEFAULT(0),
                Note NVARCHAR(200) NULL
            );
            CREATE INDEX IX_MAT3AM_PRICE_LIST_LINE_List ON dbo.MAT3AM_PRICE_LIST_LINE(PriceListGuid);
        END
        """
    )


@app.get("/api/costing/finished-groups")
def get_costing_finished_groups():
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            ;WITH Root AS (
                SELECT TOP (1) r.CardGuide
                FROM dbo.TBL006 r
                WHERE
                    (
                        r.GroupName LIKE N'%المجموعة الرئيسية%'
                        OR r.GroupName LIKE N'%المنيو العام%'
                        OR r.GroupName LIKE N'%قائمة الاصناف%'
                        OR r.GroupName LIKE N'%الاطباق%'
                        OR r.GroupName LIKE N'%الوجبات%'
                        OR r.LatinName LIKE N'%main menu%'
                        OR r.LatinName LIKE N'%menu%'
                        OR r.LatinName LIKE N'%items list%'
                        OR r.LatinName LIKE N'%dishes%'
                        OR r.LatinName LIKE N'%meals%'
                    )
                    AND r.MainGuide IS NULL
                ORDER BY r.ID
            )
            SELECT g.CardGuide, g.GroupName, ISNULL(g.LatinName, N'') AS LatinName
            FROM dbo.TBL006 g
            WHERE
                (
                    EXISTS (SELECT 1 FROM Root rt WHERE g.MainGuide = rt.CardGuide)
                    OR g.GroupName IN (
                        N'البيتزا Pizza', N'الاطباق Dishes', N'الافطار Breakfast', N'الباستا Pasta',
                        N'الدجاج Chicken', N'السلطات Salada', N'الشوربة Soup', N'الكوكتيل Cocktail',
                        N'الحلويات Dessert', N'المقبلات Appetizers', N'ساندوتشات البرجر Burger Sandwiches',
                        N'مشويات Grills', N'سى فود Sea Food', N'مشروبات باردة Cold Drinks',
                        N'مشروبات ساخنة Hot Drinks', N'عصائر فريش Fresh Juice'
                    )
                )
            ORDER BY g.GroupName
            """
        )
        rows = cursor.fetchall()
        return {
            "groups": [
                {"CardGuide": str(r[0]) if r[0] else "", "GroupName": r[1] or "", "LatinName": r[2] or ""}
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


@app.get("/api/costing/finished-products")
def get_costing_finished_products(group_guid: str):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        gg = (group_guid or "").strip()
        if not gg:
            raise HTTPException(status_code=400, detail="group_guid مطلوب")
        cursor.execute(
            """
            SELECT TOP 5000
                CardGuide, CardCode, ProductName, ISNULL(LatinName,N''), ISNULL(EndUserPrice,0), GroupGuid
            FROM dbo.TBL007
            WHERE GroupGuid = CAST(? AS uniqueidentifier)
              AND ISNULL(NotActive,0) = 0
            ORDER BY ProductName
            """,
            (gg,),
        )
        rows = cursor.fetchall()
        return {
            "products": [
                {
                    "productGuide": str(r[0]) if r[0] else "",
                    "cardCode": r[1] or "",
                    "productName": r[2] or "",
                    "latinName": r[3] or "",
                    "oldPrice": float(r[4] or 0),
                    "groupGuid": str(r[5]) if r[5] else "",
                }
                for r in rows
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.post("/api/costing/price-lists/apply")
def apply_costing_price_list(body: dict):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_price_list_schema(cursor)
        group_guid = (body.get("groupGuid") or "").strip()
        items = body.get("items") or []
        if not group_guid:
            raise HTTPException(status_code=400, detail="groupGuid مطلوب")
        if not isinstance(items, list) or not items:
            raise HTTPException(status_code=400, detail="items مطلوبة")

        list_guid = str(uuid.uuid4()).upper()
        increase_percent = float(body.get("increasePercent") or 0)
        cursor.execute(
            """
            INSERT INTO dbo.MAT3AM_PRICE_LIST_HDR
            (PriceListGuid, NameAr, NameEn, DateFrom, DateTo, DecisionNo, DecisionDate, DecisionText, IncreasePercent, GroupGuid)
            VALUES (CAST(? AS uniqueidentifier), ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS uniqueidentifier))
            """,
            (
                list_guid,
                (body.get("nameAr") or None),
                (body.get("nameEn") or None),
                (body.get("dateFrom") or None),
                (body.get("dateTo") or None),
                (body.get("decisionNo") or None),
                (body.get("decisionDate") or None),
                (body.get("decisionText") or None),
                increase_percent,
                group_guid,
            ),
        )

        updated = 0
        skipped_zero = 0
        for it in items:
            if not isinstance(it, dict):
                continue
            pg = str(it.get("productGuide") or "").strip()
            if not pg:
                continue
            old_price = float(it.get("oldPrice") or 0)
            mode = str(it.get("mode") or "set").strip().lower()
            if mode == "percent":
                if old_price <= 0:
                    skipped_zero += 1
                    cursor.execute(
                        """
                        INSERT INTO dbo.MAT3AM_PRICE_LIST_LINE
                        (PriceListGuid, ProductGuide, OldEndUserPrice, NewEndUserPrice, Applied, Note)
                        VALUES (CAST(? AS uniqueidentifier), CAST(? AS uniqueidentifier), ?, ?, 0, N'تخطي: السعر السابق صفر')
                        """,
                        (list_guid, pg, old_price, old_price),
                    )
                    continue
                new_price = old_price + (old_price * (increase_percent / 100.0))
            else:
                try:
                    new_price = float(it.get("newPrice"))
                except Exception:
                    new_price = old_price
            if new_price < 0:
                new_price = 0
            cursor.execute(
                "UPDATE dbo.TBL007 SET EndUserPrice = ? WHERE CardGuide = CAST(? AS uniqueidentifier)",
                (new_price, pg),
            )
            applied = 1 if cursor.rowcount > 0 else 0
            if applied:
                updated += 1
            cursor.execute(
                """
                INSERT INTO dbo.MAT3AM_PRICE_LIST_LINE
                (PriceListGuid, ProductGuide, OldEndUserPrice, NewEndUserPrice, Applied, Note)
                VALUES (CAST(? AS uniqueidentifier), CAST(? AS uniqueidentifier), ?, ?, ?, ?)
                """,
                (list_guid, pg, old_price, new_price, applied, None),
            )
        conn.commit()
        return {"ok": True, "priceListGuid": list_guid, "updated": updated, "skippedZero": skipped_zero}
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


def _ensure_daily_engine_schema(cursor):
    cursor.execute(
        """
        IF OBJECT_ID(N'dbo.MAT3AM_DAILY_CUSTODY_LINE', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_DAILY_CUSTODY_LINE (
                Id BIGINT IDENTITY(1,1) PRIMARY KEY,
                DateKey DATE NOT NULL,
                ProductGuide UNIQUEIDENTIFIER NOT NULL,
                ProductName NVARCHAR(255) NULL,
                Qty FLOAT NOT NULL DEFAULT(0),
                UnitCost FLOAT NOT NULL DEFAULT(0),
                TotalCost FLOAT NOT NULL DEFAULT(0),
                Note NVARCHAR(300) NULL
            );
            CREATE INDEX IX_MAT3AM_DAILY_CUSTODY_LINE_DateKey ON dbo.MAT3AM_DAILY_CUSTODY_LINE(DateKey);
        END
        IF OBJECT_ID(N'dbo.MAT3AM_DAILY_RETURN_LINE', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_DAILY_RETURN_LINE (
                Id BIGINT IDENTITY(1,1) PRIMARY KEY,
                DateKey DATE NOT NULL,
                ProductGuide UNIQUEIDENTIFIER NOT NULL,
                ProductName NVARCHAR(255) NULL,
                Qty FLOAT NOT NULL DEFAULT(0),
                UnitCost FLOAT NOT NULL DEFAULT(0),
                TotalCost FLOAT NOT NULL DEFAULT(0),
                Note NVARCHAR(300) NULL
            );
            CREATE INDEX IX_MAT3AM_DAILY_RETURN_LINE_DateKey ON dbo.MAT3AM_DAILY_RETURN_LINE(DateKey);
        END
        IF OBJECT_ID(N'dbo.MAT3AM_DAILY_OVERHEAD_LINE', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_DAILY_OVERHEAD_LINE (
                Id BIGINT IDENTITY(1,1) PRIMARY KEY,
                DateKey DATE NOT NULL,
                CostName NVARCHAR(255) NOT NULL,
                BasisType NVARCHAR(30) NOT NULL DEFAULT(N'daily'),
                BasisAmount FLOAT NOT NULL DEFAULT(0),
                Divisor FLOAT NOT NULL DEFAULT(1),
                DailyAmount FLOAT NOT NULL DEFAULT(0),
                Note NVARCHAR(500) NULL
            );
            CREATE INDEX IX_MAT3AM_DAILY_OVERHEAD_LINE_DateKey ON dbo.MAT3AM_DAILY_OVERHEAD_LINE(DateKey);
        END
        IF OBJECT_ID(N'dbo.MAT3AM_DAILY_CLOSE', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_DAILY_CLOSE (
                DateKey DATE NOT NULL PRIMARY KEY,
                OpeningCustody FLOAT NOT NULL DEFAULT(0),
                ReturnedCustody FLOAT NOT NULL DEFAULT(0),
                RawConsumed FLOAT NOT NULL DEFAULT(0),
                OverheadTotal FLOAT NOT NULL DEFAULT(0),
                TotalCost FLOAT NOT NULL DEFAULT(0),
                RevenueTotal FLOAT NOT NULL DEFAULT(0),
                ProfitTotal FLOAT NOT NULL DEFAULT(0),
                UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
        END
        IF OBJECT_ID(N'dbo.MAT3AM_DAILY_RESULT', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_DAILY_RESULT (
                DateKey DATE NOT NULL PRIMARY KEY,
                OpeningCustody FLOAT NOT NULL DEFAULT(0),
                ReturnedCustody FLOAT NOT NULL DEFAULT(0),
                RawConsumed FLOAT NOT NULL DEFAULT(0),
                OverheadTotal FLOAT NOT NULL DEFAULT(0),
                TotalCost FLOAT NOT NULL DEFAULT(0),
                RevenueTotal FLOAT NOT NULL DEFAULT(0),
                ProfitTotal FLOAT NOT NULL DEFAULT(0),
                SavedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
        END
        IF OBJECT_ID(N'dbo.MAT3AM_COSTING_MODE', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_COSTING_MODE (
                Id INT IDENTITY(1,1) PRIMARY KEY,
                ModeCode NVARCHAR(20) NOT NULL,
                UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
            INSERT INTO dbo.MAT3AM_COSTING_MODE (ModeCode) VALUES (N'hybrid');
        END
        """
    )


def _to_bill_date_ddmmyyyy(date_key: str) -> str:
    try:
        dt = datetime.strptime(date_key[:10], "%Y-%m-%d")
        return dt.strftime("%d-%m-%Y")
    except Exception:
        return date_key


@app.get("/api/costing/daily-engine")
def get_daily_engine(date_key: str):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_daily_engine_schema(cursor)
        dk = (date_key or "").strip()
        if not dk:
            raise HTTPException(status_code=400, detail="date_key مطلوب بصيغة YYYY-MM-DD")

        cursor.execute(
            """
            SELECT ProductGuide, ISNULL(ProductName,N''), Qty, UnitCost, TotalCost, ISNULL(Note,N'')
            FROM dbo.MAT3AM_DAILY_CUSTODY_LINE
            WHERE DateKey = CAST(? AS date)
            ORDER BY Id
            """,
            (dk,),
        )
        custody = [
            {
                "productGuide": str(r[0]) if r[0] else "",
                "productName": r[1] or "",
                "qty": float(r[2] or 0),
                "unitCost": float(r[3] or 0),
                "totalCost": float(r[4] or 0),
                "note": r[5] or "",
            }
            for r in cursor.fetchall()
        ]

        cursor.execute(
            """
            SELECT ProductGuide, ISNULL(ProductName,N''), Qty, UnitCost, TotalCost, ISNULL(Note,N'')
            FROM dbo.MAT3AM_DAILY_RETURN_LINE
            WHERE DateKey = CAST(? AS date)
            ORDER BY Id
            """,
            (dk,),
        )
        returned = [
            {
                "productGuide": str(r[0]) if r[0] else "",
                "productName": r[1] or "",
                "qty": float(r[2] or 0),
                "unitCost": float(r[3] or 0),
                "totalCost": float(r[4] or 0),
                "note": r[5] or "",
            }
            for r in cursor.fetchall()
        ]

        cursor.execute(
            """
            SELECT CostName, BasisType, BasisAmount, Divisor, DailyAmount, ISNULL(Note,N'')
            FROM dbo.MAT3AM_DAILY_OVERHEAD_LINE
            WHERE DateKey = CAST(? AS date)
            ORDER BY Id
            """,
            (dk,),
        )
        overhead = [
            {
                "costName": r[0] or "",
                "basisType": r[1] or "daily",
                "basisAmount": float(r[2] or 0),
                "divisor": float(r[3] or 1),
                "dailyAmount": float(r[4] or 0),
                "note": r[5] or "",
            }
            for r in cursor.fetchall()
        ]

        opening = sum(x["totalCost"] for x in custody)
        back = sum(x["totalCost"] for x in returned)
        raw_consumed = max(opening - back, 0.0)
        overhead_total = sum(x["dailyAmount"] for x in overhead)
        total_cost = raw_consumed + overhead_total

        bill_date = _to_bill_date_ddmmyyyy(dk)
        cursor.execute(
            """
            SELECT ISNULL(SUM(ISNULL(d.TotalValue,0)),0)
            FROM dbo.TBL023 d
            INNER JOIN dbo.TBL022 h ON h.CardGuide = d.MainGuide
            WHERE h.BillDate = ?
            """,
            (bill_date,),
        )
        revenue = float((cursor.fetchone() or [0])[0] or 0)
        profit = revenue - total_cost

        return {
            "dateKey": dk,
            "custody": custody,
            "returned": returned,
            "overhead": overhead,
            "summary": {
                "openingCustody": opening,
                "returnedCustody": back,
                "rawConsumed": raw_consumed,
                "overheadTotal": overhead_total,
                "totalCost": total_cost,
                "revenueTotal": revenue,
                "profitTotal": profit,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.post("/api/costing/daily-engine/custody/save")
def save_daily_custody(body: dict):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_daily_engine_schema(cursor)
        dk = str(body.get("dateKey") or "").strip()
        lines = body.get("lines") or []
        if not dk:
            raise HTTPException(status_code=400, detail="dateKey مطلوب")
        if not isinstance(lines, list):
            lines = []
        cursor.execute("DELETE FROM dbo.MAT3AM_DAILY_CUSTODY_LINE WHERE DateKey = CAST(? AS date)", (dk,))
        written = 0
        for ln in lines:
            if not isinstance(ln, dict):
                continue
            pg = str(ln.get("productGuide") or "").strip()
            if not pg:
                continue
            qty = float(ln.get("qty") or 0)
            uc = float(ln.get("unitCost") or 0)
            tc = float(ln.get("totalCost") or (qty * uc))
            cursor.execute(
                """
                INSERT INTO dbo.MAT3AM_DAILY_CUSTODY_LINE
                (DateKey, ProductGuide, ProductName, Qty, UnitCost, TotalCost, Note)
                VALUES (CAST(? AS date), CAST(? AS uniqueidentifier), ?, ?, ?, ?, ?)
                """,
                (dk, pg, str(ln.get("productName") or ""), qty, uc, tc, str(ln.get("note") or "")),
            )
            written += 1
        conn.commit()
        return {"ok": True, "written": written}
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


@app.post("/api/costing/daily-engine/returns/save")
def save_daily_returns(body: dict):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_daily_engine_schema(cursor)
        dk = str(body.get("dateKey") or "").strip()
        lines = body.get("lines") or []
        if not dk:
            raise HTTPException(status_code=400, detail="dateKey مطلوب")
        if not isinstance(lines, list):
            lines = []
        cursor.execute("DELETE FROM dbo.MAT3AM_DAILY_RETURN_LINE WHERE DateKey = CAST(? AS date)", (dk,))
        written = 0
        for ln in lines:
            if not isinstance(ln, dict):
                continue
            pg = str(ln.get("productGuide") or "").strip()
            if not pg:
                continue
            qty = float(ln.get("qty") or 0)
            uc = float(ln.get("unitCost") or 0)
            tc = float(ln.get("totalCost") or (qty * uc))
            cursor.execute(
                """
                INSERT INTO dbo.MAT3AM_DAILY_RETURN_LINE
                (DateKey, ProductGuide, ProductName, Qty, UnitCost, TotalCost, Note)
                VALUES (CAST(? AS date), CAST(? AS uniqueidentifier), ?, ?, ?, ?, ?)
                """,
                (dk, pg, str(ln.get("productName") or ""), qty, uc, tc, str(ln.get("note") or "")),
            )
            written += 1
        conn.commit()
        return {"ok": True, "written": written}
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


@app.post("/api/costing/daily-engine/overhead/save")
def save_daily_overhead(body: dict):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_daily_engine_schema(cursor)
        dk = str(body.get("dateKey") or "").strip()
        lines = body.get("lines") or []
        if not dk:
            raise HTTPException(status_code=400, detail="dateKey مطلوب")
        if not isinstance(lines, list):
            lines = []
        cursor.execute("DELETE FROM dbo.MAT3AM_DAILY_OVERHEAD_LINE WHERE DateKey = CAST(? AS date)", (dk,))
        written = 0
        for ln in lines:
            if not isinstance(ln, dict):
                continue
            name = str(ln.get("costName") or "").strip()
            if not name:
                continue
            basis_type = str(ln.get("basisType") or "daily").strip()
            basis_amount = float(ln.get("basisAmount") or 0)
            divisor = float(ln.get("divisor") or 1)
            if divisor <= 0:
                divisor = 1
            daily_amount = float(ln.get("dailyAmount") or (basis_amount / divisor))
            cursor.execute(
                """
                INSERT INTO dbo.MAT3AM_DAILY_OVERHEAD_LINE
                (DateKey, CostName, BasisType, BasisAmount, Divisor, DailyAmount, Note)
                VALUES (CAST(? AS date), ?, ?, ?, ?, ?, ?)
                """,
                (dk, name, basis_type, basis_amount, divisor, daily_amount, str(ln.get("note") or "")),
            )
            written += 1
        conn.commit()
        return {"ok": True, "written": written}
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


@app.post("/api/costing/daily-engine/close")
def close_daily_engine(body: dict):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_daily_engine_schema(cursor)
        dk = str(body.get("dateKey") or "").strip()
        if not dk:
            raise HTTPException(status_code=400, detail="dateKey مطلوب")

        cursor.execute("SELECT ISNULL(SUM(TotalCost),0) FROM dbo.MAT3AM_DAILY_CUSTODY_LINE WHERE DateKey = CAST(? AS date)", (dk,))
        opening = float((cursor.fetchone() or [0])[0] or 0)
        cursor.execute("SELECT ISNULL(SUM(TotalCost),0) FROM dbo.MAT3AM_DAILY_RETURN_LINE WHERE DateKey = CAST(? AS date)", (dk,))
        back = float((cursor.fetchone() or [0])[0] or 0)
        raw_consumed = max(opening - back, 0.0)
        cursor.execute("SELECT ISNULL(SUM(DailyAmount),0) FROM dbo.MAT3AM_DAILY_OVERHEAD_LINE WHERE DateKey = CAST(? AS date)", (dk,))
        overhead = float((cursor.fetchone() or [0])[0] or 0)
        total_cost = raw_consumed + overhead

        revenue_manual = body.get("revenueManual")
        if revenue_manual is not None and str(revenue_manual).strip() != "":
            revenue = float(revenue_manual)
        else:
            bill_date = _to_bill_date_ddmmyyyy(dk)
            cursor.execute(
                """
                SELECT ISNULL(SUM(ISNULL(d.TotalValue,0)),0)
                FROM dbo.TBL023 d
                INNER JOIN dbo.TBL022 h ON h.CardGuide = d.MainGuide
                WHERE h.BillDate = ?
                """,
                (bill_date,),
            )
            revenue = float((cursor.fetchone() or [0])[0] or 0)
        profit = revenue - total_cost

        cursor.execute(
            """
            MERGE dbo.MAT3AM_DAILY_CLOSE AS T
            USING (SELECT CAST(? AS date) AS DateKey) AS S
            ON T.DateKey = S.DateKey
            WHEN MATCHED THEN
              UPDATE SET OpeningCustody=?, ReturnedCustody=?, RawConsumed=?, OverheadTotal=?, TotalCost=?, RevenueTotal=?, ProfitTotal=?, UpdatedAt=SYSUTCDATETIME()
            WHEN NOT MATCHED THEN
              INSERT (DateKey, OpeningCustody, ReturnedCustody, RawConsumed, OverheadTotal, TotalCost, RevenueTotal, ProfitTotal)
              VALUES (S.DateKey, ?, ?, ?, ?, ?, ?, ?);
            """,
            (dk, opening, back, raw_consumed, overhead, total_cost, revenue, profit, opening, back, raw_consumed, overhead, total_cost, revenue, profit),
        )
        cursor.execute(
            """
            MERGE dbo.MAT3AM_DAILY_RESULT AS T
            USING (SELECT CAST(? AS date) AS DateKey) AS S
            ON T.DateKey = S.DateKey
            WHEN MATCHED THEN
              UPDATE SET OpeningCustody=?, ReturnedCustody=?, RawConsumed=?, OverheadTotal=?, TotalCost=?, RevenueTotal=?, ProfitTotal=?, SavedAt=SYSUTCDATETIME()
            WHEN NOT MATCHED THEN
              INSERT (DateKey, OpeningCustody, ReturnedCustody, RawConsumed, OverheadTotal, TotalCost, RevenueTotal, ProfitTotal)
              VALUES (S.DateKey, ?, ?, ?, ?, ?, ?, ?);
            """,
            (dk, opening, back, raw_consumed, overhead, total_cost, revenue, profit, opening, back, raw_consumed, overhead, total_cost, revenue, profit),
        )
        conn.commit()
        return {
            "ok": True,
            "summary": {
                "openingCustody": opening,
                "returnedCustody": back,
                "rawConsumed": raw_consumed,
                "overheadTotal": overhead,
                "totalCost": total_cost,
                "revenueTotal": revenue,
                "profitTotal": profit,
            },
        }
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


@app.get("/api/costing/daily-engine/result")
def get_daily_engine_result(date_key: str):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_daily_engine_schema(cursor)
        dk = (date_key or "").strip()
        if not dk:
            raise HTTPException(status_code=400, detail="date_key مطلوب")
        cursor.execute(
            """
            SELECT DateKey, OpeningCustody, ReturnedCustody, RawConsumed, OverheadTotal, TotalCost, RevenueTotal, ProfitTotal, SavedAt
            FROM dbo.MAT3AM_DAILY_RESULT
            WHERE DateKey = CAST(? AS date)
            """,
            (dk,),
        )
        r = cursor.fetchone()
        if not r:
            return {"result": None}
        return {
            "result": {
                "dateKey": str(r[0]),
                "openingCustody": float(r[1] or 0),
                "returnedCustody": float(r[2] or 0),
                "rawConsumed": float(r[3] or 0),
                "overheadTotal": float(r[4] or 0),
                "totalCost": float(r[5] or 0),
                "revenueTotal": float(r[6] or 0),
                "profitTotal": float(r[7] or 0),
                "savedAt": str(r[8]) if r[8] else "",
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.get("/api/costing/mode")
def get_costing_mode():
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_daily_engine_schema(cursor)
        cursor.execute("SELECT TOP 1 ModeCode FROM dbo.MAT3AM_COSTING_MODE ORDER BY UpdatedAt DESC, Id DESC")
        r = cursor.fetchone()
        return {"mode": (r[0] if r and r[0] else "hybrid")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.post("/api/costing/mode")
def set_costing_mode(body: dict):
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        mode = str((body or {}).get("mode") or "").strip().lower()
        if mode not in ("recipe", "sci", "hybrid"):
            raise HTTPException(status_code=400, detail="mode يجب أن يكون recipe أو sci أو hybrid")
        cursor = conn.cursor()
        _ensure_daily_engine_schema(cursor)
        cursor.execute("INSERT INTO dbo.MAT3AM_COSTING_MODE (ModeCode) VALUES (?)", (mode,))
        conn.commit()
        return {"ok": True, "mode": mode}
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


@app.get("/api/costing/unit-price")
def get_costing_unit_price(product_guide: str, invoice_type_guid: Optional[str] = None):
    """
    سعر الوحدة حسب دالة إكسترا:
    Select dbo.Fun182(8,1,@ProductGuide,0,@InvoiceTypeGuid,Null,...)
    """
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        pg = (product_guide or "").strip()
        if not pg:
            raise HTTPException(status_code=400, detail="product_guide مطلوب")
        inv = (invoice_type_guid or "DFA14CCE-1ECB-436F-A097-540FC9504504").strip()
        cursor.execute(
            """
            SELECT dbo.Fun182(
                8, 1,
                CAST(? AS uniqueidentifier),
                0,
                CAST(? AS uniqueidentifier),
                NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
                0,NULL,NULL,NULL
            ) AS UnitPrice
            """,
            (pg, inv),
        )
        r = cursor.fetchone()
        price = float(r[0] or 0) if r else 0.0
        return {"productGuide": pg, "invoiceTypeGuid": inv, "unitPrice": price}
    except HTTPException:
        raise
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


def _restaurant_next_kds_ticket_no(existing: list) -> int:
    """رقم عرض للمطبخ للطلبات غير المرتبطة برقم فاتورة — تسلسلي دون التصادم مع billNumber."""
    m = 0
    for o in existing:
        if not isinstance(o, dict):
            continue
        for key in ("billNumber", "ticketNo"):
            v = o.get(key)
            if isinstance(v, bool):
                continue
            if isinstance(v, int):
                m = max(m, v)
            elif isinstance(v, float):
                try:
                    m = max(m, int(v))
                except (TypeError, ValueError, OverflowError):
                    pass
            elif isinstance(v, str) and v.strip().isdigit():
                try:
                    m = max(m, int(v.strip()))
                except ValueError:
                    pass
    return m + 1


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


def _restaurant_workflow_default() -> dict:
    return {
        "receiveGuestBy": "host",            # manager | waiter | captain | customer_self | none
        "takeOrderBy": "waiter",             # manager | waiter | captain | customer_self | none
        "deliverFromKitchenBy": "server",    # server | waiter | kitchen_window
        "cleanTableBy": "server",            # server | waiter | cleaner
        "checkRequestBy": "waiter",          # waiter | manager | cashier
        "cashierDispatchMode": "both",       # visa_machine | cash_collector | both
    }


def _restaurant_workflow_path() -> str:
    os.makedirs(_restaurant_dir, exist_ok=True)
    return os.path.join(_restaurant_dir, "workflow_settings.json")


def _restaurant_read_workflow() -> dict:
    d = _restaurant_workflow_default()
    p = _restaurant_workflow_path()
    if not os.path.exists(p):
        return d
    try:
        with open(p, "r", encoding="utf-8") as f:
            j = json.load(f)
        if isinstance(j, dict):
            for k in d.keys():
                if k in j and str(j.get(k) or "").strip():
                    d[k] = str(j.get(k)).strip()
    except Exception:
        pass
    return d


def _restaurant_write_workflow(body: dict) -> dict:
    cur = _restaurant_read_workflow()
    if isinstance(body, dict):
        for k in list(cur.keys()):
            if k in body and str(body.get(k) or "").strip():
                cur[k] = str(body.get(k)).strip()
    p = _restaurant_workflow_path()
    with open(p, "w", encoding="utf-8") as f:
        json.dump(cur, f, ensure_ascii=False, indent=2)
    return cur


def _workflow_role_for(action: str) -> str:
    w = _restaurant_read_workflow()
    a = str(action or "").strip().lower()
    if a == "receive_guest":
        return str(w.get("receiveGuestBy") or "host")
    if a == "take_order":
        return str(w.get("takeOrderBy") or "waiter")
    if a == "pickup_kitchen":
        return str(w.get("deliverFromKitchenBy") or "server")
    if a == "clean_table":
        return str(w.get("cleanTableBy") or "server")
    if a == "request_check":
        return str(w.get("checkRequestBy") or "waiter")
    if a == "dispatch_cashier":
        return str(w.get("cashierDispatchMode") or "both")
    return "waiter"


@app.get("/api/restaurant/workflow-settings")
def restaurant_workflow_settings_get():
    return _restaurant_read_workflow()


@app.put("/api/restaurant/workflow-settings")
def restaurant_workflow_settings_put(body: dict):
    return _restaurant_write_workflow(body if isinstance(body, dict) else {})


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


def _floor_plan_sync_cost_centers_in_document(plan: dict) -> dict:
    if not isinstance(plan, dict):
        return {"changed": False, "synced": 0, "failed_labels": []}
    if isinstance(plan.get("floors"), list):
        floors = plan.get("floors") or []
    else:
        floors = [plan]
    changed = False
    synced = 0
    failed_labels = []
    for fi, flo in enumerate(floors):
        if not isinstance(flo, dict):
            continue
        nm = str(flo.get("name") or flo.get("id") or fi + 1).lower()
        floor_name = str(flo.get("name") or f"طابق {fi + 1}")
        floor_code_suffix = re.sub(r"[^A-Za-z0-9]+", "_", str(flo.get("id") or fi + 1)).strip("_").upper() or str(fi + 1)
        floor_code = f"FLOOR_{floor_code_suffix}"
        floor_gid = _upsert_cost_center_by_name(floor_name, None, floor_code)
        if not floor_gid:
            failed_labels.append(floor_name)
            continue
        if flo.get("floorCostCenterId") != floor_gid:
            flo["floorCostCenterId"] = floor_gid
            changed = True
        if any(k in nm for k in ("roof", "رووف", "روف")):
            prefix = "R"
        elif any(k in nm for k in ("خارجي", "حديقة", "خارجيه", "outdoor", "garden")):
            prefix = "E"
        else:
            prefix = str(fi + 1)
        tbls = flo.get("tables") if isinstance(flo.get("tables"), list) else []
        for ti, t in enumerate(tbls):
            if not isinstance(t, dict):
                continue
            suffix = str(ti + 1).zfill(2)
            code = f"{prefix}1{suffix}" if prefix in ("R", "E") else f"{prefix}{suffix}"
            manual_label = str(t.get("label") or "").strip()
            label = manual_label or (f"#{int(code)}" if code.isdigit() else code)
            gid = _upsert_cost_center_by_name(label, floor_gid, code)
            if not gid:
                failed_labels.append(label)
                continue
            synced += 1
            if gid and t.get("linkedTableId") != gid:
                t["linkedTableId"] = gid
                changed = True
            if not manual_label and t.get("label") != label:
                t["label"] = label
                changed = True
    return {"changed": changed, "synced": synced, "failed_labels": failed_labels}


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
        sync_res = _floor_plan_sync_cost_centers_in_document(plan)
        if sync_res["failed_labels"]:
            raise HTTPException(status_code=500, detail="فشل ربط بعض طاولات المخطط مع TBL005: " + ", ".join(sync_res["failed_labels"]))
        p = _restaurant_path("floor_plan")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(plan, f, ensure_ascii=False, indent=2)
        return {"ok": True, "syncedCostCenters": True, "updatedPlanLinks": sync_res["changed"], "syncedTables": sync_res["synced"]}

    if not _floor_plan_single_floor_valid(plan):
        raise HTTPException(status_code=400, detail="مخطط غير صالح: يلزم shell (مضلع ≥3 نقاط) و tables و id و name و width و height")
    sync_res = _floor_plan_sync_cost_centers_in_document(plan)
    if sync_res["failed_labels"]:
        raise HTTPException(status_code=500, detail="فشل ربط بعض طاولات المخطط مع TBL005: " + ", ".join(sync_res["failed_labels"]))
    p = _restaurant_path("floor_plan")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=2)
    return {"ok": True, "syncedCostCenters": True, "updatedPlanLinks": sync_res["changed"], "syncedTables": sync_res["synced"]}


@app.post("/api/restaurant/floor-plan/sync-cost-centers")
def restaurant_floor_plan_sync_cost_centers():
    """مزامنة طاولات المخطط مع مراكز الكلفة (TBL005) وتعبئة linkedTableId وأسماء العرض.
    - يشتق كودًا لكل طاولة: 1xx للطابق الأول، 2xx للثاني، E1xx للخارجي، R1xx للرووف.
    - يُنشئ أو يُعيد استخدام TBL005 بالاسم، ويكتب CardGuide في linkedTableId.
    """
    p = _restaurant_path("floor_plan")
    if not os.path.exists(p):
        raise HTTPException(status_code=400, detail="لا يوجد ملف مخطط")
    try:
        with open(p, "r", encoding="utf-8") as f:
            plan = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not isinstance(plan, dict):
        raise HTTPException(status_code=400, detail="مخطط غير صالح")
    sync_res = _floor_plan_sync_cost_centers_in_document(plan)
    if sync_res["failed_labels"]:
        raise HTTPException(status_code=500, detail="فشل ربط بعض طاولات المخطط مع TBL005: " + ", ".join(sync_res["failed_labels"]))
    if sync_res["changed"]:
        try:
            with open(p, "w", encoding="utf-8") as f:
                json.dump(plan, f, ensure_ascii=False, indent=2)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True, "changed": sync_res["changed"], "syncedTables": sync_res["synced"]}


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


def _restaurant_read_kitchen_item_stops() -> list:
    raw = _restaurant_load("kitchen_item_stops", [])
    return raw if isinstance(raw, list) else []


def _restaurant_write_kitchen_item_stops(items: list) -> list:
    arr = items if isinstance(items, list) else []
    _restaurant_save("kitchen_item_stops", arr)
    return arr


@app.get("/api/restaurant/kds-settings")
def restaurant_kds_settings_get():
    """زمن التحضير الافتراضي (دقيقة) ونافذة التنبيه قبل النهاية (دقيقة) — لوحة المطبخ."""
    return _restaurant_read_kds_settings()


@app.put("/api/restaurant/kds-settings")
def restaurant_kds_settings_put(body: dict):
    return _restaurant_write_kds_settings(body if isinstance(body, dict) else {})


@app.get("/api/restaurant/kitchen/item-stops")
def restaurant_kitchen_item_stops_get(active_only: bool = False):
    raw = _restaurant_read_kitchen_item_stops()
    out = [x for x in raw if isinstance(x, dict)]
    if active_only:
        out = [x for x in out if bool(x.get("stopped"))]
    out.sort(key=lambda x: str(x.get("updatedAt") or ""), reverse=True)
    return {"items": out}


@app.post("/api/restaurant/kitchen/item-stops/toggle")
def restaurant_kitchen_item_stops_toggle(body: dict):
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="جسم غير صالح")
    pg = str(body.get("productGuide") or "").strip()
    if not pg:
        raise HTTPException(status_code=400, detail="productGuide مطلوب")
    stopped = bool(body.get("stopped"))
    now = datetime.now().isoformat()
    raw = _restaurant_read_kitchen_item_stops()
    found = None
    for r in raw:
        if isinstance(r, dict) and str(r.get("productGuide") or "") == pg:
            found = r
            break
    if not found:
        found = {"productGuide": pg}
        raw.append(found)
    found["productName"] = str(body.get("productName") or found.get("productName") or "")
    found["stopped"] = stopped
    found["note"] = str(body.get("note") or "")
    found["updatedAt"] = now
    found["updatedBy"] = str(body.get("byUser") or body.get("actor") or "kitchen")
    if stopped:
        found["stoppedAt"] = now
    else:
        found["resumedAt"] = now
    _restaurant_write_kitchen_item_stops(raw)
    return {"ok": True, "item": found}


def _floor_plan_table_id_to_label() -> dict:
    """خريطة id الطاولة في المخطط → تسمية للعرض (label أو name)."""
    out: dict = {}
    p = _restaurant_path("floor_plan")
    if not os.path.isfile(p):
        return out
    try:
        with open(p, "r", encoding="utf-8") as f:
            plan = json.load(f)
        if not isinstance(plan, dict):
            return out

        def ingest_tables(tbl_list):
            if not isinstance(tbl_list, list):
                return
            for t in tbl_list:
                if not isinstance(t, dict):
                    continue
                tid = str(t.get("id") or "").strip()
                if not tid:
                    continue
                lab = (t.get("label") or t.get("name") or t.get("title") or "").strip()
                out[tid] = lab if lab else tid
                out[tid.upper()] = out[tid]

        if plan.get("schemaVersion") == 2:
            for fl in plan.get("floors") or []:
                if isinstance(fl, dict):
                    ingest_tables(fl.get("tables"))
        else:
            ingest_tables(plan.get("tables"))
    except Exception:
        pass
    return out


def _restaurant_file_tables_id_to_name() -> dict:
    out: dict = {}
    for t in _restaurant_load("tables", []):
        if not isinstance(t, dict) or not t.get("id"):
            continue
        tid = str(t.get("id")).strip()
        nm = (t.get("name") or "").strip()
        num = t.get("number")
        out[tid] = nm if nm else (f"طاولة {num}" if num is not None else tid)
    return out


def _restaurant_table_display_names_for_ids(table_ids: set) -> dict:
    """حلّ أسماء عرض للطاولة: ملف tables.json، مخطط الأرضية، ثم TBL005."""
    result: dict = {}
    if not table_ids:
        return result
    fp = _floor_plan_table_id_to_label()
    fm = _restaurant_file_tables_id_to_name()
    pending: list = []
    for tid in table_ids:
        if not tid:
            result[tid] = "—"
            continue
        ts = str(tid).strip()
        if ts in fm:
            result[tid] = fm[ts]
            continue
        if ts in fp:
            result[tid] = fp[ts]
            continue
        t_up = ts.upper()
        hit = None
        for k, v in fp.items():
            if str(k).upper() == t_up:
                hit = v
                break
        if hit:
            result[tid] = hit
            continue
        pending.append(tid)

    if pending:
        conn = get_connection()
        if conn:
            try:
                dbmap: dict = {}
                cur = conn.cursor()
                cur.execute("SELECT CardGuide, CostCenter FROM TBL005 WHERE CostCenter IS NOT NULL")
                for row in cur.fetchall():
                    if row and row[0]:
                        g = str(row[0]).strip()
                        name = (str(row[1]).strip() if row[1] is not None else "") or ""
                        dbmap[g.upper()] = name or g
                for tid in pending:
                    if tid in result:
                        continue
                    ts = str(tid).strip()
                    nm = dbmap.get(ts.upper())
                    if nm:
                        result[tid] = nm if len(nm) < 80 else (nm[:77] + "…")
                    else:
                        compact = ts.replace("-", "")
                        short = compact[-6:].upper() if len(compact) >= 6 else ts[:8]
                        result[tid] = f"طاولة (مرجع {short})"
            finally:
                try:
                    conn.close()
                except Exception:
                    pass
        for tid in pending:
            if tid not in result:
                ts = str(tid).strip()
                compact = ts.replace("-", "")
                short = compact[-6:].upper() if len(compact) >= 6 else ts[:8]
                result[tid] = f"طاولة (مرجع {short})"
    return result


def _restaurant_default_tables():
    """طاولات افتراضية حتى تظهر القائمة حتى بدون قاعدة أو ملف"""
    return [
        {"id": "t1", "number": 1, "name": "طاولة 1", "seats": 4, "status": "available", "position": {"x": 100, "y": 100}, "features": {"canAddChildSeat": True, "nearBalcony": False, "nearBathroom": False, "smokingArea": False, "vipSection": False}},
        {"id": "t2", "number": 2, "name": "طاولة 2", "seats": 2, "status": "available", "position": {"x": 300, "y": 100}, "features": {"canAddChildSeat": True, "nearBalcony": False, "nearBathroom": False, "smokingArea": False, "vipSection": False}},
        {"id": "t3", "number": 3, "name": "طاولة 3", "seats": 6, "status": "available", "position": {"x": 100, "y": 300}, "features": {"canAddChildSeat": True, "nearBalcony": False, "nearBathroom": False, "smokingArea": False, "vipSection": False}},
        {"id": "t4", "number": 4, "name": "طاولة 4", "seats": 4, "status": "available", "position": {"x": 300, "y": 300}, "features": {"canAddChildSeat": True, "nearBalcony": False, "nearBathroom": False, "smokingArea": False, "vipSection": False}},
        {"id": "t5", "number": 5, "name": "طاولة 5", "seats": 8, "status": "available", "position": {"x": 500, "y": 200}, "features": {"canAddChildSeat": True, "nearBalcony": False, "nearBathroom": False, "smokingArea": False, "vipSection": False}},
    ]


def _iso_to_local_dt(iso_s: str) -> Optional[datetime]:
    try:
        s = str(iso_s or "").strip()
        if not s:
            return None
        if s.endswith("Z"):
            s = s[:-1]
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _is_today_iso(iso_s: str) -> bool:
    dt = _iso_to_local_dt(iso_s)
    if not dt:
        return False
    now = datetime.now()
    return (dt.year, dt.month, dt.day) == (now.year, now.month, now.day)


def _local_table_state_map() -> dict:
    raw = _restaurant_load("tables", [])
    if not isinstance(raw, list):
        return {}
    out = {}
    for t in raw:
        if not isinstance(t, dict):
            continue
        tid = str(t.get("id") or "").strip().upper()
        if tid:
            out[tid] = t
    return out


def _session_active_today(s: dict) -> bool:
    if not isinstance(s, dict):
        return False
    if str(s.get("status") or "").lower() != "active":
        return False
    st = str(s.get("startTime") or "")
    return _is_today_iso(st)


def _close_stale_active_sessions() -> int:
    data = _restaurant_load("table_sessions", [])
    if not isinstance(data, list):
        return 0
    changed = 0
    now_iso = datetime.now().isoformat()
    for s in data:
        if not isinstance(s, dict):
            continue
        if str(s.get("status") or "").lower() != "active":
            continue
        if _is_today_iso(str(s.get("startTime") or "")):
            continue
        s["status"] = "completed"
        s["endTime"] = now_iso
        changed += 1
    if changed:
        _restaurant_save("table_sessions", data)
    return changed


def _table_no_order_overdue_map(threshold_minutes: int = 10) -> dict:
    """لكل tableId: تنبيه تأخر أخذ الطلب بعد التسكين (جلسة نشطة اليوم + بدون طلبات)."""
    sessions = _restaurant_load("table_sessions", [])
    if not isinstance(sessions, list):
        sessions = []
    orders = _restaurant_load("orders", [])
    if not isinstance(orders, list):
        orders = []
    now = datetime.now()
    by_sid = {}
    for o in orders:
        if not isinstance(o, dict):
            continue
        sid = str(o.get("sessionId") or "").strip()
        if not sid:
            continue
        by_sid[sid] = by_sid.get(sid, 0) + 1
    out = {}
    for s in sessions:
        if not _session_active_today(s):
            continue
        sid = str(s.get("id") or "").strip()
        tid = str(s.get("tableId") or "").strip()
        if not sid or not tid:
            continue
        if int(by_sid.get(sid, 0)) > 0:
            continue
        st = _iso_to_local_dt(str(s.get("startTime") or ""))
        if not st:
            continue
        mins = max(0, int((now - st).total_seconds() // 60))
        out[tid] = {"noOrderOverdue": mins >= int(threshold_minutes), "noOrderMinutes": mins}
    return out


def _mark_session_first_order_delay(session_id: str) -> None:
    sid = str(session_id or "").strip()
    if not sid:
        return
    sessions = _restaurant_load("table_sessions", [])
    if not isinstance(sessions, list):
        return
    changed = False
    now = datetime.now()
    for s in sessions:
        if not isinstance(s, dict):
            continue
        if str(s.get("id") or "").strip() != sid:
            continue
        if s.get("firstOrderAt"):
            break
        st = _iso_to_local_dt(str(s.get("startTime") or ""))
        mins = 0
        if st:
            mins = max(0, int((now - st).total_seconds() // 60))
        s["firstOrderAt"] = now.isoformat()
        s["firstOrderDelayMinutes"] = mins
        changed = True
        break
    if changed:
        _restaurant_save("table_sessions", sessions)

@app.get("/api/restaurant/tables")
def restaurant_get_tables():
    """جلب الطاولات — من مراكز التكلفة (TBL005) أولاً، ثم من ملف، ثم افتراضي"""
    plan_refs = []
    try:
        raw_doc = _restaurant_load("floor_plan", {})
        plan_doc = raw_doc.get("plan") if isinstance(raw_doc, dict) and isinstance(raw_doc.get("plan"), dict) else raw_doc
        floor = None
        if isinstance(plan_doc, dict) and plan_doc.get("schemaVersion") == 2 and isinstance(plan_doc.get("floors"), list):
            floors = [f for f in plan_doc.get("floors") if isinstance(f, dict)]
            active_id = str(plan_doc.get("activeFloorId") or "").strip()
            floor = next((f for f in floors if str(f.get("id") or "") == active_id), floors[0] if floors else None)
        elif isinstance(plan_doc, dict):
            floor = plan_doc
        for t in ((floor or {}).get("tables") or []):
            if not isinstance(t, dict):
                continue
            tid = str(t.get("linkedTableId") or "").strip()
            lab = str(t.get("label") or "").strip()
            if tid or lab:
                plan_refs.append({"linked_id": tid.upper(), "label": lab})
    except Exception:
        plan_refs = []

    _close_stale_active_sessions()
    local_state = _local_table_state_map()
    no_order_map = _table_no_order_overdue_map(10)

    # 1) قاعدة البيانات (TBL005)
    conn = get_connection()
    if conn:
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT CardGuide, CostCenter FROM TBL005 WHERE CostCenter IS NOT NULL ORDER BY CostCenter")
            rows = cursor.fetchall()
            row_by_id = {}
            row_by_name = {}
            for row in rows:
                gid = str(row[0] or "").upper()
                nm = str(row[1] or "")
                if gid:
                    row_by_id[gid] = row
                if nm:
                    row_by_name[nm] = row
            tables = []
            if plan_refs:
                used = set()
                for i, ref in enumerate(plan_refs, 1):
                    row = None
                    if ref["linked_id"]:
                        row = row_by_id.get(ref["linked_id"])
                    if row is None and ref["label"]:
                        row = row_by_name.get(ref["label"])
                    if row is None:
                        continue
                    gid = str(row[0])
                    if gid in used:
                        continue
                    used.add(gid)
                    st_row = local_state.get(gid.upper(), {})
                    status_v = str(st_row.get("status") or "ready")
                    dirty_at = st_row.get("dirtyAt")
                    clean_started = st_row.get("cleaningStartedAt")
                    overdue = False
                    if status_v == "dirty" and dirty_at:
                        ddt = _iso_to_local_dt(str(dirty_at))
                        if ddt and (datetime.now() - ddt).total_seconds() >= 600:
                            overdue = True
                    no_order_info = no_order_map.get(gid, {}) if isinstance(no_order_map, dict) else {}
                    tables.append({
                        "id": gid,
                        "number": i,
                        "name": ref["label"] or (row[1] or ("طاولة " + str(i))),
                        "seats": 4,
                        "status": status_v,
                        "dirtyAt": dirty_at,
                        "cleaningStartedAt": clean_started,
                        "cleanupOverdue": overdue,
                        "noOrderOverdue": bool(no_order_info.get("noOrderOverdue")),
                        "noOrderMinutes": int(no_order_info.get("noOrderMinutes") or 0),
                        "position": {"x": 50 + (i % 5) * 120, "y": 50 + (i // 5) * 100},
                        "features": {"canAddChildSeat": True, "nearBalcony": False, "nearBathroom": False, "smokingArea": False, "vipSection": False},
                    })
            else:
                for i, row in enumerate(rows, 1):
                    gid = str(row[0])
                    st_row = local_state.get(gid.upper(), {})
                    status_v = str(st_row.get("status") or "ready")
                    dirty_at = st_row.get("dirtyAt")
                    clean_started = st_row.get("cleaningStartedAt")
                    overdue = False
                    if status_v == "dirty" and dirty_at:
                        ddt = _iso_to_local_dt(str(dirty_at))
                        if ddt and (datetime.now() - ddt).total_seconds() >= 600:
                            overdue = True
                    no_order_info = no_order_map.get(gid, {}) if isinstance(no_order_map, dict) else {}
                    tables.append({
                        "id": str(row[0]),
                        "number": i,
                        "name": row[1] or ("طاولة " + str(i)),
                        "seats": 4,
                        "status": status_v,
                        "dirtyAt": dirty_at,
                        "cleaningStartedAt": clean_started,
                        "cleanupOverdue": overdue,
                        "noOrderOverdue": bool(no_order_info.get("noOrderOverdue")),
                        "noOrderMinutes": int(no_order_info.get("noOrderMinutes") or 0),
                        "position": {"x": 50 + (i % 5) * 120, "y": 50 + (i // 5) * 100},
                        "features": {"canAddChildSeat": True, "nearBalcony": False, "nearBathroom": False, "smokingArea": False, "vipSection": False},
                    })
            if tables:
                return {"tables": tables}
        except Exception:
            pass
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # 2) ملف محلي (لبيئات بدون قاعدة)
    data = _restaurant_load("tables", [])
    if data:
        out = []
        for t in data:
            if not isinstance(t, dict):
                continue
            tid = str(t.get("id") or "").strip()
            st = str(t.get("status") or "ready")
            dirty_at = t.get("dirtyAt")
            overdue = False
            if st == "dirty" and dirty_at:
                ddt = _iso_to_local_dt(str(dirty_at))
                if ddt and (datetime.now() - ddt).total_seconds() >= 600:
                    overdue = True
            no_order_info = no_order_map.get(tid, {}) if isinstance(no_order_map, dict) else {}
            row = dict(t)
            row["cleanupOverdue"] = overdue
            row["noOrderOverdue"] = bool(no_order_info.get("noOrderOverdue"))
            row["noOrderMinutes"] = int(no_order_info.get("noOrderMinutes") or 0)
            out.append(row)
        return {"tables": out}

    # 3) افتراضي
    out = []
    for t in _restaurant_default_tables():
        tid = str((t or {}).get("id") or "").strip()
        no_order_info = no_order_map.get(tid, {}) if isinstance(no_order_map, dict) else {}
        row = dict(t)
        row["cleanupOverdue"] = False
        row["noOrderOverdue"] = bool(no_order_info.get("noOrderOverdue"))
        row["noOrderMinutes"] = int(no_order_info.get("noOrderMinutes") or 0)
        out.append(row)
    return {"tables": out}

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
    # upsert into TBL005 as a cost center
    try:
        cc_label = str(rec.get("name") or "").strip()
        _upsert_cost_center_by_name(cc_label)
    except Exception:
        pass
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
    raw = str((body or {}).get("status") or "").strip().lower()
    status = raw or "ready"
    if status in ("available", "free", "open", "جاهزة", "متاحة"):
        status = "ready"
    elif status in ("busy", "occupied", "مشغولة"):
        status = "occupied"
    elif status in ("reserved", "محجوزة"):
        status = "reserved"
    elif status in ("dirty", "متسخة"):
        status = "dirty"
    elif status in ("cleaning", "تنظيف"):
        status = "cleaning"
    elif status not in ("ready", "occupied", "reserved", "dirty", "cleaning"):
        status = "ready"
    data = _restaurant_load("tables", [])
    now_iso = datetime.now().isoformat()
    for t in data:
        if t.get("id") == table_id:
            t["status"] = status
            t["statusUpdatedAt"] = now_iso
            if status == "dirty":
                t["dirtyAt"] = now_iso
                t["cleaningStartedAt"] = None
                t["readyAt"] = None
            elif status == "cleaning":
                t["cleaningStartedAt"] = now_iso
            elif status == "ready":
                t["readyAt"] = now_iso
                t["dirtyAt"] = None
                t["cleaningStartedAt"] = None
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
                rec = {"id": table_id, "status": status, "name": row[1], "statusUpdatedAt": now_iso}
                if status == "dirty":
                    rec["dirtyAt"] = now_iso
                if status == "cleaning":
                    rec["cleaningStartedAt"] = now_iso
                if status == "ready":
                    rec["readyAt"] = now_iso
                # cache in local file to preserve operational lifecycle timestamps
                data.append(rec)
                _restaurant_save("tables", data)
                return rec
        except Exception:
            pass
    return {"id": table_id, "status": status}


@app.patch("/api/restaurant/tables/{table_id}/mark-dirty")
def restaurant_table_mark_dirty(table_id: str):
    return restaurant_update_table_status(table_id, {"status": "dirty"})


@app.patch("/api/restaurant/tables/{table_id}/start-cleaning")
def restaurant_table_start_cleaning(table_id: str):
    return restaurant_update_table_status(table_id, {"status": "cleaning"})


@app.patch("/api/restaurant/tables/{table_id}/mark-ready")
def restaurant_table_mark_ready(table_id: str):
    return restaurant_update_table_status(table_id, {"status": "ready"})


def _restaurant_session_order_counts() -> dict:
    """عدد الطلبات (أي سجل) لكل sessionId."""
    counts: dict = {}
    for o in _restaurant_load("orders", []):
        if not isinstance(o, dict):
            continue
        sid = str(o.get("sessionId") or "").strip()
        if sid:
            counts[sid] = counts.get(sid, 0) + 1
    return counts


def _session_table_display_fallback(tid: str) -> str:
    ts = str(tid or "").strip()
    if not ts:
        return "بدون طاولة"
    compact = ts.replace("-", "")
    short = compact[-6:].upper() if len(compact) >= 6 else ts[:8]
    return f"طاولة ·{short}"


def _pick_default_cash_agent_guid(cursor) -> Optional[str]:
    """
    اختيار عميل افتراضي للفواتير:
    1) اسم العميل يحتوي cash / عميل نقدي / نقدا / نقدي
    2) fallback: آخر عميل متاح.
    """
    try:
        cursor.execute(
            """
            SELECT TOP 1 CardGuide
            FROM TBL016
            WHERE AgentName IS NOT NULL
              AND (
                   AgentName LIKE N'%cash%'
                OR AgentName LIKE N'%CASH%'
                OR AgentName LIKE N'%عميل نقدي%'
                OR AgentName LIKE N'%نقدا%'
                OR AgentName LIKE N'%نقدي%'
              )
            ORDER BY ID DESC
            """
        )
        r = cursor.fetchone()
        if r and r[0]:
            return str(r[0])
    except Exception:
        pass
    try:
        cursor.execute("SELECT TOP 1 CardGuide FROM TBL016 ORDER BY ID DESC")
        r = cursor.fetchone()
        return str(r[0]) if r and r[0] else None
    except Exception:
        return None


@app.get("/api/restaurant/table-sessions")
def restaurant_get_sessions(status: Optional[str] = None, today_only: bool = True):
    """جلسات الطاولات — يُضاف tableDisplayName و linkedOrderCount لصفحة الكاشير."""
    _close_stale_active_sessions()
    data = _restaurant_load("table_sessions", [])
    if status:
        data = [s for s in data if s.get("status") == status]
    if today_only:
        data = [s for s in data if _is_today_iso(str((s or {}).get("startTime") or ""))]
    counts = _restaurant_session_order_counts()
    tids = set()
    for s in data:
        if isinstance(s, dict) and s.get("tableId"):
            tids.add(str(s.get("tableId")).strip())
    tids.discard("")
    name_map = _restaurant_table_display_names_for_ids(tids)
    fm = _restaurant_file_tables_id_to_name()
    out = []
    for s in data:
        if not isinstance(s, dict):
            continue
        row = dict(s)
        tid = str(s.get("tableId") or "").strip()
        disp = (name_map.get(tid) or "").strip() if tid else ""
        if not disp or disp == "—":
            disp = (fm.get(tid) or "").strip() if tid else ""
        if not disp or disp == "—":
            disp = _session_table_display_fallback(tid) if tid else "بدون طاولة"
        row["tableDisplayName"] = disp
        row["linkedOrderCount"] = int(counts.get(str(s.get("id")), 0))
        out.append(row)
    out.sort(key=lambda x: str(x.get("startTime") or ""), reverse=True)
    return {"sessions": out}


@app.post("/api/restaurant/table-sessions")
def restaurant_create_session(body: dict):
    """إنشاء جلسة طاولة (إسكان). جلسة نشطة واحدة منطقياً لكل tableId: إن وُجدت تُعاد كما هي ما لم يُمرَّر forceNewSession."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="جسم غير صالح")
    table_id = str(body.get("tableId") or "").strip()
    if not table_id:
        raise HTTPException(status_code=400, detail="tableId مطلوب")
    force_new = body.get("forceNewSession") in (True, "1", "true", "yes", 1)
    _close_stale_active_sessions()
    data = _restaurant_load("table_sessions", [])
    if not isinstance(data, list):
        data = []
    if not force_new:
        for s in data:
            if not isinstance(s, dict):
                continue
            if str(s.get("status") or "").lower() != "active":
                continue
            if not _is_today_iso(str(s.get("startTime") or "")):
                continue
            if str(s.get("tableId") or "").strip() != table_id:
                continue
            gc = body.get("guestCount")
            if gc is not None:
                try:
                    s["guestCount"] = max(1, int(gc))
                except (TypeError, ValueError):
                    pass
            cc = body.get("childrenCount")
            if cc is not None:
                try:
                    s["childrenCount"] = max(0, int(cc))
                except (TypeError, ValueError):
                    pass
            pref = body.get("preferences")
            if isinstance(pref, dict) and pref:
                base = s.get("preferences") if isinstance(s.get("preferences"), dict) else {}
                merged = {**base, **pref}
                s["preferences"] = merged
            _restaurant_save("table_sessions", data)
            try:
                restaurant_update_table_status(table_id, {"status": "occupied"})
            except Exception:
                pass
            s["workflow"] = {
                "receiveGuestBy": _workflow_role_for("receive_guest"),
                "takeOrderBy": _workflow_role_for("take_order"),
            }
            return s
    sid = str(uuid.uuid4())
    rec = {
        "id": sid,
        "tableId": table_id,
        "projectId": body.get("projectId"),
        "hostId": body.get("hostId"),
        "guestCount": body.get("guestCount", 1),
        "childrenCount": body.get("childrenCount", 0),
        "preferences": body.get("preferences", {}) if isinstance(body.get("preferences"), dict) else {},
        "startTime": datetime.now().isoformat(),
        "status": "active",
    }
    data.append(rec)
    _restaurant_save("table_sessions", data)
    try:
        restaurant_update_table_status(table_id, {"status": "occupied"})
    except Exception:
        pass
    rec["workflow"] = {
        "receiveGuestBy": _workflow_role_for("receive_guest"),
        "takeOrderBy": _workflow_role_for("take_order"),
    }
    return rec


@app.post("/api/restaurant/table-sessions/cleanup-duplicate-empties")
def restaurant_cleanup_duplicate_empty_sessions():
    """إنهاء جلسات مكررة لنفس الطاولة إن كانت فارغة (0 طلبات) ولم يُطلب لها حساب. تُبقى جلسة واحدة مفضّلة (بطلبات / طلب حساب / الأحدث)."""
    data = _restaurant_load("table_sessions", [])
    if not isinstance(data, list):
        data = []
    counts = _restaurant_session_order_counts()
    by_table: dict = {}
    for s in data:
        if not isinstance(s, dict):
            continue
        if str(s.get("status") or "").lower() != "active":
            continue
        tid = str(s.get("tableId") or "").strip()
        if not tid:
            continue
        by_table.setdefault(tid, []).append(s)
    now_iso = datetime.now().isoformat()
    completed: list = []
    for _tid, lst in by_table.items():
        if len(lst) <= 1:
            continue

        def rank(s):
            sid = str(s.get("id") or "")
            oc = int(counts.get(sid, 0))
            br = 1 if s.get("billingRequestedAt") else 0
            st = str(s.get("startTime") or "")
            return (oc > 0, br, st)

        lst_sorted = sorted(lst, key=rank, reverse=True)
        keep_id = str(lst_sorted[0].get("id") or "")
        for s in lst_sorted[1:]:
            sid = str(s.get("id") or "")
            if sid == keep_id:
                continue
            if int(counts.get(sid, 0)) > 0:
                continue
            if s.get("billingRequestedAt"):
                continue
            s["status"] = "completed"
            s["endTime"] = now_iso
            completed.append(sid)
    _restaurant_save("table_sessions", data)
    return {"ok": True, "completedSessionIds": completed, "count": len(completed)}

@app.patch("/api/restaurant/table-sessions/{session_id}/complete")
def restaurant_complete_session(session_id: str, force: bool = Query(False, description="تجاوز فحص فاتورة بانتظار التسديد (غير مستحسن)")):
    """إغلاق سجل الجلسة في الملف المحلي فقط — لا يُسدّد فاتورة ولا يحذف الطلبات.
    إن وُجدت فاتورة محلية بانتظار الكاشير لنفس الجلسة يُرفض الإغلاق ما لم يُمرَّر force=true."""
    if not force:
        invs = _restaurant_load("invoices", [])
        if isinstance(invs, list):
            for inv in invs:
                if not isinstance(inv, dict):
                    continue
                if str(inv.get("sessionId") or "").strip() != str(session_id).strip():
                    continue
                if not inv.get("awaitingPayment"):
                    continue
                if str(inv.get("paidAt") or "").strip():
                    continue
                raise HTTPException(
                    status_code=409,
                    detail="توجد فاتورة بانتظار التسديد لهذه الجلسة. افتح «فواتير المطعم (كاشير)» واضغط تسديد (مع «إغلاق الجلسة» إن رغبت)، ثم أعد المحاولة. أو أضف ?force=true للتجاوز.",
                )
    data = _restaurant_load("table_sessions", [])
    for s in data:
        if s.get("id") == session_id:
            s["endTime"] = datetime.now().isoformat()
            s["status"] = "completed"
            _restaurant_save("table_sessions", data)
            try:
                tid = str(s.get("tableId") or "").strip()
                if tid:
                    restaurant_update_table_status(tid, {"status": "dirty"})
            except Exception:
                pass
            return s
    raise HTTPException(status_code=404, detail="الجلسة غير موجودة")


def _cashier_alert_parse_ts(iso_s: str) -> float:
    try:
        s = str(iso_s or "").strip()
        if s.endswith("Z"):
            s = s[:-1]
        return datetime.fromisoformat(s).timestamp()
    except Exception:
        return 0.0


def _cashier_load_alerts() -> list:
    raw = _restaurant_load("cashier_alerts", [])
    return raw if isinstance(raw, list) else []


def _cashier_save_alerts(data: list) -> None:
    _restaurant_save("cashier_alerts", data)


@app.get("/api/restaurant/cashier/table-overview")
def restaurant_cashier_table_overview():
    """جلسات نشطة + ملخص بنود وطلب حساب/انتظار تسديد — استدعاء واحد للكاشير (شرائح الطاولات)."""
    sessions = _restaurant_load("table_sessions", [])
    if not isinstance(sessions, list):
        sessions = []
    orders_all = _restaurant_load("orders", [])
    if not isinstance(orders_all, list):
        orders_all = []
    invs = _restaurant_load("invoices", [])
    if not isinstance(invs, list):
        invs = []

    _close_stale_active_sessions()
    active = [s for s in sessions if isinstance(s, dict) and _session_active_today(s)]
    tids = set()
    for s in active:
        tid = str(s.get("tableId") or "").strip()
        if tid:
            tids.add(tid)
    name_map = _restaurant_table_display_names_for_ids(tids)
    fm = _restaurant_file_tables_id_to_name()

    await_inv: dict = {}
    for inv in invs:
        if not isinstance(inv, dict):
            continue
        if not inv.get("awaitingPayment"):
            continue
        if str(inv.get("paidAt") or "").strip():
            continue
        sid = str(inv.get("sessionId") or "").strip()
        if sid:
            await_inv[sid] = str(inv.get("invoiceId") or "")

    items_out: list = []
    for s in active:
        sid = str(s.get("id") or "")
        tid = str(s.get("tableId") or "").strip()
        disp = (name_map.get(tid) or "").strip() if tid else ""
        if not disp or disp == "—":
            disp = (fm.get(tid) or "").strip() if tid else ""
        if not disp or disp == "—":
            disp = _session_table_display_fallback(tid) if tid else "بدون طاولة"

        sess_orders = [
            o
            for o in orders_all
            if isinstance(o, dict)
            and str(o.get("sessionId") or "") == sid
            and str(o.get("status") or "").lower() != "cancelled"
        ]
        subtotal = 0.0
        preview_parts: list = []
        kitchen_pending = 0
        for o in sess_orders:
            st = str(o.get("status") or "").lower()
            if st in ("pending", "preparing"):
                kitchen_pending += 1
            for it in o.get("items") or []:
                if not isinstance(it, dict):
                    continue
                try:
                    q = float(it.get("quantity") or 0)
                except (TypeError, ValueError):
                    q = 0.0
                try:
                    p = float(it.get("unitPrice") or 0)
                except (TypeError, ValueError):
                    p = 0.0
                subtotal += q * p
                nm = str(it.get("name") or "").strip() or "صنف"
                if q and int(q) == q:
                    preview_parts.append(f"{nm}×{int(q)}")
                else:
                    preview_parts.append(f"{nm}×{round(q, 2)}")
        prev = "، ".join(preview_parts[:10])
        if len(prev) > 140:
            prev = prev[:137] + "…"

        bill_req = str(s.get("billingRequestedAt") or "").strip() or None
        inv_id = await_inv.get(sid, "")
        items_out.append(
            {
                "sessionId": sid,
                "tableId": tid,
                "tableDisplayName": disp,
                "guestCount": s.get("guestCount"),
                "billingRequestedAt": bill_req,
                "awaitingPayment": bool(inv_id),
                "awaitingInvoiceId": inv_id or None,
                "orderCount": len(sess_orders),
                "kitchenInProgressCount": kitchen_pending,
                "linesPreview": prev or "—",
                "itemsSubtotal": round(subtotal, 2),
            }
        )

    def _sort_key(x: dict):
        ap = 0 if x.get("awaitingPayment") else 1
        br = 0 if x.get("billingRequestedAt") else 1
        return (ap, br, str(x.get("tableDisplayName") or ""))

    items_out.sort(key=_sort_key)
    return {"generatedAt": datetime.now().isoformat(), "count": len(items_out), "sessions": items_out}


@app.get("/api/restaurant/cashier/alerts")
def restaurant_cashier_alerts_list():
    raw = _cashier_load_alerts()
    out = [a for a in raw if isinstance(a, dict) and not str(a.get("dismissedAt") or "").strip()]
    out.sort(key=lambda x: str(x.get("createdAt") or ""), reverse=True)
    return {"alerts": out[:40], "count": len(out)}


@app.post("/api/restaurant/cashier/alerts")
def restaurant_cashier_alerts_create(body: dict):
    """تنبيه للكاشير — منع تكرار لنفس sourceKey خلال 180 ثانية."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="جسم غير صالح")
    typ = str(body.get("type") or "").strip().lower()
    if typ not in ("kitchen_urgent", "waiter_summon"):
        raise HTTPException(status_code=400, detail="type يجب kitchen_urgent أو waiter_summon")
    source_key = str(body.get("sourceKey") or "").strip()
    title = str(body.get("title") or body.get("message") or "").strip()[:200]
    if not title:
        title = "استعجال مطبخ" if typ == "kitchen_urgent" else "استدعاء من الصالة"
    body_text = str(body.get("body") or body.get("detail") or "").strip()[:500]
    now_iso = datetime.now().isoformat()
    now_ts = datetime.now().timestamp()
    raw = _cashier_load_alerts()

    if source_key:
        for a in reversed(raw):
            if not isinstance(a, dict):
                continue
            if str(a.get("dismissedAt") or "").strip():
                continue
            if str(a.get("sourceKey") or "") != source_key:
                continue
            if now_ts - _cashier_alert_parse_ts(str(a.get("createdAt") or "")) <= 180:
                return {"ok": True, "deduped": True, "id": a.get("id"), "alert": a}

    rec = {
        "id": str(uuid.uuid4()),
        "type": typ,
        "title": title,
        "body": body_text or None,
        "tableId": str(body.get("tableId") or "").strip() or None,
        "sessionId": str(body.get("sessionId") or "").strip() or None,
        "orderId": str(body.get("orderId") or "").strip() or None,
        "sourceKey": source_key or None,
        "createdAt": now_iso,
        "dismissedAt": None,
    }
    raw.append(rec)
    if len(raw) > 500:
        raw = raw[-500:]
    _cashier_save_alerts(raw)
    return {"ok": True, "deduped": False, "id": rec["id"], "alert": rec}


@app.patch("/api/restaurant/cashier/alerts/{alert_id}/dismiss")
def restaurant_cashier_alerts_dismiss(alert_id: str):
    raw = _cashier_load_alerts()
    now_iso = datetime.now().isoformat()
    for a in raw:
        if isinstance(a, dict) and str(a.get("id") or "") == str(alert_id):
            a["dismissedAt"] = now_iso
            _cashier_save_alerts(raw)
            return {"ok": True, "id": alert_id}
    raise HTTPException(status_code=404, detail="التنبيه غير موجود")


def _append_session_audit_entry(entry: dict) -> None:
    p = _restaurant_path("session_audit")
    arr: list = []
    if os.path.isfile(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, list):
                arr = raw
        except Exception:
            pass
    arr.append(entry)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(arr, f, ensure_ascii=False, indent=2)


@app.patch("/api/restaurant/table-sessions/{session_id}")
def restaurant_patch_session(session_id: str, body: dict):
    """نقل جلسة نشطة إلى طاولة أخرى (نفس sessionId) + تحديث tableId في الطلبات المرتبطة."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="جسم غير صالح")
    new_table = str(body.get("tableId") or "").strip()
    if not new_table:
        raise HTTPException(status_code=400, detail="tableId مطلوب")
    data = _restaurant_load("table_sessions", [])
    found = None
    for s in data:
        if str(s.get("id")) == str(session_id):
            found = s
            break
    if not found:
        raise HTTPException(status_code=404, detail="الجلسة غير موجودة")
    if str(found.get("status") or "").lower() != "active":
        raise HTTPException(status_code=400, detail="لا يمكن نقل جلسة غير نشطة")
    old_table = found.get("tableId")
    found["tableId"] = new_table
    _restaurant_save("table_sessions", data)
    odata = _restaurant_load("orders", [])
    for o in odata:
        if str(o.get("sessionId") or "") == str(session_id):
            o["tableId"] = new_table
    _restaurant_save("orders", odata)
    _append_session_audit_entry(
        {
            "at": datetime.now().isoformat(),
            "action": "transfer_table",
            "sessionId": str(session_id),
            "fromTableId": old_table,
            "toTableId": new_table,
            "actor": (body.get("actor") or body.get("userLogin") or body.get("user") or "")[:200],
        }
    )
    return {"ok": True, "session": found}


@app.post("/api/restaurant/table-sessions/{session_id}/merge")
def restaurant_merge_session(session_id: str, body: dict):
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="جسم غير صالح")
    target_table_id = str(body.get("targetTableId") or "").strip()
    if not target_table_id:
        raise HTTPException(status_code=400, detail="targetTableId مطلوب")
    sessions = _restaurant_load("table_sessions", [])
    if not isinstance(sessions, list):
        sessions = []
    src = None
    dst = None
    for s in sessions:
        if not isinstance(s, dict):
            continue
        if str(s.get("id") or "") == str(session_id):
            src = s
        if str(s.get("tableId") or "") == target_table_id and str(s.get("status") or "").lower() == "active":
            dst = s
    if not src:
        raise HTTPException(status_code=404, detail="الجلسة المصدر غير موجودة")
    if str(src.get("status") or "").lower() != "active":
        raise HTTPException(status_code=400, detail="الجلسة المصدر غير نشطة")
    if not dst:
        raise HTTPException(status_code=404, detail="لا توجد جلسة نشطة للطاولة الهدف")
    if str(dst.get("id") or "") == str(session_id):
        raise HTTPException(status_code=400, detail="لا يمكن دمج الجلسة مع نفسها")
    orders = _restaurant_load("orders", [])
    if not isinstance(orders, list):
        orders = []
    for o in orders:
        if not isinstance(o, dict):
            continue
        if str(o.get("sessionId") or "") == str(session_id):
            o["sessionId"] = str(dst.get("id"))
            o["tableId"] = str(dst.get("tableId"))
    _restaurant_save("orders", orders)
    try:
        src_gc = int(src.get("guestCount") or 0)
        dst_gc = int(dst.get("guestCount") or 0)
        if src_gc > 0:
            dst["guestCount"] = dst_gc + src_gc
    except Exception:
        pass
    src["status"] = "merged"
    src["mergedIntoSessionId"] = str(dst.get("id"))
    src["closedAt"] = datetime.now().isoformat()
    _restaurant_save("table_sessions", sessions)
    _append_session_audit_entry(
        {
            "at": datetime.now().isoformat(),
            "action": "merge_table",
            "sessionId": str(session_id),
            "fromTableId": src.get("tableId"),
            "toTableId": dst.get("tableId"),
            "targetSessionId": str(dst.get("id")),
            "actor": (body.get("actor") or body.get("userLogin") or body.get("user") or "")[:200],
        }
    )
    return {"ok": True, "sourceSessionId": str(session_id), "targetSession": dst}


@app.get("/api/restaurant/daily-menu")
def restaurant_daily_menu_get():
    """قائمة اليوم للفلترة في الجرسون/POS — ملف daily_menu.json"""
    p = _restaurant_path("daily_menu")
    if not os.path.isfile(p):
        return {"menu": {"forDate": "", "allowedTokens": [], "notes": ""}}
    try:
        with open(p, "r", encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, dict):
            toks = d.get("allowedTokens")
            if not isinstance(toks, list):
                toks = []
            return {
                "menu": {
                    "forDate": str(d.get("forDate") or ""),
                    "allowedTokens": [str(x) for x in toks if x is not None],
                    "notes": str(d.get("notes") or ""),
                }
            }
    except Exception:
        pass
    return {"menu": {"forDate": "", "allowedTokens": [], "notes": ""}}


@app.put("/api/restaurant/daily-menu")
def restaurant_daily_menu_put(body: dict):
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="يتوقع JSON")
    m = body.get("menu") if isinstance(body.get("menu"), dict) else body
    if not isinstance(m, dict):
        raise HTTPException(status_code=400, detail="menu غير صالح")
    toks = m.get("allowedTokens")
    if not isinstance(toks, list):
        toks = []
    out = {
        "forDate": str(m.get("forDate") or "")[:32],
        "allowedTokens": [str(x).strip() for x in toks if str(x).strip()][:500],
        "notes": str(m.get("notes") or "")[:4000],
    }
    p = _restaurant_path("daily_menu")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    return {"ok": True, "menu": out}


# --- Daily menu schedule: date ranges mapped to explicit TBL007 products ---
@app.get("/api/restaurant/daily-menu-schedule")
def restaurant_daily_menu_schedule_get():
    """جدولة القائمة اليومية حسب الأصناف: entries[{dateFrom,dateTo,items[{ProductGuide,ProductName}]}]"""
    p = _restaurant_path("daily_menu_schedule")
    if not os.path.isfile(p):
        return {"entries": []}
    try:
        with open(p, "r", encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, dict) and isinstance(d.get("entries"), list):
            out_entries = []
            for e in d["entries"]:
                if not isinstance(e, dict):
                    continue
                date_from = str(e.get("dateFrom") or "")[:32]
                date_to = str(e.get("dateTo") or "")[:32]
                items = e.get("items") if isinstance(e.get("items"), list) else []
                norm_items = []
                for it in items:
                    if not isinstance(it, dict):
                        continue
                    pg = str(it.get("ProductGuide") or it.get("CardGuide") or "")
                    pn = str(it.get("ProductName") or it.get("name") or "")
                    if pg:
                        norm_items.append({"ProductGuide": pg, "ProductName": pn})
                out_entries.append({"dateFrom": date_from, "dateTo": date_to or date_from, "items": norm_items[:300]})
            return {"entries": out_entries}
    except Exception:
        pass
    return {"entries": []}


@app.put("/api/restaurant/daily-menu-schedule")
def restaurant_daily_menu_schedule_put(body: dict):
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="يتوقع JSON")
    entries = body.get("entries") if isinstance(body.get("entries"), list) else []
    out_entries = []
    for e in entries:
        if not isinstance(e, dict):
            continue
        df = str(e.get("dateFrom") or "")[:32]
        dt = str(e.get("dateTo") or df)[:32]
        items = e.get("items") if isinstance(e.get("items"), list) else []
        norm_items = []
        for it in items:
            if not isinstance(it, dict):
                continue
            pg = str(it.get("ProductGuide") or it.get("CardGuide") or "")
            pn = str(it.get("ProductName") or it.get("name") or "")
            if pg:
                norm_items.append({"ProductGuide": pg, "ProductName": pn})
        out_entries.append({"dateFrom": df, "dateTo": dt, "items": norm_items[:300]})
    p = _restaurant_path("daily_menu_schedule")
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"entries": out_entries}, f, ensure_ascii=False, indent=2)
    return {"ok": True, "entries": out_entries}


@app.get("/api/restaurant/invoices-local")
def restaurant_invoices_local(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    payment_status: Optional[str] = None,
):
    """فواتير محلية — بعد «طلب الحساب» تظهر بـ awaitingPayment حتى يُسدّد الكاشير.
    payment_status: awaiting | paid | all (افتراضي all للتوافق)."""
    raw = _restaurant_load("invoices", [])
    if not isinstance(raw, list):
        raw = []
    ps = (payment_status or "all").strip().lower()
    rows = []
    for inv in raw:
        if not isinstance(inv, dict):
            continue
        awaiting = bool(inv.get("awaitingPayment"))
        paid_at = str(inv.get("paidAt") or "").strip()
        if ps == "awaiting" and not awaiting:
            continue
        if ps == "paid" and not paid_at:
            continue
        ref = paid_at if paid_at else str(inv.get("requestedAt") or inv.get("paidAt") or "")
        day = ref[:10] if len(ref) >= 10 else ""
        if date_from and day and day < date_from[:10]:
            continue
        if date_to and day and day > date_to[:10]:
            continue
        rows.append(inv)
    rows.sort(key=lambda x: str(x.get("requestedAt") or x.get("paidAt") or ""), reverse=True)
    return {"invoices": rows, "count": len(rows)}


@app.post("/api/restaurant/invoices-local/mark-paid")
def restaurant_invoices_local_mark_paid(body: dict):
    """تسديد فاتورة انتظار الكاشير — يحدّث الملف المحلي ويحاول تحديث TBL022.Paid."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="جسم غير صالح")
    invoice_id = str(body.get("invoiceId") or "").strip()
    if not invoice_id:
        raise HTTPException(status_code=400, detail="invoiceId مطلوب")
    raw = _restaurant_load("invoices", [])
    if not isinstance(raw, list):
        raw = []
    found = None
    for inv in raw:
        if isinstance(inv, dict) and str(inv.get("invoiceId") or "") == invoice_id:
            found = inv
            break
    if not found:
        raise HTTPException(status_code=404, detail="الفاتورة غير موجودة في السجل المحلي")
    if str(found.get("paidAt") or "").strip():
        raise HTTPException(status_code=409, detail="الفاتورة مُسدَّدة مسبقاً")
    amt = found.get("total")
    try:
        paid_amt = float(amt) if amt is not None else 0.0
    except (TypeError, ValueError):
        paid_amt = 0.0
    now_iso = datetime.now().isoformat()
    found["awaitingPayment"] = False
    found["paidAt"] = now_iso
    found["paymentMethod"] = str(body.get("paymentMethod") or "cash")[:40]
    _restaurant_save("invoices", raw)
    conn = get_connection()
    if conn:
        try:
            cur = conn.cursor()
            cur.execute(
                "UPDATE TBL022 SET Paid = ? WHERE CardGuide = CAST(? AS uniqueidentifier)",
                (paid_amt, invoice_id),
            )
            conn.commit()
        except Exception as ex:
            print("[mat3am] mark-paid TBL022:", ex)
        finally:
            try:
                conn.close()
            except Exception:
                pass
    sid = str(found.get("sessionId") or "").strip()
    if sid:
        # إغلاق تلقائي عند اكتمال التسديد لكل فواتير الجلسة في السجل المحلي.
        # closeSession=true يبقى إجبارياً، وإلا يغلق فقط عند عدم وجود أي فاتورة معلّقة.
        pending_for_session = any(
            isinstance(inv, dict)
            and str(inv.get("sessionId") or "").strip() == sid
            and bool(inv.get("awaitingPayment"))
            and not str(inv.get("paidAt") or "").strip()
            for inv in raw
        )
        should_close = bool(body.get("closeSession")) or (not pending_for_session)
        if should_close:
            sess = _restaurant_load("table_sessions", [])
            if isinstance(sess, list):
                table_id = None
                for s in sess:
                    if isinstance(s, dict) and str(s.get("id") or "") == sid:
                        s["endTime"] = now_iso
                        s["status"] = "completed"
                        table_id = str(s.get("tableId") or "").strip()
                        break
                _restaurant_save("table_sessions", sess)
                if table_id:
                    try:
                        restaurant_update_table_status(table_id, {"status": "dirty"})
                    except Exception:
                        pass
    return {"ok": True, "invoiceId": invoice_id, "paidAt": now_iso}


@app.get("/api/restaurant/orders")
def restaurant_get_orders(
    session_id: Optional[str] = None,
    sessionId: Optional[str] = None,
    status: Optional[str] = None,
):
    """الطلبات — session_id أو sessionId (نفس المعنى) أو status."""
    data = _restaurant_load("orders", [])
    changed = False
    guid_re = re.compile(r"^[0-9a-fA-F-]{36}$")
    sid = session_id or sessionId
    if sid:
        data = [o for o in data if str(o.get("sessionId") or "") == str(sid)]
    if status:
        data = [o for o in data if o.get("status") == status]
    for o in data:
        if not isinstance(o, dict):
            continue
        src_items = o.get("items") or []
        norm_items = [_kds_normalize_item(x) for x in src_items if isinstance(x, dict)]
        if len(norm_items) != len(src_items):
            changed = True
        else:
            # detect missing fields
            for i, x in enumerate(src_items):
                if not isinstance(x, dict):
                    changed = True
                    break
                if not x.get("lineId") or not x.get("lineStatus"):
                    changed = True
                    break
                if bool(x.get("prepared")) != bool(norm_items[i].get("prepared")):
                    changed = True
                    break
        o["items"] = norm_items
        prev = str(o.get("status") or "").lower()
        _kds_refresh_order_status(o)
        if str(o.get("status") or "").lower() != prev:
            changed = True
    # إثراء اسم/رقم الطاولة للمطبخ: إذا tableLabel غير موجود ويُرسل tableId كـ GUID
    # نحوله من TBL005.CostCenter (مثل T20) حتى لا يظهر GUID ليوزر المطبخ.
    try:
        need_lookup = []
        for o in data:
            if not isinstance(o, dict):
                continue
            current_label = str(o.get("tableLabel") or "").strip()
            if current_label and not guid_re.match(current_label):
                continue
            tid = str(o.get("tableGuid") or o.get("tableId") or "").strip()
            if tid and guid_re.match(tid):
                need_lookup.append(tid)
        if need_lookup:
            labels: dict[str, str] = {}
            # 1) fallback من مخطط الصالة (linkedTableId -> label)
            try:
                fp_raw = _restaurant_load("floor_plan", {})
                fp_doc = fp_raw.get("plan") if isinstance(fp_raw, dict) and isinstance(fp_raw.get("plan"), dict) else fp_raw
                floors = []
                if isinstance(fp_doc, dict) and isinstance(fp_doc.get("floors"), list):
                    floors = [f for f in fp_doc.get("floors") or [] if isinstance(f, dict)]
                elif isinstance(fp_doc, dict):
                    floors = [fp_doc]
                for f in floors:
                    for t in f.get("tables") or []:
                        if not isinstance(t, dict):
                            continue
                        lid = str(t.get("linkedTableId") or "").strip()
                        lab = str(t.get("label") or "").strip()
                        if lid and lab:
                            labels[lid.upper()] = lab
            except Exception:
                pass
            # 2) من TBL005.CostCenter/CardCode
            conn = get_connection()
            if conn:
                try:
                    cursor = conn.cursor()
                    for tid in sorted(set(need_lookup)):
                        if labels.get(tid.upper()):
                            continue
                        cursor.execute(
                            """
                            SELECT TOP 1 CostCenter, CardCode
                            FROM TBL005
                            WHERE CardGuide = CAST(? AS uniqueidentifier)
                            """,
                            (tid,),
                        )
                        rr = cursor.fetchone()
                        if rr:
                            lbl = str(rr[0] or "").strip() or (f"#{str(rr[1] or '').strip()}" if rr[1] is not None else "")
                            if lbl:
                                labels[tid.upper()] = lbl
                    for o in data:
                        if not isinstance(o, dict):
                            continue
                        tid = str(o.get("tableGuid") or o.get("tableId") or "").strip()
                        if not tid:
                            continue
                        lbl = labels.get(tid.upper())
                        if lbl:
                            o["tableGuid"] = tid
                            o["tableLabel"] = lbl
                finally:
                    try:
                        conn.close()
                    except Exception:
                        pass
    except Exception:
        pass
    if changed:
        try:
            all_data = _restaurant_load("orders", [])
            by_id = {str(x.get("id")): x for x in data if isinstance(x, dict)}
            for row in all_data:
                if not isinstance(row, dict):
                    continue
                rid = str(row.get("id") or "")
                if rid in by_id:
                    row.update(by_id[rid])
            _restaurant_save("orders", all_data)
        except Exception:
            pass
    return {"orders": data}


def _kds_line_key(it: dict) -> str:
    pg = str(it.get("productGuide") or it.get("menuItemId") or "").strip().lower()
    nm = str(it.get("name") or "").strip().lower()
    up = str(round(float(it.get("unitPrice") or 0), 4))
    seat = str(it.get("seatNo") or it.get("seat") or "").strip().lower()
    return f"{pg}|{nm}|{up}|{seat}"


def _kds_normalize_item(it: dict) -> dict:
    if not isinstance(it, dict):
        it = {}
    qty = float(it.get("quantity") or 0)
    if qty < 0:
        qty = 0
    prepared = bool(it.get("prepared") or False)
    sent = bool(it.get("sent") or False)
    line_status = str(it.get("lineStatus") or "").strip().lower()
    if not line_status:
        if sent:
            line_status = "sent"
        elif prepared:
            line_status = "ready"
        else:
            line_status = "pending"
    return {
        "lineId": str(it.get("lineId") or uuid.uuid4()),
        "name": str(it.get("name") or ""),
        "quantity": qty,
        "unitPrice": float(it.get("unitPrice") or 0),
        "productGuide": str(it.get("productGuide") or it.get("menuItemId") or ""),
        "seatNo": it.get("seatNo"),
        "lineStatus": line_status,
        "prepared": prepared or line_status in ("ready", "sent"),
        "sent": sent or line_status == "sent",
        "preparedAt": it.get("preparedAt"),
        "sentAt": it.get("sentAt"),
    }


def _kds_refresh_order_status(order: dict) -> None:
    items = [x for x in (order.get("items") or []) if isinstance(x, dict)]
    if not items:
        order["status"] = "pending"
        return
    if not str(order.get("prepStartTime") or "").strip():
        if any(bool(x.get("prepared")) or bool(x.get("sent")) for x in items):
            order["prepStartTime"] = datetime.now().isoformat()
    all_sent = all(bool(x.get("sent")) for x in items)
    all_ready = all(bool(x.get("prepared")) for x in items)
    any_progress = any(bool(x.get("prepared")) or bool(x.get("sent")) for x in items)
    if all_sent:
        order["status"] = "served"
        if not str(order.get("completedAt") or "").strip():
            order["completedAt"] = datetime.now().isoformat()
        try:
            created = datetime.fromisoformat(str(order.get("createdAt") or ""))
            done = datetime.fromisoformat(str(order.get("completedAt") or ""))
            mins = max(0.0, (done - created).total_seconds() / 60.0)
            order["kpiLeadMinutes"] = round(mins, 2)
        except Exception:
            pass
    elif all_ready:
        order["status"] = "ready"
        order["completedAt"] = None
    elif any_progress:
        order["status"] = "preparing"
        order["completedAt"] = None
    else:
        order["status"] = "pending"
        order["completedAt"] = None


def _kds_merge_items(target_items: list, incoming_items: list) -> list:
    norm = [_kds_normalize_item(x) for x in target_items if isinstance(x, dict)]
    idx = {_kds_line_key(x): x for x in norm}
    for raw in incoming_items:
        it = _kds_normalize_item(raw)
        key = _kds_line_key(it)
        ex = idx.get(key)
        if ex and not bool(ex.get("sent")):
            ex["quantity"] = float(ex.get("quantity") or 0) + float(it.get("quantity") or 0)
        else:
            norm.append(it)
            idx[key] = it
    return norm


def _kds_items_total(items: list) -> float:
    s = 0.0
    for it in items or []:
        if not isinstance(it, dict):
            continue
        try:
            s += float(it.get("quantity") or 0) * float(it.get("unitPrice") or 0)
        except Exception:
            pass
    return float(round(s, 2))


def _kds_upsert_table_order(ord_data: list, payload: dict) -> dict:
    """دمج الطلب الجديد على طلب مفتوح لنفس الطاولة/الجلسة إن وجد، وإلا إنشاء طلب جديد."""
    if not isinstance(ord_data, list):
        ord_data = []
    session_id = str(payload.get("sessionId") or "")
    table_id = str(payload.get("tableId") or "")
    incoming_items = [_kds_normalize_item(x) for x in (payload.get("items") or []) if isinstance(x, dict)]
    for ex in reversed(ord_data):
        if not isinstance(ex, dict):
            continue
        if str(ex.get("status") or "").lower() in ("served", "paid", "cancelled"):
            continue
        same_session = session_id and str(ex.get("sessionId") or "") == session_id
        same_table = table_id and str(ex.get("tableId") or "") == table_id
        if not (same_session or same_table):
            continue
        ex["items"] = _kds_merge_items(ex.get("items") or [], incoming_items)
        if isinstance(payload.get("kitchenTotals"), dict):
            ex["kitchenTotals"] = payload.get("kitchenTotals")
        ex["updatedAt"] = datetime.now().isoformat()
        _kds_refresh_order_status(ex)
        return ex

    rec = {
        "id": str(uuid.uuid4()),
        "sessionId": session_id or None,
        "tableId": table_id or None,
        "tableGuid": payload.get("tableGuid") or table_id or None,
        "tableLabel": payload.get("tableLabel") or table_id or None,
        "invoiceId": payload.get("invoiceId"),
        "finalInvoiceId": payload.get("finalInvoiceId"),
        "billNumber": payload.get("billNumber"),
        "items": incoming_items,
        "kitchenTotals": payload.get("kitchenTotals"),
        "status": "pending",
        "generalOrder": bool(payload.get("generalOrder")),
        "createdAt": datetime.now().isoformat(),
        "ticketNo": _restaurant_next_kds_ticket_no(ord_data),
    }
    _kds_refresh_order_status(rec)
    ord_data.append(rec)
    return rec

@app.post("/api/restaurant/orders")
def restaurant_create_order(body: dict):
    """إنشاء طلب"""
    data = _restaurant_load("orders", [])
    if not isinstance(data, list):
        data = []
    incoming_items = [_kds_normalize_item(x) for x in (body.get("items") or []) if isinstance(x, dict)]
    session_id = str(body.get("sessionId") or "")
    table_id = str(body.get("tableId") or "")
    # دمج تلقائي: لو في طلب مفتوح لنفس الطاولة/الجلسة نضيف عليه بدل إنشاء تذكرة جديدة
    for ex in reversed(data):
        if not isinstance(ex, dict):
            continue
        if str(ex.get("status") or "").lower() in ("served", "paid", "cancelled"):
            continue
        same_session = session_id and str(ex.get("sessionId") or "") == session_id
        same_table = table_id and str(ex.get("tableId") or "") == table_id
        if not (same_session or same_table):
            continue
        ex["items"] = _kds_merge_items(ex.get("items") or [], incoming_items)
        ex["updatedAt"] = datetime.now().isoformat()
        _kds_refresh_order_status(ex)
        _restaurant_save("orders", data)
        _mark_session_first_order_delay(session_id or ex.get("sessionId") or "")
        return ex

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
        "sessionId": session_id or body.get("sessionId"),
        "tableId": table_id or body.get("tableId"),
        "tableGuid": body.get("tableGuid") or body.get("tableId"),
        "tableLabel": body.get("tableLabel") or body.get("tableName") or body.get("tableId"),
        "waiterId": body.get("waiterId"),
        "items": incoming_items,
        "status": "pending",
        "createdAt": datetime.now().isoformat(),
        "prepTargetMinutes": ptm_f,
        "ticketNo": _restaurant_next_kds_ticket_no(data),
    }
    data.append(rec)
    _restaurant_save("orders", data)
    _mark_session_first_order_delay(session_id or rec.get("sessionId") or "")
    return rec

@app.patch("/api/restaurant/orders/{order_id}/status")
def restaurant_update_order_status(order_id: str, body: dict):
    status = (body.get("status") or "").strip().lower()
    allowed = {"pending", "preparing", "ready", "served", "paid", "cancelled"}
    if status not in allowed:
        raise HTTPException(status_code=400, detail=f"حالة غير مدعومة: {status}")
    data = _restaurant_load("orders", [])
    for o in data:
        if o.get("id") == order_id:
            prev = str(o.get("status") or "").lower()
            if status == "cancelled" and prev not in ("pending",):
                raise HTTPException(
                    status_code=409,
                    detail="لا يمكن الإلغاء بعد بدء التحضير في المطبخ.",
                )
            o["status"] = status
            if status == "preparing":
                o["prepStartTime"] = datetime.now().isoformat()
            elif status == "ready":
                o["prepEndTime"] = datetime.now().isoformat()
            elif status == "cancelled":
                o["cancelledAt"] = datetime.now().isoformat()
            _restaurant_save("orders", data)
            return o
    raise HTTPException(status_code=404, detail="الطلب غير موجود")


@app.patch("/api/restaurant/orders/{order_id}/items/{line_id}")
def restaurant_update_order_line(order_id: str, line_id: str, body: dict):
    data = _restaurant_load("orders", [])
    for o in data:
        if not isinstance(o, dict):
            continue
        if str(o.get("id") or "") != str(order_id):
            continue
        items = [_kds_normalize_item(x) for x in (o.get("items") or []) if isinstance(x, dict)]
        found = None
        for it in items:
            if str(it.get("lineId") or "") == str(line_id):
                found = it
                break
        if not found:
            raise HTTPException(status_code=404, detail="سطر الطلب غير موجود")
        if "prepared" in (body or {}):
            prepared = bool(body.get("prepared"))
            found["prepared"] = prepared
            found["lineStatus"] = "ready" if prepared else "pending"
            found["preparedAt"] = datetime.now().isoformat() if prepared else None
            if prepared and not str(o.get("prepStartTime") or "").strip():
                o["prepStartTime"] = datetime.now().isoformat()
        if "sent" in (body or {}):
            sent = bool(body.get("sent"))
            found["sent"] = sent
            found["lineStatus"] = "sent" if sent else ("ready" if found.get("prepared") else "pending")
            found["sentAt"] = datetime.now().isoformat() if sent else None
        o["items"] = items
        _kds_refresh_order_status(o)
        _restaurant_save("orders", data)
        return {"ok": True, "order": o, "line": found}
    raise HTTPException(status_code=404, detail="الطلب غير موجود")


@app.post("/api/restaurant/orders/{order_id}/items/{line_id}/send")
def restaurant_send_order_line(order_id: str, line_id: str):
    data = _restaurant_load("orders", [])
    for o in data:
        if not isinstance(o, dict):
            continue
        if str(o.get("id") or "") != str(order_id):
            continue
        items = [_kds_normalize_item(x) for x in (o.get("items") or []) if isinstance(x, dict)]
        found = None
        for it in items:
            if str(it.get("lineId") or "") == str(line_id):
                found = it
                break
        if not found:
            raise HTTPException(status_code=404, detail="سطر الطلب غير موجود")
        if not bool(found.get("prepared")):
            raise HTTPException(status_code=409, detail="لا يمكن الإرسال قبل تأكيد التحضير")
        found["sent"] = True
        found["lineStatus"] = "sent"
        found["sentAt"] = datetime.now().isoformat()
        o["items"] = items
        _kds_refresh_order_status(o)
        _restaurant_save("orders", data)
        return {"ok": True, "order": o, "line": found}
    raise HTTPException(status_code=404, detail="الطلب غير موجود")


@app.post("/api/restaurant/orders/normalize-table-labels")
def restaurant_normalize_order_table_labels():
    """
    تنظيف الطلبات القديمة:
    - تحويل tableLabel من GUID إلى اسم/رقم طاولة فعلي (مثل T20)
    - حفظ النتيجة في orders.json بشكل دائم.
    """
    data = _restaurant_load("orders", [])
    if not isinstance(data, list):
        data = []
    guid_re = re.compile(r"^[0-9a-fA-F-]{36}$")
    labels: dict[str, str] = {}

    # 1) محاولة من floor_plan (linkedTableId -> label)
    try:
        fp_raw = _restaurant_load("floor_plan", {})
        fp_doc = fp_raw.get("plan") if isinstance(fp_raw, dict) and isinstance(fp_raw.get("plan"), dict) else fp_raw
        floors = []
        if isinstance(fp_doc, dict) and isinstance(fp_doc.get("floors"), list):
            floors = [f for f in fp_doc.get("floors") or [] if isinstance(f, dict)]
        elif isinstance(fp_doc, dict):
            floors = [fp_doc]
        for f in floors:
            for t in f.get("tables") or []:
                if not isinstance(t, dict):
                    continue
                lid = str(t.get("linkedTableId") or "").strip()
                lab = str(t.get("label") or "").strip()
                if lid and lab:
                    labels[lid.upper()] = lab
    except Exception:
        pass

    # 2) fallback من TBL005
    conn = get_connection()
    if conn:
        try:
            cursor = conn.cursor()
            for o in data:
                if not isinstance(o, dict):
                    continue
                tid = str(o.get("tableGuid") or o.get("tableId") or "").strip()
                if not tid or not guid_re.match(tid):
                    continue
                if labels.get(tid.upper()):
                    continue
                cursor.execute(
                    """
                    SELECT TOP 1 CostCenter, CardCode
                    FROM TBL005
                    WHERE CardGuide = CAST(? AS uniqueidentifier)
                    """,
                    (tid,),
                )
                rr = cursor.fetchone()
                if rr:
                    lbl = str(rr[0] or "").strip() or (f"#{str(rr[1] or '').strip()}" if rr[1] is not None else "")
                    if lbl:
                        labels[tid.upper()] = lbl
        finally:
            try:
                conn.close()
            except Exception:
                pass

    changed = 0
    for o in data:
        if not isinstance(o, dict):
            continue
        tid = str(o.get("tableGuid") or o.get("tableId") or "").strip()
        if not tid or not guid_re.match(tid):
            continue
        current = str(o.get("tableLabel") or "").strip()
        if current and not guid_re.match(current):
            continue
        lbl = labels.get(tid.upper())
        if not lbl:
            continue
        o["tableGuid"] = tid
        o["tableLabel"] = lbl
        changed += 1

    if changed:
        _restaurant_save("orders", data)
    return {"ok": True, "updated": changed, "totalOrders": len(data)}

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

@app.get("/api/restaurant/invoice-type-mappings")
def restaurant_invoice_type_mappings():
    """عرض ربط نوع الطلب (table/takeaway/delivery/purchase) بـ CardGuide في TBL020 بعد التهيئة."""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT m.OrderKind, m.Tbl020CardGuide, m.InvoiceDisplayName, t.InvoiceName, t.TextValue01
                FROM dbo.MAT3AM_RESTAURANT_INVOICE_TYPES m
                LEFT JOIN dbo.TBL020 t ON t.CardGuide = m.Tbl020CardGuide
                ORDER BY m.OrderKind
                """
            )
            rows = cursor.fetchall()
        except Exception:
            rows = []
        out = []
        for r in rows:
            out.append(
                {
                    "orderKind": r[0],
                    "tbl020CardGuide": str(r[1]) if r[1] else None,
                    "invoiceDisplayName": r[2],
                    "tbl020InvoiceName": r[3],
                    "textValue01": r[4],
                }
            )
        return {
            "mappings": out,
            "orderKindsExpected": list(MAT3AM_RESTAURANT_ORDER_KINDS),
            "hint": None
            if out
            else "لا توجد خرائط — تأكد من وجود أنواع في TBL020 ثم POST /api/dev/bootstrap لإنشاء MAT3AM_RESTAURANT_INVOICE_TYPES.",
        }
    finally:
        try:
            conn.close()
        except Exception:
            pass


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
    order_type = _normalize_restaurant_order_kind(str(body.get("orderType") or "table"))
    delivery = body.get("delivery") or {}
    agent_guide = body.get("agentGuide")
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_menu_tables(cursor)
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
            agent_guide = _pick_default_cash_agent_guid(cursor)
        if not agent_guide:
            raise HTTPException(status_code=400, detail="لا يوجد عميل افتراضي. أضف عميلاً في النظام أو أرسل agentGuide.")
        # نوع الفاتورة من TBL020 ثم رقم تسلسلي لنفس النوع (MainGuide في TBL022 = CardGuide نوع الفاتورة)
        explicit_inv = body.get("invoiceType") or body.get("invoiceTypeGuide") or body.get("invoiceTypeName")
        invoice_type_guid = _get_restaurant_invoice_type_guid(cursor, order_type, explicit_inv)
        cursor.execute(
            "SELECT ISNULL(MAX(BillNumber), 0) + 1 FROM TBL022 WHERE MainGuide = CAST(? AS uniqueidentifier)",
            (invoice_type_guid,),
        )
        r = cursor.fetchone()
        bill_num = int(r[0]) if r and r[0] is not None else 1
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
                        "Unit": "1",
                        "UnitPrice": price,
                        "TotalValue": qty * price,
                    })
        normalized_items = []
        for raw in items_body:
            line = _normalize_pos_invoice_line(raw)
            if line:
                normalized_items.append(line)
        items_body = _enrich_invoice_lines_from_menu(cursor, normalized_items)
        if not items_body:
            raise HTTPException(status_code=400, detail="لا توجد بنود للفاتورة")

        # طاولة + جرسون: تسجيل للمطبخ فقط (Open Check) — بدون TBL022/TBL023 حتى «طلب الحساب»
        post_sql = body.get("postToSqlInvoice")
        if post_sql is None:
            post_sql = True
        if order_type == "table" and post_sql is False:
            table_guid_kds = str(body.get("tableGuid") or body.get("tableId") or "").strip() or str(session_id or "")
            table_label_kds = str(body.get("tableName") or body.get("tableLabel") or "").strip() or table_guid_kds
            kds_items = []
            for x in items_body:
                kds_items.append(
                    {
                        "name": str(x.get("ProductName") or ""),
                        "quantity": float(x.get("Quantity") or 0),
                        "unitPrice": float(x.get("UnitPrice") or 0),
                        "productGuide": str(x.get("ProductGuide") or ""),
                    }
                )
            ord_data = _restaurant_load("orders", [])
            rec = _kds_upsert_table_order(
                ord_data,
                {
                    "sessionId": str(session_id),
                    "tableId": table_guid_kds,
                    "tableGuid": table_guid_kds,
                    "tableLabel": table_label_kds,
                    "invoiceId": None,
                    "finalInvoiceId": None,
                    "items": kds_items,
                    "kitchenTotals": {
                        "subtotal": subtotal,
                        "tax": tax,
                        "serviceCharge": service_charge,
                        "total": total,
                    },
                    "generalOrder": bool(body.get("generalOrder")),
                },
            )
            _restaurant_save("orders", ord_data)
            return {
                "kitchenOnly": True,
                "orderId": rec["id"],
                "sessionId": session_id,
                "tableId": table_guid_kds,
                "tableGuid": table_guid_kds,
                "tableLabel": table_label_kds,
                "message": "سُجّل للمطبخ — الفاتورة تُنشأ عند «طلب الحساب» فقط.",
            }

        delivery_note = ""
        if order_type == "delivery":
            student_line = delivery.get("studentPhone") or delivery.get("studentId") or delivery.get("studentNumber")
            courier_bits = [
                delivery.get("courierName"),
                delivery.get("driverName"),
                delivery.get("shippingCompany"),
                delivery.get("shipperName"),
            ]
            courier_line = " / ".join(str(x).strip() for x in courier_bits if x and str(x).strip())
            delivery_note = (
                f" | دليفري: هاتف={delivery.get('phone') or delivery.get('mobile') or ''}"
                f" | عنوان={delivery.get('address') or ''}"
                f" | وقت التسليم={delivery.get('deliveryTime') or ''}"
                f" | دفع={delivery.get('payment') or payment_method}"
            )
            if student_line:
                delivery_note += f" | طالب/هاتف عميل={student_line}"
            if courier_line:
                delivery_note += f" | شحن/شاحن={courier_line}"
        elif order_type == "takeaway":
            delivery_note = " | سفري"

        inv = {
            "BillNumber": bill_num,
            "BillDate": bill_date,
            "DoneIn": bill_date,
            "AgentGuide": agent_guide,
            "InvoiceType": invoice_type_guid,
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
        # طلب مطبخ (KDS) — مرتبط بجلسة الطاولة؛ يظهر في شاشة المطبخ ويُلغى من الجرسون إن بقي pending
        if order_type == "table" and session_id and items_body:
            try:
                table_guid_kds = str(body.get("tableGuid") or body.get("tableId") or "").strip() or str(session_id)
                table_label_kds = str(body.get("tableName") or body.get("tableLabel") or "").strip() or table_guid_kds
                kds_items = []
                for x in items_body:
                    kds_items.append(
                        {
                            "name": str(x.get("ProductName") or ""),
                            "quantity": float(x.get("Quantity") or 0),
                            "unitPrice": float(x.get("UnitPrice") or 0),
                            "productGuide": str(x.get("ProductGuide") or ""),
                        }
                    )
                ord_data = _restaurant_load("orders", [])
                _kds_upsert_table_order(
                    ord_data,
                    {
                        "sessionId": str(session_id),
                        "tableId": table_guid_kds,
                        "tableGuid": table_guid_kds,
                        "tableLabel": table_label_kds,
                        "invoiceId": str(result.get("MainGuide") or ""),
                        "billNumber": int(bill_num),
                        "items": kds_items,
                        "generalOrder": bool(body.get("generalOrder")),
                    },
                )
                _restaurant_save("orders", ord_data)
            except Exception:
                pass
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


@app.post("/api/restaurant/sessions/request-bill")
def restaurant_sessions_request_bill(body: dict):
    """طلب الحساب: تجميع طلبات الجلسة غير المفوترة → فاتورة SQL واحدة + انتظار تسديد الكاشير."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="جسم غير صالح")
    session_id = str(body.get("sessionId") or "").strip()
    if not session_id:
        raise HTTPException(status_code=400, detail="sessionId مطلوب")

    all_o = _restaurant_load("orders", [])
    if not isinstance(all_o, list):
        all_o = []
    pending = []
    for o in all_o:
        if not isinstance(o, dict):
            continue
        if str(o.get("sessionId") or "") != session_id:
            continue
        if str(o.get("status") or "").lower() == "cancelled":
            continue
        if o.get("finalInvoiceId"):
            continue
        if o.get("invoiceId"):
            continue
        pending.append(o)
    if not pending:
        raise HTTPException(
            status_code=400,
            detail="لا توجد طلبات مفتوحة لهذه الجلسة (أو سبق فوترتها).",
        )

    split_enabled = bool(body.get("splitBySeat"))
    raw_groups = body.get("seatGroups") if isinstance(body.get("seatGroups"), list) else []
    tip_amount = max(0.0, float(body.get("tipAmount") or 0.0))

    def _extract_seat_num(item_name: str) -> Optional[int]:
        m = re.search(r"كرسي\s*(\d+)", str(item_name or ""))
        if not m:
            return None
        try:
            return int(m.group(1))
        except Exception:
            return None

    split_groups: list[dict] = []
    if split_enabled:
        for idx, g in enumerate(raw_groups):
            if not isinstance(g, dict):
                continue
            seats_raw = g.get("seats") if isinstance(g.get("seats"), list) else []
            seats = sorted({int(x) for x in seats_raw if str(x).isdigit() and int(x) > 0})
            if not seats:
                continue
            split_groups.append(
                {
                    "id": str(g.get("id") or f"check-{idx+1}"),
                    "name": str(g.get("name") or f"شيك {idx+1}"),
                    "seats": seats,
                }
            )
        if len(split_groups) < 2:
            split_enabled = False

    items_body = []
    for o in pending:
        for it in o.get("items") or []:
            if not isinstance(it, dict):
                continue
            pg = str(it.get("productGuide") or it.get("menuItemId") or "")
            name = str(it.get("name") or "")
            seat_num = _extract_seat_num(name)
            qty = float(it.get("quantity") or 0)
            price = float(it.get("unitPrice") or 0)
            if qty <= 0:
                continue
            items_body.append(
                {
                    "ProductGuide": pg,
                    "ProductName": name,
                    "Quantity": qty,
                    "Unit": "1",
                    "UnitPrice": price,
                    "TotalValue": qty * price,
                    "_seatNum": seat_num,
                }
            )
    normalized_items = []
    for raw in items_body:
        line = _normalize_pos_invoice_line(raw)
        if line:
            normalized_items.append(line)
    items_body = normalized_items
    if not items_body:
        raise HTTPException(status_code=400, detail="لا توجد بنود صالحة للفاتورة")

    agg_sub = 0.0
    agg_tax = 0.0
    agg_svc = 0.0
    for o in pending:
        kt = o.get("kitchenTotals")
        if isinstance(kt, dict):
            agg_sub += float(kt.get("subtotal") or 0)
            agg_tax += float(kt.get("tax") or 0)
            agg_svc += float(kt.get("serviceCharge") or 0)
    if agg_sub <= 0 and agg_tax <= 0 and agg_svc <= 0:
        agg_sub = sum(float(x.get("TotalValue") or 0) for x in items_body)
    agg_total = agg_sub + agg_tax + agg_svc + tip_amount

    invoice_batches: list[dict] = []
    if split_enabled:
        for g in split_groups:
            seats = set(g["seats"])
            g_items = [dict(x) for x in items_body if x.get("_seatNum") in seats]
            if not g_items:
                continue
            for x in g_items:
                x.pop("_seatNum", None)
            g_sub = sum(float(x.get("TotalValue") or 0) for x in g_items)
            invoice_batches.append({"name": g["name"], "items": g_items, "subtotal": g_sub})
        if len(invoice_batches) < 2:
            split_enabled = False

    if not split_enabled:
        items_one = [dict(x) for x in items_body]
        for x in items_one:
            x.pop("_seatNum", None)
        invoice_batches = [{"name": "فاتورة الجلسة", "items": items_one, "subtotal": sum(float(x.get("TotalValue") or 0) for x in items_one)}]

    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        _ensure_menu_tables(cursor)
        req_agent = str(body.get("agentGuid") or "").strip()
        if req_agent:
            agent_guide = req_agent
        else:
            agent_guide = _pick_default_cash_agent_guid(cursor)
        if not agent_guide:
            raise HTTPException(status_code=400, detail="لا يوجد عميل افتراضي في TBL016")
        order_kind = _normalize_restaurant_order_kind(str(body.get("orderType") or "table"))
        invoice_type_guid = _get_restaurant_invoice_type_guid(cursor, order_kind, body.get("invoiceType") or body.get("invoiceTypeGuide") or body.get("invoiceTypeName"))
        cursor.execute(
            "SELECT ISNULL(MAX(BillNumber), 0) + 1 FROM TBL022 WHERE MainGuide = CAST(? AS uniqueidentifier)",
            (invoice_type_guid,),
        )
        r = cursor.fetchone()
        bill_num = int(r[0]) if r and r[0] is not None else 1
        today = datetime.now().strftime("%d-%m-%Y")
        req_bill_date = str(body.get("billDate") or body.get("invoiceDate") or "").strip()
        if req_bill_date and len(req_bill_date) >= 10:
            try:
                dt = datetime.strptime(req_bill_date[:10], "%Y-%m-%d")
                bill_date = dt.strftime("%d-%m-%Y")
            except Exception:
                bill_date = today
        else:
            bill_date = today
        created_invoices: list[dict] = []
        parts_count = max(1, len(invoice_batches))
        share_tax = agg_tax / parts_count
        share_svc = agg_svc / parts_count
        share_tip = tip_amount / parts_count
        for idx, part in enumerate(invoice_batches):
            part_items = part["items"]
            if not part_items:
                continue
            part_items = _enrich_invoice_lines_from_menu(cursor, part_items)
            inv = {
                "BillNumber": bill_num + idx,
                "BillDate": bill_date,
                "DoneIn": bill_date,
                "AgentGuide": agent_guide,
                "InvoiceType": invoice_type_guid,
                "Notes": f"مطعم — طلب حساب جلسة {session_id} — {part['name']}",
                "PaymentMethod": "نقدي",
                "Discount": 0.0,
                "TaxValue": share_tax if split_enabled else agg_tax,
                "LocalAdministrativeTax": share_svc if split_enabled else agg_svc,
                "Items": part_items,
            }
            invoice_header = InvoiceHeader(**inv)
            result = save_invoice(invoice_header)
            main_g = str(result.get("MainGuide") or "")
            subtotal_p = float(part.get("subtotal") or 0)
            total_p = subtotal_p + (share_tax if split_enabled else agg_tax) + (share_svc if split_enabled else agg_svc) + (share_tip if split_enabled else tip_amount)
            created_invoices.append({"invoiceId": main_g, "name": part["name"], "total": total_p, "tipAmount": (share_tip if split_enabled else tip_amount)})

        if not created_invoices:
            raise HTTPException(status_code=500, detail="تعذر إنشاء فواتير للجلسة")
        now_iso = datetime.now().isoformat()
        pending_ids = {str(o.get("id")) for o in pending if o.get("id")}
        for o in all_o:
            if not isinstance(o, dict):
                continue
            if str(o.get("id") or "") in pending_ids:
                o["finalInvoiceId"] = ",".join([x["invoiceId"] for x in created_invoices])
                o["billedAt"] = now_iso
        _restaurant_save("orders", all_o)
        inv_list = _restaurant_load("invoices", [])
        for part in created_invoices:
            inv_list.append(
                {
                    "sessionId": session_id,
                    "invoiceId": part["invoiceId"],
                    "total": part["total"],
                    "requestedAt": now_iso,
                    "awaitingPayment": True,
                    "paidAt": None,
                    "splitName": part["name"] if split_enabled else None,
                    "tipAmount": part.get("tipAmount") or 0.0,
                }
            )
        _restaurant_save("invoices", inv_list)
        sess = _restaurant_load("table_sessions", [])
        for s in sess:
            if isinstance(s, dict) and str(s.get("id")) == session_id:
                s["billingRequestedAt"] = now_iso
        _restaurant_save("table_sessions", sess)
        dispatch_mode = _workflow_role_for("dispatch_cashier")
        check_role = _workflow_role_for("request_check")
        try:
            if dispatch_mode in ("visa_machine", "both"):
                restaurant_cashier_alerts_create(
                    {
                        "type": "waiter_summon",
                        "tableId": str(pending[0].get("tableId") or ""),
                        "sessionId": session_id,
                        "message": "طلب ماكينة فيزا",
                    }
                )
            if dispatch_mode in ("cash_collector", "both"):
                restaurant_cashier_alerts_create(
                    {
                        "type": "waiter_summon",
                        "tableId": str(pending[0].get("tableId") or ""),
                        "sessionId": session_id,
                        "message": "طلب مندوب تحصيل كاش",
                    }
                )
        except Exception:
            pass
        return {
            "invoiceId": created_invoices[0]["invoiceId"],
            "billNumber": bill_num,
            "total": sum(float(x["total"]) for x in created_invoices),
            "awaitingPayment": True,
            "sessionId": session_id,
            "splitApplied": split_enabled,
            "tipAmount": tip_amount,
            "invoices": created_invoices,
            "workflow": {
                "checkRequestBy": check_role,
                "cashierDispatchMode": dispatch_mode,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
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


def _ensure_mat3am_dev_schema(cursor) -> tuple:
    """إنشاء جداول التطبيق المساندة إن لم تكن موجودة.

    يعيد (عدد مستخدمي التطبيق المُدرَجين, نتيجة تهيئة أنواع فواتير المطعم في TBL020, نتيجة تهيئة مخازن TBL008 وربطها).
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
        IF OBJECT_ID(N'dbo.MAT3AM_RESTAURANT_INVOICE_TYPES', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_RESTAURANT_INVOICE_TYPES (
                OrderKind NVARCHAR(32) NOT NULL PRIMARY KEY,
                Tbl020CardGuide UNIQUEIDENTIFIER NOT NULL,
                InvoiceDisplayName NVARCHAR(255) NULL,
                CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
        END
        """,
        """
        IF OBJECT_ID(N'dbo.MAT3AM_RESTAURANT_STORES', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MAT3AM_RESTAURANT_STORES (
                OrderKind NVARCHAR(32) NOT NULL PRIMARY KEY,
                Tbl008CardGuide UNIQUEIDENTIFIER NOT NULL,
                WarehouseDisplayName NVARCHAR(255) NULL,
                CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
            );
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

    restaurant_invoice_seed: dict = {"ok": False, "note": "لم يُنفَّذ"}
    try:
        restaurant_invoice_seed = _seed_mat3am_restaurant_invoice_types(cursor)
        cursor.connection.commit()
    except Exception as e:
        restaurant_invoice_seed = {"ok": False, "note": str(e), "errors": [{"detail": str(e)}]}
        try:
            cursor.connection.rollback()
        except Exception:
            pass

    restaurant_store_seed: dict = {"ok": False, "note": "لم يُنفَّذ"}
    try:
        restaurant_store_seed = _seed_mat3am_restaurant_stores(cursor)
        cursor.connection.commit()
    except Exception as e:
        restaurant_store_seed = {"ok": False, "note": str(e), "errors": [{"detail": str(e)}]}
        try:
            cursor.connection.rollback()
        except Exception:
            pass

    users_inserted = _seed_mat3am_default_users_if_empty(cursor)
    try:
        cursor.connection.commit()
    except Exception:
        pass
    return users_inserted, restaurant_invoice_seed, restaurant_store_seed


@app.post("/api/dev/bootstrap")
def developer_bootstrap():
    """تهيئة جداول دعم التطبيق + مستخدمو التطبيق الافتراضيون إن كان الجدول فارغاً (حزمة التهيئة)."""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        default_users_inserted, restaurant_invoice_seed, restaurant_store_seed = _ensure_mat3am_dev_schema(cursor)
        conn.commit()
        default_users_spec = [
            {"login": a, "pin": b, "role": c, "displayName": d}
            for a, b, c, d in MAT3AM_BOOTSTRAP_DEFAULT_USERS
        ]
        inv_seed = restaurant_invoice_seed or {}
        inv_ok = bool(inv_seed.get("ok", True))
        st_seed = restaurant_store_seed or {}
        st_ok = bool(st_seed.get("ok", True))
        return {
            "ok": True,
            "bootstrapSchemaRevision": 3,
            "restaurantInvoiceTypesOk": inv_ok,
            "restaurantStoresOk": st_ok,
            "message": "تمت تهيئة جداول الدعم بنجاح"
            + ("" if inv_ok else " — مع فشل أو نقص في أنماط فواتير المطعم (TBL020)؛ راجع restaurantInvoiceTypesSeed.")
            + ("" if st_ok else " — مع فشل أو نقص في مخازن المطعم (TBL008)؛ راجع restaurantStoresSeed."),
            "tables": [
                "MAT3AM_APP_USERS",
                "MAT3AM_ERROR_LOG",
                "MAT3AM_AUDIT_LOG",
                "MAT3AM_RESTAURANT_INVOICE_TYPES",
                "MAT3AM_RESTAURANT_STORES",
                "MAT3AM_RECIPE_HDR",
                "MAT3AM_RECIPE_LINE",
                "MAT3AM_STOCK_MOVEMENT",
                "MAT3AM_POS_POLICY",
                "MAT3AM_PROMOTION",
            ],
            "defaultAppUsersInserted": default_users_inserted,
            "defaultAppUsersSpec": default_users_spec,
            "defaultAppUsersNote": "يُدرَج هؤلاء فقط عندما يكون جدول MAT3AM_APP_USERS فارغاً تماماً.",
            "restaurantInvoiceTypesSeed": restaurant_invoice_seed,
            "restaurantInvoiceTypesNote": "زر التهيئة: 6 صفوف في TBL020 بـ CardGuide جديد لكل نوع وInvoiceName عربي؛ TBL022.MainGuide من MAT3AM أو من SELECT CardGuide FROM TBL020 WHERE InvoiceName = الاسم. قاعدة فارغة = إدراج مباشر؛ إن تعذّر قالب مؤقت أو نسخ من صف موجود.",
            "restaurantStoresSeed": restaurant_store_seed,
            "restaurantStoresNote": "تهيئة: 6 صفوف في TBL008 بنفس WarehouseName مثل InvoiceName في TBL020 (توحيد) + MAT3AM_RESTAURANT_STORES؛ الحفظ: StoreGuide = CardGuide من TBL008 WHERE WarehouseName = اسم النمط.",
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


def _load_tbl_seed_pack() -> dict:
    p = BASE_DIR / "config" / "tbl_seed_pack_v1.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"ملف seed غير موجود: {p}")
    with open(p, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="ملف seed غير صالح")
    return data


def _tbl_columns(cursor, table_name: str) -> set[str]:
    cursor.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ?",
        (table_name,),
    )
    return {str(r[0]) for r in cursor.fetchall()}


def _tbl_next_card_code(cursor, table_name: str) -> int:
    try:
        cursor.execute(f"SELECT ISNULL(MAX(TRY_CONVERT(INT, CardCode)), 0) FROM dbo.{table_name}")
        n = int((cursor.fetchone() or [0])[0] or 0)
        return n + 1
    except Exception:
        return 1


def _tbl_first_cardguide(cursor, table_name: str) -> Optional[str]:
    try:
        cursor.execute(f"SELECT TOP 1 CardGuide FROM dbo.{table_name} ORDER BY ID")
        r = cursor.fetchone()
        return str(r[0]) if r and r[0] else None
    except Exception:
        return None


def _tbl_upsert(cursor, table_name: str, key_map: dict, data_map: dict, cols: set[str]) -> str:
    keys = {k: v for k, v in key_map.items() if k in cols}
    vals_map = {k: v for k, v in data_map.items() if k in cols}
    if not keys:
        return "skipped"
    where = []
    args = []
    for k, v in keys.items():
        if v is None:
            where.append(f"[{k}] IS NULL")
        else:
            where.append(f"[{k}] = ?")
            args.append(v)
    cursor.execute(f"SELECT TOP 1 CardGuide FROM dbo.{table_name} WHERE " + " AND ".join(where), tuple(args))
    row = cursor.fetchone()
    if row:
        upd = {k: v for k, v in vals_map.items() if k not in keys}
        if not upd:
            return "skipped"
        set_sql = ", ".join([f"[{k}] = ?" for k in upd.keys()])
        cursor.execute(
            f"UPDATE dbo.{table_name} SET {set_sql} WHERE CardGuide = CAST(? AS uniqueidentifier)",
            tuple(list(upd.values()) + [str(row[0])]),
        )
        return "updated"
    if "CardGuide" in cols and "CardGuide" not in vals_map:
        vals_map["CardGuide"] = str(uuid.uuid4()).upper()
    if "CardCode" in cols and ("CardCode" not in vals_map or vals_map.get("CardCode") in (None, "")):
        vals_map["CardCode"] = str(_tbl_next_card_code(cursor, table_name))
    if table_name == "TBL004" and "ClosingAccount" in cols and not vals_map.get("ClosingAccount"):
        vals_map["ClosingAccount"] = _tbl_first_cardguide(cursor, "TBL002") or vals_map.get("CardGuide")
    if table_name == "TBL020":
        if "InvoiceMovementSide" in cols and vals_map.get("InvoiceMovementSide") in (None, ""):
            vals_map["InvoiceMovementSide"] = 1
        if "AgentAccountSide" in cols and vals_map.get("AgentAccountSide") in (None, ""):
            vals_map["AgentAccountSide"] = 1
        if "BillType" in cols and vals_map.get("BillType") in (None, ""):
            vals_map["BillType"] = 1
        if "BillKind" in cols and vals_map.get("BillKind") in (None, ""):
            vals_map["BillKind"] = 0
        if "PriceType" in cols and vals_map.get("PriceType") in (None, ""):
            vals_map["PriceType"] = 4
        if "POSType" in cols and vals_map.get("POSType") in (None, ""):
            vals_map["POSType"] = 1
        if "DefaultPayType" in cols and vals_map.get("DefaultPayType") in (None, ""):
            vals_map["DefaultPayType"] = 2
        if "Fields" in cols and vals_map.get("Fields") in (None, ""):
            vals_map["Fields"] = "ProductGuide,Quantity,UnitPrice,Unit,TotalValue,Description"
    if not vals_map:
        return "skipped"
    csql = ", ".join([f"[{k}]" for k in vals_map.keys()])
    psql = ", ".join(["?" for _ in vals_map.keys()])
    cursor.execute(f"INSERT INTO dbo.{table_name} ({csql}) VALUES ({psql})", tuple(vals_map.values()))
    return "inserted"


@app.post("/api/dev/seed-default-data")
def developer_seed_default_data():
    """تعبئة بيانات تشغيل افتراضية في جداول TBL الموجودة مسبقاً (UPSERT فقط)."""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        seed = _load_tbl_seed_pack()
        tables = seed.get("tables") if isinstance(seed, dict) else {}
        if not isinstance(tables, dict):
            raise HTTPException(status_code=400, detail="seed.tables غير صالح")
        order = ["TBL004", "TBL005", "TBL015", "TBL016", "TBL006", "TBL007", "TBL008", "TBL049", "TBL020"]
        cursor = conn.cursor()
        report: dict[str, dict] = {}

        def gid_by_group_name(name: str) -> Optional[str]:
            n = str(name or "").strip()
            if not n:
                return None
            cursor.execute("SELECT TOP 1 CardGuide FROM dbo.TBL006 WHERE GroupName = ?", (n,))
            rr = cursor.fetchone()
            return str(rr[0]) if rr and rr[0] else None

        def gid_by_agent_group(name: str) -> Optional[str]:
            n = str(name or "").strip()
            if not n:
                return None
            cursor.execute("SELECT TOP 1 CardGuide FROM dbo.TBL015 WHERE GroupName = ?", (n,))
            rr = cursor.fetchone()
            return str(rr[0]) if rr and rr[0] else None

        def any_account_guid() -> Optional[str]:
            try:
                cursor.execute("SELECT TOP 1 CardGuide FROM dbo.TBL004 ORDER BY ID")
                rr = cursor.fetchone()
                return str(rr[0]) if rr and rr[0] else None
            except Exception:
                return None

        for tname in order:
            spec = tables.get(tname)
            if not isinstance(spec, dict):
                continue
            rows = spec.get("rows")
            if not isinstance(rows, list):
                continue
            cols = _tbl_columns(cursor, tname)
            stat = {"inserted": 0, "updated": 0, "skipped": 0, "errors": []}
            for r in rows:
                if not isinstance(r, dict):
                    continue
                try:
                    if tname == "TBL004":
                        key = {"CardCode": r.get("CardCode")}
                        data = {"CardCode": r.get("CardCode"), "AccountName": r.get("AccountName"), "LatinName": r.get("LatinName"), "NotActive": r.get("NotActive")}
                    elif tname == "TBL005":
                        key = {"CostCenter": r.get("CostCenter")}
                        data = {"CostCenter": r.get("CostCenter"), "LatinName": r.get("LatinName"), "CardType": r.get("CardType"), "NotActive": r.get("NotActive")}
                    elif tname == "TBL015":
                        mg = gid_by_agent_group(str(r.get("MainGroupName") or ""))
                        key = {"GroupName": r.get("GroupName")}
                        data = {"GroupName": r.get("GroupName"), "MainGroupGuide": mg}
                    elif tname == "TBL016":
                        mg = gid_by_agent_group(str(r.get("MainGroupName") or ""))
                        key = {"AgentName": r.get("AgentName"), "Phone": r.get("Phone")}
                        data = {"AgentName": r.get("AgentName"), "CardNumber": r.get("CardNumber"), "MainGroupGuide": mg, "Phone": r.get("Phone"), "Mobile": r.get("Mobile"), "FullAdress": r.get("FullAdress"), "NotActive": r.get("NotActive"), "AccountID": any_account_guid()}
                    elif tname == "TBL006":
                        mg = gid_by_group_name(str(r.get("MainGroupName") or ""))
                        key = {"GroupName": r.get("GroupName"), "MainGuide": mg}
                        data = {"GroupName": r.get("GroupName"), "LatinName": r.get("LatinName"), "MainGuide": mg}
                    elif tname == "TBL007":
                        gg = gid_by_group_name(str(r.get("GroupName") or ""))
                        key = {"CardCode": r.get("CardCode")}
                        data = {"CardCode": r.get("CardCode"), "ProductName": r.get("ProductName"), "LatinName": r.get("LatinName"), "GroupGuid": gg, "AgentPrice": r.get("AgentPrice"), "EndUserPrice": r.get("EndUserPrice"), "StockProduct": r.get("StockProduct"), "NotActive": r.get("NotActive")}
                    elif tname == "TBL008":
                        key = {"WarehouseName": r.get("WarehouseName")}
                        data = {"WarehouseName": r.get("WarehouseName"), "LatinName": r.get("LatinName"), "NotActive": r.get("NotActive")}
                    elif tname == "TBL049":
                        key = {"ProjectName": r.get("ProjectName")}
                        data = {"ProjectName": r.get("ProjectName")}
                    elif tname == "TBL020":
                        key = {"InvoiceName": r.get("InvoiceName")}
                        mv = 1 if str(r.get("OrderKind") or "").lower() in ("table", "takeaway", "delivery", "bar_quick", "catering") else -1
                        data = {
                            "InvoiceName": r.get("InvoiceName"),
                            "LatinName": r.get("LatinName"),
                            "TextValue01": r.get("TextValue01"),
                            "InvoiceMovementSide": mv,
                            "AgentAccountSide": 1,
                            "BillType": 1,
                            "BillKind": 0,
                            "PriceType": 4,
                            "POSType": 1,
                            "DefaultPayType": 2,
                        }
                    else:
                        continue
                    action = _tbl_upsert(cursor, tname, key, data, cols)
                    stat[action] = int(stat.get(action, 0)) + 1
                except Exception as ex:
                    stat["errors"].append({"row": r, "detail": str(ex)})
            report[tname] = stat
        conn.commit()
        return {"ok": True, "seedVersion": str((seed.get("meta") or {}).get("version") or ""), "tables": report}
    except HTTPException:
        raise
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"فشل تعبئة البيانات الافتراضية: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.get("/api/dev/seed-default-data/verify")
def developer_verify_seed_default_data():
    """تقرير تحقق بعد التهيئة: وجود الجداول + الحد الأدنى من السجلات الحرجة."""
    conn = get_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="فشل الاتصال بقاعدة البيانات")
    try:
        cursor = conn.cursor()
        checks = [
            ("TBL004", "دليل الحسابات", "SELECT COUNT(*) FROM dbo.TBL004", 3),
            ("TBL005", "مراكز الكلفة", "SELECT COUNT(*) FROM dbo.TBL005", 1),
            ("TBL006", "مجموعات الأصناف", "SELECT COUNT(*) FROM dbo.TBL006", 5),
            ("TBL007", "الأصناف", "SELECT COUNT(*) FROM dbo.TBL007", 10),
            ("TBL008", "المخازن", "SELECT COUNT(*) FROM dbo.TBL008", 1),
            ("TBL015", "مجموعات العملاء", "SELECT COUNT(*) FROM dbo.TBL015", 1),
            ("TBL016", "العملاء", "SELECT COUNT(*) FROM dbo.TBL016", 1),
            ("TBL020", "أنواع الفواتير", "SELECT COUNT(*) FROM dbo.TBL020", 1),
            ("TBL049", "المشاريع", "SELECT COUNT(*) FROM dbo.TBL049", 1),
        ]
        result_rows = []
        ok = 0
        warn = 0
        err = 0

        for code, label, sql, min_count in checks:
            try:
                cursor.execute(sql)
                cnt = int((cursor.fetchone() or [0])[0] or 0)
                status = "OK" if cnt >= min_count else "WARN"
                if status == "OK":
                    ok += 1
                else:
                    warn += 1
                result_rows.append(
                    {
                        "table": code,
                        "label": label,
                        "status": status,
                        "count": cnt,
                        "requiredMin": min_count,
                        "message": "جاهز" if status == "OK" else "أقل من الحد الأدنى",
                    }
                )
            except Exception as e:
                err += 1
                result_rows.append(
                    {
                        "table": code,
                        "label": label,
                        "status": "ERROR",
                        "count": None,
                        "requiredMin": min_count,
                        "message": str(e),
                    }
                )

        # تحققات حرجة إضافية
        extras = []
        try:
            cursor.execute("SELECT COUNT(*) FROM dbo.TBL006 WHERE GroupName = N'خامات الطبخ بالمطعم'")
            c = int((cursor.fetchone() or [0])[0] or 0)
            extras.append({"key": "cooking_root_group", "status": "OK" if c > 0 else "WARN", "message": "جذر خامات الطبخ موجود" if c > 0 else "جذر خامات الطبخ غير موجود"})
        except Exception as e:
            extras.append({"key": "cooking_root_group", "status": "ERROR", "message": str(e)})

        try:
            cursor.execute("SELECT COUNT(*) FROM dbo.TBL016 WHERE AgentName = N'عميل نقدي'")
            c = int((cursor.fetchone() or [0])[0] or 0)
            extras.append({"key": "cash_customer", "status": "OK" if c > 0 else "WARN", "message": "عميل نقدي موجود" if c > 0 else "عميل نقدي غير موجود"})
        except Exception as e:
            extras.append({"key": "cash_customer", "status": "ERROR", "message": str(e)})

        for x in extras:
            if x["status"] == "OK":
                ok += 1
            elif x["status"] == "WARN":
                warn += 1
            else:
                err += 1

        global_status = "OK" if err == 0 and warn == 0 else ("WARN" if err == 0 else "ERROR")
        return {
            "ok": True,
            "status": global_status,
            "summary": {"ok": ok, "warn": warn, "error": err},
            "tables": result_rows,
            "extraChecks": extras,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل تقرير التحقق: {e}")
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

    _this = Path(__file__).resolve()
    print("=" * 56)
    print("MAT3AM_API — مطاعم/backend (دخول dev دائم في هذا الملف)")
    print(f"ملف الخادم: {_this}")
    print(f"المنفذ: {XTRA_API_PORT} — تحقق: http://127.0.0.1:{XTRA_API_PORT}/__whoami__")
    print("يجب أن يظهر سطر: MAT3AM_API=1 DEV_LOGIN_ALWAYS=1")
    print("=" * 56)
    uvicorn.run(app, host="0.0.0.0", port=XTRA_API_PORT)
