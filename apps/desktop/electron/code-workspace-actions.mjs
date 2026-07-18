import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let runtimeManager = null;
let shell = null;
let isDirectory = null;
let personalAgentLegacyHarness = null;

export function createCodeWorkspaceActions(dependencies) {
  runtimeManager = dependencies.runtimeManager;
  shell = dependencies.shell;
  isDirectory = dependencies.isDirectory;
  personalAgentLegacyHarness = dependencies.personalAgentLegacyHarness;
  return {
    codeWorkspaceOpenTargets,
    codeWorkspaceEnvironment,
    openCodeWorkspace,
    resolveCodeWorkspacePath,
    codeWorkspaceGitSwitchBranch,
    codeWorkspaceGitCommit,
    codeWorkspaceGitPush,
  };
}

function commandExists(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

/**
 * Quote a path for embedding in a Windows cmd.exe /K command string.
 * @param {string} value
 */
export function quoteWindowsCmdArg(value) {
  const text = String(value ?? "");
  if (!/[ \t"&<>|^]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Quote a path for embedding in a PowerShell -Command string (single-quoted literal).
 * @param {string} value
 */
export function quoteWindowsPowerShellLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

/**
 * Pure decision helper for the Windows "open terminal in workspace" cascade:
 * Windows Terminal (`wt.exe -d`) → PowerShell (`Set-Location`) → cmd (`/K cd /D`).
 * Never uses `start "" <path>` (file-association / Explorer open).
 *
 * @param {string} workspacePath
 * @param {{ hasCommand?: (name: string) => boolean }} [options]
 * @returns {{ command: string; args: string[]; strategy: "wt" | "powershell" | "cmd" }}
 */
export function resolveWindowsTerminalLaunch(workspacePath, options = {}) {
  const hasCommand =
    typeof options.hasCommand === "function"
      ? options.hasCommand
      : (name) => Boolean(commandPath(name));
  // Caller already path.resolve()'d on the host platform; do not re-resolve so
  // unit tests can pass Windows-style paths on non-Windows CI hosts.
  const resolved = String(workspacePath ?? "").trim();

  if (hasCommand("wt.exe") || hasCommand("wt")) {
    return {
      command: "wt.exe",
      args: ["-d", resolved],
      strategy: "wt",
    };
  }

  if (hasCommand("powershell.exe") || hasCommand("powershell")) {
    return {
      command: "powershell.exe",
      args: ["-NoExit", "-Command", `Set-Location -LiteralPath ${quoteWindowsPowerShellLiteral(resolved)}`],
      strategy: "powershell",
    };
  }

  return {
    command: "cmd.exe",
    args: ["/K", `cd /D ${quoteWindowsCmdArg(resolved)}`],
    strategy: "cmd",
  };
}

export function resolveEditorCommand() {
  const configured = process.env.ONMYAGENT_EDITOR || process.env.VISUAL || process.env.EDITOR;
  if (configured && commandExists(configured)) return configured;
  if (commandExists("cursor")) return "cursor";
  if (commandExists("code")) return "code";
  return null;
}

function commandPath(command) {
  if (!/^[A-Za-z0-9_.-]+$/.test(command)) return null;
  const resolver = process.platform === "win32" ? "where.exe" : "sh";
  const args = process.platform === "win32" ? [command] : ["-c", `command -v ${command}`];
  const result = spawnSync(resolver, args, { encoding: "utf8" });
  if (result.status !== 0) return null;
  return String(result.stdout ?? "").trim().split(/\r?\n/)[0] || null;
}

function normalizeDesktopPlatform() {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "windows";
  return "linux";
}

const CODE_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CODE_ENV_RESERVED_PREFIXES = ["ONMYAGENT_", "OPENCODE_"];
const codeWorkspaceSessionBaselines = new Map();

function resolveCodeUserEnvFilePath() {
  const override = String(process.env.ONMYAGENT_ENV_STORE ?? "").trim();
  if (override) return path.resolve(override);
  if (process.platform === "win32") {
    const appData = String(process.env.APPDATA ?? "").trim();
    const root = appData || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(root, "onmyagent", "env.json");
  }
  return path.join(os.homedir(), ".config", "onmyagent", "env.json");
}

const CODE_WORKSPACE_OPEN_TARGETS = [
  {
    id: "vscode",
    label: "VS Code",
    commands: ["code"],
    macApps: ["/Applications/Visual Studio Code.app"],
    macOpenName: "Visual Studio Code",
  },
  {
    id: "cursor",
    label: "Cursor",
    commands: ["cursor"],
    macApps: ["/Applications/Cursor.app"],
    macOpenName: "Cursor",
  },
  { id: "finder", label: "Finder", builtin: true },
  {
    id: "terminal",
    label: "Terminal",
    commands: ["open", "gnome-terminal", "konsole", "x-terminal-emulator", "cmd.exe"],
    builtin: process.platform === "darwin" || process.platform === "win32",
  },
  {
    id: "xcode",
    label: "Xcode",
    commands: ["xed"],
    macApps: ["/Applications/Xcode.app"],
    macOpenName: "Xcode",
  },
  {
    id: "android-studio",
    label: "Android Studio",
    commands: ["studio", "android-studio"],
    macApps: ["/Applications/Android Studio.app"],
    macOpenName: "Android Studio",
  },
];

function resolveCodeWorkspaceOpenTarget(target) {
  if (target.builtin) {
    return { available: true, command: null, path: null, reason: null };
  }
  for (const command of target.commands ?? []) {
    const resolved = commandPath(command);
    if (resolved) return { available: true, command, path: resolved, reason: null };
  }
  if (process.platform === "darwin") {
    for (const appPath of target.macApps ?? []) {
      if (existsSync(appPath)) {
        return { available: true, command: "open", path: appPath, reason: null };
      }
    }
  }
  return {
    available: false,
    command: null,
    path: null,
    reason: `${target.label} is not installed or not available in PATH.`,
  };
}

function codeWorkspaceOpenTargets() {
  return {
    platform: normalizeDesktopPlatform(),
    targets: CODE_WORKSPACE_OPEN_TARGETS.map((target) => ({
      id: target.id,
      label: target.label,
      ...resolveCodeWorkspaceOpenTarget(target),
    })),
  };
}

function readCodeEnvironmentStoreSummary() {
  const storePath = resolveCodeUserEnvFilePath();
  try {
    const raw = readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw);
    const variables = Array.isArray(parsed?.variables) ? parsed.variables : [];
    const count = variables.filter((entry) => {
      const key = typeof entry?.key === "string" ? entry.key : "";
      return CODE_ENV_KEY_PATTERN.test(key) && !CODE_ENV_RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix));
    }).length;
    return { count, storePath };
  } catch {
    return { count: 0, storePath };
  }
}

function parseGitBranchStatus(stdout) {
  const firstLine = String(stdout ?? "").split(/\r?\n/)[0] ?? "";
  const branchMatch = firstLine.match(/^##\s+([^\.\[]+)/);
  const detachedMatch = firstLine.match(/^##\s+HEAD \(no branch\)/);
  const aheadMatch = firstLine.match(/ahead\s+(\d+)/);
  const behindMatch = firstLine.match(/behind\s+(\d+)/);
  return {
    branch: detachedMatch ? "HEAD" : (branchMatch?.[1]?.trim() || null),
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
    hasRemote: firstLine.includes("...") || firstLine.includes("["),
  };
}

async function readCodeGitSnapshot(workspacePath) {
  if (!workspacePath) {
    return {
      available: false,
      branch: null,
      dirty: false,
      ahead: 0,
      behind: 0,
      hasRemote: false,
      statusLabel: "No workspace",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      diff: "",
      branches: [],
      upstream: null,
      files: [],
    };
  }
  const result = await personalAgentLegacyHarness.runCommandCapture("git", ["status", "--porcelain=v1", "--branch"], {
    cwd: workspacePath,
    timeoutMs: 2500,
  });
  if (!result.ok) {
    return {
      available: false,
      branch: null,
      dirty: false,
      ahead: 0,
      behind: 0,
      hasRemote: false,
      statusLabel: "Git unavailable",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      diff: "",
      branches: [],
      upstream: null,
      files: [],
    };
  }
  const parsed = parseGitBranchStatus(result.stdout);
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  const dirty = lines.slice(1).length > 0;
  const statusParts = [];
  if (dirty) statusParts.push("uncommitted changes");
  if (parsed.ahead > 0) statusParts.push(`${parsed.ahead} ahead`);
  if (parsed.behind > 0) statusParts.push(`${parsed.behind} behind`);
  return {
    available: true,
    branch: parsed.branch,
    dirty,
    ahead: parsed.ahead,
    behind: parsed.behind,
    hasRemote: parsed.hasRemote,
    statusLabel: statusParts.length ? statusParts.join(", ") : "Clean",
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    diff: "",
    branches: [],
    upstream: null,
    files: [],
  };
}

async function writeCodeWorkspaceTree(workspacePath) {
  const indexPath = path.join(
    os.tmpdir(),
    `onmyagent-git-index-${process.pid}-${randomBytes(8).toString("hex")}`,
  );
  const env = personalAgentLegacyHarness.processEnv({
    GIT_INDEX_FILE: indexPath,
  });
  try {
    const readTree = await personalAgentLegacyHarness.runCommandCapture("git", ["read-tree", "HEAD"], {
      cwd: workspacePath,
      env,
      timeoutMs: 5000,
    });
    if (!readTree.ok) {
      const emptyTree = await personalAgentLegacyHarness.runCommandCapture("git", ["read-tree", "--empty"], {
        cwd: workspacePath,
        env,
        timeoutMs: 5000,
      });
      if (!emptyTree.ok) return null;
    }
    const add = await personalAgentLegacyHarness.runCommandCapture("git", ["add", "-A", "--", "."], {
      cwd: workspacePath,
      env,
      timeoutMs: 15000,
    });
    if (!add.ok) return null;
    const tree = await personalAgentLegacyHarness.runCommandCapture("git", ["write-tree"], {
      cwd: workspacePath,
      env,
      timeoutMs: 5000,
    });
    return tree.ok ? tree.stdout.trim() || null : null;
  } finally {
    await unlink(indexPath).catch(() => {});
  }
}

function parseCodeWorkspaceNumstat(stdout) {
  return String(stdout ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [additionsRaw, deletionsRaw, ...pathParts] = line.split("\t");
      const additions = Number(additionsRaw);
      const deletions = Number(deletionsRaw);
      return {
        path: pathParts.join("\t"),
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
      };
    })
    .filter((file) => file.path);
}

async function readCodeSessionGitSnapshot(workspacePath, sessionId) {
  const base = await readCodeGitSnapshot(workspacePath);
  if (!base.available) return base;
  const currentTree = await writeCodeWorkspaceTree(workspacePath);
  if (!currentTree) return base;
  const headTree = await personalAgentLegacyHarness.runCommandCapture(
    "git",
    ["rev-parse", "HEAD^{tree}"],
    { cwd: workspacePath, timeoutMs: 5000 },
  );
  const baselineTree = headTree.ok
    ? headTree.stdout.trim()
    : "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  const [numstat, diff, branches, upstream] = await Promise.all([
    personalAgentLegacyHarness.runCommandCapture("git", ["diff", "--numstat", baselineTree, currentTree], {
      cwd: workspacePath,
      timeoutMs: 8000,
    }),
    personalAgentLegacyHarness.runCommandCapture(
      "git",
      ["diff", "--no-ext-diff", "--no-color", "--find-renames", baselineTree, currentTree],
      { cwd: workspacePath, timeoutMs: 12000 },
    ),
    personalAgentLegacyHarness.runCommandCapture("git", ["branch", "--format=%(refname:short)"], {
      cwd: workspacePath,
      timeoutMs: 5000,
    }),
    personalAgentLegacyHarness.runCommandCapture(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      { cwd: workspacePath, timeoutMs: 5000 },
    ),
  ]);
  const files = numstat.ok ? parseCodeWorkspaceNumstat(numstat.stdout) : [];
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  return {
    ...base,
    additions,
    deletions,
    changedFiles: files.length,
    diff: diff.ok ? diff.stdout : "",
    branches: branches.ok
      ? branches.stdout.split(/\r?\n/).map((branch) => branch.trim()).filter(Boolean)
      : [],
    upstream: upstream.ok ? upstream.stdout.trim() || null : null,
    statusLabel:
      files.length > 0
        ? `${files.length} changed, +${additions} -${deletions}`
        : base.statusLabel,
    files,
  };
}

