import assert from "node:assert/strict";
import test from "node:test";

import { createCodeTerminalManager } from "./code-terminal-manager.mjs";
import { resolveInAppTerminalShell } from "./code-terminal-shell.mjs";

function waitForOutput(manager, terminalId, expected) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const snapshot = manager.snapshot({ terminalId });
      if (snapshot.output.includes(expected)) {
        clearInterval(timer);
        resolve(snapshot);
        return;
      }
      if (Date.now() - startedAt > 6_000) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for terminal output: ${expected}`));
      }
    }, 40);
  });
}

test("Windows in-app terminal defaults to PowerShell, not COMSPEC", () => {
  const shell = resolveInAppTerminalShell({
    platform: "win32",
    env: { SystemRoot: "C:\\Windows", COMSPEC: "C:\\Windows\\System32\\cmd.exe" },
  });
  assert.match(shell.command.replaceAll("/", "\\"), /WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.deepEqual(shell.args, ["-NoLogo"]);
  assert.equal(shell.label, "powershell.exe");
});

test("ONMYAGENT_TERMINAL_SHELL overrides the Windows default", () => {
  const shell = resolveInAppTerminalShell({
    platform: "win32",
    env: { ONMYAGENT_TERMINAL_SHELL: "C:\\custom\\pwsh.exe" },
  });
  assert.equal(shell.command, "C:\\custom\\pwsh.exe");
  assert.equal(shell.label, "pwsh.exe");
});

test("create/write/close smoke (skip if pty cannot spawn)", async (t) => {
  let manager;
  try {
    manager = createCodeTerminalManager();
    const terminal = await manager.create({ workspacePath: process.cwd() });
    const probe = process.platform === "win32" ? "echo terminal-test-ok\r\n" : "printf terminal-test-ok\n";
    manager.write({ terminalId: terminal.terminalId, data: probe });
    await waitForOutput(manager, terminal.terminalId, "terminal-test-ok");
    manager.close({ terminalId: terminal.terminalId });
    assert.throws(
      () => manager.snapshot({ terminalId: terminal.terminalId }),
      /does not exist/,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/posix_spawnp|conpty|winpty|pty|spawn helper/i.test(message)) {
      t.skip(message);
      return;
    }
    throw error;
  } finally {
    manager?.dispose?.();
  }
});
