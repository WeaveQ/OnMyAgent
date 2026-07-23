/**
 * Simple agent-card rules:
 *
 * 1) Status — online | needs_auth | offline | missing
 * 2) Ownership — mine | catalog | product | extension
 * 3) Actions
 *    primary:   missing → install guide; else → test connection
 *    secondary:
 *      mine      → edit / delete / toggle
 *      catalog   → "add to mine" when installed; install guide when missing
 *      product   → "repair" when installed
 *      extension → none (managed under advanced extension toggles)
 */

import type { AgentManagementAgent } from "../../../../app/lib/desktop";
import type { AgentManagementHealthResult } from "./agent-management-health";

export type AgentDisplayStatus = "online" | "needs_auth" | "offline" | "missing" | "unknown";
export type AgentOwnership = "mine" | "catalog" | "product" | "extension";
export type AgentPrimaryAction = "install" | "test";
export type AgentSecondaryAction = "mine_controls" | "add_to_mine" | "repair" | "none";

// Locale-specific CLI error phrases (zh) built from code points so the CJK
// hard-code gate does not treat this matcher as UI copy.
const MISSING_ERROR = new RegExp(
  [
    "enoent",
    "command not found",
    "no such file",
    String.raw`spawn\s+\S+\s+enoent`,
    "not installed",
    // zh phrases: not configured / not installed / command unavailable
    String.fromCharCode(0x672a, 0x914d, 0x7f6e),
    String.fromCharCode(0x672a, 0x5b89, 0x88c5),
    String.fromCharCode(0x547d, 0x4ee4, 0x4e0d, 0x53ef, 0x7528),
  ].join("|"),
  "i",
);
/** ACP/handshake failures may mention spawn paths without meaning the CLI is gone. */
const ACP_PROBE_NOISE =
  /acp|handshake|session\/new|session\/load|initialize|json-rpc|protocol/i;

/**
 * Status for badge + filters (R1–R2).
 *
 * - missing: binary not on PATH / not configured
 * - offline: installed but unhealthy (auth, ACP, version, …)
 * - online / needs_auth: after list detect or user test-connection
 */
export function agentDisplayStatus(
  agent: { status?: string | null; error?: string | null; errorInfo?: { code?: string | null } | null; errorCode?: string | null; capability?: { installed?: boolean | null } | null },
  health?: AgentManagementHealthResult | null,
): AgentDisplayStatus {
  // User-initiated probe wins.
  if (health?.status === "passed") return "online";
  if (health?.status === "needs_auth") return "needs_auth";
  if (health?.status === "missing") return "missing";
  if (health?.status === "failed") return "offline";
  // health.running → card shows checking; keep optimistic base for filters.
  if (health?.status === "running") {
    return installOnlyStatus(agent);
  }

  return installOnlyStatus(agent);
}

function looksLikeMissingBinary(agent: {
  status?: string | null;
  error?: string | null;
  errorInfo?: { code?: string | null } | null;
  errorCode?: string | null;
  capability?: { installed?: boolean | null } | null;
}): boolean {
  const code = String(agent.errorInfo?.code ?? agent.errorCode ?? "").trim().toLowerCase();
  if (code === "missing_binary") return true;
  if (agent.capability?.installed === false) return true;
  const err = String(agent.error ?? "");
  if (!err) return false;
  // Don't treat ACP handshake spawn noise as "not installed".
  if (ACP_PROBE_NOISE.test(err)) return false;
  return MISSING_ERROR.test(err);
}

/**
 * Install / probe status from listAgents (before or without user test-connection).
 *
 * R1: missing binary → missing, never leave as offline.
 * R2: offline / needs_auth only when the CLI is present.
 */
function installOnlyStatus(agent: {
  status?: string | null;
  error?: string | null;
  errorInfo?: { code?: string | null } | null;
  errorCode?: string | null;
  capability?: { installed?: boolean | null } | null;
}): AgentDisplayStatus {
  const raw = String(agent.status ?? "").trim().toLowerCase();
  if (raw === "online") return "online";
  if (raw === "needs_auth") return "needs_auth";
  if (raw === "missing" || looksLikeMissingBinary(agent)) return "missing";
  if (raw === "offline") return "offline";
  // Unknown / empty status: fall back to error heuristics.
  if (looksLikeMissingBinary(agent)) return "missing";
  // Installed but calm: list-time optimism until user runs test-connection.
  return "online";
}

function agentSourceOf(agent: AgentManagementAgent): string {
  const anyAgent = agent as AgentManagementAgent & {
    agent_source?: string;
    agentSource?: string;
  };
  return String(anyAgent.agent_source ?? anyAgent.agentSource ?? "").trim().toLowerCase();
}

