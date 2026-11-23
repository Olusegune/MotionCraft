# Project schema and package

JSON Schema files in `schemas/` are the source of truth; TypeScript (`src/types/`) and Python (pydantic,
`engine/motioncraft_engine/store/models.py`) types are generated from them. `schemaVersion` starts at `"1.0"`;
every change adds a migration in `store/migrations/` and a test that opens the previous version.

## Package layout

```
MyPiece.motioncraft/
  project.json            MotionProject (below)
  comp.ecproj             EffectCraft project (composition source of truth)
  assets/                 imported and generated media (relative paths only)
    audio/ images/ video/ brand/ references/
  fonts/manifest.json     [{family, style, file?, source, licence, videoUseAllowed, sha256}]
  previews/               cached preview PNGs (deletable)
  renders/                final outputs
  logs/                   session-*.jsonl (no keys)
```

No absolute paths anywhere in `project.json`. Font files are included only when their licence allows
redistribution; otherwise the manifest names them and QA flags them as missing on another machine.

## Types

```ts
type MotionProject = {
  id: string;                      // uuid
  schemaVersion: string;           // "1.0"
  name: string;
  brief: CreativeBrief;
  intent: CreativeIntent;
  style: StyleProfile;
  controlModes: Record<Stage, 'manual' | 'assisted' | 'agent-led'>;
  engine: { kind: 'effectcraft'; version: string; commit: string; projectPath: string };  // projectPath relative
  layerMap: LayerBinding[];
  assets: AssetReference[];
  audio: AudioAnalysis[];
  markers: TimelineMarker[];       // mirror of what was written to the engine, for re-sync only
  approvals: ApprovalRecord[];
  revisions: RevisionRecord[];
  renders: RenderJob[];
  qa: QAReport[];
  budget: { capUsd: number; approvalThresholdUsd: number };
};

type Stage = 'intent' | 'style' | 'treatment' | 'sound' | 'build' | 'audio-sync' | 'qa-fixes';

type CreativeBrief = {
  text: string; script?: string;
  audio: string[]; references: string[]; brandDocs: string[]; storyboards: string[];   // asset ids
  deliverables: { aspect: '16:9' | '9:16' | '1:1' | '4:5' | '2.39:1' | '21:9'; width: number; height: number;
                  fps: 23.976 | 24 | 25 | 29.97 | 30 | 50 | 60; durationSec: number; alpha: boolean }[];
};

type Scale5 = 1 | 2 | 3 | 4 | 5;   // every point has a written anchor in intent/anchors.yaml
type CreativeIntent = {
  purpose: 'inform' | 'teach' | 'persuade' | 'sell' | 'announce' | 'celebrate' | 'entertain' | 'memorialize';
  tone: ('authoritative' | 'trustworthy' | 'playful' | 'elegant' | 'instructional' | 'provocative' | 'restrained')[];
  arc: { beatId: string; startSec: number; endSec: number; primary: string; secondary?: string;
         intensity: Scale5; energy: Scale5 }[];
  summary: string;                 // plain language, shown on the card
  firedRules: string[];            // rule ids from the rule table
  source: 'agent' | 'user';
};

type StyleProfile = {
  dimensions: Partial<Record<'typography' | 'motion' | 'color' | 'texture' | 'camera' | 'transitions' | 'composition',
               { familyId: string; intensity: 'subtle' | 'moderate' | 'strong' }>>;
  fonts: { role: 'display' | 'body' | 'accent'; family: string; style: string }[];
  palette: { name: string; hex: string; role: string }[];
  conflicts: { a: string; b: string; reason: string; overridden: boolean }[];
  references: { assetId: string; attribution: string; principles: string[] }[];
};

type LayerBinding = {
  engineLayerId: number;           // EffectCraft LayerId (u64). Unique, not sequential (2, 41, 92...), identical over 20 save/reopen cycles (P0-04)
  compId: string;
  role: 'title' | 'body-text' | 'logo' | 'background' | 'texture' | 'camera' | 'audio-driver' | 'other';
  primitiveId?: string; primitiveVersion?: string;
  provenance: Provenance;
  lock: 'none' | 'approved';
  approvedHash?: string;
  lastKnownHash: string;
};

type Provenance = {
  actor: 'agent:director' | 'agent:builder' | 'agent:qa' | 'user';
  prompt?: string; referenceIds?: string[];
  provider?: string; model?: string; seed?: number;
  costUsd?: number; costUnit?: string; costReported: boolean;   // reported by provider vs estimate (as FilmCrafter3)
  licence?: string; at: string;                                 // ISO time
};

type ApprovalRecord = { gate: 'A' | 'B' | 'C' | 'D' | 'layer'; target: string; by: 'user'; at: string;
                        state: 'approved' | 'changed_by_user' | 'revoked'; note?: string };
type RevisionRecord = { id: string; at: string; actor: Provenance['actor']; kind: 'agent_edit' | 'manual_edit' |
                        'qa_fix' | 'unlock' | 'intent_change' | 'style_change'; layers: number[]; summary: string };
type QAFinding = { id: string; check: string; tier: 1 | 2 | 3; severity: 'info' | 'warn' | 'error';
                   at?: { timeSec?: number; layerId?: number }; evidence: { framePng?: string; measured?: number;
                   threshold?: number; detail: string }; cause: string; fix?: { label: string; safe: boolean; commands: unknown[] } };
```

## Motion primitive (one YAML file per primitive in `engine/motioncraft_engine/primitives/library/`)

```yaml
id: text.reveal.per-char.rise
version: 1.0.0
category: text-animator            # easing | text-animator | transition | layout | camera | beat-driver
params:
  stagger_frames: {type: int, min: 0, max: 12, default: 2}
  distance_px:   {type: float, min: 0, max: 400, default: 40}
  easing:        {type: ref, kind: easing, default: easing.crisp}
tags:
  intent: [energy:3-5, tone:playful, tone:authoritative]
  style:  [bold-kinetic, swiss]
recipe:                            # EffectCraft engine commands with ${param} and ${layer} substitution
  - {id: prop.addKey, params: {layer: "${layer}", path: "...", time: 0, value: "..."}}
thumbnail: thumbs/text.reveal.per-char.rise.png
reference_render: refs/text.reveal.per-char.rise.mp4
reference_hash: sha256-of-preview-frames   # regression check on pin bumps
```

## Storage

`project.json` is written atomically (write temp, fsync, rename). A local SQLite index (`~/.motioncraft/index.db`)
holds project list, revision search and primitive usage; it can always be rebuilt from packages.
