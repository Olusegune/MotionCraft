import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { createProject } from "../lib/project";
import { updateSettings } from "../lib/settings";
import { audioToAdd } from "../lib/makeIt";
import { defaultVoice, deliveryFor, voiceChoices, voiceItems, voiceLineFor, type VoiceModel } from "../lib/voice";
import type { Beat, MotionProject } from "../types";

const beat: Beat = { beatId: "a", startSec: 8, endSec: 18, primary: "wonder", secondary: "awe", intensity: 4, energy: 2 };
const prov = { actor: "user" as const, provider: "import", model: "file", at: "t", licence: "own", costReported: false, costValue: null, costUnit: null };
const MODELS: VoiceModel[] = [
  { provider: "openai", model: "tts-1-hd", name: "TTS HD", voices: ["alloy", "nova"], instructions: false },
  { provider: "openai", model: "gpt-4o-mini-tts", name: "GPT-4o mini TTS (steerable)", voices: ["alloy", "coral", "nova"], instructions: true },
  { provider: "google", model: "gemini-2.5-flash-preview-tts", name: "Gemini TTS", voices: ["Kore", "Puck"], instructions: true },
];
const SCRIPT = "| Time | Shot | What we see | Voiceover |\n|---|---|---|---|\n| 00:00–00:08 | Opening | A window | “It starts with a light coming on.” |\n| 00:08–00:18 | Type I | A technician | “At Type One, a civilization harnesses energy on the scale of a planet.” |\n";

function project(): MotionProject {
  const p = createProject("Voice demo");
  p.brief.text = SCRIPT;
  p.brief.deliverables[0].durationSec = 30;
  p.intent.arc = [beat];
  p.assets = [{ id: "i1", kind: "image", path: "assets/images/a.png", name: "T", provenance: prov }, { id: "score", kind: "audio", path: "assets/audio/score.wav", name: "Score", provenance: prov }];
  p.treatment = { a: { plan: "A technician.", motion: "", frameAssetId: "i1" } };
  return p;
}

describe("the line, the delivery and the placement", () => {
  it("takes the scene's line from the script's voiceover column, without its quotation marks", () => {
    expect(voiceLineFor(project(), beat)).toBe("At Type One, a civilization harnesses energy on the scale of a planet.");
    expect(voiceLineFor(project(), { startSec: 0, endSec: 8 })).toBe("It starts with a light coming on.");
    expect(voiceLineFor(createProject("x"), beat)).toBe("");
  });
  it("writes the delivery from the scene's feeling, strength and energy", () => {
    expect(deliveryFor(beat)).toBe("Narrate with wonder and awe (strong), at a slow, unhurried pace. Natural and human, not theatrical. Leave small pauses at commas and full stops.");
    expect(deliveryFor({ primary: "", intensity: 2, energy: 5 })).toContain("quiet attention (subtle), at a fast, driving pace");
  });
  it("offers voice models that have a key, steerable ones first", () => {
    expect(voiceChoices(MODELS, { openai: true, google: true }).map((m) => m.model)).toEqual(["gemini-2.5-flash-preview-tts", "gpt-4o-mini-tts", "tts-1-hd"]);
    expect(voiceChoices(MODELS, { google: true }).map((m) => m.model)).toEqual(["gemini-2.5-flash-preview-tts"]);
    expect(voiceChoices(MODELS, {})).toEqual([]);
  });
  it("places a voiceover at its scene's start, once, and never treats it as the score", () => {
    const p = project();
    p.assets!.push({ id: "vo1", kind: "audio", path: "assets/audio/vo-1.wav", name: "VO", use: "voiceover", provenance: prov });
    p.treatment.a.voice = { ...defaultVoice(p, beat, []), model: "openai/gpt-4o-mini-tts", voice: "coral", assetId: "vo1", placed: false };
    expect(voiceItems(p)).toEqual([{ rel: "assets/audio/vo-1.wav", t_in: 8, beatId: "a" }]);
    p.treatment.a.voice!.placed = true;
    expect(voiceItems(p)).toEqual([]);
    expect(audioToAdd(p, [])).toEqual(["assets/audio/score.wav"]);        // the score goes in at zero; the voiceover does not
  });
});

