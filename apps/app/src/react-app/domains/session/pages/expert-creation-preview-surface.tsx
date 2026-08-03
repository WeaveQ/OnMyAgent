/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { createClient, unwrap } from "../../../../app/lib/opencode";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import type { ComposerDraft, ModelRef } from "../../../../app/types";
import { t } from "../../../../i18n";
import {
  sessionSnapshotQueryKey,
} from "../sync/session-snapshot-query-policy";
import { trackWorkspaceSessionSync } from "../sync/session-sync";
import { SessionSurface } from "../surface/session-surface";
import type { SessionSurfaceAssemblyProps } from "../surface/session-surface-types";
import {
  writeSessionAgentSnapshot,
  type AgentRegistry,
  type AgentWizardDraft,
  buildExpertChatPromptParts,
  buildExpertCreationPreviewPendingContext,
  buildExpertCreationPreviewToolAccess,
  buildExpertPreviewSystemPrompt,
  deleteExpertCreationEphemeralSession,
  registerExpertCreationEphemeralSession,
} from "../../agents";

export type ExpertCreationPreviewSurfaceProps = {
  surface: SessionSurfaceAssemblyProps;
  client: OnMyAgentServerClient;
  workspaceId: string;
  workspaceRoot: string;
  opencodeBaseUrl: string;
  onmyagentToken: string;
  registry: AgentRegistry;
  draft: AgentWizardDraft;
  knowledgePaths: readonly string[];
  selectedModel: ModelRef | null;
  /** Remount key when draft identity fields change or user starts a new session. */
  sessionKey: string;
  emptyContent: ReactNode;
};

/**
 * Expert-creation right panel ("try it"): SessionSurface chat fixed to the
 * draft expert being created. Isolated session — not listed in expert sidebar.
 */
