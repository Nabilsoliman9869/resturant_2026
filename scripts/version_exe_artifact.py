from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path


def next_build_number(dist_dir: Path) -> int:
    pattern = re.compile(r"^Mat3amPOS(\d{3})\.exe$", re.IGNORECASE)
    max_num = 0
    for p in dist_dir.glob("Mat3amPOS*.exe"):
        m = pattern.match(p.name)
        if not m:
            continue
        try:
            max_num = max(max_num, int(m.group(1)))
        except ValueError:
            continue
    return max_num + 1


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    dist = root / "dist"
    src = dist / "Mat3amPOS.exe"
    if not src.is_file():
        print(f"[version-exe] source missing: {src}")
        return 1
    dist.mkdir(parents=True, exist_ok=True)
    # manual override via arg: python version_exe_artifact.py 26
    if len(sys.argv) > 1:
        try:
            n = int(sys.argv[1])
        except ValueError:
            n = next_build_number(dist)
    else:
        n = next_build_number(dist)
    dst = dist / f"Mat3amPOS{n:03d}.exe"
    shutil.copy2(src, dst)
    print(f"[version-exe] created: {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
