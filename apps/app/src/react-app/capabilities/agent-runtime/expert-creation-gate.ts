import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";

/**
 * Expert creation coach/preview currently rely on OpenCode-only structured
 * output, per-turn system/tool overrides and attachment semantics. Resolve the
 * host-owned selection before creating a native session so Grok workspaces do
 * not silently fall back to OpenCode.
 */
export async function supportsNewExpertCreationSession(
  client: OnMyAgentServerClient,
  workspaceId: string,
): Promise<boolean> {
  const selection = await client.getAgentRuntimeSelection(workspaceId);
  const runtimeKind = selection.config?.workspaceOverrides[workspaceId]
    ?? selection.config?.defaultRuntimeKind
    ?? "opencode";
  return runtimeKind === "opencode";
}
