/** @jsxImportSource react */
import { useState } from "react";

import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { PersonalLocalAgentConversationMessage, PersonalLocalAgentRunResult } from "../../../../app/lib/desktop";
import {
  ConversationItemView,
  mapPersonalRunToMessages,
  personalMessagesToConversationItems,
  toPersonalConversationItems,
  type PersonalAdapterMessage,
} from "../../../capabilities/conversation";
import { MarkdownBlock } from "../../../capabilities/artifacts/markdown";
import { MessageTips } from "./message-tips";
import { extractDiff, toKeyedLines, diffLineClass, copyText } from "../../../capabilities/artifacts/diff-utils";

export function lastEventTime(run: PersonalLocalAgentRunResult | null | undefined) {
  const event = run?.events?.[run.events.length - 1];
  return event?.at ?? run?.finishedAt ?? run?.startedAt ?? null;
}

/**
 * Visible timeline rows for a personal run.
 * Event → message mapping lives in capabilities/conversation personal adapter;
 * this keeps the rich PersonalLocalAgentConversationMessage shape for UI cards.
 */
export function visibleRunTimelineMessages(run: PersonalLocalAgentRunResult | null | undefined) {
  return mapPersonalRunToMessages(run) as PersonalLocalAgentConversationMessage[];
}

/** Runtime-agnostic ConversationItemVM[] for the same personal run. */
export function toConversationItems(run: PersonalLocalAgentRunResult | null | undefined) {
  return toPersonalConversationItems(run);
}

type LocalAgentToolStatus = "running" | "completed" | "failed" | "pending";

type LocalAgentTimelineItem =
  | { kind: "message"; message: PersonalLocalAgentConversationMessage }
  | { kind: "tool_group"; id: string; messages: PersonalLocalAgentConversationMessage[] };

// Precise status mapping (mirrors Upstream normalizeAcpStatus / normalizeToolCallStatus).
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
// Record<string, unknown> for param extraction (mirrors Upstream buildParamSummary).
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
// Mirrors Upstream's buildParamSummary so the description is always meaningful.
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
// empty — mirroring Upstream's normalizeAcpToolCall which returns undefined for
// empty updates, so the renderer can skip it entirely.
function localAgentToolDisplay(message: PersonalLocalAgentConversationMessage, runStatus?: string): LocalAgentToolDisplay | null {
  const tool = message.toolCall;
  const acpUpdate = message.update;
  const rawName = tool?.name?.trim() ?? acpUpdate?.title?.trim() ?? "";
  const rawKind = tool?.kind?.trim() ?? acpUpdate?.kind?.trim() ?? "";
  const rawInput = tool?.input ?? acpUpdate?.input ?? undefined;
  const rawOutput = tool?.output ?? acpUpdate?.output ?? undefined;
  const paramSummary = extractParamSummary(rawKind, rawInput);

  // Filter out completely empty tool calls (Upstream pattern).
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

  // Skip rendering for empty tool calls (Upstream pattern: normalize → filter).
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
  // Prefer shared ConversationItemView for compact tool rows. Keep the rich
  // LocalAgentToolCard when the tool carries expandable Input/Output detail.
  const tools = props.messages
    .map((message) => ({ message, display: localAgentToolDisplay(message, props.runStatus) }))
    .filter((entry) => entry.display !== null);

  if (tools.length === 0) return null;

  return (
    <div className="max-w-full flex flex-col gap-2">
      {tools.map((entry) => {
        const hasDetail = (entry.display?.detail.length ?? 0) > 0;
        if (hasDetail) {
          return (
            <LocalAgentToolCard
              key={entry.message.id}
              message={entry.message}
              runStatus={props.runStatus}
            />
          );
        }
        const [item] = personalMessagesToConversationItems([
          entry.message as PersonalAdapterMessage,
        ]);
        if (!item) return null;
        const display = entry.display!;
        return (
          <ConversationItemView
            key={entry.message.id}
            item={{
              ...item,
              kind: "tool",
              toolName: display.title || item.toolName,
              toolStatus: display.status || item.toolStatus,
              text: display.description || item.text,
              meta: {
                ...item.meta,
                description:
                  display.description !== display.title ? display.description : undefined,
              },
            }}
          />
        );
      })}
    </div>
  );
}

/** Map a personal timeline message → ConversationItemVM (adapter) then shared UI. */
function PersonalConversationItem(props: {
  message: PersonalLocalAgentConversationMessage;
  streaming?: boolean;
}) {
  const [item] = personalMessagesToConversationItems([
    props.message as PersonalAdapterMessage,
  ]);
  if (!item) return null;
  return <ConversationItemView item={item} streaming={props.streaming} />;
}

export function LocalAgentTimelineMessage(props: {
  message: PersonalLocalAgentConversationMessage;
  streaming: boolean;
  onResolveTip?: (message: PersonalLocalAgentConversationMessage) => void;
}) {
  // Shared conversation UI for tool / thinking / plan / approval / error kinds.
  if (
    props.message.type === "plan"
    || props.message.type === "thinking"
    || props.message.type === "permission"
    || props.message.type === "error"
    || props.message.type === "tool"
    || props.message.type === "acp_tool_call"
  ) {
    return (
      <PersonalConversationItem
        message={props.message}
        streaming={props.streaming}
      />
    );
  }
  if (props.message.type === "tips") {
    return <MessageTips message={props.message} onResolve={props.onResolveTip} />;
  }
  if (props.message.role === "assistant") {
    return (
      <div className="text-sm leading-6 text-dls-text">
        <MarkdownBlock
          text={props.message.text}
          streaming={props.streaming && props.message.type !== "finish"}
        />
      </div>
    );
  }
  return null;
}
