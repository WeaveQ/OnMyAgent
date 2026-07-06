/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, Clock3, Loader2 } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PersonalLocalAgentConversationMessage, PersonalLocalAgentRunResult } from "../../../../app/lib/desktop";
import { MarkdownBlock } from "../../session/surface/markdown";
import { MessageTips } from "./message-tips";

export function lastEventTime(run: PersonalLocalAgentRunResult | null | undefined) {
  const event = run?.events?.[run.events.length - 1];
  return event?.at ?? run?.finishedAt ?? run?.startedAt ?? null;
}

function runEventString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function runEventPlanEntries(event: PersonalLocalAgentRunResult["events"][number]) {
  if (Array.isArray(event.plan?.entries)) return event.plan.entries;
  const entries = event.data?.entries;
  return Array.isArray(entries) ? entries : [];
}

function runEventResolution(value: unknown) {
  return value && typeof value === "object" ? value as { target?: string; kind?: string; message?: string } : null;
}

function shouldJoinAssistantChunkTightly(current: string, next: string) {
  if (!current || /^\s/.test(next) || /\s$/.test(current)) return true;
  if (/^[,.;:!?，。！？、；：）)\]}]/.test(next)) return true;
  if (/[（([{]$/.test(current)) return true;
  if (/[\u4e00-\u9fff]$/.test(current) || /^[\u4e00-\u9fff]/.test(next)) return true;
  return false;
}

export function visibleRunTimelineMessages(run: PersonalLocalAgentRunResult | null | undefined) {
  const sourceMessages = run?.conversationMessages?.length
    ? run.conversationMessages
    : (run?.events ?? []).flatMap((event, index): PersonalLocalAgentConversationMessage[] => {
      const text = event.text.trim();
      if (!text) return [];
      const createdAt = event.at || Date.now();
      if (event.type === "assistant_chunk") return [{ id: `event-${index}`, type: "text", role: "assistant", text, createdAt, sourceEventType: event.type }];
      if (event.type === "assistant" || event.type === "finish") return [{ id: `event-${index}`, type: "finish", role: "assistant", text, createdAt, sourceEventType: event.type }];
      if (event.type === "tool") return [{ id: `event-${index}`, type: "tool", role: "tool", text, createdAt, sourceEventType: event.type, status: /failed|error/i.test(text) ? "failed" : "running", toolCall: event.toolCall ?? null }];
      if (event.type === "acp_tool_call") return [{ id: `event-${index}`, type: "acp_tool_call", role: "tool", text, createdAt, sourceEventType: event.type, status: event.update?.status ?? "running", update: event.update ?? null, msgId: event.msgId ?? null }];
      if (event.type === "plan") return [{ id: `event-${index}`, type: "plan", role: "assistant", text, createdAt, sourceEventType: event.type, entries: runEventPlanEntries(event) }];
      if (event.type === "thinking") return [{ id: `event-${index}`, type: "thinking", role: "assistant", text, createdAt, sourceEventType: event.type, status: event.status ?? runEventString(event.data?.status) ?? "thinking", msgId: event.msgId ?? null, durationMs: event.durationMs ?? null, startedAt: event.startedAt ?? null }];
      if (event.type === "tips") return [{ id: `event-${index}`, type: "tips", role: "system", text, createdAt, sourceEventType: event.type, category: event.category ?? runEventString(event.data?.category) ?? "info", ownership: event.ownership ?? runEventString(event.data?.ownership), resolution: event.resolution ?? runEventResolution(event.data?.resolution) }];
      if (event.type === "approval_request") return [{ id: `event-${index}`, type: "permission", role: "system", text, createdAt, sourceEventType: event.type, approval: event.approval ?? null }];
      if (event.type === "error") return [{ id: `event-${index}`, type: "error", role: "system", text, createdAt, sourceEventType: event.type }];
      if (event.type === "status") return [{ id: `event-${index}`, type: "agent_status", role: "system", text, createdAt, sourceEventType: event.type }];
      return [];
    });
  const messages = sourceMessages.filter((message) => {
    if (message.type === "thought") return false;
    if (!message.text.trim() && !(message.type === "thinking" && (message.status === "done" || message.status === "completed"))) return false;
    if (message.type === "finish") return false;
    if (message.role === "assistant" && message.type === "text") {
      return false;
    }
    if (message.type === "agent_status") return false;
    if (message.type === "agent_status" && /^.+ ACP flow started$/.test(message.text.trim())) return false;
    if (message.type === "available_commands" || message.type === "context_usage") return false;
    if (message.type === "tool" && !message.toolCall?.id) return false;
    if (message.type === "acp_tool_call" && !message.update?.toolCallId) return false;
    return true;
  });
  const grouped: PersonalLocalAgentConversationMessage[] = [];
  const thinkingIndexByKey = new Map<string, number>();
  let planIndex = -1;
  for (const message of messages) {
    if (message.type === "plan") {
      if (planIndex >= 0) {
        grouped[planIndex] = { ...message, id: grouped[planIndex].id };
      } else {
        planIndex = grouped.length;
        grouped.push({ ...message, id: `plan-card` });
      }
      continue;
    }
    if (message.type === "thinking") {
      const key = message.msgId ?? "__default__";
      const existingIndex = thinkingIndexByKey.get(key);
      if (existingIndex !== undefined) {
        const existing = grouped[existingIndex];
        const isDone = message.status === "done" || message.status === "completed";
        grouped[existingIndex] = {
          ...existing,
          text: message.text ? `${existing.text}${existing.text ? "" : ""}${message.text}` : existing.text,
          status: isDone ? "done" : existing.status ?? "thinking",
          durationMs: message.durationMs ?? existing.durationMs ?? null,
          startedAt: existing.startedAt ?? message.startedAt ?? null,
          createdAt: message.createdAt || existing.createdAt,
        };
        continue;
      }
      const idx = grouped.length;
      grouped.push({ ...message, id: `thinking-${key}` });
      thinkingIndexByKey.set(key, idx);
      continue;
    }
    const previous = grouped[grouped.length - 1];
    const isAssistantChunk = message.role === "assistant" && message.type === "text";
    const previousIsAssistantChunk = previous?.role === "assistant" && previous.type === "text";
    if (isAssistantChunk && previous && previousIsAssistantChunk) {
      grouped[grouped.length - 1] = {
        ...previous,
        id: `${previous.id}-${message.id}`,
        text: shouldJoinAssistantChunkTightly(previous.text, message.text)
          ? `${previous.text}${message.text}`
          : `${previous.text}\n${message.text}`,
        createdAt: message.createdAt,
      };
      continue;
    }
    grouped.push(message);
  }
  return grouped;
}

type LocalAgentToolStatus = "running" | "completed" | "failed" | "pending";

type LocalAgentTimelineItem =
  | { kind: "message"; message: PersonalLocalAgentConversationMessage }
  | { kind: "tool_group"; id: string; messages: PersonalLocalAgentConversationMessage[] };

function resolveLocalAgentToolStatus(message: PersonalLocalAgentConversationMessage): LocalAgentToolStatus {
  const raw = `${message.toolCall?.status ?? message.status ?? ""}`.toLowerCase();
  if (raw.includes("fail") || raw.includes("error") || raw.includes("cancel")) return "failed";
  if (raw.includes("complete") || raw.includes("done") || raw === "ok" || raw === "success") return "completed";
  if (raw.includes("pending") || raw.includes("queue")) return "pending";
  return "running";
}

// Map raw tool kinds and generic names into stable user-facing labels.
const LOCAL_AGENT_TOOL_KIND_LABELS: Record<string, string> = {
  edit: "File Edit",
  read: "File Read",
  write: "File Write",
  execute: "Shell Command",
  command: "Shell Command",
  commandexecution: "Shell Command",
  shell: "Shell Command",
  bash: "Shell Command",
  search: "Search",
  grep: "Search",
  glob: "Find Files",
  fetch: "Fetch",
  webfetch: "Fetch",
  think: "Thinking",
  thinking: "Thinking",
  mcp: "MCP Tool",
};

const GENERIC_TOOL_NAMES = new Set(["tool", "tool_call", "unknown", "untitled"]);

function getKindDisplayName(kind?: string): string {
  if (!kind) return "Tool";
  const key = kind.trim().toLowerCase();
  if (LOCAL_AGENT_TOOL_KIND_LABELS[key]) return LOCAL_AGENT_TOOL_KIND_LABELS[key];
  return kind.trim();
}

function inferTitleFromInput(input?: string): string | null {
  if (!input?.trim()) return null;
  const trimmed = input.trim();
  // 尝试解析 JSON，看有没有 command/path/file_path/pattern
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed) {
      if (parsed.command) return `Shell Command: ${(parsed.command as string).slice(0, 40)}`;
      if (parsed.path) return `File: ${(parsed.path as string).slice(0, 40)}`;
      if (parsed.file_path) return `File: ${(parsed.file_path as string).slice(0, 40)}`;
      if (parsed.pattern) return `Search: ${(parsed.pattern as string).slice(0, 40)}`;
    }
  } catch {
    // 不是 JSON，继续
  }
  // 不是 JSON，直接用前 50 个字符
  const preview = trimmed.slice(0, 50).replace(/\s+/g, " ").trim();
  if (preview) return preview;
  return null;
}

