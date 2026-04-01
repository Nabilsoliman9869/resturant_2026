"""اختبار الاتصال بـ SQL Server مباشرة"""
import pyodbc
import json
import os

_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cfg_path = os.path.join(_root, "config", "settings.json")
with open(cfg_path, "r", encoding="utf-8") as f:
    cfg = json.load(f)

s = (cfg.get("server") or ".").strip()
port = cfg.get("port")
db = (cfg.get("database") or "CONCREET_STATION").strip()
uid = (cfg.get("uid") or "sa").strip()
pwd = cfg.get("password") or ""

server = f"{s},{port}" if port else s
conn_str = f"DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={server};DATABASE={db};UID={uid};PWD={pwd};"

print("الاتصال:", conn_str.replace(pwd, "***"))
print()

try:
    conn = pyodbc.connect(conn_str, timeout=10)
    cur = conn.cursor()
    cur.execute("SELECT @@VERSION")
    row = cur.fetchone()
    print("OK - متصل بنجاح")
    print("SQL Server:", (row[0] or "")[:80])
    cur.execute("SELECT COUNT(*) FROM TBL005")
    n = cur.fetchone()[0]
    print("عدد السجلات في TBL005:", n)
    cur.close()
    conn.close()
except Exception as e:
    print("فشل:", e)
