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
import { sanitizeAssistantTranscriptText } from "../../../capabilities/conversation/assistant-text-sanitize";
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
  const messages = mapPersonalRunToMessages(run) as PersonalLocalAgentConversationMessage[];
  // Runtime emits both type:error and tips(category=error) for the same failure.
  // Keep the tips card (has resolution CTA) and drop the bare duplicate error row.
  // Also drop pure skill-catalog dumps that leaked as assistant text.
  const cleaned: PersonalLocalAgentConversationMessage[] = [];
  for (const message of messages) {
    if (message.role === "assistant" || message.type === "text" || message.type === "finish") {
      const sanitized = sanitizeAssistantTranscriptText(message.text);
      if (sanitized.wasSkillCatalogDump || !sanitized.text.trim()) {
        if (message.role === "assistant" || message.type === "finish" || message.type === "text") {
          continue;
        }
      }
      cleaned.push(sanitized.text === message.text ? message : { ...message, text: sanitized.text });
      continue;
    }
    cleaned.push(message);
  }
  return cleaned.filter((message, index, list) => {
    if (message.type !== "error") return true;
    const next = list[index + 1];
    if (next?.type === "tips" && next.category === "error") return false;
    const hasErrorTip = list.some(
      (item) => item.type === "tips" && item.category === "error",
    );
    return !hasErrorTip;
  });
}

/** Runtime-agnostic ConversationItemVM[] for the same personal run. */
export function toConversationItems(run: PersonalLocalAgentRunResult | null | undefined) {
  return toPersonalConversationItems(run);
}

type LocalAgentToolStatus = "running" | "completed" | "failed" | "pending";

type LocalAgentTimelineItem =
  | { kind: "message"; id: string; message: PersonalLocalAgentConversationMessage }
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
  const output = firstMeaningfulToolValue(
    message.toolCall?.output,
    message.update?.output,
    message.update?.rawOutput,
    message.update?.raw_output,
  );
  if (hasMeaningfulToolValue(output)) return "completed";

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
const TOOL_PARAM_SUMMARY_MAX_CHARS = 80;

function compactToolSummary(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= TOOL_PARAM_SUMMARY_MAX_CHARS) return singleLine;
  return `${singleLine.slice(0, TOOL_PARAM_SUMMARY_MAX_CHARS - 1)}…`;
}

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
    if (typeof file === "string" && file.trim()) return compactToolSummary(file);
  }
  if (k === "execute" || k === "command" || k === "shell" || k === "bash") {
    const cmd = raw.command ?? raw.cmd;
    if (typeof cmd === "string" && cmd.trim()) return compactToolSummary(cmd);
  }
  if (k === "search" || k === "grep" || k === "glob") {
    const parts: string[] = [];
    const pattern = raw.pattern ?? raw.query ?? raw.search;
    if (typeof pattern === "string" && pattern.trim()) parts.push(`"${pattern.trim()}"`);
    const path = raw.path ?? raw.glob ?? raw.cwd;
    if (typeof path === "string" && path.trim()) parts.push(`in ${path.trim()}`);
    if (parts.length) return compactToolSummary(parts.join(" "));
  }
  if (k === "fetch" || k === "webfetch") {
    const url = raw.url ?? raw.href;
    if (typeof url === "string" && url.trim()) return compactToolSummary(url);
  }

  // Generic fallback: try common keys.
  for (const key of ["file_path", "command", "path", "pattern", "query", "url", "file_name", "cmd"]) {
    const val = raw[key];
    if (typeof val === "string" && val.trim()) return compactToolSummary(val);
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

function stringifyToolOutput(value?: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return stringifyToolField(value);
  }
  for (const key of ["formatted_output", "formattedOutput", "output", "result", "text"]) {
    const candidate = Reflect.get(value, key);
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return stringifyToolField(value);
}

function hasMeaningfulToolValue(value: unknown, seen = new Set<object>()): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value !== "object") return true;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulToolValue(item, seen));
  }
  return Object.values(value).some((item) => hasMeaningfulToolValue(item, seen));
}

function firstMeaningfulToolValue(...values: unknown[]): unknown {
  return values.find((value) => hasMeaningfulToolValue(value));
}

