from __future__ import annotations

import ctypes
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path


APP_EXE_NAME = "Mat3amPOS.exe"
SETUP_BAT_NAME = "setup_odbc_and_install.bat"
ODBC18_URL = "https://go.microsoft.com/fwlink/?linkid=2280794"
ODBC_DRIVER_NAMES = {
    "ODBC Driver 17 for SQL Server",
    "ODBC Driver 18 for SQL Server",
}


def app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def target_app_exe() -> Path:
    return app_dir() / APP_EXE_NAME


def target_setup_bat() -> Path:
    return app_dir() / SETUP_BAT_NAME


def is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def relaunch_as_admin() -> int:
    params = " ".join(f'"{arg}"' for arg in sys.argv[1:])
    rc = ctypes.windll.shell32.ShellExecuteW(
        None,
        "runas",
        sys.executable,
        params,
        str(app_dir()),
        1,
    )
    return int(rc)


def installed_odbc_drivers() -> list[str]:
    command = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Get-OdbcDriver -Platform 64bit | Select-Object -ExpandProperty Name",
    ]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=20,
            check=False,
        )
    except Exception:
        return []
    if result.returncode != 0:
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def has_supported_odbc() -> bool:
    installed = set(installed_odbc_drivers())
    return any(name in installed for name in ODBC_DRIVER_NAMES)


def download_odbc18() -> Path:
    target = Path(tempfile.gettempdir()) / "msodbcsql18.msi"
    if target.exists():
        try:
            target.unlink()
        except OSError:
            pass
    print("[INFO] Downloading Microsoft ODBC Driver 18...")
    urllib.request.urlretrieve(ODBC18_URL, target)
    if not target.is_file():
        raise RuntimeError("ODBC package download failed.")
    return target


def install_odbc18(msi_path: Path) -> None:
    print("[INFO] Installing Microsoft ODBC Driver 18...")
    result = subprocess.run(
        [
            "msiexec",
            "/i",
            str(msi_path),
            "/qn",
            "/norestart",
            "IACCEPTMSODBCSQLLICENSETERMS=YES",
        ],
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ODBC installation failed with exit code {result.returncode}.")


def run_setup_bat() -> int:
    setup_bat = target_setup_bat()
    if not setup_bat.is_file():
        return 1
    return subprocess.call([str(setup_bat)], cwd=str(app_dir()))


def run_app() -> None:
    exe_path = target_app_exe()
    if not exe_path.is_file():
        raise FileNotFoundError(f"Application not found: {exe_path}")
    print("[INFO] Launching Mat3amPOS.exe ...")
    subprocess.Popen([str(exe_path)], cwd=str(app_dir()))


def main() -> int:
    dry_run = "--dry-run" in sys.argv[1:]
    if dry_run:
        print(f"[DRY-RUN] app_dir={app_dir()}")
        print(f"[DRY-RUN] app_exe={target_app_exe()}")
        print(f"[DRY-RUN] setup_bat={target_setup_bat()}")
        print(f"[DRY-RUN] odbc_drivers={installed_odbc_drivers()}")
        print(f"[DRY-RUN] has_supported_odbc={has_supported_odbc()}")
        return 0

    print("====================================")
    print(" Mat3amPOS Setup Launcher")
    print("====================================")

    if not target_app_exe().is_file():
        print(f"[ERROR] Missing {APP_EXE_NAME} next to the setup launcher.")
        input("Press Enter to exit...")
        return 1

    if not is_admin():
        print("[INFO] Requesting Administrator permission...")
        rc = relaunch_as_admin()
        if rc <= 32:
            print("[ERROR] Elevation request was rejected or failed.")
            input("Press Enter to exit...")
            return 1
        return 0

    try:
        if has_supported_odbc():
            print("[OK] Supported ODBC driver already installed.")
        else:
            msi_path = download_odbc18()
            try:
                install_odbc18(msi_path)
            finally:
                try:
                    msi_path.unlink(missing_ok=True)
                except Exception:
                    pass
            if not has_supported_odbc():
                raise RuntimeError("ODBC driver still not detected after installation.")
            print("[OK] ODBC driver installed successfully.")
        run_app()
        print("[OK] Mat3amPOS started.")
        return 0
    except Exception as exc:
        print(f"[WARN] Native setup flow failed: {exc}")
        print("[INFO] Falling back to setup_odbc_and_install.bat if available...")
        rc = run_setup_bat()
        if rc == 0:
            return 0
        print("[ERROR] Fallback setup script failed or was not found.")
        input("Press Enter to exit...")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
