/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { createClient, unwrap } from "../../../../app/lib/opencode";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import type { ComposerDraft, ModelRef } from "../../../../app/types";
import { t } from "../../../../i18n";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { Button } from "@/components/ui/button";
import {
  sessionSnapshotQueryKey,
} from "../sync/session-snapshot-query-policy";
import { trackWorkspaceSessionSync } from "../sync/session-sync";
import { SessionSurface } from "../surface/session-surface";
import type { SessionSurfaceAssemblyProps } from "../surface/session-surface-types";
import { buildIsolatedExpertCreationModel } from "./expert-creation-embedded-model";
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
  parseExpertDraftSuggestion,
  partitionExpertDraftSuggestion,
  runExpertPreviewTurn,
  type ExpertDraftSuggestion,
  type ExpertDraftSuggestionApplyMode,
  type ExpertDraftSuggestionField,
  EXPERT_CREATION_COACH_AVATAR_PATH,
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
  const [autoFilledSuggestionKey, setAutoFilledSuggestionKey] = useState<string | null>(
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
      try {
        const result = await runExpertPreviewTurn({
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
          ...(model ? { model } : {}),
        });
        ingestAssistantText(
          `${activeSessionId}:assistant-output`,
          result.content,
        );
      } finally {
        release();
        void queryClient.invalidateQueries({
          queryKey: sessionSnapshotQueryKey(props.workspaceId, activeSessionId),
        });
        if (createdSession) {
          // no-op: keep session private — never addExpertSession
        }
      }
    },
    [
      agentContext,
      coachAgent,
      draftOnly,
      ingestAssistantText,
      props.opencodeBaseUrl,
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

  // Auto-fill empty fields once per proposal.
  useEffect(() => {
    if (!pendingSuggestion || !suggestionKey || !partition) return;
    if (dismissedSuggestionKey === suggestionKey) return;
    if (autoFilledSuggestionKey === suggestionKey) return;
    setAutoFilledSuggestionKey(suggestionKey);
    if (partition.emptyFillKeys.length === 0) return;
    props.onApplyDraftSuggestion(pendingSuggestion.suggestion, {
      mode: "empty-only",
    });
  }, [
    autoFilledSuggestionKey,
    dismissedSuggestionKey,
    partition,
    pendingSuggestion,
    props.onApplyDraftSuggestion,
    suggestionKey,
  ]);

  const showSuggestionBar = Boolean(
    pendingSuggestion &&
      suggestionKey &&
      dismissedSuggestionKey !== suggestionKey &&
      autoFilledSuggestionKey === suggestionKey &&
      partition &&
      partition.conflictKeys.length > 0,
  );

  const applySuggestion = (mode: ExpertDraftSuggestionApplyMode) => {
    if (!pendingSuggestion) return;
    props.onApplyDraftSuggestion(pendingSuggestion.suggestion, { mode });
    if (mode === "force" && suggestionKey) {
      setAutoFilledSuggestionKey(suggestionKey);
      setDismissedSuggestionKey(null);
      setPendingSuggestion(null);
    }
  };

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
    <div className="space-y-5 px-1 pt-2 text-sm leading-7 text-dls-text">
      <p>{t("agents.expert_creation_coach_greeting")}</p>
      <p>{t("agents.expert_creation_coach_intro")}</p>
      <p>{t("agents.expert_creation_coach_question")}</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>{t("agents.expert_creation_coach_option_1")}</li>
        <li>{t("agents.expert_creation_coach_option_2")}</li>
        <li>{t("agents.expert_creation_coach_option_3")}</li>
        <li>{t("agents.expert_creation_coach_option_4")}</li>
      </ol>
      <p>{t("agents.expert_creation_coach_reply_hint")}</p>
    </div>
  );

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl bg-dls-surface p-5">
      <div className="flex shrink-0 items-center gap-3 pb-3">
        <img
          src={coachAvatarSrc}
          alt=""
          className="size-10 shrink-0 rounded-full object-cover"
        />
        <h2 className="truncate text-base font-semibold text-dls-text">
          {coachTitle}
        </h2>
      </div>
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
      {showSuggestionBar && partition ? (
        <div className="mt-3 shrink-0 rounded-xl border border-dls-border bg-dls-surface-muted px-3 py-3">
          <p className="text-sm font-medium text-dls-text">
            {t("agents.expert_creation_suggestion_bar_conflict")}
          </p>
          <p className="mt-1 text-xs leading-5 text-dls-secondary">
            {t("agents.expert_creation_suggestion_bar_conflict_detail", {
              fields: formatSuggestionFields(partition.conflictKeys),
            })}
          </p>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (suggestionKey) setDismissedSuggestionKey(suggestionKey);
              }}
            >
              {t("agents.expert_creation_suggestion_ignore")}
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => applySuggestion("force")}
            >
              {t("agents.expert_creation_suggestion_apply")}
            </Button>
          </div>
        </div>
      ) : null}
      <p className="pt-3 text-center text-xs text-dls-secondary">
        {t("agents.expert_creation_coach_disclaimer")}
      </p>
    </aside>
  );
}
