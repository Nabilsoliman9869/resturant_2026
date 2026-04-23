# -*- mode: python ; coding: utf-8 -*-
import os

_SPEC_DIR = os.path.dirname(os.path.abspath(SPEC))
_ICON = os.path.join(_SPEC_DIR, "assets", "mat3am_icon.ico")
_VER = os.path.join(_SPEC_DIR, "assets", "file_version_info.txt")

a = Analysis(
    ['backend\\mat3am_exe_entry.py'],
    pathex=[_SPEC_DIR],
    binaries=[],
    datas=[('ui', 'ui'), ('config', 'config'), ('docs', 'docs'), ('public', 'public')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='Mat3amPOS',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=_ICON,
    version=_VER,
)
