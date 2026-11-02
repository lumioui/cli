import { Command } from "commander";
import chalk from "chalk";
import fs from "fs-extra";
import path from "node:path";
import { readConfig } from "../config.js";
import { detectProjectType, readProjectDeps } from "../project.js";
import { planName, resolveLicenseKey, whoami } from "../auth.js";
import { findRootFile, isWired } from "../wire.js";

interface Check {
  name: string;
  ok: boolean;
  fix?: string;
  optional?: boolean;
}

/**
 * `lumioui doctor` — verify the project is correctly configured:
 * deps installed, babel/metro wiring present, license key set for Pro.
 */
export const doctorCommand = new Command("doctor")
  .description("Diagnose your LumioUI setup")
  .option("-c, --cwd <path>", "Project directory", process.cwd())
  .action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const checks: Check[] = [];

    const projectType = await detectProjectType(cwd);
    checks.push({
      name: "React Native project detected",
      ok: projectType !== null,
      fix: "Run inside an Expo or bare RN project root",
    });

    const deps = projectType ? await readProjectDeps(cwd) : {};
    for (const dep of ["nativewind", "react-native-reanimated", "react-native-safe-area-context", "react-native-svg", "clsx", "tailwind-merge"]) {
      checks.push({
        name: `${dep} installed`,
        ok: Boolean(deps[dep]),
        fix: `Install it: ${dep}`,
      });
    }

    if (projectType) {
      const babelPath = path.join(cwd, "babel.config.js");
      const babelOk =
        (await fs.pathExists(babelPath)) &&
        (await fs.readFile(babelPath, "utf8")).includes("nativewind");
      checks.push({
        name: "babel.config.js includes nativewind preset",
        ok: babelOk,
        fix: 'Add "nativewind/babel" to babel presets',
      });
    }

    const config = await readConfig(cwd);
    checks.push({
      name: "lumioui.json present",
      ok: config !== null,
      fix: "Run `npx @lumioui/cli init`",
    });
    if (config) {
      checks.push({
        name: `${config.aliases.ui} directory exists`,
        ok: await fs.pathExists(path.join(cwd, config.aliases.ui)),
        fix: `Create ${config.aliases.ui}/ or run \`npx @lumioui/cli init\``,
      });
      checks.push({
        name: `Shared core in ${config.aliases.lib}/lumioui`,
        ok: await fs.pathExists(path.join(cwd, config.aliases.lib, "lumioui", "index.ts")),
        fix: "Run `npx @lumioui/cli init` (or add any component) to copy it",
      });
      const css = path.join(cwd, "global.css");
      checks.push({
        name: "global.css defines the LumioUI theme",
        ok: (await fs.pathExists(css)) && (await fs.readFile(css, "utf8")).includes("--primary"),
        fix: "Run `npx @lumioui/cli init` in a project without a global.css, or copy the theme variables from the docs",
      });
      const tw = path.join(cwd, "tailwind.config.js");
      checks.push({
        name: "tailwind.config.js uses the NativeWind preset",
        ok: (await fs.pathExists(tw)) && (await fs.readFile(tw, "utf8")).includes("nativewind/preset"),
        fix: 'Add presets: [require("nativewind/preset")] and the LumioUI colours',
      });
      const root = await findRootFile(cwd);
      if (root) {
        const src = await fs.readFile(path.join(cwd, root), "utf8");
        checks.push({
          name: `${root} imports global.css and wraps the app in <ThemeProvider>`,
          ok: /global\.css["']/.test(src) && isWired(src),
          fix: "Run `npx @lumioui/cli init` again to wire it, or add both by hand (docs › Installation)",
        });
      }

      // Licence: optional (free components need none), but a key that is
      // set and wrong is a real problem.
      const found = await resolveLicenseKey(config.licenseKeyEnv);
      if (!found) {
        checks.push({
          name: "Licence key for Pro",
          ok: false,
          fix: "Not logged in: free components only. For Pro run `npx @lumioui/cli login`",
          optional: true,
        });
      } else {
        const from = found.source === "env" ? found.envName : "saved login";
        try {
          const who = await whoami(config.registry, found.key);
          if (!who.valid) {
            checks.push({ name: `Licence key (${from}) is valid`, ok: false, fix: `It is ${who.reason ?? "invalid"}. Run \`npx @lumioui/cli login\` with a new key` });
          } else {
            checks.push({
              name: `Licence key (${from}): ${who.email ?? "valid"}, ${planName(who.plan)} plan`,
              ok: Boolean(who.pro),
              fix: "The account has no Pro plan, so Pro installs will be refused",
              optional: true,
            });
          }
        } catch (err) {
          checks.push({ name: `Licence key (${from}) could be checked`, ok: false, fix: (err as Error).message, optional: true });
        }
      }
    }

    let failed = 0;
    for (const c of checks) {
      if (c.ok) {
        console.log(`  ${chalk.green("✓")} ${c.name}`);
      } else if (c.optional) {
        console.log(`  ${chalk.yellow("!")} ${c.name}${c.fix ? chalk.dim(` — ${c.fix}`) : ""}`);
      } else {
        failed++;
        console.log(`  ${chalk.red("✗")} ${c.name}${c.fix ? chalk.dim(` — ${c.fix}`) : ""}`);
      }
    }
    console.log(failed ? chalk.yellow(`\n${failed} issue(s) found.`) : chalk.green("\nAll checks passed."));
    // Any non-optional failure exits non-zero — optional checks (license
    // key) warn but never fail, so doctor stays usable in CI.
    if (failed) process.exit(1);
  });
