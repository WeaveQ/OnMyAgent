/** @jsxImportSource react */
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { OpenworkServerClient } from "../../../../app/lib/onmyagent-server";
import {
  type PersonalLocalAgent,
  type PersonalLocalAgentConversation,
  type PersonalLocalAgentProvider,
  personalLocalAgentConversationCreate,
  personalLocalAgentConversationGetById,
  personalLocalAgentConversationImportFromArchive,
  personalLocalAgentConversationsList,
  personalLocalAgentConversationStatus,
} from "../../../../app/lib/desktop";
import type { SessionArchiveResumeRequest } from "./session-archive-helpers";

type UseArchiveResumeParams = {
  resumeRequest: SessionArchiveResumeRequest | null | undefined;
  agents: PersonalLocalAgent[];
  conversationsByAgent: Record<string, PersonalLocalAgentConversation[]>;
  channelConversations: PersonalLocalAgentConversation[];
  effectiveWorkspaceRoot: string;
  workspaceRoot: string;
  channelAgentId: string;
  onResumeConsumed?: () => void;
  onmyagentServerClient?: OpenworkServerClient | null;
  runtimeWorkspaceId?: string | null;
  setChannelConversations: Dispatch<SetStateAction<PersonalLocalAgentConversation[]>>;
  setSelectedAgentId: Dispatch<SetStateAction<string>>;
  setSelectedChannelConversationId: Dispatch<SetStateAction<string | null>>;
  setConversationsByAgent: Dispatch<SetStateAction<Record<string, PersonalLocalAgentConversation[]>>>;
  setSelectedConversationIdByAgent: Dispatch<SetStateAction<Record<string, string>>>;
  setErrorsByAgent: Dispatch<SetStateAction<Record<string, string | null>>>;
};

/**
 * Drives "resume a session-archive session into the local Agent view" (诉求2).
 * Extracted verbatim from `personal-local-agent-page.tsx` so the page stays
 * under the file-size gate; behavior is unchanged.
 */