describe("the Voiceover sheet on a scene", () => {
  it("is filled from the script and the scene, asks for confirmation, sends the line with its delivery, and keeps the file as the scene's voiceover", async () => {
    updateSettings({ generative: true });
    const user = userEvent.setup();
    const p = project();
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const saved: MotionProject[] = [];
    const spends: string[] = [];
    const api = {
      async list() { return [{ id: p.id, name: p.name, path: "mem:1", updatedAt: p.updatedAt }]; },
      async load() { return JSON.parse(JSON.stringify(p)); },
      async save(_x: string, proj: MotionProject) { saved.push(JSON.parse(JSON.stringify(proj))); },
      async engineStatus() { return { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" }; },
      async effectcraftWindowOpen() { return false; },
      async keyStatus() { return { byteplus: false, google: false, openai: true, kie: false, fal: false, anthropic: false, openrouter: false }; },
      async onMenu() { return () => undefined; },
      async appReady() { /* unused */ }, async startupStep() { /* unused */ }, async uncleanSession() { return null; }, async sessionBegin() { /* unused */ }, async sessionEnd() { /* unused */ },
      async assetDataUrl() { return "data:image/png;base64,AAAA"; },
      async fileUrl() { return "asset://localhost/vo.wav"; },
      async confirmSpend(provider: string, model: string) { spends.push(`${provider}/${model}`); return "tok"; },
      async engine(method: string, params: Record<string, unknown>) {
        calls.push({ method, params });
        if (method === "speech_models") return { models: MODELS } as never;
        if (method === "speech_generate") return { path: "assets/audio/vo-9.wav", bytes: 100, voice: "coral", provenance: { ...prov, provider: "openai", model: "gpt-4o-mini-tts" } } as never;
        if (method === "llm_status") return { ready: false, reason: "none", config: { provider: null, model: "" }, providers: [] } as never;
        return { path: "x", dirty: false, activeComp: 1, comps: [], layers: [] } as never;
      },
    };
    setApiForTests(api as unknown as Api);
    render(<App />);
    await user.click(await screen.findByText("Voice demo"));
    await screen.findByRole("heading", { name: "Brief" });
    const bar = screen.getByRole("navigation", { name: "Stages" });
    await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Treatment") as HTMLElement);
    await user.click(await screen.findByRole("button", { name: /Voiceover…/ }));
    const sheet = await screen.findByRole("dialog", { name: /Voiceover: wonder/ });
    await waitFor(() => expect((within(sheet).getByLabelText(/The line to speak/) as HTMLTextAreaElement).value).toBe("At Type One, a civilization harnesses energy on the scale of a planet."));
    const delivery = within(sheet).getByLabelText(/How to say it/) as HTMLTextAreaElement;
    expect(delivery.value).toContain("Narrate with wonder and awe (strong)");
    expect(within(sheet).getByRole("option", { name: /GPT-4o mini TTS \(steerable\) \(OpenAI, official\)/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole("option", { name: /Kie|fal/ })).toBeNull();                              // official providers only
    await user.selectOptions(within(sheet).getByLabelText("Voice"), "coral");
    expect(calls.some((c) => c.method === "speech_generate")).toBe(false);                                   // nothing before the confirmation
    await user.click(within(sheet).getByRole("button", { name: "Confirm and make the voice" }));
    await waitFor(() => expect(calls.some((c) => c.method === "speech_generate")).toBe(true));
    const g = calls.find((c) => c.method === "speech_generate")!.params as Record<string, unknown>;
    expect(spends).toEqual(["openai/gpt-4o-mini-tts"]);
    expect(g).toMatchObject({ provider: "openai", model: "gpt-4o-mini-tts", voice: "coral", spend_token: "tok", text: "At Type One, a civilization harnesses energy on the scale of a planet.", speed: 1 });
    expect(String(g.instructions)).toContain("Narrate with wonder and awe");
    await waitFor(() => expect(saved.some((x) => x.treatment.a.voice?.assetId)).toBe(true), { timeout: 4000 });
    const last = saved[saved.length - 1];
    expect(last.treatment.a.voice).toMatchObject({ model: "openai/gpt-4o-mini-tts", voice: "coral", placed: false });
    expect(last.assets!.find((a) => a.use === "voiceover")).toMatchObject({ kind: "audio", path: "assets/audio/vo-9.wav" });
    expect(last.budget.ledger).toEqual([expect.objectContaining({ provider: "openai", what: "voiceover", usd: null })]);
    expect(await screen.findByLabelText("Voiceover for wonder")).toBeInTheDocument();                         // a player, to listen before it goes in the film
  }, 20000);
});
