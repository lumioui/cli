import { z } from "zod";

/**
 * LumioUI registry schema — shadcn-inspired JSON format, extended for mobile.
 * Fields like `gestures`, `haptics`, `nativeDeps`, and `expoGoCompatible`
 * have no web analogue and are what make this registry phone-native.
 */
export const registryItemSchema = z.object({
  name: z.string(),
  type: z.enum(["component", "screen", "block", "hook", "lib", "theme", "skill"]).default("component"),
  tier: z.enum(["free", "pro"]).default("free"),
  title: z.string().optional(),
  description: z.string().optional(),
  files: z.array(
    z.object({
      path: z.string(), // source path in the registry payload
      target: z.string(), // where it lands in the user's project
      content: z.string().optional(), // inline content when served
    })
  ),
  /** Other registry items this item needs. */
  registryDependencies: z.array(z.string()).default([]),
  /** npm packages the host project must install. */
  nativeDeps: z.record(z.string(), z.string()).default({}),
  devDeps: z.record(z.string(), z.string()).default({}),
  /** Gestures the component uses — drives `doctor` warnings.
   *  Accepts the canonical vocabulary plus the looser terms authors used in
   *  meta.json (scroll/pull/pan/double-tap/momentum/snap/typing/hold).
   *  ponytail: loose string[], not an enum — vocabulary is validated upstream
   *  (test-registry + meta.json); a client-side enum crashes old CLIs on new
   *  values for zero benefit since no code branches on them. */
  gestures: z.array(z.string()).default([]),
  /** Haptic feedback points — useHaptic style names (light/medium/heavy/
   *  selection/success/warning/error) plus legacy event names press/snap.
   *  ponytail: loose string[], same drift-safety reason as gestures. */
  haptics: z.array(z.string()).default([]),
  /** False when the item needs a dev build (custom native code). */
  expoGoCompatible: z.boolean().default(true),
  platforms: z.array(z.enum(["ios", "android", "web"])).default(["ios", "android"]),
  /** Docs showcase devices. */
  showcase: z.array(z.enum(["iphone", "android"])).optional(),
  /** Kitchen-sink catalog grouping — informational only for the CLI. */
  category: z.string().optional(),
  /** Variant demo slugs (family items) or the variant this block renders. */
  variants: z.array(z.object({ slug: z.string(), title: z.string(), design: z.string().optional() })).optional(),
  /** Set on "<family>-<slug>" block items — the family they belong to. */
  variantOf: z.string().optional(),
  /** Design language tag for `--design` install filtering. */
  design: z.string().optional(),
});

export type RegistryItem = z.infer<typeof registryItemSchema>;

export interface FetchContext {
  registry: string;
  licenseKey?: string;
}

/** Fetch a single registry item. Pro items send the license as Bearer. */
export async function fetchItem(name: string, ctx: FetchContext): Promise<RegistryItem> {
  const isPro = name.startsWith("pro/") || name.startsWith("@pro/");
  const clean = name.replace(/^@?pro\//, "");
  const url = isPro ? `${ctx.registry}/r/pro/${clean}.json` : `${ctx.registry}/r/${clean}.json`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (isPro) {
    if (!ctx.licenseKey) {
      throw new Error(
        `"${clean}" is Pro. Get Pro at https://lumioui.com/pricing, then run \`npx @lumioui/cli login\` (or set LUMIO_LICENSE_KEY) and retry.`
      );
    }
    headers.Authorization = `Bearer ${ctx.licenseKey}`;
  }

  const res = await fetch(url, { headers });
  if (res.status === 402) {
    throw new Error(
      `"${clean}" is Pro, and the account this key belongs to isn't on a Pro plan (or its plan has ended). ` +
        `Upgrade at https://lumioui.com/pricing, then try again. \`npx @lumioui/cli whoami\` shows the account and plan.`,
    );
  }
  if (res.status === 429) {
    // Rate and daily limits: the registry explains which one.
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? "Too many requests. Wait a minute and try again.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Your licence key wasn't accepted for "${clean}". Check it with \`npx @lumioui/cli whoami\`, or log in again with a new key.`);
  }
  if (!res.ok) {
    throw new Error(
      res.status === 404 && !isPro
        ? `Registry item "${clean}" not found — if it's a Pro item, use "pro/${clean}".`
        : `Registry item "${name}" not found (${res.status}).`
    );
  }
  return registryItemSchema.parse(await res.json());
}

/** List all items in the catalog (public index). */
export async function fetchIndex(ctx: FetchContext): Promise<RegistryItem[]> {
  const res = await fetch(`${ctx.registry}/index.json`);
  if (!res.ok) throw new Error(`Failed to load registry index (${res.status}).`);
  const data = (await res.json()) as { items?: unknown[] };
  if (!Array.isArray(data.items)) throw new Error("Registry index is malformed — no items array.");
  return data.items.map((i) => registryItemSchema.parse(i));
}

/**
 * Resolve an item plus its registryDependencies into install order.
 * Kahn's topological sort — same approach as the shadcn resolver.
 */
export async function resolveTree(names: string[], ctx: FetchContext): Promise<RegistryItem[]> {
  const items = new Map<string, RegistryItem>();
  const visiting = new Set<string>();

  // Deps on Pro items arrive as "pro/<name>"; items are keyed by bare name.
  const bare = (d: string) => d.replace(/^@?pro\//, "");

  async function visit(name: string) {
    if (items.has(bare(name))) return;
    if (visiting.has(bare(name))) throw new Error(`Circular registry dependency at "${name}".`);
    visiting.add(bare(name));
    const item = await fetchItem(name, ctx);
    for (const dep of item.registryDependencies) await visit(dep);
    visiting.delete(bare(name));
    // Key by item.name (canonical, bare) — the topo sort below indexes by
    // item.name; keying by the pro/-prefixed input name loses the entry.
    items.set(item.name, item);
  }

  for (const name of names) await visit(name);

  // Kahn's algorithm over the collected set.
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const item of items.values()) {
    const deps = item.registryDependencies.map(bare);
    indegree.set(item.name, deps.filter((d) => items.has(d)).length);
    for (const dep of deps) {
      if (!items.has(dep)) continue;
      dependents.set(dep, [...(dependents.get(dep) ?? []), item.name]);
    }
  }
  const queue = [...items.keys()].filter((n) => (indegree.get(n) ?? 0) === 0);
  const ordered: RegistryItem[] = [];
  while (queue.length) {
    const name = queue.shift()!;
    ordered.push(items.get(name)!);
    for (const dep of dependents.get(name) ?? []) {
      indegree.set(dep, indegree.get(dep)! - 1);
      if (indegree.get(dep) === 0) queue.push(dep);
    }
  }
  return ordered;
}
