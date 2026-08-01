# -*- coding: utf-8 -*-
"""نبض تشغيل المطعم عبر Telegram — تقرير مرتب + صورة شبكة الطاولات + جدولة/طلب يدوي."""
from __future__ import annotations

import io
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable, Optional

TELEGRAM_OPS_DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "botToken": "",
    "chatIds": [],
    "scheduleEnabled": True,
    "intervalMinutes": 30,
    "quietHoursStart": 3,
    "quietHoursEnd": 9,
    "attachHallImage": True,
    "lastScheduledAt": "",
    "lastSentAt": "",
    "lastError": "",
    "venueLabel": "المطعم",
}

_CMD_REPORT = re.compile(
    r"^\s*(?:/report(?:@\w+)?|/full(?:@\w+)?|التقرير|ارسل التقرير|أرسل التقرير|تقرير كامل|report|full)\s*$",
    re.IGNORECASE | re.UNICODE,
)
_CMD_HELP = re.compile(r"^\s*(?:/help(?:@\w+)?|مساعدة|اوامر|أوامر)\s*$", re.IGNORECASE | re.UNICODE)
_CMD_HALL = re.compile(
    r"^\s*(?:/hall(?:@\w+)?|/tables(?:@\w+)?|صالة|الطاولات|طاولات|لوحة الصالة|hall|tables)\s*$",
    re.IGNORECASE | re.UNICODE,
)
_CMD_KITCHEN = re.compile(r"^\s*(?:/kitchen(?:@\w+)?|مطبخ|kitchen)\s*$", re.IGNORECASE | re.UNICODE)
_CMD_DELIVERY = re.compile(r"^\s*(?:/delivery(?:@\w+)?|دليفري|توصيل|delivery)\s*$", re.IGNORECASE | re.UNICODE)

_STATUS_COLORS = {
    "ready": (34, 197, 94),
    "occupied": (239, 68, 68),
    "reserved": (59, 130, 246),
    "dirty": (245, 158, 11),
    "cleaning": (251, 191, 36),
    "unknown": (100, 116, 139),
}

_lock = threading.RLock()
_poll_offset = 0
_worker_started = False


def normalize_settings(raw: Any) -> dict[str, Any]:
    out = dict(TELEGRAM_OPS_DEFAULTS)
    if not isinstance(raw, dict):
        return out
    out["enabled"] = bool(raw.get("enabled"))
    out["botToken"] = str(raw.get("botToken") or "").strip()
    chats = raw.get("chatIds") or []
    if isinstance(chats, str):
        chats = [x.strip() for x in chats.replace(";", ",").split(",") if x.strip()]
    out["chatIds"] = [str(x).strip() for x in chats if str(x).strip()]
    out["scheduleEnabled"] = bool(raw.get("scheduleEnabled", True))
    out["attachHallImage"] = bool(raw.get("attachHallImage", True))
    try:
        out["intervalMinutes"] = max(5, min(180, int(raw.get("intervalMinutes") or 30)))
    except Exception:
        out["intervalMinutes"] = 30
    try:
        out["quietHoursStart"] = max(0, min(23, int(raw.get("quietHoursStart", 3))))
    except Exception:
        out["quietHoursStart"] = 3
    try:
        out["quietHoursEnd"] = max(0, min(23, int(raw.get("quietHoursEnd", 9))))
    except Exception:
        out["quietHoursEnd"] = 9
    out["lastScheduledAt"] = str(raw.get("lastScheduledAt") or "")
    out["lastSentAt"] = str(raw.get("lastSentAt") or "")
    out["lastError"] = str(raw.get("lastError") or "")[:500]
    out["venueLabel"] = str(raw.get("venueLabel") or "المطعم").strip() or "المطعم"
    return out


def settings_public(st: dict) -> dict:
    out = dict(st)
    tok = str(out.get("botToken") or "")
    out["botTokenConfigured"] = bool(tok)
    out["botTokenMasked"] = (tok[:4] + "…" + tok[-4:]) if len(tok) > 10 else ("***" if tok else "")
    out.pop("botToken", None)
    return out