function firstNonEmptyToolString(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const normalized = value?.trim() ?? "";
    if (normalized) return normalized;
  }
  return "";
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
// carries no usable information at all. A failed terminal update with only an
// ID remains visible: otherwise the user sees neither which tool failed nor its
// terminal state.
function localAgentToolDisplay(message: PersonalLocalAgentConversationMessage, runStatus?: string): LocalAgentToolDisplay | null {
  const tool = message.toolCall;
  const acpUpdate = message.update;
  const rawName = firstNonEmptyToolString(tool?.name, acpUpdate?.title);
  const rawKind = firstNonEmptyToolString(tool?.kind, acpUpdate?.kind);
  const rawInput = firstMeaningfulToolValue(tool?.input, acpUpdate?.input, acpUpdate?.rawInput, acpUpdate?.raw_input);
  const rawOutput = firstMeaningfulToolValue(tool?.output, acpUpdate?.output, acpUpdate?.rawOutput, acpUpdate?.raw_output);
  const meaningfulInput = hasMeaningfulToolValue(rawInput);
  const meaningfulOutput = hasMeaningfulToolValue(rawOutput);
  const meaningfulContent = hasMeaningfulToolValue(acpUpdate?.content);
  const meaningfulLocations = hasMeaningfulToolValue(acpUpdate?.locations);
  const toolCallId = tool?.id ?? acpUpdate?.toolCallId ?? acpUpdate?.tool_call_id ?? "";
  const status = resolveLocalAgentToolStatus(message, runStatus);
  const meaningfulFailure = status === "failed" && Boolean(toolCallId);
  const paramSummary = extractParamSummary(rawKind, rawInput);
  const compactRawName = compactToolSummary(rawName);
  const rawNameLooksLikePayload = Boolean(
    rawName
      && (rawName.length > TOOL_PARAM_SUMMARY_MAX_CHARS || compactRawName === paramSummary),
  );

  // Filter out completely empty tool calls (Upstream pattern).
  if (
    !rawName
    && !rawKind
    && !paramSummary
    && !meaningfulInput
    && !meaningfulOutput
    && !meaningfulContent
    && !meaningfulLocations
    && !meaningfulFailure
  ) {
    return null;
  }

  let title: string;
  if (rawName && !rawNameLooksLikePayload && !GENERIC_TOOL_NAMES.has(rawName.toLowerCase())) {
    title = compactRawName;
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
    description = compactToolSummary(tool.description);
  } else if (rawKind) {
    description = getKindDisplayName(rawKind);
  } else {
    const textBody = (message.text ?? "").replace(/^acp_tool_call(_update)?[>:\s-]*/i, "").trim();
    description = compactToolSummary(textBody) || (toolCallId ? `ID ${toolCallId}` : title);
  }

  const detailSections: Array<{ label: string; value: string; truncated?: boolean }> = [];
  const input = meaningfulInput ? stringifyToolField(rawInput) : "";
  const output = meaningfulOutput ? stringifyToolOutput(rawOutput) : "";
  if (input) detailSections.push({ label: "Input", value: input, truncated: tool?.inputTruncated });
  if (output) detailSections.push({ label: "Output", value: output, truncated: tool?.outputTruncated ?? acpUpdate?.outputTruncated });
  if (meaningfulContent && Array.isArray(acpUpdate?.content)) detailSections.push({ label: "Content", value: JSON.stringify(acpUpdate.content, null, 2) });
  const locations = (acpUpdate?.locations ?? []).map((item) => typeof item === "string" ? item : item.path).filter(Boolean).join("\n");
  if (locations) detailSections.push({ label: "Locations", value: locations });

  return {
    title,
    description,
    status,
    detail: detailSections.length ? detailSections : [],
  };
}

function createStableRenderKeyAllocator() {
  const usedKeys = new Set<string>();
  const nextSuffixByBase = new Map<string, number>();
  return (candidate: string | null | undefined, fallback: string): string => {
    const base = candidate?.trim() || fallback;
    let key = base;
    if (usedKeys.has(key)) {
      let suffix = nextSuffixByBase.get(base) ?? 2;
      do {
        key = `${base}#${suffix}`;
        suffix += 1;
      } while (usedKeys.has(key));
      nextSuffixByBase.set(base, suffix);
    } else {
      nextSuffixByBase.set(base, 2);
    }
    usedKeys.add(key);
    return key;
  };
}

