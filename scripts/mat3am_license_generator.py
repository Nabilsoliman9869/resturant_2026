#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
مولّد أرقام رخصة Mat3amPOS (للاستخدام الداخلي للشركة فقط).

تشغيل:
  python scripts/mat3am_license_generator.py
  python scripts/mat3am_license_generator.py --count 10 --batch A --customer "مطعم النخيل"

السجل: config/license_ledger.json (محلي — لا يُرفع)
السر:  config/mat3am_license_secret.txt (إن وُجد) وإلا السر الافتراضي للتطوير
"""
from __future__ import annotations

import argparse
import json
import secrets
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from mat3am_license import (  # noqa: E402
    generate_license_key,
    normalize_license_key,
    resolve_license_secret,
    verify_license_key_format,
)

LEDGER = ROOT / "config" / "license_ledger.json"
SECRET_FILE = ROOT / "config" / "mat3am_license_secret.txt"


def _load_ledger() -> dict:
    if LEDGER.is_file():
        try:
            data = json.loads(LEDGER.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    return {"nextSerial": 1, "keys": []}


def _save_ledger(data: dict) -> None:
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def ensure_secret_file() -> str:
    if SECRET_FILE.is_file():
        return resolve_license_secret()
    secret = secrets.token_hex(32)
    SECRET_FILE.write_text(secret + "\n", encoding="utf-8")
    print(f"[مهم] تم إنشاء سر جديد: {SECRET_FILE}")
    print("انسخ نفس الملف بجانب EXE عند الشحن، أو أعد بناء EXE بعد وضعه في config/")
    return secret


def generate_batch(count: int, batch: str, customer: str, note: str) -> list[dict]:
    secret = ensure_secret_file()
    ledger = _load_ledger()
    serial = int(ledger.get("nextSerial") or 1)
    keys = ledger.get("keys") if isinstance(ledger.get("keys"), list) else []
    created = []
    for _ in range(max(1, count)):
        key = generate_license_key(serial=serial, secret=secret, batch=batch)
        ok, norm = verify_license_key_format(key, secret=secret)
        if not ok:
            raise RuntimeError(f"فشل توليد مفتاح: {norm}")
        row = {
            "serial": serial,
            "batch": batch,
            "key": norm,
            "customer": customer,
            "note": note,
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "status": "issued",
            "burnedAt": None,
            "burnedMachineId": None,
        }
        keys.append(row)
        created.append(row)
        serial += 1
    ledger["nextSerial"] = serial
    ledger["keys"] = keys
    _save_ledger(ledger)
    return created


def mark_burned(key: str, machine_id: str = "") -> bool:
    ledger = _load_ledger()
    keys = ledger.get("keys") if isinstance(ledger.get("keys"), list) else []
    norm = normalize_license_key(key)
    for row in keys:
        if not isinstance(row, dict):
            continue
        if normalize_license_key(str(row.get("key") or "")) == norm:
            row["status"] = "burned"
            row["burnedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            if machine_id:
                row["burnedMachineId"] = machine_id
            _save_ledger(ledger)
            return True
    return False


def run_gui() -> None:
    import tkinter as tk
    from tkinter import messagebox, scrolledtext

    ensure_secret_file()
    root = tk.Tk()
    root.title("مولّد رخص Mat3amPOS — داخلي للشركة")
    root.geometry("640x520")
    root.configure(bg="#111827")

    frm = tk.Frame(root, bg="#111827", padx=16, pady=14)
    frm.pack(fill="both", expand=True)

    tk.Label(frm, text="مولّد أرقام رخصة لمرة واحدة", bg="#111827", fg="#f9fafb", font=("Segoe UI", 14, "bold")).pack(
        anchor="e"
    )
    tk.Label(
        frm,
        text="كل رقم يُستخدم لتفعيل جهاز واحد. احتفظ بالسجل والسر في مكان آمن.",
        bg="#111827",
        fg="#9ca3af",
        font=("Segoe UI", 9),
    ).pack(anchor="e", pady=(4, 12))

    customer_var = tk.StringVar()
    batch_var = tk.StringVar(value="A")
    count_var = tk.StringVar(value="1")
    note_var = tk.StringVar()

    def row(label: str, var: tk.StringVar) -> None:
        box = tk.Frame(frm, bg="#111827")
        box.pack(fill="x", pady=3)
        tk.Label(box, text=label, width=16, anchor="e", bg="#111827", fg="#e5e7eb").pack(side="right")
        tk.Entry(box, textvariable=var, justify="right", bg="#1f2937", fg="#f9fafb", insertbackground="#fff").pack(
            side="right", fill="x", expand=True, padx=(0, 8)
        )

    row("العميل / المطعم", customer_var)
    row("الدفعة (حرف)", batch_var)
    row("العدد", count_var)
    row("ملاحظة", note_var)

    out = scrolledtext.ScrolledText(frm, height=14, bg="#0b1220", fg="#86efac", font=("Consolas", 11))
    out.pack(fill="both", expand=True, pady=12)

    def do_gen() -> None:
        try:
            n = max(1, min(200, int(count_var.get().strip() or "1")))
        except ValueError:
            messagebox.showerror("خطأ", "العدد غير صالح")
            return
        rows = generate_batch(n, (batch_var.get() or "A")[:1], customer_var.get().strip(), note_var.get().strip())
        out.insert("end", f"\n--- {time.strftime('%Y-%m-%d %H:%M')} — {len(rows)} مفتاح ---\n")
        for r in rows:
            out.insert("end", f"{r['key']}   |  #{r['serial']}  |  {r.get('customer') or '-'}\n")
        out.see("end")
        messagebox.showinfo("تم", f"تم توليد {len(rows)} رقم وحفظها في license_ledger.json")

    tk.Button(
        frm,
        text="توليد وحفظ في السجل",
        command=do_gen,
        bg="#059669",
        fg="white",
        font=("Segoe UI", 11, "bold"),
        relief="flat",
        padx=12,
        pady=8,
    ).pack(anchor="e")

    root.mainloop()


def main() -> int:
    parser = argparse.ArgumentParser(description="مولّد رخص Mat3amPOS")
    parser.add_argument("--count", type=int, default=0, help="عدد المفاتيح (بدون واجهة)")
    parser.add_argument("--batch", default="A")
    parser.add_argument("--customer", default="")
    parser.add_argument("--note", default="")
    parser.add_argument("--gui", action="store_true", help="فتح الواجهة الرسومية")
    args = parser.parse_args()

    if args.count > 0 and not args.gui:
        rows = generate_batch(args.count, args.batch, args.customer, args.note)
        for r in rows:
            print(r["key"])
        print(f"# saved {len(rows)} keys → {LEDGER}", file=sys.stderr)
        return 0

    run_gui()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
