/** @jsxImportSource react */
import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronsLeft, Plus } from "lucide-react";
import { t } from "@/i18n";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { Button } from "@/components/ui/button";
import { ExpertCreationConversation } from "./expert-creation-conversation";
import { ExpertCreationCoachWelcome } from "./expert-creation-coach-welcome";
import {
  buildExpertCreationCoachSystemPrompt,
  buildExpertCreationCoachToolAccess,
  resolveExpertCreationCoachAgent,
} from "./expert-creation-coach-agent";
import type {
  ExpertCreationComposerProps,
  ExpertCreationSuggestionApplyOptions,
} from "./expert-creation-conversation";
import type {
  ExpertCreationPageProps,
  ExpertKnowledgeEntry,
} from "./expert-creation-types";
import type { ExpertDraftSuggestion } from "./expert-creation-suggestions";
import type { AgentRegistry, AgentWizardDraft } from "./agent-registry";
import type { ModelRef } from "../../../app/types";
import { buildExpertPreviewDraftKey } from "./expert-creation-lifecycle";
import { ExpertCreationAvatar } from "./expert-creation-view-primitives";

export function ExpertCoach(props: {
  draft: AgentWizardDraft;
  registry: AgentRegistry;
  workspaceRoot: string;
  opencodeBaseUrl: string | null;
  onmyagentServerToken: string | null;
  selectedModel: ModelRef | null;
  renderCoachPanel?: ExpertCreationPageProps["renderCoachPanel"];
  renderComposer: (props: ExpertCreationComposerProps) => ReactNode;
  showModelPicker: boolean;
  initialSessionId: string | null;
  onSessionIdChange: (sessionId: string) => void;
  onApplyDraftSuggestion: (
    suggestion: ExpertDraftSuggestion,
    options: ExpertCreationSuggestionApplyOptions,
  ) => void;
}) {
  const coachAgent = resolveExpertCreationCoachAgent(props.registry);
  const coachTitle = t("agents.expert_creation_coach");
  const coachSystemPrompt = coachAgent
    ? buildExpertCreationCoachSystemPrompt(coachAgent, props.draft, props.registry.skills)
    : undefined;
  const coachTools = coachAgent
    ? buildExpertCreationCoachToolAccess(coachAgent)
    : undefined;

  // Session domain can inject a full SessionSurface coach panel (no agents→session import).
  if (props.renderCoachPanel) {
    return (
      <>
        {props.renderCoachPanel({
          draft: props.draft,
          registry: props.registry,
          showModelPicker: props.showModelPicker,
          initialSessionId: props.initialSessionId,
          onSessionIdChange: props.onSessionIdChange,
          onApplyDraftSuggestion: props.onApplyDraftSuggestion,
        })}
      </>
    );
  }

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-dls-border/40 bg-dls-surface">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-dls-border/70 px-5">
        <img
          src={resolvePublicAssetUrl("/expert-creation-coach-avatar.png")}
          alt=""
          className="size-8 shrink-0 rounded-full object-cover ring-1 ring-dls-border/50"
        />
        <div className="min-w-0 leading-tight">
          <h2 className="truncate text-sm font-semibold text-dls-text">{coachTitle}</h2>
          <p className="mt-0.5 truncate text-xs leading-4 text-dls-secondary">
            {t("agents.expert_creation_coach_desc")}
          </p>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2">
        <ExpertCreationConversation
          draft={props.draft}
          workspaceRoot={props.workspaceRoot}
          opencodeBaseUrl={props.opencodeBaseUrl}
          onmyagentServerToken={props.onmyagentServerToken}
          selectedModel={props.selectedModel}
          showModelPicker={props.showModelPicker}
          title={coachTitle}
          hideHeader
          avatar={null}
          initialContent={<ExpertCreationCoachWelcome />}
          placeholder={t("agents.expert_creation_coach_placeholder")}
          {...(coachSystemPrompt ? { systemPrompt: coachSystemPrompt } : {})}
          {...(coachTools !== undefined ? { tools: coachTools } : {})}
          emptyMessage={t("agents.expert_creation_coach_failed")}
          renderComposer={props.renderComposer}
          onApplyDraftSuggestion={props.onApplyDraftSuggestion}
        />
      </div>
    </aside>
  );
}

export function TryEffectPanel(props: {
  draft: AgentWizardDraft;
  knowledge: ExpertKnowledgeEntry[];
  registry: AgentRegistry;
  workspaceRoot: string;
  opencodeBaseUrl: string | null;
  onmyagentServerToken: string | null;
  selectedModel: ModelRef | null;
  renderPreviewPanel?: ExpertCreationPageProps["renderPreviewPanel"];
  renderComposer: (props: ExpertCreationComposerProps) => ReactNode;
  showModelPicker: boolean;
  onClose: () => void;
}) {
  const [sessionVersion, setSessionVersion] = useState(0);
  const draftKey = buildExpertPreviewDraftKey(props.draft);
  const sessionKey = `${draftKey}:${sessionVersion}`;
  const knowledgePaths = props.knowledge
    .filter((entry) => entry.kind === "file" && entry.stagedPath)
    .map((entry) => entry.stagedPath ?? "");
  const emptyContent = (
    <div className="flex min-h-64 flex-col items-center justify-center text-center text-sm leading-6 text-dls-secondary">
      <ExpertCreationAvatar registry={props.registry} draft={props.draft} className="size-20" />
      <span className="mt-4 max-w-44">
        {props.draft.name.trim()
          ? t("agents.expert_creation_preview_ready")
          : t("agents.expert_creation_preview_empty")}
      </span>
    </div>
  );

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl bg-dls-surface">
      <div className="flex items-center gap-2 border-b border-dls-border px-5 py-4">
        <Button type="button" variant="ghost" size="icon-sm" onClick={props.onClose} aria-label={t("agents.expert_creation_preview_close")}>
          <ChevronsLeft className="size-5" aria-hidden />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-dls-text">
          {t("agents.expert_creation_preview_title")}
        </h2>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => setSessionVersion((current) => current + 1)} aria-label={t("agents.expert_creation_preview_new_session")}>
          <Plus className="size-5" aria-hidden />
        </Button>
      </div>
      {props.renderPreviewPanel ? (
        <div className="min-h-0 flex-1 overflow-hidden p-2">
          {props.renderPreviewPanel({
            draft: props.draft,
            registry: props.registry,
            showModelPicker: props.showModelPicker,
            knowledgePaths,
            sessionKey,
            emptyContent,
          })}
        </div>
      ) : (
        <ExpertCreationConversation
          key={sessionKey}
          draft={props.draft}
          workspaceRoot={props.workspaceRoot}
          opencodeBaseUrl={props.opencodeBaseUrl}
          onmyagentServerToken={props.onmyagentServerToken}
          selectedModel={props.selectedModel}
          showModelPicker={props.showModelPicker}
          knowledgePaths={knowledgePaths}
          title={props.draft.name || t("agents.expert_creation_preview_title")}
          avatar={null}
          emptyContent={emptyContent}
          placeholder={t("agents.expert_creation_preview_placeholder")}
          emptyMessage={t("agents.expert_creation_preview_failed")}
          disabled={!props.draft.name.trim()}
          hideHeader
          className="p-4"
          renderComposer={props.renderComposer}
        />
      )}
    </aside>
  );
}
