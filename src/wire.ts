import fs from "fs-extra";
import path from "node:path";
import type { LumiouiConfig } from "./config.js";

/** Root files `init` knows how to wire, most specific first: Expo Router's
 *  root layout, then a classic App component. */
const ROOT_FILES = [
  "app/_layout.tsx", "app/_layout.jsx", "app/_layout.js",
  "src/app/_layout.tsx", "src/app/_layout.jsx", "src/app/_layout.js",
  "App.tsx", "App.jsx", "App.js",
  "src/App.tsx", "src/App.jsx", "src/App.js",
];

/** True when the file already imports LumioUI's ThemeProvider (any alias). */
export function isWired(src: string): boolean {
  return /import\s*\{[^}]*\bThemeProvider\b[^}]*\}\s*from\s*["'][^"']*lumioui["']/.test(src);
}

export async function findRootFile(cwd: string): Promise<string | null> {
  for (const f of ROOT_FILES) if (await fs.pathExists(path.join(cwd, f))) return f;
  return null;
}

function rel(fromFile: string, to: string): string {
  let r = path.relative(path.dirname(fromFile), to).split(path.sep).join("/");
  if (!r.startsWith(".")) r = `./${r}`;
  return r;
}

export type WireResult =
  | { status: "wired"; file: string }
  | { status: "already"; file: string }
  | { status: "manual"; file: string | null; reason: string };

/**
 * Add `import "<…>/global.css"` and wrap the app in <ThemeProvider> in the
 * project's root file, without editing the component itself: its
 * `export default` moves to a small LumioRoot that renders it inside the
 * provider. Anything it can't recognise is left alone and reported.
 */
export async function wireRoot(cwd: string, config: LumiouiConfig): Promise<WireResult> {
  const file = await findRootFile(cwd);
  if (!file) return { status: "manual", file: null, reason: "no app/_layout or App file found" };
  const abs = path.join(cwd, file);
  let src = await fs.readFile(abs, "utf8");
  if (isWired(src)) return { status: "already", file };

  // 1. The default export, in the two shapes templates use:
  //    `export default function App() {…}` and `export default App;`.
  let name: string;
  const fnDecl = /export\s+default\s+function\s+([A-Za-z_$][\w$]*)\s*\(/;
  const named = /^export\s+default\s+([A-Za-z_$][\w$]*)\s*;?[ \t]*$/m;
  if (fnDecl.test(src)) {
    name = src.match(fnDecl)![1]!;
    src = src.replace(fnDecl, (m) => m.replace(/export\s+default\s+/, ""));
  } else if (named.test(src)) {
    name = src.match(named)![1]!;
    src = src.replace(named, "");
  } else {
    return { status: "manual", file, reason: "couldn't find the default export" };
  }
  if (name === "LumioRoot") return { status: "manual", file, reason: "default export is already LumioRoot" };

  // 2. Imports, after the last existing import.
  const lines = [
    /global\.css["']/.test(src) ? null : `import "${rel(abs, path.join(cwd, "global.css"))}";`,
    // Aliased: Expo Router templates already import React Navigation's
    // ThemeProvider into this file.
    `import { ThemeProvider as LumioThemeProvider } from "${rel(abs, path.join(cwd, config.aliases.lib, "lumioui"))}";`,
  ].filter(Boolean) as string[];
  const imports = [...src.matchAll(/^import\s[^;]*?(?:from\s+)?["'][^"']+["'];?[ \t]*$/gm)];
  const last = imports.at(-1);
  if (last) {
    const at = last.index! + last[0].length;
    src = `${src.slice(0, at)}\n${lines.join("\n")}${src.slice(at)}`;
  } else {
    src = `${lines.join("\n")}\n${src}`;
  }

  // 3. The new default export.
  src = `${src.trimEnd()}

// Added by \`lumioui init\`: the LumioUI theme (light/dark tokens, accents)
// around the app.
export default function LumioRoot() {
  return (
    <LumioThemeProvider>
      <${name} />
    </LumioThemeProvider>
  );
}
`;
  await fs.writeFile(abs, src);
  return { status: "wired", file };
}

const START = "<!-- lumioui:start -->";
const END = "<!-- lumioui:end -->";

/** The AGENTS.md section: how coding agents should use LumioUI here. */
export function agentsSection(config: LumiouiConfig): string {
  const ui = config.aliases.ui;
  const lib = config.aliases.lib;
  return `${START}
## LumioUI

This app uses LumioUI: React Native components copied in as source by \`npx @lumioui/cli\`.

- Components live in \`${ui}/<name>/\` and are ours to edit. Add more with \`npx @lumioui/cli add <name>\`. Pro items use \`pro/<name>\` and need \`npx @lumioui/cli login\` once per computer.
- Before writing a UI component, check whether LumioUI has it: https://lumioui.com/llms.txt lists every component and screen. Each component's props and examples are at https://lumioui.com/components/<name>.md
- Style with NativeWind \`className\` and the theme tokens from \`global.css\`: \`bg-background\`, \`bg-card\`, \`text-foreground\`, \`text-muted-foreground\`, \`bg-primary\`, \`text-primary-foreground\`, \`border-border\`. Don't hard-code hex colours.
- The app is wrapped in \`<ThemeProvider>\` from \`${lib}/lumioui\`. Use \`useTheme().colors\` only where a colour can't be a class. Give a screen a colour with \`<Accent color="orange">\`.
- Animate with react-native-reanimated using the \`spring\` and \`timing\` tokens from \`${lib}/lumioui\`, and respect \`useReducedMotion()\`.
- If styles or the theme look wrong, run \`npx @lumioui/cli doctor\`.
- For design guidance, install the LumioUI skills: \`npx @lumioui/cli skills add lumioui\` (free) and, with Pro, the design tastes (\`lumio-taste\` plus one per design language; \`npx @lumioui/cli skills list\`).
${END}`;
}

/** Add or refresh the LumioUI section in AGENTS.md (created if missing). */
export async function writeAgents(cwd: string, config: LumiouiConfig): Promise<"created" | "added" | "updated"> {
  const file = path.join(cwd, "AGENTS.md");
  const section = agentsSection(config);
  if (!(await fs.pathExists(file))) {
    await fs.writeFile(file, `# Agent notes\n\n${section}\n`);
    return "created";
  }
  const cur = await fs.readFile(file, "utf8");
  const i = cur.indexOf(START);
  const j = cur.indexOf(END);
  if (i !== -1 && j > i) {
    await fs.writeFile(file, cur.slice(0, i) + section + cur.slice(j + END.length));
    return "updated";
  }
  await fs.writeFile(file, `${cur.trimEnd()}\n\n${section}\n`);
  return "added";
}
