"""
قبل pyinstaller: طابع بناء + أيقونة .ico من dist/oya_Mohandessin.png + file_version_info لخصائص ويندوز.
"""
from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _git_short() -> str:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=5,
        )
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except Exception:
        pass
    return "nogit"


def main() -> None:
    now_utc = datetime.now(timezone.utc)
    stamp = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    git_h = _git_short()
    # رمز سريع للنسخة ليسهل تمييزها بين الاجهزة
    # مثال: M250420-0122-CBF7C60
    build_code = f"M{now_utc.strftime('%y%m%d-%H%M')}-{git_h.upper()}"
    line = f"{stamp} code={build_code} git={git_h}\n"
    cfg = ROOT / "config" / "mat3am_exe_build.txt"
    cfg.parent.mkdir(parents=True, exist_ok=True)
    cfg.write_text(line, encoding="utf-8")
    print(f"[prepare] wrote {cfg}: {line.strip()}")

    try:
        from PIL import Image
    except ImportError:
        print("[prepare] WARNING: pip install pillow — تخطي توليد ICO", file=sys.stderr)
    else:
        src = ROOT / "dist" / "oya_Mohandessin.png"
        if not src.is_file():
            print(f"[prepare] ERROR: missing {src}", file=sys.stderr)
            sys.exit(1)
        assets = ROOT / "assets"
        assets.mkdir(parents=True, exist_ok=True)
        ico = assets / "mat3am_icon.ico"
        img = Image.open(src).convert("RGBA")
        side = max(img.size)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.alpha_composite(img, ((side - img.width) // 2, (side - img.height) // 2))
        img = canvas
        sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
        img.save(ico, format="ICO", sizes=sizes)
        print(f"[prepare] wrote {ico}")

    ver_path = ROOT / "assets" / "file_version_info.txt"
    # خصائص الملف في ويندوز — ProductVersion = طابع البناء (تتأكد من التحديث على الأجهزة)
    safe_stamp = stamp.replace("'", "")
    safe_build_code = build_code.replace("'", "")
    ver_path.write_text(
        f"""# UTF-8 (generated)
VSVersionInfo(
  ffi=FixedFileInfo(
    filevers=(1, 0, 0, 0),
    prodvers=(1, 0, 0, 0),
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo([
      StringTable(
        u'040904B0',
        [
          StringStruct(u'CompanyName', u'Mat3am'),
          StringStruct(u'FileDescription', u'Mat3am POS API'),
          StringStruct(u'FileVersion', u'1.0.0.0'),
          StringStruct(u'InternalName', u'Mat3amPOS'),
          StringStruct(u'LegalCopyright', u''),
          StringStruct(u'OriginalFilename', u'Mat3amPOS.exe'),
          StringStruct(u'ProductName', u'Mat3am POS'),
          StringStruct(u'ProductVersion', u'{safe_stamp} | {safe_build_code}'),
        ])
    ]),
    VarFileInfo([VarStruct(u'Translation', [1033, 1200])])
  ]
)
""",
        encoding="utf-8",
    )
    print(f"[prepare] wrote {ver_path}")


if __name__ == "__main__":
    main()
