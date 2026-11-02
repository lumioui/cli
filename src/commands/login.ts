import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import path from "node:path";
import { execa } from "execa";
import { DEFAULT_REGISTRY, readConfig } from "../config.js";
import { DEFAULT_KEY_ENV, clearStoredKey, credentialsPath, planName, resolveLicenseKey, storeKey, whoami } from "../auth.js";

const KEYS_PAGE = "https://lumioui.com/account#keys";

async function openInBrowser(url: string): Promise<void> {
  const [bin, args] =
    process.platform === "darwin" ? ["open", [url]] :
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] :
    ["xdg-open", [url]];
  await execa(bin, args as string[], { stdio: "ignore" }).catch(() => {});
}

async function registryFor(cwd: string): Promise<string> {
  return (await readConfig(cwd).catch(() => null))?.registry ?? DEFAULT_REGISTRY;
}

/**
 * `lumioui login` — save a Pro licence key for this computer, after checking
 * it with the registry. Keys are made on the website (Account › License keys);
 * the CLI never sees a password.
 */
export const loginCommand = new Command("login")
  .description("Save your Pro licence key on this computer")
  .option("-k, --key <key>", "Licence key (otherwise you're asked for it; avoid this in shared shells, it lands in history)")
  .option("--no-browser", "Don't open the License keys page")
  .option("-c, --cwd <path>", "Project directory", process.cwd())
  .action(async (opts) => {
    const registry = await registryFor(path.resolve(opts.cwd));
    let key: string | undefined = opts.key?.trim();

    if (!key) {
      if (!process.stdin.isTTY) {
        console.error(chalk.red(`No terminal to ask in. Pass --key, or set ${DEFAULT_KEY_ENV} instead.`));
        process.exit(1);
      }
      console.log(`Create a licence key under ${chalk.bold("Account › License keys")}: ${chalk.cyan(KEYS_PAGE)}`);
      if (opts.browser) await openInBrowser(KEYS_PAGE);
      const answer = await prompts({ type: "password", name: "key", message: "Paste your licence key" });
      key = (answer.key as string | undefined)?.trim();
      if (!key) {
        console.log(chalk.dim("Cancelled."));
        return;
      }
    }

    const spinner = ora("Checking the key…").start();
    let who;
    try {
      who = await whoami(registry, key);
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
    if (!who.valid) {
      spinner.fail(
        who.reason === "revoked"
          ? "That key was revoked. Create a new one under Account › License keys."
          : "That key isn't recognised. Copy it again from Account › License keys (it starts with lumio_).",
      );
      process.exit(1);
    }
    const file = await storeKey(key);
    spinner.succeed(`Logged in${who.email ? ` as ${chalk.bold(who.email)}` : ""} · ${planName(who.plan)} plan`);
    if (!who.pro) {
      console.log(chalk.yellow("  This account has no Pro plan, so Pro installs will be refused. Free components work without a key."));
      console.log(chalk.dim("  Upgrade at https://lumioui.com/pricing; the saved key starts working as soon as the plan is active."));
    } else {
      console.log(chalk.dim("  Pro installs now work in every project on this computer: npx @lumioui/cli add pro/<name>"));
    }
    console.log(chalk.dim(`  Saved to ${file}. Run \`npx @lumioui/cli logout\` to remove it.`));
    if (process.env[DEFAULT_KEY_ENV]) {
      console.log(chalk.yellow(`  Note: ${DEFAULT_KEY_ENV} is set in this shell and takes priority over the saved key.`));
    }
  });

/** `lumioui logout` — forget the saved key. */
export const logoutCommand = new Command("logout")
  .description("Remove the saved licence key from this computer")
  .action(async () => {
    const removed = await clearStoredKey();
    console.log(removed ? chalk.green(`✓ Logged out. Removed ${credentialsPath()}.`) : chalk.dim("Not logged in."));
    if (process.env[DEFAULT_KEY_ENV]) console.log(chalk.yellow(`  ${DEFAULT_KEY_ENV} is still set in this shell.`));
  });

/** `lumioui whoami` — which key is in use, whose it is, and whether Pro works. */
export const whoamiCommand = new Command("whoami")
  .description("Show which licence key is in use and whether Pro installs will work")
  .option("-c, --cwd <path>", "Project directory", process.cwd())
  .action(async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const config = await readConfig(cwd).catch(() => null);
    const found = await resolveLicenseKey(config?.licenseKeyEnv ?? DEFAULT_KEY_ENV);
    if (!found) {
      console.log("Not logged in. Free components work without a key.");
      console.log(chalk.dim("  For Pro: npx @lumioui/cli login"));
      return;
    }
    const from = found.source === "env" ? `${found.envName} (environment)` : "saved login";
    const spinner = ora("Checking the key…").start();
    try {
      const who = await whoami(config?.registry ?? DEFAULT_REGISTRY, found.key);
      if (!who.valid) {
        spinner.fail(`The key from ${from} is ${who.reason === "revoked" ? "revoked" : "not valid"}. Run \`npx @lumioui/cli login\` with a new one.`);
        process.exit(1);
      }
      spinner.succeed(`${who.email ?? "Licence key"} · ${planName(who.plan)} plan · key ${who.key?.prefix ?? found.key.slice(0, 12)}… from ${from}`);
      console.log(who.pro ? chalk.green("  Pro installs will work.") : chalk.yellow("  No Pro plan on this account: Pro installs will be refused."));
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
  });
