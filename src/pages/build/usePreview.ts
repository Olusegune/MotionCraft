import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../ctx";
import { getApi } from "../../lib/api";
import { useSettings } from "../../lib/settings";


export interface RenderJob { id: string; kind: "preview" | "final"; state: "running" | "done" | "failed"; detail: string; output: string | null; frames: number | null; bytes: number | null; error: string | null; elapsed: number; preset: string | null }
export type PreviewState = { state: "idle" } | { state: "rendering"; since: number } | { state: "error"; message: string };

/** The draft preview movie of the composition: render it on its own engine process, then play it. */
export function usePreviewMovie() {
  const { project, projectPath, update } = useApp();
  const { enginePath } = useSettings();
  const [status, setStatus] = useState<PreviewState>({ state: "idle" });
  const [url, setUrl] = useState<string | null>(null);
  const rel = project.review.preview?.rel;

  useEffect(() => {
    let live = true;
    if (!rel) { setUrl(null); return; }
    getApi().then((a) => a.fileUrl(projectPath, rel)).then((u) => { if (live) setUrl(u); }).catch(() => { if (live) setUrl(null); });
    return () => { live = false; };
  }, [rel, projectPath]);

  const start = useCallback(async () => {
    const t0 = Date.now();
    setStatus({ state: "rendering", since: t0 });
    try {
      const api = await getApi();
      let job = await api.engine<RenderJob>("preview_movie_start", {}, projectPath, enginePath);
      while (job.state === "running") {
        await new Promise((r) => setTimeout(r, 700));
        job = await api.engine<RenderJob>("render_poll", { job: job.id }, projectPath, enginePath);
      }
      if (job.state === "failed" || !job.output) throw new Error(job.error ?? "The preview could not be rendered.");
      const out = job.output;
      // Keep updatedAt as it is: this is not an edit, and the preview must not look out of date the moment it is made.
      update((p) => ({ ...p, review: { ...p.review, preview: { rel: out, at: new Date(t0).toISOString() } }, updatedAt: p.updatedAt }));
      setStatus({ state: "idle" });
    } catch (e) { setStatus({ state: "error", message: String(e instanceof Error ? e.message : e) }); }
  }, [projectPath, enginePath, update]);

  const stale = !!project.review.preview && project.updatedAt > project.review.preview.at;
  return { url, status, start, stale, hasPreview: !!rel };
}
