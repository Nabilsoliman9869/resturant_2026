"""
بوابة إقلاع EXE: شاشة حقوق الشركة + الهواتف + إدخال رخصة لمرة واحدة.
"""
from __future__ import annotations

import os
import sys
import time
from typing import Optional

from mat3am_license import (
    activate_license,
    is_license_valid_locally,
    load_branding,
    normalize_license_key,
    read_local_license,
)


def _year() -> int:
    return int(time.strftime("%Y"))


def _license_expiry_line() -> str:
    data = read_local_license() or {}
    label = str(data.get("planLabel") or "").strip()
    expires = str(data.get("expiresAt") or "").strip()
    if expires:
        return f"صلاحية النسخة: {label or 'مرخّصة'} — حتى {expires[:10]}"
    if label:
        return f"صلاحية النسخة: {label}"
    return ""


def show_license_gate(*, force: bool = False) -> bool:
    """
    يعرض شاشة التفعيل إن لزم.
    يعيد True إذا مسموح بمتابعة تشغيل التطبيق.
    """
    if (os.environ.get("MAT3AM_SKIP_LICENSE") or "").strip() in ("1", "true", "yes"):
        return True
    if not force and not getattr(sys, "frozen", False):
        if (os.environ.get("MAT3AM_REQUIRE_LICENSE") or "").strip() not in ("1", "true", "yes"):
            return True

    ok, _msg = is_license_valid_locally()
    brand = load_branding()
    if ok:
        # شاشة حقوق قصيرة حتى مع رخصة صالحة
        return _show_splash_only(brand)

    return _show_activation_dialog(brand)


def _format_copyright(brand: dict) -> str:
    company = str(brand.get("companyNameAr") or brand.get("companyNameEn") or "الشركة")
    line = str(brand.get("copyrightLine") or "جميع الحقوق محفوظة © {year} {company}")
    return line.replace("{year}", str(_year())).replace("{company}", company)


def _phones_text(brand: dict) -> str:
    phones = brand.get("phones") if isinstance(brand.get("phones"), list) else []
    lines = [str(p).strip() for p in phones if str(p).strip()]
    wa = str(brand.get("whatsapp") or "").strip()
    if wa:
        lines.append(f"واتساب: {wa}")
    email = str(brand.get("email") or "").strip()
    if email:
        lines.append(f"بريد: {email}")
    return "\n".join(lines) if lines else "—"


def _show_splash_only(brand: dict) -> bool:
    try:
        import tkinter as tk
    except Exception:
        return True
    root = tk.Tk()
    root.title(str(brand.get("productName") or "Mat3amPOS"))
    root.resizable(False, False)
    root.attributes("-topmost", True)
    _build_header(root, brand, show_form=False)
    secs = max(1, min(8, int(brand.get("splashSeconds") or 2)))
    root.after(secs * 1000, root.destroy)
    _center(root, 520, 320)
    root.mainloop()
    return True


def _show_activation_dialog(brand: dict) -> bool:
    try:
        import tkinter as tk
        from tkinter import messagebox
    except Exception:
        # بدون tkinter — رسالة كونسول
        print("=== ترخيص Mat3amPOS مطلوب ===")
        print(_format_copyright(brand))
        print(_phones_text(brand))
        key = input("أدخل رقم الرخصة: ").strip()
        ok, msg = activate_license(key)
        print(msg)
        return ok

    result = {"ok": False}

    root = tk.Tk()
    root.title(f"{brand.get('productName') or 'Mat3amPOS'} — تفعيل الرخصة")
    root.resizable(False, False)
    root.attributes("-topmost", True)

    frm = _build_header(root, brand, show_form=True)

    key_var = tk.StringVar()
    status_var = tk.StringVar(value="أدخل رقم الرخصة الصادر من الشركة (يُستخدم لمرة واحدة).")

    tk.Label(frm, text="رقم الرخصة", anchor="e", bg="#0f172a", fg="#e2e8f0", font=("Segoe UI", 10)).pack(
        fill="x", pady=(8, 2)
    )
    entry = tk.Entry(
        frm,
        textvariable=key_var,
        justify="center",
        font=("Consolas", 14),
        bg="#1e293b",
        fg="#f8fafc",
        insertbackground="#f8fafc",
        relief="flat",
    )
    entry.pack(fill="x", ipady=8)
    entry.focus_set()

    status = tk.Label(
        frm,
        textvariable=status_var,
        anchor="e",
        justify="right",
        bg="#0f172a",
        fg="#94a3b8",
        font=("Segoe UI", 9),
        wraplength=460,
    )
    status.pack(fill="x", pady=(10, 4))

    btns = tk.Frame(frm, bg="#0f172a")
    btns.pack(fill="x", pady=(12, 0))

    def do_activate() -> None:
        raw = key_var.get().strip()
        if not normalize_license_key(raw):
            status_var.set("صيغة غير مكتملة — مثال: M3AM-XXXX-XXXX-XXXX-XXXX")
            return
        status_var.set("جاري التحقق والتفعيل…")
        root.update_idletasks()
        ok, msg = activate_license(raw)
        if ok:
            result["ok"] = True
            messagebox.showinfo("تم التفعيل", msg, parent=root)
            root.destroy()
        else:
            status_var.set(msg)
            messagebox.showerror("فشل التفعيل", msg, parent=root)

    def do_exit() -> None:
        result["ok"] = False
        root.destroy()

    act = tk.Button(
        btns,
        text="تفعيل وتشغيل",
        command=do_activate,
        bg="#059669",
        fg="white",
        activebackground="#047857",
        font=("Segoe UI", 11, "bold"),
        relief="flat",
        padx=16,
        pady=8,
    )
    act.pack(side="right", padx=(8, 0))
    tk.Button(
        btns,
        text="خروج",
        command=do_exit,
        bg="#334155",
        fg="white",
        activebackground="#1e293b",
        font=("Segoe UI", 10),
        relief="flat",
        padx=14,
        pady=8,
    ).pack(side="right")

    root.bind("<Return>", lambda _e: do_activate())
    root.protocol("WM_DELETE_WINDOW", do_exit)
    _center(root, 540, 480)
    root.mainloop()
    return bool(result["ok"])


