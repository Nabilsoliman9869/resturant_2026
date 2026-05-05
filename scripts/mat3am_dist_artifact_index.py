"""
رقم نسخة الـ EXE المسمّاة: Mat3amPOS###.exe (قديم) و Mat3amPOS-vNNN.exe.
مصدر واحد لـ prepare_mat3am_exe_build و version_exe_artifact.
"""
from __future__ import annotations

import re
from pathlib import Path

_PAT_FLAT = re.compile(r"^Mat3amPOS(\d{3})\.exe$", re.IGNORECASE)
_PAT_V = re.compile(r"^Mat3amPOS-v(\d+)\.exe$", re.IGNORECASE)


def max_artifact_index(dist_dir: Path) -> int:
    mnum = 0
    if dist_dir.is_dir():
        for p in dist_dir.glob("Mat3amPOS*.exe"):
            m = _PAT_FLAT.match(p.name) or _PAT_V.match(p.name)
            if not m:
                continue
            try:
                mnum = max(mnum, int(m.group(1)))
            except ValueError:
                continue
    # إن حُذفت نسخ EXE من dist محلياً لا نرجع إلى v001 — نقرأ آخر v= من config إن وُجد
    cfg = dist_dir.parent / "config" / "mat3am_exe_build.txt"
    if cfg.is_file():
        try:
            first = (cfg.read_text(encoding="utf-8") or "").strip().split("\n", 1)[0]
            m = re.search(r"\bv=(\d+)", first)
            if m:
                mnum = max(mnum, int(m.group(1)))
        except Exception:
            pass
    return mnum


def next_artifact_index(dist_dir: Path) -> int:
    return max_artifact_index(dist_dir) + 1
