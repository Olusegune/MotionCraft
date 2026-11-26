import { useState } from "react";
import { Sheet } from "./Sheet";

export const TOUR_STEPS: { title: string; body: string }[] = [
  { title: "Welcome to MotionCraft", body: "You bring a brief, script or music. MotionCraft turns it into an editable EffectCraft project, shows its reasoning, and asks before anything final or paid. This tour takes under a minute." },
  { title: "1. Write the brief, then press Make it", body: "Paste your brief on the Brief page. Make it drafts the intent, picks a look and plans each scene from your script. Nothing needs an AI account: you can fill every page in yourself." },
  { title: "2. Approve at each gate", body: "Direction, Treatment and Review each end with a sign-off (gates A to D). Approval is always your click. After you approve, MotionCraft takes you to the next page, and the Next line above the stage bar always says what to do." },
  { title: "3. Build, check, deliver", body: "Build lays out timed text, shapes and pictures. Review runs the quality checks and can fix the safe ones. Deliver renders the final video. Paid pictures and final renders always ask first, with the price." },
  { title: "You are ready", body: "Start a project now. You can replay this tour from the command palette (Ctrl+K) at any time." },
];

/** First-run tour: a short sequence of plain steps, skippable at any point, replayable from the palette. */
export function Tour({ onClose, onStart }: { onClose: () => void; onStart: () => void }) {
  const [i, setI] = useState(0);
  const last = i === TOUR_STEPS.length - 1;
  const step = TOUR_STEPS[i];
  return (
    <Sheet title={step.title} onClose={onClose}
      footer={<>
        <span className="muted" aria-live="polite" style={{ marginRight: "auto" }}>Step {i + 1} of {TOUR_STEPS.length}</span>
        {!last && <button className="btn quiet" onClick={onClose}>Skip tour</button>}
        {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Back</button>}
        {last ? <button className="btn primary" onClick={onStart}>Start my first project</button> : <button className="btn primary" onClick={() => setI(i + 1)}>Next</button>}
      </>}>
      <p>{step.body}</p>
    </Sheet>
  );
}
