// Detect locally installed CLI agents that are not yet registered in OnMyAgent.
//
// Mirrors the Upstream experience: scan the system PATH for known coding-agent
// CLIs and return ready-to-add drafts. Unlike the 5 built-in providers
// (opencode/codex/claude/openclaw/hermes) which are always listed, this only
// surfaces agents that (a) have a binary on PATH and (b) are not already
// registered, so the user can one-click add them as custom ACP agents.
//
// Detection is intentionally conservative: we never guess connection details
// that would break an agent. We pre-fill a sensible ACP draft (connectionType
// "cli", supportsAcp true, a per-agent acpArgs hint) and the native skills
// dirs so the agent can reuse its own installed skills. The user can still
// edit everything afterwards via the inline editor.

import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import { delimiter, join } from "node:path";

const HOME = os.homedir();

/**
 * WorkBuddy ships an embedded `codebuddy` binary (Tencent CodeBuddy CLI with
 * `--acp`). These are the well-known install locations for that app bundle.
 * WorkBuddy and standalone CodeBuddy share the same CLI family and skill root
 * (`~/.codebuddy/skills`) but are listed as separate product cards.
 */
function workbuddyEmbeddedCodebuddyPaths() {
  if (process.platform === "darwin") {
    return [
      "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy",
      join(
        HOME,
        "Applications",
        "WorkBuddy.app",
        "Contents",
        "Resources",
        "app.asar.unpacked",
        "cli",
        "bin",
        "codebuddy",
      ),
    ];
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || join(HOME, "AppData", "Local");
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    return [
      join(localAppData, "Programs", "WorkBuddy", "resources", "app.asar.unpacked", "cli", "bin", "codebuddy.cmd"),
      join(localAppData, "Programs", "WorkBuddy", "resources", "app.asar.unpacked", "cli", "bin", "codebuddy"),
      join(programFiles, "WorkBuddy", "resources", "app.asar.unpacked", "cli", "bin", "codebuddy.cmd"),
      join(programFiles, "WorkBuddy", "resources", "app.asar.unpacked", "cli", "bin", "codebuddy"),
    ];
  }
  // Linux / other: common user-local Electron app layouts.
  return [
    join(HOME, ".local", "share", "WorkBuddy", "resources", "app.asar.unpacked", "cli", "bin", "codebuddy"),
    join(HOME, "WorkBuddy", "resources", "app.asar.unpacked", "cli", "bin", "codebuddy"),
  ];
}

/** True when `path` is the codebuddy CLI nested inside a WorkBuddy install. */
export function isWorkBuddyEmbeddedPath(filePath) {
  const normalized = String(filePath ?? "")
    .replace(/\\/g, "/")
    .toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("workbuddy.app/")) return true;
  // Windows / Linux: …/WorkBuddy/…/app.asar.unpacked/cli/…
  if (
    normalized.includes("/workbuddy/") &&
    (normalized.includes("app.asar.unpacked") || normalized.includes("/cli/bin/codebuddy"))
  ) {
    return true;
  }
  return false;
}

function resolveRealPath(filePath) {
  const raw = String(filePath ?? "").trim();
  if (!raw) return "";
  try {
    return realpathSync(raw);
  } catch {
    return raw;
  }
}

/**
 * Catalog of known CLI agents beyond the 5 built-in providers.
 * `commands` are the candidate executable names (first one found on PATH wins).
 * `skillsDirs` are best-effort native skill roots so the agent can reuse its
 * own installed skills; unknown layouts are left empty and the user can fill.
 * `acpArgs` is the flag that switches the CLI into ACP mode (override per agent).
 */