export function useArchiveResume(params: UseArchiveResumeParams) {
  const {
    resumeRequest,
    agents,
    conversationsByAgent,
    channelConversations,
    effectiveWorkspaceRoot,
    workspaceRoot,
    channelAgentId,
    onResumeConsumed,
    onmyagentServerClient,
    runtimeWorkspaceId,
    setChannelConversations,
    setSelectedAgentId,
    setSelectedChannelConversationId,
    setConversationsByAgent,
    setSelectedConversationIdByAgent,
    setErrorsByAgent,
  } = params;
  const consumedResumeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const request = resumeRequest;
    if (!request) return;
    const marker = `${request.agent}:${request.providerSessionId}`;
    if (consumedResumeKeyRef.current === marker) return;
    consumedResumeKeyRef.current = marker;
    const providerMap: Record<string, string> = {
      opencode: "opencode",
      codex: "codex",
      claude: "claude",
      openclaw: "openclaw",
      hermes: "hermes",
    };
    const provider = providerMap[request.agent];
    if (!provider) return;
    (async () => {
      try {
        const client = onmyagentServerClient ?? null;
        const workspaceId = runtimeWorkspaceId ?? workspaceRoot;
        const conversationId = request.sessionId || request.providerSessionId;
        const archiveSessionId = request.sessionId;

        // Fetch archived messages (only when a server client + archive id are
        // available) and import them as the local transcript for a conversation
        // id, so the local agent view can render cross-workspace / server-side
        // history (诉求2: "resume copies the conversation over").
        const importFromArchive = async (targetProvider: string, targetAgentId: string, targetConversationId: string, title: string) => {
          console.log("[archive-resume] importFromArchive", { targetProvider, targetAgentId, targetConversationId, hasClient: Boolean(client), archiveSessionId });
          if (!client || !archiveSessionId || !targetConversationId) return null;
          const archive = await client
            .getSessionArchiveMessages(workspaceId, archiveSessionId, { limit: 500, direction: "asc" })
            .catch((error) => {
              console.error("[archive-resume] getSessionArchiveMessages failed", error);
              return null;
            });
          const messages = archive?.messages ?? [];
          console.log("[archive-resume] archive messages", messages.length);
          if (!messages.length) return null;
          const importedMessages = messages.map((raw, index) => ({
            id: String(raw.id ?? index),
            role: raw.role,
            content: raw.content,
            createdAt: raw.timestamp ? Date.parse(raw.timestamp) || Date.now() + index : Date.now() + index,
          }));
          const result = await personalLocalAgentConversationImportFromArchive({
            workspaceRoot: effectiveWorkspaceRoot,
            agent: { provider: targetProvider as PersonalLocalAgentProvider, id: targetAgentId },
            conversationId: targetConversationId,
            title,
            providerSessionId: request.providerSessionId,
            source: "session-archive-resume",
            messages: importedMessages,
          }).catch((error) => {
            console.error("[archive-resume] import failed", error);
            return null;
          });
          console.log("[archive-resume] import result", result);
          return result;
        };
        const hasLocalTranscript = async (targetProvider: string, targetAgentId: string, targetConversationId: string) => {
          const status = await personalLocalAgentConversationStatus({
            workspaceRoot: effectiveWorkspaceRoot,
            agent: { provider: targetProvider as PersonalLocalAgentProvider, id: targetAgentId },
            conversationId: targetConversationId,
          }).catch(() => null);
          const has = Boolean(status?.conversationMessages?.length);
          console.log("[archive-resume] hasLocalTranscript", { targetProvider, targetAgentId, targetConversationId, has, count: status?.conversationMessages?.length });
          return has;
        };

        const located = conversationId
          ? await personalLocalAgentConversationGetById({ workspaceRoot: effectiveWorkspaceRoot, conversationId }).then((res) => res.conversation).catch(() => null)
          : null;
        console.log("[archive-resume] located conversation", located);
        if (located) {
          const isChannel = located.source === "channel";
          if (isChannel) {
            // Surface it through the synthetic channel agent view.
            const already = channelConversations.some((item) => item.id === located.id);
            setChannelConversations((current) => (already ? current : [located, ...current]));
            setSelectedAgentId(channelAgentId);
            setSelectedChannelConversationId(located.id);
            return;
          }
          const targetAgent = agents.find((item) => item.id === located.agentId) ?? agents.find((item) => item.provider === located.provider) ?? agents.find((item) => item.id === provider) ?? null;
          const agentKey = targetAgent?.id ?? provider;
          // History is read by the hydrate hook using the *selected* agent's
          // (provider, id), not the located file's scoped agentId, so check and
          // import against that identity to keep the transcript reachable.
          const hasHistory = await hasLocalTranscript(provider, agentKey, located.id);
          if (!hasHistory) {
            await importFromArchive(provider, agentKey, located.id, located.title);
          }
          setSelectedAgentId(agentKey);
          setConversationsByAgent((current) => ({
            ...current,
            [agentKey]: current[agentKey]?.some((item) => item.id === located.id) ? current[agentKey] : [located, ...(current[agentKey] ?? [])],
          }));
          setSelectedConversationIdByAgent((current) => ({ ...current, [agentKey]: located.id }));
          return;
        }

        // Fallback: no matching local conversation — create a fresh resume
        // placeholder under the ACP agent partition (original behaviour).
        setSelectedAgentId(provider);
        const targetAgent = agents.find((item) => item.id === provider) ?? agents.find((item) => item.provider === provider) ?? null;
        const existing = conversationsByAgent[provider] ?? (await personalLocalAgentConversationsList({ workspaceRoot: effectiveWorkspaceRoot, agent: targetAgent ?? undefined })).conversations;
        const match = existing.find((item) => (item.providerSessionId ?? item.resumeKey) === request.providerSessionId);
        let selectedConversationId: string;
        if (match) {
          setConversationsByAgent((current) => ({ ...current, [provider]: existing }));
          selectedConversationId = match.id;
        } else {
          const result = await personalLocalAgentConversationCreate({
            workspaceRoot: effectiveWorkspaceRoot,
            title: request.title,
            providerSessionId: request.providerSessionId,
            resumeKey: request.providerSessionId,
            source: "session-archive-resume",
            agent: targetAgent ?? undefined,
          });
          setConversationsByAgent((current) => ({
            ...current,
            [provider]: [result.conversation, ...(current[provider] ?? existing)],
          }));
          selectedConversationId = result.conversation.id;
        }
        // Ensure the resumed conversation has its history visible: import from
        // the archive when the local transcript is empty. Use `provider` (not
        // agentKey) for the transcript partition so it matches the selected
        // agent identity used by the hydration hook (selectedAgentId=provider).
        const hasHistory = await hasLocalTranscript(provider, provider, selectedConversationId);
        if (!hasHistory) {
          const imported = await importFromArchive(provider, provider, selectedConversationId, request.title);
          const importedConversation = imported?.conversation;
          if (importedConversation) {
            setConversationsByAgent((current) => ({
              ...current,
              [provider]: current[provider]?.some((item) => item.id === importedConversation.id)
                ? current[provider]
                : [importedConversation, ...(current[provider] ?? [])],
            }));
          }
        }
        setSelectedConversationIdByAgent((current) => ({ ...current, [provider]: selectedConversationId }));
      } catch (error) {
        setErrorsByAgent((current) => ({
          ...current,
          [provider]: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        onResumeConsumed?.();
      }
    })();
  }, [resumeRequest, agents, conversationsByAgent, channelConversations, effectiveWorkspaceRoot, workspaceRoot, onResumeConsumed, onmyagentServerClient, runtimeWorkspaceId]);
}
