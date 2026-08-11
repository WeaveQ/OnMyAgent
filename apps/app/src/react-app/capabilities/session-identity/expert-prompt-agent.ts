/** Expert sessions may use only the light default or package-approved ids. */

export const EXPERT_PROMPT_DEFAULT_AGENT = "onmyagent";

export const EXPERT_RUNTIME_CONTRACT_ERROR_CODE =
  "expert_runtime_contract_violated";

function normalizeApprovedAgentIds(
  approvedAgentIds: readonly string[],
): Set<string> {
  return new Set(
    approvedAgentIds.map((agentId) => agentId.trim()).filter(Boolean),
  );
}

/**
 * Resolve the OpenCode `agent` field for promptAsync on expert turns.
 * - Permit an explicitly package-approved composer selection.
 * - Otherwise use the light default.
 * - Fail closed for every other id; the server repeats this assertion.
 */
export function resolveExpertPromptAgent(
  selectedAgent: string | null | undefined,
  approvedAgentIds: readonly string[] = [],
): string {
  const selected = selectedAgent?.trim() ?? "";
  if (!selected) return EXPERT_PROMPT_DEFAULT_AGENT;
  if (selected === EXPERT_PROMPT_DEFAULT_AGENT) return selected;
  if (normalizeApprovedAgentIds(approvedAgentIds).has(selected)) return selected;
  throw new Error(EXPERT_RUNTIME_CONTRACT_ERROR_CODE);
}
