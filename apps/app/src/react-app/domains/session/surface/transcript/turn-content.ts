import type { UIMessage } from "ai";

import type { Locale } from "@/i18n";
import type { TranscriptTurn, TranscriptTurnState } from "./turn-model";
import {
  completedProgressNarrationStep,
  isTranscriptToolPart,
  isWrongLanguageProgressNarration,
  progressNarrationKey,
  progressNarrationStep,
  type ProgressNarrationMessageKey,
  type ProgressNarrationStep,
} from "./progress-narration";

const WIDGET_TOOL_NAMES = new Set([
  "render_visual",
  "show_widget",
  "visualize:show_widget",
  "visualizer:show_widget",
]);

const WIDGET_FENCE_LANG = "show_widget|show-widget|widget|visualizer_widget";
const WIDGET_FENCE_PATTERN = new RegExp(
  "```(?:" + WIDGET_FENCE_LANG + ")\\s*\\n([\\s\\S]*?)```",
  "gi",
);
const WIDGET_FENCE_START_PATTERN = new RegExp(
  "```(?:" + WIDGET_FENCE_LANG + ")\\b[^\\n]*\\n?",
  "i",
);
const WIDGET_FENCE_OPEN_PATTERN = new RegExp(
  "```(?:" + WIDGET_FENCE_LANG + ")\\s*\\n",
  "gi",
);

type UIMessagePart = UIMessage["parts"][number];

export type TurnContentItem = {
  messageId: string;
  partIndex: number;
  index: number;
  part: UIMessagePart;
  bodySegments?: TurnBodySegment[];
};

export type TurnProcessItem = TurnContentItem;

export type TurnWidgetItem = {
  kind: "widget";
  messageId: string;
  partIndex: number;
  title: string | null;
  html: string;
  toolName: string;
  status: "running" | "completed" | "failed";
  loadingMessages: string[];
  errorText: string | null;
  artifactCopies: TurnWidgetArtifactCopy[];
};

export type TurnWidgetArtifactCopy = {
  key: string;
  label: string;
  pdf: string;
  xlsx: string;
};

export type TurnBodySegment =
  | { kind: "text"; text: string }
  | { kind: "widget"; visual: TurnWidgetItem };

export type TurnContentSegment =
  | { kind: "process"; id: string; items: TurnProcessItem[] }
  | {
      kind: "synthetic-body";
      id: string;
      messageKey: ProgressNarrationMessageKey;
      previousStep: ProgressNarrationStep | null;
      nextStep: ProgressNarrationStep;
    }
  | { kind: "body"; id: string; item: TurnContentItem; text: string }
  | { kind: "file"; id: string; item: TurnContentItem }
  | { kind: "widget"; id: string; visual: TurnWidgetItem };

export type TurnFoldSegment =
  | { kind: "hidden"; id: string; items: TurnContentItem[] }
  | { kind: "anchor"; id: string; item: TurnContentItem; text: string }
  | { kind: "process"; id: string; items: TurnProcessItem[] };

export type TurnContentPresentation = {
  anchorMessageId: string;
  streamingMessageId: string | null;
  state: TranscriptTurnState;
  turnCollapseEligible: boolean;
  finalText: string;
  segments: TurnContentSegment[];
  collapsedSegments: TurnFoldSegment[];
  processItems: TurnProcessItem[];
  hoistedItems: TurnWidgetItem[];
};

const CANCELLATION_SENTINELS = ["[User Cancelled]", "Interrupted by user"] as const;

type WidgetPayload = {
  title: string | null;
  html: string;
  loadingMessages: string[];
  artifactCopies: TurnWidgetArtifactCopy[];
};

function artifactCopies(value: unknown): TurnWidgetArtifactCopy[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = recordValue(item);
    if (!record) return [];
    const { key, label, pdf, xlsx } = record;
    if (
      typeof key !== "string" || !key.trim() ||
      typeof label !== "string" || !label.trim() ||
      typeof pdf !== "string" ||
      typeof xlsx !== "string" ||
      (!pdf.trim() && !xlsx.trim())
    ) return [];
    return [{
      key: key.trim(),
      label: label.trim(),
      pdf: pdf.trim(),
      xlsx: xlsx.trim(),
    }];
  });
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value !== "string" || !value.trim()) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return stringArray(parsed);
    } catch {
      // Fall through to the line/comma parser used by WorkBuddy payloads.
    }
  }
  return trimmed
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(/[\n,，]/g)
    .map((item) => item.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim())
    .filter(Boolean);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value));
}