export const KNOWN_DISCOVERABLE_AGENTS = [
  {
    id: "gemini",
    displayName: "Gemini CLI",
    commands: ["gemini"],
    skillsDirs: [join(HOME, ".gemini", "skills")],
    acpArgs: ["--acp"],
  },
  {
    id: "kiro",
    displayName: "Kiro CLI",
    commands: ["kiro", "kiro-cli"],
    skillsDirs: [join(HOME, ".kiro", "skills")],
    wellKnownPaths: [join(HOME, ".local", "bin", "kiro-cli")],
    acpArgs: ["acp"],
  },
  {
    id: "goose",
    displayName: "Goose CLI",
    commands: ["goose"],
    skillsDirs: [join(HOME, ".goose", "skills")],
    acpArgs: ["acp"],
  },
  {
    id: "cursor-agent",
    displayName: "Cursor Agent CLI",
    commands: ["cursor-agent", "cursor"],
    skillsDirs: [],
    acpArgs: ["agent", "acp"],
  },
  {
    id: "qwen",
    displayName: "Qwen Code CLI",
    commands: ["qwen", "qwen-code"],
    skillsDirs: [join(HOME, ".qwen", "skills")],
    acpArgs: ["--acp"],
  },
  {
    id: "kimi",
    displayName: "Kimi CLI",
    commands: ["kimi", "kimi-cli"],
    skillsDirs: [join(HOME, ".kimi-code", "skills")],
    wellKnownPaths: [join(HOME, ".kimi-code", "bin", "kimi")],
    acpArgs: ["acp"],
  },
  {
    id: "copilot",
    displayName: "GitHub Copilot CLI",
    commands: ["copilot", "github-copilot"],
    skillsDirs: [],
    acpArgs: ["--acp"],
  },
  {
    id: "qoder",
    displayName: "Qoder CLI",
    commands: ["qoder", "qodercli"],
    skillsDirs: [],
    acpArgs: ["--acp"],
  },
  {
    id: "augment",
    displayName: "Augment Code CLI",
    commands: ["augment", "augment-code", "auggie"],
    skillsDirs: [],
    acpArgs: ["--acp"],
  },
  {
    id: "snow",
    displayName: "Snow CLI",
    commands: ["snow", "snowcli", "cortex"],
    skillsDirs: [],
    acpArgs: ["acp", "serve"],
  },
  {
    id: "nanobot",
    displayName: "Nano Bot CLI",
    commands: ["nanobot", "nano-bot"],
    skillsDirs: [],
    acpArgs: ["--acp"],
  },
  {
    // Desktop app (not a standalone CLI product). Embeds CodeBuddy CLI binary.
    // Skills live under both the CodeBuddy-family root and WorkBuddy's own tree.
    id: "workbuddy",
    displayName: "WorkBuddy",
    commands: [],
    wellKnownPaths: workbuddyEmbeddedCodebuddyPaths(),
    skillsDirs: [
      // CodeBuddy-family shared root (WorkBuddy embeds CodeBuddy CLI).
      join(HOME, ".codebuddy", "skills"),
      // WorkBuddy product skill tree (most user-installed skills land here).
      join(HOME, ".workbuddy", "skills"),
      join(HOME, ".workbuddy", "skills-marketplace", "skills"),
    ],
    acpArgs: ["--acp"],
  },
  {
    id: "codebuddy",
    displayName: "CodeBuddy CLI",
    commands: ["codebuddy"],
    wellKnownPaths: [join(HOME, ".local", "bin", "codebuddy"), join(HOME, "npm", "bin", "codebuddy")],
    skillsDirs: [join(HOME, ".codebuddy", "skills")],
    acpArgs: ["--acp"],
    // Never claim the WorkBuddy-embedded binary as standalone CodeBuddy.
    skipWorkBuddyEmbedded: true,
  },
  {
    id: "trae",
    displayName: "Trae CLI",
    commands: ["traecli", "trae-cli"],
    skillsDirs: [],
    acpArgs: ["acp", "serve"],
  },
  {
    id: "mimo",
    displayName: "MiMo Code CLI",
    commands: ["mimo"],
    skillsDirs: [join(HOME, ".mimocode", "skills")],
    // `mimo acp` starts the Agent Client Protocol stdio server
    // (installed via `npm install -g @mimo-ai/cli`, binary: `mimo`)
    acpArgs: ["acp"],
  },
  {
    id: "grok",
    displayName: "Grok Build CLI",
    commands: ["grok"],
    skillsDirs: [join(HOME, ".grok", "skills")],
    // `grok agent stdio` starts the ACP stdio server
    // (installed via `npm install -g @xai-official/grok`, binary: `grok`)
    acpArgs: ["agent", "stdio"],
  },
];

/**
 * Turn the discoverable catalog into `detectAgent`-ready agent drafts.
 *
 * Unlike `detectAvailableLocalAgents` (which only returns agents whose binary is
 * already on PATH so the user can one-click *add* them), this returns ALL known
 * agents as custom-provider ACP drafts so the management page can *always list*
 * them — installed or not — mirroring Upstream's "十多个都显示，没装也在" behaviour.
 * The detection layer later resolves each draft to online / offline / missing;
 * the user can hit "测试连接" on any of them regardless of install state.
 */
function pathUsableForDef(def, candidate) {
  if (!candidate) return false;
  if (def.skipWorkBuddyEmbedded && isWorkBuddyEmbeddedPath(candidate)) return false;
  return true;
}

