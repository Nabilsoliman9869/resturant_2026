# -*- coding: utf-8 -*-
"""نبض تشغيل المطعم عبر Telegram — تقرير عند الطلب + جدولة دورية."""
from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable, Optional

TELEGRAM_OPS_DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "botToken": "",
    "chatIds": [],  # أرقام أو نصوص chat_id المسموح بها
    "scheduleEnabled": True,
    "intervalMinutes": 30,
    "quietHoursStart": 3,   # ساعة محلية 0-23 — صمت بعد هذا
    "quietHoursEnd": 9,     # حتى هذا
    "lastScheduledAt": "",
    "lastSentAt": "",
    "lastError": "",
    "venueLabel": "المطعم",
}

_CMD_RE = re.compile(
    r"^\s*(?:/report(?:@\w+)?|التقرير|ارسل التقرير|أرسل التقرير|report)\s*$",
    re.IGNORECASE | re.UNICODE,
)

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
    """إخفاء التوكن في الاستجابة العامة."""
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
    # لا تمسح التوكن لو أُرسل فارغاً مع قناع فقط
    if "botToken" in body:
        tok = str(body.get("botToken") or "").strip()
        if tok and tok != cur.get("botToken") and "…" not in tok and "***" not in tok:
            merged["botToken"] = tok
        elif not tok and body.get("clearBotToken"):
            merged["botToken"] = ""
    merged = normalize_settings(merged)
    # احتفظ بطوابع الإرسال السابقة
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
        "ready": "ready",
        "جاهزة": "ready",
        "occupied": "occupied",
        "مشغولة": "occupied",
        "reserved": "reserved",
        "محجوزة": "reserved",
        "dirty": "dirty",
        "متسخة": "dirty",
        "cleaning": "cleaning",
        "تنظيف": "cleaning",
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


def compose_ops_pulse_text(
    *,
    venue_label: str,
    snap: dict,
    delivery_tickets: list,
    pending_approvals: list,
    now_local: Optional[datetime] = None,
) -> str:
    now = now_local or datetime.now()
    stamp = now.strftime("%Y-%m-%d %H:%M")

    tables = snap.get("tables") if isinstance(snap.get("tables"), list) else []
    sessions = snap.get("sessions") if isinstance(snap.get("sessions"), list) else []
    orders = snap.get("orders") if isinstance(snap.get("orders"), list) else []
    transfers = snap.get("tempCaptainTransfers") if isinstance(snap.get("tempCaptainTransfers"), list) else []

    t_counts = _count_by(tables, "status", _norm_table_status)
    occ = t_counts.get("occupied", 0)
    ready = t_counts.get("ready", 0)
    dirty = t_counts.get("dirty", 0) + t_counts.get("cleaning", 0)
    reserved = t_counts.get("reserved", 0)
    overdue = sum(1 for t in tables if isinstance(t, dict) and (t.get("cleanupOverdue") or t.get("noOrderOverdue")))
    bill_wait = sum(
        1
        for t in tables
        if isinstance(t, dict)
        and (
            t.get("awaitingPayment")
            or t.get("billingRequestedAt")
            or str(t.get("billingStatus") or "").lower() in ("bill_requested", "awaiting_payment")
        )
    )

    active_sessions = [
        s
        for s in sessions
        if isinstance(s, dict) and str(s.get("status") or "").lower() in ("", "open", "active", "seated", "occupied")
        and not s.get("closedAt")
    ]
    # إن لم يتضح الحقل، اعتبر غير المغلقة
    if not active_sessions:
        active_sessions = [s for s in sessions if isinstance(s, dict) and not s.get("closedAt") and not s.get("endedAt")]

    o_counts = _count_by(orders, "status", _norm_order_status)
    kitchen_pending = o_counts.get("pending", 0)
    kitchen_prep = o_counts.get("preparing", 0)
    kitchen_ready = o_counts.get("ready", 0)

    d_counts = _count_by(delivery_tickets, "status", lambda x: str(x or "").strip().lower() or "unknown")
    d_kitchen = d_counts.get("kitchen", 0) + d_counts.get("confirmed", 0)
    d_ready = d_counts.get("ready", 0)
    d_out = d_counts.get("out_for_delivery", 0)
    d_open = sum(
        d_counts.get(k, 0)
        for k in (
            "intake",
            "draft_quote",
            "quoted",
            "confirmed",
            "kitchen",
            "ready",
            "out_for_delivery",
            "delivered",
        )
    )

    captain_loads: dict[str, int] = {}
    for s in active_sessions:
        name = str(s.get("captainName") or s.get("captainLogin") or s.get("waiterName") or "").strip()
        if not name:
            continue
        captain_loads[name] = captain_loads.get(name, 0) + 1
    # طاولات مشغولة بلا اسم كابتن في الجلسة
    for t in tables:
        if not isinstance(t, dict):
            continue
        if _norm_table_status(t.get("status")) != "occupied":
            continue
        cname = str(t.get("captainName") or t.get("assignedCaptainName") or "").strip()
        if cname and cname not in captain_loads:
            captain_loads[cname] = captain_loads.get(cname, 0)

    captains_line = " · ".join(
        f"{n} {c}" for n, c in sorted(captain_loads.items(), key=lambda x: (-x[1], x[0]))[:8]
    ) or "لا كباتن مسجّلين على جلسات نشطة"
    if len(captain_loads) > 8:
        captains_line += f" · +{len(captain_loads) - 8}"

    pending_n = len([a for a in pending_approvals if isinstance(a, dict)])
    temp_tr = len(transfers)

    lines = [
        f"📊 {venue_label} — نبض التشغيل",
        f"🕒 {stamp}",
        "━━━━━━━━━━━━━━━━",
        f"🏛 الصالة: مشغولة {occ} · جاهزة {ready} · متسخة/تنظيف {dirty} · محجوزة {reserved}",
        f"   جلسات نشطة ≈ {len(active_sessions)} · بانتظار حساب {bill_wait} · متأخرة {overdue}",
        f"🍳 المطبخ: قيد {kitchen_pending} · تحضير {kitchen_prep} · جاهز {kitchen_ready}",
        f"🛵 الدليفري: مفتوح {d_open} · مطبخ/تأكيد {d_kitchen} · جاهز {d_ready} · في الطريق {d_out}",
        f"👨‍🍳 الكباتن: {captains_line}",
        f"🔁 تحويلات كابتن مؤقتة: {temp_tr}",
        f"✅ موافقات معلّقة: {pending_n}",
        "━━━━━━━━━━━━━━━━",
        "أوامر: التقرير | /report",
    ]
    return "\n".join(lines)


