import { useEffect, useMemo, useState } from "react";
import { AudioLines, Circle, FileMusic, Plus, Square, Wand2 } from "lucide-react";
import { useApp } from "../../ctx";
import { Fold } from "../../shell/Fold";
import { assetLabel, useImportMedia } from "../../shell/Media";
import { getApi } from "../../lib/api";
import { useSettings } from "../../lib/settings";
import type { EngineLayer, EngineSnapshot } from "../../lib/layers";
import { markerItems, clock, type LyricLine } from "../../lib/songmap";
import { SectionsBar, type SongSection } from "./SectionsBar";

export interface Prim {
  id: string; name: string; category: string; appliesTo: string[]; description: string; tags: string[];
  params: Record<string, { label: string; kind: "float" | "int" | "choice"; default: number | string; min: number | null; max: number | null; choices: string[]; unit: string }>;
}
export interface AudioInfo {
  duration: number; bpm: number | null; beats: number[]; downbeats: number[]; peaks: number[]; silences: number[][]; estimate: boolean;
  /** P3-01: structure and attacks estimated from the audio itself. Absent in answers from older helpers. */
  sections?: SongSection[]; transients?: { t: number; strength: number }[]; energyCurve?: number[][];
}
/** A Pulseframe SongMap, read and checked by the helper. */
export interface SongMapInfo { source: "pulseframe"; analyzer: string; duration: number; bpm: number | null; beats: number[]; downbeats: number[]; sections: SongSection[]; lyrics: LyricLine[]; lyricMatch: number | null; warnings: string[] }
export type Write = (label: string, method: string, params: Record<string, unknown>, targets?: number[]) => Promise<(EngineSnapshot & { layer?: number }) | undefined>;

const CATEGORY_LABEL: Record<string, string> = { entrance: "Entrances", exit: "Exits", emphasis: "Emphasis", motion: "Motion", text: "Text" };

