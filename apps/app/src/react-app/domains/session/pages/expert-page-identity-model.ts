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
  selectAgentIdForSession,
  selectExpertSessionIds,
} from "../../../capabilities/session-identity/expert-directory-page-model";
import type { buildExpertDirectoryPageModel } from "../../../capabilities/session-identity/expert-directory-page-model";

type ExpertDirectoryPage = ReturnType<typeof buildExpertDirectoryPageModel>;

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

export function buildExpertPageIdentityModel(input: {
  directoryPage: ExpertDirectoryPage;
  workspaceSessions: SidebarSessionItem[];
  registry: AgentRegistry | null;
  selectedSessionId: string | null;
}): ExpertPageIdentityModel {
  const payload = input.directoryPage.payload;
  const liveExpertSessionIds = selectExpertSessionIds(payload);
  const expertDirectoryIdentity: ExpertDirectoryIdentityIndex = {
    sessionIds: new Set(liveExpertSessionIds),
    agentIdBySessionId: new Map(
      (payload?.records ?? []).flatMap((record) =>
        record.sessionIds.map((sessionId) => [sessionId, record.agentId] as const),
      ),
    ),
  };
  const expertDirectoryMissingSkills = [...new Set(
    (payload?.records ?? [])
      .flatMap((record) => record.missingSkills)
      .map((skill) => skill.trim())
      .filter(Boolean),
  )].sort();
  const expertDirectoryReady = input.directoryPage.state === "ready";
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
