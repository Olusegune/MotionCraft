"""Builds the engine helper into src-tauri/binaries/motioncraft-engine-<target-triple>[.exe] (Tauri externalBin naming).
Needs: pip install pyinstaller pydantic   Usage: python scripts/build_sidecar.py"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
host = re.search(r"^host: (.+)$", subprocess.run(["rustc", "-vV"], capture_output=True, text=True, check=True).stdout, re.M).group(1)
ext = ".exe" if "windows" in host else ""
work = root / "build" / "sidecar"
subprocess.run([sys.executable, "-m", "PyInstaller", "--onefile", "--noconfirm", "--clean", "--name", "motioncraft-engine",
                "--distpath", str(work / "dist"), "--workpath", str(work / "work"), "--specpath", str(work),
                "--paths", str(root / "engine"), str(root / "engine" / "sidecar_main.py")], check=True)
out = root / "src-tauri" / "binaries"
out.mkdir(parents=True, exist_ok=True)
dest = out / f"motioncraft-engine-{host}{ext}"
shutil.copy2(work / "dist" / f"motioncraft-engine{ext}", dest)
print("wrote", dest)
