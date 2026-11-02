import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "node:path";
import { readConfig } from "../config.js";
import { fetchIndex, resolveTree, type FetchContext } from "../registry.js";
import { installCommand, readProjectDeps, runInstall } from "../project.js";
import { isInfra, projectPath, rewriteImports, usageLine } from "../files.js";
import { resolveLicenseKey } from "../auth.js";

/**
 * `lumioui add` — resolve registry deps, install nativeDeps, write files.
 * Pro items are fetched with the license key as a Bearer token.
 */
export const addCommand = new Command("add")
  .description("Add components, screens, or blocks to your project")
  .argument("[names...]", "Registry item names (e.g. button, pro/paywall-sheet)")
  .option("-a, --all", "Add all free components")
  .option("-o, --overwrite", "Overwrite existing files")
  .option("--design <design>", "Preferred design language for family variants (e.g. lumo, cupertino, material)")
  .option("-c, --cwd <path>", "Project directory", process.cwd())
  .option("--dry-run", "Preview without writing files")
  .action(async (names: string[], opts) => {
    const cwd = path.resolve(opts.cwd);
    const config = await readConfig(cwd);
    if (!config) {
      console.error(chalk.red("No lumioui.json found. Run `npx @lumioui/cli init` first."));
      process.exit(1);
    }

    if (!names.length && !opts.all) {
      console.error(chalk.red("Specify components, e.g. `npx @lumioui/cli add button card`."));
      process.exit(1);
    }

    const ctx: FetchContext = {
      registry: config.registry,
      licenseKey: (await resolveLicenseKey(config.licenseKeyEnv))?.key,
    };

    const warnings: string[] = [];
    const spinner = ora("Resolving components…").start();
    let items;
    let toAdd = names;
    try {
      if (opts.all || opts.design) {
        const index = await fetchIndex(ctx);
        if (opts.all) {
          toAdd = [...toAdd, ...index.filter((i) => i.tier === "free" && !isInfra(i)).map((i) => i.name)];
        }
        // --design: family names resolve to the variant matching the design
        // (e.g. `add accordion --design cupertino` → accordion-cupertino).
        if (opts.design) {
          toAdd = toAdd.map((n) => {
            const match = index.find(
              (i) => i.variantOf === n && i.design === opts.design
            );
            if (match) return match.name;
            const hasVariants = index.some((i) => i.variantOf === n);
            if (hasVariants) {
              warnings.push(`No "${opts.design}" variant for "${n}" — installed base component.`);
            }
            return n;
          });
        }
        if (!toAdd.length) {
          spinner.fail("Registry index is empty.");
          process.exit(1);
        }
      }
      items = await resolveTree([...new Set(toAdd)], ctx);
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
    spinner.succeed(`Resolved ${items.length} item${items.length === 1 ? "" : "s"}`);

    // Collect native deps across the tree.
    const nativeDeps = new Map<string, string>();
    for (const item of items) {
      for (const [pkg, version] of Object.entries(item.nativeDeps)) {
        nativeDeps.set(pkg, version);
      }
      if (!item.expoGoCompatible && config.projectType === "expo") {
        warnings.push(`${item.name} requires a dev build — not compatible with Expo Go.`);
      }
      if (item.gestures.length) {
        nativeDeps.set("react-native-gesture-handler", nativeDeps.get("react-native-gesture-handler") ?? "latest");
      }
    }

    // Install native deps the project doesn't already have (re-installing a
    // "*" pin would silently move an existing version).
    const have = await readProjectDeps(cwd).catch(() => ({}) as Record<string, string>);
    for (const pkg of [...nativeDeps.keys()]) if (have[pkg]) nativeDeps.delete(pkg);
    if (nativeDeps.size) {
      const expo = config.projectType === "expo";
      const pkgSpecs = [...nativeDeps.entries()].map(([p, v]) => `${p}@${v}`);
      const spec = installCommand(config.packageManager, pkgSpecs, false, expo);
      if (opts.dryRun) {
        console.log(chalk.dim(`  [dry-run] would install: ${spec}`));
      } else {
        spinner.start(`Installing native deps: ${pkgSpecs.join(", ")}`);
        try {
          await runInstall(config.packageManager, pkgSpecs, false, expo);
          spinner.succeed("Native deps installed");
        } catch {
          spinner.warn(`Install failed — run: ${spec}`);
        }
      }
    }

    // Write files. `setup` (project config) is init's job — add never
    // touches tailwind/babel/metro. Shared core files that already exist
    // are left alone quietly (every component depends on core).
    for (const item of items) {
      if (item.type === "theme") continue;
      for (const file of item.files) {
        const rel = projectPath(file.target, config);
        const target = path.join(cwd, rel);
        if (!opts.overwrite && (await fs.pathExists(target))) {
          if (item.name !== "core") warnings.push(`Skipped existing file: ${rel} (use --overwrite)`);
          continue;
        }
        if (opts.dryRun) {
          console.log(chalk.dim(`  [dry-run] would write ${rel}`));
          continue;
        }
        if (file.content == null) {
          warnings.push(`No content for ${file.path} — registry may require a newer CLI.`);
          continue;
        }
        await fs.ensureDir(path.dirname(target));
        await fs.writeFile(target, rewriteImports(file.content, target, cwd, config));
        if (item.name !== "core") console.log(chalk.green(`  ✓ ${rel}`));
      }
    }

    for (const w of warnings) console.log(chalk.yellow(`  ⚠ ${w}`));
    console.log(chalk.green(`\nDone.`));

    // How to use what was asked for (not the dependencies it pulled in):
    // the import line from the project root, and where the props are documented.
    const asked = new Set(toAdd.map((n) => n.replace(/^@?pro\//, "")));
    const lines = opts.dryRun ? [] : items.filter((i) => asked.has(i.name)).map((i) => usageLine(i, config)).filter(Boolean);
    if (lines.length) {
      console.log(chalk.bold("\nUse them (paths from your project root):"));
      for (const l of lines.slice(0, 12)) console.log(`  ${l}`);
      if (lines.length > 12) console.log(chalk.dim(`  …and ${lines.length - 12} more. Every component's page lists its props.`));
    }
  });
