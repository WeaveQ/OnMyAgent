import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import type {
  SessionArchiveAgent,
  SessionArchiveSource,
} from "@onmyagent/types/session-archive";

export type SessionArchiveRegistryEntry = SessionArchiveSource & {
  agent: SessionArchiveAgent;
  displayName: string;
  envVar: string;
  configKey: string;
  idPrefix: string;
  defaultDirs: string[];
  watchSubdirs: string[];
  shallowWatch: boolean;
  fileBased: boolean;
  watchRootsKind?: "opencode" | "kilo" | "mimocode";
  shallowWatchRootsKind?: "codex";
};

export type SessionArchiveDirSource = "default" | "config" | "env";

export type SessionArchiveResolvedSourceRoot = {
  agent: SessionArchiveAgent;
  root: string;
  source: SessionArchiveDirSource;
  configured: boolean;
};

export type SessionArchiveWatchRoot = {
  agent: SessionArchiveAgent;
  root: string;
  recursive: boolean;
  sourceRoot: string;
};

export type SessionArchiveSourceResolutionInput = {
  homeDir?: string;
  env?: Record<string, string | undefined>;
  config?: Record<string, unknown> | string;
  includeMissing?: boolean;
};

type OpenCodeLayout = {
  dbName: string;
  sessionSubdir: string;
};

const openCodeLayouts: Record<"opencode" | "kilo" | "mimocode", OpenCodeLayout> = {
  opencode: { dbName: "opencode.db", sessionSubdir: "session" },
  kilo: { dbName: "kilo.db", sessionSubdir: "session" },
  mimocode: { dbName: "mimocode.db", sessionSubdir: "session_diff" },
};

