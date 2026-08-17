import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  defaultWorkspaceOnMyAgentConfig,
  envFlagEnabled,
  execResult,
  extractDescription,
  extractFrontmatterMap,
  extractFrontmatterValue,
  extractTrigger,
  forwardedDeepLinks,
  isTransientNetworkError,
  normalizeDesktopBootstrapConfig,
  normalizeWorkspaceEntry,
  resolveCommandsDir,
  resolveOpencodeConfigPath,
} from "./desktop-main-helpers.mjs";

test("isTransientNetworkError matches TLS/proxy blips", () => {
  assert.equal(
    isTransientNetworkError(
      new Error("Client network socket disconnected before secure TLS connection was established"),
    ),
    true,
  );
  assert.equal(isTransientNetworkError({ code: "ECONNRESET" }), true);
  assert.equal(isTransientNetworkError(new Error("unexpected crash")), false);
  assert.equal(isTransientNetworkError(null), false);
});

test("isNonFatalDesktopSpawnError matches missing editor/terminal binaries", async () => {
  const { isNonFatalDesktopSpawnError } = await import("./desktop-main-helpers.mjs");
  assert.equal(isNonFatalDesktopSpawnError({ code: "ENOENT", message: "spawn code ENOENT" }), true);
  assert.equal(isNonFatalDesktopSpawnError(new Error("spawn open ENOENT")), true);
  assert.equal(isNonFatalDesktopSpawnError(new Error("spawn cursor.cmd ENOENT")), true);
  assert.equal(isNonFatalDesktopSpawnError({ code: "ENOENT", message: "spawn opencode.exe ENOENT" }), false);
  assert.equal(isNonFatalDesktopSpawnError({ code: "ENOENT" }), false);
  assert.equal(isNonFatalDesktopSpawnError(new Error("unexpected crash")), false);
});

test("envFlagEnabled accepts common truthy tokens", () => {
  assert.equal(envFlagEnabled("X", { X: "1" }), true);
  assert.equal(envFlagEnabled("X", { X: "true" }), true);
  assert.equal(envFlagEnabled("X", { X: "no" }), false);
  assert.equal(envFlagEnabled("X", {}), false);
});

test("forwardedDeepLinks filters protocol URLs from argv", () => {
  assert.deepEqual(
    forwardedDeepLinks([
      "electron",
      "onmyagent://open",
      "--flag",
      "https://app.example/x",
      "file:///tmp",
    ]),
    ["onmyagent://open", "https://app.example/x"],
  );
});

test("execResult defaults status from ok", () => {
  assert.deepEqual(execResult(true, "out"), {
    ok: true,
    status: 0,
    stdout: "out",
    stderr: "",
  });
  assert.deepEqual(execResult(false, "", "err", 2), {
    ok: false,
    status: 2,
    stdout: "",
    stderr: "err",
  });
});

test("normalizeDesktopBootstrapConfig requires baseUrl", () => {
  assert.throws(() => normalizeDesktopBootstrapConfig({}), /baseUrl is required/);
  assert.deepEqual(
    normalizeDesktopBootstrapConfig(
      { baseUrl: " https://app.example ", requireSignin: false },
      { forceRequireSignin: true },
    ),
    {
      baseUrl: "https://app.example",
      apiBaseUrl: null,
      requireSignin: true,
    },
  );
});

test("normalizeWorkspaceEntry defaults local shape", () => {
  const entry = normalizeWorkspaceEntry({ id: "ws1", name: "Demo" });
  assert.equal(entry.id, "ws1");
  assert.equal(entry.workspaceType, "local");
  assert.equal(entry.preset, "starter");
  assert.equal(entry.path, "");
});

test("defaultWorkspaceOnMyAgentConfig shapes authorized roots", () => {
  const cfg = defaultWorkspaceOnMyAgentConfig("/tmp/ws", "starter");
  assert.equal(cfg.version, 1);
  assert.equal(cfg.workspace.name, "ws");
  assert.equal(cfg.workspace.preset, "starter");
  assert.deepEqual(cfg.authorizedRoots, ["/tmp/ws"]);
});

test("resolveOpencodeConfigPath and resolveCommandsDir", () => {
  const globalRoot = "/home/user/.config/opencode";
  assert.deepEqual(resolveOpencodeConfigPath("global", null, globalRoot), {
    jsoncPath: path.join(globalRoot, "opencode.jsonc"),
    jsonPath: path.join(globalRoot, "opencode.json"),
  });
  assert.equal(
    resolveCommandsDir("workspace", "/proj", globalRoot),
    path.join("/proj", ".opencode", "commands"),
  );
  assert.equal(
    resolveCommandsDir("global", null, globalRoot),
    path.join(globalRoot, "commands"),
  );
  assert.throws(() => resolveOpencodeConfigPath("project", "", globalRoot), /projectDir/);
  assert.throws(
    () => resolveCommandsDir(/** @type {any} */ ("other"), "/p", globalRoot),
    /workspace/,
  );
});

test("skill frontmatter extractors", () => {
  const raw = `---
description: "Hello skill"
trigger: "on-boot"
display_name_zh: 你好
---

# Title

Body line.
`;
  assert.equal(extractFrontmatterValue(raw, ["trigger"]), "on-boot");
  assert.equal(extractTrigger(raw), "on-boot");
  assert.equal(extractDescription(raw), "Hello skill");
  assert.equal(extractFrontmatterMap(raw, ["display_name_zh"]).display_name_zh, "你好");
  assert.equal(
    extractDescription("# Title only\n\nFirst body line"),
    "First body line",
  );
});

test("skill frontmatter folds YAML block scalars (no literal >-)", () => {
  const raw = `---
name: find-skills
display_name_zh: 发现技能
description: >-
  Discover which OnMyAgent skills are installed
  and when to use them.
description_zh: >-
  发现已安装技能
  及适用场景
---

# Find Skills
`;
  const map = extractFrontmatterMap(raw, [
    "name",
    "display_name_zh",
    "description",
    "description_zh",
  ]);
  assert.equal(map.display_name_zh, "发现技能");
  assert.match(map.description, /Discover which OnMyAgent skills/);
  assert.doesNotMatch(map.description, /^>-?$/);
  assert.match(map.description_zh, /发现已安装技能/);
  assert.doesNotMatch(map.description_zh ?? "", /^>-?$/);
  assert.equal(
    extractDescription(raw).startsWith("Discover which OnMyAgent skills"),
    true,
  );
});
