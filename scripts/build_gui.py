"""
Mat3amPOS Build GUI
===================
أداة رسومية لبناء إصدار Mat3amPOS.exe بأي رقم.
طريقة الاستخدام:
    python scripts/build_gui.py
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from tkinter import Button, Entry, Frame, Label, StringVar, Text, Tk
from tkinter import messagebox, scrolledtext


BUILD_STEPS = [
    ("طابع البناء + ICO + خصائص ويندوز", "prepare"),
    ("npm run build — واجهة ui/restaurant", "npm_build"),
    ("PyInstaller — تجميع الباك إند", "pyinstaller"),
    ("نسخة مرقمة", "version"),
]


class BuildGUI:
    def __init__(self, root: Tk):
        self.root = root
        self.root.title("Mat3amPOS — Build Tool")
        self.root.geometry("640x520")
        self.root.configure(bg="#0f172a")

        # discover project root
        self.script_dir = Path(__file__).resolve().parent
        self.project_root = self.script_dir.parent

        # heading
        Label(
            root,
            text="Mat3amPOS Build Tool",
            bg="#0f172a",
            fg="#f8fafc",
            font=("Segoe UI", 18, "bold"),
        ).pack(pady=(16, 4))

        Label(
            root,
            text="أدخل رقم الإصدار ثم اضغط Build",
            bg="#0f172a",
            fg="#94a3b8",
            font=("Segoe UI", 11),
        ).pack(pady=(0, 12))

        # version input row
        input_frame = Frame(root, bg="#0f172a")
        input_frame.pack(pady=4)

        Label(input_frame, text="رقم الإصدار:", bg="#0f172a", fg="#e2e8f0", font=("Segoe UI", 12)).pack(side="left", padx=4)

        self.version_var = StringVar(value=self._suggest_version())
        self.version_entry = Entry(input_frame, textvariable=self.version_var, width=8, font=("Segoe UI", 14), justify="center")
        self.version_entry.pack(side="left", padx=4)

        Button(input_frame, text="تشغيل البناء", command=self._on_build, bg="#2563eb", fg="white", font=("Segoe UI", 12, "bold"), padx=16, pady=4, cursor="hand2", relief="flat").pack(side="left", padx=12)

        # log area
        Label(root, text="سجل البناء:", bg="#0f172a", fg="#94a3b8", font=("Segoe UI", 10), anchor="w").pack(fill="x", padx=20, pady=(12, 2))

        self.log = scrolledtext.ScrolledText(root, wrap="word", state="disabled", height=16, bg="#020617", fg="#e2e8f0", font=("Consolas", 10), insertbackground="white")
        self.log.pack(fill="both", expand=True, padx=20, pady=(0, 16))

        # status bar
        self.status_var = StringVar(value="جاهز")
        Label(root, textvariable=self.status_var, bg="#1e293b", fg="#94a3b8", font=("Segoe UI", 10), anchor="w", padx=12, pady=4).pack(fill="x", side="bottom")

    def _suggest_version(self) -> str:
        dist = self.project_root / "dist"
        pattern = re.compile(r"^Mat3amPOS(\d{3})\.exe$", re.IGNORECASE)
        max_num = 0
        if dist.exists():
            for p in dist.glob("Mat3amPOS*.exe"):
                m = pattern.match(p.name)
                if m:
                    try:
                        max_num = max(max_num, int(m.group(1)))
                    except ValueError:
                        continue
        return str(max_num + 1)

    def _log(self, text: str, tag: str = ""):
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _set_status(self, text: str):
        self.status_var.set(text)
        self.root.update_idletasks()

    def _on_build(self):
        raw = self.version_var.get().strip()
        if not raw.isdigit():
            messagebox.showerror("خطأ", "رقم الإصدار يجب أن يكون أرقاماً فقط (مثلاً: 30)")
            return
        version = int(raw)
        if version < 1 or version > 999:
            messagebox.showerror("خطأ", "رقم الإصدار يجب أن يكون بين 1 و 999")
            return

        # disable button while building
        for w in self.root.winfo_children():
            if isinstance(w, Frame):
                for c in w.winfo_children():
                    if isinstance(c, Button):
                        c.configure(state="disabled")

        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")
        self._log("=" * 50)
        self._log(f"بدء بناء Mat3amPOS — الإصدار {version:03d}")
        self._log("=" * 50)

        thread = threading.Thread(target=self._run_build, args=(version,), daemon=True)
        thread.start()

    def _run_build(self, version: int):
        try:
            self._step_prepare()
            self._step_npm_build()
            self._step_pyinstaller()
            self._step_version(version)
            self._set_status(f"تم بناء الإصدار {version:03d} بنجاح!")
            self.root.after(0, lambda: messagebox.showinfo("تم", f"تم إنشاء dist\Mat3amPOS{version:03d}.exe بنجاح!"))
        except Exception as e:
            self._log(f"\n[ERROR] {e}")
            self._set_status(f"فشل البناء: {e}")
            self.root.after(0, lambda: messagebox.showerror("فشل البناء", str(e)))
        finally:
            self.root.after(0, self._reenable_button)

    def _reenable_button(self):
        for w in self.root.winfo_children():
            if isinstance(w, Frame):
                for c in w.winfo_children():
                    if isinstance(c, Button):
                        c.configure(state="normal")

    def _run_cmd(self, cmd: list[str], cwd: Path | None = None, step_name: str = "") -> None:
        self._log(f"\n>> {step_name}")
        self._log(f"   command: {' '.join(cmd)}")
        self._set_status(f"جاري: {step_name} ...")

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=str(cwd) if cwd else str(self.project_root),
            encoding="utf-8",
            errors="replace",
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            self._log(line.rstrip())
        proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(f"فشل في الخطوة: {step_name} (exit {proc.returncode})")
        self._log(f"   [OK] {step_name}")

    def _step_prepare(self):
        script = self.project_root / "scripts" / "prepare_mat3am_exe_build.py"
        if not script.exists():
            raise FileNotFoundError(f"Script not found: {script}")
        self._run_cmd([sys.executable, str(script)], step_name="Prepare build stamp + ICO")

    def _step_npm_build(self):
        npm = shutil.which("npm")
        if not npm:
            raise RuntimeError("npm not found in PATH")
        self._run_cmd([npm, "run", "build"], step_name="npm run build")

    def _step_pyinstaller(self):
        spec = self.project_root / "Mat3amPOS.spec"
        if not spec.exists():
            raise FileNotFoundError(f"Spec not found: {spec}")
        self._run_cmd([sys.executable, "-m", "PyInstaller", str(spec), "--clean", "--noconfirm"], step_name="PyInstaller")

    def _step_version(self, version: int):
        script = self.project_root / "scripts" / "version_exe_artifact.py"
        if not script.exists():
            raise FileNotFoundError(f"Script not found: {script}")
        self._run_cmd([sys.executable, str(script), str(version)], step_name="Version artifact")


def main() -> int:
    root = Tk()
    app = BuildGUI(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