def load_settings(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return normalize_settings(json.load(f))
    except Exception:
        return normalize_settings({})


def save_settings(path: str, body: dict) -> dict:
    cur = load_settings(path)
    merged = dict(cur)
    for k in TELEGRAM_OPS_DEFAULTS.keys():
        if k in ("lastScheduledAt", "lastSentAt", "lastError"):
            continue
        if k in body and body[k] is not None:
            merged[k] = body[k]
    if "botToken" in body:
        tok = str(body.get("botToken") or "").strip()
        if tok and tok != cur.get("botToken") and "…" not in tok and "***" not in tok:
            merged["botToken"] = tok
        elif not tok and body.get("clearBotToken"):
            merged["botToken"] = ""
    merged = normalize_settings(merged)
    merged["lastScheduledAt"] = cur.get("lastScheduledAt") or ""
    merged["lastSentAt"] = cur.get("lastSentAt") or ""
    merged["lastError"] = cur.get("lastError") or ""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
    return merged


def patch_meta(path: str, **kwargs: Any) -> dict:
    st = load_settings(path)
    for k, v in kwargs.items():
        if k in st or k in TELEGRAM_OPS_DEFAULTS:
            st[k] = v
    st = normalize_settings(st)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=2)
    return st


def _count_by(rows: list, key: str, normalize: Optional[Callable[[Any], str]] = None) -> dict[str, int]:
    out: dict[str, int] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        raw = row.get(key)
        val = normalize(raw) if normalize else str(raw or "").strip().lower()
        if not val:
            val = "unknown"
        out[val] = out.get(val, 0) + 1
    return out


def _norm_table_status(raw: Any) -> str:
    s = str(raw or "").strip().lower()
    mapping = {
        "ready": "ready", "جاهزة": "ready",
        "occupied": "occupied", "مشغولة": "occupied",
        "reserved": "reserved", "محجوزة": "reserved",
        "dirty": "dirty", "متسخة": "dirty",
        "cleaning": "cleaning", "تنظيف": "cleaning",
    }
    return mapping.get(s, s or "unknown")


def _norm_order_status(raw: Any) -> str:
    s = str(raw or "").strip().lower()
    if s in ("pending", "new", "sent", "queued"):
        return "pending"
    if s in ("preparing", "cooking", "in_progress"):
        return "preparing"
    if s in ("ready", "done_kitchen"):
        return "ready"
    if s in ("served", "delivered_to_table", "picked"):
        return "served"
    if s in ("paid", "closed", "settled"):
        return "paid"
    if s in ("cancelled", "canceled", "void"):
        return "cancelled"
    return s or "other"


def _table_label(t: dict) -> str:
    for k in ("label", "name", "displayLabel", "tableLabel", "code", "id"):
        v = str(t.get(k) or "").strip()
        if v:
            return v[:10]
    return "?"


