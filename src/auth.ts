import fs from "fs-extra";
import os from "node:os";
import path from "node:path";

/** Env var the key is read from when lumioui.json doesn't name another. */
export const DEFAULT_KEY_ENV = "LUMIO_LICENSE_KEY";

/** Where `lumioui login` keeps the key: one file per user, readable only by
 *  them. XDG_CONFIG_HOME / APPDATA are honoured. */
export function credentialsPath(): string {
  const base =
    process.env.XDG_CONFIG_HOME ||
    (process.platform === "win32" ? process.env.APPDATA : undefined) ||
    path.join(os.homedir(), ".config");
  return path.join(base!, "lumioui", "credentials.json");
}

export async function readStoredKey(): Promise<string | undefined> {
  try {
    const data = (await fs.readJson(credentialsPath())) as { licenseKey?: unknown };
    return typeof data.licenseKey === "string" && data.licenseKey ? data.licenseKey : undefined;
  } catch {
    return undefined;
  }
}

export async function storeKey(key: string): Promise<string> {
  const file = credentialsPath();
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, { licenseKey: key, savedAt: new Date().toISOString() }, { spaces: 2, mode: 0o600 });
  // writeJson's mode only applies when the file is created.
  await fs.chmod(file, 0o600).catch(() => {});
  return file;
}

export async function clearStoredKey(): Promise<boolean> {
  const file = credentialsPath();
  if (!(await fs.pathExists(file))) return false;
  await fs.remove(file);
  return true;
}

export type KeySource = "env" | "login";

/** The licence key to use: the env var wins (CI, one-off overrides), then
 *  the key saved by `lumioui login`. */
export async function resolveLicenseKey(envName = DEFAULT_KEY_ENV): Promise<{ key: string; source: KeySource; envName: string } | null> {
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv) return { key: fromEnv, source: "env", envName };
  const stored = await readStoredKey();
  return stored ? { key: stored, source: "login", envName } : null;
}

export interface WhoAmI {
  valid: boolean;
  pro?: boolean;
  plan?: string;
  email?: string | null;
  key?: { prefix: string; label: string } | null;
  reason?: string;
}

/** Ask the registry who a key belongs to. Throws on network or server
 *  errors; an invalid key comes back as { valid: false }. */
export async function whoami(registry: string, key: string): Promise<WhoAmI> {
  const res = await fetch(`${registry.replace(/\/+$/, "")}/whoami`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
  });
  if (res.status === 401) {
    const body = (await res.json().catch(() => ({}))) as { reason?: string };
    return { valid: false, reason: body.reason ?? "invalid" };
  }
  if (res.status === 404) throw new Error("This registry doesn't support key checks yet.");
  if (!res.ok) throw new Error(`Couldn't check the key (${res.status}). Try again in a minute.`);
  return (await res.json()) as WhoAmI;
}

/** Human line for a plan id. */
export const planName = (plan?: string) =>
  ({ pro: "Pro", team: "Team", enterprise: "Enterprise", lifetime: "Lifetime", free: "Free" })[plan ?? ""] ?? plan ?? "unknown";