function directWidgetPayload(value: unknown): WidgetPayload | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        return extractWidgetPayload(parsed);
      } catch {
        return { title: null, html: trimmed, loadingMessages: [], artifactCopies: [] };
      }
    }
    return { title: null, html: trimmed, loadingMessages: [], artifactCopies: [] };
  }

  const record = recordValue(value);
  if (!record) return null;
  const html = record.widget_code ?? record.widgetCode ?? record.html;
  const title = typeof record.title === "string" && record.title.trim()
    ? record.title.trim()
    : null;
  const loadingMessages = stringArray(
    record.loading_messages ?? record.loadingMessages,
  );
  const copies = artifactCopies(record.artifactCopies ?? record.artifact_copies);
  if (
    typeof html !== "string" &&
    !title &&
    loadingMessages.length === 0 &&
    copies.length === 0
  ) return null;
  return {
    title,
    html: typeof html === "string" ? html.trim() : "",
    loadingMessages,
    artifactCopies: copies,
  };
}

function extractWidgetPayload(value: unknown): WidgetPayload | null {
  const direct = directWidgetPayload(value);
  if (direct) return direct;

  const pending: unknown[] = [value];
  const visited = new WeakSet<object>();
  let inspected = 0;
  while (pending.length > 0 && inspected < 200) {
    inspected += 1;
    const current = pending.pop();
    if (!current) continue;
    if (typeof current === "string") {
      const trimmed = current.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        const parsedPayload = directWidgetPayload(parsed);
        if (parsedPayload) return parsedPayload;
        pending.push(parsed);
      } catch {
        // Nested result strings that are not JSON are ordinary tool output.
      }
      continue;
    }
    if (typeof current !== "object") continue;
    if (visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    for (const nested of Object.values(current)) {
      if (nested && typeof nested === "object") {
        const nestedPayload = directWidgetPayload(nested);
        if (nestedPayload) return nestedPayload;
        pending.push(nested);
      } else if (typeof nested === "string" && nested.trim().startsWith("{")) {
        pending.push(nested);
      }
    }
  }
  return null;
}

function parseWidgetPayload(value: unknown): WidgetPayload | null {
  return extractWidgetPayload(value);
}

function parseWidgetResultPayload(value: unknown): WidgetPayload | null {
  if (typeof value === "string" && !value.trim().startsWith("{")) return null;
  return extractWidgetPayload(value);
}

function isInlineWidgetCommandResult(toolName: string, value: unknown) {
  if (!/bash|shell|command|exec|terminal|repl/.test(toolName)) return false;
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    return /["']inline_?widget["']\s*:/i.test(serialized);
  } catch {
    return false;
  }
}

function widgetFromToolPart(item: TurnContentItem): TurnWidgetItem | null {
  const part = item.part;
  if (part.type !== "dynamic-tool") return null;
  const toolName = part.toolName.trim().toLowerCase();
  const outputPayload = part.state === "output-available"
    ? parseWidgetResultPayload(part.output)
    : null;
  const widgetTool = WIDGET_TOOL_NAMES.has(toolName);
  const inlineWidgetCommand = part.state === "output-available" &&
    isInlineWidgetCommandResult(toolName, part.output) &&
    Boolean(outputPayload?.html);
  if (!widgetTool && !inlineWidgetCommand) return null;
  const inputPayload = widgetTool ? parseWidgetPayload(part.input) : null;
  const payload = outputPayload ?? inputPayload;
  if (!payload && part.state === "output-available") return null;
  const inputMessages = inputPayload?.loadingMessages ?? [];
  const outputMessages = outputPayload?.loadingMessages ?? [];
  const status = part.state === "output-error"
    ? "failed"
    : part.state === "output-available"
      ? "completed"
      : "running";
  return {
    kind: "widget",
    messageId: item.messageId,
    partIndex: item.partIndex,
    title: payload?.title ?? null,
    html: payload?.html ?? "",
    toolName,
    status,
    loadingMessages: outputMessages.length > 0 ? outputMessages : inputMessages,
    errorText: part.state === "output-error" ? part.errorText : null,
    artifactCopies: payload?.artifactCopies ?? [],
  };
}

/**
 * Extract a JSON object starting at `from`, respecting strings so inner ```
 * cannot terminate an outer show_widget fence early.
 */
