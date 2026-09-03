import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import pty from "node-pty";

import { resolveInAppTerminalShell } from "./code-terminal-shell.mjs";

// node-pty ships `spawn-helper` binaries under prebuilds/. Packaging (and
// pnpm) can drop the executable bit. In a packaged Electron app,
// require.resolve("node-pty") points inside app.asar; asar is read-only, so
// chmod there throws and used to be swallowed — the real file lives under
// app.asar.unpacked and stays -rw-r--r--. pty.spawn then fails with
// `posix_spawnp failed.`
export function toAsarUnpackedPath(filePath) {
  const asarSeg = `${path.sep}app.asar${path.sep}`;
  const unpackedSeg = `${path.sep}app.asar.unpacked${path.sep}`;
  const index = filePath.indexOf(asarSeg);
  if (index === -1) return filePath;
  return `${filePath.slice(0, index)}${unpackedSeg}${filePath.slice(index + asarSeg.length)}`;
}

function restoreExecutableBit(filePath) {
  if (!existsSync(filePath)) return false;
  const mode = statSync(filePath).mode;
  if ((mode & 0o111) === 0) chmodSync(filePath, mode | 0o755);
  return true;
}

function spawnHelperPlatformDir(platform = process.platform, arch = process.arch) {
  if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  if (platform === "linux") return arch === "arm64" ? "linux-arm64" : "linux-x64";
  return null;
}

function ensureSpawnHelperExecutable() {
  if (process.platform === "win32") return;
  try {
    const requireFromHere = createRequire(import.meta.url);
    const ptyEntry = requireFromHere.resolve("node-pty");
    const ptyRoot = path.dirname(path.dirname(ptyEntry));
    const platformDir = spawnHelperPlatformDir();
    if (!platformDir) return;
    const helper = path.join(ptyRoot, "prebuilds", platformDir, "spawn-helper");
    restoreExecutableBit(toAsarUnpackedPath(helper)) || restoreExecutableBit(helper);
  } catch {
    // Non-fatal: if we cannot chmod, node-pty will still surface its own error.
  }
}
ensureSpawnHelperExecutable();

const OUTPUT_LIMIT = 1_000_000;
const DEFAULT_COLS = 96;
const DEFAULT_ROWS = 28;

function terminalShell() {
  return resolveInAppTerminalShell();
}

function terminalEnv() {
  return {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    PAGER: "cat",
    GIT_PAGER: "cat",
  };
}

function appendOutput(terminal, value) {
  terminal.output += String(value);
  if (terminal.output.length > OUTPUT_LIMIT) {
    terminal.output = terminal.output.slice(-OUTPUT_LIMIT);
  }
  terminal.revision += 1;
}

export function createCodeTerminalManager() {
  const terminals = new Map();

  const create = async ({ workspacePath }) => {
    const cwd = path.resolve(String(workspacePath || os.homedir()));
    const shell = terminalShell();
    const terminalId = randomUUID();
    const terminal = {
      terminalId,
      cwd,
      title: path.basename(cwd) || shell.label,
      shell: shell.label,
      output: "",
      revision: 0,
      running: true,
      exitCode: null,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      pty: null,
    };
    terminal.pty = pty.spawn(shell.command, shell.args, {
      name: "xterm-256color",
      cols: terminal.cols,
      rows: terminal.rows,
      cwd,
      env: terminalEnv(),
    });
    terminal.pty.onData((data) => {
      appendOutput(terminal, data);
    });
    terminal.pty.onExit((event) => {
      terminal.running = false;
      terminal.exitCode = event.exitCode;
      terminal.revision += 1;
    });
    terminals.set(terminalId, terminal);
    return {
      terminalId,
      cwd,
      title: terminal.title,
      shell: terminal.shell,
      cols: terminal.cols,
      rows: terminal.rows,
    };
  };

  const write = ({ terminalId, data }) => {
    const terminal = terminals.get(String(terminalId || ""));
    if (!terminal) throw new Error("Terminal does not exist.");
    if (!terminal.running) throw new Error("Terminal has exited.");
    terminal.pty.write(String(data ?? ""));
    return { ok: true };
  };

  const resize = ({ terminalId, cols, rows }) => {
    const terminal = terminals.get(String(terminalId || ""));
    if (!terminal) throw new Error("Terminal does not exist.");
    const nextCols = Math.max(2, Math.floor(Number(cols) || DEFAULT_COLS));
    const nextRows = Math.max(2, Math.floor(Number(rows) || DEFAULT_ROWS));
    terminal.cols = nextCols;
    terminal.rows = nextRows;
    if (terminal.running) terminal.pty.resize(nextCols, nextRows);
    terminal.revision += 1;
    return { ok: true };
  };

  const snapshot = ({ terminalId }) => {
    const terminal = terminals.get(String(terminalId || ""));
    if (!terminal) throw new Error("Terminal does not exist.");
    return {
      terminalId: terminal.terminalId,
      cwd: terminal.cwd,
      title: terminal.title,
      shell: terminal.shell,
      cols: terminal.cols,
      rows: terminal.rows,
      output: terminal.output,
      revision: terminal.revision,
      running: terminal.running,
      exitCode: terminal.exitCode,
    };
  };

  const close = ({ terminalId }) => {
    const id = String(terminalId || "");
    const terminal = terminals.get(id);
    if (!terminal) return { ok: true };
    terminals.delete(id);
    if (terminal.running) terminal.pty.kill();
    return { ok: true };
  };

  const dispose = () => {
    for (const terminal of terminals.values()) {
      if (terminal.running) terminal.pty.kill();
    }
    terminals.clear();
  };

  return { create, write, resize, snapshot, close, dispose };
}
