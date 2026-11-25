import { useState } from "react";
import { Images } from "lucide-react";
import { useApp } from "../../ctx";
import { Fold } from "../../shell/Fold";
import { scenePictureItems } from "../../lib/makeIt";
import { voiceItems } from "../../lib/voice";
import type { Write } from "./Panels";

/** Puts each scene's picture into the composition behind that scene, timed to it: the frames chosen in Treatment become what the viewer sees. */
export function ScenePictures({ write, disabled }: { write: Write; disabled: boolean }) {
  const { project, update } = useApp();
  const [msg, setMsg] = useState<string | null>(null);
  const items = scenePictureItems(project);
  const vo = voiceItems(project);
  const reason = disabled ? "Needs a connected engine and no EffectCraft window open." : !items.length && !vo.length ? "Choose a picture or make a voiceover for a scene in Treatment first." : undefined;
  return (
    <Fold title="Scene pictures" meta={<span className="count">{items.length}</span>}>
      <p className="muted">Puts each scene's picture behind that scene, under the text and shapes. They are normal layers you can move, trim or remove.</p>
      <button className="btn" disabled={!!reason} onClick={async () => {
        setMsg(null);
        const r = !items.length ? null : await write("scene pictures", "place_pictures", { items: items.map(({ rel, t_in, t_out, loop }) => ({ rel, t_in, t_out, ...(loop ? { loop } : {}) })) });
        const v = vo.length ? await write("voiceovers", "place_audio", { items: vo.map(({ rel, t_in }) => ({ rel, t_in })) }) : null;
        if (v) update((p) => ({ ...p, treatment: Object.fromEntries(Object.entries(p.treatment).map(([k, t]) => [k, t.voice?.assetId && vo.some((x) => x.beatId === k) ? { ...t, voice: { ...t.voice, placed: true } } : t])) }));
        if (r || v) setMsg(`${r ? `${items.length} picture${items.length === 1 ? "" : "s"}` : ""}${r && v ? " and " : ""}${v ? `${vo.length} voiceover${vo.length === 1 ? "" : "s"}` : ""} placed.`);
      }}><Images size={16} aria-hidden="true" />Put pictures and voiceovers in place</button>
      {reason && <p className="why">{reason}</p>}
      {msg && <p className="muted" role="status">{msg}</p>}
    </Fold>
  );
}