/** More layers: shapes, solids and your own pictures, video and audio from the media wall. */
export function AddLayerPanel({ write, disabled, onAdded }: { write: Write; disabled: boolean; onAdded: (id?: number) => void }) {
  const { project } = useApp();
  const imp = useImportMedia();
  const [shape, setShape] = useState("rect");
  const [mediaId, setMediaId] = useState("");
  const [screen, setScreen] = useState("");
  const media = (project.assets ?? []).filter((a) => a.kind !== "audio");
  const pick = media.find((m) => m.id === mediaId) ?? media[0];
  return (
    <Fold title="Add layers" defaultOpen={false}>
      <div className="row-actions">
        <select aria-label="Shape" value={shape} onChange={(e) => setShape(e.target.value)}>
          {[["rect", "Rectangle"], ["rounded", "Rounded rectangle"], ["ellipse", "Ellipse"], ["star", "Star"], ["polygon", "Polygon"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="btn" disabled={disabled} onClick={async () => onAdded((await write("add shape", "add_shape", { kind: shape }))?.layer)}><Square size={16} aria-hidden="true" />Add shape</button>
      </div>
      <button className="btn" disabled={disabled} onClick={async () => onAdded((await write("add solid", "add_solid", { name: "Background" }))?.layer)}><Circle size={16} aria-hidden="true" />Add solid background</button>
      <label className="field"><span className="field-label">Picture or video from your media wall</span>
        <select value={pick?.id ?? ""} disabled={!media.length} onChange={(e) => setMediaId(e.target.value)}>
          {media.length === 0 ? <option value="">No media yet</option> : media.map((m) => <option key={m.id} value={m.id}>{assetLabel(m)} ({m.kind})</option>)}
        </select></label>
      <label className="field"><span className="field-label">Take out a flat screen (for green or blue screen footage)</span>
        <select value={screen} onChange={(e) => setScreen(e.target.value)}><option value="">Keep the picture as it is</option><option value="green">Remove green</option><option value="blue">Remove blue</option></select></label>
      <div className="row-actions">
        <button className="btn" disabled={disabled || !pick} onClick={async () => {
          if (!pick) return;
          const r = await write("add media", "add_media", { rel: pick.path });
          if (r?.layer !== undefined && screen) await write("key out", "key_out", { layers: [r.layer], colour: screen });
          onAdded(r?.layer);
        }}><Plus size={16} aria-hidden="true" />Add as layer</button>
        <button className="btn quiet" disabled={imp.busy} onClick={() => void imp.run()}>Import more…</button>
      </div>
      {imp.error && <p className="error-text" role="alert">{imp.error}</p>}
    </Fold>
  );
}

/** Tested motion building blocks. Apply one to the selected layer at the playhead; it writes real keyframes you can refine in EffectCraft. */
export function PrimitivesPanel({ write, selected, locked, playhead, disabled, onApplied }: {
  write: Write; selected: EngineLayer | null; locked: boolean; playhead: number; disabled: boolean; onApplied: () => void;
}) {
  const { enginePath } = useSettings();
  const { projectPath } = useApp();
  const [list, setList] = useState<Prim[]>([]);
  const [id, setId] = useState("entrance.fade-in");
  const [vals, setVals] = useState<Record<string, number | string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [useHead, setUseHead] = useState(true);

  useEffect(() => {
    let live = true;
    getApi().then((a) => a.engine<{ primitives: Prim[] }>("primitives", {}, projectPath, enginePath)).then((r) => { if (live) setList(r.primitives ?? []); }).catch((e) => { if (live) setErr(String(e instanceof Error ? e.message : e)); });
    return () => { live = false; };
  }, [projectPath, enginePath]);

  const prim = list.find((p) => p.id === id);
  useEffect(() => { if (prim) setVals(Object.fromEntries(Object.entries(prim.params).map(([k, v]) => [k, v.default]))); }, [id, prim?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => { const g: Record<string, Prim[]> = {}; for (const p of list) (g[p.category] ??= []).push(p); return g; }, [list]);
  const fits = !!prim && !!selected && (prim.appliesTo.includes("*") || prim.appliesTo.includes(selected.kind));
  const reason = disabled ? "Needs a connected engine." : !selected ? "Select a layer first." : locked ? "Approved. Unlock to edit; this creates a revision." : !prim ? "Choose a motion." : !fits ? `${prim.name} works on ${prim.appliesTo.join(", ")} layers.` : undefined;

  const apply = async () => {
    if (!prim || !selected) return;
    setErr(null);
    const params = { ...vals, ...(useHead && "start" in prim.params ? { start: Math.round(playhead * 1000) / 1000 } : {}) };
    const r = await write(`apply ${prim.name}`, "apply_primitive", { layer: selected.id, primitive: prim.id, params }, [selected.id]);
    if (r) onApplied();
  };

  return (
    <Fold title="Motion" defaultOpen={false} meta={<span className="count">{list.length}</span>}>
      <p className="muted">Ready-made motion, tested on the engine. Each writes ordinary keyframes; refine them in EffectCraft.</p>
      <label className="field"><span className="field-label">Motion</span>
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {Object.entries(groups).map(([cat, ps]) => <optgroup key={cat} label={CATEGORY_LABEL[cat] ?? cat}>{ps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
        </select></label>
      {prim && <p className="hint">{prim.description}</p>}
      {prim && Object.entries(prim.params).map(([k, spec]) => k === "start" ? (
        <div key={k} className="field"><span className="field-label">Start</span>
          <label className="check"><input type="checkbox" checked={useHead} onChange={(e) => setUseHead(e.target.checked)} />At the playhead ({playhead.toFixed(2)} s)</label>
          {!useHead && <input type="number" min={spec.min ?? 0} max={spec.max ?? 600} step={0.1} aria-label="Start (s)" value={Number(vals[k] ?? 0)} onChange={(e) => setVals((v) => ({ ...v, [k]: Number(e.target.value) }))} />}</div>
      ) : spec.kind === "choice" ? (
        <label key={k} className="field"><span className="field-label">{spec.label}</span><select value={String(vals[k] ?? spec.default)} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}>{spec.choices.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      ) : (
        <label key={k} className="field"><span className="field-label">{spec.label}</span>
          <input type="number" min={spec.min ?? undefined} max={spec.max ?? undefined} step={spec.max !== null && spec.max <= 10 ? 0.1 : 1} value={Number(vals[k] ?? spec.default)} onChange={(e) => setVals((v) => ({ ...v, [k]: Number(e.target.value) }))} />
          <span className="hint">{spec.min} to {spec.max} {spec.unit}</span></label>
      ))}
      <button className="btn primary" disabled={!!reason} onClick={() => void apply()}><Wand2 size={16} aria-hidden="true" />Apply to selected layer</button>
      {reason && <p className="why">{reason}</p>}
      {err && <p className="error-text" role="alert">{err}</p>}
    </Fold>
  );
}

/** Waveform, tempo and beats of a song from your media wall, with beat markers written into the composition. */
export function AudioPanel({ write, disabled, info, onInfo, onStructure, layers }: { write: Write; disabled: boolean; layers?: { id: number; name: string }[]; info: AudioInfo | null; onInfo: (a: AudioInfo | null) => void; onStructure?: (s: { sections: SongSection[]; downbeats: number[] } | null) => void }) {
  const { project, projectPath, update } = useApp();
  const { enginePath } = useSettings();
  const imp = useImportMedia();
  const tracks = (project.assets ?? []).filter((a) => a.kind === "audio");
  const [level, setLevel] = useState("-10");
  // The music layers: the project's sound files that are not voiceovers, found in the composition by file name.
  const musicLayers = (layers ?? []).filter((l) => tracks.some((t) => t.use !== "voiceover" && t.path.split("/").pop() === l.name));
  const [rel, setRel] = useState("");
  const [mode, setMode] = useState<"beats" | "downbeats">("beats");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [source, setSource] = useState("estimate");                       // "estimate" or the path of an imported SongMap
  const [maps, setMaps] = useState<Record<string, SongMapInfo>>({});
  const [withBeats, setWithBeats] = useState(true);
  const [withSections, setWithSections] = useState(true);
  const [withLyrics, setWithLyrics] = useState(false);
  const chosen = tracks.find((t) => t.path === rel) ?? tracks[0];
  const songmaps = project.songmaps ?? [];
  const sm = source !== "estimate" ? maps[source] : undefined;

  const loadMap = async (path: string) => {
    if (maps[path]) return;
    try { const m = await (await getApi()).engine<SongMapInfo>("songmap_import", { rel: path }, projectPath, enginePath); setMaps((x) => ({ ...x, [path]: m })); }
    catch (e) { setErr(String(e instanceof Error ? e.message : e)); setSource("estimate"); }
  };
  useEffect(() => { if (source !== "estimate") void loadMap(source); }, [source]);   // eslint-disable-line react-hooks/exhaustive-deps

  // The analysis is kept inside the project. When the track is chosen and nothing is showing, bring back what was kept (it never re-analyses).
  useEffect(() => {
    if (!chosen || info || disabled) return;
    let live = true;
    (async () => { try { const a = await (await getApi()).engine<AudioInfo | null>("audio_cached", { rel: chosen.path }, projectPath, enginePath); if (live && a && Array.isArray(a.beats) && Array.isArray(a.peaks)) { onInfo(a); return; } } catch { /* older helper or no project open: nothing to restore */ }
      // Nothing kept yet: look at the sound now, so the waveform and beats are there without a button press (it is local and quick).
      try { const fresh = await (await getApi()).engine<AudioInfo>("audio_analyze", { rel: chosen.path }, projectPath, enginePath); if (live) onInfo(fresh); } catch { /* the Analyse button still reports why */ } })();
    return () => { live = false; };
  }, [chosen?.path, projectPath, disabled]);   // eslint-disable-line react-hooks/exhaustive-deps  (asked again once the composition is open: it is not open yet when the page first draws)

  const analyze = async () => {
    if (!chosen) return;
    setBusy(true); setErr(null); setMsg(null);
    try { onInfo(await (await getApi()).engine<AudioInfo>("audio_analyze", { rel: chosen.path }, projectPath, enginePath)); }
    catch (e) { setErr(String(e instanceof Error ? e.message : e)); onInfo(null); }
    setBusy(false);
  };
  const importMap = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const api = await getApi();
      const src = await api.pickSongMap();
      if (!src) { setBusy(false); return; }
      const r = await api.importSongMap(projectPath, src);
      const m = await api.engine<SongMapInfo>("songmap_import", { rel: r.path }, projectPath, enginePath);
      setMaps((x) => ({ ...x, [r.path]: m }));
      update((p) => ({ ...p, songmaps: [...(p.songmaps ?? []), { id: r.path, path: r.path, name: r.name, at: new Date().toISOString() }], updatedAt: new Date().toISOString() }));
      setSource(r.path);
      setWithLyrics(m.lyrics.length > 0);
      setMsg(`SongMap ${r.name} read: ${m.sections.length} sections${m.lyrics.length ? `, ${m.lyrics.length} lyric lines` : ""}.${m.warnings.length ? ` ${m.warnings.length} things were dropped or changed.` : ""}`);
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    setBusy(false);
  };

  const beats = sm ? (mode === "beats" ? sm.beats : sm.downbeats) : info ? (mode === "beats" ? info.beats : info.downbeats) : [];
  const sections = (sm ? sm.sections : info?.sections) ?? [];
  const lyrics = sm?.lyrics ?? [];
  const duration = sm?.duration ?? info?.duration ?? 0;
  const items = markerItems({ beats: withBeats ? beats : [], sections: withSections ? sections : [], lyrics: withLyrics ? lyrics : [] });
  const plainBeats = withBeats && !(withSections && sections.length) && !(withLyrics && lyrics.length);   // the original beats-only write

  // the timeline shows whichever structure is chosen here
  useEffect(() => { onStructure?.(sections.length || beats.length ? { sections, downbeats: sm ? sm.downbeats : info?.downbeats ?? [] } : null); }, [source, info, sm]);   // eslint-disable-line react-hooks/exhaustive-deps

  const writeMarkers = async () => {
    setErr(null); setMsg(null);
    const r = plainBeats ? await write("sync markers", "sync_markers", { times: beats, replace: true })
      : await write("sync markers", "sync_labelled_markers", { items, replace: true });
    if (r) setMsg(`${plainBeats ? beats.length : items.length} markers written. This replaced the composition's other markers.`);
  };

  return (
    <Fold title="Audio" defaultOpen={false} meta={sections.length ? <span className="count">{sections.length} sections</span> : info?.bpm ? <span className="count">{info.bpm} BPM</span> : undefined}>
      <p className="muted">Waveform, tempo, beat grid and song structure are estimates from the audio itself. WAV works directly; other formats need ffmpeg. For real music, a SongMap from Pulseframe is more accurate.</p>
      <label className="field"><span className="field-label">Song or narration</span>
        <select value={chosen?.path ?? ""} disabled={!tracks.length} onChange={(e) => { setRel(e.target.value); onInfo(null); }}>
          {tracks.length === 0 ? <option value="">No audio yet</option> : tracks.map((t) => <option key={t.id} value={t.path}>{assetLabel(t)}</option>)}</select></label>
      <div className="row-actions">
        <button className="btn" disabled={imp.busy} onClick={() => void imp.run()}>Import audio…</button>
        <button className="btn" disabled={!chosen || busy} onClick={() => void analyze()}><AudioLines size={16} aria-hidden="true" />Analyse</button>
        <button className="btn" disabled={busy} onClick={() => void importMap()}><FileMusic size={16} aria-hidden="true" />Import SongMap…</button>
      </div>
      {(songmaps.length > 0 || info) && (
        <label className="field"><span className="field-label">Structure from</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="estimate">Estimate from the audio{info?.sections?.length ? "" : " (analyse first)"}</option>
            {songmaps.map((m) => <option key={m.id} value={m.path}>Pulseframe SongMap: {m.name}</option>)}</select></label>
      )}
      {info && !sm && <p role="status">{info.bpm ? <><strong>{info.bpm} BPM</strong> (estimate) · {info.beats.length} beats · {info.duration.toFixed(1)} s</> : <>No steady beat found · {info.duration.toFixed(1)} s</>}{info.silences.length ? ` · ${info.silences.length} silent gaps` : ""}{info.transients?.length ? ` · ${info.transients.length} sharp attacks` : ""}</p>}
      {sm && <p role="status"><strong>{sm.bpm ?? "?"} BPM</strong> · {sm.beats.length} beats · {clock(sm.duration)} · {sm.analyzer || "Pulseframe"}{sm.lyricMatch !== null ? ` · ${Math.round(sm.lyricMatch * 100)}% of the lyric words heard` : ""}</p>}
      {sections.length > 0 && (
        <section aria-label="Song structure">
          <SectionsBar sections={sections} duration={duration} />
          <ul className="plain">{sections.map((s, i) => <li key={i}><span className="mono">{clock(s.start)}</span> <strong>{s.label}</strong> <span className="muted">{s.group} · energy {s.energy} of 10 · {s.mood}</span></li>)}</ul>
          {!sm && <p className="hint">Estimated from loudness and how busy and bright each bar is. Quiet changes can be missed, and a short bridge may be called a pre-chorus.</p>}
        </section>
      )}
      {info && !sm && !info.sections?.length && info.duration >= 20 && info.bpm !== null && <p className="muted">No clear sections found. Import a SongMap from Pulseframe for this song.</p>}
      {(beats.length > 0 || sections.length > 0 || lyrics.length > 0) && (
        <>
          <fieldset className="grp"><legend className="field-label">Markers to write</legend>
            <label className="check"><input type="checkbox" checked={withBeats} disabled={!beats.length} onChange={(e) => setWithBeats(e.target.checked)} /> Beats
              <select aria-label="Which beats" value={mode} disabled={!withBeats} onChange={(e) => setMode(e.target.value as "beats" | "downbeats")}><option value="beats">Every beat ({sm ? sm.beats.length : info?.beats.length ?? 0})</option><option value="downbeats">Downbeats only ({sm ? sm.downbeats.length : info?.downbeats.length ?? 0})</option></select></label>
            <label className="check"><input type="checkbox" checked={withSections} disabled={!sections.length} onChange={(e) => setWithSections(e.target.checked)} /> Section starts ({sections.length})</label>
            <label className="check"><input type="checkbox" checked={withLyrics} disabled={!lyrics.length} onChange={(e) => setWithLyrics(e.target.checked)} /> Lyric lines ({lyrics.length})</label>
          </fieldset>
          <button className="btn" disabled={disabled || busy || !items.length} onClick={() => void writeMarkers()}>Write markers to composition</button>
        </>
      )}
      <button className="btn" disabled={disabled || !chosen || busy} onClick={async () => { if (chosen) { const r = await write("add audio", "add_media", { rel: chosen.path }); if (r) setMsg("Audio added to the composition, so renders include it."); } }}>Add audio to composition</button>
      <div className="row-actions">
        <label className="field"><span className="field-label">Music level</span>
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="0">Full (0 dB)</option><option value="-6">A little lower (-6 dB)</option><option value="-10">Under a voiceover (-10 dB)</option><option value="-16">Quiet bed (-16 dB)</option></select></label>
        <button className="btn" disabled={disabled || !musicLayers.length} title={musicLayers.length ? undefined : "Add the music to the composition first."}
          onClick={async () => { const r = await write("music level", "set_audio_level", { layers: musicLayers.map((l) => l.id), db: Number(level) }); if (r) setMsg(`Music set to ${level} dB.`); }}>Set music level</button>
      </div>
      {msg && <p className="muted" role="status">{msg}</p>}
      {err && <p className="error-text" role="alert">{err}</p>}
    </Fold>
  );
}