async function readCodeGithubCliSnapshot(workspacePath) {
  const version = await personalAgentLegacyHarness.runCommandCapture("gh", ["--version"], {
    cwd: workspacePath || undefined,
    timeoutMs: 2500,
  });
  if (!version.ok) {
    return {
      available: false,
      authenticated: false,
      username: null,
      statusLabel: "GitHub CLI unavailable",
    };
  }
  const auth = await personalAgentLegacyHarness.runCommandCapture("gh", ["auth", "status"], {
    cwd: workspacePath || undefined,
    timeoutMs: 3000,
  });
  if (!auth.ok) {
    return {
      available: true,
      authenticated: false,
      username: null,
      statusLabel: "GitHub CLI signed out",
    };
  }
  const user = await personalAgentLegacyHarness.runCommandCapture("gh", ["api", "user", "--jq", ".login"], {
    cwd: workspacePath || undefined,
    timeoutMs: 3000,
  });
  const username = user.ok ? user.stdout.trim().split(/\r?\n/)[0] || null : null;
  return {
    available: true,
    authenticated: true,
    username,
    statusLabel: username ? `GitHub CLI signed in as ${username}` : "GitHub CLI signed in",
  };
}

async function resolveCodeWorkspacePath(input = {}) {
  const explicit = String(input?.workspacePath ?? "").trim();
  if (explicit) return path.resolve(explicit);
  const engine = await runtimeManager.engineInfo();
  const runtimePath = String(engine.projectDir ?? "").trim();
  return runtimePath ? path.resolve(runtimePath) : null;
}

