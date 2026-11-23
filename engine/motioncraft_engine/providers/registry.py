"""Model registry: which image and video models MotionCraft can offer, from which provider, at what (known) price.

Ported in idea and data from FilmCrafter3 `registry.py` / `render.py` at ac99ec9 (see docs/PORT_LEDGER.md): the built-in lists
are copied by hand, the discovery calls are rewritten. Rules kept from there:
  * built-in models are always available; discovery adds to them and never removes one (a model missing from a later list is
    marked not listed, because projects refer to it);
  * a failed discovery changes nothing and says so;
  * a price nobody published is Unknown, never a guess.
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

from .net import Net, NetError

MEDIA = ("image", "video")
OFFICIAL = {"byteplus", "google", "openai"}
AGGREGATORS = {"kie", "fal"}
PROVIDERS = ("byteplus", "google", "openai", "kie", "fal")
PROVIDER_LABEL = {"byteplus": "BytePlus", "google": "Google", "openai": "OpenAI", "kie": "Kie.ai", "fal": "fal"}
STALE_SECONDS = 14 * 86400


def entry(provider: str, model: str, name: str, media: str, *, price: float | None = None, price_note: str = "", source: str = "builtin") -> dict:
    return {
        "provider": provider, "model": model, "name": name, "media": media, "official": provider in OFFICIAL,
        "price": {"known": price is not None, "unit": "usd_per_output" if price is not None else None, "value": price,
                  "note": price_note if price is not None else "Not published by the provider here: Unknown."},
        "source": source, "listed": True,
    }


_BP = "BytePlus published price, per picture (FilmCrafter3 read it 2026-10-30; not proved by a live render)"
BUILTIN: list[dict] = [
    entry("byteplus", "dola-seedream-5-0-pro-260628", "Seedream 5.0 Pro", "image", price=0.045, price_note=_BP + "; $0.09 above 1.5K"),
    entry("byteplus", "dola-seedream-5-0-flash-260915", "Seedream 5.0 Flash", "image", price=0.018, price_note=_BP),
    entry("byteplus", "seedream-5-0-260128", "Seedream 5.0 Lite", "image", price=0.035, price_note=_BP),
    entry("byteplus", "seedream-4-5-251128", "Seedream 4.5", "image", price=0.04, price_note=_BP),
    entry("byteplus", "seedream-4-0-250828", "Seedream 4.0", "image", price=0.03, price_note=_BP),
    entry("google", "veo-3.1-generate-preview", "Veo 3.1", "video"),
    entry("google", "veo-3.1-fast-generate-preview", "Veo 3.1 Fast", "video"),
    entry("google", "veo-3.1-lite-generate-preview", "Veo 3.1 Lite", "video"),
    entry("google", "gemini-nano-banana-2.1", "Nano Banana 2.1", "image"),
    entry("google", "gemini-3.1-flash-image", "Nano Banana 2 (Gemini 3.1 Flash Image, retiring 29 Oct 2026)", "image"),
    entry("google", "gemini-3-pro-image", "Nano Banana Pro (Gemini 3 Pro Image)", "image"),
    entry("google", "gemini-3.1-flash-lite-image", "Gemini 3.1 Flash Lite Image", "image"),
    entry("openai", "gpt-image-2.5-flare", "GPT Image 2.5 Flare", "image"),
    entry("openai", "gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst", "image"),
    entry("openai", "gpt-image-2", "GPT Image 2", "image"),
    entry("openai", "gpt-image-1.5", "GPT Image 1.5", "image"),
    entry("kie", "midjourney/mj-v7", "Midjourney v7", "image"),
]


_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$")


def key_of(e: dict) -> str:
    return f"{e['provider']}/{e['model']}"


# Kie lists tools under "video" that are not generators (upscale, extend, edit, motion transfer, lip-sync). Choosing one can only fail.
KIE_NOT_A_GENERATOR = re.compile(r"upscale|/extend|motion-control|identification|subject-detection|video-?edit|video-to-video|animate-(?:move|replace)|"
                                 r"lip-?sync|avatar|infinitalk|topaz|recraft-(?:crisp|remove)|remove-background", re.I)


def discover_kie(net: Net) -> list[dict]:
    text = net.text("https://docs.kie.ai/llms.txt")
    out = []
    for line in text.splitlines():
        m = re.match(r"- (Video|Image)\s+Models > ([^\[]+)\[([^\]]+)\]\((https://docs\.kie\.ai/market/[^)]+)\.md\)", line)
        if not m or "/cn/" in m.group(4):
            continue
        slug = m.group(4).split("/market/", 1)[1]
        if KIE_NOT_A_GENERATOR.search(slug):
            continue
        out.append(entry("kie", slug[:120], f"{m.group(2).strip()} · {m.group(3).strip()}"[:100], m.group(1).lower(), source="discovered"))
    return out


FAL_CATEGORIES = {"video": ("image-to-video", "text-to-video"), "image": ("text-to-image", "image-to-image")}


def discover_fal(net: Net, key: str) -> list[dict]:
    out, seen = [], set()
    for media, cats in FAL_CATEGORIES.items():
        for cat in cats:
            cursor = None
            for _ in range(10):
                q = f"category={cat}&limit=100&status=active" + (f"&cursor={cursor}" if cursor else "")
                r = net.json("GET", f"https://api.fal.ai/v1/models?{q}", headers={"Authorization": f"Key {key}"})
                for m in r.get("models", []):
                    mid = m.get("endpoint_id")
                    if mid and mid not in seen:
                        seen.add(mid)
                        out.append(entry("fal", mid, (m.get("metadata") or {}).get("display_name", mid)[:100], media, source="discovered"))
                cursor = r.get("next_cursor")
                if not r.get("has_more") or not cursor:
                    break
    return out


class Registry:
    def __init__(self, path: Path | None = None):
        self.path = Path(path) if path else None
        self.data: dict[str, Any] = {"models": {}, "refreshed": {}}
        if self.path and self.path.is_file():
            try:
                loaded = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict) and isinstance(loaded.get("models"), dict):
                    self.data = {"models": loaded["models"], "refreshed": loaded.get("refreshed", {})}
            except (OSError, ValueError):
                pass  # a damaged cache is rebuilt from the built-in list

    def all(self) -> list[dict]:
        out = {key_of(e): dict(e) for e in BUILTIN}
        for k, e in self.data["models"].items():
            if k not in out and e.get("media") in MEDIA and e.get("provider") in PROVIDERS:
                out[k] = e
        return sorted(out.values(), key=lambda e: (e["media"], e["provider"], e["name"].lower()))

    def get(self, provider: str, model: str) -> dict | None:
        return next((e for e in self.all() if e["provider"] == provider and e["model"] == model), None)

    def status(self) -> dict:
        now = time.time()
        return {p: {"refreshed": self.data["refreshed"].get(p),
                    "stale": not self.data["refreshed"].get(p) or now - self.data["refreshed"][p] > STALE_SECONDS} for p in ("kie", "fal")}

    def refresh(self, net: Net, keys: dict[str, str], providers: list[str] | None = None) -> dict[str, dict]:
        """Ask Kie and fal for their lists. A failure changes nothing for that provider and is reported."""
        results: dict[str, dict] = {}
        for p in providers or ["kie", "fal"]:
            try:
                if p == "kie":
                    found = discover_kie(net)
                elif p == "fal":
                    if not keys.get("fal"):
                        results[p] = {"ok": False, "error": "Add your fal key in Settings to list its models."}
                        continue
                    found = discover_fal(net, keys["fal"])
                else:
                    results[p] = {"ok": False, "error": "This provider has a built-in list."}
                    continue
            except NetError as e:
                results[p] = {"ok": False, "error": str(e)}
                continue
            if not found:
                results[p] = {"ok": False, "error": "The provider's list was empty or in a format this version does not read; nothing changed."}
                continue
            found = [e for e in found if _SAFE_ID.match(e["model"]) and ".." not in e["model"]]   # remote ids become URL paths
            seen = {key_of(e) for e in found}
            for e in found:
                self.data["models"][key_of(e)] = e
            for k, e in self.data["models"].items():
                if e["provider"] == p and k not in seen:
                    e["listed"] = False            # never removed: projects refer to it
            self.data["refreshed"][p] = time.time()
            results[p] = {"ok": True, "models": len(found)}
        self._save()
        return results

    def _save(self) -> None:
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=1, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.path)
