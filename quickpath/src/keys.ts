// Where a provider's key comes from, and where it is kept. Never sent to the page, never written to a file or a log, never sent anywhere but that provider.
//   1. an environment variable (KIE_API_KEY, OPENAI_API_KEY);
//   2. the key saved from QuickPath's Settings screen: Windows Credential Manager, entry "QuickPath/<provider>";
//   3. on Windows, the key the person already saved in MotionCraft ("<provider>-api-key.motioncraft"), the same computer and the same person.
// The names read and written are fixed here: nothing the page sends ever decides which entry is touched.
import { spawn } from "node:child_process";

export type Provider = "kie" | "openai" | "fal" | "elevenlabs" | "voicekiller";
export const PROVIDERS: Provider[] = ["kie", "openai", "elevenlabs", "voicekiller", "fal"];
export type KeySource = "env" | "saved" | "motioncraft" | null;

const ENV: Record<Provider, string> = { kie: "KIE_API_KEY", openai: "OPENAI_API_KEY", fal: "FAL_KEY", elevenlabs: "ELEVENLABS_API_KEY", voicekiller: "VOICEKILLER_API_KEY" };
const SAVED = (p: Provider) => `QuickPath/${p}`;
const MOTIONCRAFT: Record<Provider, string> = { kie: "kie-api-key.motioncraft", openai: "openai-api-key.motioncraft", fal: "fal-api-key.motioncraft", elevenlabs: "elevenlabs-api-key.motioncraft", voicekiller: "voicekiller-api-key.motioncraft" };

/** A place to keep secrets. Windows Credential Manager in the real app; a plain object in tests. */
export interface Store {
  get(target: string): Promise<string>;
  set(target: string, secret: string): Promise<void>;
  remove(target: string): Promise<boolean>;
}

export class MemoryStore implements Store {
  items = new Map<string, string>();
  async get(t: string) { return this.items.get(t) ?? ""; }
  async set(t: string, s: string) { this.items.set(t, s); }
  async remove(t: string) { return this.items.delete(t); }
}

// One small program does reading, writing and deleting. The secret to write arrives on standard input: never on the command line, where other programs could see it.
const SCRIPT = (op: "get" | "set" | "remove", target: string) => `
$src = @'
using System; using System.Runtime.InteropServices; using System.Text;
public class QpCred {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredRead(string t, int type, int f, out IntPtr p);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredWrite(ref C c, int f);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredDelete(string t, int type, int f);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr p);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct C { public int Flags; public int Type; public string TargetName; public string Comment; public long LastWritten; public int BlobSize; public IntPtr Blob; public int Persist; public int Attr; public IntPtr AttrPtr; public string Alias; public string User; }
  public static string Get(string t) {
    IntPtr p; if (!CredRead(t, 1, 0, out p)) return "";
    var c = (C)Marshal.PtrToStructure(p, typeof(C)); var b = new byte[c.BlobSize]; Marshal.Copy(c.Blob, b, 0, c.BlobSize); CredFree(p);
    var u16 = Encoding.Unicode.GetString(b); var u8 = Encoding.UTF8.GetString(b);
    return System.Text.RegularExpressions.Regex.IsMatch(u16, "^[\\\\x21-\\\\x7e]+$") ? u16 : u8;
  }
  public static bool Set(string t, string secret) {
    var b = Encoding.Unicode.GetBytes(secret); var h = Marshal.AllocHGlobal(b.Length); Marshal.Copy(b, 0, h, b.Length);
    try { var c = new C(); c.Type = 1; c.TargetName = t; c.Persist = 2; c.User = "QuickPath"; c.BlobSize = b.Length; c.Blob = h; return CredWrite(ref c, 0); }
    finally { Marshal.FreeHGlobal(h); }
  }
  public static bool Remove(string t) { return CredDelete(t, 1, 0); }
}
'@
Add-Type -TypeDefinition $src
${op === "get" ? `[Console]::Out.Write([QpCred]::Get('${target}'))`
  : op === "set" ? `$s = [Console]::In.ReadToEnd().Trim(); if ([QpCred]::Set('${target}', $s)) { [Console]::Out.Write('ok') }`
  : `if ([QpCred]::Remove('${target}')) { [Console]::Out.Write('ok') }`}
`;

const TARGET_OK = /^(?:QuickPath\/(?:kie|openai|fal|elevenlabs|voicekiller)|(?:kie|openai|fal|elevenlabs|voicekiller)-api-key\.motioncraft)$/;