def _gather_metrics(snap: dict, delivery_tickets: list, pending_approvals: list) -> dict:
    tables = snap.get("tables") if isinstance(snap.get("tables"), list) else []
    sessions = snap.get("sessions") if isinstance(snap.get("sessions"), list) else []
    orders = snap.get("orders") if isinstance(snap.get("orders"), list) else []
    transfers = snap.get("tempCaptainTransfers") if isinstance(snap.get("tempCaptainTransfers"), list) else []

    t_counts = _count_by(tables, "status", _norm_table_status)
    active_sessions = [
        s for s in sessions
        if isinstance(s, dict) and not s.get("closedAt") and not s.get("endedAt")
    ]
    o_counts = _count_by(orders, "status", _norm_order_status)
    d_counts = _count_by(delivery_tickets, "status", lambda x: str(x or "").strip().lower() or "unknown")

    bill_wait = sum(
        1 for t in tables
        if isinstance(t, dict) and (
            t.get("awaitingPayment") or t.get("billingRequestedAt")
            or str(t.get("billingStatus") or "").lower() in ("bill_requested", "awaiting_payment")
        )
    )
    overdue = sum(1 for t in tables if isinstance(t, dict) and (t.get("cleanupOverdue") or t.get("noOrderOverdue")))

    captain_loads: dict[str, int] = {}
    for s in active_sessions:
        name = str(s.get("captainName") or s.get("captainLogin") or s.get("waiterName") or "").strip()
        if name:
            captain_loads[name] = captain_loads.get(name, 0) + 1
    for t in tables:
        if not isinstance(t, dict) or _norm_table_status(t.get("status")) != "occupied":
            continue
        cname = str(t.get("captainName") or t.get("assignedCaptainName") or "").strip()
        if cname:
            captain_loads[cname] = captain_loads.get(cname, 0) + (0 if cname in captain_loads else 1)

    return {
        "tables": tables,
        "t_counts": t_counts,
        "active_sessions": active_sessions,
        "o_counts": o_counts,
        "d_counts": d_counts,
        "bill_wait": bill_wait,
        "overdue": overdue,
        "captain_loads": captain_loads,
        "transfers": len(transfers) if isinstance(transfers, list) else 0,
        "pending_n": len([a for a in pending_approvals if isinstance(a, dict)]),
        "table_total": len(tables),
    }


def compose_ops_pulse_text(
    *,
    venue_label: str,
    snap: dict,
    delivery_tickets: list,
    pending_approvals: list,
    now_local: Optional[datetime] = None,
    section: str = "full",
) -> str:
    now = now_local or datetime.now()
    stamp = now.strftime("%Y-%m-%d %H:%M")
    m = _gather_metrics(snap, delivery_tickets, pending_approvals)
    tc = m["t_counts"]
    oc = m["o_counts"]
    dc = m["d_counts"]
    occ = tc.get("occupied", 0)
    ready = tc.get("ready", 0)
    dirty = tc.get("dirty", 0) + tc.get("cleaning", 0)
    reserved = tc.get("reserved", 0)
    total = m["table_total"] or (occ + ready + dirty + reserved)

    captains_lines = [
        f"  • {n}: {c} جلسة"
        for n, c in sorted(m["captain_loads"].items(), key=lambda x: (-x[1], x[0]))[:10]
    ] or ["  • لا كباتن على جلسات نشطة"]

    d_open = sum(dc.get(k, 0) for k in (
        "intake", "draft_quote", "quoted", "confirmed", "kitchen", "ready", "out_for_delivery", "delivered",
    ))

    hall_block = [
        "🏛 <b>الصالة / الطاولات</b>",
        f"إجمالي الطاولات: <b>{total}</b>",
        f"🔴 مشغولة <b>{occ}</b>   🟢 جاهزة <b>{ready}</b>",
        f"🟡 متسخة/تنظيف <b>{dirty}</b>   🔵 محجوزة <b>{reserved}</b>",
        f"جلسات نشطة: <b>{len(m['active_sessions'])}</b>",
        f"بانتظار الحساب: <b>{m['bill_wait']}</b>   متأخرة: <b>{m['overdue']}</b>",
    ]
    kitchen_block = [
        "🍳 <b>المطبخ</b>",
        f"⏳ قيد الإرسال/الانتظار: <b>{oc.get('pending', 0)}</b>",
        f"🔥 قيد التحضير: <b>{oc.get('preparing', 0)}</b>",
        f"✅ جاهز للمناولة: <b>{oc.get('ready', 0)}</b>",
    ]
    delivery_block = [
        "🛵 <b>الدليفري</b>",
        f"تذاكر مفتوحة: <b>{d_open}</b>",
        f"استقبال/عرض: <b>{dc.get('intake', 0) + dc.get('draft_quote', 0) + dc.get('quoted', 0)}</b>",
        f"مطبخ/تأكيد: <b>{dc.get('kitchen', 0) + dc.get('confirmed', 0)}</b>",
        f"جاهز: <b>{dc.get('ready', 0)}</b>   في الطريق: <b>{dc.get('out_for_delivery', 0)}</b>",
        f"تم التسليم (غير مسدد): <b>{dc.get('delivered', 0)}</b>",
    ]
    captains_block = [
        "👨‍🍳 <b>الكباتن</b>",
        *captains_lines,
        f"تحويلات مؤقتة: <b>{m['transfers']}</b>",
    ]
    approvals_block = [
        "✅ <b>الموافقات</b>",
        f"معلّقة بانتظار المدير: <b>{m['pending_n']}</b>",
    ]

    header = [
        f"📊 <b>{venue_label}</b> — نبض التشغيل",
        f"🕒 {stamp}",
        "──────────────",
    ]
    footer = [
        "──────────────",
        "الطلب اليدوي (في أي وقت):",
        "<code>التقرير</code> أو /report",
        "<code>صالة</code> · <code>مطبخ</code> · <code>دليفري</code> · /help",
    ]

    if section == "hall":
        return "\n".join(header + hall_block + footer)
    if section == "kitchen":
        return "\n".join(header + kitchen_block + footer)
    if section == "delivery":
        return "\n".join(header + delivery_block + footer)

    return "\n".join(
        header + hall_block + [""] + kitchen_block + [""] + delivery_block
        + [""] + captains_block + [""] + approvals_block + footer
    )


