import type { PersonalLocalAgent, PersonalLocalAgentStatus } from "../../../app/lib/desktop";

// Availability filters for the Local Agent management surface.
export type LocalAgentFilterId = "all" | "available" | "unavailable" | "needs_auth" | "missing";

export const LOCAL_AGENT_FILTER_IDS: LocalAgentFilterId[] = [
  "all",
  "available",
  "unavailable",
  "needs_auth",
  "missing",
];

/** Collapse the runtime status into the 5-state model the UI renders. */
export function localAgentStatus(agent: Pick<PersonalLocalAgent, "status" | "error">): PersonalLocalAgentStatus {
  const raw = agent.status;
  if (raw === "online" || raw === "needs_auth" || raw === "missing" || raw === "offline" || raw === "unknown") {
    return raw;
  }
  // Legacy "error" collapses to offline unless the message points at auth/missing.
  const text = (agent.error ?? "").toLowerCase();
  if (/not found|command not found|no such file|未配置|命令不可用/.test(text)) return "missing";
  if (/auth|login|unauthorized|forbidden|认证|登录/.test(text)) return "needs_auth";
  return "offline";
}

export function matchesLocalAgentFilter(agent: PersonalLocalAgent, filter: LocalAgentFilterId): boolean {
  const status = localAgentStatus(agent);
  switch (filter) {
    case "all":
      return true;
    case "available":
      return status === "online";
    case "unavailable":
      return status !== "online";
    case "needs_auth":
      return status === "needs_auth";
    case "missing":
      return status === "missing";
    default:
      return true;
  }
}

export function localAgentFilterCounts(agents: PersonalLocalAgent[]): Record<LocalAgentFilterId, number> {
  const counts: Record<LocalAgentFilterId, number> = {
    all: agents.length,
    available: 0,
    unavailable: 0,
    needs_auth: 0,
    missing: 0,
  };
  for (const agent of agents) {
    const status = localAgentStatus(agent);
    if (status === "online") counts.available += 1;
    else counts.unavailable += 1;
    if (status === "needs_auth") counts.needs_auth += 1;
    if (status === "missing") counts.missing += 1;
  }
  return counts;
}
