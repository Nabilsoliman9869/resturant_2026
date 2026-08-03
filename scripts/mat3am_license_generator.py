#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
مولّد أرقام رخصة Mat3amPOS (داخلي لسير كونسلت).

أمثلة:
  python scripts/mat3am_license_generator.py
  python scripts/mat3am_license_generator.py --count 3 --plan trial --customer "مطعم تجريبي"
  python scripts/mat3am_license_generator.py --count 1 --plan year --customer "مطعم النخيل"
  python scripts/mat3am_license_generator.py --count 1 --plan custom --months 9 --customer "عرض خاص"
"""
from __future__ import annotations

import argparse
import json
import re
import secrets
import sys
import time
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from mat3am_license import (  # noqa: E402
    generate_license_key,
    normalize_license_key,
    parse_license_key_meta,
    plan_choices_for_ui,
    resolve_license_secret,
    resolve_plan,
)

LEDGER = ROOT / "config" / "license_ledger.json"
SECRET_FILE = ROOT / "config" / "mat3am_license_secret.txt"
OUT_DIR = ROOT / "dist_for_liLicense"


def _safe_name(text: str) -> str:
    s = re.sub(r'[\\/:*?"<>|\s]+', "_", (text or "").strip())
    s = re.sub(r"_+", "_", s).strip("._")
    return s[:60] if s else "customer"


def export_license_files(rows: list[dict]) -> list[Path]:
    """يحفظ ناتج الرخصة في dist_for_liLicense لسهولة التسليم."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    stamp = time.strftime("%Y%m%d_%H%M%S")
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = str(row.get("key") or "").strip()
        if not key:
            continue
        customer = str(row.get("customer") or "customer").strip() or "customer"
        serial = row.get("serial")
        plan_label = str(row.get("planLabel") or "")
        months = row.get("months")
        fname = f"license_{_safe_name(customer)}_S{serial}_{stamp}.txt"
        path = OUT_DIR / fname
        body = "\n".join(
            [
                "Mat3amPOS — رقم رخصة",
                "شركة: سير كونسلت لتكنولوجيا المعلومات والاستشارات المالية ش.م.م",
                f"العميل: {customer}",
                f"الرقم التسلسلي: {serial}",
                f"نوع الصلاحية: {plan_label}",
                f"الأشهر: {months}",
                f"تاريخ الإصدار: {row.get('createdAt') or time.strftime('%Y-%m-%dT%H:%M:%S')}",
                "",
                "رقم الرخصة:",
                key,
                "",
                "تعليمات للعميل:",
                "1) شغّل Mat3amPOS.exe",
                "2) الصق رقم الرخصة في شاشة التفعيل",
                "3) يلزم إنترنت في أول تفعيل فقط",
                "4) الرقم لجهاز واحد ولا يُعاد استخدامه",
                "",
            ]
        )
        path.write_text(body, encoding="utf-8")
        written.append(path)
    if rows:
        batch_path = OUT_DIR / f"licenses_batch_{stamp}.txt"
        lines = [f"# دفعة رخص {stamp}", ""]
        for row in rows:
            lines.append(
                f"{row.get('key')}\t{row.get('planLabel')}\t#{row.get('serial')}\t{row.get('customer') or '-'}"
            )
        batch_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        written.append(batch_path)
    return written


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
    return secret