export function groupLocalAgentTimeline(messages: PersonalLocalAgentConversationMessage[]): LocalAgentTimelineItem[] {
  const items: LocalAgentTimelineItem[] = [];
  const allocateItemId = createStableRenderKeyAllocator();
  let toolBuffer: PersonalLocalAgentConversationMessage[] = [];
  let toolBufferId: string | null = null;
  const flushTools = () => {
    if (!toolBuffer.length) return;
    const visibleTools = toolBuffer.filter((message) => localAgentToolDisplay(message) !== null);
    if (visibleTools.length) {
      items.push({
        kind: "tool_group",
        // Keep the first source row/group ID. Appending another streaming tool
        // must not change this React key and remount every existing tool card.
        id: allocateItemId(
          toolBufferId ?? visibleTools[0]!.id,
          `tool-group-${items.length + 1}`,
        ),
        messages: visibleTools,
      });
    }
    toolBuffer = [];
    toolBufferId = null;
  };
  for (const message of messages) {
    if (message.type === "tool") {
      toolBufferId ??= message.id;
      toolBuffer.push(message);
      continue;
    }
    if (message.type === "tool_group") {
      const visibleTools = (message.toolCalls ?? []).filter(
        (toolMessage) => localAgentToolDisplay(toolMessage) !== null,
      );
      if (visibleTools.length) toolBufferId ??= message.id;
      toolBuffer.push(...visibleTools);
      continue;
    }
    if (message.type === "acp_tool_call") {
      toolBufferId ??= message.id;
      toolBuffer.push(message);
      continue;
    }
    flushTools();
    items.push({
      kind: "message",
      id: allocateItemId(message.id, `message-${items.length + 1}`),
      message,
    });
  }
  flushTools();
  return items;
}

export function localAgentToolRenderKeys(
  messages: PersonalLocalAgentConversationMessage[],
): string[] {
  const allocateKey = createStableRenderKeyAllocator();
  return messages.map((message, index) => (
    allocateKey(message.id, `tool-${index + 1}`)
  ));
}

