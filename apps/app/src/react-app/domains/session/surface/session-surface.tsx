/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { UIMessage } from "ai";
import { useQuery } from "@tanstack/react-query";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import {
  BookOpenCheck,
  Check,
  ChevronRight,
  Code2,
  Folder,
  FolderOpen,
  Minimize2,
  Settings2,
  X,
} from "lucide-react";

import { createClient, unwrap } from "../../../../app/lib/opencode";
import { abortSessionSafe } from "../../../../app/lib/opencode-session";
import { t } from "../../../../i18n";
import {
  readWorkspaceCloudImports,
  type CloudImportedPlugin,
} from "../../../../app/cloud/import-state";
import type {
  OpenworkServerClient,
  OpenworkSessionSnapshot,
} from "../../../../app/lib/onmyagent-server";
import type {
  ComposerAttachment,
  ComposerAccessMode,
  ComposerCollaborationMode,
  ComposerDraft,
  ComposerPart,
  McpServerEntry,
  McpStatusMap,
  ModelRef,
  PendingPermission,
  PendingQuestion,
  SkillCard,
  TodoItem,
} from "../../../../app/types";
import {
  publishInspectorSlice,
  recordInspectorEvent,
} from "../../../shell/app-inspector";
import {
  useControlAction,
  type OpenworkControlAction,
} from "../../../shell/control/control-provider";
import { ReactSessionComposer } from "./composer/composer";
import { CodeSceneToolbar } from "./code-scene-toolbar";
import {
  decodeComposerMentionValue,
  encodeComposerMentionValue,
} from "./composer/mention-encoding";
import { DevProfiler } from "../../../shell/dev-profiler";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { ActionRowButton, DisclosureRowButton } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { PaperGrainGradient } from "@onmyagent/ui/react";
import { OwDotTicker } from "../../../shell/dot-ticker";
import { useReactRenderWatchdog } from "../../../shell/react-render-watchdog";
import type { ReactComposerNotice } from "./composer/notice";
import { SessionDebugPanel } from "./debug-panel";
import {
  deriveRenderedSessionMessages,
  resolveRenderedSessionSnapshot,
} from "./session-render-state";
import { SessionTranscript } from "./message-list";
import { useLocal } from "../../../kernel/local-provider";
import { deriveSessionRenderModel } from "../sync/transition-controller";
import { useSessionScrollController } from "./scroll-controller";
import {
  getSessionActivityStatusLabel,
  useSessionActivityStore,
  type SessionActivityStatus,
} from "../status/session-activity-store";
import { usePendingAgentStore } from "../../shared/pending-agent-store";
import type { PendingAgentContext } from "../../shared/pending-agent-store";
import { AgentPromptSuggestions } from "../../shared/agent-prompt-suggestions";
import { buildPendingAgentFromRecord } from "../../shared/agent-registry-store";
import {
  readCustomAgentIdForSession,
  useAgentRegistryStore,
} from "../../shared/agent-registry-store";
import { PermissionApprovalPanel } from "../components/permission-modal";
import { QuestionPanel } from "../modals/question-modal";
import {
  deriveOpenTargets,
  selectAutoOpenTarget,
  type OpenTarget,
} from "../artifacts/open-target";
import {
  seedSessionState,
  statusKey as reactStatusKey,
  transcriptKey as reactTranscriptKey,
} from "../sync/session-sync";
import {
  getComposerAttachments,
  getComposerDraft,
  getComposerMentions,
  getComposerPasteParts,
  useComposerStateStore,
} from "./composer-state-store";
import { cn } from "@/lib/utils";
import {
  PERSONAL_ASSISTANT_CATEGORIES,
  ONMYAGENT_ASSISTANT_AVATAR,
  onmyagentAssistantName,
  type AssistantCategoryId,
  type AssistantScenario,
} from "./personal-assistant-config";
import {
  assistantFallbackText,
  controlRecentMessageCount,
  controlTextArgument,
  DEFAULT_COMPOSER_CONTROL_TEXT,
  latestMessageControlResult,
  messageHasVisibleAssistantOutput,
  transcriptControlResult,
  transcriptToText,
} from "./session-surface-model";
import {
  createComposerAttachments,
  parseSessionError,
  readSnapshotSessionError,
  revokeAttachmentPreview,
  type SessionError,
} from "./session-surface-support";

const EMPTY_TRANSCRIPT: UIMessage[] = [];
const IDLE_STATUS: SessionStatus = { type: "idle" };

const sessionSurfaceTextClass = {
  assistantHeroTitle: "mt-4 text-lg font-medium text-dls-text",
  agentEmptyTitle: "mt-4 text-base font-medium text-dls-text",
  agentEmptyDescription: "mt-1.5 max-w-md text-center text-sm leading-6 text-dls-secondary",
  draftHomeTitle: "inline-flex items-center justify-center gap-2 text-2xl font-medium tracking-tight text-dls-text",
  draftHomeSubtitle: "mt-3 max-w-xl text-sm leading-6 text-dls-secondary",
  noVisibleOutput: "font-mono text-sm leading-6 text-dls-secondary whitespace-pre-wrap",
  headerAgentName: "min-w-0 truncate text-sm font-medium text-dls-text",
  openingSession: "text-sm text-dls-secondary",
};

function AssistantDraftHomeMark(props: { categoryId: AssistantCategoryId }) {
  const Icon = props.categoryId === "code" ? Code2 : BookOpenCheck;

  return (
    <span className="inline-flex size-6 shrink-0 items-center justify-center text-current">
      <Icon className="size-6" strokeWidth={1.7} />
    </span>
  );
}

const sessionSurfaceStateClass = {
  todoDone: "border-dls-status-success bg-dls-status-success-soft text-dls-status-success-fg",
  todoActive: "border-dls-status-warning/25 bg-dls-status-warning/12 text-dls-status-warning",
  todoActiveDot: "size-1.5 rounded-full bg-dls-status-warning",
  errorPanel: "rounded-2xl border border-dls-status-danger/25 bg-dls-status-danger/10 px-5 py-4",
  errorText: "text-sm font-medium text-dls-status-danger",
  errorDismiss: "shrink-0 text-dls-status-danger hover:bg-dls-status-danger/10 hover:text-dls-status-danger",
  snapshotError: "mx-auto max-w-xl rounded-3xl border border-dls-status-danger/25 bg-dls-status-danger/10 px-6 py-5 text-sm text-dls-status-danger",
};

/**
 * Lightweight avatar rendered in the "+新任务" welcome card and alongside
 * every assistant message when the session was started from a custom
 * agent card. Expects the fully-resolved image URL (local DiceBear data
 * URI or custom upload) so it never has to depend on the `AgentRegistry` tree; falls
 * back to a colored initial badge only when the URL can't be resolved.
 */
const AGENT_AVATAR_PALETTES = [
  { background: "#d7ecf8", foreground: "#16324f" },
  { background: "#e1e2f0", foreground: "#42475f" },
  { background: "#ffe1c7", foreground: "#6d3b1f" },
  { background: "#cceaf5", foreground: "#174767" },
  { background: "#ddefc8", foreground: "#355a18" },
] as const;

function PendingAgentAvatar(props: {
  name: string;
  avatarUrl: string | null;
  avatarBackground?: string | null;
  className?: string;
}) {
  if (!props.avatarUrl) {
    // Pick a palette that matches the agent name so siblings don't twin.
    const index =
      Math.abs(
        Array.from(props.name).reduce(
          (acc, ch) => acc * 31 + ch.charCodeAt(0),
          0,
        ),
      ) % AGENT_AVATAR_PALETTES.length;
    const palette = AGENT_AVATAR_PALETTES[index]!;
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-full font-medium",
          props.className,
        )}
        style={{ background: palette.background, color: palette.foreground }}
      >
        {props.name.slice(0, 1) || t("session.agent_initial")}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-full",
        props.className,
      )}
      style={
        props.avatarBackground
          ? { background: props.avatarBackground }
          : undefined
      }
    >
      <img
        src={props.avatarUrl}
        alt={props.name}
        className="size-full rounded-full object-cover"
      />
    </div>
  );
}

