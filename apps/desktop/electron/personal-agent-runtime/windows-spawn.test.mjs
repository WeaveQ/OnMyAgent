import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createExecHelpers } from "./utils.mjs";
import {
  buildWindowsCmdSpawnSpec,
  escapeWindowsCmdArgument,
  escapeWindowsCmdCommand,
  isNodeModulesCmdShim,
  isWindowsCmdShim,
} from "./windows-spawn.mjs";

test("recognizes Windows command shims without affecting other platforms", () => {
  assert.equal(isWindowsCmdShim("C:\\Program Files\\agent.cmd", "win32"), true);
  assert.equal(isWindowsCmdShim("C:\\Program Files\\agent.bat", "win32"), true);
  assert.equal(isWindowsCmdShim("C:\\Program Files\\agent.exe", "win32"), false);
  assert.equal(isWindowsCmdShim("/tmp/agent.cmd", "darwin"), false);
});

test("escapes cmd metacharacters in the command and arguments", () => {
  assert.equal(escapeWindowsCmdCommand("C:\\tools\\agent & helper.cmd"), "C:\\tools\\agent^ ^&^ helper.cmd");
  const escaped = escapeWindowsCmdArgument('a & b | c "quoted" %PATH%', { doubleEscapeMetaCharacters: false });
  assert.match(escaped, /^\^"/);
  assert.match(escaped, /\^&/);
  assert.match(escaped, /\^\|/);
  assert.match(escaped, /\^%PATH\^%/);
  assert.match(escaped, /\\\^"quoted\\\^"/);
});

test("builds an explicit cmd.exe spawn spec with verbatim Windows arguments", () => {
  const spec = buildWindowsCmdSpawnSpec("C:\\Program Files\\agent.cmd", ["--workspace", "C:\\safe folder", "$(not shell)"]);
  assert.equal(spec.command, process.env.ComSpec || process.env.COMSPEC || "cmd.exe");
  assert.deepEqual(spec.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.match(spec.args[3], /^"C:\\Program\^ Files\\agent\.cmd /);
  assert.ok(spec.args[3].includes("$^(not^ shell^)^\""));
  assert.equal(spec.windowsVerbatimArguments, true);
});

test("double-escapes only npm command shims and honors the caller environment", () => {
  const ordinary = buildWindowsCmdSpawnSpec("C:\\tools\\agent.bat", ["a & b"], { env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" } });
  const npmShim = buildWindowsCmdSpawnSpec("C:\\tools\\node_modules\\.bin\\agent.cmd", ["a & b"]);
  assert.equal(isNodeModulesCmdShim("C:\\tools\\node_modules\\.bin\\agent.cmd"), true);
  assert.equal(isNodeModulesCmdShim("C:\\tools\\agent.bat"), false);
  assert.equal(ordinary.command, "C:\\Windows\\System32\\cmd.exe");
  assert.match(ordinary.args[3], /\^&/);
  assert.doesNotMatch(ordinary.args[3], /\^\^\^&/);
  assert.match(npmShim.args[3], /\^\^\^&/);
});

test("executes a cmd shim without changing metacharacter arguments on Windows", { skip: process.platform !== "win32" }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "onmyagent-windows-spawn-"));
  try {
    const fixture = path.join(dir, "echo-args.mjs");
    const command = path.join(dir, "agent shim.cmd");
    await writeFile(fixture, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n", "utf8");
    await writeFile(command, `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`, "utf8");
    const args = [
      "plain",
      "space value",
      "a & b",
      "a | b",
      "100% literal",
      "bang! literal",
      "caret^ literal",
      "(group)",
      'quote"value',
      "trailing\\",
    ];
    const result = await createExecHelpers().runCommandCapture(command, args, {
      cwd: dir,
      timeoutMs: 5_000,
    });
    assert.equal(result.ok, true, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), args);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("cmd shim timeout kills its descendant process tree on Windows", { skip: process.platform !== "win32" }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "onmyagent-windows-timeout-"));
  try {
    const fixture = path.join(dir, "long-lived.mjs");
    const command = path.join(dir, "long lived.cmd");
    const pidFile = path.join(dir, "child.pid");
    await writeFile(
      fixture,
      'import { writeFileSync } from "node:fs";\nwriteFileSync(process.argv[2], String(process.pid));\nsetInterval(() => undefined, 1_000);\n',
      "utf8",
    );
    await writeFile(command, `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`, "utf8");
    const startedAt = Date.now();
    const result = await createExecHelpers().runCommandCapture(command, [pidFile], {
      cwd: dir,
      timeoutMs: 750,
    });
    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    assert.ok(Date.now() - startedAt < 5_000, "timeout should settle after bounded tree cleanup");
    const descendantPid = Number((await readFile(pidFile, "utf8")).trim());
    let alive = true;
    for (let attempt = 0; attempt < 20 && alive; attempt += 1) {
      try {
        process.kill(descendantPid, 0);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false, `expected descendant pid ${descendantPid} to be terminated`);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
