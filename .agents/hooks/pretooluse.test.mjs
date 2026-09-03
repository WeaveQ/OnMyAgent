import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifyPath,
  collectPaths,
  decide,
  evaluatePayload,
  formatDecision,
  toPosixRel,
} from "./pretooluse.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "pretooluse.mjs");
const repoRoot = join(here, "../..");

function runHook(payload, extraEnv = {}, format = "claude") {
  const result = spawnSync(process.execPath, [script, `--format=${format}`], {
    cwd: repoRoot,
    encoding: "utf8",
    input: JSON.stringify(payload),
    env: { ...process.env, ...extraEnv },
  });
  return {
    status: result.status,
    parsed: JSON.parse(result.stdout.trim() || "{}"),
    stderr: result.stderr,
  };
}

describe("classifyPath", () => {
  test("secrets and env files are denylist-secret", () => {
    assert.equal(classifyPath(".env"), "denylist-secret");
    assert.equal(classifyPath(".env.local"), "denylist-secret");
    assert.equal(classifyPath("apps/server/.env.production"), "denylist-secret");
    assert.equal(classifyPath("secrets/gateway.json"), "denylist-secret");
  });

  test("generated trees are denylist-generated", () => {
    assert.equal(classifyPath("node_modules/foo/index.js"), "denylist-generated");
    assert.equal(classifyPath("graphify-out/graph.json"), "denylist-generated");
  });

  test("Human gate paths match AGENTS.md", () => {
    assert.equal(classifyPath("package.json"), "human-gate");
    assert.equal(classifyPath("pnpm-lock.yaml"), "human-gate");
    assert.equal(classifyPath("apps/server/src/index.ts"), "human-gate");
    assert.equal(classifyPath("apps/desktop/electron/main.mjs"), "human-gate");
    assert.equal(classifyPath("apps/orchestrator/src/boot.ts"), "human-gate");
  });

  test("ordinary docs and app UI stay ok", () => {
    assert.equal(classifyPath("docs/intent/_TEMPLATE.md"), "ok");
    assert.equal(classifyPath("apps/app/src/react-app/ARCHITECTURE.md"), "ok");
    assert.equal(classifyPath("AGENTS.md"), "ok");
  });

  test("test files are classified as test", () => {
    assert.equal(classifyPath("scripts/checks/check-boundaries.test.mjs"), "test");
    assert.equal(classifyPath("apps/app/scripts/expert-session-invariants.test.ts"), "test");
  });
});

describe("decide", () => {
  test("blocks secret reads", () => {
    const result = decide({
      toolName: "Read",
      paths: [".env"],
    });
    assert.equal(result.decision, "deny");
    assert.match(result.reasons.join(" "), /Denylist/);
  });

  test("allows reading Human gate source", () => {
    const result = decide({
      toolName: "Read",
      paths: ["apps/server/src/index.ts"],
    });
    assert.equal(result.decision, "allow");
  });

  test("blocks writing Human gate source without override", () => {
    const result = decide({
      toolName: "Write",
      paths: ["apps/desktop/electron/main.mjs"],
    });
    assert.equal(result.decision, "deny");
    assert.match(result.reasons.join(" "), /Human gate/);
  });

  test("allows Human gate writes after explicit override", () => {
    const result = decide({
      toolName: "Write",
      paths: ["package.json"],
      allowHumanGate: true,
    });
    assert.equal(result.decision, "allow");
  });

  test("allows graphify writes under graphify-out", () => {
    const result = decide({
      toolName: "Shell",
      paths: ["graphify-out/graph.json"],
      command: "pnpm task graphify build",
    });
    assert.equal(result.decision, "allow");
  });

  test("blocks hand-edits of graphify-out", () => {
    const result = decide({
      toolName: "Write",
      paths: ["graphify-out/graph.json"],
    });
    assert.equal(result.decision, "deny");
  });

  test("test lock only applies when enabled", () => {
    const unlocked = decide({
      toolName: "Write",
      paths: ["scripts/checks/foo.test.mjs"],
      lockTests: false,
    });
    const locked = decide({
      toolName: "Write",
      paths: ["scripts/checks/foo.test.mjs"],
      lockTests: true,
    });
    assert.equal(unlocked.decision, "allow");
    assert.equal(locked.decision, "deny");
    assert.match(locked.reasons.join(" "), /Test lock/);
  });

  test("package manager mutate is Human gate", () => {
    const result = decide({
      toolName: "Bash",
      paths: [],
      command: "pnpm add left-pad",
    });
    assert.equal(result.decision, "deny");
  });
});

