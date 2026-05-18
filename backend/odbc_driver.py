"""اختيار Microsoft ODBC المناسب (17 أولاً للسيرفرات القديمة) وبناء سلسلة الاتصال."""
from __future__ import annotations

import pyodbc

# يظهر في /__whoami__ للتأكد أن Railway يشغّل آخر نشر
MAT3AM_ODBC_BUILD = "2026-05-18-odbc17-seclevel0"

# 17 قبل 18 — Driver 18 + OpenSSL 3 يرفض legacy sigalg حتى مع Encrypt=no أحياناً
ODBC_DRIVER_CANDIDATES = (
    "ODBC Driver 17 for SQL Server",
    "ODBC Driver 18 for SQL Server",
    "ODBC Driver 13 for SQL Server",
)


def installed_odbc_drivers() -> set[str]:
    try:
        return {str(d).strip() for d in pyodbc.drivers()}
    except Exception:
        return set()


def drivers_to_try() -> list[str]:
    installed = installed_odbc_drivers()
    return [name for name in ODBC_DRIVER_CANDIDATES if name in installed]


def pick_odbc_driver_name() -> str:
    drivers = drivers_to_try()
    if drivers:
        return drivers[0]
    raise RuntimeError(
        "لم يُعثر على Microsoft ODBC Driver — ثبّت msodbcsql17/18 على الخادم (Dockerfile)."
    )


def sql_server_host(server: str, port: int | None) -> str:
    s = (server or "").strip()
    if not s:
        return s
    if s.lower().startswith("tcp:"):
        return s
    if port is not None:
        return f"tcp:{s},{port}"
    return f"tcp:{s}"


def _tls_extra_variants(driver: str) -> list[str]:
    """ترتيب المحاولات — SQL Server القديم على الشبكة العامة."""
    if "18" in driver:
        return [
            ";Encrypt=no;TrustServerCertificate=yes",
            ";Encrypt=optional;TrustServerCertificate=yes",
            ";Encrypt=yes;TrustServerCertificate=yes",
        ]
    if "17" in driver:
        return [
            ";Encrypt=no",
            ";Encrypt=yes;TrustServerCertificate=yes",
        ]
    return [""]


def _connection_string(
    driver: str,
    host: str,
    database: str,
    uid: str,
    pwd: str,
    extras: str,
) -> str:
    return (
        f"DRIVER={{{driver}}};SERVER={host};DATABASE={database};UID={uid};PWD={pwd}"
        f";Connection Timeout=15{extras}"
    )


def odbc_connection_string(
    server: str,
    port: int | None,
    database: str,
    uid: str,
    pwd: str,
    *,
    tls_variant_index: int = 0,
) -> str:
    driver = pick_odbc_driver_name()
    host = sql_server_host(server, port)
    variants = _tls_extra_variants(driver)
    extras = variants[min(tls_variant_index, len(variants) - 1)]
    return _connection_string(driver, host, database, uid, pwd, extras)


def pyodbc_connect_compat(
    server: str,
    port: int | None,
    database: str,
    uid: str,
    pwd: str,
    *,
    timeout: int = 10,
) -> pyodbc.Connection:
    """يجرب كل السائقات المثبتة (17 ثم 18) وعدة خيارات TLS."""
    host = sql_server_host(server, port)
    drivers = drivers_to_try()
    if not drivers:
        raise RuntimeError(
            "لم يُعثر على Microsoft ODBC Driver — ثبّت msodbcsql17/18 على الخادم."
        )
    last_err: Exception | None = None
    for driver in drivers:
        for extras in _tls_extra_variants(driver):
            cs = _connection_string(driver, host, database, uid, pwd, extras)
            try:
                return pyodbc.connect(cs, timeout=timeout)
            except Exception as e:
                last_err = e
    if last_err is not None:
        raise last_err
    raise RuntimeError("فشل إنشاء اتصال ODBC")
