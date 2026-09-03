/** Session route navigation-state helpers for agent-management deep links + expert install. */
import { createClient, unwrap } from "../../../app/lib/opencode";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import type { Client } from "../../../app/types";
import {
  createExpertOperationId,
  refreshExpertPackageQuery,
  usePendingAgentStore,
  type PendingAgentContext,
} from "../../domains/agents";
import { ensureMarketplaceExpertInstalled } from "../../domains/plugins";
import {
  startExpertColdPrewarm,
  type SessionAgentManagementIntent,
} from "../../domains/session";
import { createIsolatedExpertSessionRuntimeDirectory } from "../../capabilities/session-identity/expert-session-directory";
import { normalizeExpertWritePackageName } from "../../capabilities/session-identity/expert-package-name";
import { useExpertDirectoryStore } from "../../capabilities/session-identity/expert-directory-store";
import { resolvePendingAgentForPrompt } from "./agent-context";
import { bindExpertFreshIdleDraft } from "./created-session-actions";
import {
  scheduleIdleExpertColdPrewarmTask,
  type ScheduleIdleWorkInput,
} from "./prewarm-schedule";

export function readStringStateField(state: unknown, key: string) {
  if (!state || typeof state !== "object") return null;
  const value = Reflect.get(state, key);
  return typeof value === "string" ? value.trim() || null : null;
}

export function readSessionAgentManagementIntent(
  state: unknown,
): SessionAgentManagementIntent | null {
  const action = readStringStateField(state, "agentManagementAction");
  if (action !== "openPanel") return null;
  const panelRaw = readStringStateField(state, "agentManagementPanel");
  const panel =
    panelRaw === "agents" || panelRaw === "skills" ? panelRaw : undefined;
  return {
    action: "openPanel",
    panel,
    key: readStringStateField(state, "agentManagementActionKey") ?? action,
  };
}

export function clearSessionAgentManagementIntentState(state: unknown) {
  if (!state || typeof state !== "object") return undefined;
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(state)) {
    if (
      key === "agentManagementAction" ||
      key === "agentManagementActionKey" ||
      key === "agentManagementPanel"
    ) {
      continue;
    }
    next[key] = Reflect.get(state, key);
  }
  return next;
}

/**
 * Ensure a marketplace expert package is installed.
 *
 * Deduped by the install coordinator: safe to kick off early (on send / summon)
 * and join again later — concurrent callers share one in-flight promise, and
 * already-installed packages resolve immediately.
 */
export async function installMarketplaceExpertAfterSessionCreated(
  agent: PendingAgentContext,
) {
  const marketplaceExpert = agent.marketplaceExpert;
  if (!marketplaceExpert) return;
  try {
    await ensureMarketplaceExpertInstalled(marketplaceExpert);
    await refreshExpertPackageQuery();
  } catch (error) {
    console.warn("[expert-marketplace] failed to install expert package", error);
  }
}

/** Fire-and-forget install; errors are logged inside the await helper. */
export function kickoffMarketplaceExpertInstall(agent: PendingAgentContext | null | undefined) {
  if (!agent?.marketplaceExpert) return Promise.resolve();
  return installMarketplaceExpertAfterSessionCreated(agent);
}

export function openExpertFreshIdleDraft(input: {
  workspaceId: string;
  selectedSessionId: string | null;
  forceNewSessionOnNextSendRef: { current: boolean };
  openIdleDraft: (workspaceId: string) => void;
}): PendingAgentContext | null {
  const inheritAgentId = input.selectedSessionId
    ? useExpertDirectoryStore
        .getState()
        .getIdentity(input.workspaceId)
        .agentIdBySessionId.get(input.selectedSessionId) ?? null
    : null;
  const { pendingAgentSnapshot } = resolvePendingAgentForPrompt({
    currentAgent: usePendingAgentStore.getState().getAgent(),
    createdSession: true,
    sessionId: `draft:${input.workspaceId}`,
    inheritFromSessionId: input.selectedSessionId,
    inheritAgentId,
  });
  return bindExpertFreshIdleDraft({
    workspaceId: input.workspaceId,
    forceNewSessionOnNextSendRef: input.forceNewSessionOnNextSendRef,
    openIdleDraft: input.openIdleDraft,
    pendingAgentSnapshot,
    setAgent: (agent) => usePendingAgentStore.getState().setAgent(agent),
    createOperationId: createExpertOperationId,
  });
}

export function scheduleIdleExpertColdPrewarm(input: {
  agent: PendingAgentContext;
  workspaceId: string;
  workspaceRoot: string;
  client: OnMyAgentServerClient | null;
  opencodeClient: Client | null;
  opencodeBaseUrl: string;
  token: string;
  host?: ScheduleIdleWorkInput["host"];
}): void {
  const workspaceId = input.workspaceId.trim();
  const workspaceRoot = input.workspaceRoot.trim();
  const agentId = input.agent.id.trim();
  const client = input.client;
  const opencodeClient = input.opencodeClient;
  const baseUrl = input.opencodeBaseUrl.trim();
  if (!workspaceId || !workspaceRoot || !agentId || !client || !opencodeClient || !baseUrl) {
    return;
  }
  const agentName = input.agent.name.trim() || "expert";
  const skillNames = input.agent.skillIds ?? [];
  const packageName = normalizeExpertWritePackageName({
    agentId,
    packageName: input.agent.marketplaceExpert?.packageName,
  });
  const approvedAgentIds = input.agent.approvedAgentIds ?? [];
  const token = input.token.trim();
  scheduleIdleExpertColdPrewarmTask({
    agentId,
    host: input.host,
    getCurrentAgent: () => usePendingAgentStore.getState().getAgent(),
    startPrewarm: () => {
      startExpertColdPrewarm(
        {
          workspaceId,
          agentId,
          agentName,
          packageName,
          approvedAgentIds,
          skillNames,
        },
        {
          createIsolatedDirectory: () =>
            createIsolatedExpertSessionRuntimeDirectory({
              client,
              workspaceId,
              workspaceRoot,
              agentName,
              agentId,
              packageName,
              approvedAgentIds,
              skillNames,
            }),
          createSession: async (directory) => {
            const opencode = createClient(baseUrl, directory || undefined, {
              mode: "onmyagent",
              token: token || undefined,
            });
            const created = unwrap(await opencode.session.create({ directory }));
            return { id: created.id };
          },
        },
      );
    },
  });
}
