"""
Standalone EXE entrypoint for Mat3am POS backend.
Build target: single-file EXE via PyInstaller.
"""
from __future__ import annotations

import ctypes
import os
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

import pyodbc
import uvicorn

from api_server import app, XTRA_API_PORT


ODBC_DRIVER_CANDIDATES = (
    "ODBC Driver 18 for SQL Server",
    "ODBC Driver 17 for SQL Server",
    "ODBC Driver 13 for SQL Server",
)
# Microsoft official short-link (current ODBC 18 x64 package).
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


def _show_error(msg: str, title: str = "Mat3am POS") -> None:
    try:
        ctypes.windll.user32.MessageBoxW(0, msg, title, 0x10)
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
    # Most recent package from aka.ms is an EXE bootstrapper.
    # Keep arguments compatible with Microsoft setup silent mode.
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
    # Open the POS UI shortly after the API starts.
    time.sleep(1.2)
    try:
        webbrowser.open(f"http://127.0.0.1:{XTRA_API_PORT}/static/restaurant/")
    except Exception:
        pass


def main() -> None:
    os.environ.setdefault("MAT3AM_API", "1")
    _ensure_prerequisites()
    t = threading.Thread(target=_open_browser_later, daemon=True)
    t.start()
    uvicorn.run(app, host="0.0.0.0", port=XTRA_API_PORT)


if __name__ == "__main__":
    main()
