"""What each video model can do, read from the provider's own published schema instead of guessed.

Kie.ai publishes an OpenAPI page for every model (docs.kie.ai/market/<model>.md), fal publishes one per endpoint
(fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>), and Google's Veo has a small fixed set. From a schema this module builds:

  * `fields`: every input the model takes, with its type, allowed values, default and limits, and a `role` (prompt, first frame, last frame,
    reference pictures, reference videos, reference audio, aspect ratio, duration, resolution, sound on or off, seed, negative prompt, other);
  * `caps`: a plain summary the page uses to show only what the model can do: image to video, first and last frame, reference pictures, video to
    video, audio in, sound out, the aspect ratios, lengths and sizes.

Nothing here sends anything: it only reads the schema text it is given.
"""
from __future__ import annotations

import json
import re
from typing import Any

import yaml

# field name -> role. The first pattern that matches wins.
_ROLES: list[tuple[str, re.Pattern[str]]] = [
    ("prompt", re.compile(r"^(prompt|text_prompt)$")),
    ("negative_prompt", re.compile(r"^negative_prompt$")),
    ("image_first", re.compile(r"^(first_frame(_url)?|start_image(_url)?|image_url|image|input_image(_url)?|init_image(_url)?|first_image_url)$")),
    ("image_last", re.compile(r"^(last_frame(_url)?|tail_image(_url)?|end_image(_url)?|last_image_url)$")),
    ("image_refs", re.compile(r"^(reference_image_urls|reference_images?|ref_image_urls|image_urls|images|input_urls|image_input|image_list)$")),
    ("video_refs", re.compile(r"^(reference_video_urls|reference_videos?|video_urls?|video|input_video(_url)?|source_video(_url)?)$")),
    ("audio_refs", re.compile(r"^(reference_audio_urls|reference_audios?|audio_urls?|audio|input_audio(_url)?|voice_url|speech_url)$")),
    ("aspect_ratio", re.compile(r"^(aspect_ratio|aspectratio|ratio)$")),
    ("resolution", re.compile(r"^(resolution|quality|size)$")),
    ("duration", re.compile(r"^(duration|length|seconds|video_length)$")),
    ("sound", re.compile(r"^(generate_audio|with_audio|enable_audio|audio_enabled|sound)$")),
    ("seed", re.compile(r"^seed$")),
]
SLOT_ROLES = ("image_first", "image_last", "image_refs", "video_refs", "audio_refs")


def _role(name: str) -> str:
    for role, pat in _ROLES:
        if pat.match(name):
            return role
    return "other"


def _resolve(node: Any, doc: dict) -> dict:
    """Follows a $ref (OpenAPI) one step, and picks the first non-null branch of an anyOf/oneOf (fal writes optional fields that way)."""
    if not isinstance(node, dict):
        return {}
    ref = node.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/"):
        cur: Any = doc
        for part in ref[2:].split("/"):
            cur = cur.get(part, {}) if isinstance(cur, dict) else {}
        return _resolve(cur, doc)
    for key in ("anyOf", "oneOf", "allOf"):
        if isinstance(node.get(key), list):
            for br in node[key]:
                r = _resolve(br, doc)
                if r and r.get("type") != "null":
                    return {**{k: v for k, v in node.items() if k not in ("anyOf", "oneOf", "allOf")}, **r}
    return node


def _field(name: str, spec: dict, required: set[str], doc: dict) -> dict:
    spec = _resolve(spec, doc)
    typ = spec.get("type")
    items = _resolve(spec.get("items"), doc) if isinstance(spec.get("items"), dict) else {}
    out: dict[str, Any] = {"name": name, "role": _role(name), "type": typ or "string", "required": name in required,
                           "description": str(spec.get("description") or "").strip().replace("\n", " ")[:240]}
    if isinstance(spec.get("enum"), list):
        out["enum"] = [x for x in spec["enum"] if isinstance(x, (str, int, float, bool))][:60]
    if "default" in spec and isinstance(spec["default"], (str, int, float, bool)):
        out["default"] = spec["default"]
    for k_src, k_dst in (("minimum", "min"), ("maximum", "max"), ("maxItems", "maxItems"), ("minItems", "minItems")):
        if isinstance(spec.get(k_src), (int, float)):
            out[k_dst] = spec[k_src]
    if out["role"] == "duration" and typ in ("integer", "number") and "enum" not in out and "min" not in out:
        m = re.search(r"(\d+)\s*(?:-|to)\s*(\d+)", out["description"])       # Kie writes the limits in words: "4-15 seconds or -1"
        if m and 0 < int(m.group(1)) < int(m.group(2)) <= 120:
            out["min"], out["max"] = int(m.group(1)), int(m.group(2))
    if typ == "array":
        out["list"] = True
        if isinstance(items.get("enum"), list):
            out["enum"] = items["enum"][:60]
    return out


