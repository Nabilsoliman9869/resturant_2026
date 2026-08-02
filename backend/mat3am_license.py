"""
ترخيص Mat3amPOS — مفاتيح موقّعة HMAC لمرة واحدة + ربط بالجهاز.

صيغة المفتاح: M3AM-XXXX-XXXX-XXXX-XXXX
الملف المحلي بعد التفعيل: %LOCALAPPDATA%\\Mat3amPOS\\license.dat
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import platform
import re
import secrets
import string
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

PRODUCT_CODE = "M3AM"
KEY_ALPHABET = string.ascii_uppercase + string.digits
# سر افتراضي للتطوير — غيّره عبر config/mat3am_license_secret.txt قبل شحن العملاء
_DEFAULT_SECRET = "mat3am-license-dev-change-me-before-shipping-2026"

# أنواع الصلاحية: أشهر (0 = دائم)
LICENSE_PLANS: dict[str, dict[str, Any]] = {
    "trial": {"code": "T", "months": 1, "labelAr": "تجريبي — شهر واحد"},
    "quarter": {"code": "Q", "months": 3, "labelAr": "ربع سنوي — 3 أشهر"},
    "half": {"code": "H", "months": 6, "labelAr": "نصف سنوي — 6 أشهر"},
    "year": {"code": "Y", "months": 12, "labelAr": "سنوي — 12 شهراً"},
    "years2": {"code": "D", "months": 24, "labelAr": "سنتان"},
    "perpetual": {"code": "P", "months": 0, "labelAr": "دائم (بدون انتهاء)"},
    "custom": {"code": "X", "months": None, "labelAr": "مخصص (بالأشهر)"},
}
_PLAN_BY_CODE = {str(v["code"]): {**v, "id": k} for k, v in LICENSE_PLANS.items()}


def plan_choices_for_ui() -> list[tuple[str, str]]:
    """[(plan_id, label)] للمولّد."""
    return [(k, str(v["labelAr"])) for k, v in LICENSE_PLANS.items() if k != "custom"] + [
        ("custom", "مخصص — حدد عدد الأشهر")
    ]


def resolve_plan(plan: str, months: Optional[int] = None) -> tuple[str, int, str]:
    """يعيد (plan_id, months, labelAr). months=0 يعني دائم."""
    pid = str(plan or "year").strip().lower()
    if pid in ("1", "month", "شهري"):
        pid = "trial"
    if pid in ("3", "quarterly"):
        pid = "quarter"
    if pid in ("6", "semi", "semiannual"):
        pid = "half"
    if pid in ("12", "annual", "yearly"):
        pid = "year"
    if pid in ("24", "biennial"):
        pid = "years2"
    if pid in ("0", "life", "lifetime", "دائم"):
        pid = "perpetual"
    meta = LICENSE_PLANS.get(pid) or LICENSE_PLANS["year"]
    if pid == "custom":
        m = int(months or 1)
        m = max(1, min(120, m))
        return "custom", m, f"مخصص — {m} شهراً"
    m = int(meta["months"] or 0)
    return pid, m, str(meta["labelAr"])


def _encode_months_b36(months: int) -> str:
    m = max(0, min(1295, int(months)))
    return KEY_ALPHABET[m // 36] + KEY_ALPHABET[m % 36]


def _decode_months_b36(two: str) -> int:
    s = (two or "00").upper()
    if len(s) < 2:
        return 0
    try:
        a = KEY_ALPHABET.index(s[0])
        b = KEY_ALPHABET.index(s[1])
    except ValueError:
        return 0
    return a * 36 + b


def add_calendar_months(iso_or_ts: str, months: int) -> str:
    """يضيف أشهراً لتاريخ ISO محلي (بدون مكتبة dateutil)."""
    from datetime import datetime
    from calendar import monthrange

    raw = str(iso_or_ts or "").strip()
    try:
        dt = datetime.fromisoformat(raw[:19])
    except Exception:
        dt = datetime.now()
    if months <= 0:
        return ""
    y, m = dt.year, dt.month + months
    while m > 12:
        y += 1
        m -= 12
    day = min(dt.day, monthrange(y, m)[1])
    return datetime(y, m, day, dt.hour, dt.minute, dt.second).strftime("%Y-%m-%dT%H:%M:%S")


def days_until(iso_end: str) -> Optional[int]:
    from datetime import datetime

    raw = str(iso_end or "").strip()
    if not raw:
        return None
    try:
        end = datetime.fromisoformat(raw[:19])
    except Exception:
        return None
    delta = end.date() - datetime.now().date()
    return int(delta.days)


def _project_root() -> Path:
    if getattr(sys, "frozen", False):
        me = getattr(sys, "_MEIPASS", None)
        if isinstance(me, str) and me:
            return Path(me)
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def persistent_data_root() -> Path:
    env = (os.environ.get("MAT3AM_BASE_DIR") or "").strip()
    if env:
        p = Path(env)
        p.mkdir(parents=True, exist_ok=True)
        return p.resolve()
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", "") or ".") / "Mat3amPOS"
    else:
        base = Path.home() / ".Mat3amPOS"
    base.mkdir(parents=True, exist_ok=True)
    return base.resolve()


def license_path() -> Path:
    return persistent_data_root() / "license.dat"


def branding_path() -> Path:
    for cand in (
        persistent_data_root() / "config" / "license_branding.json",
        _project_root() / "config" / "license_branding.json",
    ):
        if cand.is_file():
            return cand
    return _project_root() / "config" / "license_branding.json"


def load_branding() -> dict[str, Any]:
    defaults = {
        "companyNameAr": "سير كونسلت لتكنولوجيا المعلومات والاستشارات المالية ش.م.م",
        "companyNameEn": "Sir Consult for IT & Financial Consulting LLC",
        "productName": "Mat3amPOS",
        "copyrightLine": "جميع الحقوق محفوظة © {year} {company}. يُمنع النسخ أو التوزيع دون ترخيص.",
        "phones": ["02 2268200", "01026669107", "01026669108", "01103165060", "01103165070"],
        "whatsapp": "01026669107",
        "email": "",
        "website": "",
        "splashSeconds": 3,
        "activationServerUrl": "https://resturant2026-production.up.railway.app",
        "requireOnlineBurn": True,
    }
    try:
        p = branding_path()
        if p.is_file():
            data = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                out = {**defaults, **data}
                if isinstance(data.get("phones"), list):
                    out["phones"] = [str(x).strip() for x in data["phones"] if str(x).strip()]
                return out
    except Exception:
        pass
    return defaults


def resolve_license_secret() -> str:
    env = (os.environ.get("MAT3AM_LICENSE_SECRET") or "").strip()
    if env:
        return env
    candidates = [
        persistent_data_root() / "config" / "mat3am_license_secret.txt",
        Path(sys.executable).resolve().parent / "mat3am_license_secret.txt" if getattr(sys, "frozen", False) else None,
        _project_root() / "config" / "mat3am_license_secret.txt",
    ]
    for c in candidates:
        if c is None:
            continue
        try:
            if c.is_file():
                s = (c.read_text(encoding="utf-8") or "").strip().splitlines()[0].strip()
                if s:
                    return s
        except Exception:
            continue
    return _DEFAULT_SECRET


def _b32_clean(raw: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (raw or "").upper())


def normalize_license_key(raw: str) -> str:
    s = _b32_clean(raw)
    if s.startswith(PRODUCT_CODE):
        s = s[len(PRODUCT_CODE) :]
    # 16 chars payload after product
    if len(s) < 16:
        return ""
    body = s[-16:]
    return f"{PRODUCT_CODE}-{body[0:4]}-{body[4:8]}-{body[8:12]}-{body[12:16]}"


def machine_fingerprint() -> str:
    parts: list[str] = [
        platform.node() or "",
        platform.system() or "",
        platform.machine() or "",
        os.environ.get("COMPUTERNAME", "") or "",
        os.environ.get("USERNAME", "") or "",
    ]
    if os.name == "nt":
        try:
            out = subprocess.check_output(
                ["wmic", "csproduct", "get", "uuid"],
                stderr=subprocess.DEVNULL,
                timeout=8,
                text=True,
                encoding="utf-8",
                errors="ignore",
            )
            for line in out.splitlines():
                line = line.strip()
                if line and line.upper() != "UUID":
                    parts.append(line)
                    break
        except Exception:
            pass
        try:
            out = subprocess.check_output(
                ["wmic", "baseboard", "get", "serialnumber"],
                stderr=subprocess.DEVNULL,
                timeout=8,
                text=True,
                encoding="utf-8",
                errors="ignore",
            )
            for line in out.splitlines():
                line = line.strip()
                if line and "SERIAL" not in line.upper():
                    parts.append(line)
                    break
        except Exception:
            pass
    raw = "|".join(parts)
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()[:40]


def _sign_body(payload: str, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    # map hex → base36-ish A-Z0-9 length 8 for the signature half
    n = int(digest[:16], 16)
    chars = []
    for _ in range(8):
        chars.append(KEY_ALPHABET[n % 36])
        n //= 36
    return "".join(chars)


def generate_license_key(
    *,
    serial: int = 0,
    secret: Optional[str] = None,
    batch: str = "A",
    plan: str = "year",
    months: Optional[int] = None,
) -> str:
    """يولّد مفتاحاً موقّعاً يتضمن نوع الصلاحية وعدد الأشهر."""
    secret = secret or resolve_license_secret()
    plan_id, plan_months, _label = resolve_plan(plan, months)
    plan_code = str((LICENSE_PLANS.get(plan_id) or LICENSE_PLANS["year"])["code"])
    if plan_id == "custom":
        plan_code = "X"
    months_enc = _encode_months_b36(plan_months)
    rnd = "".join(secrets.choice(KEY_ALPHABET) for _ in range(4))
    serial_nibble = KEY_ALPHABET[int(serial or 0) % 36]
    # 8 أحرف هوية: خطة + أشهر(2) + تسلسل + عشوائي
    ident_body = (plan_code + months_enc + serial_nibble + rnd)[:8]
    while len(ident_body) < 8:
        ident_body += secrets.choice(KEY_ALPHABET)
    # توقيع v2 يربط المدة داخل المفتاح
    sig = _sign_body(f"{ident_body}|{plan_months}|v2", secret)
    body = ident_body + sig
    _ = batch  # محفوظ للتوافق مع واجهة المولّد القديمة
    return f"{PRODUCT_CODE}-{body[0:4]}-{body[4:8]}-{body[8:12]}-{body[12:16]}"


def parse_license_key_meta(key: str, secret: Optional[str] = None) -> tuple[bool, str, dict[str, Any]]:
    """يتحقق ويعيد (ok, norm_or_error, meta)."""
    secret = secret or resolve_license_secret()
    norm = normalize_license_key(key)
    if not norm:
        return False, "صيغة رقم الرخصة غير صحيحة", {}
    body = _b32_clean(norm)[len(PRODUCT_CODE) :]
    if len(body) != 16:
        return False, "طول رقم الرخصة غير مكتمل", {}
    ident_body, sig = body[:8], body[8:]
    plan_code = ident_body[0]
    months = _decode_months_b36(ident_body[1:3])
    expect = _sign_body(f"{ident_body}|{months}|v2", secret)
    if not hmac.compare_digest(sig, expect):
        # توافق محدود مع مفاتيح قديمة بلا مدة → نعتبرها دائمة إن صح التوقيع القديم
        expect_old = _sign_body(ident_body, secret)
        if hmac.compare_digest(sig, expect_old):
            return True, norm, {
                "planId": "perpetual",
                "planCode": "P",
                "months": 0,
                "labelAr": "دائم (مفتاح قديم)",
                "legacy": True,
            }
        return False, "رقم الرخصة غير صالح أو غير صادر من المولّد الرسمي", {}
    plan_meta = _PLAN_BY_CODE.get(plan_code)
    if plan_meta:
        plan_id = str(plan_meta.get("id") or "custom")
        label = str(plan_meta.get("labelAr") or "")
        if plan_id == "custom" or plan_code == "X":
            label = f"مخصص — {months} شهراً" if months else "مخصص"
            plan_id = "custom"
        elif int(plan_meta.get("months") or -1) != months and plan_code != "P":
            # الأشهر المضمّنة هي المصدر
            label = f"{label} ({months} شهراً)" if months else label
    else:
        plan_id = "custom"
        label = f"مخصص — {months} شهراً" if months else "غير محدد"
    if plan_code == "P":
        months = 0
        label = str((_PLAN_BY_CODE.get("P") or {}).get("labelAr") or "دائم")
        plan_id = "perpetual"
    return True, norm, {
        "planId": plan_id,
        "planCode": plan_code,
        "months": int(months),
        "labelAr": label,
        "legacy": False,
    }


def verify_license_key_format(key: str, secret: Optional[str] = None) -> tuple[bool, str]:
    ok, norm_or_msg, _meta = parse_license_key_meta(key, secret=secret)
    return ok, norm_or_msg


def _key_hash(norm_key: str) -> str:
    return hashlib.sha256(norm_key.encode("utf-8")).hexdigest()


def read_local_license() -> Optional[dict[str, Any]]:
    p = license_path()
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def write_local_license(payload: dict[str, Any]) -> Path:
    p = license_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)
    return p


def _expiry_message(data: dict[str, Any]) -> tuple[bool, str]:
    """يفحص تاريخ الانتهاء المخزّن محلياً."""
    expires = str(data.get("expiresAt") or "").strip()
    months = int(data.get("months") or 0)
    label = str(data.get("planLabel") or data.get("labelAr") or "")
    if not expires:
        if months <= 0:
            return True, label or "رخصة دائمة"
        return False, "ملف الرخصة بلا تاريخ انتهاء — أعد التفعيل"
    left = days_until(expires)
    if left is None:
        return False, "تاريخ انتهاء الرخصة غير صالح"
    if left < 0:
        return False, f"انتهت صلاحية النسخة في {expires[:10]} — تواصل مع الشركة للتجديد"
    if left == 0:
        return True, f"آخر يوم في الصلاحية ({expires[:10]}) — {label}"
    if left <= 14:
        return True, f"متبقي {left} يوماً حتى {expires[:10]} — {label}"
    return True, f"صالحة حتى {expires[:10]} (متبقي {left} يوماً) — {label}"


def is_license_valid_locally(secret: Optional[str] = None) -> tuple[bool, str]:
    """يعيد (صالح؟، رسالة)."""
    if (os.environ.get("MAT3AM_SKIP_LICENSE") or "").strip() in ("1", "true", "yes"):
        return True, "تم تخطي الترخيص (بيئة تطوير)"
    # التطوير غير المجمّع: لا نجبر الرخصة إلا إن طُلب
    if not getattr(sys, "frozen", False):
        if (os.environ.get("MAT3AM_REQUIRE_LICENSE") or "").strip() not in ("1", "true", "yes"):
            return True, "وضع تطوير — الترخيص غير مطلوب"
    data = read_local_license()
    if not data:
        return False, "لا توجد رخصة مفعّلة على هذا الجهاز"
    key = str(data.get("key") or "")
    ok, norm_or_msg, meta = parse_license_key_meta(key, secret=secret)
    if not ok:
        return False, norm_or_msg
    mid = machine_fingerprint()
    stored = str(data.get("machineId") or "")
    if stored and stored != mid:
        return False, "الرخصة مربوطة بجهاز آخر — تواصل مع الشركة لنقل الترخيص"
    if str(data.get("keyHash") or "") != _key_hash(normalize_license_key(key)):
        return False, "ملف الرخصة تالف"
    # إن كان ملف قديم بلا expiresAt والمفتاح فيه مدة — احسب من activatedAt
    if not str(data.get("expiresAt") or "").strip():
        months = int(data.get("months") if data.get("months") is not None else meta.get("months") or 0)
        if months > 0:
            activated = str(data.get("activatedAt") or "").strip()
            data["expiresAt"] = add_calendar_months(activated, months)
            data["months"] = months
            data["planId"] = meta.get("planId")
            data["planLabel"] = meta.get("labelAr")
            try:
                write_local_license(data)
            except Exception:
                pass
    exp_ok, exp_msg = _expiry_message(data)
    if not exp_ok:
        return False, exp_msg
    return True, f"{normalize_license_key(key)} — {exp_msg}"


def _online_burn(
    *,
    norm_key: str,
    machine_id: str,
    server_url: str,
    meta: Optional[dict] = None,
    timeout: float = 12.0,
) -> tuple[bool, str, Optional[dict]]:
    """يحرق المفتاح على السيرفر (مرة واحدة عالمياً)."""
    base = (server_url or "").strip().rstrip("/")
    if not base:
        return True, "offline", None
    url = f"{base}/api/license/activate"
    meta = meta if isinstance(meta, dict) else {}
    body = json.dumps(
        {
            "key": norm_key,
            "keyHash": _key_hash(norm_key),
            "machineId": machine_id,
            "product": PRODUCT_CODE,
            "hostname": platform.node(),
            "planId": meta.get("planId"),
            "months": meta.get("months"),
            "planLabel": meta.get("labelAr"),
        },
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
            data = json.loads(raw) if raw else {}
            if not isinstance(data, dict):
                return False, "رد غير متوقع من خادم التفعيل", None
            if data.get("ok"):
                return True, str(data.get("message") or "تم الحرق على السيرفر"), data
            return False, str(data.get("detail") or data.get("message") or "رفض خادم التفعيل"), data
    except urllib.error.HTTPError as e:
        try:
            raw = e.read().decode("utf-8", errors="ignore")
            data = json.loads(raw) if raw else {}
            detail = data.get("detail") if isinstance(data, dict) else raw
        except Exception:
            detail = str(e)
        return False, f"خادم التفعيل: {detail}", None
    except Exception as e:
        return False, f"تعذر الاتصال بخادم التفعيل: {e}", None


def activate_license(
    raw_key: str,
    *,
    secret: Optional[str] = None,
    force_offline: bool = False,
) -> tuple[bool, str]:
    ok, norm_or_msg, meta = parse_license_key_meta(raw_key, secret=secret)
    if not ok:
        return False, norm_or_msg
    norm = norm_or_msg
    mid = machine_fingerprint()
    existing = read_local_license()
    if existing and str(existing.get("machineId") or "") == mid:
        prev = normalize_license_key(str(existing.get("key") or ""))
        if prev == norm:
            exp_ok, exp_msg = _expiry_message(existing)
            if not exp_ok:
                return False, exp_msg
            return True, f"الرخصة مفعّلة مسبقاً على هذا الجهاز.\n{exp_msg}"

    brand = load_branding()
    server = str(brand.get("activationServerUrl") or "").strip()
    require_online = bool(brand.get("requireOnlineBurn"))
    online_ok = True
    online_msg = "offline"
    if server and not force_offline:
        online_ok, online_msg, _ = _online_burn(
            norm_key=norm, machine_id=mid, server_url=server, meta=meta
        )
        if not online_ok and require_online:
            return False, online_msg
    elif require_online and not force_offline:
        return False, "التفعيل يتطلب اتصال بالإنترنت (خادم الحرق غير مضبوط)"

    activated_at = time.strftime("%Y-%m-%dT%H:%M:%S")
    months = int(meta.get("months") or 0)
    expires_at = "" if months <= 0 else add_calendar_months(activated_at, months)
    payload = {
        "key": norm,
        "keyHash": _key_hash(norm),
        "machineId": mid,
        "activatedAt": activated_at,
        "expiresAt": expires_at,
        "months": months,
        "planId": meta.get("planId"),
        "planLabel": meta.get("labelAr"),
        "product": PRODUCT_CODE,
        "hostname": platform.node(),
        "onlineBurn": online_ok and online_msg != "offline",
        "onlineMessage": online_msg,
    }
    write_local_license(payload)
    if months <= 0:
        dur = "صلاحية دائمة"
    else:
        dur = f"صالحة لمدة {months} شهراً حتى {expires_at[:10]}"
    base_msg = f"تم تفعيل الرخصة وربطها بهذا الجهاز.\nالنوع: {meta.get('labelAr')}\n{dur}"
    if online_ok and online_msg != "offline":
        return True, f"{base_msg}\n({online_msg})"
    if server and not online_ok:
        return True, f"{base_msg}\nتنبيه: لم يُحرق المفتاح على السيرفر ({online_msg})."
    return True, base_msg


def license_status_public() -> dict[str, Any]:
    ok, msg = is_license_valid_locally()
    data = read_local_license() or {}
    brand = load_branding()
    return {
        "ok": ok,
        "message": msg,
        "frozen": bool(getattr(sys, "frozen", False)),
        "machineId": machine_fingerprint()[:16] + "…",
        "activatedAt": data.get("activatedAt"),
        "expiresAt": data.get("expiresAt") or None,
        "months": data.get("months"),
        "planId": data.get("planId"),
        "planLabel": data.get("planLabel"),
        "daysLeft": days_until(str(data.get("expiresAt") or "")),
        "keyMasked": _mask_key(str(data.get("key") or "")),
        "companyNameAr": brand.get("companyNameAr"),
        "phones": brand.get("phones") or [],
    }


def _mask_key(key: str) -> str:
    norm = normalize_license_key(key)
    if not norm:
        return ""
    parts = norm.split("-")
    if len(parts) < 5:
        return norm[:4] + "-****-****-****"
    return f"{parts[0]}-{parts[1]}-****-****-{parts[-1]}"
