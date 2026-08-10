// Host status (skills / MCP / permissions) for the personal-agent runtime.
//
// Extracted from the runtime factory so the read-only status assembly lives
// next to the host-status view-model builders it composes. The runtime passes
// in the bound getConversationStatus it owns.

import { personalAgentMetadataFromAgent } from "./agent-metadata.mjs";
import { buildMcpStatus, buildPermissionStatus, buildSkillStatus } from "./host-status.mjs";
import { readNativeMcpConfig, resolveNativeSkillRoots } from "./host-status-sources.mjs";
import { listRememberedApprovalDecisions } from "./approval-store.mjs";
import {
  collectSkillRootOverrides,
  mergeMcpServers,
} from "./run-helpers.mjs";

/**
 * @param {object} deps
 * @param {object} deps.legacy
 * @param {(input: object) => Promise<object>} deps.getConversationStatus
 */
export function createHostStatusService(deps) {
  const { legacy, getConversationStatus } = deps;

  return async function getHostStatus(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const agent = input.agent ? await legacy.normalizeAgent(input.agent).catch(() => null) : null;
    // Skill roots: per-provider defaults, agent overrides, and caller roots.
    const agentMetadata = agent ? personalAgentMetadataFromAgent(agent) : null;
    const overrides = collectSkillRootOverrides(
      agentMetadata?.native_skills_dirs,
      input.additionalSkillRoots,
    );
    const nativeSkillsDirs = agent
      ? await resolveNativeSkillRoots(agent, workspaceRoot, overrides)
      : [];
    // Live event stream + handshake commands feed the MCP view-model.
    const status = agent && input.conversationId
      ? await getConversationStatus({ workspaceRoot, agent, conversationId: input.conversationId }).catch(() => null)
      : null;
    const conversationMessages = status?.conversationMessages ?? [];
    const availableCommands = Array.isArray(agentMetadata?.handshake?.available_commands)
      ? agentMetadata.handshake.available_commands
      : [];
    const remembered = workspaceRoot ? await listRememberedApprovalDecisions(workspaceRoot) : [];
    const nativeMcp = agent
      ? await readNativeMcpConfig(agent, workspaceRoot).catch((error) => ({ servers: [], errors: [{ file: "<readNativeMcpConfig>", message: String(error?.message || error) }] }))
      : { servers: [], errors: [] };
    const [skill, liveMcp, permission] = await Promise.all([
      buildSkillStatus({ nativeSkillsDirs }),
      Promise.resolve(buildMcpStatus({ conversationMessages, availableCommands })),
      Promise.resolve(buildPermissionStatus({
        pendingApprovals: status?.activeRun?.pendingApprovals ?? [],
        conversationMessages,
        rememberedDecisions: remembered,
      })),
    ]);
    // Config-file MCP servers merge with live tool-call observations.
    const mcp = {
      servers: mergeMcpServers(nativeMcp.servers, liveMcp.servers),
      error: liveMcp.error || null,
      sourceErrors: nativeMcp.errors,
    };
    return {
      workspaceRoot,
      agentId: agent?.id ?? null,
      conversationId: status?.conversation?.id ?? input.conversationId ?? null,
      skill,
      mcp,
      permission,
    };
  };
}
