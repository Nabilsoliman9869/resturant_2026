"""محرك استنتاج لرسائل المحافظ/البنوك — نسخة الخادم.

مطابق لمنطق SmsParser.kt في تطبيق أندرويد، ليكون الخادم قادراً على:
  - تطبيع أي حمولة قادمة من إصدار قديم من التطبيق،
  - إعادة تحليل الرسائل المخزّنة سابقاً دون الحاجة لإعادة إرسالها من الهاتف.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional

_CREDIT_WORDS = [
    "استلام", "استلمت", "استلمنا", "اضيف", "أضيف", "اضافة", "إضافة", "اضيفت",
    "دائن", "وردك", "حولت لك", "حوّل لك", "حول لك",
    "received", "credited", "deposited", "transferred from", "added to your",
]
_DEBIT_WORDS = [
    "خصم", "شحن", "سحب", "دفعت", "مدين", "تم تحويل", "تحويل مبلغ", "حولت الى", "حولت إلى",
    "debited", "withdrawn", "transferred to", "sent to", "paid to", "purchase",
]
_CURRENCY_WORDS = ["جنيه", "جنيها", "جنيهاً", "ج.م", "egp", "le", "pound", "ج"]
_BALANCE_WORDS = ["رصيد", "الرصيد", "balance", "bal"]
_AMOUNT_WORDS = ["مبلغ", "استلام", "اضافة", "إضافة", "amount", "amt"]
_REF_WORDS = [
    "العملية", "عملية", "المعامل", "معامل", "مرجع", "المرجع",
    "transaction", "trans", "ref", "reference", "txn",
]
_WALLET_WORDS = ["محفظت", "حساب", "wallet", "account"]

_NUM_RE = re.compile(r"[0-9]+(?:[.,][0-9]+)?")
# حدود الأرقام تمنع التقاط «هاتف» من داخل رقم حساب أطول.
_PHONE_RE = re.compile(r"(?<![0-9])(?:\+?20)?0?1[0125][0-9]{8}(?![0-9])")
_NAME_RE = re.compile(
    r"(?:ب[إا]سم|باسم|name[:\s])\s*([^\n0-9]{3,60}?)\s*(?:على|رقم|\.|,|\n|$)", re.IGNORECASE
)
_TIME_RE = re.compile(r"([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\s*(?:AM|PM|ص|م)?)", re.IGNORECASE)
_DATE_RE = re.compile(r"([0-9]{1,4}[-/][0-9]{1,2}[-/][0-9]{1,4})")


def _normalize_digits(text: str) -> str:
    out = []
    for ch in text:
        code = ord(ch)
        if 0x0660 <= code <= 0x0669:          # ٠-٩
            out.append(chr(ord("0") + code - 0x0660))
        elif 0x06F0 <= code <= 0x06F9:        # ۰-۹ فارسي
            out.append(chr(ord("0") + code - 0x06F0))
        elif ch == "\u066B":
            out.append(".")
        elif ch == "\u066C":
            out.append(",")
        else:
            out.append(ch)
    return "".join(out)


def _ctx(body: str, start: int, end: int, radius: int = 22) -> str:
    return body[max(0, start - radius): min(len(body), end + radius)].lower()


def _contains_any(hay: str, words) -> bool:
    low = hay.lower()
    return any(w in low for w in words)


def _to_money(raw: str) -> Optional[float]:
    try:
        return float(raw.replace(",", ""))
    except (TypeError, ValueError):
        return None


def _keyword_spans(lower_body: str, words):
    spans = []
    for w in words:
        start = 0
        while True:
            i = lower_body.find(w, start)
            if i < 0:
                break
            spans.append((i, i + len(w)))
            start = i + 1
    return spans


def _nearest_after(tokens, spans, max_dist: int = 40):
    """أقرب رقم يلي الكلمة المفتاحية. الأرقام السابقة لها تُعاقَب بشدة."""
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
    if p.startswith("20"):
        p = p[2:]
    if not p.startswith("0"):
        p = "0" + p
    return p


def provider_for(sender: str, body: str) -> str:
    s = (sender or "").lower()
    b = (body or "").lower()
    if ("vf-cash" in s or "v cash" in s or "vodafone" in s
            or "محفظت" in b or "فودافون كاش" in b or "vodafone cash" in b):
        return "vodafone_cash"
    if "adib" in s or "adib" in b or "حسابك" in b:
        return "bank_adib"
    if "orange" in s:
        return "orange_cash"
    if "etisalat" in s or "we " in s:
        return "we_pay"
    if "instapay" in s or "instapay" in b:
        return "instapay"
    return "sms_unknown"


def parse_sms(sender: str, raw_body: str) -> Dict[str, Any]:
    body = _normalize_digits(raw_body or "")
    lower = body.lower()

    credit = sum(1 for w in _CREDIT_WORDS if w in lower)
    debit = sum(1 for w in _DEBIT_WORDS if w in lower)
    if credit > 0 and credit >= debit:
        direction = "incoming"
    elif debit > 0:
        direction = "debit"
    else:
        direction = "info"

    toks = []
    for m in _NUM_RE.finditer(body):
        v = m.group()
        toks.append({
            "value": v,
            "digits": "".join(c for c in v if c.isdigit()),
            "decimal": ("." in v or "," in v),
            "ctx": _ctx(body, m.start(), m.end()),
            "start": m.start(),
            "end": m.end(),
        })

    phones = [
        {"phone": _norm_phone(m.group()), "ctx": _ctx(body, m.start(), m.end()),
         "start": m.start(), "end": m.end()}
        for m in _PHONE_RE.finditer(body)
    ]

    def is_phone_tok(t) -> bool:
        d = t["digits"]
        return 10 <= len(d) <= 12 and (
            d.startswith("01") or d.startswith("2010") or d.startswith("2011")
            or d.startswith("2012") or d.startswith("2015")
        )

    money_toks = [
        t for t in toks
        if not is_phone_tok(t) and (
            t["decimal"] or _contains_any(t["ctx"], _CURRENCY_WORDS) or len(t["digits"]) <= 6
        )
    ]
    balance_tok = _nearest_after(money_toks, _keyword_spans(lower, _BALANCE_WORDS))
    amount_candidates = [t for t in money_toks if t is not balance_tok]
    amount_tok = _nearest_after(amount_candidates, _keyword_spans(lower, _AMOUNT_WORDS))
    if amount_tok is None and amount_candidates:
        amount_tok = amount_candidates[0]

    amount = _to_money(amount_tok["value"]) if amount_tok else None
    balance = _to_money(balance_tok["value"]) if balance_tok else None

    # رقم العملية يُقبل فقط بوجود كلمة مفتاحية صريحة، حتى لا يُخلط برقم الحساب.
    ref_candidates = [
        t for t in toks
        if not t["decimal"] and not is_phone_tok(t) and len(t["digits"]) >= 9
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
             if not is_phone_tok(t) and 6 <= len(t["digits"]) <= 24
             and t is not amount_tok and t is not balance_tok and t is not ref_tok],
            wallet_spans,
        )
        wallet = wallet_tok["digits"] if wallet_tok else None

    from_phone_tok = _nearest_after(phones, _keyword_spans(lower, ["من"]), max_dist=12)
    from_phone = from_phone_tok["phone"] if from_phone_tok else None
    if from_phone is None:
        from_phone = next(
            (p["phone"] for p in phones
             if not (wallet_phone and p["start"] == wallet_phone["start"])),
            None,
        )

    name_m = _NAME_RE.search(body)
    from_name = name_m.group(1).strip() if name_m and name_m.group(1).strip() else None

    time_m = _TIME_RE.search(body)
    date_m = _DATE_RE.search(body)
    sms_at = " ".join(x for x in [time_m.group(1).strip() if time_m else None,
                                  date_m.group(1).strip() if date_m else None] if x) or None

    has_evidence = balance is not None or ref_no is not None
    if direction != "info":
        kind = direction
    elif has_evidence:
        kind = "info"
    else:
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
