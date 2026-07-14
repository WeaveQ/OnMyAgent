// Detect locally installed CLI agents that are not yet registered in OnMyAgent.
//
// Mirrors the AionUi experience: scan the system PATH for known coding-agent
// CLIs and return ready-to-add drafts. Unlike the 5 built-in providers
// (opencode/codex/claude/openclaw/hermes) which are always listed, this only
// surfaces agents that (a) have a binary on PATH and (b) are not already
// registered, so the user can one-click add them as custom ACP agents.
//
// Detection is intentionally conservative: we never guess connection details
// that would break an agent. We pre-fill a sensible ACP draft (connectionType
// "cli", supportsAcp true, a per-agent acpArgs hint) and the native skills
// dirs so the agent can reuse its own marketplace skills. The user can still
// edit everything afterwards via the inline editor.

import { existsSync } from "node:fs";
import os from "node:os";
import { delimiter, join } from "node:path";

const HOME = os.homedir();

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
    displayName: "Kiro",
    commands: ["kiro"],
    skillsDirs: [join(HOME, ".kiro", "skills")],
    acpArgs: ["--acp"],
  },
  {
    id: "goose",
    displayName: "Goose",
    commands: ["goose"],
    skillsDirs: [join(HOME, ".goose", "skills")],
    acpArgs: ["--acp"],
  },
  {
    id: "cursor-agent",
    displayName: "Cursor Agent",
    commands: ["cursor-agent", "cursor"],
    skillsDirs: [],
    acpArgs: ["--acp"],
  },
  {
    id: "qwen",
    displayName: "Qwen Code",
    commands: ["qwen", "qwen-code"],
    skillsDirs: [join(HOME, ".qwen", "skills")],
    acpArgs: ["--acp"],
  },
  {
    id: "kimi",
    displayName: "Kimi CLI",
    commands: ["kimi", "kimi-cli"],
    skillsDirs: [],
    acpArgs: ["--acp"],
  },
  {
    id: "copilot",
    displayName: "GitHub Copilot",
    commands: ["copilot", "github-copilot"],
    skillsDirs: [],
    acpArgs: ["--acp"],
  },
  {
    id: "qoder",
    displayName: "Qoder",
    commands: ["qoder"],
    skillsDirs: [],
    acpArgs: ["--acp"],
  },
  {
    id: "augment",
    displayName: "Augment Code",
    commands: ["augment", "augment-code"],
    skillsDirs: [],
    acpArgs: ["--acp"],
  },
  {
    id: "snow",
    displayName: "Snow CLI",
    commands: ["snow", "snowcli"],
    skillsDirs: [],
    acpArgs: ["--acp"],
  },
  {
    id: "nanobot",
    displayName: "Nano Bot",
    commands: ["nanobot", "nano-bot"],
    skillsDirs: [],
    acpArgs: ["--acp"],
  },
];

/**
 * Turn the discoverable catalog into `detectAgent`-ready agent drafts.
 *
 * Unlike `detectAvailableLocalAgents` (which only returns agents whose binary is
 * already on PATH so the user can one-click *add* them), this returns ALL known
 * agents as custom-provider ACP drafts so the management page can *always list*
 * them — installed or not — mirroring AionUi's "十多个都显示，没装也在" behaviour.
 * The detection layer later resolves each draft to online / offline / missing;
 * the user can hit "测试连接" on any of them regardless of install state.
 */
function resolveKnownAgentBinary(def) {
  for (const cmd of def.commands) {
    const found = resolveOnPath(cmd);
    if (found) return found;
  }
  if (Array.isArray(def.wellKnownPaths)) {
    for (const candidate of def.wellKnownPaths) {
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

export function discoverableAgentDrafts() {
  return KNOWN_DISCOVERABLE_AGENTS.map((def) => ({
    id: def.id,
    name: def.displayName,
    provider: /** @type {"custom"} */ ("custom"),
    executablePath: resolveKnownAgentBinary(def) ?? def.commands[0],
    connectionType: /** @type {"cli"} */ ("cli"),
    supportsAcp: true,
    acpArgs: Array.isArray(def.acpArgs) ? def.acpArgs : ["--acp"],
    nativeSkillsDirs: (def.skillsDirs ?? []).filter(
      (dir) => typeof dir === "string" && dir.length > 0,
    ),
  }));
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
    let resolved = null;
    for (const cmd of def.commands) {
      const found = resolveOnPath(cmd);
      if (found) {
        resolved = found;
        break;
      }
    }
    if (!resolved && Array.isArray(def.wellKnownPaths)) {
      for (const candidate of def.wellKnownPaths) {
        try {
          if (existsSync(candidate)) {
            resolved = candidate;
            break;
          }
        } catch {
          // ignore
        }
      }
    }
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

  return { agents: detected };
}

export default detectAvailableLocalAgents;