export const sessionArchiveRegistry = [
  entry("claude", "Claude Code", "CLAUDE_PROJECTS_DIR", "claude_project_dirs", [".claude/projects"], ""),
  entry("cowork", "Claude Cowork", "COWORK_DIR", "cowork_dirs", coworkDefaultDirs(), "cowork:", { shallowWatch: true }),
  entry("codex", "Codex", "CODEX_SESSIONS_DIR", "codex_sessions_dirs", [".codex/sessions", ".codex/archived_sessions"], "codex:", { shallowWatchRootsKind: "codex" }),
  entry("copilot", "Copilot", "COPILOT_DIR", "copilot_dirs", [".copilot"], "copilot:", { watchSubdirs: ["session-state"] }),
  entry("gemini", "Gemini", "GEMINI_DIR", "gemini_dirs", [".gemini"], "gemini:", { watchSubdirs: ["tmp"] }),
  entry("mimocode", "MiMoCode", "MIMOCODE_DIR", "mimocode_dirs", [".local/share/mimocode"], "mimocode:", { watchSubdirs: ["storage/session_diff", "storage/message", "storage/part"], watchRootsKind: "mimocode" }),
  entry("opencode", "OpenCode", "OPENCODE_DIR", "opencode_dirs", [".local/share/opencode"], "opencode:", { watchSubdirs: ["storage/session", "storage/message", "storage/part"], watchRootsKind: "opencode" }),
  entry("kilo", "Kilo", "KILO_DIR", "kilo_dirs", [".local/share/kilo"], "kilo:", { watchSubdirs: ["storage/session", "storage/message", "storage/part"], watchRootsKind: "kilo" }),
  entry("openhands", "OpenHands CLI", "OPENHANDS_CONVERSATIONS_DIR", "openhands_dirs", [".openhands/conversations"], "openhands:", { shallowWatch: true }),
  entry("cursor", "Cursor", "CURSOR_PROJECTS_DIR", "cursor_project_dirs", [".cursor/projects"], "cursor:"),
  entry("amp", "Amp", "AMP_DIR", "amp_dirs", [".local/share/amp/threads"], "amp:"),
  entry("zencoder", "Zencoder", "ZENCODER_DIR", "zencoder_dirs", [".zencoder/sessions"], "zencoder:"),
  entry("iflow", "iFlow", "IFLOW_DIR", "iflow_dirs", [".iflow/projects"], "iflow:"),
  entry("vscode-copilot", "VSCode Copilot", "VSCODE_COPILOT_DIR", "vscode_copilot_dirs", ["AppData/Roaming/Code/User", "AppData/Roaming/Code - Insiders/User", "AppData/Roaming/VSCodium/User", "Library/Application Support/Code/User", "Library/Application Support/Code - Insiders/User", "Library/Application Support/VSCodium/User", ".config/Code/User", ".config/Code - Insiders/User", ".config/VSCodium/User"], "vscode-copilot:", { watchSubdirs: ["workspaceStorage", "globalStorage"] }),
  entry("visualstudio-copilot", "Visual Studio Copilot", "VISUALSTUDIO_COPILOT_DIR", "visualstudio_copilot_dirs", ["AppData/Local/Temp/VSGitHubCopilotLogs/traces", "Library/Caches/VSGitHubCopilotLogs/traces", ".cache/VSGitHubCopilotLogs/traces"], "visualstudio-copilot:"),
  entry("pi", "Pi", "PI_DIR", "pi_dirs", [".pi/agent/sessions"], "pi:"),
  entry("omp", "OhMyPi", "OMP_DIR", "omp_dirs", [".omp/agent/sessions"], "omp:"),
  entry("qwen", "Qwen Code", "QWEN_PROJECTS_DIR", "qwen_project_dirs", [".qwen/projects"], "qwen:"),
  entry("commandcode", "Command Code", "COMMANDCODE_PROJECTS_DIR", "commandcode_project_dirs", [".commandcode/projects"], "commandcode:"),
  entry("deepseek-tui", "DeepSeek TUI", "DEEPSEEK_TUI_SESSIONS_DIR", "deepseek_tui_sessions_dirs", [".codewhale/sessions", ".deepseek/sessions"], "deepseek-tui:"),
  entry("openclaw", "OpenClaw", "OPENCLAW_DIR", "openclaw_dirs", [".openclaw/agents", ".kimi_openclaw/agents"], "openclaw:"),
  entry("qclaw", "QClaw", "QCLAW_DIR", "qclaw_dirs", [".qclaw/agents"], "qclaw:"),
  entry("kimi", "Kimi", "KIMI_DIR", "kimi_dirs", [".kimi/sessions", ".kimi-code/sessions"], "kimi:"),
  entry("claude-ai", "Claude.ai", "", "", [], "claude-ai:", { fileBased: false }),
  entry("chatgpt", "ChatGPT", "", "", [], "chatgpt:", { fileBased: false }),
  entry("kiro", "Kiro", "KIRO_SESSIONS_DIR", "kiro_dirs", [".kiro/sessions/cli", ".local/share/kiro-cli"], "kiro:"),
  entry("kiro-ide", "Kiro IDE", "KIRO_IDE_DIR", "kiro_ide_dirs", kiroIDEDefaultDirs(), "kiro-ide:"),
  entry("cortex", "Cortex Code", "CORTEX_DIR", "cortex_dirs", [".snowflake/cortex/conversations"], "cortex:"),
  entry("hermes", "Hermes Agent", "HERMES_SESSIONS_DIR", "hermes_sessions_dirs", [".hermes/sessions"], "hermes:"),
  entry("onmyagent", "OnMyAgent", "ONMYAGENT_PROJECTS_DIR", "onmyagent_project_dirs", [".onmyagent/projects"], "onmyagent:"),
  entry("forge", "Forge", "FORGE_DIR", "forge_dirs", [".forge"], "forge:", { fileBased: false }),
  entry("piebald", "Piebald", "PIEBALD_DIR", "piebald_dirs", [".local/share/piebald", "Library/Application Support/piebald", "AppData/Roaming/piebald"], "piebald:", { fileBased: false }),
  entry("warp", "Warp", "WARP_DIR", "warp_dirs", warpDefaultDirs(), "warp:", { fileBased: false }),
  entry("positron", "Positron Assistant", "POSITRON_DIR", "positron_dirs", ["Library/Application Support/Positron/User"], "positron:", { watchSubdirs: ["workspaceStorage"] }),
  entry("zed", "Zed", "ZED_DIR", "zed_dirs", zedDefaultDirs(), "zed:", { watchSubdirs: ["threads"] }),
  entry("antigravity", "Antigravity", "ANTIGRAVITY_DIR", "antigravity_dirs", [".gemini/antigravity"], "antigravity:", { watchSubdirs: ["conversations", "brain", "annotations"] }),
  entry("antigravity-cli", "Antigravity CLI", "ANTIGRAVITY_CLI_DIR", "antigravity_cli_dirs", [".gemini/antigravity-cli"], "antigravity-cli:", { watchSubdirs: ["conversations", "implicit", "brain"] }),
  entry("qwenpaw", "QwenPaw", "QWENPAW_DIR", "qwenpaw_dirs", [".copaw/workspaces"], "qwenpaw:"),
  entry("gptme", "gptme", "GPTME_DIR", "gptme_dirs", [".local/share/gptme/logs"], "gptme:"),
  entry("shelley", "Shelley", "SHELLEY_DIR", "shelley_dirs", [".config/shelley"], "shelley:"),
  entry("vibe", "Mistral Vibe", "VIBE_SESSIONS_DIR", "vibe_session_dirs", [".vibe/logs/session"], "vibe:"),
  entry("aider", "Aider", "AIDER_DIR", "aider_dirs", [""], "aider:", { shallowWatch: true }),
  entry("reasonix", "Reasonix", "REASONIX_DIR", "reasonix_dirs", [".reasonix", "AppData/Roaming/reasonix"], "reasonix:", { watchSubdirs: ["sessions", "archive", "projects"] }),
] as const satisfies readonly SessionArchiveRegistryEntry[];

