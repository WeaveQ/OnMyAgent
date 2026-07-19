import { t } from "@/i18n";
import {
  type PersonalLocalAgent,
  type PersonalLocalAgentProcessRecord,
  type PersonalLocalAgentProvider,
  type PersonalLocalAgentRunResult,
} from "../../../../app/lib/desktop";
import { isPersonalLocalAgentProvider, PROVIDER_LABELS } from "../local-agent-page-model";
import {
  classifiedRunFailureMessage,
  runTimelineAlreadyShowsFailure,
} from "../messages/message-utils";
import type { ChatMessage } from "../messages/message-types";

export const localAgentTextClass = {
  panelTitle: "text-sm font-medium leading-5 text-dls-text",
  rowTitle: "min-w-0 flex-1 truncate text-sm font-medium leading-5",
  pageTitle: "truncate text-base font-medium leading-6 text-dls-text",
  debugMeta: "font-mono text-xs text-dls-secondary",
  runSectionTitle: "mb-2 flex items-center gap-2 font-medium",
  runItemTitle: "flex min-w-0 items-center gap-1.5 font-medium",
  approvalTitle: "text-xs font-medium",
  artifactTitle: "mb-2 flex items-center gap-1.5 text-xs font-medium text-dls-status-success-fg",
};

export const localAgentLayoutClass = {
  refreshIcon: "mr-1.5 size-3.5",
  agentRow: "flex h-[68px] w-full items-center gap-3 px-4 text-left transition-colors",
  // Avatar plate lives in AgentBrandIcon (dark: white). Status dot still shared.
  agentStatusDot: "absolute -right-0.5 bottom-0 size-2.5 rounded-full border-2",
  // Header / composer sit on the main canvas as lifted surface strips.
  header: "shrink-0 border-b border-dls-border bg-dls-surface mac:titlebar-drag",
  pageContent: "mx-auto flex w-full min-w-0 max-w-[1120px] flex-col gap-5",
  chatPanel: "mx-auto w-full min-w-0 max-w-[1120px] rounded-xl border border-dls-border bg-dls-surface p-2",
  chatMessage: "max-w-[min(86%,100%)] min-w-0 rounded-xl border border-dls-border px-4 py-3 text-sm leading-6",
  userChatMessage: "max-w-[min(86%,100%)] min-w-0 rounded-xl border border-dls-border bg-dls-chat-user-bg px-4 py-3 text-sm leading-6 text-dls-text",
  assistantChatMessage: "max-w-[min(86%,100%)] min-w-0 rounded-xl border border-dls-border bg-dls-surface-muted px-4 py-3 text-sm leading-6 text-dls-chat-agent-text",
  artifactPanel: "rounded-xl border border-dls-border bg-dls-surface-muted px-3 py-2",
  artifactButton: "min-w-0 max-w-[260px] justify-start rounded-none text-dls-status-success-fg hover:bg-dls-status-success-soft",
  artifactIconButton: "shrink-0 rounded-none text-dls-status-success-fg hover:bg-dls-status-success-soft",
};

export const activeRunClass = {
  overview: "p-1 text-xs text-dls-text",
  item: "flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors",
  itemSelected: "border-dls-accent/35 bg-dls-surface",
  itemDefault: "border-dls-accent/15 bg-dls-surface/70 hover:bg-dls-surface",
  runId: "font-mono text-xs text-dls-accent",
  meta: "mt-1 flex flex-wrap gap-2 text-xs text-dls-secondary",
  cancel: "h-7 shrink-0 border-dls-accent/30 bg-dls-surface text-xs text-dls-text hover:bg-dls-accent/10",
};

export function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function agentSubtitle(agent: PersonalLocalAgent) {
  if (agent.status !== "online") return agent.error || t("common.unavailable");
  // Prefer friendly status over protocol chrome ("OpenCode ACP session · /Users/...").
  const version = String(agent.version ?? "").trim();
  if (version) return version;
  const mode = String(agent.connectionMode ?? "").trim();
  // Strip raw path tails; keep a short connection label.
  if (mode && !mode.includes("/") && !mode.includes("\\")) {
    return mode.replace(/\s*ACP session\s*/i, "").trim() || t("config.status_connected");
  }
  return t("config.status_connected");
}

