import { useEffect, useMemo, useState } from "react";
import { useApp } from "../ctx";
import { getApi } from "../lib/api";
import { useSettings } from "../lib/settings";
import { FONT_MOODS, pickFonts, projectFonts, suggestMood, type FontChoice } from "../lib/fonts";

/** What EffectCraft can use on this computer, read once when the picker opens. null: not read (no engine yet); the picks are then unchecked. */
export function useInstalledFonts(): { fonts: Set<string> | null; origins: Record<string, string>; error: string | null } {
  const { project, projectPath } = useApp();
  const { enginePath } = useSettings();
  const [st, setSt] = useState<{ fonts: Set<string> | null; origins: Record<string, string>; error: string | null }>({ fonts: null, origins: {}, error: null });
  const d = project.brief.deliverables[0];
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const api = await getApi();
        await api.engine("open", { settings: { name: "Main", width: d.width, height: d.height, frame_rate: d.fps, duration: d.durationSec } }, projectPath, enginePath);
        const r = await api.engine<{ families: { family: string; origin: string }[] }>("fonts_available", {}, projectPath, enginePath);
        if (live) setSt({ fonts: new Set(r.families.map((f) => f.family)), origins: Object.fromEntries(r.families.map((f) => [f.family, f.origin])), error: null });
      } catch (e) { if (live) setSt({ fonts: null, origins: {}, error: String(e instanceof Error ? e.message : e) }); }
    })();
    return () => { live = false; };
  }, [projectPath, enginePath, d.width, d.height, d.fps, d.durationSec]);
  return st;
}

/** The type for the project: a mood (sleek futuristic, cinematic, editorial...), the display and body fonts it picks from what is installed, and a hand override. */
export function FontPicker({ locked }: { locked?: boolean }) {
  const { project, update } = useApp();
  const { fonts, origins, error } = useInstalledFonts();
  const current: FontChoice = projectFonts(project, fonts);
  const suggested = suggestMood(project);
  const list = useMemo(() => (fonts ? [...fonts].sort((a, b) => a.localeCompare(b)) : []), [fonts]);
  const set = (c: FontChoice) => update((p) => ({ ...p, style: { ...p.style, fonts: c }, updatedAt: new Date().toISOString() }));
  const note = (f: string) => !fonts ? "not checked" : fonts.has(f) ? (origins[f] === "bundled" ? "comes with EffectCraft" : "installed") : "not installed";

  return (
    <section aria-labelledby="fonts-h">
      <h2 id="fonts-h">Fonts</h2>
      <p className="muted">Pick a mood for the lettering and MotionCraft chooses the best typefaces for it that EffectCraft can really use on this computer. Titles and labels use the display font; tags and small text use the body font.</p>
      <div className="font-moods" role="group" aria-label="Font mood">
        {FONT_MOODS.map((m) => {
          const pick = pickFonts(m.id, fonts);
          const on = current.mood === m.id;
          return (
            <button key={m.id} type="button" className={`font-mood${on ? " on" : ""}`} aria-pressed={on} disabled={locked} onClick={() => set(pickFonts(m.id, fonts))}
              title={`${m.blurb} Uses ${pick.display} for titles and ${pick.body} for small text.`}>
              <span className="font-sample" style={{ fontFamily: `"${pick.display}", sans-serif` }}>{m.sample}</span>
              <span className="font-mood-name">{m.label}{m.id === suggested ? " · suits this project" : ""}</span>
              <span className="muted">{pick.display}{pick.body !== pick.display ? ` + ${pick.body}` : ""}</span>
            </button>
          );
        })}
      </div>
      <div className="row-actions">
        <label className="field"><span className="field-label">Display font (titles and labels): {note(current.display)}</span>
          <input list="mc-fonts" value={current.display} disabled={locked} onChange={(e) => set({ ...current, display: e.target.value })} /></label>
        <label className="field"><span className="field-label">Body font (tags and small text): {note(current.body)}</span>
          <input list="mc-fonts" value={current.body} disabled={locked} onChange={(e) => set({ ...current, body: e.target.value })} /></label>
        <datalist id="mc-fonts">{list.map((f) => <option key={f} value={f} />)}</datalist>
      </div>
      {!project.style.fonts && <p className="muted">Not chosen yet: the Builder will use {current.display}{current.body !== current.display ? ` and ${current.body}` : ""}, the best for a {FONT_MOODS.find((m) => m.id === current.mood)?.label.toLowerCase()} piece.</p>}
      {error && <p className="muted" role="status">The installed fonts could not be read ({error}). The choices above are not checked against this computer.</p>}
      {fonts && [current.display, current.body].some((f) => !fonts.has(f)) && <p className="why" role="alert">A chosen font is not installed on this computer. EffectCraft would draw that text in a substitute. Choose another or install it.</p>}
    </section>
  );
}
