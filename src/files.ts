import path from "node:path";
import type { LumiouiConfig } from "./config.js";
import type { RegistryItem } from "./registry.js";

/** Registry items that are plumbing, not catalog entries. */
export const isInfra = (i: { type: string }) => i.type === "lib" || i.type === "theme";

/** Where a registry file lands, honouring the project's aliases:
 *  components/ui/… → aliases.ui, lib/… → aliases.lib; everything else
 *  (screens/…, root config files) is relative to the project root. */
export function projectPath(target: string, config: LumiouiConfig): string {
  if (target.startsWith("components/ui/")) return `${config.aliases.ui}/${target.slice("components/ui/".length)}`;
  if (target.startsWith("lib/")) return `${config.aliases.lib}/${target.slice("lib/".length)}`;
  return target;
}

function relImport(fromFile: string, toPath: string): string {
  let rel = path.relative(path.dirname(fromFile), toPath).split(path.sep).join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

/** Registry source imports the monorepo packages by name. In a user project
 *  those are copied files, so point every import at its copy:
 *    @lumioui/core               → <lib>/lumioui            (the core item)
 *    @lumioui/ui|pro/<x>         → <ui>/<x>/<x>             (the family's main file)
 *    @lumioui/ui|pro/<x>/<rest>  → <ui>/<x>/<rest>
 *  `fileAbs` is where this file is being written; `cwd` the project root. */
export function rewriteImports(content: string, fileAbs: string, cwd: string, config: LumiouiConfig): string {
  const core = path.join(cwd, config.aliases.lib, "lumioui");
  const ui = path.join(cwd, config.aliases.ui);
  return content.replace(
    /(from\s+|import\s*\(\s*|require\(\s*)(["'])@lumioui\/(core|ui|pro)(?:\/([\w-]+)(\/[\w/-]+)?)?\2/g,
    (whole, lead: string, q: string, pkg: string, name?: string, rest?: string) => {
      if (pkg === "core") return name ? whole : `${lead}${q}${relImport(fileAbs, core)}${q}`;
      if (!name) return whole; // bare @lumioui/ui barrel — not used by shipped source
      const target = rest ? path.join(ui, name, rest.slice(1)) : path.join(ui, name, name);
      return `${lead}${q}${relImport(fileAbs, target)}${q}`;
    },
  );
}

/** Exported component names in a source file (PascalCase values only). */
export function exportedComponents(content: string): string[] {
  const names = new Set<string>();
  for (const m of content.matchAll(/export\s+(?:const|function)\s+([A-Z]\w*)/g)) names.add(m[1]!);
  return [...names];
}

/** One "import … from …   docs-url" line for an installed item, or "" when
 *  its main file exports no component. */
export function usageLine(item: RegistryItem, config: LumiouiConfig): string {
  const code = item.files.filter((f) => /\.(tsx|jsx)$/.test(f.target) && f.content);
  const slug = item.variantOf ? item.name.slice(item.variantOf.length + 1) : item.name;
  const main =
    code.find((f) => path.posix.basename(f.target).replace(/\.\w+$/, "") === slug) ??
    code.find((f) => path.posix.basename(f.target).replace(/\.\w+$/, "") === item.name) ??
    code[0];
  if (!main) return "";
  const names = exportedComponents(main.content!);
  if (!names.length) return "";
  const target = projectPath(main.target, config);
  const dir = path.posix.dirname(target);
  // A family folder ships an index.ts that re-exports the component.
  const hasIndex = item.files.some((f) => projectPath(f.target, config) === `${dir}/index.ts`);
  const from = `./${hasIndex ? dir : target.replace(/\.\w+$/, "")}`;
  const docs = `https://lumioui.com/${item.type === "screen" ? "screens" : "components"}/${item.name}`;
  return `import { ${names.slice(0, 4).join(", ")} } from "${from}";  ${docs}`;
}