function resolveKnownAgentBinary(def) {
  const commands = Array.isArray(def.commands) ? def.commands : [];
  for (const cmd of commands) {
    const found = resolveOnPath(cmd);
    if (found && pathUsableForDef(def, found)) return found;
  }
  if (Array.isArray(def.wellKnownPaths)) {
    for (const candidate of def.wellKnownPaths) {
      try {
        if (existsSync(candidate) && pathUsableForDef(def, candidate)) return candidate;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

/**
 * When WorkBuddy and CodeBuddy resolve to the same real binary, keep WorkBuddy
 * and drop the CodeBuddy draft so the catalog shows one product card.
 * Standalone CodeBuddy (npm / ~/.local/bin) still appears on its own.
 */
export function dedupeCodebuddyWorkbuddyAgents(agents, pathKey = "command") {
  const list = Array.isArray(agents) ? agents : [];
  const workbuddy = list.find((item) => String(item?.id ?? "").toLowerCase() === "workbuddy");
  const codebuddy = list.find((item) => String(item?.id ?? "").toLowerCase() === "codebuddy");
  if (!workbuddy || !codebuddy) return list;

  const wbPath = resolveRealPath(workbuddy[pathKey] ?? workbuddy.command ?? workbuddy.executablePath);
  const cbPath = resolveRealPath(codebuddy[pathKey] ?? codebuddy.command ?? codebuddy.executablePath);

  const sameBinary = Boolean(wbPath && cbPath && wbPath === cbPath);
  const codebuddyIsEmbedded = isWorkBuddyEmbeddedPath(cbPath || codebuddy[pathKey] || "");

  if (sameBinary || codebuddyIsEmbedded) {
    return list.filter((item) => String(item?.id ?? "").toLowerCase() !== "codebuddy");
  }
  return list;
}

export function discoverableAgentDrafts() {
  const drafts = KNOWN_DISCOVERABLE_AGENTS.map((def) => ({
    id: def.id,
    name: def.displayName,
    provider: /** @type {"custom"} */ ("custom"),
    executablePath:
      resolveKnownAgentBinary(def) ??
      (Array.isArray(def.commands) && def.commands[0] ? def.commands[0] : def.id),
    connectionType: /** @type {"cli"} */ ("cli"),
    supportsAcp: true,
    acpArgs: Array.isArray(def.acpArgs) ? def.acpArgs : ["--acp"],
    nativeSkillsDirs: (def.skillsDirs ?? []).filter(
      (dir) => typeof dir === "string" && dir.length > 0,
    ),
  }));
  // Prefer WorkBuddy card when both would point at the same embedded binary.
  return dedupeCodebuddyWorkbuddyAgents(drafts, "executablePath");
}

/**
 * Merge catalog default skill roots into a (possibly stale) custom/fleet agent.
 * Older store records often only kept the first path (e.g. WorkBuddy → only
 * `~/.codebuddy/skills`), which makes the management card show Skill 0 while
 * `~/.workbuddy/skills` is full of SKILL.md trees.
 *
 * @param {{ id?: string, provider?: string, nativeSkillsDirs?: string[], native_skills_dirs?: string[] }} agent
 * @returns {string[]}
 */
export function mergeCatalogNativeSkillDirs(agent) {
  const id = String(agent?.id ?? "").trim().toLowerCase();
  const provider = String(agent?.provider ?? "").trim().toLowerCase();
  const keys = [id, provider].filter((key) => key && key !== "custom");
  const fromStore = [
    ...(Array.isArray(agent?.nativeSkillsDirs) ? agent.nativeSkillsDirs : []),
    ...(Array.isArray(agent?.native_skills_dirs) ? agent.native_skills_dirs : []),
  ]
    .map((dir) => String(dir ?? "").trim())
    .filter(Boolean);
  const fromCatalog = [];
  for (const key of keys) {
    const def = KNOWN_DISCOVERABLE_AGENTS.find(
      (item) => String(item?.id ?? "").toLowerCase() === key,
    );
    if (!def?.skillsDirs) continue;
    for (const dir of def.skillsDirs) {
      if (typeof dir === "string" && dir.trim()) fromCatalog.push(dir.trim());
    }
  }
  const seen = new Set();
  const merged = [];
  for (const dir of [...fromStore, ...fromCatalog]) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    merged.push(dir);
  }
  return merged;
}

// Resolve an executable name against PATH without spawning a shell. `command`
// and `which` are shell builtins/redirects that are unreliable from
// execFileSync, so we walk PATH ourselves and check file existence.
function resolveOnPath(command) {
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const dir of paths) {
    for (const ext of exts) {
      const candidate = join(dir, `${command}${ext}`);
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        // ignore and keep scanning
      }
    }
  }
  return null;
}

/**
 * Scan PATH for known CLI agents that are not already registered.
 * @param {{ workspaceRoot?: string, existingIds?: string[] }} input
 * @returns {Promise<{ agents: Array<{
 *   id: string, name: string, command: string,
 *   connectionType: "cli" | "raw", supportsAcp: boolean,
 *   acpArgs: string[], nativeSkillsDirs: string[]
 * }> }>}
 */
export async function detectAvailableLocalAgents(input = {}) {
  const existing = new Set(
    (Array.isArray(input.existingIds) ? input.existingIds : [])
      .map((id) => String(id).toLowerCase())
      .filter(Boolean),
  );

  const detected = [];
  for (const def of KNOWN_DISCOVERABLE_AGENTS) {
    if (existing.has(def.id)) continue;
    const resolved = resolveKnownAgentBinary(def);
    if (!resolved) continue;

    detected.push({
      id: def.id,
      name: def.displayName,
      command: resolved,
      connectionType: /** @type {"cli" | "raw"} */ ("cli"),
      supportsAcp: true,
      acpArgs: Array.isArray(def.acpArgs) ? def.acpArgs : ["--acp"],
      nativeSkillsDirs: (def.skillsDirs ?? []).filter(
        (dir) => typeof dir === "string" && dir.length > 0,
      ),
    });
  }

  return { agents: dedupeCodebuddyWorkbuddyAgents(detected, "command") };
}

export default detectAvailableLocalAgents;
