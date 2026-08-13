import type { SidebarSessionItem } from "../../../../app/types";
import type { AgentRegistry } from "../../agents";
import {
  buildAgentConversationGroups,
  type AgentConversationGroup,
} from "../sidebar/session-chrome";
import {
  computeHasAnyExpertConversation,
  type ExpertDirectoryIdentityIndex,
} from "./expert-conversation-model";
import {
  isLiveExpertSessionSelection,
  readRealSessionId,
} from "./expert-surface-mode";
import {
  isExpertDirectoryReadyForIdentity,
  selectLiveDirectoryPayload,
  selectAgentIdForSession,
  selectExpertSessionIds,
} from "../../../capabilities/session-identity/expert-directory-page-model";
import type {
  buildExpertDirectoryPageModel,
  ExpertDirectoryQuerySnapshot,
} from "../../../capabilities/session-identity/expert-directory-page-model";

type ExpertDirectoryPage = ReturnType<typeof buildExpertDirectoryPageModel>;

/** Prefer the active expert's missing skills; fall back to full directory union. */
export function collectExpertMissingSkills(
  records: readonly { agentId: string; missingSkills?: readonly string[] | null }[] | null | undefined,
  currentAgentId: string | null | undefined,
): string[] {
  const list = records ?? [];
  const agentId = currentAgentId?.trim() || null;
  const scoped = agentId
    ? list.filter((record) => record.agentId === agentId)
    : list;
  return [...new Set(
    scoped
      .flatMap((record) => record.missingSkills ?? [])
      .map((skill) => (typeof skill === "string" ? skill.trim() : ""))
      .filter(Boolean),
  )].sort();
}

export type ExpertPageIdentityModel = {
  expertDirectoryIdentity: ExpertDirectoryIdentityIndex;
  expertDirectoryMissingSkills: string[];
  expertDirectoryReady: boolean;
  routeSessionLive: boolean;
  effectiveSelectedSessionId: string | null;
  routeRealSessionId: string | null;
  currentConversationAgentId: string | null;
  conversationGroups: AgentConversationGroup[];
  hasAnyExpertConversation: boolean;
};

export { isExpertDirectoryReadyForIdentity };

export function buildExpertPageIdentityModel(input: {
  directoryPage: ExpertDirectoryPage;
  workspaceSessions: SidebarSessionItem[];
  registry: AgentRegistry | null;
  selectedSessionId: string | null;
  directoryQuery?: Pick<ExpertDirectoryQuerySnapshot, "data" | "lastComplete">;
}): ExpertPageIdentityModel {
  const payload = input.directoryQuery
    ? selectLiveDirectoryPayload(input.directoryQuery) ?? input.directoryPage.payload
    : input.directoryPage.payload;
  const liveExpertSessionIds = selectExpertSessionIds(payload);
  const expertDirectoryIdentity: ExpertDirectoryIdentityIndex = {
    sessionIds: new Set(liveExpertSessionIds),
    agentIdBySessionId: new Map(
      (payload?.records ?? []).flatMap((record) =>
        (record.sessionIds ?? []).map((sessionId) => [sessionId, record.agentId] as const),
      ),
    ),
  };
  // Cold-open requires ready. Incomplete live records are ready enough;
  // a stale lastComplete snapshot is not live identity.
  const expertDirectoryReady = isExpertDirectoryReadyForIdentity({
    state: input.directoryPage.state,
    payload,
    data: input.directoryQuery?.data,
    lastComplete: input.directoryQuery?.lastComplete,
  });
  const routeSessionLive = isLiveExpertSessionSelection({
    selectedSessionId: input.selectedSessionId,
    liveSessionIds: liveExpertSessionIds,
    inventoryReady: expertDirectoryReady,
  });
  const effectiveSelectedSessionId = routeSessionLive
    ? input.selectedSessionId
    : null;
  const routeRealSessionId = readRealSessionId(effectiveSelectedSessionId);
  const currentConversationAgentId = routeRealSessionId
    ? selectAgentIdForSession(payload, routeRealSessionId)
    : null;
  // Scope the banner to the active expert conversation when possible so
  // fleet users do not see proposal-strategist skill names mixed in.
  const expertDirectoryMissingSkills = collectExpertMissingSkills(
    payload?.records,
    currentConversationAgentId,
  );
  const conversationGroups = buildAgentConversationGroups(
    input.workspaceSessions,
    input.registry,
    expertDirectoryIdentity,
  );
  return {
    expertDirectoryIdentity,
    expertDirectoryMissingSkills,
    expertDirectoryReady,
    routeSessionLive,
    effectiveSelectedSessionId,
    routeRealSessionId,
    currentConversationAgentId,
    conversationGroups,
    hasAnyExpertConversation: computeHasAnyExpertConversation(
      input.workspaceSessions,
      expertDirectoryIdentity,
    ),
  };
}