def is_report_command(text: str) -> bool:
    return bool(_CMD_RE.match(str(text or "")))


def _telegram_api(token: str, method: str, payload: dict, timeout: int = 25) -> dict:
    url = f"https://api.telegram.org/bot{token}/{method}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
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


def send_message(token: str, chat_id: str, text: str) -> dict:
    return _telegram_api(
        token,
        "sendMessage",
        {
            "chat_id": str(chat_id),
            "text": text,
            "disable_web_page_preview": True,
        },
    )


def get_updates(token: str, offset: int = 0, timeout: int = 0) -> dict:
    payload: dict[str, Any] = {"timeout": int(timeout), "allowed_updates": ["message"]}
    if offset:
        payload["offset"] = int(offset)
    return _telegram_api(token, "getUpdates", payload, timeout=max(10, int(timeout) + 5))


def chat_allowed(st: dict, chat_id: str) -> bool:
    allowed = [str(x) for x in (st.get("chatIds") or [])]
    # قائمة فارغة = وضع تجربة: اقبل أول محادثة ثم سجّلها تلقائياً
    if not allowed:
        return True
    return str(chat_id) in allowed


def ensure_chat_registered(path: str, chat_id: str) -> dict:
    """يضيف chat_id للقائمة إن لم يكن موجوداً (مفيد لأول تشغيل)."""
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
    # يعبر منتصف الليل: مثلاً 23→7
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
        # ISO or naive
        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
        if last_dt.tzinfo:
            last_dt = last_dt.astimezone().replace(tzinfo=None)
    except Exception:
        return True
    mins = int(st.get("intervalMinutes") or 30)
    return (now - last_dt).total_seconds() >= mins * 60


class OpsPulseRuntime:
    """يربط المسارات والجدولة بخادم FastAPI دون استيراد دائري ثقيل."""

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

    def build_text(self, st: Optional[dict] = None) -> str:
        st = st or load_settings(self.path())
        ctx = self.build_context_fn() or {}
        return compose_ops_pulse_text(
            venue_label=str(st.get("venueLabel") or ctx.get("venueLabel") or "المطعم"),
            snap=ctx.get("snap") if isinstance(ctx.get("snap"), dict) else {},
            delivery_tickets=ctx.get("deliveryTickets") if isinstance(ctx.get("deliveryTickets"), list) else [],
            pending_approvals=ctx.get("pendingApprovals") if isinstance(ctx.get("pendingApprovals"), list) else [],
        )

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
                r = send_message(token, cid, text)
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
                "preview": text[:400],
            }

    def handle_incoming_message(self, chat_id: str, text: str) -> Optional[dict]:
        path = self.path()
        st = load_settings(path)
        if not st.get("enabled"):
            return {"ok": False, "detail": "disabled"}
        raw = str(text or "").strip()
        # /start يسجّل المحادثة ويرد بترحيب
        if raw.lower().startswith("/start"):
            if not chat_allowed(st, chat_id):
                send_message(st["botToken"], chat_id, "غير مصرح لهذا المحادثة باستلام تقارير المطعم.")
                return {"ok": False, "detail": "chat_not_allowed"}
            st = ensure_chat_registered(path, chat_id)
            send_message(
                st["botToken"],
                chat_id,
                f"تم ربط هذه المحادثة بنبض تشغيل «{st.get('venueLabel') or 'المطعم'}».\nأرسل: التقرير أو /report",
            )
            return {"ok": True, "chatId": chat_id, "action": "start"}
        if not is_report_command(text):
            return None
        if not chat_allowed(st, chat_id):
            send_message(st["botToken"], chat_id, "غير مصرح لهذا المحادثة باستلام تقارير المطعم.")
            return {"ok": False, "detail": "chat_not_allowed"}
        st = ensure_chat_registered(path, chat_id)
        text_out = self.build_text(st)
        r = send_message(st["botToken"], chat_id, text_out)
        if r.get("ok"):
            patch_meta(path, lastSentAt=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), lastError="")
        return {"ok": bool(r.get("ok")), "chatId": chat_id, "telegram": r}

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
