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
  Clock3,
  Code2,
  Folder,
  FolderOpen,
  Goal,
  Minimize2,
  Pause,
  Play,
  Settings2,
  Trash2,
  X,
} from "lucide-react";

import { createClient, unwrap } from "../../../../app/lib/opencode";
import { abortSessionSafe } from "../../../../app/lib/opencode-session";
import { currentLocale, t } from "../../../../i18n";
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
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  McpServerEntry,
  McpStatusMap,
  ModelRef,
  PendingPermission,
  PendingQuestion,
  SkillCard,
  TodoItem,
} from "../../../../app/types";
import { DevProfiler, OwDotTicker, publishInspectorSlice, recordInspectorEvent, type OpenworkControlAction, useControlAction, useReactRenderWatchdog } from "../../../shell";
import { ReactSessionComposer } from "./composer/composer";
import { AccessPermissionSelect } from "./composer/access-permission-select";
import { CodeSceneToolbar } from "./code-scene-toolbar";
import {
  decodeComposerMentionValue,
  encodeComposerMentionValue,
} from "./composer/mention-encoding";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { ActionRowButton, DisclosureRowButton } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { PaperGrainGradient } from "@onmyagent/ui/react";
import type { ReactComposerNotice } from "./composer/notice";
import { SessionDebugPanel } from "./debug-panel";
import {
  deriveRenderedSessionMessages,
  resolveRenderedSessionSnapshot,
} from "./session-render-state";
import {
  SessionTranscript,
  type SessionTranscriptDivider,
} from "./message-list";
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
  deriveGoalSummary,
  resolveSessionCollaborationKind,
  resolveSessionRunPolicy,
  shouldShowGoalRuntime,
  summarizeGoalObjective,
} from "./session-run-controller";
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
  messageToReadableText,
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
const ASSISTANT_STALL_NOTICE_MS = 15_000;
const ASSISTANT_RECOVERY_HINT_MS = 120_000;
const MAX_TRANSCRIPT_NOTICES_PER_SESSION = 16;

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
  todoActive: "border-dls-status-warning-border bg-dls-status-warning-soft text-dls-status-warning-fg",
  todoActiveDot: "size-1.5 rounded-full bg-dls-status-warning",
  errorPanel: "rounded-xl border border-dls-status-danger-border bg-dls-status-danger-soft px-5 py-4",
  errorText: "text-sm font-medium text-dls-status-danger",
  errorDismiss: "shrink-0 text-dls-status-danger hover:bg-dls-status-danger/10 hover:text-dls-status-danger",
  snapshotError: "mx-auto max-w-xl rounded-xl border border-dls-status-danger-border bg-dls-status-danger-soft px-6 py-5 text-sm text-dls-status-danger",
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
  sessionAccessMode?: ComposerAccessMode;
  onSessionAccessModeChange?: (mode: ComposerAccessMode) => void;
  sessionCollaborationMode?: ComposerCollaborationMode;
  onSessionCollaborationModeChange?: (mode: ComposerCollaborationMode) => void;
  planRuntime?: CollaborationPlanRuntime | null;
  onPlanRuntimeChange?: (runtime: CollaborationPlanRuntime | null) => void;
  goalRuntime?: CollaborationGoalRuntime | null;
  onGoalRuntimeChange?: (runtime: CollaborationGoalRuntime | null) => void;
  onClearSessionProgress?: () => void;
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
  autoApprovedPermissionNoticeId?: string | null;
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
  onOpenSkillsMarketplace?: (() => void) | undefined;
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

type SessionTranscriptNotice = {
  id: string;
  kind:
    | "cancelled"
    | "stopped"
    | "compacting"
    | "compacted"
    | "stalled"
    | "permission-rejected"
    | "permission-auto-approved";
  afterMessageCount: number;
  elapsedMs?: number;
};

const waitForControl = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

