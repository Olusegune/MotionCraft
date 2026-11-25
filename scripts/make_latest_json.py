"""Assemble the updater manifest (latest.json) and the release folder from the CI artifacts.

Usage: python scripts/make_latest_json.py <artifacts_dir> <tag> <out_dir>
Each artifact folder (MotionCraft-windows-x64, MotionCraft-macos-arm64, MotionCraft-macos-x64) must hold the signed update
package and its .sig file. Packages are copied to <out_dir> under per-platform names; the manifest points at them on the
GitHub release for <tag>. Fails loudly when a package or signature is missing: a release must never ship half signed.
"""
import json, shutil, sys
from datetime import datetime, timezone
from pathlib import Path

REPO = "Olusegune/MotionCraft"
# artifact folder -> (updater platform key, glob of the update package, name on the release)
PLATFORMS = {
    "MotionCraft-windows-x64": ("windows-x86_64", "*-setup.exe", "MotionCraft_{v}_x64-setup.exe"),
    "MotionCraft-macos-arm64": ("darwin-aarch64", "*.app.tar.gz", "MotionCraft_{v}_aarch64.app.tar.gz"),
    "MotionCraft-macos-x64": ("darwin-x86_64", "*.app.tar.gz", "MotionCraft_{v}_x64.app.tar.gz"),
}

def main(art: str, tag: str, out: str) -> int:
    version = tag.lstrip("v")
    outdir = Path(out); outdir.mkdir(parents=True, exist_ok=True)
    platforms = {}
    for folder, (key, pattern, name) in PLATFORMS.items():
        base = Path(art) / folder
        pkgs = [p for p in base.rglob(pattern) if p.is_file()]
        if len(pkgs) != 1:
            print(f"{folder}: expected exactly one {pattern}, found {len(pkgs)}", file=sys.stderr); return 1
        pkg = pkgs[0]; sig = Path(str(pkg) + ".sig")
        if not sig.is_file():
            print(f"{folder}: no signature file next to {pkg.name}", file=sys.stderr); return 1
        final = name.format(v=version)
        shutil.copy2(pkg, outdir / final)
        platforms[key] = {"signature": sig.read_text(encoding="utf-8").strip(), "url": f"https://github.com/{REPO}/releases/download/{tag}/{final}"}
    manifest = {"version": version, "notes": f"MotionCraft {version}", "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "platforms": platforms}
    (outdir / "latest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"wrote {outdir / 'latest.json'} for {', '.join(platforms)}")
    return 0

if __name__ == "__main__":
    if len(sys.argv) != 4: print(__doc__); sys.exit(2)
    sys.exit(main(*sys.argv[1:]))
