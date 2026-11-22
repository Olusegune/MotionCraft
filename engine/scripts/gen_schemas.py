"""Writes JSON Schemas for the adapter types into motioncraft_engine/adapter/schemas/. Run: python scripts/gen_schemas.py"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from motioncraft_engine.adapter import models  # noqa: E402

TYPES = ["Actor", "UserAction", "CompSettings", "Command", "DocSnapshot", "StepResult", "BatchResult", "PreviewResult",
         "FinalRenderJob", "RenderResult", "ExportResult", "EngineEvent"]
OUT = Path(__file__).resolve().parents[1] / "motioncraft_engine" / "adapter" / "schemas"


def schemas() -> dict[str, str]:
    return {t: json.dumps(getattr(models, t).model_json_schema(), indent=2, sort_keys=True) + "\n" for t in TYPES}


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in schemas().items():
        (OUT / f"{name}.schema.json").write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {len(TYPES)} schemas to {OUT}")
