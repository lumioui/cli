import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import { DEFAULT_REGISTRY, readConfig } from "../config.js";
import { fetchIndex, type RegistryItem } from "../registry.js";
import { isInfra } from "../files.js";

const TYPE_ORDER = ["component", "block", "screen"];

/** `lumioui list` — browse the registry catalog. */
export const listCommand = new Command("list")
  .description("List available components, screens, and blocks")
  .option("-c, --cwd <path>", "Project directory", process.cwd())
  .option("--pro", "Show only Pro items")
  .option("--type <type>", "Filter by type: component, block, or screen")
  .action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const config = await readConfig(cwd);
    const registry = config?.registry ?? DEFAULT_REGISTRY;

    const spinner = ora("Fetching catalog…").start();
    try {
      const items = await fetchIndex({ registry });
      spinner.stop();
      const filtered = items.filter(
        (i) => !isInfra(i) && (!opts.pro || i.tier === "pro") && (!opts.type || i.type === opts.type),
      );

      // Group screens by flow, blocks by parent component, components by category.
      const groups = new Map<string, RegistryItem[]>();
      for (const item of filtered) {
        const parent =
          item.type === "block"
            ? (item.variantOf ?? "other")
            : (item.category ?? "other");
        const key = `${item.type} · ${parent}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = []));
        g.push(item);
      }
      const keys = [...groups.keys()].sort((a, b) => {
        const [ta, pa] = a.split(" · ");
        const [tb, pb] = b.split(" · ");
        const order = TYPE_ORDER.indexOf(ta!) - TYPE_ORDER.indexOf(tb!);
        return order || pa!.localeCompare(pb!);
      });

      for (const key of keys) {
        console.log(`\n  ${chalk.cyan(key)}`);
        for (const item of groups.get(key)!) {
          const tag = item.tier === "pro" ? chalk.yellow("[pro] ") : "       ";
          console.log(`    ${tag}${chalk.bold(item.name)} ${chalk.dim(item.description ?? "")}`);
        }
      }
      console.log(chalk.dim(`\n${filtered.length} items — add with \`npx @lumioui/cli add <name>\` (pro items: \`npx @lumioui/cli add pro/<name>\`)`));
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
  });