def help_text(venue_label: str, interval_minutes: int) -> str:
    return "\n".join([
        f"📖 أوامر بوت «{venue_label}»",
        "──────────────",
        "<b>عند الطلب (خارج المواعيد):</b>",
        "• <code>التقرير</code> أو /report — التقرير الكامل",
        "• <code>صالة</code> أو /hall — الصالة + صورة الطاولات",
        "• <code>مطبخ</code> أو /kitchen",
        "• <code>دليفري</code> أو /delivery",
        "• /help — هذه القائمة",
        "──────────────",
        f"الجدولة التلقائية: كل <b>{interval_minutes}</b> دقيقة (إن كانت مفعّلة).",
        "الطلب اليدوي يعمل دائماً حتى أثناء ساعات الصمت.",
    ])


def render_hall_board_png(snap: dict, venue_label: str = "المطعم") -> Optional[bytes]:
    """صورة شبكة ملونة لحالة الطاولات (بديل سكرين شوت للوحة)."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except Exception:
        return None

    tables = [t for t in (snap.get("tables") or []) if isinstance(t, dict)]
    if not tables:
        return None

    # ترتيب حسب التسمية
    tables = sorted(tables, key=lambda t: (_table_label(t), str(t.get("id") or "")))
    n = len(tables)
    cols = 6 if n > 18 else (5 if n > 12 else 4)
    rows = (n + cols - 1) // cols
    cell_w, cell_h = 92, 64
    pad = 12
    header_h = 56
    legend_h = 36
    w = pad * 2 + cols * cell_w + (cols - 1) * 8
    h = header_h + pad + rows * cell_h + (rows - 1) * 8 + legend_h + pad

    img = Image.new("RGB", (w, h), (15, 23, 42))
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("arial.ttf", 14)
        font_sm = ImageFont.truetype("arial.ttf", 11)
        font_lg = ImageFont.truetype("arial.ttf", 16)
    except Exception:
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13)
            font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 10)
            font_lg = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
        except Exception:
            font = ImageFont.load_default()
            font_sm = font
            font_lg = font

    title = f"{venue_label} — Hall Board"
    draw.text((pad, 14), title, fill=(226, 232, 240), font=font_lg)
    draw.text((pad, 34), datetime.now().strftime("%Y-%m-%d %H:%M"), fill=(148, 163, 184), font=font_sm)

    for i, t in enumerate(tables):
        r, c = divmod(i, cols)
        x = pad + c * (cell_w + 8)
        y = header_h + r * (cell_h + 8)
        st = _norm_table_status(t.get("status"))
        color = _STATUS_COLORS.get(st, _STATUS_COLORS["unknown"])
        draw.rounded_rectangle([x, y, x + cell_w, y + cell_h], radius=10, fill=color)
        label = _table_label(t)
        # نص أبيض وسط الخلية
        bbox = draw.textbbox((0, 0), label, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text((x + (cell_w - tw) / 2, y + (cell_h - th) / 2 - 6), label, fill=(255, 255, 255), font=font)
        st_ar = {"ready": "ready", "occupied": "busy", "dirty": "dirty", "cleaning": "clean", "reserved": "rsv"}.get(st, st)
        bbox2 = draw.textbbox((0, 0), st_ar, font=font_sm)
        tw2 = bbox2[2] - bbox2[0]
        draw.text((x + (cell_w - tw2) / 2, y + cell_h - 18), st_ar, fill=(255, 255, 255), font=font_sm)

    # أسطورة
    ly = h - legend_h + 8
    lx = pad
    for key, name in (("occupied", "Busy"), ("ready", "Ready"), ("dirty", "Dirty"), ("reserved", "Rsv")):
        draw.rounded_rectangle([lx, ly, lx + 14, ly + 14], radius=3, fill=_STATUS_COLORS[key])
        draw.text((lx + 18, ly - 1), name, fill=(203, 213, 225), font=font_sm)
        lx += 70

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def is_report_command(text: str) -> bool:
    return bool(_CMD_REPORT.match(str(text or "")))


def _telegram_api(token: str, method: str, payload: dict, timeout: int = 25) -> dict:
    url = f"https://api.telegram.org/bot{token}/{method}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace") if e.fp else str(e)
        try:
            return json.loads(err_body)
        except Exception:
            return {"ok": False, "description": err_body or str(e)}
    except Exception as e:
        return {"ok": False, "description": str(e)}


def send_message(token: str, chat_id: str, text: str, *, parse_mode: str = "HTML") -> dict:
    payload: dict[str, Any] = {
        "chat_id": str(chat_id),
        "text": text,
        "disable_web_page_preview": True,
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode
    return _telegram_api(token, "sendMessage", payload)


def send_photo(token: str, chat_id: str, png_bytes: bytes, caption: str = "") -> dict:
    """إرسال صورة PNG عبر multipart."""
    boundary = "----Mat3amTgBoundary7xK9"
    lines: list[bytes] = []

    def add_field(name: str, value: str) -> None:
        lines.append(f"--{boundary}\r\n".encode())
        lines.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        lines.append(value.encode("utf-8") + b"\r\n")

    add_field("chat_id", str(chat_id))
    if caption:
        add_field("caption", caption[:1024])
        add_field("parse_mode", "HTML")
    lines.append(f"--{boundary}\r\n".encode())
    lines.append(b'Content-Disposition: form-data; name="photo"; filename="hall.png"\r\n')
    lines.append(b"Content-Type: image/png\r\n\r\n")
    lines.append(png_bytes)
    lines.append(b"\r\n")
    lines.append(f"--{boundary}--\r\n".encode())
    body = b"".join(lines)
    url = f"https://api.telegram.org/bot{token}/sendPhoto"
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace") if e.fp else str(e)
        try:
            return json.loads(err_body)
        except Exception:
            return {"ok": False, "description": err_body or str(e)}
    except Exception as e:
        return {"ok": False, "description": str(e)}


def get_updates(token: str, offset: int = 0, timeout: int = 0) -> dict:
    payload: dict[str, Any] = {"timeout": int(timeout), "allowed_updates": ["message"]}
    if offset:
        payload["offset"] = int(offset)
    return _telegram_api(token, "getUpdates", payload, timeout=max(10, int(timeout) + 5))


def chat_allowed(st: dict, chat_id: str) -> bool:
    allowed = [str(x) for x in (st.get("chatIds") or [])]
    if not allowed:
        return True
    return str(chat_id) in allowed


def ensure_chat_registered(path: str, chat_id: str) -> dict:
    st = load_settings(path)
    cid = str(chat_id).strip()
    if not cid:
        return st
    chats = [str(x) for x in (st.get("chatIds") or [])]
    if cid not in chats:
        chats.append(cid)
        st["chatIds"] = chats
        with open(path, "w", encoding="utf-8") as f:
            json.dump(normalize_settings(st), f, ensure_ascii=False, indent=2)
    return load_settings(path)


def in_quiet_hours(st: dict, now: Optional[datetime] = None) -> bool:
    now = now or datetime.now()
    start = int(st.get("quietHoursStart") or 3)
    end = int(st.get("quietHoursEnd") or 9)
    h = now.hour
    if start == end:
        return False
    if start < end:
        return start <= h < end
    return h >= start or h < end


def should_run_schedule(st: dict, now: Optional[datetime] = None) -> bool:
    if not st.get("enabled") or not st.get("scheduleEnabled"):
        return False
    if not st.get("botToken") or not st.get("chatIds"):
        return False
    now = now or datetime.now()
    if in_quiet_hours(st, now):
        return False
    last = str(st.get("lastScheduledAt") or "").strip()
    if not last:
        return True
    try:
        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
        if last_dt.tzinfo:
            last_dt = last_dt.astimezone().replace(tzinfo=None)
    except Exception:
        return True
    mins = int(st.get("intervalMinutes") or 30)
    return (now - last_dt).total_seconds() >= mins * 60


class OpsPulseRuntime:
    def __init__(
        self,
        *,
        settings_path_fn: Callable[[], str],
        build_context_fn: Callable[[], dict],
    ):
        self.settings_path_fn = settings_path_fn
        self.build_context_fn = build_context_fn

    def path(self) -> str:
        return self.settings_path_fn()

    def _ctx(self) -> dict:
        return self.build_context_fn() or {}

    def build_text(self, st: Optional[dict] = None, section: str = "full") -> str:
        st = st or load_settings(self.path())
        ctx = self._ctx()
        return compose_ops_pulse_text(
            venue_label=str(st.get("venueLabel") or ctx.get("venueLabel") or "المطعم"),
            snap=ctx.get("snap") if isinstance(ctx.get("snap"), dict) else {},
            delivery_tickets=ctx.get("deliveryTickets") if isinstance(ctx.get("deliveryTickets"), list) else [],
            pending_approvals=ctx.get("pendingApprovals") if isinstance(ctx.get("pendingApprovals"), list) else [],
            section=section,
        )

    def build_hall_image(self, st: Optional[dict] = None) -> Optional[bytes]:
        st = st or load_settings(self.path())
        ctx = self._ctx()
        snap = ctx.get("snap") if isinstance(ctx.get("snap"), dict) else {}
        return render_hall_board_png(snap, str(st.get("venueLabel") or "المطعم"))

    def _deliver_to_chat(self, st: dict, chat_id: str, *, section: str = "full", with_image: Optional[bool] = None) -> dict:
        token = str(st.get("botToken") or "")
        text = self.build_text(st, section=section)
        want_img = st.get("attachHallImage", True) if with_image is None else with_image
        if want_img and section in ("full", "hall"):
            png = self.build_hall_image(st)
            if png:
                # نص مختصر كتعليق + رسالة تفصيلية بعدها
                cap = text if len(text) <= 1000 else (text[:990] + "…")
                r = send_photo(token, chat_id, png, caption=cap)
                if r.get("ok"):
                    return r
                # سقوط للنص فقط
        return send_message(token, chat_id, text)

    def broadcast(self, *, reason: str = "manual") -> dict:
        path = self.path()
        with _lock:
            st = load_settings(path)
            if not st.get("enabled"):
                return {"ok": False, "detail": "تكامل تليجرام غير مفعّل"}
            token = str(st.get("botToken") or "")
            chats = list(st.get("chatIds") or [])
            if not token:
                return {"ok": False, "detail": "Bot Token غير مضبوط"}
            if not chats:
                return {"ok": False, "detail": "أضف chat_id واحداً على الأقل"}
            try:
                text = self.build_text(st)
            except Exception as e:
                patch_meta(path, lastError=str(e))
                return {"ok": False, "detail": f"فشل بناء التقرير: {e}"}
            results = []
            ok_n = 0
            for cid in chats:
                r = self._deliver_to_chat(st, cid, section="full")
                ok = bool(r.get("ok"))
                if ok:
                    ok_n += 1
                results.append({"chatId": cid, "ok": ok, "description": r.get("description")})
            now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            meta = {"lastSentAt": now_iso, "lastError": "" if ok_n else str(results)}
            if reason == "schedule":
                meta["lastScheduledAt"] = now_iso
            patch_meta(path, **meta)
            return {
                "ok": ok_n > 0,
                "sent": ok_n,
                "total": len(chats),
                "reason": reason,
                "results": results,
                "preview": text[:500],
            }

    def handle_incoming_message(self, chat_id: str, text: str) -> Optional[dict]:
        path = self.path()
        st = load_settings(path)
        if not st.get("enabled"):
            return {"ok": False, "detail": "disabled"}
        raw = str(text or "").strip()
        if not raw:
            return None

        if not chat_allowed(st, chat_id):
            send_message(st["botToken"], chat_id, "غير مصرح لهذه المحادثة.")
            return {"ok": False, "detail": "chat_not_allowed"}

        if raw.lower().startswith("/start"):
            st = ensure_chat_registered(path, chat_id)
            send_message(
                st["botToken"],
                chat_id,
                help_text(str(st.get("venueLabel") or "المطعم"), int(st.get("intervalMinutes") or 30)),
            )
            return {"ok": True, "chatId": chat_id, "action": "start"}

        if _CMD_HELP.match(raw):
            st = ensure_chat_registered(path, chat_id)
            send_message(
                st["botToken"],
                chat_id,
                help_text(str(st.get("venueLabel") or "المطعم"), int(st.get("intervalMinutes") or 30)),
            )
            return {"ok": True, "action": "help"}

        section = None
        with_image = None
        if is_report_command(raw):
            section = "full"
        elif _CMD_HALL.match(raw):
            section = "hall"
            with_image = True
        elif _CMD_KITCHEN.match(raw):
            section = "kitchen"
            with_image = False
        elif _CMD_DELIVERY.match(raw):
            section = "delivery"
            with_image = False
        else:
            return None

        st = ensure_chat_registered(path, chat_id)
        r = self._deliver_to_chat(st, chat_id, section=section, with_image=with_image)
        if r.get("ok"):
            patch_meta(path, lastSentAt=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), lastError="")
        return {"ok": bool(r.get("ok")), "chatId": chat_id, "section": section, "telegram": r}

    def poll_once(self) -> None:
        global _poll_offset
        path = self.path()
        st = load_settings(path)
        if not st.get("enabled") or not st.get("botToken"):
            return
        res = get_updates(st["botToken"], offset=_poll_offset, timeout=0)
        if not res.get("ok"):
            return
        for upd in res.get("result") or []:
            try:
                uid = int(upd.get("update_id") or 0)
                if uid >= _poll_offset:
                    _poll_offset = uid + 1
                msg = upd.get("message") or {}
                chat = msg.get("chat") or {}
                chat_id = str(chat.get("id") or "")
                text = str(msg.get("text") or "")
                if chat_id and text:
                    self.handle_incoming_message(chat_id, text)
            except Exception as e:
                print(f"[telegram-ops] poll item error: {e}", flush=True)

    def tick_schedule(self) -> None:
        path = self.path()
        st = load_settings(path)
        if should_run_schedule(st):
            self.broadcast(reason="schedule")


def start_background_worker(runtime: OpsPulseRuntime, *, poll_seconds: float = 4.0) -> None:
    global _worker_started
    with _lock:
        if _worker_started:
            return
        _worker_started = True

    def _loop():
        print("[telegram-ops] worker started", flush=True)
        while True:
            try:
                runtime.poll_once()
            except Exception as e:
                print(f"[telegram-ops] poll: {e}", flush=True)
            try:
                runtime.tick_schedule()
            except Exception as e:
                print(f"[telegram-ops] schedule: {e}", flush=True)
            time.sleep(max(2.0, float(poll_seconds)))

    t = threading.Thread(target=_loop, name="telegram-ops-pulse", daemon=True)
    t.start()