function localAgentToolDisplay(message: PersonalLocalAgentConversationMessage) {
  const tool = message.toolCall;
  const acpUpdate = message.update;
  let title: string;
  let description: string;

  const rawName = tool?.name?.trim() ?? acpUpdate?.title?.trim() ?? "";
  const rawKind = tool?.kind?.trim() ?? acpUpdate?.kind?.trim();
  if (rawName && !GENERIC_TOOL_NAMES.has(rawName.toLowerCase())) {
    title = rawName;
  } else if (rawKind) {
    title = getKindDisplayName(rawKind);
  } else {
    const inferred =
      inferTitleFromInput(tool?.input ?? acpUpdate?.input ?? undefined) ||
      tool?.description?.trim() ||
      message.text.replace(/^acp_tool_call(_update)?[>:\s-]*/i, "").trim().slice(0, 50) ||
      "Tool";
    title = inferred;
  }

  description =
    tool?.description?.trim() ||
    inferTitleFromInput(tool?.input ?? acpUpdate?.input ?? undefined) ||
    (tool?.kind ? getKindDisplayName(tool.kind) : "") ||
    (acpUpdate?.kind ? getKindDisplayName(acpUpdate.kind) : "") ||
    message.text.replace(/^acp_tool_call(_update)?[>:\s-]*/i, "").trim().slice(0, 80) ||
    title;

  const detailSections: Array<{ label: string; value: string; truncated?: boolean }> = [];
  const input = tool?.input?.trim() || acpUpdate?.input?.trim();
  const output = tool?.output?.trim() || acpUpdate?.output?.trim();
  if (input) detailSections.push({ label: "Input", value: input, truncated: tool?.inputTruncated });
  if (output) detailSections.push({ label: "Output", value: output, truncated: tool?.outputTruncated });
  if (Array.isArray(acpUpdate?.content) && acpUpdate.content.length) detailSections.push({ label: "Content", value: JSON.stringify(acpUpdate.content, null, 2) });
  const locations = (acpUpdate?.locations ?? []).map((item) => typeof item === "string" ? item : item.path).filter(Boolean).join("\n");
  if (locations) detailSections.push({ label: "Locations", value: locations });

  return {
    title,
    description,
    status: resolveLocalAgentToolStatus({ ...message, status: acpUpdate?.status ?? message.status }),
    detail: detailSections.length ? detailSections : [],
  };
}