export function ExpertCreationPreviewSurface(
  props: ExpertCreationPreviewSurfaceProps,
) {
  const queryClient = useQueryClient();
  const draftRef = useRef(props.draft);
  draftRef.current = props.draft;
  const knowledgeRef = useRef(props.knowledgePaths);
  knowledgeRef.current = props.knowledgePaths;

  const draftSessionId = useMemo(
    () => `draft:expert-creation-preview:${props.workspaceId}:${props.sessionKey}`,
    [props.sessionKey, props.workspaceId],
  );
  // Host remounts this component when sessionKey changes (draft identity / new chat).
  const [sessionId, setSessionId] = useState(draftSessionId);
  const [draftOnly, setDraftOnly] = useState(true);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const disposableSessionIdRef = useRef<string | null>(null);
  const cleanupContextRef = useRef({
    client: props.client,
    workspaceId: props.workspaceId,
    workspaceRoot: props.workspaceRoot,
  });
  cleanupContextRef.current = {
    client: props.client,
    workspaceId: props.workspaceId,
    workspaceRoot: props.workspaceRoot,
  };

  useEffect(
    () => () => {
      const disposableSessionId = disposableSessionIdRef.current;
      if (!disposableSessionId) return;
      writeSessionAgentSnapshot(disposableSessionId, null);
      const cleanup = cleanupContextRef.current;
      void deleteExpertCreationEphemeralSession({
        client: cleanup.client,
        workspaceId: cleanup.workspaceId,
        workspaceRoot: cleanup.workspaceRoot,
        sessionId: disposableSessionId,
      }).catch((error) => {
        console.warn("[expert-creation] failed to delete preview session", error);
      });
    },
    [],
  );

  const agentContext = useMemo(
    () =>
      buildExpertCreationPreviewPendingContext(
        props.registry,
        props.draft,
        props.knowledgePaths,
      ),
    [props.draft, props.knowledgePaths, props.registry],
  );

  const canChat = props.draft.name.trim().length > 0;

  const onSendDraft = useCallback(
    async (composerDraft: ComposerDraft) => {
      if (!props.opencodeBaseUrl.trim() || !canChat) return;

      const opencode = createClient(
        props.opencodeBaseUrl,
        props.workspaceRoot || undefined,
        {
          token: props.onmyagentToken || undefined,
          mode: "onmyagent",
        },
      );

      let activeSessionId = sessionIdRef.current;
      if (draftOnly || activeSessionId.startsWith("draft:")) {
        activeSessionId = unwrap(
          await opencode.session.create({
            directory: props.workspaceRoot || undefined,
          }),
        ).id;
        registerExpertCreationEphemeralSession(activeSessionId);
        disposableSessionIdRef.current = activeSessionId;
        setSessionId(activeSessionId);
        setDraftOnly(false);
        sessionIdRef.current = activeSessionId;
        const ctx = buildExpertCreationPreviewPendingContext(
          props.registry,
          draftRef.current,
          knowledgeRef.current,
        );
        if (ctx) writeSessionAgentSnapshot(activeSessionId, ctx);
      }

      const text =
        (composerDraft.resolvedText ?? composerDraft.text).trim() ||
        composerDraft.parts
          .filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text)
          .join("")
          .trim();
      if (!text && composerDraft.attachments.length === 0) return;

      const parts = await buildExpertChatPromptParts(
        text,
        composerDraft.attachments.map((item) => item.file),
      );
      const system = buildExpertPreviewSystemPrompt(
        draftRef.current,
        knowledgeRef.current,
      );
      const tools = buildExpertCreationPreviewToolAccess(draftRef.current);
      const model = props.selectedModel ?? props.surface.model.selectedModel;

      const release = trackWorkspaceSessionSync(
        {
          workspaceId: props.workspaceId,
          baseUrl: props.opencodeBaseUrl,
          directory: props.workspaceRoot,
          onmyagentToken: props.onmyagentToken,
        },
        activeSessionId,
      );
      try {
        const result = await opencode.session.promptAsync({
          sessionID: activeSessionId,
          directory: props.workspaceRoot || undefined,
          system,
          ...(tools ? { tools } : {}),
          ...(model ? { model } : {}),
          parts,
        });
        if (result.error) {
          throw new Error(
            typeof result.error === "object" &&
              result.error &&
              "message" in result.error &&
              typeof result.error.message === "string"
              ? result.error.message
              : "Preview request failed",
          );
        }
      } finally {
        release();
        void queryClient.invalidateQueries({
          queryKey: sessionSnapshotQueryKey(props.workspaceId, activeSessionId),
        });
      }
    },
    [
      canChat,
      draftOnly,
      props.opencodeBaseUrl,
      props.onmyagentToken,
      props.registry,
      props.selectedModel,
      props.surface.model.selectedModel,
      props.workspaceId,
      props.workspaceRoot,
      queryClient,
    ],
  );

  const onDraftChange = useCallback((_draft: ComposerDraft) => {
    // Surface owns per-session composer state.
  }, []);

  if (!agentContext) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-dls-secondary">
        {t("agents.expert_creation_preview_failed")}
      </div>
    );
  }

  const agentLabel =
    props.draft.name.trim() || t("agents.expert_creation_preview_title");

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <SessionSurface
        {...props.surface}
        chrome="embedded"
        emptyContent={props.emptyContent}
        client={props.client}
        workspaceId={props.workspaceId}
        workspaceRoot={props.workspaceRoot}
        sessionId={sessionId}
        draftOnly={draftOnly}
        opencodeBaseUrl={props.opencodeBaseUrl}
        onmyagentToken={props.onmyagentToken}
        agentContext={agentContext}
        agentLabel={agentLabel}
        selectedAgent={null}
        onSelectAgent={() => undefined}
        headerActions={null}
        conversationTabs={null}
        onSendDraft={onSendDraft}
        onDraftChange={onDraftChange}
        personalAssistantHome={false}
        surfaceVisible
        model={{
          ...props.surface.model,
          modelUnavailable:
            props.surface.model.modelUnavailable === true || !canChat,
        }}
      />
    </div>
  );
}
