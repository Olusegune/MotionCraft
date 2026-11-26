"""Voiceover: speech from text, through OFFICIAL providers only (OpenAI and Google), with the delivery (emotion, pace, tone) written as instructions.

Voice and music models through aggregators are not used (the project's rule, ADR-0005): Kie.ai and fal stay for pictures and video. A voice is made with the
provider's own API and the person's own key, after a spend confirmation, and is saved in the project as a normal audio file.
"""
from __future__ import annotations

import base64
import struct
from typing import Any

from .clients import ProviderError

SPEECH_PROVIDERS = ("openai", "google")
MAX_TEXT = 4000

# model id -> (label, voices). Voice names are the provider's own.
OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"]
GOOGLE_VOICES = ["Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome",
                 "Algenib", "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"]

MODELS: list[dict[str, Any]] = [
    {"provider": "openai", "model": "gpt-4o-mini-tts", "name": "GPT-4o mini TTS (steerable: emotion, pace, accent)", "voices": OPENAI_VOICES, "instructions": True},
    {"provider": "openai", "model": "tts-1-hd", "name": "TTS HD", "voices": OPENAI_VOICES[:9], "instructions": False},
    {"provider": "google", "model": "gemini-2.5-flash-preview-tts", "name": "Gemini 2.5 Flash TTS (style by instruction)", "voices": GOOGLE_VOICES, "instructions": True},
    {"provider": "google", "model": "gemini-2.5-pro-preview-tts", "name": "Gemini 2.5 Pro TTS", "voices": GOOGLE_VOICES, "instructions": True},
]


def catalogue() -> list[dict]:
    return [dict(m) for m in MODELS]


def wav(pcm: bytes, rate: int = 24000, channels: int = 1, bits: int = 16) -> bytes:
    """Raw 16-bit samples wrapped as a WAV file (Google returns raw samples)."""
    byte_rate = rate * channels * bits // 8
    return (b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, channels, rate, byte_rate, channels * bits // 8, bits)
            + b"data" + struct.pack("<I", len(pcm)) + pcm)


def synthesize(net, provider: str, key: str, model: str, text: str, voice: str, instructions: str = "", speed: float = 1.0) -> tuple[bytes, str]:
    """Returns (audio bytes, extension). Raises ProviderError with the provider's reason."""
    if provider not in SPEECH_PROVIDERS:
        raise ProviderError("Voiceover uses official providers only: OpenAI or Google.")
    known = next((m for m in MODELS if m["provider"] == provider and m["model"] == model), None)
    if known is None:
        raise ProviderError("That voice model is not one MotionCraft offers.")
    if voice not in known["voices"]:
        raise ProviderError(f"{voice!r} is not a voice of {known['name']}.")
    text = (text or "").strip()
    if not text or len(text) > MAX_TEXT:
        raise ProviderError(f"The text to speak must be 1 to {MAX_TEXT} characters.")
    if provider == "openai":
        body: dict[str, Any] = {"model": model, "input": text, "voice": voice, "response_format": "wav", "speed": max(0.5, min(1.5, float(speed or 1.0)))}
        if known["instructions"] and instructions.strip():
            body["instructions"] = instructions.strip()[:800]
        data = net.post_bytes("https://api.openai.com/v1/audio/speech", headers={"Authorization": f"Bearer {key}"}, body=body, timeout=180)
        if data[:4] != b"RIFF":
            raise ProviderError("OpenAI did not return audio.")
        return data, ".wav"
    spoken = f"{instructions.strip()[:600]}: {text}" if instructions.strip() else text          # Gemini takes the style in the text itself
    j = net.json("POST", f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", headers={"x-goog-api-key": key}, timeout=180,
                 body={"contents": [{"parts": [{"text": spoken}]}], "generationConfig": {"responseModalities": ["AUDIO"],
                       "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}}})
    for cand in (j or {}).get("candidates") or []:
        for part in (cand.get("content") or {}).get("parts") or []:
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                raw = base64.b64decode(inline["data"])
                if raw[:4] == b"RIFF":
                    return raw, ".wav"
                return wav(raw), ".wav"
    raise ProviderError("Google returned no audio (the text may have been blocked by its safety filter).")
