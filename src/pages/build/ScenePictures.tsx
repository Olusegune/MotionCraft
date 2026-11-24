import { useState } from "react";
import { Images } from "lucide-react";
import { useApp } from "../../ctx";
import { Fold } from "../../shell/Fold";
import { scenePictureItems } from "../../lib/makeIt";
import type { Write } from "./Panels";

/** Puts each scene's picture into the composition behind that scene, timed to it: the frames chosen in Treatment become what the viewer sees. */
export function ScenePictures({ write, disabled }: { write: Write; disabled: boolean }) {
  const { project } = useApp();
  const [msg, setMsg] = useState<string | null>(null);
  const items = scenePictureItems(project);
  const reason = disabled ? "Needs a connected engine and no EffectCraft window open." : !items.length ? "Choose a picture for a scene in Treatment first." : undefined;
  return (
    <Fold title="Scene pictures" meta={<span className="count">{items.length}</span>}>
      <p className="muted">Puts each scene's picture behind that scene, under the text and shapes. They are normal layers you can move, trim or remove.</p>
      <button className="btn" disabled={!!reason} onClick={async () => {
        setMsg(null);
        const r = await write("scene pictures", "place_pictures", { items: items.map(({ rel, t_in, t_out }) => ({ rel, t_in, t_out })) });
        if (r) setMsg(`${items.length} picture${items.length === 1 ? "" : "s"} placed.`);
      }}><Images size={16} aria-hidden="true" />Put pictures behind the scenes</button>
      {reason && <p className="why">{reason}</p>}
      {msg && <p className="muted" role="status">{msg}</p>}
    </Fold>
  );
}
