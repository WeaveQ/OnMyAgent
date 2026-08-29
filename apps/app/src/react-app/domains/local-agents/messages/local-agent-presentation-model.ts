import type {
  PersonalLocalAgentConversationMessage,
  PersonalLocalAgentRunEvent,
  PersonalLocalAgentRunResult,
} from "../../../../app/lib/desktop";

export type LocalAgentPresentationSegmentKind =
  | "user"
  | "assistant"
  | "final"
  | "thinking"
  | "plan"
  | "tool"
  | "approval"
  | "error"
  | "artifact"
  | "file-change"
  | "system";

export type LocalAgentPresentationActivity =
  | "idle"
  | "running"
  | "thinking"
  | "tool"
  | "waiting-approval"
  | "responding"
  | "completed"
  | "failed"
  | "cancelled"
  | "missing";

export type LocalAgentPresentationSource =
  | PersonalLocalAgentConversationMessage
  | PersonalLocalAgentRunEvent;

export type LocalAgentPresentationSegment = {
  id: string;
  index: number;
  kind: LocalAgentPresentationSegmentKind;
  text: string;
  source: LocalAgentPresentationSource;
  terminal: boolean;
};

export type LocalAgentPresentation = {
  segments: LocalAgentPresentationSegment[];
  processSegments: LocalAgentPresentationSegment[];
  finalSegment: LocalAgentPresentationSegment | null;
  finalText: string;
  activity: LocalAgentPresentationActivity;
  terminal: boolean;
  waitingForApproval: boolean;
  hasVisibleContent: boolean;
};

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled", "missing"]);
const TERMINAL_MESSAGE_STATUSES = new Set(["completed", "failed", "cancelled", "canceled", "done"]);
const ASSISTANT_BODY_TYPES = new Set(["text", "content", "assistant"]);

function textValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function meaningfulText(value: unknown): string {
  return textValue(value).trim();
}

function sourceType(source: LocalAgentPresentationSource): string {
  return textValue(source.type).trim().toLowerCase();
}

function sourceRole(source: LocalAgentPresentationSource): string {
  return textValue("role" in source ? source.role : "").trim().toLowerCase();
}

function sourceStatus(source: LocalAgentPresentationSource): string {
  const messageStatus = textValue(source.status).trim().toLowerCase();
  const toolStatus = textValue(source.toolCall?.status).trim().toLowerCase();
  const updateState = source.update && "state" in source.update ? source.update.state : undefined;
  const updateStatus = textValue(source.update?.status ?? updateState).trim().toLowerCase();
  return updateStatus || toolStatus || messageStatus;
}

function isTerminalSource(source: LocalAgentPresentationSource): boolean {
  const status = sourceStatus(source);
  return TERMINAL_MESSAGE_STATUSES.has(status) || sourceType(source) === "finish";
}

function sourceId(source: LocalAgentPresentationSource, index: number): string {
  const id = textValue("id" in source ? source.id : "").trim();
  if (id) return id;
  const messageId = textValue("msgId" in source ? source.msgId : "").trim();
  if (messageId) return `${sourceType(source) || "message"}:${messageId}`;
  const at = Number("at" in source ? source.at : "createdAt" in source ? source.createdAt : 0);
  return `${sourceType(source) || "message"}:${Number.isFinite(at) ? at : index}:${index}`;
}

function sourceText(source: LocalAgentPresentationSource): string {
  return textValue(source.text);
}

function segmentKind(source: LocalAgentPresentationSource): LocalAgentPresentationSegmentKind | null {
  const type = sourceType(source);
  const role = sourceRole(source);
  if (type === "user" || role === "user") return "user";
  if (type === "finish") return "final";
  if (type === "thinking" || type === "thought" || role === "thinking") return "thinking";
  if (
    type === "plan"
    || ("plan" in source && Boolean(source.plan?.entries?.length))
    || ("entries" in source && Boolean(source.entries?.length))
  ) return "plan";
  if (type === "tool" || type === "acp_tool_call" || type === "tool_group" || role === "tool") return "tool";
  if (type === "permission" || type === "approval_request" || type === "approval_decision" || source.approval) return "approval";
  if (type === "error" || (type === "tips" && textValue(source.category).toLowerCase() === "error")) return "error";
  if (type === "artifact" || ("artifact" in source && source.artifact)) return "artifact";
  if (type === "file_change" || type === "file-change") return "file-change";
  if (ASSISTANT_BODY_TYPES.has(type) && role === "assistant") return "assistant";
  if (type === "assistant_chunk" || type === "chunk") return "assistant";
  if (type === "text" || type === "content") return role === "user" ? "user" : "assistant";
  if (type === "status" || type === "agent_status" || type === "available_commands" || type === "context_usage") return "system";
  if (meaningfulText(sourceText(source))) return "system";
  return null;
}

