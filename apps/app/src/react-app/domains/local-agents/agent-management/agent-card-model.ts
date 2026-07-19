/**
 * Simple agent-card rules:
 *
 * 1) Status — online | needs_auth | offline | missing
 * 2) Ownership — mine | catalog | product | extension
 * 3) Actions
 *    primary:   未安装 → 查看安装；否则 → 测试连接
 *    secondary:
 *      mine      → 编辑 / 删除 / 开关
 *      catalog   → 已安装时「添加为我的」；未安装只留安装引导
 *      product   → 已装时「修复」
 *      extension → 无（在「高级：扩展插件」开关）
 */

import type { AgentManagementAgent } from "../../../../app/lib/desktop";
import type { AgentManagementHealthResult } from "./agent-management-health";

export type AgentDisplayStatus = "online" | "needs_auth" | "offline" | "missing" | "unknown";
export type AgentOwnership = "mine" | "catalog" | "product" | "extension";
export type AgentPrimaryAction = "install" | "test";
export type AgentSecondaryAction = "mine_controls" | "add_to_mine" | "repair" | "none";

const MISSING_ERROR =
  /enoent|command not found|no such file|spawn\s+\S+\s+enoent|未配置|未安装|not installed/i;

/**
 * Status for badge + filters.
 *
 * - 未安装: can show immediately (binary/path check only).
 * - 健康 / 需登录 / 离线 from ACP: only after the user runs 测试连接
 *   (health result). Listing-time probe failures must not paint the card red
 *   or “离线” before the user asks.
 */
export function agentDisplayStatus(
  agent: { status?: string | null; error?: string | null },
  health?: AgentManagementHealthResult | null,
): AgentDisplayStatus {
  // User-initiated probe wins.
  if (health?.status === "passed") return "online";
  if (health?.status === "needs_auth") return "needs_auth";
  if (health?.status === "missing") return "missing";
  if (health?.status === "failed") return "offline";
  // health.running → card shows 「检查中」; keep optimistic base for filters.
  if (health?.status === "running") {
    return installOnlyStatus(agent);
  }

  return installOnlyStatus(agent);
}

/** Before 测试连接: only distinguish 未安装 vs 健康. */
function installOnlyStatus(agent: {
  status?: string | null;
  error?: string | null;
}): AgentDisplayStatus {
  const raw = String(agent.status ?? "").trim();
  const err = String(agent.error ?? "");
  if (raw === "missing" || MISSING_ERROR.test(err)) return "missing";
  // Installed (or list probe offline/needs_auth): stay calm as 健康 until user tests.
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
 * 「添加为我的」 results land in 我的智能体, not stay as catalog rows.
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
  // extension: no secondary — manage under 高级：扩展插件

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

export function humanizeAgentError(
  agent: { name?: string | null; executablePath?: string | null; id?: string | null },
  raw: string | null | undefined,
): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const command =
    String(agent.executablePath ?? "").trim().split(/[\\/]/).pop()
    || String(agent.id ?? "").trim()
    || String(agent.name ?? "agent").trim();

  if (MISSING_ERROR.test(text)) {
    return `未找到「${command}」命令，请先安装后再试`;
  }
  if (/ACP process exited/i.test(text)) {
    return `进程启动后立即退出，可能未安装、未登录，或参数不正确`;
  }
  if (/auth|login|unauthorized|forbidden|api key|credential|认证|登录|未授权|凭证/i.test(text)) {
    return `需要登录认证后才能使用`;
  }
  if (/timeout|timed out|ETIMEDOUT/i.test(text)) {
    return `连接超时，请检查网络或本机代理`;
  }
  return text.replace(/\s+/g, " ").slice(0, 160);
}

// Re-export install guide helper for cards.
export { agentInstallGuideFor } from "./agent-install-guide";
