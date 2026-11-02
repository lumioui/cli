import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import { DEFAULT_REGISTRY, readConfig } from "../config.js";
import { DEFAULT_KEY_ENV, resolveLicenseKey } from "../auth.js";
import { fetchItem } from "../registry.js";
import { fetchSkills, pickAgents, syncAgentsList, writeSkill, type SkillMeta } from "../skills.js";

async function context(cwd: string) {
  const config = await readConfig(cwd).catch(() => null);
  const registry = config?.registry ?? DEFAULT_REGISTRY;
  const key = (await resolveLicenseKey(config?.licenseKeyEnv ?? DEFAULT_KEY_ENV))?.key;
  return { registry, key };
}

const label = (s: SkillMeta) => (s.tier === "pro" ? chalk.magenta("Pro ") : chalk.green("Free"));

const listCommand = new Command("list")
  .description("List the skills and design tastes you can install")
  .option("-c, --cwd <path>", "Project directory", process.cwd())
  .action(async (opts) => {
    const { registry } = await context(path.resolve(opts.cwd));
    const skills = await fetchSkills(registry);
    for (const kind of ["skill", "taste"] as const) {
      const group = skills.filter((s) => s.kind === kind);
      if (!group.length) continue;
      console.log(chalk.bold(kind === "skill" ? "\nSkills" : "\nDesign tastes"));
      for (const s of group) console.log(`  ${label(s)}  ${chalk.bold(s.name.padEnd(24))} ${chalk.dim(s.description)}`);
    }
    console.log(chalk.dim("\nInstall: npx @lumioui/cli skills add lumioui lumio-taste lumio-taste-photo"));
  });

const addCommand = new Command("add")
  .description("Install skills and design tastes for your coding agents")
  .argument("[names...]", "Skill names (see `skills list`)")
  .option("--all", "Every skill your plan includes")
  .option("--agent <agents>", "Where to install: claude, cursor, agents (comma-separated). Default: Claude Code + AGENTS.md, plus Cursor when .cursor/ exists")
  .option("-c, --cwd <path>", "Project directory", process.cwd())
  .action(async (names: string[], opts) => {
    const cwd = path.resolve(opts.cwd);
    const { registry, key } = await context(cwd);
    const spinner = ora("Loading skills…").start();
    let skills: SkillMeta[];
    try {
      skills = await fetchSkills(registry);
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
    let agents;
    try {
      agents = await pickAgents(cwd, opts.agent);
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }

    const byName = new Map(skills.map((s) => [s.name, s]));
    const wanted = opts.all
      ? skills.filter((s) => s.tier === "free" || key).map((s) => s.name)
      : names.map((n) => n.replace(/^@?pro\//, ""));
    if (!wanted.length) {
      spinner.stop();
      console.error(chalk.red("Name the skills to add, e.g. `npx @lumioui/cli skills add lumioui lumio-taste`. See `skills list`."));
      process.exit(1);
    }
    const unknown = wanted.filter((n) => !byName.has(n));
    if (unknown.length) {
      spinner.fail(`Unknown skill${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. See \`npx @lumioui/cli skills list\`.`);
      process.exit(1);
    }
    spinner.stop();

    let failed = 0;
    for (const name of wanted) {
      const meta = byName.get(name)!;
      const s = ora(`${name}…`).start();
      try {
        const item = await fetchItem(meta.tier === "pro" ? `pro/${name}` : name, { registry, licenseKey: key });
        const md = item.files[0]?.content;
        if (!md) throw new Error("the registry sent no content");
        const files = await writeSkill(cwd, name, md, agents);
        s.succeed(`${chalk.bold(name)} ${chalk.dim(`→ ${files.join(", ")}`)}`);
      } catch (err) {
        failed++;
        s.fail(`${name}: ${(err as Error).message}`);
      }
    }
    if (agents.includes("agents")) await syncAgentsList(cwd, skills);
    if (agents.includes("agents")) console.log(chalk.dim("  AGENTS.md lists the installed skills for any agent that reads it."));
    console.log(failed ? chalk.yellow(`\n${failed} skill(s) not installed.`) : chalk.green("\nDone. Your agent picks these up next time it starts."));
    if (failed) process.exit(1);
  });

/** `lumioui skills` — agent skills (free) and design tastes (Pro). */
export const skillsCommand = new Command("skills")
  .description("Install LumioUI skills and design tastes for coding agents (Claude Code, Cursor, AGENTS.md)")
  .addCommand(listCommand)
  .addCommand(addCommand);