def _build_header(root, brand: dict, *, show_form: bool):
    import tkinter as tk

    root.configure(bg="#0f172a")
    wrap = tk.Frame(root, bg="#0f172a", padx=22, pady=18)
    wrap.pack(fill="both", expand=True)

    product = str(brand.get("productName") or "Mat3amPOS")
    company = str(brand.get("companyNameAr") or "")
    company_en = str(brand.get("companyNameEn") or "")

    tk.Label(wrap, text=product, bg="#0f172a", fg="#f8fafc", font=("Segoe UI", 18, "bold")).pack(anchor="e")
    if company:
        tk.Label(wrap, text=company, bg="#0f172a", fg="#38bdf8", font=("Segoe UI", 12, "bold")).pack(
            anchor="e", pady=(6, 0)
        )
    if company_en:
        tk.Label(wrap, text=company_en, bg="#0f172a", fg="#64748b", font=("Segoe UI", 9)).pack(anchor="e")

    tk.Label(
        wrap,
        text=_format_copyright(brand),
        bg="#0f172a",
        fg="#cbd5e1",
        font=("Segoe UI", 10),
        wraplength=480,
        justify="right",
        anchor="e",
    ).pack(fill="x", pady=(14, 8))

    phone_box = tk.Frame(wrap, bg="#1e293b", padx=12, pady=10)
    phone_box.pack(fill="x", pady=(4, 8))
    tk.Label(
        phone_box,
        text="للتفعيل والدعم الفني",
        bg="#1e293b",
        fg="#94a3b8",
        font=("Segoe UI", 9),
        anchor="e",
    ).pack(fill="x")
    tk.Label(
        phone_box,
        text=_phones_text(brand),
        bg="#1e293b",
        fg="#fbbf24",
        font=("Segoe UI", 12, "bold"),
        justify="right",
        anchor="e",
    ).pack(fill="x", pady=(4, 0))

    if not show_form:
        exp = _license_expiry_line()
        if exp:
            tk.Label(
                wrap,
                text=exp,
                bg="#0f172a",
                fg="#34d399",
                font=("Segoe UI", 10, "bold"),
                wraplength=480,
                justify="right",
                anchor="e",
            ).pack(fill="x", pady=(8, 0))
        tk.Label(
            wrap,
            text="جاري التشغيل…",
            bg="#0f172a",
            fg="#64748b",
            font=("Segoe UI", 9),
        ).pack(anchor="e", pady=(12, 0))
    return wrap


def _center(root, w: int, h: int) -> None:
    root.update_idletasks()
    sw = root.winfo_screenwidth()
    sh = root.winfo_screenheight()
    x = max(0, (sw - w) // 2)
    y = max(0, (sh - h) // 3)
    root.geometry(f"{w}x{h}+{x}+{y}")


def ensure_licensed_or_exit() -> None:
    allowed = show_license_gate()
    if not allowed:
        try:
            import ctypes

            ctypes.windll.user32.MessageBoxW(
                0,
                "لا يمكن تشغيل البرنامج بدون رخصة صالحة أو بعد انتهاء المدة.\nتواصل مع سير كونسلت للتفعيل أو التجديد.",
                "Mat3amPOS — مطلوب ترخيص",
                0x10,
            )
        except Exception:
            print("License required. Exiting.", flush=True)
        sys.exit(2)
