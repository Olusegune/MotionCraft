// Where a provider's key comes from. Never from the page, never written to disk or a log, never sent anywhere but that provider.
//   1. an environment variable (KIE_API_KEY, OPENAI_API_KEY);
//   2. Windows Credential Manager, entry "QuickPath/<provider>";
//   3. on Windows, the key the person already saved in MotionCraft ("<provider>-api-key.motioncraft"), the same computer and the same person.
// The names read are fixed here: nothing the page sends ever decides which entry is read.
import { execFile } from "node:child_process";

export type Provider = "kie" | "openai";
const ENV: Record<Provider, string> = { kie: "KIE_API_KEY", openai: "OPENAI_API_KEY" };
const TARGETS: Record<Provider, string[]> = { kie: ["QuickPath/kie", "kie-api-key.motioncraft"], openai: ["QuickPath/openai", "openai-api-key.motioncraft"] };
const cache = new Map<Provider, string | null>();

const SCRIPT = (target: string) => `
$src = @'
using System; using System.Runtime.InteropServices; using System.Text;
public class QpCred {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredRead(string t, int type, int f, out IntPtr p);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr p);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct C { public int Flags; public int Type; public string TargetName; public string Comment; public long LastWritten; public int BlobSize; public IntPtr Blob; public int Persist; public int Attr; public IntPtr AttrPtr; public string Alias; public string User; }
  public static string Get(string t) {
    IntPtr p; if (!CredRead(t, 1, 0, out p)) return "";
    var c = (C)Marshal.PtrToStructure(p, typeof(C)); var b = new byte[c.BlobSize]; Marshal.Copy(c.Blob, b, 0, c.BlobSize); CredFree(p);
    var u16 = Encoding.Unicode.GetString(b); var u8 = Encoding.UTF8.GetString(b);
    return System.Text.RegularExpressions.Regex.IsMatch(u16, "^[\\\\x21-\\\\x7e]+$") ? u16 : u8;
  }
}
'@
Add-Type -TypeDefinition $src
[Console]::Out.Write([QpCred]::Get('${target}'))
`;

function readCredential(target: string): Promise<string> {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SCRIPT(target)], { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 }, (err, stdout) => resolve(err ? "" : String(stdout).trim()));
  });
}

const plausible = (k: string) => /^[A-Za-z0-9_\-.]{16,200}$/.test(k);

/** A provider's key, or null. Looked up once per run. */
export async function providerKey(p: Provider): Promise<string | null> {
  if (cache.has(p)) return cache.get(p) ?? null;
  const env = (process.env[ENV[p]] ?? "").trim();
  if (plausible(env)) { cache.set(p, env); return env; }
  if (process.platform === "win32") {
    for (const t of TARGETS[p]) {
      const k = await readCredential(t);
      if (plausible(k)) { cache.set(p, k); return k; }
    }
  }
  cache.set(p, null);
  return null;
}

export const kieKey = () => providerKey("kie");
export const forgetKeys = () => cache.clear();
