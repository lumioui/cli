import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import fs from "fs-extra";
import path from "node:path";
import { detectProjectType, detectPackageManager, installCommand, readProjectDeps, runInstall } from "../project.js";
import { DEFAULT_REGISTRY, writeConfig, readConfig, type LumiouiConfig } from "../config.js";
import { fetchItem } from "../registry.js";
import { projectPath, rewriteImports } from "../files.js";
import { findRootFile, wireRoot, writeAgents, type WireResult } from "../wire.js";

// Everything the shared core and the components import at runtime.
const CORE_DEPS = [
  "nativewind",
  "react-native-reanimated",
  "react-native-safe-area-context",
  "react-native-svg",
  "clsx",
  "tailwind-merge",
];
const CORE_DEV_DEPS = ["tailwindcss@^3.4"];

/**
 * `lumioui init` — detect the project, install NativeWind + Reanimated +
 * safe-area + svg, write lumioui.json, copy the shared core into
 * lib/lumioui, and write the theme stylesheet, Tailwind config and
 * NativeWind wiring for any of those files the project doesn't have yet.
 */
export const initCommand = new Command("init")
  .description("Set up LumioUI in an existing React Native / Expo project")
  .option("-y, --yes", "Skip prompts and use detected defaults")
  .option("--no-wire", "Don't add global.css and ThemeProvider to your root file")
  .option("--no-agents", "Don't add the LumioUI section to AGENTS.md")
  .option("-c, --cwd <path>", "Project directory", process.cwd())
  .action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const spinner = ora("Detecting project…").start();

    const projectType = await detectProjectType(cwd);
    if (!projectType) {
      spinner.fail("No React Native project found. Run inside an Expo or RN project root.");
      process.exit(1);
    }
    const packageManager = await detectPackageManager(cwd);
    spinner.succeed(`Detected ${chalk.bold(projectType)} project (${packageManager})`);

    if (await readConfig(cwd)) {
      if (opts.yes) return; // -y takes the prompt's default (don't re-init)
      const { overwrite } = await prompts({
        type: "confirm",
        name: "overwrite",
        message: "lumioui.json already exists. Re-initialize?",
        initial: false,
      });
      if (!overwrite) return;
    }

    const existing = await readProjectDeps(cwd);
    const missing = CORE_DEPS.filter((d) => !existing[d]);
    const missingDev = CORE_DEV_DEPS.filter((d) => !existing[d.replace(/@[^@/]+$/, "")]);

    if (missing.length || missingDev.length) {
      spinner.start("Installing dependencies…");
      try {
        if (missing.length) await runInstall(packageManager, missing, false, projectType === "expo");
        if (missingDev.length) await runInstall(packageManager, missingDev, true);
        spinner.succeed(`Installed: ${[...missing, ...missingDev].join(", ")}`);
      } catch {
        spinner.warn("Auto-install failed. Run manually:");
        if (missing.length) console.log(chalk.dim(`  ${installCommand(packageManager, missing, false, projectType === "expo")}`));
        if (missingDev.length) console.log(chalk.dim(`  ${installCommand(packageManager, missingDev, true)}`));
      }
    }

    const config: LumiouiConfig = {
      registry: DEFAULT_REGISTRY,
      projectType,
      packageManager,
      styling: "nativewind",
      aliases: {
        components: "components",
        ui: "components/ui",
        lib: "lib",
        hooks: "hooks",
      },
      licenseKeyEnv: "LUMIO_LICENSE_KEY",
    };
    await writeConfig(cwd, config);
    for (const dir of [config.aliases.ui, config.aliases.lib]) {
      await fs.ensureDir(path.join(cwd, dir));
    }

    // Shared core (always refreshed) + project wiring (only where missing —
    // never overwrite a config the developer already has).
    const kept: string[] = [];
    spinner.start("Writing theme and shared core…");
    try {
      const ctx = { registry: config.registry };
      const [core, setup] = await Promise.all([fetchItem("core", ctx), fetchItem("setup", ctx)]);
      for (const file of core.files) {
        const target = path.join(cwd, projectPath(file.target, config));
        await fs.ensureDir(path.dirname(target));
        await fs.writeFile(target, rewriteImports(file.content ?? "", target, cwd, config));
      }
      for (const file of setup.files) {
        // Babel/Metro templates are Expo's; bare projects wire NativeWind by hand.
        if (projectType === "bare" && /^(babel|metro)\.config\.js$/.test(file.target)) {
          kept.push(file.target);
          continue;
        }
        const target = path.join(cwd, file.target);
        if (await fs.pathExists(target)) {
          kept.push(file.target);
          continue;
        }
        await fs.writeFile(target, file.content ?? "");
      }
      spinner.succeed(`Shared core → ${config.aliases.lib}/lumioui, theme → global.css + tailwind.config.js`);
    } catch (err) {
      spinner.warn(`Couldn't fetch the shared core (${(err as Error).message}). Run init again when online.`);
    }

    if (kept.length) {
      console.log(chalk.yellow(`\n  Kept your existing ${kept.join(", ")}. Make sure they include:`));
      if (kept.includes("tailwind.config.js")) console.log(chalk.dim('    tailwind.config.js → presets: [require("nativewind/preset")] and the LumioUI colours (see docs › Installation)'));
      if (kept.includes("global.css")) console.log(chalk.dim("    global.css → the LumioUI theme variables (see docs › Theming)"));
      if (kept.includes("babel.config.js")) console.log(chalk.dim('    babel.config.js → ["babel-preset-expo", { jsxImportSource: "nativewind" }] and "nativewind/babel"'));
      if (kept.includes("metro.config.js")) console.log(chalk.dim('    metro.config.js → withNativeWind(config, { input: "./global.css" })'));
    }

    // Root wiring: global.css + <ThemeProvider> in app/_layout or App.
    let wired: WireResult | null = null;
    if (opts.wire) {
      const rootFile = await findRootFile(cwd);
      let go = Boolean(rootFile);
      if (rootFile && !opts.yes && process.stdin.isTTY) {
        const answer = await prompts({
          type: "confirm",
          name: "go",
          message: `Add global.css and <ThemeProvider> to ${rootFile}?`,
          initial: true,
        });
        go = Boolean(answer.go);
      }
      if (go) {
        try {
          wired = await wireRoot(cwd, config);
        } catch (err) {
          wired = { status: "manual", file: rootFile, reason: (err as Error).message };
        }
      }
      if (wired?.status === "wired") console.log(chalk.green(`✓ Wired ${wired.file}: global.css + <ThemeProvider>`));
      if (wired?.status === "already") console.log(chalk.dim(`  ${wired.file} already has <ThemeProvider>; left as is.`));
    }

    if (opts.agents) {
      const how = await writeAgents(cwd, config);
      console.log(chalk.green(`✓ AGENTS.md: LumioUI notes for coding agents ${how === "created" ? "(new file)" : how === "updated" ? "(refreshed)" : "added"}`));
    }

    const manual = !wired || wired.status === "manual";
    console.log(
      chalk.green("\n✓ LumioUI initialized.") +
        chalk.dim(
          (manual
            ? `\n  In your root layout${wired?.status === "manual" && wired.file ? ` (${wired.file}: ${wired.reason})` : ""}:\n` +
              `    import "./global.css";\n` +
              `    import { ThemeProvider } from "./${config.aliases.lib}/lumioui";\n` +
              `    // wrap your app: <ThemeProvider>…</ThemeProvider>\n`
            : "\n") +
            `  Next: npx @lumioui/cli add button card input\n` +
            `  Pro:  npx @lumioui/cli login`,
        ),
    );
  });