export function lastRunForAgent(messages: ChatMessage[] | undefined) {
  return [...(messages ?? [])].reverse().find((message) => message.run)?.run ?? null;
}

export function shouldJoinAssistantChunkTightly(current: string, next: string) {
  if (!current || /^\s/.test(next) || /\s$/.test(current)) return true;
  if (/^[,.;:!?，。！？、；：）)\]}]/.test(next)) return true;
  if (/[（([{]$/.test(current)) return true;
  if (/[\u4e00-\u9fff]$/.test(current) || /^[\u4e00-\u9fff]/.test(next)) return true;
  return false;
}

export function runningAssistantTextForRun(run: PersonalLocalAgentRunResult) {
  const chunks = run.events
    .filter((event) => event.type === "assistant_chunk" || event.type === "chunk")
    .map((event) => event.text)
    .filter((text) => text.trim().length > 0);
  if (!chunks.length) return "";
  if (run.agentProvider === "hermes") {
    return chunks.reduce((current, next) => {
      if (!current) return next;
      return shouldJoinAssistantChunkTightly(current, next) ? `${current}${next}` : `${current} ${next}`;
    }, "").trim();
  }
  return chunks.join("\n").trim();
}

export function messageTextForRun(
  run: PersonalLocalAgentRunResult,
  fallback: string,
) {
  // Failed runs: never surface raw English / duplicated failure lines as the
  // assistant body — timeline tips already own the user-facing error card.
  if (run.status === "failed") {
    if (runTimelineAlreadyShowsFailure(run)) return "";
    return classifiedRunFailureMessage(run);
  }
  if (run.conversationMessages?.length) {
    const finalMessage = [...run.conversationMessages].reverse().find((message) => message.type === "finish" && message.text.trim());
    if (finalMessage) return finalMessage.text.trim();
    const latestAssistant = [...run.conversationMessages].reverse().find((message) => message.role === "assistant" && message.text.trim());
    if (latestAssistant) return latestAssistant.text.trim();
  }
  const output = run.output.trim();
  if (output) return output;
  const liveAssistantText = runningAssistantTextForRun(run);
  if (liveAssistantText) {
    if (run.status === "running" && run.pendingApprovals?.length) {
      return `${liveAssistantText}\n\n${t("local_agent.waiting_for_approval")}`;
    }
    return liveAssistantText;
  }
  if (run.status === "running" && run.pendingApprovals?.length) return t("local_agent.waiting_for_approval");
  if (run.status === "running") return t("local_agent.running");
  if (run.status === "completed") return fallback;
  if (run.status === "cancelled") return t("local_agent.cancelled");
  return fallback;
}

export function placeholderRunFromProcess(process: PersonalLocalAgentProcessRecord): PersonalLocalAgentRunResult | null {
  const runId = process.runId.trim();
  const providerRaw = (process.provider ?? process.backend ?? "").trim();
  if (!runId || !providerRaw || !isPersonalLocalAgentProvider(providerRaw)) return null;
  // Stale processes are leftovers from a previous process session that died on
  // restart. They are not actually running — treating them as running creates a
  // placeholder run that pollRun can never resolve, causing repeated orphaned
  // errors and an activeRunId set/clear loop every sync tick.
  if (process.status === "stale") return null;
  const provider: PersonalLocalAgentProvider = providerRaw;
  return {
    ok: false,
    runId,
    agentId: provider,
    agentProvider: provider,
    connectionMode: process.agentType === "acp" ? `${PROVIDER_LABELS[provider] ?? provider} ACP session` : process.agentType,
    status: "running",
    startedAt: process.startedAt,
    finishedAt: null,
    pid: process.pid,
    command: process.command ?? "",
    output: "",
    error: null,
    errorInfo: null,
    events: [{ type: "status", text: t("local_agent.background_status_restored"), at: process.updatedAt }],
    logPath: null,
    workdir: null,
    conversationId: process.conversationId,
    debugSummary: null,
    providerSessionId: null,
    resumeKey: null,
    metadata: null,
    approvalMode: null,
    pendingApprovals: [],
    artifacts: [],
  };
}