async function codeWorkspaceEnvironment(input = {}) {
  const workspacePath = await resolveCodeWorkspacePath(input);
  const validWorkspacePath = workspacePath && (await isDirectory(workspacePath)) ? workspacePath : null;
  const environment = readCodeEnvironmentStoreSummary();
  const [git, githubCli] = await Promise.all([
    readCodeSessionGitSnapshot(
      validWorkspacePath,
      String(input?.sessionId ?? "").trim(),
    ),
    readCodeGithubCliSnapshot(validWorkspacePath),
  ]);
  const sources = [];
  if (validWorkspacePath) {
    sources.push({ label: "Workspace", path: validWorkspacePath });
  }
  if (environment.storePath) {
    sources.push({ label: "Environment store", path: environment.storePath });
  }
  return {
    workspacePath: validWorkspacePath,
    environment,
    git,
    githubCli,
    sources,
  };
}

async function codeWorkspaceGitSwitchBranch(input = {}) {
  const workspacePath = await resolveCodeWorkspacePath(input);
  const branch = String(input?.branch ?? "").trim();
  const sessionId = String(input?.sessionId ?? "").trim();
  if (!workspacePath || !branch) {
    return { ok: false, reason: "Workspace and branch are required.", output: "" };
  }
  const status = await personalAgentLegacyHarness.runCommandCapture("git", ["status", "--porcelain"], {
    cwd: workspacePath,
    timeoutMs: 5000,
  });
  if (!status.ok) {
    return { ok: false, reason: status.stderr.trim() || "Git unavailable.", output: "" };
  }
  if (status.stdout.trim()) {
    return {
      ok: false,
      reason: "Commit or discard current changes before switching branches.",
      output: "",
    };
  }
  const result = await personalAgentLegacyHarness.runCommandCapture("git", ["switch", branch], {
    cwd: workspacePath,
    timeoutMs: 15000,
  });
  if (result.ok && sessionId) {
    const tree = await writeCodeWorkspaceTree(workspacePath);
    if (tree) codeWorkspaceSessionBaselines.set(`${workspacePath}\0${sessionId}`, tree);
  }
  return {
    ok: result.ok,
    reason: result.ok ? null : result.stderr.trim() || "Failed to switch branch.",
    output: result.stdout.trim(),
  };
}