export const sessionArchiveSources = sessionArchiveRegistry.map((source) => ({
  agent: source.agent,
  displayName: source.displayName,
  idPrefix: source.idPrefix,
  defaultDirs: source.defaultDirs,
  fileBased: source.fileBased,
  enabled: source.enabled,
  ...(source.envVar ? { envVar: source.envVar } : {}),
  ...(source.configKey ? { configKey: source.configKey } : {}),
  ...(source.watchSubdirs.length ? { watchSubdirs: source.watchSubdirs } : {}),
  ...(source.shallowWatch ? { shallowWatch: source.shallowWatch } : {}),
})) satisfies SessionArchiveSource[];

export function sessionArchiveRegistryEntry(agent: SessionArchiveAgent): SessionArchiveRegistryEntry | null {
  return sessionArchiveRegistry.find((source) => source.agent === agent) ?? null;
}

export function resolveSessionArchiveSourceRoots(
  input: SessionArchiveSourceResolutionInput = {},
): SessionArchiveResolvedSourceRoot[] {
  const home = input.homeDir ?? homedir();
  const env = input.env ?? process.env;
  const config = normalizeConfig(input.config);
  return sessionArchiveRegistry.flatMap((source) => {
    if (!source.fileBased) return [];
    const envValue = source.envVar ? env[source.envVar]?.trim() : "";
    const configDirs = source.configKey ? stringArray(config[source.configKey]) : [];
    const dirs = envValue ? [envValue] : configDirs.length ? configDirs : source.defaultDirs;
    const dirSource: SessionArchiveDirSource = envValue ? "env" : configDirs.length ? "config" : "default";
    return dirs.flatMap((dir) => {
      const root = resolveHomeRelativePath(home, dir);
      if (!input.includeMissing && !existsSync(root)) return [];
      return [{ agent: source.agent, root, source: dirSource, configured: dirSource !== "default" }];
    });
  });
}

export function resolveSessionArchiveWatchRoots(input: {
  agent: SessionArchiveAgent;
  root: string;
}): SessionArchiveWatchRoot[] {
  const source = sessionArchiveRegistryEntry(input.agent);
  if (!source || !source.fileBased) return [];
  const recursive = !source.shallowWatch;
  const main = source.watchRootsKind
    ? resolveOpenCodeWatchRoots(input.root, openCodeLayouts[source.watchRootsKind]).map((root) => ({ agent: input.agent, root, recursive, sourceRoot: input.root }))
    : source.watchSubdirs.length
      ? source.watchSubdirs.map((subdir) => ({ agent: input.agent, root: join(input.root, subdir), recursive, sourceRoot: input.root }))
      : [{ agent: input.agent, root: input.root, recursive, sourceRoot: input.root }];
  const shallow = source.shallowWatchRootsKind === "codex"
    ? resolveCodexShallowWatchRoots(input.root).map((root) => ({ agent: input.agent, root, recursive: false, sourceRoot: input.root }))
    : [];
  return [...main, ...shallow];
}

