import {
  redactSensitiveText,
  safeStructuredText,
  safeText,
} from "./durable-redaction.mjs";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const MAX_EVENT_SCAN = 5_000;
const MAX_TOOL_FIELD_CHARS = 8_000;

function bounded(value, limit = MAX_TOOL_FIELD_CHARS) {
  return redactSensitiveText(value, limit);
}

function normalizedStatus(value) {
  const status = safeText(value).trim().toLowerCase().replaceAll("_", "-");
  if (["complete", "completed", "success", "succeeded", "done"].includes(status)) return "completed";
  if (["fail", "failed", "error"].includes(status)) return "failed";
  if (["cancel", "canceled", "cancelled"].includes(status)) return "cancelled";
  return status;
}

function contentText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => item?.content?.text ?? item?.text ?? item?.content ?? "")
    .map((item) => safeStructuredText(item))
    .filter(Boolean)
    .join("\n");
}

function integer(value) {
  return Number.isInteger(value) ? value : null;
}

function structuredExitCode(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const candidates = [
      source.exitCode,
      source.exit_code,
      source.rawOutput?.exitCode,
      source.rawOutput?.exit_code,
      source.raw_output?.exitCode,
      source.raw_output?.exit_code,
      source._meta?.terminal_exit?.exitCode,
      source._meta?.terminal_exit?.exit_code,
    ];
    for (const candidate of candidates) {
      const parsed = integer(candidate);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function toolCandidate(event) {
  if (event?.type !== "tool" && event?.type !== "acp_tool_call") return null;
  const toolCall = event.toolCall && typeof event.toolCall === "object" ? event.toolCall : null;
  const update = event.update && typeof event.update === "object" ? event.update : null;
  const id = safeText(
    toolCall?.id
      ?? toolCall?.callId
      ?? update?.toolCallId
      ?? update?.tool_call_id
      ?? update?.id
      ?? "",
  ).trim().slice(0, 240);
  if (!id) return null;
  const rawInput = update?.rawInput ?? update?.raw_input ?? update?.input;
  const rawOutput = update?.output
    ?? update?.rawOutput?.formatted_output
    ?? update?.raw_output?.formatted_output
    ?? contentText(update?.content);
  return {
    id,
    name: bounded(toolCall?.name ?? update?.title ?? update?.name ?? "tool", 240),
    kind: bounded(toolCall?.kind ?? update?.kind ?? "", 120),
    status: normalizedStatus(toolCall?.status ?? update?.status ?? update?.state),
    input: bounded(toolCall?.input ?? rawInput),
    output: bounded(toolCall?.output ?? rawOutput),
    exitCode: structuredExitCode(toolCall, update, event.data),
  };
}

function mergeTool(previous, next) {
  return {
    id: next.id,
    name: next.name || previous?.name || "tool",
    kind: next.kind || previous?.kind || "",
    status: next.status || previous?.status || "",
    input: next.input || previous?.input || "",
    output: next.output || previous?.output || "",
    exitCode: TERMINAL_STATUSES.has(next.status)
      ? next.exitCode
      : next.exitCode ?? previous?.exitCode ?? null,
  };
}

function evidenceKind(tool) {
  const descriptor = `${tool.name} ${tool.kind} ${tool.input}`.toLowerCase();
  if (/\b(test|tests|jest|vitest|pytest|mocha)\b/.test(descriptor)) return "test";
  if (tool.kind === "execute" || /\b(bash|shell|command|terminal|exec)\b/.test(descriptor)) return "command";
  return "message";
}

function terminalToolEvidence(events) {
  const merged = new Map();
  const terminal = new Map();
  for (const event of (Array.isArray(events) ? events : []).slice(-MAX_EVENT_SCAN)) {
    const candidate = toolCandidate(event);
    if (!candidate) continue;
    const state = mergeTool(merged.get(candidate.id), candidate);
    merged.set(candidate.id, state);
    if (TERMINAL_STATUSES.has(state.status)) terminal.set(candidate.id, { ...state });
  }
  return [...terminal.values()].map((tool) => ({
    kind: evidenceKind(tool),
    provenance: "runtime-observed",
    label: bounded(`${tool.name} (${tool.status})`, 240) || "Runtime tool",
    value: bounded({
      toolCallId: tool.id,
      tool: tool.name,
      kind: tool.kind || null,
      status: tool.status,
      input: tool.input,
      output: tool.output,
    }, 24_000),
    status: tool.status === "completed" ? "passed" : "failed",
    exitCode: tool.exitCode,
    path: null,
  }));
}

export function runtimeEvidence(snapshot) {
  const evidence = terminalToolEvidence(snapshot?.events);
  for (const change of Array.isArray(snapshot?.fileChanges) ? snapshot.fileChanges : []) {
    const candidatePath = bounded(typeof change === "string"
      ? change
      : change?.path ?? change?.filePath ?? "", 4_096).trim();
    evidence.push({
      kind: "file",
      provenance: "runtime-observed",
      label: bounded(candidatePath || "Observed file change", 240),
      value: bounded(change, 24_000),
      status: "info",
      exitCode: null,
      path: candidatePath || null,
    });
  }
  for (const artifact of Array.isArray(snapshot?.artifacts) ? snapshot.artifacts : []) {
    evidence.push({
      kind: "message",
      provenance: "runtime-observed",
      label: bounded(artifact?.title ?? artifact?.name ?? "", 240).trim() || "Runtime artifact",
      value: bounded(artifact, 24_000),
      status: "info",
      exitCode: null,
      path: null,
    });
  }
  return evidence.slice(0, 100);
}
