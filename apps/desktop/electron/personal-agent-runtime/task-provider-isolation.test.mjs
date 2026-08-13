import assert from "node:assert/strict";
import test from "node:test";

import {
  isolateTaskProviderEnvironment,
  TASK_CODEX_DISABLED_NATIVE_FEATURES,
  TASK_OPENCODE_DISABLED_NATIVE_TOOLS,
} from "./task-provider-isolation.mjs";
import { __test__ as acpGenericTest } from "./adapters/acp-generic.mjs";

test("Task Codex environment disables provider-native delegation without dropping existing config", () => {
  const isolated = isolateTaskProviderEnvironment({
    PATH: "/bin",
    CODEX_CONFIG: JSON.stringify({
      model: "gpt-test",
      features: { apps: true, multi_agent: true, multi_agent_v2: true },
    }),
  }, { provider: "codex", taskId: "task_safe" });

  assert.equal(isolated.PATH, "/bin");
  assert.deepEqual(JSON.parse(isolated.CODEX_CONFIG), {
    model: "gpt-test",
    features: { apps: true, multi_agent: false, multi_agent_v2: false },
  });
  assert.deepEqual(TASK_CODEX_DISABLED_NATIVE_FEATURES, ["multi_agent", "multi_agent_v2"]);
});

test("ordinary Personal sessions and non-Codex Task sessions do not receive Codex overrides", () => {
  const original = { CODEX_CONFIG: "not-json", PATH: "/bin" };
  assert.equal(isolateTaskProviderEnvironment(original, { provider: "codex", taskId: null }), original);
  assert.equal(isolateTaskProviderEnvironment(original, { provider: "claude", taskId: "task_safe" }), original);
});

test("Task Codex isolation fails closed on malformed inherited config without exposing it", () => {
  const secretMarker = "secret-marker-that-must-not-appear";
  assert.throws(
    () => isolateTaskProviderEnvironment({ CODEX_CONFIG: `{${secretMarker}` }, { provider: "codex", taskId: "task_safe" }),
    (error) => {
      assert.match(error.message, /requires CODEX_CONFIG to be a JSON object/);
      assert.doesNotMatch(error.message, new RegExp(secretMarker));
      return true;
    },
  );
});

test("generic ACP spawn environment applies Codex isolation only to Task runs", () => {
  const inherited = JSON.stringify({ model: "gpt-test", features: { apps: true, multi_agent: true, multi_agent_v2: true } });
  const taskEnvironment = acpGenericTest.processEnvironmentForContext(
    { agent: { provider: "codex" }, taskId: "task_safe" },
    "/tmp/task-safe",
    { CODEX_HOME: "/tmp/onmyagent-missing-codex-home", CODEX_CONFIG: inherited },
  );
  assert.deepEqual(JSON.parse(taskEnvironment.CODEX_CONFIG), {
    model: "gpt-test",
    features: { apps: true, multi_agent: false, multi_agent_v2: false },
  });
  const personalEnvironment = acpGenericTest.processEnvironmentForContext(
    { agent: { provider: "codex" } },
    "/tmp/personal",
    { CODEX_HOME: "/tmp/onmyagent-missing-codex-home", CODEX_CONFIG: inherited },
  );
  assert.equal(personalEnvironment.CODEX_CONFIG, inherited);
  const openCodeTaskEnvironment = acpGenericTest.processEnvironmentForContext(
    { agent: { provider: "opencode" }, taskId: "task_safe" },
    "/tmp/task-safe",
    { OPENCODE_CONFIG_CONTENT: JSON.stringify({ tools: { task: true, read: true } }) },
  );
  assert.deepEqual(JSON.parse(openCodeTaskEnvironment.OPENCODE_CONFIG_CONTENT).tools, { task: false, read: true });
});

test("generic ACP spawn keeps the Personal provider environment after OpenCode replaces global HOME", () => {
  const providerEnvironment = {
    HOME: "/Users/example",
    XDG_CONFIG_HOME: "/Users/example/.config",
    PATH: "/provider/bin:/usr/bin",
  };
  const previousHome = process.env.HOME;
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  try {
    process.env.HOME = "/tmp/onmyagent/opencode-sandbox/home";
    process.env.XDG_CONFIG_HOME = "/tmp/onmyagent/opencode-sandbox/xdg/config";
    const environment = acpGenericTest.processEnvironmentForContext(
      { agent: { provider: "codex" }, providerEnvironment },
      "/tmp/personal",
    );
    assert.equal(environment.HOME, "/Users/example");
    assert.equal(environment.XDG_CONFIG_HOME, "/Users/example/.config");
    assert.equal(environment.PATH.startsWith("/provider/bin"), true);
    assert.equal(environment.PWD, "/tmp/personal");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
  }
});

test("Task Claude ACP sessions pass native delegation deny-list while ordinary sessions stay unchanged", () => {
  assert.deepEqual(acpGenericTest.taskSessionOptions({ taskId: "task_safe" }, "claude"), {
    _meta: { claudeCode: { options: { disallowedTools: ["Agent", "Task"] } } },
  });
  assert.deepEqual(acpGenericTest.taskSessionOptions({}, "claude"), {});
  assert.deepEqual(acpGenericTest.taskSessionOptions({ taskId: "task_safe" }, "codex"), {});
});

test("Task OpenCode environment disables only the native task tool and preserves ordinary config", () => {
  const isolated = isolateTaskProviderEnvironment({
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: "gpt-test", tools: { read: true, task: true } }),
  }, { provider: "opencode", taskId: "task_safe" });
  assert.deepEqual(JSON.parse(isolated.OPENCODE_CONFIG_CONTENT), {
    model: "gpt-test",
    tools: { read: true, task: false },
  });
  assert.deepEqual(TASK_OPENCODE_DISABLED_NATIVE_TOOLS, ["task"]);
  const ordinary = { OPENCODE_CONFIG_CONTENT: "not-json" };
  assert.equal(isolateTaskProviderEnvironment(ordinary, { provider: "opencode" }), ordinary);
  assert.throws(
    () => isolateTaskProviderEnvironment(ordinary, { provider: "opencode", taskId: "task_safe" }),
    /Task OpenCode isolation requires OPENCODE_CONFIG_CONTENT to be a JSON object/,
  );
});
