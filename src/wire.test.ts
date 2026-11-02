import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { wireRoot, writeAgents } from "./wire.js";
import { usageLine } from "./files.js";
import { registryItemSchema } from "./registry.js";
import { credentialsPath, readStoredKey, resolveLicenseKey, storeKey, clearStoredKey } from "./auth.js";
import type { LumiouiConfig } from "./config.js";

const config: LumiouiConfig = {
  registry: "https://api.lumioui.com",
  projectType: "expo",
  packageManager: "npm",
  styling: "nativewind",
  aliases: { components: "components", ui: "components/ui", lib: "lib", hooks: "hooks" },
  licenseKeyEnv: "LUMIO_LICENSE_KEY",
};

async function project(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lumio-cli-"));
  for (const [f, c] of Object.entries(files)) {
    await fs.ensureDir(path.dirname(path.join(dir, f)));
    await fs.writeFile(path.join(dir, f), c);
  }
  return dir;
}

describe("wireRoot", () => {
  it("wraps the create-expo-app blank App.tsx", async () => {
    const dir = await project({
      "App.tsx": `import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text>Open up App.tsx to start working on your app!</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({ container: { flex: 1 } });
`,
    });
    const r = await wireRoot(dir, config);
    assert.equal(r.status, "wired");
    const out = await fs.readFile(path.join(dir, "App.tsx"), "utf8");
    assert.match(out, /import "\.\/global\.css";\nimport \{ ThemeProvider as LumioThemeProvider \} from "\.\/lib\/lumioui";/);
    assert.match(out, /^function App\(\)/m);
    assert.match(out, /export default function LumioRoot\(\)[\s\S]*<LumioThemeProvider>\s*<App \/>\s*<\/LumioThemeProvider>/);
    assert.equal((out.match(/export default/g) ?? []).length, 1);
    // Imports land after the last existing import, before any code.
    assert.ok(out.indexOf("lib/lumioui") < out.indexOf("function App"));
  });

  it("wraps an Expo Router root layout and leaves an existing global.css import alone", async () => {
    const dir = await project({
      "app/_layout.tsx": `import "../global.css";
import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack />;
}
`,
    });
    const r = await wireRoot(dir, config);
    assert.equal(r.status, "wired");
    const out = await fs.readFile(path.join(dir, "app/_layout.tsx"), "utf8");
    assert.equal((out.match(/global\.css/g) ?? []).length, 1);
    assert.match(out, /import \{ ThemeProvider as LumioThemeProvider \} from "\.\.\/lib\/lumioui";/);
    assert.match(out, /<RootLayout \/>/);
  });

  it("wires the Expo Router default template, which already uses React Navigation's ThemeProvider", async () => {
    const dir = await project({
      "src/app/_layout.tsx": `import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import AppTabs from '@/components/app-tabs';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AppTabs />
    </ThemeProvider>
  );
}
`,
    });
    const r = await wireRoot(dir, config);
    assert.equal(r.status, "wired");
    const out = await fs.readFile(path.join(dir, "src/app/_layout.tsx"), "utf8");
    assert.match(out, /import "\.\.\/\.\.\/global\.css";/);
    assert.match(out, /import \{ ThemeProvider as LumioThemeProvider \} from "\.\.\/\.\.\/lib\/lumioui";/);
    assert.match(out, /<LumioThemeProvider>\s*<TabLayout \/>/);
    assert.match(out, /<ThemeProvider value=/); // React Navigation's stays
    assert.equal((await wireRoot(dir, config)).status, "already");
  });

  it("handles `export default App;` and is a no-op the second time", async () => {
    const dir = await project({
      "App.js": `import React from "react";
const App = () => null;
export default App;
`,
    });
    assert.equal((await wireRoot(dir, config)).status, "wired");
    const once = await fs.readFile(path.join(dir, "App.js"), "utf8");
    assert.doesNotMatch(once, /export default App;/);
    assert.match(once, /<App \/>/);
    assert.equal((await wireRoot(dir, config)).status, "already");
    assert.equal(await fs.readFile(path.join(dir, "App.js"), "utf8"), once);
  });

  it("reports manual when there is no default export it understands", async () => {
    const dir = await project({ "App.tsx": "export default () => null;\n" });
    const r = await wireRoot(dir, config);
    assert.equal(r.status, "manual");
    assert.equal(await fs.readFile(path.join(dir, "App.tsx"), "utf8"), "export default () => null;\n");
  });
});

describe("writeAgents", () => {
  it("appends once and refreshes in place", async () => {
    const dir = await project({ "AGENTS.md": "# Project\n\nOwn notes.\n" });
    assert.equal(await writeAgents(dir, config), "added");
    assert.equal(await writeAgents(dir, config), "updated");
    const out = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
    assert.equal((out.match(/lumioui:start/g) ?? []).length, 1);
    assert.match(out, /^# Project\n\nOwn notes\./);
    assert.match(out, /llms\.txt/);
  });
});

describe("usageLine", () => {
  it("imports a family from its folder", () => {
    const item = registryItemSchema.parse({
      name: "button",
      files: [
        { path: "button/button.tsx", target: "components/ui/button/button.tsx", content: "export const Button = 1;\nexport interface ButtonProps {}\n" },
        { path: "button/index.ts", target: "components/ui/button/index.ts", content: 'export * from "./button";' },
      ],
    });
    assert.equal(usageLine(item, config), 'import { Button } from "./components/ui/button";  https://lumioui.com/components/button');
  });

  it("imports a variant from its file", () => {
    const item = registryItemSchema.parse({
      name: "accordion-multiple",
      type: "block",
      variantOf: "accordion",
      files: [{ path: "accordion/variants/multiple.tsx", target: "components/ui/accordion/variants/multiple.tsx", content: "export function AccordionMultiple() {}\n" }],
    });
    assert.equal(usageLine(item, config), 'import { AccordionMultiple } from "./components/ui/accordion/variants/multiple";  https://lumioui.com/components/accordion-multiple');
  });
});

describe("credentials", () => {
  before(async () => {
    process.env.XDG_CONFIG_HOME = await fs.mkdtemp(path.join(os.tmpdir(), "lumio-cfg-"));
    delete process.env.LUMIO_LICENSE_KEY;
  });

  it("stores the key privately and the env var wins over it", async () => {
    const file = await storeKey("lumio_test_key");
    assert.equal(file, credentialsPath());
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.equal(await readStoredKey(), "lumio_test_key");
    assert.deepEqual(await resolveLicenseKey(), { key: "lumio_test_key", source: "login", envName: "LUMIO_LICENSE_KEY" });
    process.env.LUMIO_LICENSE_KEY = "lumio_env_key";
    assert.equal((await resolveLicenseKey())?.source, "env");
    delete process.env.LUMIO_LICENSE_KEY;
    assert.equal(await clearStoredKey(), true);
    assert.equal(await resolveLicenseKey(), null);
  });
});
