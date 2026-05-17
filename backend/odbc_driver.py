"""اختيار Microsoft ODBC المناسب (18 ثم 17 ثم 13) وبناء سلسلة الاتصال."""
from __future__ import annotations

import pyodbc

ODBC_DRIVER_CANDIDATES = (
    "ODBC Driver 18 for SQL Server",
    "ODBC Driver 17 for SQL Server",
    "ODBC Driver 13 for SQL Server",
)


def installed_odbc_drivers() -> set[str]:
    try:
        return {str(d).strip() for d in pyodbc.drivers()}
    except Exception:
        return set()


def pick_odbc_driver_name() -> str:
    installed = installed_odbc_drivers()
    for name in ODBC_DRIVER_CANDIDATES:
        if name in installed:
            return name
    raise RuntimeError(
        "لم يُعثر على Microsoft ODBC Driver — ثبّت msodbcsql18 (Driver 18) على الخادم."
    )


def sql_server_host(server: str, port: int | None) -> str:
    s = (server or "").strip()
    if not s:
        return s
    if port is not None:
        return f"{s},{port}"
    return s


def _driver_tls_extras(driver: str) -> str:
    """Driver 18 + OpenSSL 3 على Linux يرفض خوارزميات TLS القديمة على SQL Server القديم."""
    if "18" in driver:
        # Encrypt=no يتجنب: SSL Provider legacy sigalg disallowed
        return ";Encrypt=no;TrustServerCertificate=yes"
    if "17" in driver:
        return ";Encrypt=no"
    return ""


def odbc_connection_string(
    server: str,
    port: int | None,
    database: str,
    uid: str,
    pwd: str,
) -> str:
    driver = pick_odbc_driver_name()
    host = sql_server_host(server, port)
    extras = _driver_tls_extras(driver)
    return (
        f"DRIVER={{{driver}}};SERVER={host};DATABASE={database};UID={uid};PWD={pwd}{extras}"
    )