describe("payload + formats", () => {
  test("collects Claude file_path and Cursor command paths", () => {
    assert.deepEqual(
      collectPaths({ tool_input: { file_path: join(repoRoot, "package.json") } }, repoRoot),
      ["package.json"],
    );
    const fromShell = collectPaths(
      { tool_name: "Shell", tool_input: { command: "rm apps/server/src/index.ts" } },
      repoRoot,
    );
    assert.ok(fromShell.includes("apps/server/src/index.ts"));
  });

  test("toPosixRel rejects paths outside the repo", () => {
    assert.equal(toPosixRel("/tmp/outside.env", repoRoot), null);
  });

  test("evaluatePayload denies a Claude Write to server src", () => {
    const result = evaluatePayload(
      {
        tool_name: "Write",
        tool_input: { file_path: "apps/server/src/routes.ts" },
      },
      { allowHumanGate: false, lockTests: false, root: repoRoot },
    );
    assert.equal(result.decision, "deny");
  });

  test("formatDecision uses Cursor permission and Claude hookSpecificOutput", () => {
    const cursor = formatDecision("cursor", "deny", ["Human gate: package.json"]);
    assert.equal(cursor.permission, "deny");
    assert.equal(cursor.continue, true);
    const claude = formatDecision("claude", "deny", ["Human gate: package.json"]);
    assert.equal(claude.hookSpecificOutput.permissionDecision, "deny");
  });

  test("CLI fail-open on invalid JSON", () => {
    const result = spawnSync(process.execPath, [script, "--format=claude"], {
      cwd: repoRoot,
      encoding: "utf8",
      input: "not-json",
    });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "allow");
  });

  test("CLI denies secret read and allows docs write", () => {
    const denied = runHook({
      tool_name: "Read",
      tool_input: { file_path: join(repoRoot, ".env") },
    });
    assert.equal(denied.status, 0);
    assert.equal(denied.parsed.hookSpecificOutput.permissionDecision, "deny");

    const allowed = runHook(
      {
        tool_name: "Write",
        tool_input: { file_path: join(repoRoot, "docs/intent/_TEMPLATE.md") },
      },
      {},
      "cursor",
    );
    assert.equal(allowed.status, 0);
    assert.equal(allowed.parsed.permission, "allow");
  });

  test("CLI test lock env blocks spec writes", () => {
    const result = runHook(
      {
        tool_name: "Edit",
        tool_input: { file_path: join(repoRoot, "apps/app/scripts/foo.test.ts") },
      },
      { ONMYAGENT_LOCK_TEST_EDITS: "1" },
    );
    assert.equal(result.parsed.hookSpecificOutput.permissionDecision, "deny");
    assert.match(result.parsed.hookSpecificOutput.permissionDecisionReason, /Test lock/);
  });

  test("harness configs invoke the shared hook, not a forked copy", () => {
    const claude = readFileSync(join(repoRoot, ".claude/settings.json"), "utf8");
    const cursor = readFileSync(join(repoRoot, ".cursor/hooks.json"), "utf8");
    const codex = readFileSync(join(repoRoot, ".codex/hooks.json"), "utf8");
    for (const text of [claude, cursor, codex]) {
      assert.match(text, /\.agents\/hooks\/pretooluse\.mjs/);
    }
    assert.match(claude, /--format=claude/);
    assert.match(cursor, /--format=cursor/);
    assert.match(codex, /--format=codex/);
  });
});