function extractBalancedJsonObject(
  source: string,
  from: number,
): { json: string; end: number } | null {
  let index = from;
  while (index < source.length && /\s/.test(source[index] ?? "")) index += 1;
  if (source[index] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let cursor = index; cursor < source.length; cursor += 1) {
    const char = source[cursor] ?? "";
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return { json: source.slice(index, cursor + 1), end: cursor + 1 };
      }
    }
  }
  return null;
}

function skipOptionalFenceClose(source: string, from: number): number {
  let index = from;
  while (index < source.length && /\s/.test(source[index] ?? "")) index += 1;
  if (source.startsWith("```", index)) {
    index += 3;
    while (index < source.length && source[index] !== "\n") index += 1;
    if (source[index] === "\n") index += 1;
  }
  return index;
}

function looksLikeWidgetPayloadText(payload: string): boolean {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{")) return false;
  return (
    trimmed.includes("widget_code") ||
    trimmed.includes("widgetCode") ||
    /"title"\s*:/.test(trimmed)
  );
}

function makeWidgetVisual(
  item: TurnContentItem,
  status: TurnWidgetItem["status"],
  payload: WidgetPayload | null,
): TurnWidgetItem {
  return {
    kind: "widget",
    messageId: item.messageId,
    partIndex: item.partIndex,
    title: payload?.title ?? null,
    html: payload?.html ?? "",
    toolName: "show_widget",
    status,
    loadingMessages: payload?.loadingMessages ?? [],
    errorText: null,
    artifactCopies: payload?.artifactCopies ?? [],
  };
}

function extractFencedWidgets(
  item: TurnContentItem,
  text: string,
  incompleteStatus: "running" | "failed",
) {
  const widgets: TurnWidgetItem[] = [];
  const segments: TurnBodySegment[] = [];
  const openPattern = new RegExp(
    WIDGET_FENCE_OPEN_PATTERN.source,
    WIDGET_FENCE_OPEN_PATTERN.flags,
  );
  let cursor = 0;
  let openMatch = openPattern.exec(text);
  while (openMatch) {
    const fenceStart = openMatch.index;
    const payloadStart = openMatch.index + openMatch[0].length;
    if (fenceStart > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, fenceStart) });
    }

    const balanced = extractBalancedJsonObject(text, payloadStart);
    if (balanced) {
      const widget = parseWidgetPayload(balanced.json);
      if (widget && widget.html.trim()) {
        const visual = makeWidgetVisual(item, "completed", widget);
        widgets.push(visual);
        segments.push({ kind: "widget", visual });
        cursor = skipOptionalFenceClose(text, balanced.end);
      } else if (widget || looksLikeWidgetPayloadText(balanced.json)) {
        // Parsed shell but empty/broken html — hide source, show loading/failed.
        const visual = makeWidgetVisual(item, incompleteStatus, widget);
        widgets.push(visual);
        segments.push({ kind: "widget", visual });
        cursor = skipOptionalFenceClose(text, balanced.end);
      } else {
        // Non-widget JSON after fence label — keep legacy non-greedy close if any.
        const legacy = new RegExp(WIDGET_FENCE_PATTERN.source, "i").exec(
          text.slice(fenceStart),
        );
        if (legacy) {
          segments.push({ kind: "text", text: legacy[0] });
          cursor = fenceStart + legacy[0].length;
        } else {
          const visual = makeWidgetVisual(item, incompleteStatus, null);
          widgets.push(visual);
          segments.push({ kind: "widget", visual });
          cursor = text.length;
          break;
        }
      }
    } else {
      // Incomplete JSON (still streaming or truncated) — never dump source.
      const visual = makeWidgetVisual(item, incompleteStatus, null);
      widgets.push(visual);
      segments.push({ kind: "widget", visual });
      cursor = text.length;
      break;
    }
    openPattern.lastIndex = cursor;
    openMatch = openPattern.exec(text);
  }

  const trailingText = text.slice(cursor);
  if (trailingText) {
    const incompleteMatch = WIDGET_FENCE_START_PATTERN.exec(trailingText);
    if (incompleteMatch) {
      const precedingText = trailingText.slice(0, incompleteMatch.index);
      if (precedingText) segments.push({ kind: "text", text: precedingText });
      const visual = makeWidgetVisual(item, incompleteStatus, null);
      widgets.push(visual);
      segments.push({ kind: "widget", visual });
    } else {
      segments.push({ kind: "text", text: trailingText });
    }
  }

  const withoutWidgets = segments
    .filter((segment) => segment.kind === "text")
    .map((segment) => segment.text)
    .join("")
    .trim();
  return { text: withoutWidgets, widgets, segments };
}

