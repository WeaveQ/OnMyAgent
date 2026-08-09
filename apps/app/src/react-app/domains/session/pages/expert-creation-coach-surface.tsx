/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { createClient, unwrap } from "../../../../app/lib/opencode";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import type { ComposerDraft, ModelRef } from "../../../../app/types";
import { t } from "../../../../i18n";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import {
  sessionSnapshotQueryKey,
} from "../sync/session-snapshot-query-policy";
import { trackWorkspaceSessionSync } from "../sync/session-sync";
import { SessionSurface } from "../surface/session-surface";
import type { SessionSurfaceAssemblyProps } from "../surface/session-surface-types";
import { buildIsolatedExpertCreationModel } from "./expert-creation-embedded-model";
import {
  ExpertCreationSuggestionAccessory,
  confirmExpertCreationSuggestion,
} from "./expert-creation-suggestion-accessory";
import {
  writeSessionAgentSnapshot,
  type AgentRegistry,
  type AgentWizardDraft,
  type ExpertCreationSuggestionApplyOptions,
  buildExpertCreationCoachPendingContext,
  buildExpertCreationCoachSystemPrompt,
  buildExpertCreationCoachToolAccess,
  resolveExpertCreationCoachAgent,
  expertDraftSuggestionFingerprint,
  isExpertDraftSuggestionConfirmation,
  parseExpertDraftSuggestion,
  partitionExpertDraftSuggestion,
  createExpertPreviewAcceptanceGate,
  runExpertPreviewTurn,
  type ExpertDraftSuggestion,
  type ExpertDraftSuggestionField,
  EXPERT_CREATION_COACH_AVATAR_PATH,
  ExpertCreationCoachWelcome,
  registerExpertCreationEphemeralSession,
} from "../../agents";

export type ExpertCreationCoachSurfaceProps = {
  surface: SessionSurfaceAssemblyProps;
  client: OnMyAgentServerClient;
  workspaceId: string;
  workspaceRoot: string;
  opencodeBaseUrl: string;
  onmyagentToken: string;
  registry: AgentRegistry;
  draft: AgentWizardDraft;
  showModelPicker?: boolean;
  selectedModel: ModelRef | null;
  initialSessionId: string | null;
  onSessionIdChange: (sessionId: string) => void;
  onApplyDraftSuggestion: (
    suggestion: ExpertDraftSuggestion,
    options: ExpertCreationSuggestionApplyOptions,
  ) => void;
};

function suggestionFieldLabel(field: ExpertDraftSuggestionField): string {
  switch (field) {
    case "name":
      return t("agents.expert_creation_suggestion_field_name");
    case "description":
      return t("agents.expert_creation_suggestion_field_description");
    case "userNote":
      return t("agents.expert_creation_suggestion_field_role_prompt");
    case "agentMemory":
      return t("agents.expert_creation_suggestion_field_memory");
  }
}

function formatSuggestionFields(fields: readonly ExpertDraftSuggestionField[]): string {
  return fields
    .map(suggestionFieldLabel)
    .join(t("agents.expert_creation_suggestion_field_sep"));
}

/**
 * Expert-creation left panel: full SessionSurface transcript/composer, fixed to
 * the builtin coach agent, with an isolated session that does not enter the
 * expert sidebar list.
 */