async function codeWorkspaceGitPush(input = {}) {
  const workspacePath = await resolveCodeWorkspacePath(input);
  if (!workspacePath) {
    return { ok: false, reason: "Workspace is required.", output: "" };
  }
  const result = await personalAgentLegacyHarness.runCommandCapture("git", ["push"], {
    cwd: workspacePath,
    timeoutMs: 60000,
  });
  return {
    ok: result.ok,
    reason: result.ok ? null : result.stderr.trim() || "Failed to push changes.",
    output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
  };
}

async function codeWorkspaceGitCommit(input = {}) {
  const workspacePath = await resolveCodeWorkspacePath(input);
  const sessionId = String(input?.sessionId ?? "").trim();
  const message = String(input?.message ?? "").trim();
  if (!workspacePath || !message) {
    return { ok: false, reason: "Workspace and commit message are required.", output: "" };
  }
  const add = await personalAgentLegacyHarness.runCommandCapture("git", ["add", "-A"], {
    cwd: workspacePath,
    timeoutMs: 15000,
  });
  if (!add.ok) {
    return { ok: false, reason: add.stderr.trim() || "Failed to stage changes.", output: "" };
  }
  const commit = await personalAgentLegacyHarness.runCommandCapture("git", ["commit", "-m", message], {
    cwd: workspacePath,
    timeoutMs: 60000,
  });
  if (!commit.ok) {
    return {
      ok: false,
      reason: commit.stderr.trim() || commit.stdout.trim() || "Failed to commit changes.",
      output: "",
    };
  }
  let output = commit.stdout.trim();
  if (sessionId) {
    const tree = await writeCodeWorkspaceTree(workspacePath);
    if (tree) codeWorkspaceSessionBaselines.set(`${workspacePath}\0${sessionId}`, tree);
  }
  if (input?.push === true) {
    const pushed = await codeWorkspaceGitPush(input);
    if (!pushed.ok) {
      return {
        ok: false,
        reason: `Changes were committed, but push failed: ${pushed.reason ?? "Unknown push error."}`,
        output: [output, pushed.output].filter(Boolean).join("\n"),
      };
    }
    output = [output, pushed.output].filter(Boolean).join("\n");
  }
  return { ok: true, reason: null, output };
}

