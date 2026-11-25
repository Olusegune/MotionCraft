// Subset of docs/PROJECT_SCHEMA.md used by the shell. schemaVersion "1.0".
export type Stage = "brief" | "intent" | "direction" | "treatment" | "build" | "review" | "deliver";
export const STAGES: Stage[] = ["brief", "intent", "direction", "treatment", "build", "review", "deliver"];

export type ModeKey = "intent" | "style" | "treatment" | "sound" | "build" | "audio-sync" | "qa-fixes";
export type ControlMode = "manual" | "assisted" | "agent-led";
export type GateId = "A" | "B" | "C" | "D";
export type Scale5 = 1 | 2 | 3 | 4 | 5;

export type Purpose = "inform" | "teach" | "persuade" | "sell" | "announce" | "celebrate" | "entertain" | "memorialize";
export type Tone = "authoritative" | "trustworthy" | "playful" | "elegant" | "instructional" | "provocative" | "restrained";
export type Dimension = "typography" | "motion" | "color" | "texture" | "camera" | "transitions" | "composition";
export type Intensity = "subtle" | "moderate" | "strong";

export interface Beat {
  beatId: string; startSec: number; endSec: number;
  primary: string; secondary?: string; intensity: Scale5; energy: Scale5;
}
export interface Deliverable {
  aspect: "16:9" | "9:16" | "1:1" | "4:5" | "2.39:1" | "21:9";
  width: number; height: number; fps: 23.976 | 24 | 25 | 29.97 | 30 | 50 | 60; durationSec: number; alpha: boolean;
}
export interface ApprovalRecord {
  gate: GateId | "layer"; target: string; by: "user"; at: string;
  state: "approved" | "changed_by_user" | "revoked"; note?: string;
}
export interface RevisionRecord {
  id: string; at: string; actor: "user" | "agent:director" | "agent:builder" | "agent:qa";
  kind: "agent_edit" | "manual_edit" | "qa_fix" | "unlock" | "intent_change" | "style_change";
  layers: number[]; summary: string;
  /** Saved versions of the composition kept around this change (P4-05): the state after it, and the state before it. */
  snapshot?: string; before?: string;
}
export interface RenderRecord { id: string; preset: "h264" | "prores4444"; rel: string; frames: number | null; bytes: number | null; at: string }
export interface ReviewComment { id: string; atSec: number; text: string; at: string }

export interface LayerBinding {
  engineLayerId: number; compId: string;
  role: "title" | "body-text" | "logo" | "background" | "texture" | "camera" | "audio-driver" | "other";
  primitiveId?: string; primitiveVersion?: string;
  provenance: { actor: "agent:director" | "agent:builder" | "agent:qa" | "user"; at: string; costReported: boolean };
  lock: "none" | "approved"; approvedHash?: string; lastKnownHash: string;
}

export interface AssetReference {
  id: string; kind: "image" | "video" | "audio"; path: string;   // path is relative to the package folder
  name?: string;
  /** What the person says about their right to use an imported file. Unset means not confirmed yet. Files MotionCraft made through a provider carry the provider's terms in provenance instead. */
  rights?: "mine" | "licensed" | "stock";
  /** Result of looking for lettering in a picture with a model on this computer: true found, false none, null could not be checked. */
  check?: { lettering: boolean | null; text?: string };
  provenance: { actor: string; prompt?: string; provider: string; model: string; at: string; licence: string;
                costReported: boolean; costValue: number | null; costUnit: string | null };
}

/** One row of the intent-to-parameter rule table (P1-09). Every condition present must hold; tones and purposes match on any. */
export interface RuleSpec {
  id: string; label: string; enabled: boolean;
  when: { tones?: Tone[]; purposes?: Purpose[]; energyAtLeast?: number; energyAtMost?: number };
  timing: string; easing: string; typography: string; layout: string; transitions: string;
}

export interface MotionProject {
  id: string; schemaVersion: "1.0"; name: string;
  brief: { text: string; script?: string; audio: string[]; references: string[]; brandDocs: string[]; storyboards: string[];
           deliverables: Deliverable[] };
  intent: { purpose?: Purpose; tone: Tone[]; arc: Beat[]; summary: string; firedRules: string[]; source: "agent" | "user" };
  style: { moodboard?: string[];   // asset ids chosen as references
           dimensions: Partial<Record<Dimension, { familyId: string; intensity: Intensity }>>;
           conflicts: { a: string; b: string; reason: string; overridden: boolean }[] };
  treatment: Record<string, { plan: string; motion: string; frameAssetId?: string; frameLoop?: boolean; stillAssetId?: string; animate?: import("./lib/videoPrompt").AnimateSettings }>;   // keyed by beatId (added in P1-01; see PR)
  /** `accepted`: warnings and notes the person has looked at and chosen to live with, so they stop counting against the sign-off. Errors cannot be accepted. */
  review: { comments: ReviewComment[]; preview?: { rel: string; at: string }; accepted?: { key: string; check: string; detail: string; at: string }[] };
  renders?: RenderRecord[];
  controlModes: Record<ModeKey, ControlMode>;
  songmaps?: { id: string; path: string; name: string; at: string }[];   // Pulseframe SongMaps brought into the project (P3-01)
  rules?: RuleSpec[];   // the user's edited rule table; absent = the defaults
  engine: { kind: "effectcraft"; version: string; commit: string; projectPath: string };
  assets?: AssetReference[];
  layerMap?: LayerBinding[];   // optional so projects made before P1-11 still open
  approvals: ApprovalRecord[];
  revisions: RevisionRecord[];
  budget: { capUsd: number; approvalThresholdUsd: number; maxCalls?: number; ledger?: SpendEntry[] };
  createdAt: string; updatedAt: string;
}
export interface ProjectSummary { id: string; name: string; path: string; updatedAt: string }

export const PINNED_COMMIT = "7e2d0256209974ffb92a29d8bdb6f2a49078f51f";
export const PINNED_VERSION = "0.24.1";

/** One paid generation that was started. `usd` is null when the provider published no price. */
export interface SpendEntry { at: string; provider: string; model: string; what: string; usd: number | null }