export type SessionSurfaceProps = {
  client: OpenworkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  sessionId: string;
  draftOnly?: boolean;
  opencodeBaseUrl: string;
  onmyagentToken: string;
  developerMode: boolean;
  modelLabel: string;
  onModelClick: () => void;
  modelPickerOpen: boolean;
  modelUnavailable?: boolean;
  selectedModel: ModelRef;
  onModelPickerOpenChange: (open: boolean) => void;
  onModelChange: (model: ModelRef) => void;
  onSendDraft: (draft: ComposerDraft) => void;
  onDraftChange: (draft: ComposerDraft) => void;
  attachmentsEnabled: boolean;
  attachmentsDisabledReason: string | null;
  modelVariantLabel: string;
  modelVariant: string | null;
  modelBehaviorOptions?: { value: string | null; label: string }[];
  onModelVariantChange: (value: string | null) => void;
  agentLabel: string;
  userIdentity?: { name: string };
  onOpenAgentSettings?: () => void;
  headerActions?: ReactNode;
  conversationTabs?: ReactNode;
  selectedAgent: string | null;
  listAgents: () => Promise<import("@opencode-ai/sdk/v2/client").Agent[]>;
  onSelectAgent: (agent: string | null) => void;
  listCommands: () => Promise<
    import("../../../../app/types").SlashCommandOption[]
  >;
  recentFiles: string[];
  searchFiles: (query: string) => Promise<string[]>;
  isRemoteWorkspace: boolean;
  isSandboxWorkspace: boolean;
  todos?: TodoItem[];
  activePermission?: PendingPermission | null;
  permissionReplyBusy?: boolean;
  respondPermission?: (
    requestID: string,
    reply: "once" | "always" | "reject",
  ) => void;
  activeQuestion?: PendingQuestion | null;
  questionReplyBusy?: boolean;
  respondQuestion?: (requestID: string, answers: string[][]) => void;
  safeStringify?: (value: unknown) => string;
  onChangeModel?: (model: { providerID: string; modelID: string }) => void;
  onUploadInboxFiles?:
    | ((
        files: File[],
        options?: { notify?: boolean },
      ) => void | Promise<unknown>)
    | null;
  onOpenSettingsSection?:
    | ((section: "commands" | "skills" | "mcps" | "plugins") => void)
    | undefined;
  onRevertToMessage?: (messageId: string) => void;
  onForkAtMessage?: (messageId: string) => void;
  onOpenTarget?: (target: OpenTarget, options?: { auto?: boolean }) => void;
  onOpenTargetsChange?: (targets: OpenTarget[]) => void;
  personalAssistantHome?: boolean;
  personalAssistantCategoryId?: AssistantCategoryId;
  assistantFeatureCategoryId?: AssistantCategoryId;
  agentContext?: PendingAgentContext | null;
  onPersonalAssistantCategoryChange?: (id: AssistantCategoryId) => void;
  onPersonalAssistantCategoryActive?: (id: AssistantCategoryId) => void;
  draftWorkspaceDirectory?: string | null;
  onPickDraftWorkspace?: () => void;
  onClearDraftWorkspace?: () => void;
};

const waitForControl = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

function useSharedQueryState<T>(queryKey: readonly unknown[], fallback: T) {
  const query = useQuery<T, Error, T, readonly unknown[]>({
    queryKey,
    queryFn: async () => fallback,
    enabled: false,
  });
  return query.data ?? fallback;
}

function AssistantWaitingCard({
  label = t("session.assistant_thinking"),
  collapseLayout = false,
}: {
  label?: string;
  collapseLayout?: boolean;
}) {
  const content = (
    <div className="flex justify-start" role="status" aria-live="polite">
      <div className="inline-flex items-center gap-1.5 px-1 py-1 text-xs text-dls-secondary">
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            overflow: "hidden",
          }}
        >
          <PaperGrainGradient
            speed={12}
            softness={0.1}
            intensity={1}
            noise={0.05}
            shape="sphere"
            colors={["#818cf8", "#fb7185", "#fbbf24", "#34d399"]}
            colorBack="#ffffff00"
            style={{
              backgroundColor: "#818cf8",
              width: "100%",
              height: "100%",
              borderRadius: "50%",
            }}
          />
        </div>
        <span>{label}</span>
      </div>
    </div>
  );

  if (collapseLayout) {
    return <div>{content}</div>;
  }

  return content;
}

function AssistantNoVisibleOutputCard(props: { text: string }) {
  return (
    <div
      className={sessionSurfaceTextClass.noVisibleOutput}
      role="status"
      aria-live="polite"
    >
      <div className="max-w-3xl">
        {props.text || t("session.assistant_empty_response")}
      </div>
    </div>
  );
}

function AssistantStatusSpacer() {
  return (
    <div className="invisible" aria-hidden="true">
      <AssistantWaitingCard
        label={t("session.assistant_responding")}
        collapseLayout
      />
    </div>
  );
}