function itemId(item: TurnContentItem) {
  return `${item.messageId}:${item.partIndex}`;
}

function isBodyItem(item: TurnContentItem) {
  return item.part.type === "text" && item.part.text.trim().length > 0;
}

function bodyText(item: TurnContentItem) {
  return item.part.type === "text" ? item.part.text.trim() : "";
}

function stripCancellationSentinel(text: string) {
  const trimmed = text.trim();
  for (const sentinel of CANCELLATION_SENTINELS) {
    if (trimmed.endsWith(sentinel)) {
      return {
        text: trimmed.slice(0, -sentinel.length).trimEnd(),
        removed: true,
      };
    }
  }
  return { text: trimmed, removed: false };
}

function computeFoldAnchors(items: TurnContentItem[]) {
  const bodies = items.filter(isBodyItem);
  if (bodies.length === 0) return new Set<number>();
  const longestLength = Math.max(...bodies.map((item) => bodyText(item).length));
  const last = bodies.at(-1);
  return new Set(
    bodies
      .filter((item) => bodyText(item).length === longestLength || item === last)
      .map((item) => item.index),
  );
}

function buildCollapsedSegments(items: TurnContentItem[]): TurnFoldSegment[] {
  const anchorIndexes = computeFoldAnchors(items);
  const segments: TurnFoldSegment[] = [];
  let pending: TurnContentItem[] = [];

  const flush = (hasPreviousAnchor: boolean) => {
    if (pending.length === 0) return;
    const id = itemId(pending[0]);
    segments.push(hasPreviousAnchor
      ? { kind: "process", id: `process:${id}`, items: pending }
      : { kind: "hidden", id: `hidden:${id}`, items: pending });
    pending = [];
  };

  let hasPreviousAnchor = false;
  for (const item of items) {
    if (widgetFromToolPart(item)) continue;
    if (!anchorIndexes.has(item.index)) {
      pending.push(item);
      continue;
    }
    flush(hasPreviousAnchor);
    segments.push({
      kind: "anchor",
      id: `anchor:${itemId(item)}`,
      item,
      text: bodyText(item),
    });
    hasPreviousAnchor = true;
  }
  return segments;
}

function buildExpandedSegments(
  items: TurnContentItem[],
): TurnContentSegment[] {
  const segments: TurnContentSegment[] = [];
  let processItems: TurnProcessItem[] = [];
  let processTool: TurnProcessItem | null = null;
  let nextStageStart: number | null = null;
  let operationCount = 0;
  let nextOperationCovered = false;
  let previousCompletedStep: ProgressNarrationStep | null = null;
  const flushProcess = () => {
    if (processItems.length === 0) return;
    const operation = processTool;
    if (operation && !nextOperationCovered) {
      segments.push({
        kind: "synthetic-body",
        id: `synthetic-body:${itemId(operation)}`,
        messageKey: progressNarrationKey(
          operation.part,
          operationCount === 0 || !previousCompletedStep ? "start" : "continue",
        ),
        previousStep: previousCompletedStep,
        nextStep: progressNarrationStep(operation.part),
      });
    }
    segments.push({
      kind: "process",
      id: `process:${itemId(processItems[0])}`,
      items: processItems,
    });
    if (operation) {
      operationCount += 1;
      nextOperationCovered = false;
      previousCompletedStep = completedProgressNarrationStep(operation.part);
    }
    processItems = [];
    processTool = null;
    nextStageStart = null;
  };

  for (const item of items) {
    const widget = widgetFromToolPart(item);
    if (widget) {
      flushProcess();
      if (!nextOperationCovered) {
        segments.push({
          kind: "synthetic-body",
          id: `synthetic-body:${itemId(item)}`,
          messageKey: progressNarrationKey(
            item.part,
            operationCount === 0 || !previousCompletedStep ? "start" : "continue",
          ),
          previousStep: previousCompletedStep,
          nextStep: progressNarrationStep(item.part),
        });
      }
      segments.push({
        kind: "widget",
        id: `widget:${itemId(item)}`,
        visual: widget,
      });
      operationCount += 1;
      nextOperationCovered = false;
      previousCompletedStep = completedProgressNarrationStep(item.part);
      continue;
    }
    if (item.part.type === "text") {
      const text = item.part.text.trim();
      if (!text && !item.bodySegments?.some((segment) => segment.kind === "widget")) continue;
      flushProcess();
      segments.push({ kind: "body", id: `body:${itemId(item)}`, item, text });
      nextOperationCovered = true;
      continue;
    }
    if (item.part.type === "file") {
      flushProcess();
      segments.push({ kind: "file", id: `file:${itemId(item)}`, item });
      continue;
    }
    if (item.part.type === "reasoning" && processTool && nextStageStart === null) {
      nextStageStart = processItems.length;
    }
    if (isTranscriptToolPart(item.part) && processTool) {
      if (nextStageStart !== null) {
        const nextItems = processItems.slice(nextStageStart);
        processItems = processItems.slice(0, nextStageStart);
        flushProcess();
        processItems = nextItems;
      } else {
        flushProcess();
      }
    }
    if (item.part.type !== "step-start") {
      processItems.push(item);
      if (isTranscriptToolPart(item.part)) processTool = item;
    }
  }
  flushProcess();
  return segments;
}