function entry(
  agent: SessionArchiveAgent,
  displayName: string,
  envVar: string,
  configKey: string,
  defaultDirs: string[],
  idPrefix: string,
  options: Partial<Pick<SessionArchiveRegistryEntry, "watchSubdirs" | "shallowWatch" | "fileBased" | "watchRootsKind" | "shallowWatchRootsKind">> = {},
): SessionArchiveRegistryEntry {
  return {
    agent,
    displayName,
    envVar,
    configKey,
    defaultDirs,
    idPrefix,
    watchSubdirs: options.watchSubdirs ?? [],
    shallowWatch: options.shallowWatch ?? false,
    fileBased: options.fileBased ?? true,
    enabled: true,
    ...(options.watchRootsKind ? { watchRootsKind: options.watchRootsKind } : {}),
    ...(options.shallowWatchRootsKind ? { shallowWatchRootsKind: options.shallowWatchRootsKind } : {}),
  };
}

function resolveHomeRelativePath(home: string, path: string): string {
  if (path === "") return home;
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return path;
  return join(home, path);
}

function normalizeConfig(config: SessionArchiveSourceResolutionInput["config"]): Record<string, unknown> {
  if (!config) return {};
  if (typeof config !== "string") return config;
  const jsonc = parseJsonc(config);
  return jsonc && typeof jsonc === "object" && !Array.isArray(jsonc) ? jsonc as Record<string, unknown> : parseTomlLikeConfig(config);
}

function parseTomlLikeConfig(config: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of config.split(/\r?\n/)) {
    const trimmed = line.replace(/#.*/, "").trim();
    const match = /^(\w+)\s*=\s*(.+)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || !rawValue) continue;
    result[key] = parseTomlLikeValue(rawValue.trim());
  }
  return result;
}

function parseTomlLikeValue(value: string): unknown {
  if (value.startsWith("[") && value.endsWith("]")) {
    return value.slice(1, -1).split(",").map((part) => unquote(part.trim())).filter(Boolean);
  }
  return unquote(value);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entryValue) => typeof entryValue === "string" && entryValue.trim() ? [entryValue.trim()] : []);
}

function resolveOpenCodeWatchRoots(root: string, layout: OpenCodeLayout): string[] {
  if (!root) return [];
  const sessionRoot = join(root, "storage", layout.sessionSubdir);
  const storageRoot = join(root, "storage");
  const dbPath = join(root, layout.dbName);
  if (existsSync(sessionRoot)) {
    return existsSync(dbPath) ? [root] : [storageRoot];
  }
  if (existsSync(dbPath)) return [root];
  return existsSync(root) ? [root] : [];
}

function resolveCodexShallowWatchRoots(root: string): string[] {
  const parent = dirname(root);
  return parent && parent !== "." && parent !== root ? [parent] : [];
}

function coworkDefaultDirs(): string[] {
  return [
    "Library/Application Support/Claude/local-agent-mode-sessions",
    ".config/Claude/local-agent-mode-sessions",
    "AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/local-agent-mode-sessions",
    "AppData/Roaming/Claude/local-agent-mode-sessions",
  ];
}

function kiroIDEDefaultDirs(): string[] {
  return [
    "Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent",
    "AppData/Roaming/Kiro/User/globalStorage/kiro.kiroagent",
    ".config/Kiro/User/globalStorage/kiro.kiroagent",
  ];
}

function warpDefaultDirs(): string[] {
  return [
    "Library/Group Containers/2BBY89MBSN.dev.warp/Library/Application Support/dev.warp.Warp-Stable",
    ".local/state/warp-terminal",
    "AppData/Local/warp/Warp/data",
  ];
}

function zedDefaultDirs(): string[] {
  return ["Library/Application Support/Zed", ".local/share/zed", "AppData/Local/Zed"];
}
