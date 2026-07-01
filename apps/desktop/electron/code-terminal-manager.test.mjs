import assert from "node:assert/strict";
import test from "node:test";

import { createCodeTerminalManager } from "./code-terminal-manager.mjs";

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
      if (Date.now() - startedAt > 4_000) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for terminal output: ${expected}`));
      }
    }, 25);
  });
}

test("runs commands and preserves changed working directory", async () => {
  const manager = createCodeTerminalManager();
  const terminal = await manager.create({ workspacePath: process.cwd() });
  try {
    manager.write({ terminalId: terminal.terminalId, data: "printf terminal-test-ok\n" });
    await waitForOutput(manager, terminal.terminalId, "terminal-test-ok");
    manager.write({ terminalId: terminal.terminalId, data: "cd apps\npwd\n" });
    await waitForOutput(
      manager,
      terminal.terminalId,
      `${process.cwd()}/apps`,
    );
  } finally {
    manager.close({ terminalId: terminal.terminalId });
  }
});

test("resizes a terminal pty", async () => {
  const manager = createCodeTerminalManager();
  const terminal = await manager.create({ workspacePath: process.cwd() });
  try {
    manager.resize({ terminalId: terminal.terminalId, cols: 120, rows: 33 });
    const snapshot = manager.snapshot({ terminalId: terminal.terminalId });
    assert.equal(snapshot.cols, 120);
    assert.equal(snapshot.rows, 33);
  } finally {
    manager.close({ terminalId: terminal.terminalId });
  }
});

test("closing a terminal removes it", async () => {
  const manager = createCodeTerminalManager();
  const terminal = await manager.create({ workspacePath: process.cwd() });
  manager.close({ terminalId: terminal.terminalId });
  assert.throws(
    () => manager.snapshot({ terminalId: terminal.terminalId }),
    /does not exist/,
  );
});
