import fs from "fs-extra";
import path from "node:path";
import { execa } from "execa";

export type ProjectType = "expo" | "bare";
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** Detect whether the target project is Expo or bare React Native. */
export async function detectProjectType(cwd: string): Promise<ProjectType | null> {
  const pkgPath = path.join(cwd, "package.json");
  if (!(await fs.pathExists(pkgPath))) return null;
  const pkg = await fs.readJson(pkgPath);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.expo) return "expo";
  if (deps["react-native"]) return "bare";
  return null;
}

/** Detect the package manager from lockfiles. */
export async function detectPackageManager(cwd: string): Promise<PackageManager> {
  if (await fs.pathExists(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (await fs.pathExists(path.join(cwd, "yarn.lock"))) return "yarn";
  // bun.lock is the current text lockfile (Bun ≥1.2); bun.lockb is the
  // legacy binary one — projects on old Bun still carry it.
  if (await fs.pathExists(path.join(cwd, "bun.lock"))) return "bun";
  if (await fs.pathExists(path.join(cwd, "bun.lockb"))) return "bun";
  return "npm";
}

/** Read the project's installed dependencies (deps + devDeps). */
export async function readProjectDeps(cwd: string): Promise<Record<string, string>> {
  const pkg = await fs.readJson(path.join(cwd, "package.json"));
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

/** Install command string for the detected package manager. Expo projects
 *  install runtime packages through `npx expo install`, which picks the
 *  versions that match the project's SDK (a mismatched Reanimated or
 *  Safe Area build crashes at launch); it drops "*"/"latest" pins. */
export function installCommand(pm: PackageManager, packages: string[], dev = false, expo = false): string {
  if (expo && !dev) {
    return `npx expo install ${packages.map((p) => p.replace(/@(\*|latest)$/, "")).join(" ")}`;
  }
  const flag = dev ? " -D" : "";
  switch (pm) {
    case "pnpm":
      return `pnpm add${flag} ${packages.join(" ")}`;
    case "yarn":
      return `yarn add${flag} ${packages.join(" ")}`;
    case "bun":
      return `bun add${flag ? " -d" : ""} ${packages.join(" ")}`;
    default:
      return `npm install${dev ? " --save-dev" : ""} ${packages.join(" ")}`;
  }
}

/** Run a package-manager install. execa needs real argv — passing the whole
 *  spec string as a template arg runs it as one argv[0] and always ENOENTs. */
export async function runInstall(pm: PackageManager, packages: string[], dev = false, expo = false): Promise<void> {
  const [bin, ...argv] = installCommand(pm, packages, dev, expo).split(" ");
  await execa(bin!, argv);
}
