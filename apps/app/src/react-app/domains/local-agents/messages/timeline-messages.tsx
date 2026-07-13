/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, Clock3, Loader2 } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PersonalLocalAgentConversationMessage, PersonalLocalAgentRunResult } from "../../../../app/lib/desktop";
import { MarkdownBlock } from "../../session/surface/markdown";
import { MessageTips } from "./message-tips";
import { extractDiff, toKeyedLines, diffLineClass, copyText } from "../../session/surface/tool-call";

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

// Precise status mapping (mirrors AionUI normalizeAcpStatus / normalizeToolCallStatus).
function mapRawStatus(status: string): LocalAgentToolStatus | null {
  switch (status) {
    case "completed":
    case "done":
    case "ok":
    case "success":
      return "completed";
    case "failed":
    case "error":
    case "cancelled":
    case "canceled":
      return "failed";
    case "in_progress":
    case "running":
    case "executing":
    case "confirming":
      return "running";
    case "pending":
    case "queued":
    case "queue":
      return "pending";
    default:
      return null;
  }
}

function resolveLocalAgentToolStatus(
  message: PersonalLocalAgentConversationMessage,
  runStatus?: string,
): LocalAgentToolStatus {
  const rawUpdate = `${message.update?.status ?? ""}`.toLowerCase().trim();
  const rawTool = `${message.toolCall?.status ?? ""}`.toLowerCase().trim();
  const rawMessage = `${message.status ?? ""}`.toLowerCase().trim();

  const rawRun = `${runStatus ?? ""}`.toLowerCase().trim();
  const runMapped = mapRawStatus(rawRun);
  const runDone = runMapped === "completed" || runMapped === "failed";

  // An explicit *terminal* status reported by the tool itself always wins
  // (e.g. the provider did send a final "completed"/"failed").
  const mapped = mapRawStatus(rawUpdate) ?? mapRawStatus(rawTool) ?? mapRawStatus(rawMessage);
  if (mapped === "completed" || mapped === "failed") return mapped;

  // Output without a terminal status still means the tool ran to completion.
  const output = message.toolCall?.output ?? message.update?.output;
  if (output != null && `${output}`.trim().length > 0) return "completed";

  // The run has already finished, but this tool only ever reported a
  // non-terminal status (or none at all — many ACP servers emit "in_progress"
  // as their last status and never follow up with "completed"). Inherit the run
  // outcome so the card does not keep spinning forever.
  if (runDone) return runMapped;

  // While the run is still going, honour a non-terminal reported status.
  if (mapped === "running") return "running";
  if (mapped === "pending") return "pending";

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

// Parse a tool input that may be a JSON string or a structured object into a
// Record<string, unknown> for param extraction (mirrors AionUI buildParamSummary).
function parseToolInput(input?: unknown): Record<string, unknown> | null {
  if (input == null) return null;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  return null;
}

// Extract a short human-readable summary from the tool input, keyed by kind.
// Mirrors AionUI's buildParamSummary so the description is always meaningful.
function extractParamSummary(kind: string | null | undefined, input?: unknown): string | null {
  const raw = parseToolInput(input);
  if (!raw) return null;
  const k = (kind ?? "").trim().toLowerCase();

  if (k === "read" || k === "edit" || k === "write") {
    const file = raw.file_path ?? raw.path ?? raw.file_name ?? raw.filePath ?? raw.filename;
    if (typeof file === "string" && file.trim()) return file.trim();
  }
  if (k === "execute" || k === "command" || k === "shell" || k === "bash") {
    const cmd = raw.command ?? raw.cmd;
    if (typeof cmd === "string" && cmd.trim()) return cmd.trim();
  }
  if (k === "search" || k === "grep" || k === "glob") {
    const parts: string[] = [];
    const pattern = raw.pattern ?? raw.query ?? raw.search;
    if (typeof pattern === "string" && pattern.trim()) parts.push(`"${pattern.trim()}"`);
    const path = raw.path ?? raw.glob ?? raw.cwd;
    if (typeof path === "string" && path.trim()) parts.push(`in ${path.trim()}`);
    if (parts.length) return parts.join(" ");
  }
  if (k === "fetch" || k === "webfetch") {
    const url = raw.url ?? raw.href;
    if (typeof url === "string" && url.trim()) return url.trim();
  }

  // Generic fallback: try common keys.
  for (const key of ["file_path", "command", "path", "pattern", "query", "url", "file_name", "cmd"]) {
    const val = raw[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return null;
}

function inferTitleFromInput(input?: unknown): string | null {
  const summary = extractParamSummary(null, input);
  if (summary) return summary;
  // Fallback: show a short preview of the raw input string.
  let str: string;
  if (typeof input === "string") {
    str = input;
  } else {
    try {
      str = JSON.stringify(input);
    } catch {
      str = String(input);
    }
  }
  const preview = str.trim().slice(0, 50).replace(/\s+/g, " ").trim();
  return preview || null;
}

// Safely stringify a tool field that may be a string OR a structured object
// (ACP tool_call input/output are often objects). Avoids `x?.trim is not a
// function` renderer crashes when the payload is non-string.
function stringifyToolField(value?: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function shortToolId(id?: string | null) {
  if (!id) return "";
  return id.length > 8 ? id.slice(-6) : id;
}

type LocalAgentToolDisplay = {
  title: string;
  description: string;
  status: LocalAgentToolStatus;
  detail: Array<{ label: string; value: string; truncated?: boolean }>;
};

// Normalize a tool message into a display record. Returns null when the message
// carries no usable information at all (no name, no kind, no input, no output,
// no title). A tool that only has a toolCallId and a status is considered
// empty — mirroring AionUI's normalizeAcpToolCall which returns undefined for
// empty updates, so the renderer can skip it entirely.
function localAgentToolDisplay(message: PersonalLocalAgentConversationMessage, runStatus?: string): LocalAgentToolDisplay | null {
  const tool = message.toolCall;
  const acpUpdate = message.update;
  const rawName = tool?.name?.trim() ?? acpUpdate?.title?.trim() ?? "";
  const rawKind = tool?.kind?.trim() ?? acpUpdate?.kind?.trim() ?? "";
  const rawInput = tool?.input ?? acpUpdate?.input ?? undefined;
  const rawOutput = tool?.output ?? acpUpdate?.output ?? undefined;
  const paramSummary = extractParamSummary(rawKind, rawInput);

  // Filter out completely empty tool calls (AionUI pattern).
  if (!rawName && !rawKind && !paramSummary && !rawInput && !rawOutput) {
    return null;
  }

  const toolCallId = tool?.id ?? acpUpdate?.toolCallId ?? "";
  let title: string;
  if (rawName && !GENERIC_TOOL_NAMES.has(rawName.toLowerCase())) {
    title = rawName;
  } else if (rawKind) {
    title = getKindDisplayName(rawKind);
  } else if (paramSummary) {
    title = paramSummary;
  } else {
    // Last resort: show which tool call it is, never a bare "Tool".
    title = toolCallId ? `Tool call · ${shortToolId(toolCallId)}` : "Tool call";
  }

  let description: string;
  if (paramSummary) {
    description = paramSummary;
  } else if (tool?.description?.trim()) {
    description = tool.description.trim();
  } else if (rawKind) {
    description = getKindDisplayName(rawKind);
  } else {
    const textBody = (message.text ?? "").replace(/^acp_tool_call(_update)?[>:\s-]*/i, "").trim();
    description = textBody.slice(0, 80) || (toolCallId ? `ID ${toolCallId}` : title);
  }

  const detailSections: Array<{ label: string; value: string; truncated?: boolean }> = [];
  const input = stringifyToolField(rawInput);
  const output = stringifyToolField(rawOutput);
  if (input) detailSections.push({ label: "Input", value: input, truncated: tool?.inputTruncated });
  if (output) detailSections.push({ label: "Output", value: output, truncated: tool?.outputTruncated });
  if (Array.isArray(acpUpdate?.content) && acpUpdate.content.length) detailSections.push({ label: "Content", value: JSON.stringify(acpUpdate.content, null, 2) });
  const locations = (acpUpdate?.locations ?? []).map((item) => typeof item === "string" ? item : item.path).filter(Boolean).join("\n");
  if (locations) detailSections.push({ label: "Locations", value: locations });

  return {
    title,
    description,
    status: resolveLocalAgentToolStatus(message, runStatus),
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

function normalizeLocalToolText(value: string) {
  return value.replace(/(?:\r?\n\s*)+$/, "");
}

// Card-style tool call that mirrors the expert/assistant `ToolCallView`:
// a rounded bordered card with a StatusBadge and expandable Input/Output,
// including diff highlighting for file edits.
const GENERIC_TOOL_TITLES = new Set(["tool", "tool call"]);

function LocalAgentToolCard(props: { message: PersonalLocalAgentConversationMessage; runStatus?: string }) {
  const tool = localAgentToolDisplay(props.message, props.runStatus);
  const [expanded, setExpanded] = useState(false);

  // Skip rendering for empty tool calls (AionUI pattern: normalize → filter).
  if (!tool) return null;

  const hasDetail = tool.detail.length > 0;
  const tone =
    tool.status === "running"
      ? "accent"
      : tool.status === "failed"
        ? "danger"
        : tool.status === "pending"
          ? "neutral"
          : "success";

  return (
    <div className="rounded-xl border border-dls-border bg-dls-surface-muted px-3 py-2.5">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 text-left text-dls-secondary hover:bg-transparent"
        disabled={!hasDetail}
        aria-expanded={hasDetail ? expanded : undefined}
        onClick={() => {
          if (hasDetail) setExpanded((value) => !value);
        }}
      >
        <div className="min-w-0 space-y-1">
          <div className="text-xs font-medium text-dls-text">{tool.title}</div>
          {tool.description && tool.description !== tool.title ? (
            <div className="text-xs text-dls-secondary">{tool.description}</div>
          ) : null}
        </div>
        <StatusBadge tone={tone}>{tool.status}</StatusBadge>
      </button>
      {expanded && hasDetail ? (
        <div className="mt-2 space-y-3">
          {tool.detail.map((section) => {
            const isOutput = section.label === "Output";
            const diff = isOutput ? extractDiff(section.value) : null;
            const diffLines = diff ? toKeyedLines(normalizeLocalToolText(diff)) : [];
            return (
              <div key={section.label} className="min-w-0">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-dls-secondary">{section.label}</div>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="rounded-full text-dls-text hover:bg-dls-hover"
                    onClick={() => void copyText(section.value)}
                  >
                    {t("session.copy")}
                  </Button>
                </div>
                {Boolean(diff) ? (
                  <div className="grid gap-1 overflow-hidden rounded-md">
                    {diffLines.map(({ key, line }) => (
                      <div
                        key={key}
                        className={`whitespace-pre-wrap break-words px-2 py-0.5 font-mono text-xs leading-relaxed ${diffLineClass(line)}`}
                      >
                        {line || " "}
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="overflow-x-auto rounded-xl border border-dls-mist bg-dls-surface px-4 py-3 text-xs leading-6 text-dls-secondary">{section.value}</pre>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function LocalAgentToolGroupSummary(props: { messages: PersonalLocalAgentConversationMessage[]; runStatus?: string }) {
  // Normalize + filter empty tool calls (AionUI pattern), so the count and
  // running indicator only reflect tools that actually carry information.
  const tools = props.messages
    .map((message) => ({ message, display: localAgentToolDisplay(message, props.runStatus) }))
    .filter((entry) => entry.display !== null);

  if (tools.length === 0) return null;

  return (
    <div className="max-w-full flex flex-col gap-2">
      {tools.map((entry) => (
        <LocalAgentToolCard key={entry.message.id} message={entry.message} runStatus={props.runStatus} />
      ))}
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