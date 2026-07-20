import type { UIMessage } from "ai";

import type { TranscriptTurn, TranscriptTurnState } from "./turn-model";

const WIDGET_TOOL_NAMES = new Set([
  "render_visual",
  "show_widget",
  "visualize:show_widget",
  "visualizer:show_widget",
]);

const WIDGET_FENCE_PATTERN = /```(?:show_widget|show-widget|widget|visualizer_widget)\s*\n([\s\S]*?)```/gi;

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
};

export type TurnBodySegment =
  | { kind: "text"; text: string }
  | { kind: "widget"; visual: TurnWidgetItem };

export type TurnContentSegment =
  | { kind: "process"; id: string; items: TurnProcessItem[] }
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
};

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
        return { title: null, html: trimmed, loadingMessages: [] };
      }
    }
    return { title: null, html: trimmed, loadingMessages: [] };
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
  if (typeof html !== "string" && !title && loadingMessages.length === 0) return null;
  return {
    title,
    html: typeof html === "string" ? html.trim() : "",
    loadingMessages,
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

function widgetFromToolPart(item: TurnContentItem): TurnWidgetItem | null {
  const part = item.part;
  if (part.type !== "dynamic-tool") return null;
  const toolName = part.toolName.trim().toLowerCase();
  if (!WIDGET_TOOL_NAMES.has(toolName)) return null;
  const outputPayload = part.state === "output-available"
    ? parseWidgetResultPayload(part.output)
    : null;
  const inputPayload = parseWidgetPayload(part.input);
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
  };
}

function extractFencedWidgets(item: TurnContentItem, text: string) {
  const widgets: TurnWidgetItem[] = [];
  const segments: TurnBodySegment[] = [];
  const pattern = new RegExp(WIDGET_FENCE_PATTERN.source, WIDGET_FENCE_PATTERN.flags);
  let cursor = 0;
  let match = pattern.exec(text);
  while (match) {
    const precedingText = text.slice(cursor, match.index);
    if (precedingText) segments.push({ kind: "text", text: precedingText });
    const payload = match[1] ?? "";
    const widget = parseWidgetPayload(payload);
    if (widget) {
      const visual: TurnWidgetItem = {
        kind: "widget",
        messageId: item.messageId,
        partIndex: item.partIndex,
        title: widget.title,
        html: widget.html,
        toolName: "show_widget",
        status: "completed",
        loadingMessages: widget.loadingMessages,
        errorText: null,
      };
      widgets.push(visual);
      segments.push({ kind: "widget", visual });
    } else {
      segments.push({ kind: "text", text: match[0] });
    }
    cursor = match.index + match[0].length;
    match = pattern.exec(text);
  }
  const trailingText = text.slice(cursor);
  if (trailingText) segments.push({ kind: "text", text: trailingText });
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
  state: TranscriptTurnState,
): TurnContentSegment[] {
  const segments: TurnContentSegment[] = [];
  let processItems: TurnProcessItem[] = [];
  const flushProcess = (groupConsecutive = true) => {
    if (processItems.length === 0) return;
    if (groupConsecutive || processItems.length === 1) {
      segments.push({
        kind: "process",
        id: `process:${itemId(processItems[0])}`,
        items: processItems,
      });
    } else {
      for (const item of processItems) {
        segments.push({
          kind: "process",
          id: `process:${itemId(item)}`,
          items: [item],
        });
      }
    }
    processItems = [];
  };

  for (const item of items) {
    const widget = widgetFromToolPart(item);
    if (widget) {
      flushProcess();
      segments.push({
        kind: "widget",
        id: `widget:${itemId(item)}`,
        visual: widget,
      });
      continue;
    }
    if (item.part.type === "text") {
      const text = item.part.text.trim();
      if (!text && !item.bodySegments?.some((segment) => segment.kind === "widget")) continue;
      flushProcess();
      segments.push({ kind: "body", id: `body:${itemId(item)}`, item, text });
      continue;
    }
    if (item.part.type === "file") {
      flushProcess();
      segments.push({ kind: "file", id: `file:${itemId(item)}`, item });
      continue;
    }
    if (
      item.part.type === "dynamic-tool" &&
      ["todowrite", "todoread", "todo_write", "plancreate", "planupdate"].includes(
        item.part.toolName.toLowerCase(),
      )
    ) {
      flushProcess();
      segments.push({
        kind: "process",
        id: `process:${itemId(item)}`,
        items: [item],
      });
      continue;
    }
    // WorkBuddy groups consecutive foldable items behind one outer summary.
    // A live trailing run stays as individual reasoning/tool disclosures until
    // a following body (or turn completion) makes that run foldable.
    if (item.part.type !== "step-start") {
      processItems.push(item);
    }
  }
  const running = state === "streaming" || state === "awaiting-approval";
  flushProcess(!running);
  return segments;
}

export function buildTurnContentPresentation(
  turn: TranscriptTurn,
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
      const fenced = extractFencedWidgets(item, normalized.text);
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

  const bodyItems = renderItems.filter(isBodyItem);
  const finalText = bodyItems.length > 0 ? bodyText(bodyItems.at(-1)!) : "";
  const processItems = renderItems.filter((item) => (
    item.part.type !== "text" &&
    item.part.type !== "file" &&
    item.part.type !== "step-start" &&
    !widgetFromToolPart(item)
  ));
  const hasInlineWidget = renderItems.some((item) =>
    item.bodySegments?.some((segment) => segment.kind === "widget") === true
  );
  if (
    processItems.length === 0 &&
    renderItems.length <= 1 &&
    hoistedItems.length === 0 &&
    !hasInlineWidget &&
    !removedCancellationSentinel
  ) {
    return null;
  }

  const terminal = turn.state === "completed" ||
    turn.state === "cancelled" ||
    turn.state === "failed";
  const contentCount = renderItems.filter((item) => item.part.type !== "step-start").length;
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
    segments: buildExpandedSegments(renderItems, turn.state),
    collapsedSegments: buildCollapsedSegments(renderItems),
    processItems,
    hoistedItems,
  };
}
