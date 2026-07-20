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

export type TurnContentSegment =
  | { kind: "process"; id: string; items: TurnProcessItem[] }
  | { kind: "body"; id: string; item: TurnContentItem; text: string }
  | { kind: "file"; id: string; item: TurnContentItem };

export type TurnFoldSegment =
  | { kind: "hidden"; id: string; items: TurnContentItem[] }
  | { kind: "anchor"; id: string; item: TurnContentItem; text: string }
  | { kind: "process"; id: string; items: TurnProcessItem[] };

export type TurnContentPresentation = {
  anchorMessageId: string;
  state: TranscriptTurnState;
  finalText: string;
  segments: TurnContentSegment[];
  collapsedSegments: TurnFoldSegment[];
  processItems: TurnProcessItem[];
  hoistedItems: TurnWidgetItem[];
};

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
  const withoutWidgets = text.replace(WIDGET_FENCE_PATTERN, (_match, payload: string) => {
    const widget = parseWidgetPayload(payload);
    if (widget) {
      widgets.push({
        kind: "widget",
        messageId: item.messageId,
        partIndex: item.partIndex,
        title: widget.title,
        html: widget.html,
        toolName: "show_widget",
        status: "completed",
        loadingMessages: widget.loadingMessages,
        errorText: null,
      });
    }
    return "";
  });
  return { text: withoutWidgets.trim(), widgets };
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
  flush(hasPreviousAnchor);
  return segments;
}

function buildExpandedSegments(items: TurnContentItem[]): TurnContentSegment[] {
  const segments: TurnContentSegment[] = [];
  let processItems: TurnProcessItem[] = [];
  const flushProcess = () => {
    if (processItems.length === 0) return;
    segments.push({
      kind: "process",
      id: `process:${itemId(processItems[0])}`,
      items: processItems,
    });
    processItems = [];
  };

  for (const item of items) {
    if (item.part.type === "text") {
      const text = item.part.text.trim();
      if (!text) continue;
      flushProcess();
      segments.push({ kind: "body", id: `body:${itemId(item)}`, item, text });
      continue;
    }
    if (item.part.type === "reasoning") {
      const text = item.part.text.trim();
      if (!text) continue;
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
    // One tool (or non-text process unit) per segment so the timeline shows
    // WorkBuddy-style op chips instead of a single "收集资料" mega-fold.
    if (item.part.type !== "step-start") {
      flushProcess();
      processItems.push(item);
      flushProcess();
    }
  }
  flushProcess();
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
  for (const item of indexedParts) {
    const widget = widgetFromToolPart(item);
    if (widget) {
      hoistedItems.push(widget);
      continue;
    }
    if (item.part.type === "text") {
      const fenced = extractFencedWidgets(item, item.part.text);
      hoistedItems.push(...fenced.widgets);
      if (!fenced.text) continue;
      renderItems.push({ ...item, part: { ...item.part, text: fenced.text } });
      continue;
    }
    renderItems.push(item);
  }

  const bodyItems = renderItems.filter(isBodyItem);
  const finalText = bodyItems.length > 0 ? bodyText(bodyItems.at(-1)!) : "";
  const processItems = renderItems.filter((item) => (
    item.part.type !== "text" && item.part.type !== "file" && item.part.type !== "step-start"
  ));
  if (processItems.length === 0 && renderItems.length <= 1 && hoistedItems.length === 0) {
    return null;
  }

  return {
    anchorMessageId: turn.assistantMessages[0]!.id,
    state: turn.state,
    finalText,
    segments: buildExpandedSegments(renderItems),
    collapsedSegments: buildCollapsedSegments(renderItems),
    processItems,
    hoistedItems,
  };
}
