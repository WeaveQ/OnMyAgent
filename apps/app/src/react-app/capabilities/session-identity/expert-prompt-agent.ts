/** Expert sessions may use only the light default or package-approved ids. */

export const EXPERT_PROMPT_DEFAULT_AGENT = "onmyagent";

function normalizeApprovedAgentIds(
  approvedAgentIds: readonly string[],
): Set<string> {
  return new Set(
    approvedAgentIds.map((agentId) => agentId.trim()).filter(Boolean),
  );
}

/**
 * Preview the renderer's Expert selection. This is intentionally not the
 * runtime contract: the server remains the sole authoritative throwing
 * enforcement for promptAsync requests.
 *
 * A null result means the selection is empty or stale and callers should use
 * the default/null path rather than forwarding an undeclared id.
 */
export function normalizeExpertPromptAgentSelection(
  selectedAgent: string | null | undefined,
  approvedAgentIds: readonly string[] = [],
): string | null {
  const selected = selectedAgent?.trim() ?? "";
  if (!selected) return null;
  if (selected === EXPERT_PROMPT_DEFAULT_AGENT) return selected;
  return normalizeApprovedAgentIds(approvedAgentIds).has(selected)
    ? selected
    : null;
}

/**
 * Return a safe renderer preview value for an Expert prompt. The fallback is
 * only a UI/send-path normalization; server validation still owns rejection.
 */
export function previewExpertPromptAgent(
  selectedAgent: string | null | undefined,
  approvedAgentIds: readonly string[] = [],
): string {
  return (
    normalizeExpertPromptAgentSelection(selectedAgent, approvedAgentIds) ??
    EXPERT_PROMPT_DEFAULT_AGENT
  );
}

/**
 * Filter composer options to the Expert package's declared ids. Generic
 * assistant mode must skip this helper and retain the ordinary agent list.
 */
export function filterExpertPromptAgentOptions<T extends { name?: string | null }>(
  agents: readonly T[],
  approvedAgentIds: readonly string[] = [],
): T[] {
  const allowed = normalizeApprovedAgentIds([
    EXPERT_PROMPT_DEFAULT_AGENT,
    ...approvedAgentIds,
  ]);
  return agents.filter((agent) => allowed.has(agent.name?.trim() ?? ""));
}
