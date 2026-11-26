import { useState } from "react";
import { Layers } from "lucide-react";
import { useApp } from "../../ctx";
import { Fold } from "../../shell/Fold";
import { assetLabel } from "../../shell/Media";
import type { Write } from "./Panels";

/** Flat colours to put behind keyed clips, as red, green and blue from 0 to 1. */
export const BACKDROP_COLOURS: { id: string; label: string; rgb: [number, number, number] }[] = [
  { id: "white", label: "White", rgb: [1, 1, 1] },
  { id: "black", label: "Black", rgb: [0.04, 0.04, 0.05] },
  { id: "grey", label: "Mid grey", rgb: [0.5, 0.5, 0.52] },
  { id: "warm", label: "Warm paper", rgb: [0.93, 0.88, 0.78] },
  { id: "sky", label: "Sky blue", rgb: [0.45, 0.68, 0.9] },
  { id: "dusk", label: "Deep navy", rgb: [0.06, 0.1, 0.22] },
  { id: "check", label: "Magenta (to check the key)", rgb: [1, 0, 1] },
];

/** What shows through a green or blue screen clip once the screen is taken out: a flat colour, or a picture or video from the media wall. */
export function BackdropPanel({ write, disabled }: { write: Write; disabled: boolean }) {
  const { project } = useApp();
  const media = (project.assets ?? []).filter((a) => a.kind !== "audio" && !a.screen);
  const [kind, setKind] = useState<"colour" | "picture" | "none">("colour");
  const [colour, setColour] = useState("grey");
  const [mediaId, setMediaId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const pick = media.find((m) => m.id === mediaId) ?? media[0];
  const reason = disabled ? "Needs a connected engine and no EffectCraft window open." : kind === "picture" && !pick ? "Import a picture or video first (Add to the scene, Import more)." : undefined;
  return (
    <Fold title="Background behind green screen clips" defaultOpen={false}>
      <p className="muted">When a clip's green or blue screen is taken out, this is what shows through. It is one layer called Backdrop, behind the scene pictures. Press again to change it.</p>
      <label className="field"><span className="field-label">Behind the clips</span>
        <select aria-label="Backdrop kind" value={kind} onChange={(e) => setKind(e.target.value as "colour" | "picture" | "none")}>
          <option value="colour">A flat colour</option><option value="picture">A picture or video</option><option value="none">Nothing (take it away)</option></select></label>
      {kind === "colour" && (
        <label className="field"><span className="field-label">Colour</span>
          <select aria-label="Backdrop colour" value={colour} onChange={(e) => setColour(e.target.value)}>
            {BACKDROP_COLOURS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      )}
      {kind === "picture" && (
        <label className="field"><span className="field-label">Picture or video</span>
          <select aria-label="Backdrop media" value={pick?.id ?? ""} disabled={!media.length} onChange={(e) => setMediaId(e.target.value)}>
            {media.length === 0 ? <option value="">No media yet</option> : media.map((m) => <option key={m.id} value={m.id}>{assetLabel(m)} ({m.kind})</option>)}</select></label>
      )}
      <button className="btn" disabled={!!reason} onClick={async () => {
        setMsg(null);
        const params = kind === "none" ? { kind } : kind === "colour" ? { kind, color: BACKDROP_COLOURS.find((c) => c.id === colour)!.rgb } : { kind, rel: pick!.path };
        const r = await write("background", "set_backdrop", params);
        if (r) setMsg(kind === "none" ? "Background taken away." : "Background set. Keyed clips now show it.");
      }}><Layers size={16} aria-hidden="true" />{kind === "none" ? "Take the background away" : "Set the background"}</button>
      {reason && <p className="why">{reason}</p>}
      {msg && <p className="muted" role="status">{msg}</p>}
    </Fold>
  );
}
