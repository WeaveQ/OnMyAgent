import { t } from "../../../i18n";

export type SkillScope = "builtin" | "onmyagent" | "local";

export type LocalSkillOrigin =
  | "all"
  | "opencode"
  | "claude"
  | "agents"
  | "codex"
  | "cursor"
  | "windsurf"
  | "imported";

export const LOCAL_ORIGIN_LABELS: Record<LocalSkillOrigin, string> = {
  get all() { return t("skills.origin_all"); },
  get opencode() { return t("skills.origin_opencode"); },
  get claude() { return t("skills.origin_claude"); },
  get agents() { return t("skills.origin_agents"); },
  get codex() { return t("skills.origin_codex"); },
  get cursor() { return t("skills.origin_cursor"); },
  get windsurf() { return t("skills.origin_windsurf"); },
  get imported() { return t("skills.origin_imported"); },
};

export const SKILL_SCOPE_LABELS: Record<SkillScope, string> = {
  get builtin() { return t("skills.scope_builtin"); },
  get onmyagent() { return t("skills.scope_onmyagent"); },
  get local() { return t("skills.scope_local"); },
};

export function classifyLocalOrigin(
  entry: { scope?: unknown; root?: unknown; path?: unknown },
): LocalSkillOrigin {
  const rawPath = typeof entry.path === "string" ? entry.path : "";
  const root = typeof entry.root === "string" ? entry.root : "";
  const normalizedRoot = root ? root.replace(/\\/g, "/") : "";
  const normalizedPath = rawPath ? rawPath.replace(/\\/g, "/") : "";

  const combined = `${normalizedRoot} ${normalizedPath}`;

  if (combined.includes("/.opencode/skills") || combined.includes("/.config/opencode/skills")) return "opencode";
  if (combined.includes("/.claude/skills")) return "claude";
  if (combined.includes("/.agents/skills") || combined.includes("/.agent/skills")) return "agents";
  if (combined.includes("/.codex/skills")) return "codex";
  if (combined.includes("/.cursor/skills")) return "cursor";
  if (combined.includes("/.windsurf/skills")) return "windsurf";
  if (combined.includes("/.onmyagent/skills")) return "imported";

  return "all";
}

export function classifySkillScope(
  entry: { scope?: unknown; root?: unknown; path?: unknown },
  workspaceRoot: string | null | undefined,
): SkillScope {
  const rawPath = typeof entry.path === "string" ? entry.path : "";
  const root = typeof entry.root === "string" ? entry.root : "";
  const wsRoot = workspaceRoot ? workspaceRoot.replace(/\\/g, "/") : "";
  const normalizedRoot = root ? root.replace(/\\/g, "/") : "";
  const normalizedPath = rawPath ? rawPath.replace(/\\/g, "/") : "";

  if (normalizedRoot.includes("/.onmyagent/skills")) return "onmyagent";
  if (
    normalizedRoot.includes("/resources/bundled-skills") ||
    normalizedRoot.includes("/Contents/Resources/bundled-skills")
  ) {
    return "builtin";
  }
  if (normalizedRoot && wsRoot && normalizedRoot.startsWith(wsRoot)) return "local";
  if (normalizedRoot.includes("/.config/opencode/skills")) return "local";
  if (normalizedRoot.includes("/.opencode/skills")) return "local";
  if (
    normalizedRoot.includes("/.claude/skills") ||
    normalizedRoot.includes("/.agents/skills") ||
    normalizedRoot.includes("/.agent/skills") ||
    normalizedRoot.includes("/.codex/skills") ||
    normalizedRoot.includes("/.cursor/skills") ||
    normalizedRoot.includes("/.windsurf/skills") ||
    normalizedRoot.includes("/.onmyagent/skills")
  ) {
    return "local";
  }

  if (normalizedPath.includes("/.onmyagent/skills")) return "onmyagent";
  if (
    normalizedPath.includes("/resources/bundled-skills") ||
    normalizedPath.includes("/Contents/Resources/bundled-skills")
  ) {
    return "builtin";
  }
  if (normalizedPath && wsRoot && normalizedPath.startsWith(wsRoot)) return "local";
  if (normalizedPath.includes("/.config/opencode/skills")) return "local";
  if (normalizedPath.includes("/.opencode/skills")) return "local";
  if (
    normalizedPath.includes("/.claude/skills") ||
    normalizedPath.includes("/.agents/skills") ||
    normalizedPath.includes("/.agent/skills") ||
    normalizedPath.includes("/.codex/skills") ||
    normalizedPath.includes("/.cursor/skills") ||
    normalizedPath.includes("/.windsurf/skills") ||
    normalizedPath.includes("/.onmyagent/skills")
  ) {
    return "local";
  }

  const rawScope = typeof entry.scope === "string" ? entry.scope : "";
  if (rawScope === "onmyagent") return "onmyagent";
  if (rawScope === "built-in" || rawScope === "builtin") return "builtin";
  if (rawScope === "project" || rawScope === "global" || rawScope === "local") return "local";

  return "local";
}