export function groupLocalAgentTimeline(messages: PersonalLocalAgentConversationMessage[]): LocalAgentTimelineItem[] {
  const items: LocalAgentTimelineItem[] = [];
  let toolBuffer: PersonalLocalAgentConversationMessage[] = [];
  const flushTools = () => {
    if (!toolBuffer.length) return;
    items.push({ kind: "tool_group", id: toolBuffer.map((message) => message.id).join("-"), messages: toolBuffer });
    toolBuffer = [];
  };
  for (const message of messages) {
    if (message.type === "tool") {
      toolBuffer.push(message);
      continue;
    }
    if (message.type === "tool_group") {
      flushTools();
      items.push({ kind: "tool_group", id: message.id, messages: message.toolCalls ?? [] });
      continue;
    }
    if (message.type === "acp_tool_call") {
      toolBuffer.push(message);
      continue;
    }
    flushTools();
    items.push({ kind: "message", message });
  }
  flushTools();
  return items;
}

function LocalAgentToolRow(props: { message: PersonalLocalAgentConversationMessage }) {
  const tool = localAgentToolDisplay(props.message);
  const hasDetail = tool.detail.length > 0;

  const dotClass =
    tool.status === "running"
      ? "bg-dls-accent local-agent-tool-breathing"
      : tool.status === "failed"
        ? "bg-dls-status-danger"
        : tool.status === "pending"
          ? "bg-dls-border-strong"
          : "bg-dls-status-success-fg";

  return (
    <div className="flex min-w-0 flex-col overflow-hidden">
      <div className="flex w-full items-center gap-3 rounded-md py-0.5 text-left text-sm leading-5 text-dls-secondary overflow-hidden">
        <span className={cn("size-2 shrink-0 rounded-full", dotClass)} />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-dls-text">{tool.title}</span>
          {tool.description && tool.description !== tool.title ? <span className="ml-1 text-dls-secondary">{tool.description}</span> : null}
        </span>
      </div>
      {hasDetail ? (
        <div className="ml-5 mt-1 space-y-2 overflow-hidden">
          {tool.detail.map((section) => (
            <div key={section.label} className="min-w-0">
              <div className="text-2xs font-medium text-dls-tertiary">
                {section.label}
                {section.truncated ? ` · ${t("local_agent.timeline_tool_truncated")}` : ""}
              </div>
              <pre className="mt-1 max-h-48 overflow-auto rounded-xl border border-dls-border/70 bg-dls-surface px-3 py-2 text-xs leading-5 whitespace-pre-wrap break-words font-sans text-dls-secondary">{section.value}</pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function LocalAgentToolGroupSummary(props: { messages: PersonalLocalAgentConversationMessage[] }) {
  const tools = props.messages.map((message) => localAgentToolDisplay(message));
  const hasRunning = tools.some((tool) => tool.status === "running");

  return (
    <div className="max-w-full">
      <div className="inline-flex w-auto max-w-full cursor-default items-center gap-1.5 text-sm leading-none text-dls-accent">
        {hasRunning ? <Loader2 className="size-3.5 shrink-0 animate-spin text-dls-accent" /> : <CheckCircle2 className="size-3.5 shrink-0 text-dls-status-success-fg" />}
        <span className="truncate">{t("local_agent.timeline_tool_group_title", { count: props.messages.length })}</span>
      </div>
      <div className="mt-1.5 ml-5 flex max-w-full flex-col gap-2 rounded-lg bg-dls-surface-muted/60 px-3.5 py-2.5">
        {props.messages.map((message) => (
          <LocalAgentToolRow key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
}

function LocalAgentPlanMessage(props: { message: PersonalLocalAgentConversationMessage; streaming: boolean }) {
  const entries = props.message.entries ?? [];
  const [expanded, setExpanded] = useState(true);
  if (!entries.length) return <MarkdownBlock text={props.message.text} />;
  const hasActive = props.streaming && entries.some((e) => e.status === "in_progress" || e.status === "running");
  const completedCount = entries.filter((e) => e.status === "completed").length;
  return (
    <div className="min-w-0 rounded-md border border-dls-border/70 bg-dls-surface-muted/50" data-testid="local-agent-plan-card">
      <button
        type="button"
        data-testid="local-agent-plan-header"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm leading-5 text-dls-secondary transition-colors hover:bg-dls-hover/40"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {hasActive ? <Loader2 className="size-3.5 shrink-0 animate-spin text-dls-accent" /> : <CheckCircle2 className="size-3.5 shrink-0 text-dls-status-success-fg" />}
        <span className="min-w-0 flex-1 truncate font-medium text-dls-text">{t("local_agent.plan_title", { defaultValue: "Plan" })}</span>
        <span className="shrink-0 text-xs text-dls-tertiary" data-testid="local-agent-plan-count">{completedCount}/{entries.length}</span>
        <ChevronRight className={cn("size-3 shrink-0 text-dls-tertiary transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded ? (
        <div className="space-y-1.5 border-t border-dls-border/50 px-3 py-2 text-sm leading-5" data-testid="local-agent-plan-body">
          {entries.map((entry) => {
            const completed = entry.status === "completed";
            const running = props.streaming && (entry.status === "in_progress" || entry.status === "running");
            const label = entry.title || entry.content || props.message.text || t("local_agent.plan_title", { defaultValue: "Plan" });
            return (
              <div key={entry.id} className="flex min-w-0 items-center gap-2">
                {completed ? <CheckCircle2 className="size-3.5 shrink-0 text-dls-status-success-fg" /> : running ? <Loader2 className="size-3.5 shrink-0 animate-spin text-dls-accent" /> : <Clock3 className="size-3.5 shrink-0 text-dls-tertiary" />}
                <span className="min-w-0 flex-1 truncate text-dls-text">{label}</span>
                {entry.priority ? <StatusBadge tone="neutral" size="tiny">{entry.priority}</StatusBadge> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function LocalAgentThinkingMessage(props: { message: PersonalLocalAgentConversationMessage }) {
  const done = props.message.status === "done" || props.message.status === "completed";
  const [expanded, setExpanded] = useState(!done);
  useEffect(() => {
    if (done) setExpanded(false);
  }, [done]);
  const bodyText = props.message.text || t("session.assistant_thinking", { defaultValue: "Thinking..." });
  const durationSec = typeof props.message.durationMs === "number" && props.message.durationMs > 0
    ? Math.max(1, Math.round(props.message.durationMs / 1000))
    : null;
  const summary = done
    ? (durationSec
        ? t("local_agent.thinking_done_with_duration", { defaultValue: "Thought for {seconds}s", seconds: durationSec })
        : t("local_agent.thinking_complete", { defaultValue: "Thinking complete" }))
    : (durationSec
        ? t("local_agent.thinking_running_with_duration", { defaultValue: "Thinking... {seconds}s", seconds: durationSec })
        : t("local_agent.thinking_running", { defaultValue: "Thinking..." }));
  return (
    <div className="min-w-0 rounded-md border border-dls-border/70 bg-dls-surface-muted/50" data-testid="local-agent-thinking-card">
      <button
        type="button"
        data-testid="local-agent-thinking-header"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm leading-5 text-dls-secondary transition-colors hover:bg-dls-hover/40"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        data-status={done ? "done" : "running"}
      >
        {done ? <CheckCircle2 className="size-3.5 shrink-0 text-dls-status-success-fg" /> : <Loader2 className="size-3.5 shrink-0 animate-spin text-dls-accent" />}
        <span className="min-w-0 flex-1 truncate" data-testid="local-agent-thinking-status">{summary}</span>
        <ChevronRight className={cn("size-3 shrink-0 text-dls-tertiary transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded ? (
        <div className="border-t border-dls-border/50 px-3 py-2" data-testid="local-agent-thinking-body">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-dls-secondary font-sans">{bodyText}</pre>
        </div>
      ) : null}
    </div>
  );
}

export function LocalAgentTimelineMessage(props: { message: PersonalLocalAgentConversationMessage; streaming: boolean; onResolveTip?: (message: PersonalLocalAgentConversationMessage) => void }) {
  if (props.message.type === "plan") return <LocalAgentPlanMessage message={props.message} streaming={props.streaming} />;
  if (props.message.type === "thinking") return <LocalAgentThinkingMessage message={props.message} />;
  if (props.message.type === "tips") return <MessageTips message={props.message} onResolve={props.onResolveTip} />;
  if (props.message.role === "assistant") {
    return (
      <div className="text-sm leading-6 text-dls-text">
        <MarkdownBlock text={props.message.text} streaming={props.streaming && props.message.type !== "finish"} />
      </div>
    );
  }
  if (props.message.type === "permission" || props.message.type === "error") {
    return (
      <div className="text-xs leading-5 text-dls-secondary">
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans">{props.message.text}</pre>
      </div>
    );
  }
  return null;
}