function normalizeLocalToolText(value: string) {
  return value
    // Some Windows command wrappers produce CRCRLF. Treat the whole sequence
    // as one line ending so every output line does not acquire a blank row.
    .replace(/\r+\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+$/, "");
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
          <div className="truncate text-xs font-medium text-dls-text" title={tool.title}>{tool.title}</div>
          {tool.description && tool.description !== tool.title ? (
            <div className="truncate font-mono text-xs text-dls-secondary" title={tool.description}>{tool.description}</div>
          ) : null}
        </div>
        <StatusBadge tone={tone} shape="pill" size="tiny">{tool.status}</StatusBadge>
      </button>
      {expanded && hasDetail ? (
        <div className="mt-2 space-y-2">
          {tool.detail.map((section) => {
            const displayValue = normalizeLocalToolText(section.value);
            const isOutput = section.label === "Output";
            const diff = isOutput ? extractDiff(displayValue) : null;
            const diffLines = diff ? toKeyedLines(normalizeLocalToolText(diff)) : [];
            return (
              <div key={section.label} className="min-w-0">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-dls-secondary">
                    <span>{section.label}</span>
                    {section.truncated ? (
                      <StatusBadge
                        tone="warning"
                        shape="pill"
                        size="tiny"
                        data-testid="local-agent-tool-detail-truncated"
                      >
                        {t("local_agent.tool_output_preview_truncated")}
                      </StatusBadge>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="text-dls-text hover:bg-dls-hover"
                    onClick={() => void copyText(section.value)}
                  >
                    {t("session.copy")}
                  </Button>
                </div>
                {Boolean(diff) ? (
                  <div className="max-h-64 overflow-auto rounded-md border border-dls-mist bg-dls-surface">
                    {diffLines.map(({ key, line }) => (
                      <div
                        key={key}
                        className={`whitespace-pre-wrap break-words px-2 font-mono text-xs leading-normal ${diffLineClass(line)}`}
                      >
                        {line || " "}
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre
                    className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-dls-mist bg-dls-surface px-3 py-2 font-mono text-xs leading-normal text-dls-secondary"
                    data-testid="local-agent-tool-detail"
                  >
                    {displayValue}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** True when the tool needs the expandable Input/Output card (not Content/Locations alone). */
function toolNeedsRichInputOutputCard(display: LocalAgentToolDisplay): boolean {
  return display.detail.some((section) => section.label === "Input" || section.label === "Output");
}

function sharedToolItemFromMessage(
  message: PersonalLocalAgentConversationMessage,
  display: LocalAgentToolDisplay,
) {
  const [item] = personalMessagesToConversationItems([message as PersonalAdapterMessage]);
  if (!item) return null;
  return {
    ...item,
    kind: "tool" as const,
    toolName: display.title || item.toolName,
    toolStatus: display.status || item.toolStatus,
    text: display.description || item.text,
    meta: {
      ...item.meta,
      description:
        display.description !== display.title ? display.description : undefined,
    },
  };
}

export function LocalAgentToolGroupSummary(props: { messages: PersonalLocalAgentConversationMessage[]; runStatus?: string }) {
  // Prefer shared ConversationItemView for compact tool rows. Keep the rich
  // LocalAgentToolCard only when expandable Input/Output is present.
  const renderKeys = localAgentToolRenderKeys(props.messages);
  const tools = props.messages
    .map((message, index) => ({
      message,
      renderKey: renderKeys[index]!,
      display: localAgentToolDisplay(message, props.runStatus),
    }))
    .filter((entry) => entry.display !== null);

  if (tools.length === 0) return null;

  return (
    <div className="flex max-w-full flex-col gap-1">
      {tools.map((entry) => {
        const display = entry.display!;
        if (toolNeedsRichInputOutputCard(display)) {
          return (
            <LocalAgentToolCard
              key={entry.renderKey}
              message={entry.message}
              runStatus={props.runStatus}
            />
          );
        }
        const item = sharedToolItemFromMessage(entry.message, display);
        if (!item) return null;
        return <ConversationItemView key={entry.renderKey} item={item} />;
      })}
    </div>
  );
}

/** Map a personal timeline message → ConversationItemVM (adapter) then shared UI. */
function PersonalConversationItem(props: {
  message: PersonalLocalAgentConversationMessage;
  streaming?: boolean;
  runStatus?: string;
}) {
  // Tools get display-normalized titles/status when possible so the shared row
  // matches LocalAgentToolCard chrome without pulling in expandable detail.
  if (props.message.type === "tool" || props.message.type === "acp_tool_call") {
    const display = localAgentToolDisplay(props.message, props.runStatus);
    if (!display) return null;
    if (toolNeedsRichInputOutputCard(display)) {
      return <LocalAgentToolCard message={props.message} runStatus={props.runStatus} />;
    }
    const toolItem = sharedToolItemFromMessage(props.message, display);
    if (!toolItem) return null;
    return <ConversationItemView item={toolItem} streaming={props.streaming} />;
  }

  const [item] = personalMessagesToConversationItems([
    props.message as PersonalAdapterMessage,
  ]);
  if (!item) return null;

  // Enrich approval cards with title/summary when present on the message.
  if (item.kind === "approval" && props.message.approval) {
    const approval = props.message.approval;
    return (
      <ConversationItemView
        item={{
          ...item,
          meta: {
            ...item.meta,
            title: typeof approval.title === "string" ? approval.title : item.meta?.title,
            summary:
              typeof approval.summary === "string"
                ? approval.summary
                : typeof approval.command === "string"
                  ? approval.command
                  : item.meta?.summary,
            command: typeof approval.command === "string" ? approval.command : item.meta?.command,
          },
        }}
        streaming={props.streaming}
      />
    );
  }

  return <ConversationItemView item={item} streaming={props.streaming} />;
}

export function LocalAgentTimelineMessage(props: {
  message: PersonalLocalAgentConversationMessage;
  streaming: boolean;
  runStatus?: string;
  onResolveTip?: (message: PersonalLocalAgentConversationMessage) => void;
}) {
  if (props.message.type === "tips") {
    return <MessageTips message={props.message} onResolve={props.onResolveTip} />;
  }
  // Shared conversation UI for tool / thinking / plan / approval / error / tips
  // (tips with resolution keep MessageTips for the action button).
  if (
    props.message.type === "plan"
    || props.message.type === "thinking"
    || props.message.type === "permission"
    || props.message.type === "error"
    || props.message.type === "tool"
    || props.message.type === "acp_tool_call"
    || props.message.type === "system"
  ) {
    return (
      <PersonalConversationItem
        message={props.message}
        streaming={props.streaming}
        runStatus={props.runStatus}
      />
    );
  }
  if (props.message.role === "assistant") {
    const body = sanitizeAssistantTranscriptText(props.message.text).text;
    if (!body.trim()) return null;
    return (
      <PersonalConversationItem
        message={{ ...props.message, text: body }}
        streaming={props.streaming && props.message.type !== "finish"}
        runStatus={props.runStatus}
      />
    );
  }
  if (props.message.role === "system" || props.message.role === "user") {
    return (
      <PersonalConversationItem
        message={props.message}
        streaming={props.streaming}
        runStatus={props.runStatus}
      />
    );
  }
  return null;
}
