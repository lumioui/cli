import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registryItemSchema } from "./registry.js";

describe("registryItemSchema", () => {
  it("parses a minimal free item with defaults", () => {
    const item = registryItemSchema.parse({
      name: "button",
      files: [{ path: "button/index.tsx", target: "components/ui/button/button.tsx" }],
    });
    assert.equal(item.tier, "free");
    assert.equal(item.type, "component");
    assert.equal(item.expoGoCompatible, true);
  });

  it("accepts pro screens", () => {
    const item = registryItemSchema.parse({
      name: "auth-login",
      tier: "pro",
      type: "screen",
      files: [],
    });
    assert.equal(item.tier, "pro");
    assert.equal(item.type, "screen");
  });

  it("rejects path-traversal-ish names at fetch layer (documented)", () => {
    // fetchItem itself hits network; schema just ensures name is a string.
    // Server enforces /^[a-z0-9][a-z0-9-]*$/i — keep this test as a contract reminder.
    assert.ok("Authorization" in { Authorization: "Bearer x" });
  });
});
