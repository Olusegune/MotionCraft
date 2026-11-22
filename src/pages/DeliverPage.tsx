import { useState } from "react";
import { Film, FolderArchive, Layers } from "lucide-react";
import { useApp } from "../ctx";
import { PageFrame } from "../shell/PageFrame";
import { Sheet } from "../shell/Sheet";
import { gateState } from "../lib/project";
import type { FrameProps } from "./common";

const OUTPUTS = [
  { icon: Film, title: "Rendered video", detail: "H.264", note: "A finished video file." },
  { icon: Layers, title: "Graphics with transparency", detail: "ProRes 4444 with alpha", note: "For compositing over other footage." },
  { icon: FolderArchive, title: "Collected editable project", detail: ".motioncraft package", note: "The .ecproj, assets and font manifest, relative paths only." },
];

export function DeliverPage(f: FrameProps) {
  const { project, engine } = useApp();
  const [sheet, setSheet] = useState(false);
  const d = project.brief.deliverables[0];
  const signed = gateState(project, "D") === "approved";
  const reason = !signed ? "Approve for final render in Review first (Gate D)." : engine?.state !== "connected" ? "Needs a connected EffectCraft engine." : "Rendering needs a spend confirmation. Wired in tickets P1-04 and P5-01.";
  const main = (
    <div className="stack">
      <ul className="outputs">{OUTPUTS.map((o) => (
        <li key={o.title} className="output-card"><o.icon size={20} strokeWidth={1.75} aria-hidden="true" />
          <div><h2>{o.title}</h2><p className="strong">{o.detail}</p><p className="muted">{o.note}</p></div><span className="pill">Not rendered</span></li>))}</ul>
      <section aria-labelledby="queue-h"><h2 id="queue-h">Render queue</h2><p className="empty-note">Empty. Nothing is queued, and nothing renders without your confirmation.</p></section>
      {sheet && (
        <Sheet title="Final render" onClose={() => setSheet(false)} footer={<button className="btn" onClick={() => setSheet(false)}>Close</button>}>
          <dl className="facts"><dt>Output</dt><dd>H.264 at {d.width} × {d.height}, {d.fps} fps, {d.durationSec} s</dd><dt>Sign-off</dt><dd>{signed ? "Recorded in Review" : "Not given"}</dd><dt>Estimated cost</dt><dd>Unknown</dd><dt>Scaling</dt><dd>Rendered at target resolution, no upscaling</dd></dl>
          <p className="why">{reason}</p>
        </Sheet>)}
    </div>
  );
  return (
    <PageFrame {...f} title="Deliver" intro="Three different outputs. Only what the connected engine supports is offered." main={main}
      action={{ label: "Render final…", onClick: () => setSheet(true), secondary: { label: "Export selected", onClick: () => undefined, disabledReason: "Needs a rendered output or a built composition." } }} />
  );
}
