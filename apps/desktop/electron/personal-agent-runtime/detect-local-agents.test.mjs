import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  dedupeCodebuddyWorkbuddyAgents,
  isWorkBuddyEmbeddedPath,
  KNOWN_DISCOVERABLE_AGENTS,
  discoverableAgentDrafts,
} from "./detect-local-agents.mjs";

test("isWorkBuddyEmbeddedPath detects macOS app bundle paths", () => {
  assert.equal(
    isWorkBuddyEmbeddedPath(
      "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy",
    ),
    true,
  );
  assert.equal(isWorkBuddyEmbeddedPath("/usr/local/bin/codebuddy"), false);
  assert.equal(isWorkBuddyEmbeddedPath("/Users/me/.local/bin/codebuddy"), false);
  assert.equal(
    isWorkBuddyEmbeddedPath(
      "C:/Users/me/AppData/Local/Programs/WorkBuddy/resources/app.asar.unpacked/cli/bin/codebuddy.cmd",
    ),
    true,
  );
});

test("catalog includes WorkBuddy and CodeBuddy as separate entries", () => {
  const ids = KNOWN_DISCOVERABLE_AGENTS.map((item) => item.id);
  assert.ok(ids.includes("workbuddy"));
  assert.ok(ids.includes("codebuddy"));
  const workbuddy = KNOWN_DISCOVERABLE_AGENTS.find((item) => item.id === "workbuddy");
  assert.ok(Array.isArray(workbuddy.wellKnownPaths) && workbuddy.wellKnownPaths.length > 0);
  assert.deepEqual(workbuddy.acpArgs, ["--acp"]);
  const codebuddy = KNOWN_DISCOVERABLE_AGENTS.find((item) => item.id === "codebuddy");
  assert.equal(codebuddy.skipWorkBuddyEmbedded, true);
});

test("dedupeCodebuddyWorkbuddyAgents keeps WorkBuddy when both share one binary", () => {
  const shared =
    "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy";
  const out = dedupeCodebuddyWorkbuddyAgents(
    [
      { id: "workbuddy", command: shared },
      { id: "codebuddy", command: shared },
      { id: "grok", command: "/usr/local/bin/grok" },
    ],
    "command",
  );
  assert.deepEqual(
    out.map((item) => item.id),
    ["workbuddy", "grok"],
  );
});

test("dedupeCodebuddyWorkbuddyAgents keeps both when binaries differ", () => {
  const out = dedupeCodebuddyWorkbuddyAgents(
    [
      {
        id: "workbuddy",
        command:
          "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy",
      },
      { id: "codebuddy", command: "/Users/me/.local/bin/codebuddy" },
    ],
    "command",
  );
  assert.deepEqual(
    out.map((item) => item.id),
    ["workbuddy", "codebuddy"],
  );
});

test("discoverableAgentDrafts surfaces WorkBuddy draft", () => {
  const drafts = discoverableAgentDrafts();
  const workbuddy = drafts.find((item) => item.id === "workbuddy");
  assert.ok(workbuddy, "workbuddy draft present");
  assert.equal(workbuddy.name, "WorkBuddy");
  assert.deepEqual(workbuddy.acpArgs, ["--acp"]);
  assert.ok(
    Array.isArray(workbuddy.nativeSkillsDirs) &&
      workbuddy.nativeSkillsDirs.some((dir) => String(dir).includes(".codebuddy")),
  );
  assert.ok(
    workbuddy.nativeSkillsDirs.some((dir) => String(dir).includes(".workbuddy")),
    "WorkBuddy also declares ~/.workbuddy/skills",
  );
});

test("Grok catalog uses well-known paths and enriched PATH resolution", () => {
  const grok = KNOWN_DISCOVERABLE_AGENTS.find((item) => item.id === "grok");
  assert.ok(grok, "grok catalog entry present");
  assert.ok(Array.isArray(grok.wellKnownPaths) && grok.wellKnownPaths.length > 0);
  assert.ok(
    grok.wellKnownPaths.some((p) => String(p).includes(".local") && String(p).endsWith("grok")),
  );
  assert.deepEqual(grok.acpArgs, ["agent", "stdio"]);

  // Source contract: resolveOnPath must walk enrichedPath, not raw process.env.PATH only.
  const src = readFileSync(new URL("./detect-local-agents.mjs", import.meta.url), "utf8");
  assert.match(src, /enrichedPath/);
  assert.match(src, /wellKnownPaths/);
  assert.match(src, /from "\.\.\/runtime-path-env\.mjs"/);
});
