import { getApi, type Api } from "./api";
import type { MotionProject } from "../types";

/**
 * The composition has to be open in the engine before it can be inspected, versioned or rendered. This is the same call the Build page
 * makes, shared so that Review and Deliver do not depend on having visited Build first in this session.
 */
export async function openComposition(project: MotionProject, projectPath: string, enginePath: string): Promise<Api> {
  const api = await getApi();
  const d = project.brief.deliverables[0];
  const locked = (project.layerMap ?? []).filter((b) => b.lock === "approved").map((b) => b.engineLayerId);
  await api.engine("open", { settings: { name: "Main", width: d.width, height: d.height, frame_rate: d.fps, duration: d.durationSec }, locked }, projectPath, enginePath);
  return api;
}