export function ExpertCreationCoachSurface(props: ExpertCreationCoachSurfaceProps) {
  const queryClient = useQueryClient();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const draftRef = useRef(props.draft);
  draftRef.current = props.draft;

  const coachAgent = resolveExpertCreationCoachAgent(props.registry);
  const draftSessionId = useMemo(
    () => `draft:expert-creation-coach:${props.workspaceId}`,
    [props.workspaceId],
  );
  const restoredSessionId = props.initialSessionId?.trim() ?? "";
  const [sessionId, setSessionId] = useState(
    restoredSessionId || draftSessionId,
  );
  const [draftOnly, setDraftOnly] = useState(!restoredSessionId);
  const [pendingSuggestion, setPendingSuggestion] = useState<{
    messageId: string;
    suggestion: ExpertDraftSuggestion;
  } | null>(null);
  const [dismissedSuggestionKey, setDismissedSuggestionKey] = useState<string | null>(
    null,
  );
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const agentContext = useMemo(() => {
    return buildExpertCreationCoachPendingContext(props.registry, props.draft);
  }, [props.registry, props.draft]);

  useEffect(() => {
    if (!restoredSessionId) return;
    registerExpertCreationEphemeralSession(restoredSessionId);
  }, [restoredSessionId]);

  const ingestAssistantText = useCallback(
    (messageId: string, content: string) => {
      const parsed = parseExpertDraftSuggestion(content);
      if (!parsed.suggestion) return;
      setPendingSuggestion({ messageId, suggestion: parsed.suggestion });
    },
    [],
  );

  const onSendDraft = useCallback(
    async (composerDraft: ComposerDraft) => {
      if (!props.opencodeBaseUrl.trim() || !coachAgent) return;
      const opencode = createClient(props.opencodeBaseUrl, props.workspaceRoot || undefined, {
        token: props.onmyagentToken || undefined,
        mode: "onmyagent",
      });

      let activeSessionId = sessionIdRef.current;
      let createdSession = false;
      if (draftOnly || activeSessionId.startsWith("draft:")) {
        activeSessionId = unwrap(
          await opencode.session.create({
            directory: props.workspaceRoot || undefined,
          }),
        ).id;
        createdSession = true;
        registerExpertCreationEphemeralSession(activeSessionId);
        props.onSessionIdChange(activeSessionId);
        setSessionId(activeSessionId);
        setDraftOnly(false);
        sessionIdRef.current = activeSessionId;
        if (agentContext) {
          writeSessionAgentSnapshot(activeSessionId, agentContext);
        }
      }

      const text =
        (composerDraft.resolvedText ?? composerDraft.text).trim() ||
        composerDraft.parts
          .filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text)
          .join("")
          .trim();
      const pendingKey = pendingSuggestion
        ? expertDraftSuggestionFingerprint(
            pendingSuggestion.messageId,
            pendingSuggestion.suggestion,
          )
        : null;
      const confirmedSuggestion =
        pendingSuggestion &&
        pendingKey !== dismissedSuggestionKey &&
        isExpertDraftSuggestionConfirmation(text)
          ? pendingSuggestion.suggestion
          : null;
      const attachmentFiles = composerDraft.attachments.map((item) => item.file);
      const system = buildExpertCreationCoachSystemPrompt(
        coachAgent,
        draftRef.current,
        props.registry.skills,
      );
      const tools = buildExpertCreationCoachToolAccess(coachAgent);
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
      const acceptance = createExpertPreviewAcceptanceGate();
      const turn = runExpertPreviewTurn({
        config: {
          baseUrl: props.opencodeBaseUrl,
          token: props.onmyagentToken || null,
          workspaceRoot: props.workspaceRoot,
        },
        sessionId: activeSessionId,
        message: text,
        attachments: attachmentFiles,
        draft: draftRef.current,
        systemPrompt: system,
        tools,
        onPromptAccepted: () => {
          acceptance.accept();
          if (!confirmedSuggestion) return;
          props.onApplyDraftSuggestion(confirmedSuggestion, { mode: "force" });
          setPendingSuggestion(null);
          setDismissedSuggestionKey(null);
        },
        ...(model ? { model } : {}),
      });
      const completedTurn = turn
        .then((result) => {
          if (confirmedSuggestion) return;
          ingestAssistantText(
            `${activeSessionId}:assistant-output`,
            result.content,
          );
        })
        .finally(() => {
          release();
          void queryClient.invalidateQueries({
            queryKey: sessionSnapshotQueryKey(props.workspaceId, activeSessionId),
          });
          if (createdSession) {
            // no-op: keep session private — never addExpertSession
          }
      });
      void completedTurn.catch(() => undefined);
      await acceptance.waitForSubmission(turn);
    },
    [
      agentContext,
      coachAgent,
      draftOnly,
      ingestAssistantText,
      dismissedSuggestionKey,
      pendingSuggestion,
      props.opencodeBaseUrl,
      props.onApplyDraftSuggestion,
      props.onmyagentToken,
      props.onSessionIdChange,
      props.selectedModel,
      props.surface.model.selectedModel,
      props.workspaceId,
      props.workspaceRoot,
      queryClient,
    ],
  );

  const onDraftChange = useCallback((_draft: ComposerDraft) => {
    // Surface owns composer draft store per sessionId; no host mirror needed.
  }, []);

  const suggestionKey = pendingSuggestion
    ? expertDraftSuggestionFingerprint(
        pendingSuggestion.messageId,
        pendingSuggestion.suggestion,
      )
    : null;
  const partition = pendingSuggestion
    ? partitionExpertDraftSuggestion(props.draft, pendingSuggestion.suggestion)
    : null;

  const showSuggestionBar = Boolean(
    pendingSuggestion &&
      suggestionKey &&
      dismissedSuggestionKey !== suggestionKey &&
      partition &&
      (partition.emptyFillKeys.length > 0 || partition.conflictKeys.length > 0),
  );

  if (!coachAgent || !agentContext) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-dls-secondary">
        {t("agents.expert_creation_coach_unavailable")}
      </div>
    );
  }

  const coachTitle = t("agents.expert_creation_coach");
  const coachAvatarSrc = resolvePublicAssetUrl(EXPERT_CREATION_COACH_AVATAR_PATH);
  const coachWelcome = (
    <ExpertCreationCoachWelcome
      onPickOption={(reply) => {
        void onSendDraft({
          mode: "prompt",
          text: reply,
          parts: [{ type: "text", text: reply }],
          attachments: [],
        });
      }}
    />
  );
  const suggestionAccessory = showSuggestionBar && partition ? (
    <ExpertCreationSuggestionAccessory
      title={
        partition.conflictKeys.length > 0
          ? t("agents.expert_creation_suggestion_bar_conflict")
          : t("agents.expert_creation_suggestion_bar_ready")
      }
      detail={
        partition.conflictKeys.length > 0
          ? t("agents.expert_creation_suggestion_bar_conflict_detail", {
              fields: formatSuggestionFields(partition.conflictKeys),
            })
          : t("agents.expert_creation_suggestion_bar_ready_detail", {
              fields: formatSuggestionFields(partition.emptyFillKeys),
            })
      }
      dismissLabel={t("agents.expert_creation_suggestion_ignore")}
      confirmLabel={t("agents.expert_creation_suggestion_apply")}
      onDismiss={() => {
        if (suggestionKey) setDismissedSuggestionKey(suggestionKey);
      }}
      onConfirm={() => {
        confirmExpertCreationSuggestion({
          pendingSuggestion: pendingSuggestion?.suggestion ?? null,
          onApplyDraftSuggestion: props.onApplyDraftSuggestion,
          onConfirmed: () => {
            setPendingSuggestion(null);
            setDismissedSuggestionKey(null);
          },
        });
      }}
    />
  ) : null;

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-dls-border/40 bg-dls-surface">
      {/* Match form panel header (h-14 + px-5) so coach / tabs tops align. */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-dls-border/70 px-5">
        <img
          src={coachAvatarSrc}
          alt=""
          className="size-8 shrink-0 rounded-full object-cover ring-1 ring-dls-border/50"
        />
        <div className="min-w-0 leading-tight">
          <h2 className="truncate text-sm font-semibold text-dls-text">
            {coachTitle}
          </h2>
          <p className="mt-0.5 truncate text-xs leading-4 text-dls-secondary">
            {t("agents.expert_creation_coach_desc")}
          </p>
        </div>
      </div>
      {/*
        No extra host pad: embedded SessionSurface owns horizontal/vertical
        gutters so we don't double px-4/5 with transcript px-4 md:px-8.
      */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <SessionSurface
          {...props.surface}
          chrome="embedded"
          emptyContent={coachWelcome}
          client={props.client}
          workspaceId={props.workspaceId}
          workspaceRoot={props.workspaceRoot}
          sessionId={sessionId}
          draftOnly={draftOnly}
          opencodeBaseUrl={props.opencodeBaseUrl}
          onmyagentToken={props.onmyagentToken}
          agentContext={agentContext}
          agentLabel={coachTitle}
          selectedAgent={null}
          onSelectAgent={() => undefined}
          headerActions={null}
          conversationTabs={null}
          onSendDraft={onSendDraft}
          onDraftChange={onDraftChange}
          extraComposerAccessory={suggestionAccessory}
          personalAssistantHome={false}
          surfaceVisible
          model={buildIsolatedExpertCreationModel(
            props.surface.model,
            modelPickerOpen,
            setModelPickerOpen,
            props.showModelPicker,
          )}
        />
      </div>
    </aside>
  );
}
