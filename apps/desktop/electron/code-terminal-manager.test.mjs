import assert from "node:assert/strict";
import test from "node:test";

import { resolveInAppTerminalShell } from "./code-terminal-shell.mjs";

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
