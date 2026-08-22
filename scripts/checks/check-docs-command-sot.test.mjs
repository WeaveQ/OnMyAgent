import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  checkDocsCommandSot,
  TEST_GATE_REQUIRED_BRANCHES,
} from "./check-docs-command-sot.mjs";

test("shipped docs and skills match the live command and settings SoT", () => {
  const result = checkDocsCommandSot();
  assert.deepEqual(result.findings, []);
  assert.equal(result.ok, true);
  assert.ok(TEST_GATE_REQUIRED_BRANCHES.includes("dev"));
  assert.ok(TEST_GATE_REQUIRED_BRANCHES.includes("release/0.6"));
});

test("SoT checker rejects stale Files/memory/isolation/Appshot/data-flow claims", () => {
  const source = readFileSync(new URL("./check-docs-command-sot.mjs", import.meta.url), "utf8");
  for (const needle of [
    String.raw`默认打开 Tab[：:].*用户上传`,
    "文件跟工作区、不跟会话陪葬",
    "删会话默认留生成文件",
    "默认 `autoCaptureMode = confirm_first`",
    String.raw`isolationVersion.*current \*\*2\*\*`,
    "Appshot is macOS-only",
    String.raw`opencode\.ts\(SDK\) ← opencode binary`,
    String.raw`OpenCode \+ approval router \/ Slack \/ Telegram`,
    "`#task`/`/task`",
    "Composer Appshot",
    "非产品目标",
    "勿当支持承诺",
    "enabled=false",
    "autoCapture=false",
    "applyAutoCaptureMemory",
    "P0 row missing landed C1 unlink",
    "session-archive-resume",
    "useArchiveResume",
    "Dual Runtime missing archive-resume named exception",
    "orchestrator must spawn the onmyagent-server binary declared in package.json",
  ]) {
    assert.ok(source.includes(needle), needle);
  }
});