function planTextFromMessages(messages: UIMessage[]) {
  return messages
    .filter((message) => message.role === "assistant")
    .map(messageToReadableText)
    .map((text) => text.replace(/^OnMyAgent\s*/i, "").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

type PlanStepItem = {
  id: string;
  content: string;
  status: "pending" | "active" | "completed";
};

type PlanDetailSection = {
  kind: "risk" | "validation" | "reversibility";
  title: string;
  items: string[];
};

const PLAN_SECTION_BOUNDARY_RE =
  /^(?:#{1,6}\s*)?(?:\u76ee\u6807|\u8303\u56f4|\u98ce\u9669|\u98ce\u9669\u8bf4\u660e|\u53ef\u9006\u6027|\u9a8c\u8bc1|\u9a8c\u8bc1\u65b9\u5f0f|\u4e0b\u4e00\u6b65|\u6267\u884c\u7ed3\u679c|\u7ed3\u679c|\u6ce8\u610f\u4e8b\u9879)(?:\s|$|:|\uff1a)/;
const PLAN_STEP_SECTION_RE =
  /^(?:#{1,6}\s*)?(?:\u6267\u884c\u6b65\u9aa4|\u5b9e\u65bd\u6b65\u9aa4|\u8ba1\u5212\u6b65\u9aa4|\u6b65\u9aa4)(?:\s|$|\uff08|:|\uff1a)/;
const PLAN_HEADING_RE =
  /^(?:#{1,6}\s*)?(?:plan|\u8ba1\u5212)(?:\s|$|:|\uff1a)/i;
const PLAN_DETAIL_PATTERNS: Array<{
  kind: PlanDetailSection["kind"];
  pattern: RegExp;
}> = [
  {
    kind: "risk",
    pattern:
      /^(?:#{1,6}\s*)?(?:risks?|risk\s+notes?|\u98ce\u9669|\u98ce\u9669\u8bf4\u660e)\s*(?:[:\uff1a-]\s*)?(.*)$/i,
  },
  {
    kind: "validation",
    pattern:
      /^(?:#{1,6}\s*)?(?:validation|verification|verify|\u9a8c\u8bc1|\u9a8c\u8bc1\u65b9\u5f0f)\s*(?:[:\uff1a-]\s*)?(.*)$/i,
  },
  {
    kind: "reversibility",
    pattern:
      /^(?:#{1,6}\s*)?(?:reversibility|rollback|\u53ef\u9006\u6027|\u56de\u6eda)\s*(?:[:\uff1a-]\s*)?(.*)$/i,
  },
];

function cleanPlanStepLine(line: string) {
  return line
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.)、]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulPlanStep(step: string) {
  const lower = step.toLowerCase();
  if (!step) return false;
  if (lower.startsWith("#")) return false;
  if (lower.startsWith("risk:")) return false;
  if (lower.startsWith("reversibility:")) return false;
  if (lower.startsWith("impact:")) return false;
  if (lower.startsWith("verification:")) return false;
  if (lower.startsWith("scope:")) return false;
  if (lower.startsWith("note:")) return false;
  if (lower.includes("reversible")) return false;
  if (lower.startsWith("plan mode hard gate")) return false;
  if (lower.startsWith("for this response")) return false;
  if (lower.startsWith("file path")) return false;
  if (lower.includes("<tool_call>")) return false;
  if (lower.includes("file[path=")) return false;
  if (lower.includes("tool_call")) return false;
  if (lower.startsWith("the user wants")) return false;
  if (lower.startsWith("user wants")) return false;
  if (lower.startsWith("let me ")) return false;
  if (lower.startsWith("i should ")) return false;
  if (lower.startsWith("i will ")) return false;
  if (lower.startsWith("i'll ")) return false;
  if (lower.startsWith("\u7528\u6237\u8981\u6c42")) return false;
  if (lower.startsWith("\u6211\u6765")) return false;
  if (lower.startsWith("\u6211\u4f1a")) return false;
  if (lower.startsWith("\u98ce\u9669")) return false;
  if (lower.startsWith("\u8986\u76d6\u98ce\u9669")) return false;
  if (lower.includes("\u98ce\u9669")) return false;
  if (lower.includes("\u51b2\u7a81")) return false;
  if (lower.includes("\u5f71\u54cd")) return false;
  if (lower.includes("\u53ef\u9006")) return false;
  if (lower.includes("\u540c\u540d\u6587\u4ef6")) return false;
  if (lower.includes("\u8986\u76d6")) return false;
  if (lower.startsWith("\u53ef\u9006\u6027")) return false;
  if (lower.startsWith("\u9ad8\u53ef\u9006")) return false;
  if (lower.startsWith("\u5f71\u54cd\u8303\u56f4")) return false;
  if (lower.startsWith("\u9a8c\u8bc1")) return false;
  if (lower.startsWith("\u521b\u5efa\u540e\u8bfb\u53d6")) return false;
  if (lower.startsWith("\u6587\u4ef6\u8def\u5f84")) return false;
  if (lower.startsWith("\u6d4b\u8bd5\u5185\u5bb9\u6587\u6848")) return false;
  if (lower.startsWith("\u4e0d\u6d89\u53ca\u7f51\u7edc")) return false;
  if (lower.startsWith("\u4e0d\u6d89\u53ca")) return false;
  if (lower.startsWith("\u4ec5")) return false;
  if (lower.includes("\u4e0d\u4fee\u6539")) return false;
  if (lower.includes("\u56de\u62a5")) return false;
  if (lower.includes("\u544a\u77e5")) return false;
  if (lower.startsWith("\u8303\u56f4")) return false;
  if (lower.startsWith("\u6ce8\u610f")) return false;
  return true;
}

function uniquePlanSteps(steps: string[]) {
  const seen = new Set<string>();
  return steps.filter((step) => {
    const key = step.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function planDetailTitle(kind: PlanDetailSection["kind"]) {
  if (kind === "risk") return t("session.plan_runtime_risk");
  if (kind === "validation") return t("session.plan_runtime_validation");
  return t("session.plan_runtime_reversibility");
}

function planDetailHeading(line: string) {
  for (const entry of PLAN_DETAIL_PATTERNS) {
    const match = line.match(entry.pattern);
    if (match) {
      return {
        kind: entry.kind,
        remainder: cleanPlanStepLine(match[1] ?? ""),
      };
    }
  }
  return null;
}

function extractPlanDetailSections(planText: string): PlanDetailSection[] {
  const buffers: Record<PlanDetailSection["kind"], string[]> = {
    risk: [],
    validation: [],
    reversibility: [],
  };
  let currentKind: PlanDetailSection["kind"] | null = null;
  const lines = planText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const heading = planDetailHeading(line);
    if (heading) {
      currentKind = heading.kind;
      if (heading.remainder) buffers[currentKind].push(heading.remainder);
      continue;
    }
    if (PLAN_STEP_SECTION_RE.test(line) || (PLAN_SECTION_BOUNDARY_RE.test(line) && !currentKind)) {
      currentKind = null;
      continue;
    }
    if (!currentKind) continue;
    if (PLAN_SECTION_BOUNDARY_RE.test(line) && !planDetailHeading(line)) {
      currentKind = null;
      continue;
    }
    const item = cleanPlanStepLine(line);
    if (item) buffers[currentKind].push(item);
  }

  return (Object.keys(buffers) as PlanDetailSection["kind"][])
    .map((kind) => ({
      kind,
      title: planDetailTitle(kind),
      items: uniquePlanSteps(buffers[kind]).slice(0, 3),
    }))
    .filter((section) => section.items.length > 0);
}

function extractPlanSteps(planText: string): PlanStepItem[] {
  const lines = planText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sectionSteps: string[] = [];
  let readingStepSection = false;

  for (const line of lines) {
    if (PLAN_STEP_SECTION_RE.test(line)) {
      readingStepSection = true;
      continue;
    }
    if (readingStepSection && PLAN_SECTION_BOUNDARY_RE.test(line)) {
      readingStepSection = false;
      continue;
    }
    if (!readingStepSection) continue;
    if (!/^[-*]\s+|\d+[.)、]\s*/.test(line)) continue;
    const step = cleanPlanStepLine(line);
    if (isUsefulPlanStep(step)) sectionSteps.push(step);
  }

  const planHeadingIndex = lines.findIndex((line) => PLAN_HEADING_RE.test(line));
  const fallbackSource =
    planHeadingIndex >= 0 ? lines.slice(planHeadingIndex + 1) : lines;
  const fallbackSteps =
    sectionSteps.length > 0
      ? sectionSteps
      : fallbackSource
          .filter((line) => /^[-*]\s+|\d+[.)、]\s*/.test(line))
          .map(cleanPlanStepLine)
          .filter(isUsefulPlanStep);

  return uniquePlanSteps(fallbackSteps).slice(0, 5).map((content, index) => ({
    id: `plan-step-${index}-${content.slice(0, 16)}`,
    content,
    status: "pending",
  }));
}

function inferPlanStepsFromPrompt(prompt: string): PlanStepItem[] {
  const lower = prompt.toLowerCase();
  const isFileTask =
    lower.includes(".md") ||
    lower.includes(".txt") ||
    lower.includes("file") ||
    prompt.includes("\u6587\u4ef6") ||
    prompt.includes("\u5199\u5165") ||
    prompt.includes("\u521b\u5efa");
  const contents = isFileTask
    ? [
        "\u786e\u8ba4\u76ee\u6807\u6587\u4ef6\u8def\u5f84\u548c\u5199\u5165\u5185\u5bb9",
        "\u521b\u5efa\u6216\u66f4\u65b0\u6587\u4ef6\u5e76\u5199\u5165\u6307\u5b9a\u5185\u5bb9",
        "\u9a8c\u8bc1\u6587\u4ef6\u5df2\u751f\u6210\u4e14\u5185\u5bb9\u7b26\u5408\u8981\u6c42",
      ]
    : [
        "\u786e\u8ba4\u4efb\u52a1\u76ee\u6807\u548c\u6267\u884c\u8303\u56f4",
        "\u6309\u8ba1\u5212\u5b8c\u6210\u6838\u5fc3\u64cd\u4f5c",
        "\u9a8c\u8bc1\u7ed3\u679c\u5e76\u5411\u7528\u6237\u6c47\u62a5",
      ];
  return contents.map((content, index) => ({
    id: `inferred-plan-step-${index}`,
    content,
    status: "pending",
  }));
}

function resolvePlanStepItems(input: {
  planText: string;
  originalPrompt: string;
  runtimeStatus: CollaborationPlanRuntime["status"];
  todos: TodoItem[];
}) {
  const todoSteps = input.todos
    .filter((todo) => todo.content.trim())
    .map((todo, index): PlanStepItem => {
      const status =
        todo.status === "completed"
          ? "completed"
          : todo.status === "in_progress"
            ? "active"
            : "pending";
      return {
        id: todo.id || `todo-plan-step-${index}`,
        content: todo.content.trim(),
        status,
      };
    });
  if (todoSteps.length > 0) return todoSteps;

  const extractedPlanSteps = extractPlanSteps(input.planText);
  const planSteps =
    extractedPlanSteps.length > 0
      ? extractedPlanSteps
      : inferPlanStepsFromPrompt(input.originalPrompt);
  if (input.runtimeStatus === "completed") {
    return planSteps.map((step) => ({ ...step, status: "completed" as const }));
  }
  if (input.runtimeStatus === "executing") {
    return planSteps.map((step, index) => ({
      ...step,
      status: index === 0 ? "active" : "pending",
    }));
  }
  return planSteps;
}

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
  detail,
}: {
  label?: string;
  collapseLayout?: boolean;
  detail?: string;
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
        {detail ? <span className="text-dls-tertiary">{detail}</span> : null}
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

function messageActivityFingerprint(messages: UIMessage[]) {
  return messages
    .map((message) => {
      const partToken = message.parts
        .map((part) => {
          if ("text" in part && typeof part.text === "string") {
            return `${part.type}:${part.text.length}`;
          }
          if (part.type === "dynamic-tool") {
            const record = part as Record<string, unknown>;
            const state = typeof record.state === "string" ? record.state : "";
            const toolName = typeof record.toolName === "string" ? record.toolName : "";
            return `${part.type}:${toolName}:${state}`;
          }
          return part.type;
        })
        .join(",");
      return `${message.id}:${message.role}:${partToken}`;
    })
    .join("|");
}

function compactCandidateText(message: UIMessage) {
  if (message.role !== "assistant") return "";
  return message.parts
    .flatMap((part) => {
      if ("text" in part && typeof part.text === "string") return [part.text];
      return [];
    })
    .join("\n")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLikelyCompactSummaryMessage(message: UIMessage) {
  const text = compactCandidateText(message);
  if (text.length < 320) return false;
  const headings = [
    "Summary",
    "Current State",
    "Completed",
    "Done",
    "In Progress",
    "Blocked",
    "Key Decisions",
    "Next Steps",
    "Progress",
    "\u5f53\u524d\u72b6\u6001",
    "\u6458\u8981",
    "\u5df2\u5b8c\u6210",
    "\u5b8c\u6210",
    "\u8fdb\u884c\u4e2d",
    "\u963b\u585e",
    "\u5173\u952e\u51b3\u7b56",
    "\u4e0b\u4e00\u6b65",
    "\u8fdb\u5ea6",
  ];
  const headingHits = headings.filter((heading) => {
    const escapedHeading = escapeRegExp(heading);
    return new RegExp(
      `(^|\\n)\\s*(?:#+\\s*)?${escapedHeading}(?:\\s|[:：]|$)`,
      "i",
    ).test(text);
  }).length;
  return headingHits >= 3;
}

function filterCompactionMessages(
  messages: UIMessage[],
  compactBoundary: number | null,
) {
  let beforeNextUserAfterBoundary = compactBoundary !== null;
  return messages.filter((message, index) => {
    if (compactBoundary !== null && index >= compactBoundary) {
      if (message.role === "user") beforeNextUserAfterBoundary = false;
      if (
        beforeNextUserAfterBoundary &&
        message.role === "assistant" &&
        isLikelyCompactSummaryMessage(message)
      ) {
        return false;
      }
    }
    return !isLikelyCompactSummaryMessage(message);
  });
}

function TodoPanel(props: { todos: TodoItem[] }) {
  const [pinnedExpanded, setPinnedExpanded] = useState(false);
  const todos = props.todos.filter((todo) => todo.content.trim());
  const completedTodos = todos.filter(
    (todo) => todo.status === "completed",
  ).length;
  const expanded = pinnedExpanded;
  const progressLabel = t("session.todo_progress_label");
  const label = expanded
    ? progressLabel
    : `${progressLabel} · ${completedTodos}/${todos.length}`;

  if (todos.length === 0) return null;

  return (
    <div className="overflow-hidden border-b border-dls-border bg-transparent">
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2",
          expanded ? "border-b border-dls-border" : "",
        )}
      >
        <DisclosureRowButton
          type="button"
          density="flush"
          className="min-w-0 flex-1 justify-start gap-2 text-xs text-dls-secondary hover:bg-transparent hover:text-dls-text"
          onClick={() => setPinnedExpanded((current) => !current)}
        >
          <span className="truncate font-medium text-dls-secondary">
            {label}
          </span>
        </DisclosureRowButton>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => setPinnedExpanded((current) => !current)}
          aria-label={
            expanded
              ? t("session.plan_runtime_collapse")
              : t("session.plan_runtime_expand")
          }
        >
          <Minimize2
            size={12}
            className={`text-dls-secondary transition-transform ${expanded ? "" : "rotate-180"}`}
          />
        </Button>
      </div>
      {expanded ? (
        <div className="max-h-60 space-y-2.5 overflow-auto px-4 pb-3">
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
                      <Check size={12} />
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

function PlanApprovalPanel(props: {
  runtime: CollaborationPlanRuntime;
  todos: TodoItem[];
  busy: boolean;
  onExecute: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isDrafting = props.runtime.status === "drafting";
  const isExecuting = props.runtime.status === "executing";
  const isCompleted = props.runtime.status === "completed";
  const isBlocked = props.runtime.status === "blocked";
  const detailsExpanded = expanded;
  const planText = props.runtime.planText?.trim() || "";
  const planSteps = resolvePlanStepItems({
    planText,
    originalPrompt: props.runtime.originalPrompt,
    runtimeStatus: props.runtime.status,
    todos: props.todos,
  });
  const planDetails = extractPlanDetailSections(planText);
  const completedSteps = planSteps.filter(
    (step) => step.status === "completed",
  ).length;
  const progressLabel = t("session.todo_progress_label");
  const statusLabel = isDrafting
    ? t("session.plan_runtime_drafting")
    : isExecuting
      ? t("session.plan_runtime_executing")
      : isCompleted
        ? t("session.plan_runtime_completed")
        : isBlocked
          ? t("session.plan_runtime_blocked")
        : t("session.plan_runtime_title");
  const label =
    detailsExpanded || planSteps.length === 0
      ? statusLabel
      : `${progressLabel} · ${completedSteps}/${planSteps.length}`;
  const showReadyBadge =
    detailsExpanded && props.runtime.status === "awaiting_approval";

  return (
    <div className="overflow-hidden border-b border-dls-border bg-transparent">
      <div className="flex items-center gap-2 border-b border-dls-border px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <DisclosureRowButton
            type="button"
            density="flush"
            className="min-w-0 justify-start gap-2 text-xs text-dls-secondary hover:bg-transparent hover:text-dls-text"
            onClick={() => setExpanded((current) => !current)}
          >
            <span className="truncate font-medium text-dls-secondary">
              {label}
            </span>
            {showReadyBadge ? (
              <StatusBadge tone="success" size="tiny">
                {t("session.plan_runtime_ready")}
              </StatusBadge>
            ) : null}
          </DisclosureRowButton>
        </div>
        {isCompleted || isBlocked ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" size="xs" onClick={props.onConfirm}>
              {t("session.plan_runtime_confirm")}
            </Button>
          </div>
        ) : isExecuting ? null : (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={props.onCancel}
              disabled={props.busy}
            >
              {t("session.plan_runtime_cancel")}
            </Button>
            <Button
              type="button"
              size="xs"
              onClick={props.onExecute}
              disabled={props.busy || isDrafting}
            >
              {t("session.plan_runtime_execute")}
            </Button>
          </div>
        )}
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => setExpanded((current) => !current)}
          aria-label={
            expanded
              ? t("session.plan_runtime_collapse")
              : t("session.plan_runtime_expand")
          }
        >
          <Minimize2
            size={12}
            className={`text-dls-secondary transition-transform ${expanded ? "" : "rotate-180"}`}
          />
        </Button>
      </div>
      {detailsExpanded ? (
        <div className="max-h-60 space-y-2.5 overflow-auto px-4 pb-3">
          {isDrafting ? (
            <div className="pt-2.5">
              <AssistantWaitingCard
                label={t("session.plan_runtime_drafting")}
                collapseLayout
              />
            </div>
          ) : planSteps.length > 0 ? (
            planSteps.map((step, index) => {
              const done = step.status === "completed";
              const active = step.status === "active";
              return (
                <div
                  key={step.id}
                  className="flex items-start gap-2.5 pt-2.5 first:pt-2.5"
                >
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <div
                      className={`flex size-4.5 items-center justify-center rounded-full border ${
                        done
                          ? sessionSurfaceStateClass.todoDone
                          : active
                            ? sessionSurfaceStateClass.todoActive
                            : "border-dls-border bg-dls-surface text-dls-secondary"
                      }`}
                    >
                      {done ? (
                        <Check size={12} />
                      ) : active ? (
                        <span
                          className={sessionSurfaceStateClass.todoActiveDot}
                        />
                      ) : null}
                    </div>
                  </div>
                  <div className="flex-1 text-sm leading-relaxed text-dls-text">
                    <span className="mr-1.5 text-dls-secondary">
                      {index + 1}.
                    </span>
                    {step.content}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="pt-2.5 text-sm leading-relaxed text-dls-secondary">
              {t("session.plan_runtime_empty")}
            </div>
          )}
          {!isDrafting && planDetails.length > 0 ? (
            <div className="space-y-2 border-t border-dls-border pt-3">
              {planDetails.map((section) => (
                <div key={section.kind} className="text-xs leading-5">
                  <div className="font-medium text-dls-secondary">
                    {section.title}
                  </div>
                  <div className="mt-1 space-y-1 text-dls-secondary">
                    {section.items.map((item) => (
                      <div key={`${section.kind}-${item}`} className="truncate">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const GOAL_RUNTIME_TICK_MS = 1000;

function buildLocaleRuntimeInstruction() {
  return t("session.runtime_language_requirement", currentLocale());
}

function buildGoalHiddenSystemPrompt(runtime: CollaborationGoalRuntime) {
  const details: string[] = [];
  if (runtime.summary?.trim()) {
    details.push(`${t("session.goal_hidden_summary_label")} ${runtime.summary.trim()}`);
  }
  if (runtime.currentCheckpoint?.trim()) {
    details.push(`${t("session.goal_hidden_checkpoint_label")} ${runtime.currentCheckpoint.trim()}`);
  }
  if (runtime.completionCriteria?.length) {
    details.push(
      `${t("session.goal_hidden_completion_criteria_label")}\n${runtime.completionCriteria
        .map((item) => `- ${item}`)
        .join("\n")}`,
    );
  }
  if (runtime.validationCommands?.length) {
    details.push(
      `${t("session.goal_hidden_validation_label")}\n${runtime.validationCommands
        .map((item) => `- ${item}`)
        .join("\n")}`,
    );
  }
  if (runtime.lastKnownTodos?.length) {
    details.push(
      `${t("session.goal_hidden_todos_label")}\n${runtime.lastKnownTodos
        .map((item) => `- [${item.status}] ${item.content}`)
        .join("\n")}`,
    );
  }
  if (runtime.progressLog?.length) {
    details.push(
      `${t("session.goal_hidden_progress_label")}\n${runtime.progressLog
        .map((item) => `- ${item}`)
        .join("\n")}`,
    );
  }
  return [
    buildLocaleRuntimeInstruction(),
    "",
    t("session.goal_hidden_continue"),
    "",
    t("session.goal_hidden_objective_label"),
    runtime.objective,
    details.length ? `\n${details.join("\n\n")}` : "",
    "",
    t("session.goal_hidden_success_criterion"),
    t("session.goal_hidden_next_step"),
    t("session.goal_hidden_continue_when_safe"),
    t("session.goal_hidden_track_progress"),
    t("session.goal_hidden_stall_recovery"),
    t("session.goal_hidden_blocker"),
  ].join("\n");
}

function buildPlanExecutionHiddenSystemPrompt(runtime: CollaborationPlanRuntime) {
  return [
    buildLocaleRuntimeInstruction(),
    "",
    t("session.plan_hidden_execute_now"),
    t("session.plan_hidden_approval_granted"),
    t("session.plan_hidden_use_tools"),
    "",
    t("session.plan_hidden_original_request_label"),
    runtime.originalPrompt,
    "",
    t("session.plan_hidden_approved_plan_label"),
    runtime.planText?.trim() || t("session.plan_runtime_empty"),
  ].join("\n");
}

function goalElapsedMs(runtime: CollaborationGoalRuntime, now: number) {
  if (runtime.status === "paused") {
    const pauseStartedAt = runtime.pauseStartedAt ?? runtime.updatedAt;
    return Math.max(
      0,
      pauseStartedAt - runtime.startedAt - runtime.totalPausedMs,
    );
  }
  if (runtime.status === "waiting") {
    if (runtime.waitingReason === "user") {
      const pauseStartedAt = runtime.pauseStartedAt ?? runtime.updatedAt;
      return Math.max(
        0,
        pauseStartedAt - runtime.startedAt - runtime.totalPausedMs,
      );
    }
    return Math.max(
      0,
      runtime.updatedAt - runtime.startedAt - runtime.totalPausedMs,
    );
  }
  const endAt = runtime.completedAt ?? now;
  return Math.max(0, endAt - runtime.startedAt - runtime.totalPausedMs);
}

function formatGoalElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const minuteText = String(minutes).padStart(2, "0");
  const secondText = String(seconds).padStart(2, "0");
  return hours > 0
    ? `${hours}:${minuteText}:${secondText}`
    : `${minutes}:${secondText}`;
}

function formatInterruptionElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function transcriptNoticeLabel(notice: SessionTranscriptNotice) {
  if (notice.kind === "stopped" && notice.elapsedMs !== undefined) {
    return t("session.user_stopped_after", {
      duration: formatInterruptionElapsed(notice.elapsedMs),
    });
  }
  if (notice.kind === "compacting") return t("session.assistant_compacting");
  if (notice.kind === "compacted") return t("session.assistant_compacted");
  if (notice.kind === "stalled") {
    return t("session.assistant_stalled_inline");
  }
  if (notice.kind === "permission-rejected") {
    return t("session.permission_rejected_notice");
  }
  if (notice.kind === "permission-auto-approved") {
    return t("session.permission_auto_approved_notice");
  }
  return t("session.user_cancelled");
}

function removeRecordKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

function normalizedTodoItems(todos: TodoItem[] | undefined) {
  return (todos ?? []).filter((todo) => todo.content.trim());
}

function goalCheckpointFromTodos(todos: TodoItem[]) {
  const active = todos.find((todo) => todo.status === "in_progress");
  if (active) return active.content.trim();
  const pending = todos.find((todo) => todo.status === "pending");
  if (pending) return pending.content.trim();
  const completed = [...todos]
    .reverse()
    .find((todo) => todo.status === "completed");
  return completed?.content.trim() ?? "";
}

function appendGoalProgressLog(
  runtime: CollaborationGoalRuntime,
  runText: string,
) {
  const trimmed = runText.replace(/\s+/g, " ").trim();
  if (!trimmed) return runtime.progressLog;
  const entry = trimmed.length > 400 ? `${trimmed.slice(0, 400).trimEnd()}...` : trimmed;
  const existing = runtime.progressLog ?? [];
  if (existing[existing.length - 1] === entry) return existing;
  return [...existing, entry].slice(-8);
}

function isGoalIntentRuntime(
  runtime: CollaborationGoalRuntime | null | undefined,
): runtime is CollaborationGoalRuntime {
  return runtime?.source === "goal_intent";
}

function GoalRuntimePanel(props: {
  runtime: CollaborationGoalRuntime;
  busy: boolean;
  canPause: boolean;
  canResume: boolean;
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const elapsed = formatGoalElapsed(goalElapsedMs(props.runtime, now));
  const objective = summarizeGoalObjective({
    objective: props.runtime.objective,
    summary: props.runtime.summary,
  });

  useEffect(() => {
    if (
      props.runtime.status === "paused" ||
      props.runtime.status === "completed" ||
      props.runtime.waitingReason === "user"
    ) {
      setNow(Date.now());
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), GOAL_RUNTIME_TICK_MS);
    return () => window.clearInterval(id);
  }, [props.runtime.status]);

  return (
    <div className="overflow-hidden border-b border-dls-border bg-transparent">
      <div className="flex items-center gap-3 px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <Goal
            size={14}
            strokeWidth={1.8}
            className="shrink-0 text-dls-secondary"
          />
          <span className="shrink-0 font-medium text-dls-text">
            {t("session.goal_runtime_active")}
          </span>
          <span
            className="min-w-0 truncate text-dls-secondary"
            title={objective}
          >
            {objective || t("session.goal_runtime_untitled")}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-dls-secondary">
            <Clock3 size={12} />
            {t("session.goal_runtime_elapsed", { duration: elapsed })}
          </span>
          {props.canResume ? (
            <Button
              type="button"
              size="icon-xs"
              onClick={props.onResume}
              disabled={props.busy}
              aria-label={t("session.goal_runtime_resume")}
              title={t("session.goal_runtime_resume")}
            >
              <Play size={14} />
            </Button>
          ) : null}
          {props.canPause ? (
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              onClick={props.onPause}
              aria-label={t("session.goal_runtime_pause")}
              title={t("session.goal_runtime_pause")}
            >
              <Pause size={14} />
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={props.onClear}
            aria-label={t("session.goal_runtime_clear")}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function PersonalAssistantHero() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 pb-6 pt-14 text-center">
      <img
        src={resolvePublicAssetUrl(ONMYAGENT_ASSISTANT_AVATAR)}
        alt=""
        className="size-36 rounded-xl object-cover"
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

function isUserCancelledError(error: SessionError) {
  return /\b(aborted|abort|cancelled|canceled)\b/i.test(error.message);
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
  if (isUserCancelledError(error)) {
    return (
      <div className="mx-auto max-w-3xl px-3 py-2 sm:px-5">
        <div className="text-sm text-dls-secondary">
          {t("session.user_cancelled")}
        </div>
      </div>
    );
  }

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
  const [dismissedPlanBySessionId, setDismissedPlanBySessionId] =
    useState<Record<string, boolean>>({});
  const [dismissedGoalBySessionId, setDismissedGoalBySessionId] =
    useState<Record<string, boolean>>({});
  const planDismissedForSession =
    dismissedPlanBySessionId[props.sessionId] === true;
  const goalDismissedForSession =
    dismissedGoalBySessionId[props.sessionId] === true;
  const [officeCollaborationMode, setOfficeCollaborationMode] =
    useState<ComposerCollaborationMode>({
      kind: "craft",
      planning: false,
      pursueGoal: true,
    });
  const effectiveAccessMode = props.sessionAccessMode ?? accessMode;
  const baseCollaborationMode =
    assistantOfficeFeaturesActive && assistantFeatureCategoryId === "office"
      ? officeCollaborationMode
      : collaborationMode;
  const effectiveCollaborationMode =
    props.sessionCollaborationMode ?? baseCollaborationMode;
  const updateAccessMode = useCallback(
    (nextMode: ComposerAccessMode) => {
      setAccessMode(nextMode);
      props.onSessionAccessModeChange?.(nextMode);
    },
    [props.onSessionAccessModeChange],
  );
  const updateCollaborationMode = useCallback(
    (nextMode: ComposerCollaborationMode) => {
      if (assistantOfficeFeaturesActive && assistantFeatureCategoryId === "office") {
        setOfficeCollaborationMode(nextMode);
      } else {
        setCollaborationMode(nextMode);
      }
      props.onSessionCollaborationModeChange?.(nextMode);
    },
    [
      assistantFeatureCategoryId,
      assistantOfficeFeaturesActive,
      props.onSessionCollaborationModeChange,
    ],
  );
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
  const [compactBoundaryBySessionId, setCompactBoundaryBySessionId] =
    useState<Record<string, number>>({});
  const [transcriptNoticesBySessionId, setTranscriptNoticesBySessionId] =
    useState<Record<string, SessionTranscriptNotice[]>>({});
  const [stallRecoveryBySessionId, setStallRecoveryBySessionId] =
    useState<Record<string, boolean>>({});
  const [activeRunStartedAt, setActiveRunStartedAt] = useState<number | null>(null);
  const compactWasActiveRef = useRef<Record<string, boolean>>({});
  const autoApprovedPermissionNoticeRef = useRef<Record<string, string>>({});
  const compactBoundary = compactBoundaryBySessionId[props.sessionId] ?? null;

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
    setActiveRunStartedAt(null);
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
  const rawRenderedMessages = useMemo(
    () => deriveRenderedSessionMessages({ transcriptState, snapshot }),
    [snapshot, transcriptState],
  );
  const renderedMessages = useMemo(
    () => filterCompactionMessages(rawRenderedMessages, compactBoundary),
    [compactBoundary, rawRenderedMessages],
  );
  const appendTranscriptNotice = useCallback(
    (notice: SessionTranscriptNotice) => {
      setTranscriptNoticesBySessionId((current) => {
        const existing = current[props.sessionId] ?? [];
        return {
          ...current,
          [props.sessionId]: [...existing, notice].slice(
            -MAX_TRANSCRIPT_NOTICES_PER_SESSION,
          ),
        };
      });
    },
    [props.sessionId],
  );
  const updateLatestTranscriptNotice = useCallback(
    (
      predicate: (notice: SessionTranscriptNotice) => boolean,
      update: (notice: SessionTranscriptNotice) => SessionTranscriptNotice,
    ) => {
      setTranscriptNoticesBySessionId((current) => {
        const existing = current[props.sessionId] ?? [];
        let targetIndex = -1;
        for (let index = existing.length - 1; index >= 0; index -= 1) {
          const notice = existing[index];
          if (notice && predicate(notice)) {
            targetIndex = index;
            break;
          }
        }
        if (targetIndex < 0) return current;
        const next = [...existing];
        const target = next[targetIndex];
        if (!target) return current;
        next[targetIndex] = update(target);
        return { ...current, [props.sessionId]: next };
      });
    },
    [props.sessionId],
  );
  useEffect(() => {
    const noticeId = props.autoApprovedPermissionNoticeId?.trim();
    if (!noticeId) return;
    if (autoApprovedPermissionNoticeRef.current[props.sessionId] === noticeId) {
      return;
    }
    autoApprovedPermissionNoticeRef.current = {
      ...autoApprovedPermissionNoticeRef.current,
      [props.sessionId]: noticeId,
    };
    appendTranscriptNotice({
      id: `${props.sessionId}:permission-auto-approved:${noticeId}`,
      kind: "permission-auto-approved",
      afterMessageCount: renderedMessages.length,
    });
  }, [
    appendTranscriptNotice,
    props.autoApprovedPermissionNoticeId,
    props.sessionId,
    renderedMessages.length,
  ]);
  useEffect(() => {
    const compacting = sessionActivityStatus === "compacting";
    const wasCompacting = compactWasActiveRef.current[props.sessionId] === true;
    if (compacting) {
      if (!wasCompacting) {
        setCompactBoundaryBySessionId((current) => ({
          ...current,
          [props.sessionId]: rawRenderedMessages.length,
        }));
        appendTranscriptNotice({
          id: `${props.sessionId}:compacting:${renderedMessages.length}:${Date.now()}`,
          kind: "compacting",
          afterMessageCount: renderedMessages.length,
        });
      }
      compactWasActiveRef.current = {
        ...compactWasActiveRef.current,
        [props.sessionId]: true,
      };
      return;
    }
    if (wasCompacting) {
      compactWasActiveRef.current = {
        ...compactWasActiveRef.current,
        [props.sessionId]: false,
      };
      updateLatestTranscriptNotice(
        (notice) => notice.kind === "compacting",
        (notice) => ({ ...notice, kind: "compacted" }),
      );
    }
  }, [
    appendTranscriptNotice,
    props.sessionId,
    rawRenderedMessages.length,
    renderedMessages.length,
    sessionActivityStatus,
    updateLatestTranscriptNotice,
  ]);
  useEffect(() => {
    const runtime = props.planRuntime;
    if (!runtime || runtime.status !== "drafting" || chatStreaming) return;
    const planText = planTextFromMessages(
      renderedMessages.slice(runtime.messageBaseline),
    );
    if (!planText) return;
    props.onPlanRuntimeChange?.({
      ...runtime,
      status: "awaiting_approval",
      planText,
    });
  }, [
    chatStreaming,
    props.onPlanRuntimeChange,
    props.planRuntime,
    renderedMessages,
  ]);
  useEffect(() => {
    const runtime = props.goalRuntime;
    if (
      !isGoalIntentRuntime(runtime) ||
      runtime.status !== "running" ||
      chatStreaming
    ) {
      return;
    }
    const baseline = runtime.lastRunMessageBaseline ?? runtime.messageBaseline;
    const runText = planTextFromMessages(renderedMessages.slice(baseline));
    if (!runText) return;
    const lastKnownTodos = normalizedTodoItems(props.todos);
    const currentCheckpoint = goalCheckpointFromTodos(lastKnownTodos);
    const progressLog = appendGoalProgressLog(runtime, runText);
    const todosCompleted =
      lastKnownTodos.length > 0 &&
      lastKnownTodos.every((todo) => todo.status === "completed");
    const now = Date.now();
    props.onGoalRuntimeChange?.({
      ...runtime,
      status: todosCompleted ? "completed" : "waiting",
      waitingReason: todosCompleted ? undefined : "idle",
      updatedAt: now,
      completedAt: todosCompleted ? now : runtime.completedAt,
      ...(currentCheckpoint ? { currentCheckpoint } : {}),
      ...(progressLog?.length ? { progressLog } : {}),
      ...(lastKnownTodos.length ? { lastKnownTodos } : {}),
    });
  }, [
    chatStreaming,
    props.goalRuntime,
    props.onGoalRuntimeChange,
    props.todos,
    renderedMessages,
  ]);
  useEffect(() => {
    const runtime = props.planRuntime;
    if (!runtime || runtime.status !== "executing" || chatStreaming) return;
    const executionBaseline = runtime.executionBaseline ?? runtime.messageBaseline;
    const executionText = planTextFromMessages(
      renderedMessages.slice(executionBaseline),
    );
    if (!executionText) return;
    props.onPlanRuntimeChange?.({
      ...runtime,
      status: "completed",
    });
  }, [
    chatStreaming,
    props.onPlanRuntimeChange,
    props.planRuntime,
    renderedMessages,
  ]);
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
  const activityFingerprint = useMemo(
    () => messageActivityFingerprint(renderedMessages),
    [renderedMessages],
  );
  const [activityPulseAt, setActivityPulseAt] = useState(Date.now());
  const [activityNow, setActivityNow] = useState(Date.now());
  useEffect(() => {
    const now = Date.now();
    setActivityPulseAt(now);
    setActivityNow(now);
  }, [
    activityFingerprint,
    effectiveActivityStatus,
    liveStatus.type,
    props.sessionId,
  ]);
  const activityVisible =
    chatStreaming || effectiveActivityStatus !== "idle";
  useEffect(() => {
    if (!activityVisible) return;
    const id = window.setInterval(() => setActivityNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [activityVisible]);
  const showStalledActivityNotice =
    activityVisible &&
    effectiveActivityStatus !== "compacting" &&
    activityNow - activityPulseAt >= ASSISTANT_STALL_NOTICE_MS;
  const shouldInjectStallRecovery =
    activityVisible &&
    effectiveActivityStatus !== "compacting" &&
    activityNow - activityPulseAt >= ASSISTANT_RECOVERY_HINT_MS;
  const visibleError = [
    error,
    sessionActivityError ? { message: sessionActivityError } : null,
    snapshotSessionError,
  ].find((item) => item && item.message !== dismissedErrorMessage) ?? null;
  const cancelledError =
    visibleError && isUserCancelledError(visibleError) ? visibleError : null;
  const visibleTranscriptError = cancelledError ? null : visibleError;
  useEffect(() => {
    if (!shouldInjectStallRecovery) return;
    setStallRecoveryBySessionId((current) => {
      if (current[props.sessionId]) return current;
      return { ...current, [props.sessionId]: true };
    });
  }, [props.sessionId, shouldInjectStallRecovery]);
  const interruptionDividers = useMemo<SessionTranscriptDivider[]>(() => {
    const notices = transcriptNoticesBySessionId[props.sessionId] ?? [];
    return notices.map((notice) => ({
      id: notice.id,
      afterMessageCount: notice.afterMessageCount,
      label: transcriptNoticeLabel(notice),
    }));
  }, [props.sessionId, transcriptNoticesBySessionId]);
  const hasTranscriptContent =
    renderedMessages.length > 0 || interruptionDividers.length > 0;
  const showNoVisibleAssistantOutput =
    noVisibleAssistantOutputBaseline !== null &&
    !assistantOutputAfterNoVisibleFallback;
  const showInlineActivityIndicator =
    hasTranscriptContent &&
    activityVisible &&
    effectiveActivityStatus !== "compacting" &&
    !visibleTranscriptError;
  const reserveAssistantStatusSpace =
    effectiveActivityStatus === "idle" &&
    awaitingAssistantBaseline !== null &&
    assistantOutputAfterAwaitStart &&
    !chatStreaming;
  const assistantStatusFooter =
    showInlineActivityIndicator ? (
      <AssistantWaitingCard collapseLayout />
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
    setActiveRunStartedAt(null);
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
    }, 1000);
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
      return {
        mode: "prompt",
        parts,
        attachments: nextAttachments,
        accessMode: effectiveAccessMode,
        collaborationMode: effectiveCollaborationMode,
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
    [assistantFeatureCategoryId, assistantOfficeFeaturesActive, effectiveAccessMode, effectiveCollaborationMode, mentions, pasteParts],
  );

  const handleComposerDraftChange = useCallback(
    (value: string) => {
      setComposerDraft(props.sessionId, value);
    },
    [props.sessionId, setComposerDraft],
  );

  const recordSessionInterruption = useCallback(
    (kind: "cancelled" | "stopped") => {
      const now = Date.now();
      const afterMessageCount = renderedMessages.length;
      const runStartedAt =
        activeRunStartedAt ?? props.goalRuntime?.lastRunStartedAt ?? now;
      const notice: SessionTranscriptNotice = {
        id: `${props.sessionId}:${kind}:${afterMessageCount}:${now}`,
        kind,
        afterMessageCount,
        elapsedMs:
          kind === "stopped" ? Math.max(0, now - runStartedAt) : undefined,
      };

      setTranscriptNoticesBySessionId((current) => {
        const existing = current[props.sessionId] ?? [];
        const alreadyRecorded = existing.some(
          (item) =>
            item.afterMessageCount === afterMessageCount &&
            (item.kind === kind ||
              (kind === "cancelled" && item.kind === "stopped")),
        );
        if (alreadyRecorded) return current;
        return {
          ...current,
          [props.sessionId]: [...existing, notice].slice(
            -MAX_TRANSCRIPT_NOTICES_PER_SESSION,
          ),
        };
      });
    },
    [
      activeRunStartedAt,
      props.goalRuntime?.lastRunStartedAt,
      props.sessionId,
      renderedMessages.length,
    ],
  );

  useEffect(() => {
    if (!cancelledError) return;
    recordSessionInterruption("cancelled");
  }, [cancelledError?.message, recordSessionInterruption]);

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
    setDismissedPlanBySessionId((current) =>
      removeRecordKey(current, props.sessionId),
    );
    setDismissedGoalBySessionId((current) =>
      removeRecordKey(current, props.sessionId),
    );
    setError(null);
    setDismissedErrorMessage(null);
    if (!props.draftOnly) {
      useSessionActivityStore
        .getState()
        .setRunStatus(props.workspaceId, props.sessionId, { type: "busy" });
    }
    setSending(true);
    const startedAt = Date.now();
    setActiveRunStartedAt(startedAt);
    setAwaitingAssistantBaseline(renderedMessages.length);
    setNoVisibleAssistantOutputBaseline(null);
    try {
      const nextDraft = buildDraft(text, attachments);
      if (stallRecoveryBySessionId[props.sessionId]) {
        nextDraft.hiddenSystemPrompt = [
          nextDraft.hiddenSystemPrompt,
          t("session.stall_recovery_hidden"),
        ]
          .filter(Boolean)
          .join("\n\n");
        setStallRecoveryBySessionId((current) =>
          removeRecordKey(current, props.sessionId),
        );
      }
      const goalMode =
        resolveSessionCollaborationKind(
          effectiveCollaborationMode,
          assistantFeatureCategoryId,
        ) === "goal";
      if (
        effectiveCollaborationMode.kind === "plan" ||
        effectiveCollaborationMode.planning
      ) {
        nextDraft.planningIntent = {
          originalPrompt: text,
          messageBaseline: renderedMessages.length,
        };
      }
      const currentGoalRuntime = isGoalIntentRuntime(props.goalRuntime)
        ? props.goalRuntime
        : null;
      if (goalMode && !currentGoalRuntime) {
        nextDraft.goalIntent = {
          objective: nextDraft.resolvedText ?? text,
          messageBaseline: renderedMessages.length,
        };
      } else if (goalMode && currentGoalRuntime) {
        const runtimeWithSummary = currentGoalRuntime.summary
          ? currentGoalRuntime
          : {
              ...currentGoalRuntime,
              summary: deriveGoalSummary(currentGoalRuntime.objective),
            };
        nextDraft.hiddenSystemPrompt = buildGoalHiddenSystemPrompt(runtimeWithSummary);
        props.onGoalRuntimeChange?.({
          ...runtimeWithSummary,
          status: "running",
          waitingReason: undefined,
          updatedAt: startedAt,
          lastRunStartedAt: startedAt,
          lastRunMessageBaseline: renderedMessages.length,
          completedAt: undefined,
        });
      }
      await props.onSendDraft(nextDraft);
      attachments.forEach(revokeAttachmentPreview);
      clearComposerSession(props.sessionId);
      props.onDraftChange(buildDraft("", []));
      setSending(false);
    } catch (nextError) {
      const parsed = parseSessionError(nextError);
      if (isUserCancelledError(parsed)) {
        recordSessionInterruption("cancelled");
      }
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
    effectiveCollaborationMode.kind,
    effectiveCollaborationMode.planning,
    effectiveCollaborationMode.pursueGoal,
    props.onDraftChange,
    props.onGoalRuntimeChange,
    props.onSendDraft,
    props.draftOnly,
    props.draftWorkspaceDirectory,
    props.goalRuntime,
    props.sessionId,
    props.workspaceId,
    recordSessionInterruption,
    renderedMessages.length,
    setComposerDraft,
    stallRecoveryBySessionId,
  ]);

  const executeApprovedPlan = useCallback(async () => {
    const runtime = props.planRuntime;
    if (!runtime || runtime.status !== "awaiting_approval") return;
    const executionMode: ComposerCollaborationMode = {
      kind: "craft",
      planning: false,
      pursueGoal: effectiveCollaborationMode.pursueGoal,
    };
    const executionSystemPrompt = buildPlanExecutionHiddenSystemPrompt(runtime);
    const executionPrompt = t("session.plan_runtime_execute");

    setError(null);
    setDismissedErrorMessage(null);
    if (!props.draftOnly) {
      useSessionActivityStore
        .getState()
        .setRunStatus(props.workspaceId, props.sessionId, { type: "busy" });
    }
    setSending(true);
    setActiveRunStartedAt(Date.now());
    setAwaitingAssistantBaseline(renderedMessages.length);
    setNoVisibleAssistantOutputBaseline(null);
    updateCollaborationMode(executionMode);
    props.onPlanRuntimeChange?.({
      ...runtime,
      status: "executing",
      approvedAt: Date.now(),
      executionBaseline: renderedMessages.length,
    });
    try {
      await props.onSendDraft({
        ...buildDraft(executionPrompt, []),
        collaborationMode: executionMode,
        hiddenSystemPrompt: executionSystemPrompt,
      });
      props.onDraftChange(buildDraft("", []));
      setSending(false);
    } catch (nextError) {
      const parsed = parseSessionError(nextError);
      if (isUserCancelledError(parsed)) {
        recordSessionInterruption("cancelled");
      }
      setError(parsed);
      setDismissedErrorMessage(null);
      if (!props.draftOnly) {
        useSessionActivityStore
          .getState()
          .setError(props.workspaceId, props.sessionId, parsed.message);
      }
      props.onPlanRuntimeChange?.(runtime);
      setAwaitingAssistantBaseline(null);
      setNoVisibleAssistantOutputBaseline(null);
      setSending(false);
    }
  }, [
    buildDraft,
    effectiveCollaborationMode.pursueGoal,
    props.draftOnly,
    props.onDraftChange,
    props.onPlanRuntimeChange,
    props.onSendDraft,
    props.planRuntime,
    props.sessionId,
    props.workspaceId,
    recordSessionInterruption,
    renderedMessages.length,
    updateCollaborationMode,
  ]);

  const resumeGoalRuntime = useCallback(async () => {
    const runtime = isGoalIntentRuntime(props.goalRuntime)
      ? props.goalRuntime
      : null;
    if (!runtime || runtime.status === "running" || runtime.status === "completed") return;
    const now = Date.now();
    const totalPausedMs =
      runtime.status === "paused" && runtime.pauseStartedAt
        ? runtime.totalPausedMs + Math.max(0, now - runtime.pauseStartedAt)
        : runtime.totalPausedMs;
    const goalMode: ComposerCollaborationMode = {
      planning: false,
      pursueGoal: true,
    };
    const nextRuntime: CollaborationGoalRuntime = {
      ...runtime,
      summary: runtime.summary || deriveGoalSummary(runtime.objective),
      status: "running",
      waitingReason: undefined,
      updatedAt: now,
      totalPausedMs,
      pauseStartedAt: undefined,
      lastRunStartedAt: now,
      lastRunMessageBaseline: renderedMessages.length,
      completedAt: undefined,
      lastKnownTodos: (props.todos ?? []).filter((todo) => todo.content.trim()),
    };

    setError(null);
    setDismissedErrorMessage(null);
    if (!props.draftOnly) {
      useSessionActivityStore
        .getState()
        .setRunStatus(props.workspaceId, props.sessionId, { type: "busy" });
    }
    setSending(true);
    setActiveRunStartedAt(now);
    setAwaitingAssistantBaseline(renderedMessages.length);
    setNoVisibleAssistantOutputBaseline(null);
    updateCollaborationMode(goalMode);
    props.onGoalRuntimeChange?.(nextRuntime);
    try {
      await props.onSendDraft({
        ...buildDraft(t("session.goal_runtime_continue_prompt"), []),
        collaborationMode: goalMode,
        hiddenSystemPrompt: buildGoalHiddenSystemPrompt(nextRuntime),
      });
      props.onDraftChange(buildDraft("", []));
      setSending(false);
    } catch (nextError) {
      const parsed = parseSessionError(nextError);
      if (isUserCancelledError(parsed)) {
        recordSessionInterruption("cancelled");
      }
      setError(parsed);
      setDismissedErrorMessage(null);
      if (!props.draftOnly) {
        useSessionActivityStore
          .getState()
          .setError(props.workspaceId, props.sessionId, parsed.message);
      }
      props.onGoalRuntimeChange?.(runtime);
      setAwaitingAssistantBaseline(null);
      setNoVisibleAssistantOutputBaseline(null);
      setSending(false);
    }
  }, [
    buildDraft,
    props.draftOnly,
    props.goalRuntime,
    props.onDraftChange,
    props.onGoalRuntimeChange,
    props.onSendDraft,
    props.sessionId,
    props.todos,
    props.workspaceId,
    recordSessionInterruption,
    renderedMessages.length,
    updateCollaborationMode,
  ]);

  const stopActiveRun = useCallback(async () => {
    setError(null);
    setDismissedErrorMessage(null);
    setSending(false);
    setAwaitingAssistantBaseline(null);
    setNoVisibleAssistantOutputBaseline(null);
    if (!props.draftOnly) {
      useSessionActivityStore
        .getState()
        .setRunStatus(props.workspaceId, props.sessionId, { type: "idle" });
    }
    await abortSessionSafe(opencodeClient, props.sessionId);
    await snapshotQuery.refetch();
  }, [
    opencodeClient,
    props.draftOnly,
    props.sessionId,
    props.workspaceId,
    snapshotQuery.refetch,
  ]);

  const pauseGoalRuntime = useCallback(async () => {
    const runtime = isGoalIntentRuntime(props.goalRuntime)
      ? props.goalRuntime
      : null;
    if (
      runtime &&
      (runtime.status === "running" || runtime.status === "waiting")
    ) {
      const now = Date.now();
      recordSessionInterruption("stopped");
      props.onGoalRuntimeChange?.({
        ...runtime,
        status: "paused",
        waitingReason: "user",
        updatedAt: now,
        pauseStartedAt: now,
      });
    }
    await stopActiveRun();
  }, [props.goalRuntime, props.onGoalRuntimeChange, recordSessionInterruption, stopActiveRun]);

  const handleAbort = useCallback(async () => {
    if (!chatStreaming) return;
    if (isGoalIntentRuntime(props.goalRuntime)) {
      await pauseGoalRuntime();
      return;
    }
    if (
      props.planRuntime &&
      (props.planRuntime.status === "executing" ||
        props.planRuntime.status === "drafting")
    ) {
      props.onPlanRuntimeChange?.({
        ...props.planRuntime,
        status: "blocked",
        blockedReason: "cancelled",
      });
    }
    recordSessionInterruption("stopped");
    await stopActiveRun();
  }, [
    chatStreaming,
    pauseGoalRuntime,
    props.goalRuntime,
    props.onPlanRuntimeChange,
    props.planRuntime,
    recordSessionInterruption,
    stopActiveRun,
  ]);

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
      setActiveRunStartedAt(null);
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
    if (!text) return;
    const separator = draft && !draft.endsWith("\n") ? "\n" : "";
    setComposerDraft(props.sessionId, `${draft}${separator}${text}`);
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
    !visibleTranscriptError &&
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
  const draftWorkspaceAccessoryActive =
    Boolean(props.personalAssistantHome || props.assistantFeatureCategoryId) &&
    Boolean(props.draftOnly);

  const [lastTodosBySessionId, setLastTodosBySessionId] =
    useState<Record<string, TodoItem[]>>({});
  const incomingTodos = props.todos ?? [];
  const incomingHasTodos = incomingTodos.some((todo) => todo.content.trim());
  useEffect(() => {
    if (!incomingHasTodos) return;
    setLastTodosBySessionId((current) => ({
      ...current,
      [props.sessionId]: incomingTodos,
    }));
  }, [incomingHasTodos, incomingTodos, props.sessionId]);

  const visiblePlanRuntime = planDismissedForSession
    ? null
    : props.planRuntime ?? null;
  const visibleGoalRuntime = shouldShowGoalRuntime({
    mode: effectiveCollaborationMode,
    categoryId: assistantFeatureCategoryId,
    goalRuntime: props.goalRuntime ?? null,
    dismissed: goalDismissedForSession,
  }) && isGoalIntentRuntime(props.goalRuntime)
    ? props.goalRuntime
    : null;
  const activeGoalWaitingReason: CollaborationGoalRuntime["waitingReason"] | null =
    effectiveAccessMode !== "full" && props.activePermission
      ? "permission"
      : props.activeQuestion
        ? "question"
        : effectiveActivityStatus === "compacting"
          ? "compacting"
          : null;
  const visibleGoalRuntimeForUi =
    visibleGoalRuntime &&
    activeGoalWaitingReason &&
    visibleGoalRuntime.status !== "paused" &&
    visibleGoalRuntime.status !== "completed"
      ? {
          ...visibleGoalRuntime,
          status: "waiting" as const,
          waitingReason: activeGoalWaitingReason,
        }
      : visibleGoalRuntime;
  const visibleTodos = incomingHasTodos
    ? incomingTodos
    : lastTodosBySessionId[props.sessionId] ?? incomingTodos;
  const hasVisibleTodos = visibleTodos.some((todo) => todo.content.trim());
  const runPolicy = resolveSessionRunPolicy({
    accessMode: effectiveAccessMode,
    collaborationMode: effectiveCollaborationMode,
    categoryId: assistantFeatureCategoryId,
    activityStatus: effectiveActivityStatus,
    assistantActive: activityVisible,
    hasActivePermission:
      effectiveAccessMode !== "full" && Boolean(props.activePermission),
    hasActiveQuestion: Boolean(props.activeQuestion),
    planRuntime: visiblePlanRuntime,
    goalRuntime: visibleGoalRuntimeForUi,
    stalled: showStalledActivityNotice,
  });
  const respondPermissionWithTranscriptNotice = (
    requestID: string,
    reply: "reject" | "once" | "always",
  ) => {
    if (reply === "reject") {
      const now = Date.now();
      appendTranscriptNotice({
        id: `${props.sessionId}:permission-rejected:${renderedMessages.length}:${now}`,
        kind: "permission-rejected",
        afterMessageCount: renderedMessages.length,
      });
      if (
        visibleGoalRuntime &&
        visibleGoalRuntime.status !== "paused" &&
        visibleGoalRuntime.status !== "completed"
      ) {
        props.onGoalRuntimeChange?.({
          ...visibleGoalRuntime,
          status: "paused",
          waitingReason: "permission",
          updatedAt: now,
          pauseStartedAt: now,
        });
      }
      if (
        visiblePlanRuntime &&
        (visiblePlanRuntime.status === "executing" ||
          visiblePlanRuntime.status === "drafting")
      ) {
        props.onPlanRuntimeChange?.({
          ...visiblePlanRuntime,
          status: "blocked",
          blockedReason: "permission_rejected",
        });
      }
    }
    props.respondPermission?.(requestID, reply);
  };
  const planOrTodoAccessory = visiblePlanRuntime ? (
    <PlanApprovalPanel
      runtime={visiblePlanRuntime}
      todos={visibleTodos}
      busy={sending || chatStreaming}
      onExecute={executeApprovedPlan}
      onCancel={() => {
        setDismissedPlanBySessionId((current) => ({
          ...current,
          [props.sessionId]: true,
        }));
        props.onPlanRuntimeChange?.(null);
      }}
      onConfirm={() => {
        setDismissedPlanBySessionId((current) => ({
          ...current,
          [props.sessionId]: true,
        }));
        props.onPlanRuntimeChange?.(null);
      }}
    />
  ) : hasVisibleTodos ? (
    <TodoPanel todos={visibleTodos} />
  ) : null;
  const goalAccessory = visibleGoalRuntimeForUi ? (
    <GoalRuntimePanel
      runtime={visibleGoalRuntimeForUi}
      busy={sending || chatStreaming}
      canPause={runPolicy.canPauseGoal}
      canResume={runPolicy.canResumeGoal}
      onPause={() => {
        if (visibleGoalRuntimeForUi.status === "paused") return;
        void pauseGoalRuntime();
      }}
      onResume={resumeGoalRuntime}
      onClear={() => {
        setDismissedGoalBySessionId((current) => ({
          ...current,
          [props.sessionId]: true,
        }));
        setDismissedPlanBySessionId((current) => ({
          ...current,
          [props.sessionId]: true,
        }));
        setLastTodosBySessionId((current) =>
          removeRecordKey(current, props.sessionId),
        );
        props.onClearSessionProgress?.();
        props.onGoalRuntimeChange?.(null);
        props.onPlanRuntimeChange?.(null);
        void stopActiveRun();
      }}
    />
  ) : null;
  const questionAccessory = props.activeQuestion ? (
    <QuestionPanel
      questions={props.activeQuestion.questions}
      busy={props.questionReplyBusy ?? false}
      onReply={(answers) => {
        if (props.activeQuestion) {
          props.respondQuestion?.(props.activeQuestion.id, answers);
        }
      }}
    />
  ) : null;
  const permissionAccessory =
    props.activePermission && effectiveAccessMode !== "full" ? (
      <PermissionApprovalPanel
        permission={props.activePermission}
        busy={props.permissionReplyBusy}
        respondPermission={respondPermissionWithTranscriptNotice}
        safeStringify={props.safeStringify}
      />
    ) : null;
  const sessionComposerAccessory =
    planOrTodoAccessory ||
    goalAccessory ||
    questionAccessory ||
    permissionAccessory ? (
      <div>
        {permissionAccessory}
        {questionAccessory}
        {planOrTodoAccessory}
        {goalAccessory}
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
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-dls-mist bg-dls-surface px-5">
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
                  <div className="mx-auto max-w-sm rounded-xl border border-dls-border bg-dls-surface-muted px-8 py-10 text-center">
                    <div className={sessionSurfaceTextClass.openingSession}>
                      Opening session…
                    </div>
                  </div>
                </div>
              ) : (snapshotQuery.isError || visibleTranscriptError) &&
                !snapshot &&
                !hasTranscriptContent ? (
                <div className="px-6 py-8">
                  {visibleTranscriptError ? (
                    <SessionErrorCard
                      error={visibleTranscriptError}
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
              ) : !hasTranscriptContent &&
                effectiveActivityStatus !== "idle" &&
                !visibleTranscriptError ? (
                <div className="px-6 py-12">
                  <AssistantWaitingCard
                    label={getSessionActivityStatusLabel(
                      effectiveActivityStatus,
                    )}
                  />
                </div>
              ) : !hasTranscriptContent &&
                (props.draftOnly ||
                  (snapshot && snapshot.messages.length === 0)) ? (
                visibleTranscriptError ? (
                  <SessionErrorCard
                    error={visibleTranscriptError}
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
                      quickPrompts={effectiveAgent.quickPrompts}
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
                      dividers={interruptionDividers}
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
                    {visibleTranscriptError ? (
                      <SessionErrorCard
                        error={visibleTranscriptError}
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
              <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-dls-border bg-dls-surface p-1 backdrop-blur-md">
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
              accessMode={effectiveAccessMode}
              onAccessModeChange={updateAccessMode}
              collaborationMode={effectiveCollaborationMode}
              onCollaborationModeChange={updateCollaborationMode}
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
              onOpenSkillsMarketplace={props.onOpenSkillsMarketplace}
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
              hideAccessPermissionSelect={draftWorkspaceAccessoryActive}
              bottomAccessory={
                draftWorkspaceAccessoryActive ? (
                  <div className="inline-flex min-h-8 items-center gap-1 text-xs font-medium">
                    <div className="relative inline-flex h-6 items-center gap-1">
                      {showFolderRequiredBubble ? (
                        <div className="absolute bottom-full left-0 z-20 mb-2 w-56 rounded-lg border border-dls-accent/30 bg-dls-surface px-3 py-2 text-xs leading-5 text-dls-text">
                          <div className="font-medium text-dls-accent">
                            {t("session.choose_folder_required_title")}
                          </div>
                          <div className="mt-0.5 text-dls-secondary">
                            {t("session.choose_folder_required_desc")}
                          </div>
                          <div className="absolute -bottom-1 left-5 size-2 rotate-45 border-b border-r border-dls-accent/30 bg-dls-surface" />
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
                              ? "animate-pulse bg-dls-accent/10 text-dls-accent hover:bg-dls-accent/10 hover:text-dls-accent"
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
                    <AccessPermissionSelect
                      value={effectiveAccessMode}
                      onChange={updateAccessMode}
                    />
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
