"""
Standalone EXE entrypoint for Mat3am POS backend.
Build target: single-file EXE via PyInstaller.

يجب تعيين MAT3AM_BASE_DIR قبل استيراد api_server — وإلا يُستخدم مجلد مؤقت (_MEIPASS)
ويُفقد ملف config/settings.json عند كل تشغيل.
"""
from __future__ import annotations

import ctypes
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path


def _persistent_data_root() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", "") or ".") / "Mat3amPOS"
    else:
        base = Path.home() / ".Mat3amPOS"
    base.mkdir(parents=True, exist_ok=True)
    return base.resolve()


def _seed_persistent_config_from_bundle(persist_root: Path, meipass: str) -> None:
    """أول تشغيل: نسخ config من الحزمة إلى مجلد دائم إن لم يوجد إعداد اتصال."""
    bundled = Path(meipass) / "config"
    target = persist_root / "config"
    settings = target / "settings.json"
    if settings.is_file():
        return
    if not bundled.is_dir():
        return
    target.mkdir(parents=True, exist_ok=True)
    for root, _dirs, files in os.walk(bundled):
        rel = Path(root).relative_to(bundled)
        dest_dir = target / rel
        dest_dir.mkdir(parents=True, exist_ok=True)
        for name in files:
            src_f = Path(root) / name
            dst_f = dest_dir / name
            if not dst_f.exists():
                try:
                    shutil.copy2(src_f, dst_f)
                except Exception:
                    pass


def _configure_frozen_base_dir() -> None:
    if not getattr(sys, "frozen", False):
        return
    if (os.environ.get("MAT3AM_BASE_DIR") or "").strip():
        return
    persist = _persistent_data_root()
    os.environ["MAT3AM_BASE_DIR"] = str(persist)
    meipass = getattr(sys, "_MEIPASS", None)
    if isinstance(meipass, str) and meipass:
        _seed_persistent_config_from_bundle(persist, meipass)


_configure_frozen_base_dir()

import pyodbc  # noqa: E402
import uvicorn  # noqa: E402

from api_server import app, XTRA_API_PORT  # noqa: E402


ODBC_DRIVER_CANDIDATES = (
    "ODBC Driver 18 for SQL Server",
    "ODBC Driver 17 for SQL Server",
    "ODBC Driver 13 for SQL Server",
)
ODBC18_URL = "https://aka.ms/downloadmsodbcsql18"


def _is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _show_info(msg: str, title: str = "Mat3am POS") -> None:
    try:
        ctypes.windll.user32.MessageBoxW(0, msg, title, 0x40)
    except Exception:
        print(msg)


def _has_supported_odbc_driver() -> bool:
    try:
        installed = {str(d).strip() for d in pyodbc.drivers()}
    except Exception:
        installed = set()
    return any(x in installed for x in ODBC_DRIVER_CANDIDATES)


def _download_odbc_installer(dst_path: Path) -> None:
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(ODBC18_URL, str(dst_path))


def _run_silent_odbc_installer(installer_path: Path) -> None:
    subprocess.run(
        [
            str(installer_path),
            "/quiet",
            "/norestart",
            "IACCEPTMSODBCSQLLICENSETERMS=YES",
        ],
        check=True,
    )


def _ensure_prerequisites() -> None:
    if _has_supported_odbc_driver():
        return

    _show_info(
        "SQL ODBC Driver is missing.\n"
        "Mat3am POS will install Microsoft ODBC Driver automatically now."
    )

    if not _is_admin():
        _show_info(
            "Administrator permission is required to auto-install ODBC.\n"
            "Mat3am POS will continue to run now. If database connection fails,\n"
            "please run as Administrator once to install ODBC automatically."
        )
        return

    tmp = Path(os.environ.get("TEMP", ".")) / "mat3am_prereqs"
    installer = tmp / "msodbcsql18.exe"
    try:
        _download_odbc_installer(installer)
        _run_silent_odbc_installer(installer)
    except Exception as e:
        _show_info(
            "Automatic ODBC installation failed.\n"
            "Mat3am POS will continue to run now.\n"
            "If database connection fails, install Microsoft ODBC Driver 18 manually, then rerun.\n\n"
            f"Error: {e}"
        )
        return

    if not _has_supported_odbc_driver():
        _show_info(
            "ODBC installation finished but driver is still not detected.\n"
            "Mat3am POS will continue to run now.\n"
            "Install Microsoft ODBC Driver manually if database connection fails."
        )
        return


def _open_browser_later() -> None:
    time.sleep(1.2)
    try:
        webbrowser.open(f"http://127.0.0.1:{XTRA_API_PORT}/static/restaurant/")
    except Exception:
        pass


def _print_exe_build_stamp() -> None:
    if not getattr(sys, "frozen", False):
        return
    me = getattr(sys, "_MEIPASS", None)
    if not isinstance(me, str) or not me:
        return
    p = Path(me) / "config" / "mat3am_exe_build.txt"
    try:
        if p.is_file():
            s = (p.read_text(encoding="utf-8") or "").strip().split("\n")[0][:300]
            print(f"[mat3am] EXE_BUILD={s}", flush=True)
    except Exception:
        pass


def main() -> None:
    os.environ.setdefault("MAT3AM_API", "1")
    _print_exe_build_stamp()
    _ensure_prerequisites()
    t = threading.Thread(target=_open_browser_later, daemon=True)
    t.start()
    uvicorn.run(app, host="0.0.0.0", port=XTRA_API_PORT)


if __name__ == "__main__":
    main()