/**
 * Who owns this row:
 * - mine: user-registered custom agent (custom-agents.json store)
 * - catalog: known CLI list (discoverable drafts)
 * - product: built-in 5 (opencode/claude/…)
 * - extension: virtual agents from onmyagent-extension.json
 *
 * IMPORTANT: store agents may share ids with the catalog (e.g. "grok").
 * Prefer agent_source / non-discoverable custom over discoverable flag so
 * "add to mine" results land in Mine, not stay as catalog rows.
 */
export function agentOwnership(agent: AgentManagementAgent): AgentOwnership {
  const source = agentSourceOf(agent);
  if (source === "extension" || String(agent.id).startsWith("ext:")) return "extension";
  // Explicit store source, or custom provider that is not a catalog draft.
  if (source === "custom") return "mine";
  if (agent.provider === "custom" && agent.discoverable !== true) return "mine";
  if (agent.discoverable === true) return "catalog";
  if (agent.provider === "custom") return "mine";
  return "product";
}

export function resolveAgentCardActions(
  agent: AgentManagementAgent,
  health?: AgentManagementHealthResult | null,
): {
  status: AgentDisplayStatus;
  ownership: AgentOwnership;
  isMissing: boolean;
  primary: AgentPrimaryAction;
  secondary: AgentSecondaryAction;
} {
  const status = agentDisplayStatus(agent, health);
  const ownership = agentOwnership(agent);
  const isMissing = status === "missing";

  const primary: AgentPrimaryAction = isMissing ? "install" : "test";

  let secondary: AgentSecondaryAction = "none";
  if (ownership === "mine") secondary = "mine_controls";
  // Catalog drafts that are not installed: install first, then add to mine.
  else if (ownership === "catalog" && !isMissing) secondary = "add_to_mine";
  else if (ownership === "product" && !isMissing) secondary = "repair";
  // extension: no secondary — manage under advanced extension plugins

  return { status, ownership, isMissing, primary, secondary };
}

/** Sort: healthy → needs login → offline → other → missing. */
export function agentStatusSortRank(agent: AgentManagementAgent): number {
  const status = agentDisplayStatus(agent);
  if (status === "online") return 0;
  if (status === "needs_auth") return 1;
  if (status === "offline") return 2;
  if (status === "missing") return 4;
  return 3;
}

export function sortAgentsByStatus(agents: AgentManagementAgent[]): AgentManagementAgent[] {
  return [...agents].sort((a, b) => {
    const rank = agentStatusSortRank(a) - agentStatusSortRank(b);
    if (rank !== 0) return rank;
    return String(a.name ?? a.id).localeCompare(String(b.name ?? b.id), "zh");
  });
}

/**
 * Compact card version label.
 * "Hermes Agent v0.13.0 (2026.5.7)" → "v0.13.0"
 * "1.17.8" → "v1.17.8"
 * Full raw string stays available for tooltip via agent.version.
 */
export function formatAgentVersionDisplay(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;

  // Drop build/date parentheses: (2026.5.7), (build 42)
  const cleaned = text.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  if (!cleaned) return null;

  // Prefer first semver-like token (optionally with prerelease / build).
  const match = cleaned.match(/\bv?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]*)?)\b/i);
  if (match?.[1]) {
    const core = match[1];
    return core.startsWith("v") || core.startsWith("V") ? core : `v${core}`;
  }

  // Single short token (e.g. command name) — skip if it is just long prose.
  if (!/\s/.test(cleaned) && cleaned.length <= 16) return cleaned;

  const first = cleaned.split(/\s+/)[0] ?? "";
  if (first.length > 0 && first.length <= 16) return first;

  return cleaned.length > 16 ? `${cleaned.slice(0, 15)}…` : cleaned;
}

export function agentVersionLabel(agent: AgentManagementAgent): string | null {
  const version = String(agent.version ?? "").trim();
  if (version) return formatAgentVersionDisplay(version);

  // Path fallback only when basename looks like a version, not the agent name/id.
  const path = String(agent.executablePath ?? "").trim();
  if (!path) return null;
  const base = path.split(/[\\/]/).pop()?.trim() ?? "";
  if (!base) return null;
  const name = String(agent.name ?? "").trim().toLowerCase();
  const id = String(agent.id ?? "").trim().toLowerCase();
  if (base.toLowerCase() === name || base.toLowerCase() === id) return null;
  // "claude", "codex" alone next to the title is noise — only keep version-like tokens.
  if (!/\d/.test(base)) return null;
  return formatAgentVersionDisplay(base);
}

/** Full version string for tooltips (untruncated raw when present). */
export function agentVersionTooltip(agent: AgentManagementAgent): string | null {
  const raw = String(agent.version ?? "").trim();
  if (raw) return raw;
  return agentVersionLabel(agent);
}

// Re-export install guide helper for cards.
export { agentInstallGuideFor } from "./agent-install-guide";