function TodoPanel(props: { todos: TodoItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const todos = props.todos.filter((todo) => todo.content.trim());
  const completedTodos = todos.filter(
    (todo) => todo.status === "completed",
  ).length;
  const progressLabel = t("session.todo_progress_label");
  const label = expanded
    ? progressLabel
    : `${progressLabel} · ${completedTodos}/${todos.length}`;

  if (todos.length === 0) return null;

  return (
    <div className="overflow-hidden border-b border-dls-border bg-transparent">
      <DisclosureRowButton
        type="button"
        className="justify-between px-4 py-3 text-xs text-dls-secondary hover:bg-dls-surface-muted/50"
        onClick={() => setExpanded((current) => !current)}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-dls-secondary">{label}</span>
        </div>
        <Minimize2
          size={12}
          className={`text-dls-secondary transition-transform ${expanded ? "" : "rotate-180"}`}
        />
      </DisclosureRowButton>
      {expanded ? (
        <div className="max-h-60 space-y-2.5 overflow-auto border-t border-dls-border px-4 pb-3">
          {todos.map((todo, index) => {
            const done = todo.status === "completed";
            const cancelled = todo.status === "cancelled";
            const active = todo.status === "in_progress";
            return (
              <div
                key={todo.id}
                className="flex items-start gap-2.5 pt-2.5 first:pt-2.5"
              >
                <div className="flex items-center gap-1.5 pt-0.5">
                  <div
                    className={`flex size-4.5 items-center justify-center rounded-full border ${
                      done
                        ? sessionSurfaceStateClass.todoDone
                        : active
                          ? sessionSurfaceStateClass.todoActive
                          : cancelled
                            ? "border-dls-border bg-dls-surface-muted text-dls-secondary"
                            : "border-dls-border bg-dls-surface text-dls-secondary"
                    }`}
                  >
                    {done ? (
                      <Check size={10} />
                    ) : active ? (
                      <span className={sessionSurfaceStateClass.todoActiveDot} />
                    ) : null}
                  </div>
                </div>
                <div
                  className={`flex-1 text-sm leading-relaxed ${cancelled ? "text-dls-secondary line-through" : "text-dls-text"}`}
                >
                  <span className="mr-1.5 text-dls-secondary">{index + 1}.</span>
                  {todo.content}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function PersonalAssistantHero() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 pb-6 pt-14 text-center">
      <img
        src={resolvePublicAssetUrl(ONMYAGENT_ASSISTANT_AVATAR)}
        alt=""
        className="size-36 rounded-2xl object-cover"
        draggable={false}
      />
      <h2 className={sessionSurfaceTextClass.assistantHeroTitle}>
        {t("session.assistant_intro")}
      </h2>
    </div>
  );
}

function AssistantScenarioPill(props: {
  scenario: AssistantScenario;
  active?: boolean;
  onClick: () => void;
}) {
  const Icon = props.scenario.icon;
  return (
    <Button
      type="button"
      variant={props.active ? "default" : "outline"}
      size="sm"
      onClick={props.onClick}
      className={cn(
        "h-8 shrink-0 rounded-lg text-xs",
        props.active
          ? "text-dls-accent-foreground"
          : "text-dls-secondary hover:border-dls-border-strong hover:bg-dls-hover hover:text-dls-text",
      )}
    >
      <Icon className="size-3.5" />
      <span className="whitespace-nowrap">{props.scenario.label}</span>
    </Button>
  );
}

function assistantScenarioDraftToken(id: string) {
  return `[[assistant-scenario:${id}]]`;
}

function removeAssistantScenarioDraftTokens(value: string) {
  return value.replace(/\[\[assistant-scenario:[^\]]+\]\]\s*/g, "");
}

function PersonalAssistantAccessory(props: {
  categoryId: AssistantCategoryId;
  selectedScenario: AssistantScenario | null;
  showPrompts: boolean;
  onSelectScenario: (scenario: AssistantScenario) => void;
  onSelectPrompt: (prompt: string) => void;
}) {
  const category =
    PERSONAL_ASSISTANT_CATEGORIES.find(
      (item) => item.id === props.categoryId,
    ) ?? PERSONAL_ASSISTANT_CATEGORIES[1];
  const prompts = props.selectedScenario?.prompts ?? [];

  return (
    <div className="px-1 pt-2">
      {!props.selectedScenario ? (
        <div className="flex justify-center gap-2 px-0 pt-0">
          {category.scenarios.slice(0, 4).map((scenario) => (
            <AssistantScenarioPill
              key={scenario.id}
              scenario={scenario}
              onClick={() => props.onSelectScenario(scenario)}
            />
          ))}
        </div>
      ) : null}
      {props.selectedScenario && props.showPrompts ? (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {prompts.slice(0, 6).map((prompt) => (
            <ActionRowButton
              density="compact"
              key={prompt}
              type="button"
              onClick={() => props.onSelectPrompt(prompt)}
              className="w-auto items-center gap-1.5 rounded-lg border-transparent bg-dls-surface-muted px-3 py-2 text-xs leading-4 text-dls-text hover:border-transparent hover:bg-dls-hover"
            >
              <span className="max-w-56 truncate">{prompt}</span>
              <span className="shrink-0 text-dls-text">↗</span>
            </ActionRowButton>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SessionErrorCard({
  error,
  onDismiss,
  onChangeModel,
  onOpenModelPicker,
}: {
  error: SessionError;
  onDismiss: () => void;
  onChangeModel?: (model: { providerID: string; modelID: string }) => void;
  onOpenModelPicker?: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-3 py-3 sm:px-5">
      <div className={sessionSurfaceStateClass.errorPanel}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className={sessionSurfaceStateClass.errorText}>
              {error.message}
            </div>
            {error.kind === "model-not-found" ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {error.suggestions && error.suggestions.length > 0
                  ? error.suggestions.map((s) => (
                      <Button
                        key={`${s.providerID}/${s.modelID}`}
                        type="button"
                        variant="outline"
                        size="xs"
                        className="rounded-full text-dls-text hover:bg-dls-hover"
                        onClick={() => {
                          onChangeModel?.(s);
                          onDismiss();
                        }}
                      >
                        Use {s.providerID}/{s.modelID}
                      </Button>
                    ))
                  : null}
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="rounded-full text-dls-text hover:bg-dls-hover"
                  onClick={() => {
                    onOpenModelPicker?.();
                    onDismiss();
                  }}
                >
                  Change model
                </Button>
              </div>
            ) : null}
          </div>
          <Button variant="ghost" size="icon-xs"
            type="button"
            className={sessionSurfaceStateClass.errorDismiss}
            onClick={onDismiss}
            aria-label={t("session.dismiss_error")}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3.5 3.5l7 7M10.5 3.5l-7 7"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SessionSurface(props: SessionSurfaceProps) {
  const local = useLocal();
  const showThinking = local.prefs.showThinking;
  const storedSessionActivityStatus = useSessionActivityStore(
    (state) =>
      state.statusesByWorkspaceId[props.workspaceId]?.[props.sessionId] ??
      "idle",
  );
  const storedSessionActivityError = useSessionActivityStore((state) =>
    state.getErrorMessage(props.workspaceId, props.sessionId),
  );
  const sessionActivityStatus = props.draftOnly
    ? "idle"
    : storedSessionActivityStatus;
  const sessionActivityError =
    props.draftOnly || sessionActivityStatus !== "error"
      ? null
      : storedSessionActivityError || t("app.error_request_failed");
  const draft = useComposerStateStore((state) =>
    getComposerDraft(state, props.sessionId),
  );
  const [internalAssistantCategoryId, setInternalAssistantCategoryId] =
    useState<AssistantCategoryId>("office");
  const assistantCategoryId =
    props.personalAssistantCategoryId ?? internalAssistantCategoryId;
  const assistantFeatureCategoryId =
    props.assistantFeatureCategoryId ?? assistantCategoryId;
  const assistantOfficeFeaturesActive =
    props.personalAssistantHome || props.assistantFeatureCategoryId === "office";
  const assistantCodeFeaturesActive =
    props.personalAssistantHome || props.assistantFeatureCategoryId === "code";
  const setAssistantCategoryId =
    props.onPersonalAssistantCategoryChange ?? setInternalAssistantCategoryId;
  const [assistantScenarioId, setAssistantScenarioId] = useState<string | null>(
    null,
  );
  const [assistantPromptCardsVisible, setAssistantPromptCardsVisible] =
    useState(false);
  const [showFolderRequiredBubble, setShowFolderRequiredBubble] =
    useState(false);
  const [accessMode, setAccessMode] = useState<ComposerAccessMode>("default");
  const [collaborationMode, setCollaborationMode] =
    useState<ComposerCollaborationMode>({
      planning: false,
      pursueGoal: false,
    });
  const [officeCollaborationMode, setOfficeCollaborationMode] =
    useState<ComposerCollaborationMode>({
      kind: "craft",
      planning: false,
      pursueGoal: true,
    });
  const attachments = useComposerStateStore((state) =>
    getComposerAttachments(state, props.sessionId),
  );
  const mentions = useComposerStateStore((state) =>
    getComposerMentions(state, props.sessionId),
  );
  const pasteParts = useComposerStateStore((state) =>
    getComposerPasteParts(state, props.sessionId),
  );
  const setComposerDraft = useComposerStateStore((state) => state.setDraft);
  const setComposerAttachments = useComposerStateStore(
    (state) => state.setAttachments,
  );
  const setComposerMentions = useComposerStateStore(
    (state) => state.setMentions,
  );
  const setComposerPasteParts = useComposerStateStore(
    (state) => state.setPasteParts,
  );
  const clearComposerSession = useComposerStateStore(
    (state) => state.clearSession,
  );
  const assistantCategory =
    PERSONAL_ASSISTANT_CATEGORIES.find(
      (category) => category.id === assistantCategoryId,
    ) ?? PERSONAL_ASSISTANT_CATEGORIES[1]!;
  const assistantScenario =
    assistantCategory.scenarios.find(
      (scenario) => scenario.id === assistantScenarioId,
    ) ?? null;
  const assistantScenarioTags = assistantCategory.scenarios.map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
  }));
  const composerPlaceholder =
    assistantFeatureCategoryId === "code"
      ? t("session.assistant_code_composer_placeholder")
      : t("session.assistant_office_composer_placeholder");
  const pendingAgent = usePendingAgentStore((state) => state.agent);

  useEffect(() => {
    if (!props.personalAssistantHome) return;
    props.onPersonalAssistantCategoryActive?.(assistantCategoryId);
  }, [assistantCategoryId, props.personalAssistantHome, props.onPersonalAssistantCategoryActive]);

  useEffect(() => {
    if (!assistantScenarioId) return;
    if (draft.includes(assistantScenarioDraftToken(assistantScenarioId))) return;
    setAssistantScenarioId(null);
    setAssistantPromptCardsVisible(false);
  }, [assistantScenarioId, draft]);

  // Subscribe to the global registry store so we re-run the restore effect
  // after a hard reload (when the registry wasn't available on first mount).
  const registry = useAgentRegistryStore((state) => state.registry);

  // Restore the pending agent when a session is re-opened: read the cached
  // custom agent ID for this session from localStorage, look it up in the
  // global registry store, and rebuild a PendingAgentContext so the welcome
  // card and transcript avatar render correctly.
  useEffect(() => {
    if (props.personalAssistantHome) return;
    if (!props.sessionId || !registry) return;
    const current = usePendingAgentStore.getState().agent;
    // Already have the right agent for this session — nothing to do.
    if (current && current.boundSessionId === props.sessionId) {
      return;
    }
    const agentId = readCustomAgentIdForSession(props.sessionId);
    if (!agentId) return;
    // The current pending agent either doesn't match this session's agent
    // (navigation to a different agent) — overwrite with the correct agent.
    // This also fixes the "+ 新会话 -> switch agent" case where the pending
    // agent was set by handleCreateCurrentAgentSession (unbound) and the user
    // then navigated away to a different agent's session.
    if (current && current.id === agentId) {
      // Same agent, just bind it to this session (e.g. sending first message
      // in a draft navigates here) — keep other fields.
      usePendingAgentStore.getState().setAgent({
        ...current,
        boundSessionId: props.sessionId,
      });
      return;
    }
    // Different agent — look in BOTH custom agents AND templates to restore.
    const agent =
      registry.agents.find((a) => a.id === agentId) ??
      registry.templates.find((t) => t.id === agentId);
    if (!agent) return;
    const restored = buildPendingAgentFromRecord(agent, registry);
    if (restored) {
      usePendingAgentStore.getState().setAgent({
        ...restored,
        boundSessionId: props.sessionId,
      });
    }
  }, [props.sessionId, registry]);

  // Only use the pending agent if it's either unbound (draft-only state,
  // session doesn't exist yet) or bound to the session we're currently
  // viewing. This keeps the agent avatar/system prompt from bleeding into
  // unrelated sessions the user navigates to later.
  const effectiveAgent = props.personalAssistantHome
    ? null
    : props.agentContext
      ? props.agentContext
    : pendingAgent &&
        (!pendingAgent.boundSessionId ||
          pendingAgent.boundSessionId === props.sessionId)
      ? pendingAgent
      : null;
  const [notice, setNotice] = useState<ReactComposerNotice | null>(null);
  const [error, setError] = useState<SessionError | null>(null);
  const [dismissedErrorMessage, setDismissedErrorMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [showDelayedLoading, setShowDelayedLoading] = useState(false);
  const [awaitingAssistantBaseline, setAwaitingAssistantBaseline] = useState<
    number | null
  >(null);
  const [
    noVisibleAssistantOutputBaseline,
    setNoVisibleAssistantOutputBaseline,
  ] = useState<number | null>(null);
  const [rendered, setRendered] = useState<{
    sessionId: string;
    snapshot: OpenworkSessionSnapshot;
  } | null>(null);
  const [toolSkills, setToolSkills] = useState<SkillCard[]>([]);
  const [toolMcpServers, setToolMcpServers] = useState<McpServerEntry[]>([]);
  const [toolMcpStatus, setToolMcpStatus] = useState<string | null>(null);
  const [toolMcpStatuses, setToolMcpStatuses] = useState<McpStatusMap>({});
  const [toolImportedPlugins, setToolImportedPlugins] = useState<
    CloudImportedPlugin[]
  >([]);
  const [verifiedOpenTargets, setVerifiedOpenTargets] = useState<OpenTarget[]>(
    [],
  );
  const composerShellRef = useRef<HTMLDivElement>(null);
  const hydratedKeyRef = useRef<string | null>(null);
  const autoOpenedTargetRef = useRef<string | null>(null);
  const initializedAutoOpenSessionRef = useRef<string | null>(null);
  const opencodeClient = useMemo(
    () =>
      createClient(props.opencodeBaseUrl, undefined, {
        token: props.onmyagentToken,
        mode: "onmyagent",
      }),
    [props.opencodeBaseUrl, props.onmyagentToken],
  );

  const snapshotQueryKey = useMemo(
    () => ["react-session-snapshot", props.workspaceId, props.sessionId],
    [props.workspaceId, props.sessionId],
  );
  const transcriptQueryKey = useMemo(
    () => reactTranscriptKey(props.workspaceId, props.sessionId),
    [props.workspaceId, props.sessionId],
  );
  const statusQueryKey = useMemo(
    () => reactStatusKey(props.workspaceId, props.sessionId),
    [props.workspaceId, props.sessionId],
  );
  const snapshotQuery = useQuery<OpenworkSessionSnapshot>({
    queryKey: snapshotQueryKey,
    enabled: !props.draftOnly,
    queryFn: async () =>
      (
        await props.client.getSessionSnapshot(
          props.workspaceId,
          props.sessionId,
          { limit: 140, directory: props.workspaceRoot },
        )
      ).item,
    staleTime: 500,
  });

  const currentSnapshot =
    snapshotQuery.data?.session.id === props.sessionId
      ? snapshotQuery.data
      : null;
  const transcriptState = useSharedQueryState<UIMessage[]>(
    transcriptQueryKey,
    EMPTY_TRANSCRIPT,
  );
  const statusState = useSharedQueryState(
    statusQueryKey,
    currentSnapshot?.status ?? IDLE_STATUS,
  );

  useEffect(() => {
    if (!currentSnapshot) return;
    setRendered({ sessionId: props.sessionId, snapshot: currentSnapshot });
  }, [props.sessionId, currentSnapshot]);

  useEffect(() => {
    hydratedKeyRef.current = null;
    setError(null);
    setSending(false);
    setShowDelayedLoading(false);
    setAwaitingAssistantBaseline(null);
    setNoVisibleAssistantOutputBaseline(null);
    // Composer draft state lives in the shared store keyed by session id, so
    // switching sessions preserves each session's own in-progress composer.
    setNotice(null);
    autoOpenedTargetRef.current = null;
    initializedAutoOpenSessionRef.current = null;
    setVerifiedOpenTargets([]);
  }, [props.sessionId]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (!props.personalAssistantHome) return;
    setAssistantScenarioId(null);
    setAssistantPromptCardsVisible(false);
    setComposerDraft(props.sessionId, "");
  }, [
    assistantCategoryId,
    props.personalAssistantHome,
    props.sessionId,
    setComposerDraft,
  ]);

  // Publish a composer inspector slice so external drivers can read draft
  // state, attachments, mentions, and sending status from the running app.
  useEffect(() => {
    const dispose = publishInspectorSlice("composer", () => ({
      workspaceId: props.workspaceId,
      sessionId: props.sessionId,
      draft,
      draftLength: draft.length,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        kind: attachment.kind,
      })),
      mentions,
      pasteParts: pasteParts.map((part) => ({
        id: part.id,
        label: part.label,
        lines: part.lines,
      })),
      sending,
      error,
      hasNotice: Boolean(notice),
    }));
    return dispose;
  }, [
    attachments,
    draft,
    error,
    mentions,
    notice,
    pasteParts,
    props.sessionId,
    props.workspaceId,
    sending,
  ]);

  useEffect(() => {
    recordInspectorEvent("session.mounted", {
      workspaceId: props.workspaceId,
      sessionId: props.sessionId,
    });
  }, [props.sessionId, props.workspaceId]);

  useEffect(() => {
    if (!currentSnapshot) return;
    seedSessionState(props.workspaceId, currentSnapshot);
  }, [currentSnapshot, props.sessionId, props.workspaceId]);

  useEffect(() => {
    if (!currentSnapshot) return;
    const key = `${props.sessionId}:${currentSnapshot.session.time?.updated ?? currentSnapshot.session.time?.created ?? 0}:${currentSnapshot.messages.length}`;
    if (hydratedKeyRef.current === key) return;
    hydratedKeyRef.current = key;
    seedSessionState(props.workspaceId, currentSnapshot);
  }, [props.sessionId, currentSnapshot, props.workspaceId]);

  const snapshot = resolveRenderedSessionSnapshot({
    sessionId: props.sessionId,
    currentSnapshot,
    cachedRendered: rendered,
  });
  const liveStatus = statusState ?? snapshot?.status ?? IDLE_STATUS;
  const chatStreaming =
    sending || liveStatus.type === "busy" || liveStatus.type === "retry";
  const renderedMessages = useMemo(
    () => deriveRenderedSessionMessages({ transcriptState, snapshot }),
    [snapshot, transcriptState],
  );
  const snapshotSessionError = useMemo(
    () => readSnapshotSessionError(snapshot),
    [snapshot],
  );
  const openTargets = useMemo(
    () => deriveOpenTargets(renderedMessages),
    [renderedMessages],
  );
  const openTargetsFingerprint = useMemo(
    () =>
      openTargets
        .map((target) => `${target.kind}:${target.value}:${target.confidence}`)
        .join("|"),
    [openTargets],
  );
  const autoOpenTarget = selectAutoOpenTarget(verifiedOpenTargets);
  const pendingSessionLoad =
    !props.draftOnly &&
    !snapshot &&
    snapshotQuery.isLoading &&
    renderedMessages.length === 0;
  const assistantOutputAfterAwaitStart = useMemo(() => {
    if (awaitingAssistantBaseline === null) return false;
    return renderedMessages
      .slice(awaitingAssistantBaseline)
      .some(messageHasVisibleAssistantOutput);
  }, [awaitingAssistantBaseline, renderedMessages]);
  const noVisibleAssistantOutputText = useMemo(() => {
    if (noVisibleAssistantOutputBaseline === null) return "";
    return assistantFallbackText(
      renderedMessages,
      noVisibleAssistantOutputBaseline,
    );
  }, [noVisibleAssistantOutputBaseline, renderedMessages]);
  const assistantOutputAfterNoVisibleFallback = useMemo(() => {
    if (noVisibleAssistantOutputBaseline === null) return false;
    return renderedMessages
      .slice(noVisibleAssistantOutputBaseline)
      .some(messageHasVisibleAssistantOutput);
  }, [noVisibleAssistantOutputBaseline, renderedMessages]);
  const showAssistantWaitState =
    awaitingAssistantBaseline !== null && !assistantOutputAfterAwaitStart;
  const showAssistantRespondingState =
    awaitingAssistantBaseline !== null &&
    assistantOutputAfterAwaitStart &&
    chatStreaming;
  const effectiveActivityStatus: SessionActivityStatus =
    sessionActivityStatus !== "idle"
      ? sessionActivityStatus
      : showAssistantWaitState
        ? "thinking"
        : showAssistantRespondingState
          ? "responding"
          : "idle";
  const visibleError = [
    error,
    sessionActivityError ? { message: sessionActivityError } : null,
    snapshotSessionError,
  ].find((item) => item && item.message !== dismissedErrorMessage) ?? null;
  const showNoVisibleAssistantOutput =
    noVisibleAssistantOutputBaseline !== null &&
    !assistantOutputAfterNoVisibleFallback;
  const reserveAssistantStatusSpace =
    effectiveActivityStatus === "idle" &&
    awaitingAssistantBaseline !== null &&
    assistantOutputAfterAwaitStart &&
    !chatStreaming;
  const assistantStatusFooter =
    !visibleError && effectiveActivityStatus !== "idle" ? (
      <AssistantWaitingCard
        label={getSessionActivityStatusLabel(effectiveActivityStatus)}
        collapseLayout
      />
    ) : showNoVisibleAssistantOutput ? (
      <AssistantNoVisibleOutputCard text={noVisibleAssistantOutputText} />
    ) : reserveAssistantStatusSpace ? (
      <AssistantStatusSpacer />
    ) : null;
  useReactRenderWatchdog("SessionSurface", {
    sessionId: props.sessionId,
    workspaceId: props.workspaceId,
    messageCount: renderedMessages.length,
    liveStatus: liveStatus.type,
    sending,
    pendingSessionLoad,
    showAssistantWaitState,
    showAssistantRespondingState,
    noVisibleAssistantOutputBaseline,
    hasSnapshot: Boolean(snapshot),
  });

  useEffect(() => {
    if (!autoOpenTarget || chatStreaming) return;
    if (autoOpenedTargetRef.current === autoOpenTarget.id) return;
    autoOpenedTargetRef.current = autoOpenTarget.id;
    props.onOpenTarget?.(autoOpenTarget, { auto: true });
  }, [autoOpenTarget, chatStreaming, props.onOpenTarget]);

  useEffect(() => {
    let cancelled = false;
    function initializeAutoOpenState(targets: OpenTarget[]) {
      if (initializedAutoOpenSessionRef.current === props.sessionId) return;
      initializedAutoOpenSessionRef.current = props.sessionId;
      autoOpenedTargetRef.current = selectAutoOpenTarget(targets)?.id ?? null;
    }

    async function verifyTargets() {
      if (!openTargets.length) {
        initializeAutoOpenState([]);
        setVerifiedOpenTargets([]);
        return;
      }
      try {
        const response = await props.client.resolveArtifacts(
          props.workspaceId,
          openTargets,
        );
        if (!cancelled) {
          const nextTargets = response.items as OpenTarget[];
          initializeAutoOpenState(nextTargets);
          setVerifiedOpenTargets(nextTargets);
        }
      } catch {
        if (!cancelled) {
          const nextTargets = openTargets.map((target) => ({
            ...target,
            exists: target.kind === "url",
          }));
          initializeAutoOpenState(nextTargets);
          setVerifiedOpenTargets(nextTargets);
        }
      }
    }
    void verifyTargets();
    return () => {
      cancelled = true;
    };
  }, [
    openTargetsFingerprint,
    props.client,
    props.sessionId,
    props.workspaceId,
  ]);

  useEffect(() => {
    props.onOpenTargetsChange?.(verifiedOpenTargets);
  }, [props.onOpenTargetsChange, verifiedOpenTargets]);

  useEffect(() => {
    if (!pendingSessionLoad) {
      setShowDelayedLoading(false);
      return;
    }
    const id = window.setTimeout(() => setShowDelayedLoading(true), 2000);
    return () => window.clearTimeout(id);
  }, [pendingSessionLoad]);

  useEffect(() => {
    if (!snapshotSessionError) return;
    setSending(false);
    setAwaitingAssistantBaseline(null);
    setNoVisibleAssistantOutputBaseline(null);
  }, [snapshotSessionError]);

  useEffect(() => {
    setDismissedErrorMessage(null);
  }, [props.sessionId]);

  useEffect(() => {
    if (awaitingAssistantBaseline === null) return;
    if (assistantOutputAfterAwaitStart) {
      return;
    }
    if (
      sending ||
      liveStatus.type !== "idle" ||
      renderedMessages.length <= awaitingAssistantBaseline
    )
      return;
    const id = window.setTimeout(() => {
      setNoVisibleAssistantOutputBaseline(awaitingAssistantBaseline);
      setAwaitingAssistantBaseline(null);
    }, 1200);
    return () => window.clearTimeout(id);
  }, [
    assistantOutputAfterAwaitStart,
    awaitingAssistantBaseline,
    liveStatus.type,
    renderedMessages.length,
    sending,
  ]);

  const model = deriveSessionRenderModel({
    intendedSessionId: props.sessionId,
    renderedSessionId:
      renderedMessages.length > 0 || snapshot ? props.sessionId : null,
    hasSnapshot: Boolean(snapshot) || renderedMessages.length > 0,
    isFetching: !props.draftOnly && snapshotQuery.isFetching,
    isError:
      (!props.draftOnly && snapshotQuery.isError) || Boolean(visibleError),
  });

  const buildDraft = useCallback(
    (text: string, nextAttachments: ComposerAttachment[]): ComposerDraft => {
      const parts: ComposerPart[] = text
        .split(/(\[\[assistant-scenario:[^\]]+\]\]|\[pasted text [^\]]+\]|@[^\s@]+)/)
        .flatMap((segment) => {
          if (!segment) return [] as ComposerDraft["parts"];
          if (/^\[\[assistant-scenario:[^\]]+\]\]$/.test(segment)) {
            return [] as ComposerDraft["parts"];
          }
          const pasteMatch = segment.match(/^\[pasted text (.+)\]$/);
          if (pasteMatch) {
            const target = pasteParts.find(
              (item) => item.label === pasteMatch[1],
            );
            if (target) {
              return [
                {
                  type: "paste",
                  id: target.id,
                  label: target.label,
                  text: target.text,
                  lines: target.lines,
                },
              ];
            }
          }
          if (segment.startsWith("@")) {
            const value = decodeComposerMentionValue(segment.slice(1));
            const kind = mentions[value];
            if (kind === "agent")
              return [
                {
                  type: "agent",
                  name: value,
                } satisfies ComposerDraft["parts"][number],
              ];
            if (kind === "file")
              return [
                {
                  type: "file",
                  path: value,
                  label: value,
                } satisfies ComposerDraft["parts"][number],
              ];
          }
          return [
            {
              type: "text",
              text: segment,
            } satisfies ComposerDraft["parts"][number],
          ];
        });
      // Expand paste placeholders in resolvedText so the model receives
      // the actual pasted content instead of "[pasted text <label>]".
      let resolved = text;
      for (const part of pasteParts) {
        resolved = resolved.replace(`[pasted text ${part.label}]`, part.text);
      }
      for (const value of Object.keys(mentions)) {
        resolved = resolved.replaceAll(
          `@${encodeComposerMentionValue(value)}`,
          `@${value}`,
        );
      }
      const resolvedSlashMatch = resolved.trim().match(/^\/([^\s]+)\s*(.*)$/);
      const officeCollaborationActive =
        assistantOfficeFeaturesActive && assistantFeatureCategoryId === "office";
      return {
        mode: "prompt",
        parts,
        attachments: nextAttachments,
        accessMode,
        collaborationMode: officeCollaborationActive
          ? officeCollaborationMode
          : collaborationMode,
        text,
        resolvedText: resolved,
        command: resolvedSlashMatch
          ? {
              name: resolvedSlashMatch[1] ?? "",
              arguments: resolvedSlashMatch[2] ?? "",
            }
          : undefined,
      };
    },
    [accessMode, assistantFeatureCategoryId, assistantOfficeFeaturesActive, collaborationMode, mentions, officeCollaborationMode, pasteParts],
  );

  const handleComposerDraftChange = useCallback(
    (value: string) => {
      setComposerDraft(props.sessionId, value);
    },
    [props.sessionId, setComposerDraft],
  );

  const handleCopyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(transcriptToText(renderedMessages));
    } catch (nextError) {
      setError({
        message:
          nextError instanceof Error
            ? nextError.message
            : t("session.copy_transcript_failed"),
      });
    }
  };

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    if (
      assistantCodeFeaturesActive &&
      props.draftOnly &&
      assistantFeatureCategoryId === "code" &&
      !props.draftWorkspaceDirectory?.trim()
    ) {
      setShowFolderRequiredBubble(true);
      window.setTimeout(() => setShowFolderRequiredBubble(false), 2600);
      return;
    }
    // Intentionally allow sending while the assistant is still streaming.
    // OpenCode accepts follow-up user turns mid-run and queues them; if the
    // backend can't accept the follow-up it'll surface an error via the
    // catch below. This restores the "append a prompt while it's still
    // talking" behavior that the Solid composer had.
    setError(null);
    setDismissedErrorMessage(null);
    if (!props.draftOnly) {
      useSessionActivityStore
        .getState()
        .setRunStatus(props.workspaceId, props.sessionId, { type: "busy" });
    }
    setSending(true);
    setAwaitingAssistantBaseline(renderedMessages.length);
    setNoVisibleAssistantOutputBaseline(null);
    try {
      const nextDraft = buildDraft(text, attachments);
      await props.onSendDraft(nextDraft);
      attachments.forEach(revokeAttachmentPreview);
      clearComposerSession(props.sessionId);
      props.onDraftChange(buildDraft("", []));
      setSending(false);
    } catch (nextError) {
      const parsed = parseSessionError(nextError);
      setError(parsed);
      setDismissedErrorMessage(null);
      if (!props.draftOnly) {
        useSessionActivityStore
          .getState()
          .setError(props.workspaceId, props.sessionId, parsed.message);
      }
      setComposerDraft(props.sessionId, "");
      setAwaitingAssistantBaseline(null);
      setNoVisibleAssistantOutputBaseline(null);
      setSending(false);
    }
  }, [
    attachments,
    assistantCodeFeaturesActive,
    assistantFeatureCategoryId,
    buildDraft,
    clearComposerSession,
    draft,
    props.onDraftChange,
    props.onSendDraft,
    props.draftOnly,
    props.draftWorkspaceDirectory,
    props.sessionId,
    props.workspaceId,
    renderedMessages.length,
    setComposerDraft,
  ]);

  const handleAbort = useCallback(async () => {
    if (!chatStreaming) return;
    setError(null);
    setDismissedErrorMessage(null);
    try {
      await abortSessionSafe(opencodeClient, props.sessionId);
      await snapshotQuery.refetch();
    } catch (nextError) {
      setError({
        message:
          nextError instanceof Error
            ? nextError.message
            : t("session.stop_run_failed"),
      });
    }
  }, [chatStreaming, opencodeClient, props.sessionId, snapshotQuery.refetch]);

  const handleDismissError = useCallback(() => {
    if (visibleError?.message) {
      setDismissedErrorMessage(visibleError.message);
    }
    setError(null);
    if (!props.draftOnly) {
      useSessionActivityStore
        .getState()
        .clearError(props.workspaceId, props.sessionId);
    }
  }, [props.draftOnly, props.sessionId, props.workspaceId, visibleError]);

  useEffect(() => {
    if (liveStatus.type === "idle") {
      setSending(false);
    }
  }, [liveStatus.type]);

  useEffect(() => {
    props.onDraftChange(buildDraft(draft, attachments));
  }, [attachments, buildDraft, draft, props.onDraftChange]);

  const handleAttachFiles = (files: File[]) => {
    if (!props.attachmentsEnabled) {
      setNotice({
        title:
          props.attachmentsDisabledReason ?? t("session.attachments_unavailable"),
        tone: "warning",
      });
      return;
    }
    const oversized = files.filter((file) => file.size > 25 * 1024 * 1024);
    const accepted = files.filter((file) => file.size <= 25 * 1024 * 1024);
    if (oversized.length) {
      setNotice({
        title:
          oversized.length === 1
            ? `${oversized[0]?.name ?? "File"} is too large`
            : `${oversized.length} files are too large`,
        description: t("session.files_over_25mb_skipped"),
        tone: "warning",
      });
    }
    if (!accepted.length) return;
    const next = createComposerAttachments(accepted);
    setComposerAttachments(props.sessionId, [...attachments, ...next]);
    setNotice({
      title:
        next.length === 1
          ? `Attached ${next[0]?.name ?? "file"}`
          : `Attached ${next.length} files`,
      tone: "success",
    });
  };

  const handleRemoveAttachment = (id: string) => {
    const target = attachments.find((item) => item.id === id);
    if (target?.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
    }
    setComposerAttachments(
      props.sessionId,
      attachments.filter((item) => item.id !== id),
    );
  };

  const handleInsertMention = (kind: "agent" | "file", value: string) => {
    setComposerDraft(
      props.sessionId,
      draft.replace(/@([^\s@]*)$/, `@${encodeComposerMentionValue(value)} `),
    );
    setComposerMentions(props.sessionId, { ...mentions, [value]: kind });
  };

  const handlePasteText = (text: string) => {
    const id = `paste-${Math.random().toString(36).slice(2)}`;
    const label = `${id.slice(-4)} · ${text.split(/\r?\n/).length} lines`;
    setComposerPasteParts(props.sessionId, [
      ...pasteParts,
      { id, label, text, lines: text.split(/\r?\n/).length },
    ]);
    setComposerDraft(props.sessionId, `${draft}[pasted text ${label}]`);
  };

  const handleRevealPastedText = (id: string) => {
    const part = pasteParts.find((item) => item.id === id);
    if (!part) return;
    setNotice({
      title: `Pasted text · ${part.label}`,
      description: part.text.slice(0, 800),
      tone: "info",
    });
  };

  const handleExpandPastedText = (id: string) => {
    const part = pasteParts.find((item) => item.id === id);
    if (!part) return;
    setComposerDraft(
      props.sessionId,
      draft.replace(`[pasted text ${part.label}]`, part.text),
    );
    setComposerPasteParts(
      props.sessionId,
      pasteParts.filter((item) => item.id !== id),
    );
  };

  const handleRemovePastedText = (id: string) => {
    const target = pasteParts.find((item) => item.id === id);
    if (!target) return;
    setComposerDraft(
      props.sessionId,
      draft.replace(`[pasted text ${target.label}]`, ""),
    );
    setComposerPasteParts(
      props.sessionId,
      pasteParts.filter((item) => item.id !== id),
    );
  };

  const handleUnsupportedFileLinks = (links: string[]) => {
    if (!links.length) return;
    setComposerDraft(
      props.sessionId,
      `${draft}${draft && !draft.endsWith("\n") ? "\n" : ""}${links.join("\n")}`,
    );
  };

  const typeComposerText = useCallback(
    async (text: string) => {
      window.dispatchEvent(new Event("onmyagent:focusPrompt"));
      setComposerDraft(props.sessionId, text);
      await waitForControl(40);
    },
    [props.sessionId, setComposerDraft],
  );

  useEffect(() => {
    const handleVoiceTranscript = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (
        !detail ||
        typeof detail !== "object" ||
        Array.isArray(detail) ||
        !("text" in detail) ||
        typeof detail.text !== "string"
      )
        return;
      const text = detail.text;
      void typeComposerText(text);
      props.onDraftChange(buildDraft(text, attachments));
      recordInspectorEvent("voice.transcript.applied", {
        workspaceId: props.workspaceId,
        sessionId: props.sessionId,
        length: text.length,
      });
    };
    window.addEventListener("onmyagent:voice-transcript", handleVoiceTranscript);
    return () =>
      window.removeEventListener(
        "onmyagent:voice-transcript",
        handleVoiceTranscript,
      );
  }, [
    attachments,
    buildDraft,
    props.onDraftChange,
    props.sessionId,
    props.workspaceId,
    typeComposerText,
  ]);

  const composerSetTextControlAction = useMemo<OpenworkControlAction>(
    () => ({
      id: "composer.set_text",
      label: t("session.control_type_composer"),
      description:
        "Replace the current session draft and type the supplied text visibly.",
      sideEffect: "none",
      requiresArgs: true,
      args: [
        {
          name: "text",
          type: "string",
          required: true,
          description: t("session.control_prompt_text_desc"),
        },
      ],
      previewArgs: { text: DEFAULT_COMPOSER_CONTROL_TEXT },
      targetRef: composerShellRef,
      execute: async (args, helpers) => {
        const text = controlTextArgument(args);
        helpers.setNarration(
          t("session.control_typing_chars", {
            count: text.length.toLocaleString(),
          }),
        );
        await typeComposerText(text);
        props.onDraftChange(buildDraft(text, attachments));
        return { draftLength: text.length };
      },
    }),
    [attachments, buildDraft, props.onDraftChange, typeComposerText],
  );
  useControlAction(composerSetTextControlAction);

  const composerSendControlAction = useMemo<OpenworkControlAction>(
    () => ({
      id: "composer.send",
      label: t("session.control_send_composer"),
      description: t("session.control_send_composer_desc"),
      sideEffect: "mutation",
      disabled:
        props.modelUnavailable ||
        (!draft.trim() && attachments.length === 0) ||
        model.transitionState !== "idle",
      targetRef: composerShellRef,
      execute: async () => {
        await handleSend();
        return true;
      },
    }),
    [
      attachments.length,
      draft,
      handleSend,
      model.transitionState,
      props.modelUnavailable,
    ],
  );
  useControlAction(composerSendControlAction);

  const composerStopControlAction = useMemo<OpenworkControlAction>(
    () => ({
      id: "composer.stop",
      label: t("session.control_stop_run"),
      description: t("session.control_stop_run_desc"),
      sideEffect: "mutation",
      disabled: !chatStreaming,
      targetRef: composerShellRef,
      execute: async () => {
        await handleAbort();
        return true;
      },
    }),
    [chatStreaming, handleAbort],
  );
  useControlAction(composerStopControlAction);

  const listSkills = async (): Promise<SkillCard[]> => {
    const response = await props.client.listSkills(props.workspaceId, {
      includeGlobal: true,
    });
    const next = (response.items ?? []).map(
      (skill) =>
        ({
          name: skill.name,
          path: skill.path,
          description: skill.description,
          trigger: skill.trigger,
        }) satisfies SkillCard,
    );
    setToolSkills(next);
    return next;
  };

  const listMcp = async (): Promise<{
    servers: McpServerEntry[];
    statuses: McpStatusMap;
    status: string | null;
  }> => {
    const response = await props.client.listMcp(props.workspaceId);
    const servers = (response.items ?? []).map(
      (entry) =>
        ({
          name: entry.name,
          config: entry.config as McpServerEntry["config"],
        }) satisfies McpServerEntry,
    );

    let statuses: McpStatusMap = {};
    try {
      if (props.workspaceRoot.trim()) {
        statuses = unwrap(
          await opencodeClient.mcp.status({
            directory: props.workspaceRoot.trim(),
          }),
        ) as McpStatusMap;
      }
    } catch {
      statuses = {};
    }

    const status = servers.length ? null : "No MCP servers loaded.";
    setToolMcpServers(servers);
    setToolMcpStatuses(statuses);
    setToolMcpStatus(status);
    return { servers, statuses, status };
  };

  const listImportedPlugins = async (): Promise<CloudImportedPlugin[]> => {
    const response = await props.client.getConfig(props.workspaceId);
    const plugins = Object.values(
      readWorkspaceCloudImports(response.onmyagent).plugins,
    ).sort((left, right) => left.name.localeCompare(right.name));
    setToolImportedPlugins(plugins);
    return plugins;
  };

  const handleUploadInboxFiles = async (
    files: File[],
    options?: { notify?: boolean },
  ) => {
    const input = files.filter(Boolean);
    if (!input.length) return;
    try {
      const results = await Promise.all(
        input.map((file) => props.client.uploadInbox(props.workspaceId, file)),
      );
      if (options?.notify !== false) {
        const summary = results
          .map(
            (item) =>
              item.path.split("/").filter(Boolean).slice(-1)[0] ?? item.path,
          )
          .join(", ");
        setNotice({
          title:
            input.length === 1
              ? "Uploaded to the shared folder."
              : `Uploaded ${input.length} files to the shared folder.`,
          description: summary || undefined,
          tone: "success",
        });
      }
      return results;
    } catch (nextError) {
      setNotice({
        title:
          nextError instanceof Error
            ? nextError.message
            : "Shared folder upload failed",
        tone: "warning",
      });
      throw nextError;
    }
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sessionScroll = useSessionScrollController({
    selectedSessionId: props.sessionId,
    renderedMessages,
    containerRef: scrollRef,
    contentRef,
    sessionChangeScroll:
      props.personalAssistantHome && props.draftOnly ? "top" : "bottom",
  });

  const sessionScrollTopControlAction = useMemo<OpenworkControlAction>(
    () => ({
      id: "session.scroll_top",
      label: t("session.control_scroll_top"),
      description: t("session.control_scroll_top_desc"),
      sideEffect: "none",
      execute: () => {
        const container = scrollRef.current;
        if (!container)
          return { ok: false, error: t("session.control_transcript_not_mounted") };
        container.scrollTo({ top: 0, behavior: "smooth" });
        return { ok: true, position: "top" };
      },
    }),
    [],
  );
  useControlAction(sessionScrollTopControlAction);

  const sessionScrollBottomControlAction = useMemo<OpenworkControlAction>(
    () => ({
      id: "session.scroll_bottom",
      label: t("session.control_scroll_bottom"),
      description: t("session.control_scroll_bottom_desc"),
      sideEffect: "none",
      execute: () => {
        sessionScroll.jumpToLatest("smooth");
        return { ok: true, position: "bottom" };
      },
    }),
    [sessionScroll.jumpToLatest],
  );
  useControlAction(sessionScrollBottomControlAction);

  const sessionLatestMessageControlAction = useMemo<OpenworkControlAction>(
    () => ({
      id: "session.latest_message",
      label: t("session.voice_read_latest_short"),
      description: t("session.control_latest_message_desc"),
      sideEffect: "none",
      execute: () => {
        const result = latestMessageControlResult({
          messages: renderedMessages,
          sessionId: props.sessionId,
        });
        if (!result)
          return {
            ok: false,
            error: t("session.control_no_visible_messages"),
          };
        return result;
      },
    }),
    [props.sessionId, renderedMessages],
  );
  useControlAction(sessionLatestMessageControlAction);

  const sessionReadTranscriptControlAction = useMemo<OpenworkControlAction>(
    () => ({
      id: "session.read_transcript",
      label: t("session.control_read_transcript"),
      description: t("session.control_read_transcript_desc"),
      sideEffect: "none",
      args: [
        {
          name: "count",
          type: "number",
          required: false,
          description: t("session.control_recent_messages_count_desc"),
        },
      ],
      execute: (args) => {
        const result = transcriptControlResult({
          count: controlRecentMessageCount(args),
          messages: renderedMessages,
          sessionId: props.sessionId,
        });
        if (!result)
          return { ok: false, error: t("session.control_no_messages") };
        return result;
      },
    }),
    [props.sessionId, renderedMessages],
  );
  useControlAction(sessionReadTranscriptControlAction);

  const selectAssistantScenario = useCallback(
    (scenario: AssistantScenario) => {
      setAssistantScenarioId(scenario.id);
      setAssistantPromptCardsVisible(true);
      const nextText =
        `${assistantScenarioDraftToken(scenario.id)} ${removeAssistantScenarioDraftTokens(draft)}`.trimEnd();
      void typeComposerText(nextText);
    },
    [draft, typeComposerText],
  );

  const selectAssistantPrompt = useCallback(
    (prompt: string) => {
      setAssistantPromptCardsVisible(false);
      const prefix = assistantScenario
        ? `${assistantScenarioDraftToken(assistantScenario.id)} `
        : "";
      void typeComposerText(`${prefix}${prompt}`);
    },
    [assistantScenario, typeComposerText],
  );

  const personalAssistantDraftHome =
    props.personalAssistantHome &&
    props.draftOnly &&
    renderedMessages.length === 0 &&
    !visibleError &&
    effectiveActivityStatus === "idle";
  const assistantDraftHomeTitle =
    assistantCategoryId === "code"
      ? t("session.assistant_code_title")
      : t("session.assistant_work_title");
  const assistantDraftHomeSubtitle =
    assistantCategoryId === "code"
      ? t("session.assistant_code_subtitle")
      : t("session.assistant_work_subtitle");

  const assistantComposerAccessory =
    props.personalAssistantHome && props.draftOnly && !personalAssistantDraftHome ? (
      <PersonalAssistantAccessory
        categoryId={assistantCategoryId}
        selectedScenario={assistantScenario}
        showPrompts={assistantPromptCardsVisible}
        onSelectScenario={selectAssistantScenario}
        onSelectPrompt={selectAssistantPrompt}
      />
    ) : null;

  const sessionComposerAccessory =
    props.activeQuestion ||
    (props.todos ?? []).some((todo) => todo.content.trim()) ||
    props.activePermission ? (
      <div>
        {props.activeQuestion ? (
          <QuestionPanel
            questions={props.activeQuestion.questions}
            busy={props.questionReplyBusy ?? false}
            onReply={(answers) => {
              if (props.activeQuestion) {
                props.respondQuestion?.(props.activeQuestion.id, answers);
              }
            }}
          />
        ) : (
          <TodoPanel todos={props.todos ?? []} />
        )}
        {props.activePermission ? (
          <PermissionApprovalPanel
            permission={props.activePermission}
            busy={props.permissionReplyBusy}
            respondPermission={props.respondPermission}
            safeStringify={props.safeStringify}
          />
        ) : null}
      </div>
    ) : null;

  const composerAccessory =
    sessionComposerAccessory ?? assistantComposerAccessory;

  const chatHeaderAgent = effectiveAgent
    ? {
        name: effectiveAgent.name,
        avatarUrl: effectiveAgent.avatar.avatarUrl,
        avatarBackground: effectiveAgent.avatar.avatarBackground,
      }
    : props.personalAssistantHome
      ? {
          name: onmyagentAssistantName(),
          avatarUrl: resolvePublicAssetUrl(ONMYAGENT_ASSISTANT_AVATAR),
          avatarBackground: "#eef7f2",
        }
      : {
          name: props.agentLabel || t("nav.agents"),
          avatarUrl: null,
          avatarBackground: null,
        };
  const assistantAvatarOverride = props.personalAssistantHome
    ? {
        name: onmyagentAssistantName(),
        avatarUrl: resolvePublicAssetUrl(ONMYAGENT_ASSISTANT_AVATAR),
        avatarBackground: "#eef7f2",
      }
    : undefined;
  const codeSceneToolbar =
    assistantCodeFeaturesActive && assistantFeatureCategoryId === "code" ? (
      <CodeSceneToolbar
        sessionId={props.sessionId}
        draftOnly={props.draftOnly ?? false}
        workspacePath={
          props.draftOnly
            ? (props.draftWorkspaceDirectory?.trim() || props.workspaceRoot || null)
            : props.workspaceRoot
        }
      />
    ) : null;
  return (
    <DevProfiler id="SessionSurface">
      <div
        className={cn(
          "flex h-full min-h-0 flex-col",
          personalAssistantDraftHome && "items-center justify-center px-8 pb-8 pt-16",
        )}
      >
        {!personalAssistantDraftHome ? (
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-dls-border/70 bg-dls-surface px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <PendingAgentAvatar
                name={chatHeaderAgent.name}
                avatarUrl={chatHeaderAgent.avatarUrl}
                avatarBackground={chatHeaderAgent.avatarBackground ?? undefined}
                className="size-7 text-xs"
              />
              <div className={sessionSurfaceTextClass.headerAgentName}>
                {chatHeaderAgent.name}
              </div>
            </div>
            <div className="relative flex items-center gap-1.5 mac:titlebar-no-drag">
              {codeSceneToolbar}
              {!props.personalAssistantHome && props.onOpenAgentSettings ? (
                <Button variant="ghost" size="icon-sm"
                  type="button"
                  className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
                  title={t("session.configure_current_agent")}
                  aria-label={t("session.configure_current_agent")}
                  onClick={props.onOpenAgentSettings}
                >
                  <Settings2 className="size-4" />
                </Button>
              ) : null}
              {props.headerActions}
            </div>
          </header>
        ) : null}
        {props.conversationTabs}
        {model.transitionState === "switching" && showDelayedLoading ? (
          <div className="flex justify-center px-6 pt-4">
            <StatusBadge tone="surface" size="default">
              {model.renderSource === "cache"
                ? "Switching session from cache..."
                : "Switching session..."}
            </StatusBadge>
          </div>
        ) : null}

        <div
          className={cn(
            "relative min-h-0 flex-1",
            personalAssistantDraftHome && "hidden",
          )}
        >
          <div
            ref={scrollRef}
            onWheel={(event) => {
              sessionScroll.markScrollGesture(event.target);
            }}
            onTouchStart={(event) => {
              sessionScroll.markScrollGesture(event.target);
            }}
            onTouchMove={(event) => {
              sessionScroll.markScrollGesture(event.target);
            }}
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget) return;
              sessionScroll.markScrollGesture(event.currentTarget);
            }}
            onScroll={sessionScroll.handleScroll}
            className="absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-y-contain px-6 py-5 sm:px-8"
          >
            <div ref={contentRef} className="w-full">
              {showDelayedLoading && pendingSessionLoad ? (
                <div className="px-6 py-16">
                  <div className="mx-auto max-w-sm rounded-3xl border border-dls-border bg-dls-hover/60 px-8 py-10 text-center">
                    <div className={sessionSurfaceTextClass.openingSession}>
                      Opening session…
                    </div>
                  </div>
                </div>
              ) : (snapshotQuery.isError || visibleError) &&
                !snapshot &&
                renderedMessages.length === 0 ? (
                <div className="px-6 py-8">
                  {visibleError ? (
                    <SessionErrorCard
                      error={visibleError}
                      onDismiss={handleDismissError}
                      onChangeModel={props.onChangeModel}
                      onOpenModelPicker={props.onModelClick}
                    />
                  ) : (
                    <div className={sessionSurfaceStateClass.snapshotError}>
                      {snapshotQuery.error instanceof Error
                        ? snapshotQuery.error.message
                        : "Failed to load session."}
                    </div>
                  )}
                </div>
              ) : renderedMessages.length === 0 &&
                effectiveActivityStatus !== "idle" &&
                !visibleError ? (
                <div className="px-6 py-12">
                  <AssistantWaitingCard
                    label={getSessionActivityStatusLabel(
                      effectiveActivityStatus,
                    )}
                  />
                </div>
              ) : renderedMessages.length === 0 &&
                (props.draftOnly ||
                  (snapshot && snapshot.messages.length === 0)) ? (
                visibleError ? (
                  <SessionErrorCard
                    error={visibleError}
                    onDismiss={handleDismissError}
                    onChangeModel={props.onChangeModel}
                    onOpenModelPicker={props.onModelClick}
                  />
                ) : props.personalAssistantHome ? null : effectiveAgent ? (
                  <div className="flex flex-1 flex-col items-center px-6 py-8">
                    <div className="flex flex-1 flex-col items-center justify-center">
                      <PendingAgentAvatar
                        name={effectiveAgent.name}
                        avatarUrl={effectiveAgent.avatar.avatarUrl}
                        avatarBackground={
                          effectiveAgent.avatar.avatarBackground
                        }
                        className="size-20 text-4xl"
                      />
                      <h2 className={sessionSurfaceTextClass.agentEmptyTitle}>
                        {effectiveAgent.name}
                      </h2>
                      <p className={sessionSurfaceTextClass.agentEmptyDescription}>
                        {effectiveAgent.description}
                      </p>
                    </div>
                    <AgentPromptSuggestions
                      agentId={effectiveAgent.id}
                      onSelect={(prompt) => void typeComposerText(prompt)}
                    />
                  </div>
                ) : null
              ) : (
                <DevProfiler id="SessionTranscript">
                  <>
                    <SessionTranscript
                      messages={renderedMessages}
                      isStreaming={chatStreaming}
                      developerMode={props.developerMode}
                      showThinking={showThinking}
                      scrollElement={() => scrollRef.current}
                      onRevertToMessage={props.onRevertToMessage}
                      onForkAtMessage={props.onForkAtMessage}
                      openTargets={verifiedOpenTargets}
                      onOpenTarget={props.onOpenTarget}
                      footer={assistantStatusFooter}
                      assistantAvatar={
                        effectiveAgent
                          ? {
                              name: effectiveAgent.name,
                              avatarUrl: effectiveAgent.avatar.avatarUrl,
                              avatarBackground:
                                effectiveAgent.avatar.avatarBackground,
                            }
                          : assistantAvatarOverride
                      }
                      userIdentity={props.userIdentity}
                    />
                    {visibleError ? (
                      <SessionErrorCard
                        error={visibleError}
                        onDismiss={handleDismissError}
                        onChangeModel={props.onChangeModel}
                        onOpenModelPicker={props.onModelClick}
                      />
                    ) : null}
                  </>
                </DevProfiler>
              )}
            </div>
          </div>
          {!personalAssistantDraftHome &&
          (!sessionScroll.isAtBottom ||
            (!chatStreaming && sessionScroll.topClippedMessageId)) ? (
            <div className="pointer-events-none absolute bottom-2 left-1/2 z-30 flex -translate-x-1/2 justify-center">
              <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-dls-border bg-dls-surface/95 p-1 backdrop-blur-md">
                {!chatStreaming && sessionScroll.topClippedMessageId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="rounded-full text-dls-text hover:bg-dls-hover"
                    onClick={() => {
                      sessionScroll.jumpToStartOfMessage("smooth");
                    }}
                  >
                    {t("session.jump_to_start")}
                  </Button>
                ) : null}
                {!sessionScroll.isAtBottom ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="rounded-full text-dls-text hover:bg-dls-hover"
                    onClick={() => {
                      sessionScroll.jumpToLatest("smooth");
                    }}
                  >
                    {t("session.jump_to_latest")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {personalAssistantDraftHome && codeSceneToolbar ? (
          <div className="absolute right-5 top-4 z-20 flex items-center gap-1.5 mac:titlebar-no-drag">
            {codeSceneToolbar}
            {props.headerActions}
          </div>
        ) : null}
        {personalAssistantDraftHome ? (
          <div className="mb-7 flex flex-col items-center text-center">
            <div className="flex items-center gap-2 text-dls-text">
              <AssistantDraftHomeMark categoryId={assistantCategoryId} />
              <h2 className={sessionSurfaceTextClass.draftHomeTitle}>
                {assistantDraftHomeTitle}
              </h2>
            </div>
            <p className={sessionSurfaceTextClass.draftHomeSubtitle}>
              {assistantDraftHomeSubtitle}
            </p>
          </div>
        ) : null}

        <div
          ref={composerShellRef}
          className={cn(
            "shrink-0 px-0 pb-2 pt-2",
            personalAssistantDraftHome && "w-full max-w-5xl pb-0 pt-0",
          )}
        >
          <DevProfiler id="SessionComposer">
            <ReactSessionComposer
              draft={draft}
              mentions={mentions}
              scenarioTags={assistantScenarioTags}
              placeholder={assistantOfficeFeaturesActive || assistantCodeFeaturesActive ? composerPlaceholder : undefined}
              onDraftChange={handleComposerDraftChange}
              onSend={handleSend}
              onStop={handleAbort}
              busy={chatStreaming}
              disabled={
                (model.transitionState !== "idle" &&
                  model.transitionState !== "failed") ||
                Boolean(props.modelUnavailable)
              }
              modelUnavailable={Boolean(props.modelUnavailable)}
              accessMode={accessMode}
              onAccessModeChange={setAccessMode}
              collaborationMode={
                assistantOfficeFeaturesActive && assistantFeatureCategoryId === "office"
                  ? officeCollaborationMode
                  : collaborationMode
              }
              onCollaborationModeChange={
                assistantOfficeFeaturesActive && assistantFeatureCategoryId === "office"
                  ? setOfficeCollaborationMode
                  : setCollaborationMode
              }
              collaborationModeVariant={
                assistantOfficeFeaturesActive && assistantFeatureCategoryId === "office"
                  ? "office"
                  : "legacy"
              }
              modelPickerOpen={props.modelPickerOpen}
              selectedModel={props.selectedModel}
              onModelPickerOpenChange={props.onModelPickerOpenChange}
              onModelChange={props.onModelChange}
              attachments={attachments}
              onAttachFiles={handleAttachFiles}
              onRemoveAttachment={handleRemoveAttachment}
              attachmentsEnabled={props.attachmentsEnabled}
              attachmentsDisabledReason={props.attachmentsDisabledReason}
              modelVariantLabel={props.modelVariantLabel}
              modelVariant={props.modelVariant}
              modelBehaviorOptions={props.modelBehaviorOptions}
              onModelVariantChange={props.onModelVariantChange}
              agentLabel={props.agentLabel}
              selectedAgent={props.selectedAgent}
              listAgents={props.listAgents}
              onSelectAgent={props.onSelectAgent}
              listCommands={props.listCommands}
              listSkills={listSkills}
              skills={toolSkills}
              listMcp={listMcp}
              mcpServers={toolMcpServers}
              mcpStatus={toolMcpStatus}
              mcpStatuses={toolMcpStatuses}
              listImportedPlugins={listImportedPlugins}
              importedPlugins={toolImportedPlugins}
              onOpenSettingsSection={props.onOpenSettingsSection}
              recentFiles={props.recentFiles}
              searchFiles={props.searchFiles}
              onInsertMention={handleInsertMention}
              notice={notice}
              onNotice={setNotice}
              onPasteText={handlePasteText}
              onUnsupportedFileLinks={handleUnsupportedFileLinks}
              pastedText={pasteParts}
              onExpandPastedText={handleExpandPastedText}
              onRevealPastedText={handleRevealPastedText}
              onRemovePastedText={handleRemovePastedText}
              isRemoteWorkspace={props.isRemoteWorkspace}
              isSandboxWorkspace={props.isSandboxWorkspace}
              onUploadInboxFiles={
                props.onUploadInboxFiles ?? handleUploadInboxFiles
              }
              compactTopSpacing={Boolean(composerAccessory)}
              topAccessory={composerAccessory}
              bottomAccessory={
                (props.personalAssistantHome || props.assistantFeatureCategoryId) && props.draftOnly ? (
                  <div className="relative inline-flex h-6 items-center gap-1 text-xs font-medium">
                    {showFolderRequiredBubble ? (
                      <div className="absolute bottom-full left-0 z-20 mb-2 w-56 rounded-lg border border-dls-accent/25 bg-dls-surface px-3 py-2 text-xs leading-5 text-dls-text">
                        <div className="font-medium text-dls-accent">
                          {t("session.choose_folder_required_title")}
                        </div>
                        <div className="mt-0.5 text-dls-secondary">
                          {t("session.choose_folder_required_desc")}
                        </div>
                        <div className="absolute -bottom-1 left-5 size-2 rotate-45 border-b border-r border-dls-accent/25 bg-dls-surface" />
                      </div>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowFolderRequiredBubble(false);
                        props.onPickDraftWorkspace?.();
                      }}
                      className={cn(
                        "group h-6 justify-start gap-2 rounded-md px-1 text-left text-xs hover:text-dls-text",
                        props.draftWorkspaceDirectory
                          ? "text-dls-secondary"
                          : assistantFeatureCategoryId === "code"
                            ? "animate-pulse bg-dls-accent/10 text-dls-accent hover:bg-dls-accent/15 hover:text-dls-accent"
                            : "text-dls-secondary",
                      )}
                    >
                      {props.draftWorkspaceDirectory ? (
                        <>
                          <FolderOpen className="size-3.5 shrink-0" />
                          <span className="max-w-56 truncate text-dls-text">
                            {props.draftWorkspaceDirectory
                              .replace(/\\/g, "/")
                              .replace(/\/+$/, "")
                              .split("/")
                              .filter(Boolean)
                              .pop()}
                          </span>
                        </>
                      ) : (
                        <>
                          <Folder className="size-3.5 shrink-0" />
                          <span>
                            {assistantFeatureCategoryId === "office"
                              ? t("session.choose_folder_optional")
                              : t("session.choose_folder")}
                          </span>
                        </>
                      )}
                      <ChevronRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                    </Button>
                    {props.draftWorkspaceDirectory ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={props.onClearDraftWorkspace}
                        className="size-5 rounded-full text-dls-secondary hover:bg-dls-surface hover:text-dls-text"
                        title={t("session.clear_workspace_selection")}
                        aria-label={t("session.clear_workspace_selection")}
                      >
                        <X className="size-3" />
                      </Button>
                    ) : null}
                  </div>
                ) : undefined
              }
            />
          </DevProfiler>
        </div>
        {personalAssistantDraftHome ? (
          <div className="mt-4 w-full max-w-5xl">
            <PersonalAssistantAccessory
              categoryId={assistantCategoryId}
              selectedScenario={assistantScenario}
              showPrompts={assistantPromptCardsVisible}
              onSelectScenario={selectAssistantScenario}
              onSelectPrompt={selectAssistantPrompt}
            />
          </div>
        ) : null}
        {/* Error display moved inline into the session conversation area */}
        {props.developerMode ? (
          <SessionDebugPanel model={model} snapshot={snapshot} />
        ) : null}
      </div>
    </DevProfiler>
  );
}