def _normalise(props: dict, required: list | set | None, doc: dict) -> dict:
    req = {str(r) for r in (required or [])}
    fields = [_field(str(n), s, req, doc) for n, s in props.items() if isinstance(s, dict)]
    fields = [f for f in fields if f["name"] not in ("callBackUrl", "callback_url", "webhook", "webhook_url", "nsfw_checker", "enable_safety_checker", "sync_mode", "return_last_frame")]
    return {"fields": fields, "caps": capabilities(fields)}


def capabilities(fields: list[dict]) -> dict:
    by: dict[str, dict] = {}
    for f in fields:
        by.setdefault(f["role"], f)

    def values(role: str) -> list:
        f = by.get(role)
        return list(f.get("enum") or []) if f else []

    dur = by.get("duration")
    durations: dict[str, Any] = {}
    if dur:
        if dur.get("enum"):
            durations = {"values": dur["enum"]}
        elif isinstance(dur.get("min"), (int, float)) and isinstance(dur.get("max"), (int, float)):
            durations = {"min": dur["min"], "max": dur["max"]}
        durations["default"] = dur.get("default")
        durations["type"] = dur.get("type")
    return {
        "text": "prompt" in by,
        "imageFirst": "image_first" in by, "imageLast": "image_last" in by,
        "imageRefs": int(by["image_refs"].get("maxItems") or 4) if "image_refs" in by else 0,
        "videoRefs": int(by["video_refs"].get("maxItems") or 1) if "video_refs" in by else 0,
        "audioRefs": int(by["audio_refs"].get("maxItems") or 1) if "audio_refs" in by else 0,
        "soundOut": "sound" in by, "negativePrompt": "negative_prompt" in by, "seed": "seed" in by,
        "aspects": values("aspect_ratio"), "resolutions": values("resolution"), "durations": durations,
    }


# ------------------------------------------------------------------------------------------------------------------ Kie
_YAML_BLOCK = re.compile(r"```yaml\n(.*?)\n```", re.S)


def parse_kie(markdown: str) -> dict:
    """The input fields of a Kie.ai model, from its documentation page (the OpenAPI block inside it)."""
    m = _YAML_BLOCK.search(markdown or "")
    if not m:
        raise ValueError("The model's page has no OpenAPI block.")
    doc = yaml.safe_load(m.group(1))
    post = (((doc.get("paths") or {}).get("/api/v1/jobs/createTask") or {}).get("post") or {})
    sch = (((post.get("requestBody") or {}).get("content") or {}).get("application/json") or {}).get("schema") or {}
    sch = _resolve(sch, doc)
    inp = _resolve((sch.get("properties") or {}).get("input"), doc)
    props = inp.get("properties") or {}
    if not props:
        raise ValueError("The model's page has no input fields this version reads.")
    return _normalise(props, inp.get("required"), doc)


# ------------------------------------------------------------------------------------------------------------------ fal
def parse_fal(openapi: dict) -> dict:
    """The input fields of a fal endpoint, from its published OpenAPI document."""
    schemas = ((openapi or {}).get("components") or {}).get("schemas") or {}
    name = next((k for k in schemas if k.lower().endswith("input")), None)
    if name is None:
        raise ValueError("The endpoint's schema has no input.")
    inp = schemas[name]
    return _normalise(inp.get("properties") or {}, inp.get("required"), openapi)


# ------------------------------------------------------------------------------------------------------------------ Google
def google_veo() -> dict:
    fields = [
        {"name": "prompt", "role": "prompt", "type": "string", "required": True, "description": ""},
        {"name": "image", "role": "image_first", "type": "string", "required": False, "description": "The picture the clip starts from."},
        {"name": "aspect_ratio", "role": "aspect_ratio", "type": "string", "required": False, "enum": ["16:9", "9:16"], "default": "16:9", "description": ""},
        {"name": "resolution", "role": "resolution", "type": "string", "required": False, "enum": ["720p", "1080p"], "default": "720p", "description": "1080p only at 8 seconds."},
        {"name": "duration", "role": "duration", "type": "integer", "required": False, "enum": [4, 6, 8], "default": 8, "description": ""},
        {"name": "negative_prompt", "role": "negative_prompt", "type": "string", "required": False, "description": ""},
    ]
    caps = capabilities(fields)
    caps["soundOut"] = True            # Veo 3 makes sound with the picture; there is no switch for it in the Gemini API
    return {"fields": fields, "caps": caps}


def to_json(schema: dict) -> str:
    return json.dumps(schema, ensure_ascii=False)