function powershell(script: string, stdin?: string): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } resolve(""); }, 15_000);
    p.stdout.on("data", (d) => { if (out.length < 4096) out += d; });
    p.on("error", () => { clearTimeout(timer); resolve(""); });
    p.on("close", () => { clearTimeout(timer); resolve(out.trim()); });
    p.stdin.on("error", () => { /* closed early */ });
    p.stdin.end(stdin ?? "");
  });
}

export class WindowsStore implements Store {
  async get(target: string) { if (!TARGET_OK.test(target)) return ""; return powershell(SCRIPT("get", target)); }
  async set(target: string, secret: string) {
    if (!TARGET_OK.test(target) || !target.startsWith("QuickPath/")) throw new Error("That entry cannot be written.");   // only QuickPath's own entries are ever written
    if ((await powershell(SCRIPT("set", target), secret)) !== "ok") throw new Error("Windows did not save the key.");
  }
  async remove(target: string) { if (!TARGET_OK.test(target) || !target.startsWith("QuickPath/")) return false; return (await powershell(SCRIPT("remove", target))) === "ok"; }
}

let store: Store | null = process.platform === "win32" ? new WindowsStore() : null;
/** For tests (and other systems): replace the place keys are kept. */
export function setStore(s: Store | null) { store = s; cache.clear(); }
export const canSaveKeys = () => store !== null;

const cache = new Map<Provider, { key: string | null; source: KeySource }>();
// A key is letters, digits and a few marks. Voicekiller's is two parts, a User ID and a key, written USERID:APIKEY.
// fal keys are written id:secret, so a colon is part of a real fal key.
const plausibleFor = (p: Provider, k: string) => (p === "fal" ? /^[A-Za-z0-9_\-.]{4,100}:[A-Za-z0-9_\-.]{8,200}$|^[A-Za-z0-9_\-.]{16,200}$/ : p === "voicekiller" ? /^[A-Za-z0-9_\-.@+]{1,100}:[A-Za-z0-9_\-.]{8,200}$/ : /^[A-Za-z0-9_\-.]{16,200}$/).test(k);

async function look(p: Provider): Promise<{ key: string | null; source: KeySource }> {
  const hit = cache.get(p);
  if (hit) return hit;
  let found: { key: string | null; source: KeySource } = { key: null, source: null };
  const env = (process.env[ENV[p]] ?? "").trim();
  if (plausibleFor(p, env)) found = { key: env, source: "env" };
  else if (store) {
    const saved = (await store.get(SAVED(p))).trim();
    if (plausibleFor(p, saved)) found = { key: saved, source: "saved" };
    else if (process.platform === "win32" || store instanceof MemoryStore) {
      const other = (await store.get(MOTIONCRAFT[p])).trim();
      if (plausibleFor(p, other)) found = { key: other, source: "motioncraft" };
    }
  }
  cache.set(p, found);
  return found;
}

/** A provider's key, or null. Looked up once, until a key is saved or removed. */
export async function providerKey(p: Provider): Promise<string | null> { return (await look(p)).key; }
/** Whether a key exists and where it comes from. Never the key itself. */
export async function keyStatus(p: Provider): Promise<{ set: boolean; source: KeySource }> { const f = await look(p); return { set: f.key !== null, source: f.source }; }

/** Saves a key pasted into Settings. Surrounding spaces are trimmed; anything that cannot be a key is refused with a plain message. */
export async function saveKey(p: Provider, raw: string): Promise<void> {
  if (!PROVIDERS.includes(p)) throw new Error("Unknown provider.");
  if (!store) throw new Error("Saving keys from here works on Windows. On this system, set the " + ENV[p] + " setting instead.");
  const key = raw.trim();
  if (!plausibleFor(p, key)) throw new Error(p === "voicekiller" ? "That does not look right. Fill in both your Voicekiller User ID and your API key, exactly as they appear on your Voicekiller API page." : "That does not look like a key. Copy the whole key from your account page and paste it again.");
  await store.set(SAVED(p), key);
  cache.delete(p);
}

/** Removes the key saved from Settings. Keys set another way (a setting, or MotionCraft's own) are never touched. */
export async function removeKey(p: Provider): Promise<boolean> {
  if (!PROVIDERS.includes(p)) throw new Error("Unknown provider.");
  if (!store) return false;
  const gone = await store.remove(SAVED(p));
  cache.delete(p);
  return gone;
}

export const kieKey = () => providerKey("kie");
export const forgetKeys = () => cache.clear();