async function openCodeWorkspace(input = {}) {
  const targetId = String(input?.targetId ?? "").trim();
  let workspacePath = String(input?.workspacePath ?? "").trim();
  if (!workspacePath) {
    const engine = await runtimeManager.engineInfo();
    workspacePath = String(engine.projectDir ?? "").trim();
  }
  const target = CODE_WORKSPACE_OPEN_TARGETS.find((entry) => entry.id === targetId);
  if (!target) throw new Error("Unknown open target.");
  if (!workspacePath) throw new Error("workspacePath is required.");
  const resolvedWorkspacePath = path.resolve(workspacePath);
  if (!(await isDirectory(resolvedWorkspacePath))) {
    throw new Error("Workspace path is not a directory.");
  }

  if (target.id === "finder") {
    const result = await shell.openPath(resolvedWorkspacePath);
    return {
      ok: !result,
      targetId,
      workspacePath: resolvedWorkspacePath,
      command: "shell.openPath",
      args: [resolvedWorkspacePath],
      reason: result || null,
    };
  }

  let command = null;
  let args = [];
  if (target.id === "terminal") {
    if (process.platform === "darwin") {
      command = "open";
      args = ["-a", "Terminal", resolvedWorkspacePath];
    } else if (process.platform === "win32") {
      const launch = resolveWindowsTerminalLaunch(resolvedWorkspacePath);
      command = launch.command;
      args = launch.args;
    } else {
      const terminalCommand = commandPath("gnome-terminal")
        ? "gnome-terminal"
        : commandPath("konsole")
          ? "konsole"
          : commandPath("x-terminal-emulator")
            ? "x-terminal-emulator"
            : null;
      if (!terminalCommand) {
        return {
          ok: false,
          targetId,
          workspacePath: resolvedWorkspacePath,
          command: null,
          args: [],
          reason: "No supported terminal application was found.",
        };
      }
      command = terminalCommand;
      args = terminalCommand === "konsole" ? ["--workdir", resolvedWorkspacePath] : ["--working-directory", resolvedWorkspacePath];
    }
  } else {
    const resolvedTarget = resolveCodeWorkspaceOpenTarget(target);
    if (!resolvedTarget.available) {
      return {
        ok: false,
        targetId,
        workspacePath: resolvedWorkspacePath,
        command: null,
        args: [],
        reason: resolvedTarget.reason,
      };
    }
    if (process.platform === "darwin" && target.macOpenName && resolvedTarget.command === "open") {
      command = "open";
      args = ["-a", target.macOpenName, resolvedWorkspacePath];
    } else {
      command = resolvedTarget.command;
      args = [resolvedWorkspacePath];
    }
  }

  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
  return {
    ok: true,
    targetId,
    workspacePath: resolvedWorkspacePath,
    command,
    args,
    reason: null,
  };
}

export function parseEditorTarget(rawPath, request) {
  const match = rawPath.match(/^(.*?):(\d+)(?::(\d+))?$/);
  if (!match) {
    return {
      path: rawPath,
      line: Number.isFinite(Number(request?.line)) ? Math.max(1, Math.trunc(Number(request.line))) : undefined,
      column: Number.isFinite(Number(request?.column)) ? Math.max(1, Math.trunc(Number(request.column))) : undefined,
    };
  }

  return {
    path: match[1],
    line: Math.max(1, Number(match[2])),
    column: match[3] ? Math.max(1, Number(match[3])) : undefined,
  };
}
