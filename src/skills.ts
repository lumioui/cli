import fs from "fs-extra";
import path from "node:path";

/** One entry of the registry's skills.json (metadata only). */
export interface SkillMeta {
  name: string;
  type: "skill";
  tier: "free" | "pro";
  kind: "skill" | "taste";
  title: string;
  description: string;
  language?: string;
}

export async function fetchSkills(registry: string): Promise<SkillMeta[]> {
  const res = await fetch(`${registry.replace(/\/+$/, "")}/skills.json`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Couldn't load the skills list (${res.status}).`);
  const data = (await res.json()) as { skills?: SkillMeta[] };
  return data.skills ?? [];
}

export type Agent = "claude" | "cursor" | "agents";

/** Where each agent reads skills from. */
export const claudePath = (name: string) => `.claude/skills/${name}/SKILL.md`;
export const cursorPath = (name: string) => `.cursor/rules/${name}.mdc`;

/** Agents to write for: what the user asked for, else Claude Code + AGENTS.md,
 *  plus Cursor when the project already uses it. */
export async function pickAgents(cwd: string, asked?: string): Promise<Agent[]> {
  if (asked) {
    const list = asked.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
    const bad = list.filter((a) => !["claude", "cursor", "agents"].includes(a));
    if (bad.length) throw new Error(`Unknown agent "${bad.join(", ")}". Use claude, cursor, agents.`);
    return list as Agent[];
  }
  const out: Agent[] = ["claude", "agents"];
  if (await fs.pathExists(path.join(cwd, ".cursor"))) out.push("cursor");
  return out;
}

/** Split SKILL.md into its frontmatter description and body. */
export function parseSkill(md: string): { description: string; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { description: "", body: md };
  const description = m[1]!.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  return { description, body: md.slice(m[0].length) };
}

/** Cursor rule: same body, Cursor's frontmatter (agent-requested by description). */
export function toCursorRule(md: string): string {
  const { description, body } = parseSkill(md);
  return `---\ndescription: ${description}\nglobs:\nalwaysApply: false\n---\n${body}`;
}

const START = "<!-- lumioui:skills:start -->";
const END = "<!-- lumioui:skills:end -->";

/** Rewrite the managed "LumioUI skills" list in AGENTS.md from what is
 *  installed on disk, so it never lists a skill that was removed. */
export async function syncAgentsList(cwd: string, known: SkillMeta[]): Promise<void> {
  const installed = (
    await Promise.all(
      known.map(async (s) => {
        const file = (await fs.pathExists(path.join(cwd, claudePath(s.name))))
          ? claudePath(s.name)
          : (await fs.pathExists(path.join(cwd, cursorPath(s.name))))
            ? cursorPath(s.name)
            : null;
        return file ? { s, file } : null;
      }),
    )
  ).filter(Boolean) as { s: SkillMeta; file: string }[];

  const file = path.join(cwd, "AGENTS.md");
  const cur = (await fs.pathExists(file)) ? await fs.readFile(file, "utf8") : "";
  const i = cur.indexOf(START);
  const j = cur.indexOf(END);
  const block = installed.length
    ? `${START}
## LumioUI skills

Installed with \`npx @lumioui/cli skills add\`. Before designing or building UI, read the file that matches the task:

${installed.map(({ s, file: f }) => `- **${s.name}** (${f}): ${s.description}`).join("\n")}
${END}`
    : "";
  let next: string;
  if (i !== -1 && j > i) next = cur.slice(0, i) + block + cur.slice(j + END.length);
  else if (!block) return;
  else next = cur ? `${cur.trimEnd()}\n\n${block}\n` : `# Agent notes\n\n${block}\n`;
  await fs.writeFile(file, next.replace(/\n{3,}/g, "\n\n"));
}

/** Write one skill for the chosen agents; returns the files written. */
export async function writeSkill(cwd: string, name: string, md: string, agents: Agent[]): Promise<string[]> {
  const written: string[] = [];
  if (agents.includes("claude") || agents.includes("agents")) {
    // AGENTS.md points at the Claude Code copy, so "agents" needs it too.
    const f = path.join(cwd, claudePath(name));
    await fs.ensureDir(path.dirname(f));
    await fs.writeFile(f, md);
    written.push(claudePath(name));
  }
  if (agents.includes("cursor")) {
    const f = path.join(cwd, cursorPath(name));
    await fs.ensureDir(path.dirname(f));
    await fs.writeFile(f, toCursorRule(md));
    written.push(cursorPath(name));
  }
  return written;
}