function fallbackEventSources(run: PersonalLocalAgentRunResult): LocalAgentPresentationSource[] {
  return run.events.map((event) => event);
}

function conversationSources(run: PersonalLocalAgentRunResult): LocalAgentPresentationSource[] {
  if (run.conversationMessages?.length) return run.conversationMessages;
  return fallbackEventSources(run);
}

function buildSegments(run: PersonalLocalAgentRunResult): LocalAgentPresentationSegment[] {
  return conversationSources(run).flatMap((source, index) => {
    const kind = segmentKind(source);
    if (!kind) return [];
    const text = sourceText(source);
    if (!meaningfulText(text) && kind !== "tool" && kind !== "approval" && kind !== "plan" && kind !== "artifact" && kind !== "file-change") return [];
    return [{
      id: sourceId(source, index),
      index,
      kind,
      text,
      source,
      terminal: isTerminalSource(source),
    }];
  });
}

function activeTool(segments: LocalAgentPresentationSegment[]): boolean {
  return segments.some((segment) => {
    if (segment.kind !== "tool") return false;
    const status = sourceStatus(segment.source);
    return status === "running" || status === "pending" || status === "in_progress" || status === "executing" || !segment.terminal;
  });
}

function activeThinking(segments: LocalAgentPresentationSegment[]): boolean {
  return segments.some((segment) => {
    if (segment.kind !== "thinking" && segment.kind !== "plan") return false;
    const status = sourceStatus(segment.source);
    return !status || status === "running" || status === "thinking" || status === "in_progress" || status === "pending";
  });
}

function finalSegment(segments: LocalAgentPresentationSegment[]): LocalAgentPresentationSegment | null {
  return [...segments].reverse().find((segment) => segment.kind === "final" && meaningfulText(segment.text))
    ?? [...segments].reverse().find((segment) => segment.kind === "assistant" && meaningfulText(segment.text))
    ?? null;
}

function finalTextForRun(run: PersonalLocalAgentRunResult, segments: LocalAgentPresentationSegment[], final: LocalAgentPresentationSegment | null): string {
  if (final) return final.text.trim();
  const output = meaningfulText(run.output);
  if (output) return output;
  const chunks = run.events
    .filter((event) => event.type === "assistant_chunk" || event.type === "chunk")
    .map((event) => event.text)
    .filter((text) => meaningfulText(text));
  if (chunks.length) return chunks.join("\n").trim();
  return [...segments].reverse().find((segment) => segment.kind === "assistant" && meaningfulText(segment.text))?.text.trim() ?? "";
}

function deriveActivity(
  run: PersonalLocalAgentRunResult,
  segments: LocalAgentPresentationSegment[],
): LocalAgentPresentationActivity {
  if (run.pendingApprovals?.length) return "waiting-approval";
  if (run.status === "failed") return "failed";
  if (run.status === "cancelled") return "cancelled";
  if (run.status === "missing") return "missing";
  if (activeTool(segments)) return "tool";
  if (activeThinking(segments)) return "thinking";
  if (run.status === "running" && finalTextForRun(run, segments, finalSegment(segments))) return "responding";
  if (run.status === "running") return "running";
  if (run.status === "completed") return "completed";
  return "idle";
}

export function buildLocalAgentPresentation(run: PersonalLocalAgentRunResult | null | undefined): LocalAgentPresentation {
  if (!run) {
    return {
      segments: [],
      processSegments: [],
      finalSegment: null,
      finalText: "",
      activity: "idle",
      terminal: false,
      waitingForApproval: false,
      hasVisibleContent: false,
    };
  }
  const segments = buildSegments(run);
  const final = finalSegment(segments);
  const finalText = finalTextForRun(run, segments, final);
  const terminal = TERMINAL_RUN_STATUSES.has(run.status);
  const processSegments = segments.filter((segment) => segment.kind !== "user" && segment.kind !== "final" && segment.kind !== "assistant");
  return {
    segments,
    processSegments,
    finalSegment: final,
    finalText,
    activity: deriveActivity(run, segments),
    terminal,
    waitingForApproval: Boolean(run.pendingApprovals?.length),
    hasVisibleContent: Boolean(segments.length || finalText || meaningfulText(run.error)),
  };
}