export function buildTurnContentPresentation(
  turn: TranscriptTurn,
  options: { locale?: Locale } = {},
): TurnContentPresentation | null {
  if (turn.state === "pending" || turn.assistantMessages.length === 0) return null;

  const indexedParts: TurnContentItem[] = turn.assistantMessages.flatMap((message) =>
    message.parts.map((part, partIndex) => ({
      messageId: message.id,
      partIndex,
      index: 0,
      part,
    })),
  ).map((item, index) => ({ ...item, index }));

  const hoistedItems: TurnWidgetItem[] = [];
  const renderItems: TurnContentItem[] = [];
  let removedCancellationSentinel = false;
  for (const item of indexedParts) {
    const widget = widgetFromToolPart(item);
    if (widget) {
      hoistedItems.push(widget);
      renderItems.push(item);
      continue;
    }
    if (item.part.type === "text") {
      const normalized = turn.state === "cancelled"
        ? stripCancellationSentinel(item.part.text)
        : { text: item.part.text, removed: false };
      removedCancellationSentinel ||= normalized.removed;
      const incompleteWidgetStatus = turn.state === "streaming" || turn.state === "awaiting-approval"
        ? "running"
        : "failed";
      const fenced = extractFencedWidgets(item, normalized.text, incompleteWidgetStatus);
      if (!fenced.text && fenced.widgets.length === 0) continue;
      renderItems.push({
        ...item,
        part: { ...item.part, text: fenced.text },
        bodySegments: fenced.widgets.length > 0 ? fenced.segments : undefined,
      });
      continue;
    }
    renderItems.push(item);
  }

  const locale = options.locale ?? "en";
  const publicRenderItems = renderItems.filter((item, index) => {
    if (
      item.part.type !== "text" ||
      !isWrongLanguageProgressNarration(item.part.text, locale)
    ) {
      return true;
    }
    return !renderItems.slice(index + 1).some((laterItem) => (
      isTranscriptToolPart(laterItem.part) || widgetFromToolPart(laterItem) !== null
    ));
  });

  const bodyItems = publicRenderItems.filter(isBodyItem);
  const finalText = bodyItems.length > 0 ? bodyText(bodyItems.at(-1)!) : "";
  const processItems = publicRenderItems.filter((item) => (
    item.part.type !== "text" &&
    item.part.type !== "file" &&
    item.part.type !== "step-start" &&
    !widgetFromToolPart(item)
  ));
  const hasInlineWidget = publicRenderItems.some((item) =>
    item.bodySegments?.some((segment) => segment.kind === "widget") === true
  );
  if (
    processItems.length === 0 &&
    publicRenderItems.length <= 1 &&
    hoistedItems.length === 0 &&
    !hasInlineWidget &&
    !removedCancellationSentinel
  ) {
    return null;
  }

  const terminal = turn.state === "completed" ||
    turn.state === "cancelled" ||
    turn.state === "failed";
  const contentCount = publicRenderItems.filter((item) => item.part.type !== "step-start").length;
  const turnCollapseEligible = terminal && bodyItems.length > 0 && contentCount > 1;

  return {
    anchorMessageId: turn.assistantMessages[0]!.id,
    streamingMessageId:
      turn.state === "streaming" || turn.state === "awaiting-approval"
        ? turn.assistantMessages.at(-1)?.id ?? null
        : null,
    state: turn.state,
    turnCollapseEligible,
    finalText,
    segments: buildExpandedSegments(publicRenderItems),
    collapsedSegments: buildCollapsedSegments(publicRenderItems),
    processItems,
    hoistedItems,
  };
}
