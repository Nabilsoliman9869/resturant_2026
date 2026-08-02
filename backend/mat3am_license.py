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
        "companyNameAr": "شركة إكسترا ويب للاستشارات والأنظمة",
        "companyNameEn": "Xtra Web Consulting & Systems",
        "productName": "Mat3amPOS",
        "copyrightLine": "جميع الحقوق محفوظة © {year} {company}. يُمنع النسخ أو التوزيع دون ترخيص.",
        "phones": ["0100 000 0000", "0111 000 0000"],
        "whatsapp": "",
        "email": "support@example.com",
        "website": "",
        "splashSeconds": 2,
        "activationServerUrl": "https://resturant2026-production.up.railway.app",
        "requireOnlineBurn": False,
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


def _sign_body(body16: str, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), body16.encode("utf-8"), hashlib.sha256).hexdigest()
    # map hex → base36-ish A-Z0-9 length 8 for the signature half
    n = int(digest[:16], 16)
    chars = []
    for _ in range(8):
        chars.append(KEY_ALPHABET[n % 36])
        n //= 36
    return "".join(chars)


def generate_license_key(*, serial: int = 0, secret: Optional[str] = None, batch: str = "A") -> str:
    """يولّد مفتاحاً فريداً موقّعاً. serial/batch للسجل لدى الشركة فقط."""
    secret = secret or resolve_license_secret()
    batch_c = (batch or "A")[:1].upper()
    if batch_c not in KEY_ALPHABET:
        batch_c = "A"
    # 8 أحرف هوية عشوائية (مع بصمة دفعة/تسلسل مخفّاة) + 8 توقيع
    rnd = "".join(secrets.choice(KEY_ALPHABET) for _ in range(5))
    serial_nibble = KEY_ALPHABET[int(serial or 0) % 36]
    ident_body = (batch_c + serial_nibble + rnd)[:8]
    while len(ident_body) < 8:
        ident_body += secrets.choice(KEY_ALPHABET)
    sig = _sign_body(ident_body, secret)
    body = ident_body + sig
    return f"{PRODUCT_CODE}-{body[0:4]}-{body[4:8]}-{body[8:12]}-{body[12:16]}"


def verify_license_key_format(key: str, secret: Optional[str] = None) -> tuple[bool, str]:
    secret = secret or resolve_license_secret()
    norm = normalize_license_key(key)
    if not norm:
        return False, "صيغة رقم الرخصة غير صحيحة"
    body = _b32_clean(norm)[len(PRODUCT_CODE) :]
    if len(body) != 16:
        return False, "طول رقم الرخصة غير مكتمل"
    ident_body, sig = body[:8], body[8:]
    expect = _sign_body(ident_body, secret)
    if not hmac.compare_digest(sig, expect):
        return False, "رقم الرخصة غير صالح أو غير صادر من المولّد الرسمي"
    return True, norm


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
    ok, norm_or_msg = verify_license_key_format(key, secret=secret)
    if not ok:
        return False, norm_or_msg
    mid = machine_fingerprint()
    stored = str(data.get("machineId") or "")
    if stored and stored != mid:
        return False, "الرخصة مربوطة بجهاز آخر — تواصل مع الشركة لنقل الترخيص"
    if str(data.get("keyHash") or "") != _key_hash(normalize_license_key(key)):
        return False, "ملف الرخصة تالف"
    return True, normalize_license_key(key)


def _online_burn(
    *,
    norm_key: str,
    machine_id: str,
    server_url: str,
    timeout: float = 12.0,
) -> tuple[bool, str, Optional[dict]]:
    """يحرق المفتاح على السيرفر (مرة واحدة عالمياً)."""
    base = (server_url or "").strip().rstrip("/")
    if not base:
        return True, "offline", None
    url = f"{base}/api/license/activate"
    body = json.dumps(
        {
            "key": norm_key,
            "keyHash": _key_hash(norm_key),
            "machineId": machine_id,
            "product": PRODUCT_CODE,
            "hostname": platform.node(),
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
    ok, norm_or_msg = verify_license_key_format(raw_key, secret=secret)
    if not ok:
        return False, norm_or_msg
    norm = norm_or_msg
    mid = machine_fingerprint()
    existing = read_local_license()
    if existing and str(existing.get("machineId") or "") == mid:
        prev = normalize_license_key(str(existing.get("key") or ""))
        if prev == norm:
            return True, "الرخصة مفعّلة مسبقاً على هذا الجهاز"

    brand = load_branding()
    server = str(brand.get("activationServerUrl") or "").strip()
    require_online = bool(brand.get("requireOnlineBurn"))
    online_ok = True
    online_msg = "offline"
    if server and not force_offline:
        online_ok, online_msg, _ = _online_burn(norm_key=norm, machine_id=mid, server_url=server)
        if not online_ok and require_online:
            return False, online_msg
        # إن فشل الاتصال ولم يُطلب الحرق الإلزامي — نسمح بالتفعيل المحلي مع تحذير في الرسالة
    elif require_online and not force_offline:
        return False, "التفعيل يتطلب اتصال بالإنترنت (خادم الحرق غير مضبوط)"

    payload = {
        "key": norm,
        "keyHash": _key_hash(norm),
        "machineId": mid,
        "activatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "product": PRODUCT_CODE,
        "hostname": platform.node(),
        "onlineBurn": online_ok and online_msg != "offline",
        "onlineMessage": online_msg,
    }
    write_local_license(payload)
    if online_ok and online_msg != "offline":
        return True, f"تم تفعيل الرخصة بنجاح وربطها بهذا الجهاز.\n({online_msg})"
    if server and not online_ok:
        return True, (
            "تم تفعيل الرخصة محلياً وربطها بهذا الجهاز.\n"
            f"تنبيه: لم يُحرق المفتاح على السيرفر ({online_msg})."
        )
    return True, "تم تفعيل الرخصة وربطها بهذا الجهاز."


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
