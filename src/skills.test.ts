import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { parseSkill, pickAgents, syncAgentsList, toCursorRule, writeSkill, type SkillMeta } from "./skills.js";

const MD = `---
name: lumio-taste
description: Use when designing screens. Extends the core.
---

# Lumio taste

Body.
`;

const meta = (name: string, description = "Does a thing."): SkillMeta => ({ name, type: "skill", tier: "pro", kind: "taste", title: name, description });

async function tmp(files: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lumio-skills-"));
  for (const [f, c] of Object.entries(files)) {
    await fs.ensureDir(path.dirname(path.join(dir, f)));
    await fs.writeFile(path.join(dir, f), c);
  }
  return dir;
}

describe("skills", () => {
  it("parses frontmatter and converts to a Cursor rule", () => {
    const { description, body } = parseSkill(MD);
    assert.equal(description, "Use when designing screens. Extends the core.");
    assert.match(body, /^\n# Lumio taste/);
    const rule = toCursorRule(MD);
    assert.match(rule, /^---\ndescription: Use when designing screens\. Extends the core\.\nglobs:\nalwaysApply: false\n---\n/);
    assert.doesNotMatch(rule, /name: lumio-taste/);
  });

  it("picks Claude Code + AGENTS.md by default, Cursor when .cursor exists, and validates --agent", async () => {
    assert.deepEqual(await pickAgents(await tmp()), ["claude", "agents"]);
    assert.deepEqual(await pickAgents(await tmp({ ".cursor/rules/x.mdc": "" })), ["claude", "agents", "cursor"]);
    assert.deepEqual(await pickAgents(await tmp(), "cursor"), ["cursor"]);
    await assert.rejects(pickAgents(await tmp(), "copilot"), /Unknown agent/);
  });

  it("writes the files and keeps the AGENTS.md list in step with disk", async () => {
    const dir = await tmp({ "AGENTS.md": "# Project\n\nOwn notes.\n" });
    const written = await writeSkill(dir, "lumio-taste", MD, ["claude", "cursor", "agents"]);
    assert.deepEqual(written, [".claude/skills/lumio-taste/SKILL.md", ".cursor/rules/lumio-taste.mdc"]);
    assert.equal(await fs.readFile(path.join(dir, ".claude/skills/lumio-taste/SKILL.md"), "utf8"), MD);

    const known = [meta("lumio-taste", "The core contract."), meta("lumio-taste-photo")];
    await syncAgentsList(dir, known);
    await syncAgentsList(dir, known); // idempotent
    let agents = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
    assert.equal((agents.match(/lumioui:skills:start/g) ?? []).length, 1);
    assert.match(agents, /^# Project\n\nOwn notes\./);
    assert.match(agents, /\*\*lumio-taste\*\* \(\.claude\/skills\/lumio-taste\/SKILL\.md\): The core contract\./);
    assert.doesNotMatch(agents, /lumio-taste-photo/);

    // Removing the skill from disk drops it from the list (and the block).
    await fs.remove(path.join(dir, ".claude"));
    await fs.remove(path.join(dir, ".cursor"));
    await syncAgentsList(dir, known);
    agents = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
    assert.doesNotMatch(agents, /lumioui:skills/);
    assert.match(agents, /Own notes\./);
  });
});