def generate_batch(
    count: int,
    batch: str,
    customer: str,
    note: str,
    plan: str = "year",
    months: Optional[int] = None,
) -> list[dict]:
    secret = ensure_secret_file()
    plan_id, plan_months, plan_label = resolve_plan(plan, months)
    ledger = _load_ledger()
    serial = int(ledger.get("nextSerial") or 1)
    keys = ledger.get("keys") if isinstance(ledger.get("keys"), list) else []
    created = []
    for _ in range(max(1, count)):
        key = generate_license_key(
            serial=serial,
            secret=secret,
            batch=batch,
            plan=plan_id,
            months=plan_months if plan_id == "custom" else None,
        )
        ok, norm, meta = parse_license_key_meta(key, secret=secret)
        if not ok:
            raise RuntimeError(f"فشل توليد مفتاح: {norm}")
        row = {
            "serial": serial,
            "batch": batch,
            "key": norm,
            "customer": customer,
            "note": note,
            "planId": meta.get("planId") or plan_id,
            "months": meta.get("months") if meta.get("months") is not None else plan_months,
            "planLabel": meta.get("labelAr") or plan_label,
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
    try:
        export_license_files(created)
    except Exception as ex:
        print(f"[license-export] تحذير: تعذر الحفظ في dist_for_liLicense: {ex}", file=sys.stderr)
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
    from tkinter import messagebox, scrolledtext, ttk

    ensure_secret_file()
    root = tk.Tk()
    root.title("مولّد رخص Mat3amPOS — سير كونسلت")
    root.geometry("720x580")
    root.configure(bg="#111827")

    frm = tk.Frame(root, bg="#111827", padx=16, pady=14)
    frm.pack(fill="both", expand=True)

    tk.Label(
        frm,
        text="توليد رقم رخصة لمرة واحدة + تحديد مدة الصلاحية",
        bg="#111827",
        fg="#f9fafb",
        font=("Segoe UI", 14, "bold"),
    ).pack(anchor="e")
    tk.Label(
        frm,
        text="تجريبي شهر · ربع سنوي · نصف سنوي · سنوي · سنتان · دائم · أو أشهر مخصصة",
        bg="#111827",
        fg="#9ca3af",
        font=("Segoe UI", 9),
    ).pack(anchor="e", pady=(4, 12))

    customer_var = tk.StringVar()
    batch_var = tk.StringVar(value="A")
    count_var = tk.StringVar(value="1")
    note_var = tk.StringVar()
    months_var = tk.StringVar(value="9")
    plan_labels = plan_choices_for_ui()
    plan_map = {label: pid for pid, label in plan_labels}
    plan_var = tk.StringVar(value=plan_labels[3][1])  # سنوي افتراضي

    def row(label: str, var: tk.StringVar) -> None:
        box = tk.Frame(frm, bg="#111827")
        box.pack(fill="x", pady=3)
        tk.Label(box, text=label, width=18, anchor="e", bg="#111827", fg="#e5e7eb").pack(side="right")
        tk.Entry(box, textvariable=var, justify="right", bg="#1f2937", fg="#f9fafb", insertbackground="#fff").pack(
            side="right", fill="x", expand=True, padx=(0, 8)
        )

    row("العميل / المطعم", customer_var)

    plan_box = tk.Frame(frm, bg="#111827")
    plan_box.pack(fill="x", pady=3)
    tk.Label(plan_box, text="نوع الصلاحية", width=18, anchor="e", bg="#111827", fg="#e5e7eb").pack(side="right")
    ttk.Combobox(
        plan_box,
        textvariable=plan_var,
        values=[lbl for _pid, lbl in plan_labels],
        state="readonly",
        justify="right",
    ).pack(side="right", fill="x", expand=True, padx=(0, 8))

    row("أشهر (للمخصص فقط)", months_var)
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
        plan_id = plan_map.get(plan_var.get(), "year")
        custom_months = None
        if plan_id == "custom":
            try:
                custom_months = max(1, min(120, int(months_var.get().strip() or "1")))
            except ValueError:
                messagebox.showerror("خطأ", "عدد الأشهر غير صالح")
                return
        rows = generate_batch(
            n,
            (batch_var.get() or "A")[:1],
            customer_var.get().strip(),
            note_var.get().strip(),
            plan=plan_id,
            months=custom_months,
        )
        out.insert("end", f"\n--- {time.strftime('%Y-%m-%d %H:%M')} — {len(rows)} مفتاح ---\n")
        for r in rows:
            out.insert(
                "end",
                f"{r['key']}  |  {r.get('planLabel')}  |  #{r['serial']}  |  {r.get('customer') or '-'}\n",
            )
        out.see("end")
        exported = list(OUT_DIR.glob(f"license_{_safe_name(customer_var.get())}_*"))
        msg = f"تم توليد {len(rows)} رقم\nالنوع: {rows[0].get('planLabel')}\n\nتم الحفظ أيضاً في:\ndist_for_liLicense"
        messagebox.showinfo("تم", msg)
        try:
            import os

            os.startfile(str(OUT_DIR))
        except Exception:
            pass

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
    parser.add_argument(
        "--plan",
        default="year",
        help="trial|quarter|half|year|years2|perpetual|custom",
    )
    parser.add_argument("--months", type=int, default=None, help="للخطة custom فقط")
    parser.add_argument("--gui", action="store_true", help="فتح الواجهة الرسومية")
    args = parser.parse_args()

    if args.count > 0 and not args.gui:
        rows = generate_batch(
            args.count,
            args.batch,
            args.customer,
            args.note,
            plan=args.plan,
            months=args.months,
        )
        for r in rows:
            print(f"{r['key']}\t{r.get('planLabel')}")
        print(f"# saved {len(rows)} keys → {LEDGER}", file=sys.stderr)
        return 0

    run_gui()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
