import { z } from "zod";
import fs from "fs-extra";
import path from "node:path";

/** Hosted registry (Cloudflare Worker, apps/registry-server). LUMIO_REGISTRY
 *  overrides it — for self-hosting or a local `pnpm --filter registry dev`. */
export const DEFAULT_REGISTRY = process.env.LUMIO_REGISTRY || "https://api.lumioui.com";

/** lumioui.json — our own config format (shadcn-inspired, mobile-extended). */
export const lumiouiConfigSchema = z.object({
  $schema: z.string().optional(),
  /** Registry base URL. */
  registry: z.string().url().default(DEFAULT_REGISTRY),
  /** Detected project type. */
  projectType: z.enum(["expo", "bare"]),
  /** Package manager detected in the project. */
  packageManager: z.enum(["npm", "pnpm", "yarn", "bun"]).default("npm"),
  /** Styling engine — nativewind is the only supported engine today. */
  styling: z.literal("nativewind").default("nativewind"),
  /** Path aliases for generated files. */
  aliases: z.object({
    components: z.string().default("components"),
    ui: z.string().default("components/ui"),
    lib: z.string().default("lib"),
    hooks: z.string().default("hooks"),
  }),
  /** Where the Pro license key is read from. */
  licenseKeyEnv: z.string().default("LUMIO_LICENSE_KEY"),
});

export type LumiouiConfig = z.infer<typeof lumiouiConfigSchema>;

export const CONFIG_FILE = "lumioui.json";

export async function readConfig(cwd: string): Promise<LumiouiConfig | null> {
  const file = path.join(cwd, CONFIG_FILE);
  if (!(await fs.pathExists(file))) return null;
  const raw = await fs.readJson(file).catch(() => {
    throw new Error(`${CONFIG_FILE} is not valid JSON.`);
  });
  const parsed = lumiouiConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new Error(`${CONFIG_FILE} is invalid: ${issue.path.join(".") || "root"} — ${issue.message}`);
  }
  // Configs written by CLI ≤0.1.2 point at r.lumioui.com, which isn't live —
  // route them to the hosted registry (or LUMIO_REGISTRY) instead.
  if (parsed.data.registry.replace(/\/+$/, "") === "https://r.lumioui.com") parsed.data.registry = DEFAULT_REGISTRY;
  if (process.env.LUMIO_REGISTRY) parsed.data.registry = process.env.LUMIO_REGISTRY;
  return parsed.data;
}

export async function writeConfig(cwd: string, config: LumiouiConfig): Promise<void> {
  await fs.writeJson(
    path.join(cwd, CONFIG_FILE),
    { $schema: `${DEFAULT_REGISTRY}/schema.json`, ...config },
    { spaces: 2 }
  );
}
