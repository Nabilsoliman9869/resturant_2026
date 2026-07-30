"""محرك استنتاج لرسائل المحافظ/البنوك — نسخة الخادم."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

_CREDIT_WORDS = [
    "استلام مبلغ", "تم استلام", "استلمت", "اضيف", "أضيف", "اضافة", "إضافة", "اضيفت",
    "دائن", "وردك", "حولت لك", "حوّل لك", "حول لك", "تم إضافة", "تم اضافة",
    "received", "credited", "deposited", "transferred from", "added to your",
    "has been credited", "ipn transfer",
]
_DEBIT_WORDS = [
    "خصم", "سحب", "دفعت", "مدين", "تم تحويل", "تحويل مبلغ", "حولت الى", "حولت إلى",
    "debited", "withdrawn", "transferred to", "sent to", "paid to", "purchase",
]
# لا تستخدم حرف «ج» وحده — يلتقط «ج م» حول أرقام خطوط الهاتف الأرضي خطأً.
_CURRENCY_WORDS = ["جنيه", "جنيها", "جنيهاً", "ج.م", "ج م", "egp", "l.e", " le", "pound"]
_BALANCE_WORDS = ["رصيدك", "رصيدكم", "رصيد", "الرصيد", "available balance", "balance", "bal"]
_AMOUNT_WORDS = [
    "مبلغ", "استلام", "اضافة", "إضافة", "بـ", "بـ ", "amount", "amt", "received", "credited",
    "egp", "ل.ا",
]
_REF_WORDS = [
    "العملية", "عملية", "المعامل", "معامل", "مرجع", "المرجع",
    "transaction id", "transaction", "txn ref", "txn", "ref:", "ref ", "reference",
]
_WALLET_WORDS = ["محفظت", "حسابك رقم", "حسابك", "account number", "mobile account", "wallet", "account"]
_FROM_WORDS = ["من رقم", "من ", " from ", "from "]
_PROMO_MARKERS = [
    "كاش باك", "هدية", "العرض سارى", "العرض ساري", "خصومات", "حدّثت بيانات", "حدثت بيانات",
    "اوميجابيتس", "ميجا ب", "بدل ", "ببلاش", "لفليكس",
]
_NOISE_SENDERS = [
    "we-landline", "we-data", "we bonus", "we-bonus", "vf-offers", "vodafone offers",
]

# آلاف إنجليزي: 3,000 أو كسر: 20.00 — مع دعم EGP ملتصق
_NUM_RE = re.compile(
    r"(?<![0-9])(?:EGP|LE|USD)?\s*[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|"
    r"(?<![0-9])(?:EGP|LE|USD)?\s*[0-9]+(?:\.[0-9]+)?(?![0-9])",
    re.IGNORECASE,
)
_PHONE_RE = re.compile(r"(?<![0-9])(?:\+?00)?(?:\+?20)?0?1[0125][0-9]{8}(?![0-9])")
_LANDLINE_RE = re.compile(r"(?<![0-9])0?2[0-9]{7,8}(?![0-9])")
_NAME_RE = re.compile(
    r"(?:ب[إا]سم|باسم|name[:\s]|from\s)([^\n0-9]{3,60}?)\s*(?:على|رقم|for an|\.|,|\n|$)",
    re.IGNORECASE,
)
_TIME_RE = re.compile(r"([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\s*(?:AM|PM|ص|م)?)", re.IGNORECASE)
_DATE_RE = re.compile(r"([0-9]{1,4}[-/][0-9]{1,2}[-/][0-9]{1,4})")


def _normalize_digits(text: str) -> str:
    out = []
    for ch in text:
        code = ord(ch)
        if 0x0660 <= code <= 0x0669:
            out.append(chr(ord("0") + code - 0x0660))
        elif 0x06F0 <= code <= 0x06F9:
            out.append(chr(ord("0") + code - 0x06F0))
        elif ch == "\u066B":
            out.append(".")
        elif ch == "\u066C":
            out.append(",")
        else:
            out.append(ch)
    s = "".join(out)
    # افصل رمز العملة الملتصق بالرقم: EGP3,000 → EGP 3,000
    s = re.sub(r"(?i)(EGP|USD|LE)(?=\d)", r"\1 ", s)
    return s


def _ctx(body: str, start: int, end: int, radius: int = 18) -> str:
    return body[max(0, start - radius): min(len(body), end + radius)].lower()


def _contains_any(hay: str, words) -> bool:
    low = hay.lower()
    return any(w in low for w in words)


def _to_money(raw: str) -> Optional[float]:
    try:
        cleaned = re.sub(r"(?i)(?:EGP|USD|LE)\s*", "", raw).strip()
        # 3,000 = آلاف، 3,50 = كسر أوروبي نادر — نعامل الفاصلة كآلاف إذا وُجدت 3 خانات بعدها
        if re.search(r",\d{3}(\.|$)", cleaned) or cleaned.count(",") >= 1 and "." not in cleaned:
            cleaned = cleaned.replace(",", "")
        else:
            cleaned = cleaned.replace(",", ".")
        return float(cleaned)
    except (TypeError, ValueError):
        return None


def _keyword_spans(lower_body: str, words):
    spans = []
    for w in words:
        start = 0
        wl = w.lower()
        while True:
            i = lower_body.find(wl, start)
            if i < 0:
                break
            spans.append((i, i + len(wl)))
            start = i + 1
    return spans


def _nearest_after(tokens, spans, max_dist: int = 40):
    best = None
    best_dist = None
    for t in tokens:
        for ks, ke in spans:
            if t["start"] >= ke:
                dist = t["start"] - ke
            elif t["end"] <= ks:
                dist = (ks - t["end"]) + 500
            else:
                continue
            if dist <= max_dist and (best_dist is None or dist < best_dist):
                best, best_dist = t, dist
    return best


def _norm_phone(raw: str) -> str:
    p = "".join(c for c in raw if c.isdigit())
    while p.startswith("00"):
        p = p[2:]
    if p.startswith("20"):
        p = p[2:]
    if not p.startswith("0"):
        p = "0" + p
    return p


def provider_for(sender: str, body: str) -> str:
    s = (sender or "").lower()
    b = (body or "").lower()
    if ("vf-cash" in s or "v cash" in s or "vodafone cash" in b
            or "محفظت" in b or "فودافون كاش" in b):
        return "vodafone_cash"
    if "adib" in s or "adib" in b:
        return "bank_adib"
    if "instapay" in s or "instapay" in b or "ipn transfer" in b:
        return "instapay"
    if "orange" in s:
        return "orange_cash"
    if "etisalat" in s:
        return "etisalat_cash"
    return "sms_unknown"


def is_noise_sender(sender: str) -> bool:
    s = (sender or "").lower().strip()
    return any(n in s for n in _NOISE_SENDERS)


def parse_sms(sender: str, raw_body: str) -> Dict[str, Any]:
    body = _normalize_digits(raw_body or "")
    lower = body.lower()

    if is_noise_sender(sender) or _contains_any(lower, _PROMO_MARKERS):
        return {
            "provider": provider_for(sender, body),
            "kind": "promo",
            "amount": None,
            "fromPhone": None,
            "fromName": None,
            "walletOrAccount": None,
            "balance": None,
            "smsAt": None,
            "refNo": None,
            "confidence": 0,
        }

    credit = sum(1 for w in _CREDIT_WORDS if w in lower)
    debit = sum(1 for w in _DEBIT_WORDS if w in lower)
    # «شحن» وحده غالباً إنترنت/رصيد هاتف وليس تحويل محفظة
    if "شحن" in lower and credit == 0 and "محفظ" not in lower and "فودافون كاش" not in lower:
        if "إنترنت" in lower or "الانترنت" in lower or "الأرضى" in lower or "الارضى" in lower:
            return {
                "provider": provider_for(sender, body),
                "kind": "promo",
                "amount": None, "fromPhone": None, "fromName": None,
                "walletOrAccount": None, "balance": None, "smsAt": None,
                "refNo": None, "confidence": 0,
            }

    if credit > 0 and credit >= debit:
        direction = "incoming"
    elif debit > 0:
        direction = "debit"
    else:
        direction = "info"

    toks: List[dict] = []
    for m in _NUM_RE.finditer(body):
        v = m.group().strip()
        digits = "".join(c for c in v if c.isdigit())
        toks.append({
            "value": v,
            "digits": digits,
            "decimal": ("." in v) or bool(re.search(r",\d{1,2}$", v)),
            "thousands": bool(re.search(r",\d{3}", v)),
            "ctx": _ctx(body, m.start(), m.end()),
            "start": m.start(),
            "end": m.end(),
        })

    phones = [
        {"phone": _norm_phone(m.group()), "start": m.start(), "end": m.end()}
        for m in _PHONE_RE.finditer(body)
    ]
    landline_spans = [(m.start(), m.end()) for m in _LANDLINE_RE.finditer(body)]

    def is_phone_tok(t) -> bool:
        d = t["digits"]
        if not (10 <= len(d) <= 13):
            return False
        # أرقام مصر: بعد إزالة المقدمة يجب أن تكون 01[0125]XXXXXXXX
        core = d
        if core.startswith("0020"):
            core = core[4:]
        elif core.startswith("20"):
            core = core[2:]
        if not core.startswith("0"):
            core = "0" + core
        return len(core) == 11 and core[0] == "0" and core[1] == "1" and core[2] in "0125"

    def is_landline_tok(t) -> bool:
        for a, b in landline_spans:
            if t["start"] >= a and t["end"] <= b:
                return True
        d = t["digits"]
        return len(d) in (8, 9, 10) and (d.startswith("02") or d.startswith("2") and len(d) >= 9)

    def money_score(t) -> int:
        if is_phone_tok(t) or is_landline_tok(t):
            return -1000
        if len(t["digits"]) >= 9 and not t["decimal"] and not t["thousands"]:
            return -1000  # رقم خط / حساب طويل وليس مبلغاً
        score = 0
        ctx = t["ctx"]
        if t["decimal"] or t["thousands"]:
            score += 40
        if _contains_any(ctx, _CURRENCY_WORDS) or "egp" in ctx or "جنيه" in ctx or "ج م" in ctx or "ج.م" in ctx:
            score += 50
        if _contains_any(ctx, _AMOUNT_WORDS):
            score += 30
        if _contains_any(ctx, _BALANCE_WORDS):
            score -= 25  # يفضَّل ألا يُختار الرصيد كمبلغ العملية
        # أيام التاريخ الصغيرة بدون عملة قريبة
        val = _to_money(t["value"])
        if val is not None and val <= 31 and not t["decimal"] and not t["thousands"] and not _contains_any(ctx, _CURRENCY_WORDS):
            score -= 40
        if val is not None and val > 500_000:
            score -= 80
        return score

    money_toks = [t for t in toks if money_score(t) >= 30]
    if not money_toks:
        money_toks = [t for t in toks if money_score(t) >= 10]

    # الرصيد يُبحث من كل الأرقام العشرية قرب كلمة رصيد — حتى لو لم يدخل قائمة المبالغ.
    balance_pool = [
        t for t in toks
        if not is_phone_tok(t) and not is_landline_tok(t)
        and (t["decimal"] or t["thousands"] or len(t["digits"]) <= 8)
    ]
    balance_tok = _nearest_after(balance_pool, _keyword_spans(lower, _BALANCE_WORDS), max_dist=50)
    amount_candidates = [t for t in money_toks if t is not balance_tok]
    # تجنّب التقاط الرسوم بدل المبلغ الأصلي
    fee_spans = _keyword_spans(lower, ["fee", "مصاريف", "رسوم", "transfer fee"])
    amount_candidates = [
        t for t in amount_candidates
        if not any(abs(t["start"] - fs) < 25 for fs, fe in fee_spans)
    ] or [t for t in money_toks if t is not balance_tok]

    amount_tok = _nearest_after(
        amount_candidates,
        _keyword_spans(lower, _AMOUNT_WORDS + _CREDIT_WORDS + _DEBIT_WORDS + _CURRENCY_WORDS),
        max_dist=50,
    )
    if amount_tok is None and amount_candidates:
        # فضّل الأكبر بين المرشحين ذوي العملة (560 أفضل من 2.8)
        amount_tok = max(
            amount_candidates,
            key=lambda t: (money_score(t), _to_money(t["value"]) or 0),
        )

    amount = _to_money(amount_tok["value"]) if amount_tok else None
    balance = _to_money(balance_tok["value"]) if balance_tok else None

    ref_candidates = [
        t for t in toks
        if not t["decimal"] and not is_phone_tok(t) and not is_landline_tok(t)
        and len(t["digits"]) >= 9
        and t is not amount_tok and t is not balance_tok
    ]
    ref_tok = _nearest_after(ref_candidates, _keyword_spans(lower, _REF_WORDS))
    ref_no = ref_tok["digits"] if ref_tok else None

    wallet_spans = _keyword_spans(lower, _WALLET_WORDS)
    wallet_phone = _nearest_after(phones, wallet_spans)
    wallet = wallet_phone["phone"] if wallet_phone else None
    if wallet is None:
        wallet_tok = _nearest_after(
            [t for t in toks
             if not is_phone_tok(t) and not is_landline_tok(t)
             and 6 <= len(t["digits"]) <= 24
             and t is not amount_tok and t is not balance_tok and t is not ref_tok],
            wallet_spans,
        )
        wallet = wallet_tok["digits"] if wallet_tok else None

    from_phone_tok = _nearest_after(phones, _keyword_spans(lower, _FROM_WORDS), max_dist=20)
    from_phone = from_phone_tok["phone"] if from_phone_tok else None
    if from_phone is None:
        from_phone = next(
            (p["phone"] for p in phones
             if not (wallet_phone and p["start"] == wallet_phone["start"])),
            None,
        )

    name_m = _NAME_RE.search(body)
    from_name = name_m.group(1).strip() if name_m and name_m.group(1).strip() else None
    if from_name and len(from_name) < 3:
        from_name = None

    time_m = _TIME_RE.search(body)
    date_m = _DATE_RE.search(body)
    sms_at = " ".join(
        x for x in [
            time_m.group(1).strip() if time_m else None,
            date_m.group(1).strip() if date_m else None,
        ] if x
    ) or None

    has_evidence = balance is not None or ref_no is not None
    if direction != "info":
        kind = direction
    elif has_evidence:
        kind = "info"
    else:
        kind = "promo"

    # رسالة تعريفية عن شكل SMS دون عملية فعلية
    if "حدّثت بيانات" in lower or "حدثت بيانات" in lower or "تفاصيل التحويل" in lower and amount and amount <= 5:
        kind = "promo"

    conf = 0
    if amount is not None:
        conf += 45
    if kind == "incoming":
        conf += 20
    elif kind == "debit":
        conf += 5
    if from_phone or wallet:
        conf += 20
    if ref_no:
        conf += 15
    if kind == "promo":
        conf = 0
    conf = min(conf, 100)

    return {
        "provider": provider_for(sender, body),
        "kind": kind,
        "amount": amount,
        "fromPhone": from_phone,
        "fromName": from_name,
        "walletOrAccount": wallet,
        "balance": balance,
        "smsAt": sms_at,
        "refNo": ref_no,
        "confidence": conf,
    }
