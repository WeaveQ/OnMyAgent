import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import type {
  SessionArchiveAgent,
  SessionArchiveMessage,
  SessionArchiveSession,
  SessionArchiveToolCall,
  SessionArchiveUsageEvent,
} from "@onmyagent/types/session-archive";
import {
  sessionArchiveRegistry,
  type SessionArchiveRegistryEntry,
} from "./session-archive-registry.js";

export { sessionArchiveSources, sessionArchiveRegistry } from "./session-archive-registry.js";

export type SessionArchiveParseResult = {
  session: SessionArchiveSession;
  messages: SessionArchiveMessage[];
  usageEvents: SessionArchiveUsageEvent[];
  sourcePath: string;
};

export type SessionArchiveParser = {
  agent: SessionArchiveAgent;
  parseFile: (path: string, options?: SessionArchiveParserOptions) => Promise<SessionArchiveParseResult | null>;
};

export type SessionArchiveParserOptions = {
  machine?: string;
  project?: string;
  sourceMtimeMs?: number;
  sourceHash?: string;
  sourceInode?: number;
  sourceDevice?: number;
};

const parserByAgent = new Map<SessionArchiveAgent, SessionArchiveParser>(
  sessionArchiveRegistry.filter((entry) => entry.fileBased).map((entry) => [
    entry.agent,
    { agent: entry.agent, parseFile: createParserForAgent(entry) },
  ]),
);

export const sessionArchiveDedicatedParserAgents: readonly SessionArchiveAgent[] = [
  "claude",
  "codex",
  "opencode",
  "kilo",
  "mimocode",
  "hermes",
  "openclaw",
  "qclaw",
  "gemini",
  "kiro",
  "kimi",
  "qwen",
  "pi",
  "omp",
  "qwenpaw",
  "reasonix",
  "aider",
  "grok",
  "workbuddy",
] as const;

export const sessionArchiveGenericParserAgents = sessionArchiveRegistry
  .filter((entry) => entry.fileBased && !sessionArchiveDedicatedParserAgents.includes(entry.agent))
  .map((entry) => entry.agent) satisfies SessionArchiveAgent[];

export function sessionArchiveParserForAgent(agent: SessionArchiveAgent): SessionArchiveParser | null {
  return parserByAgent.get(agent) ?? null;
}

export async function discoverSessionArchiveSessionFiles(input: {
  agent: SessionArchiveAgent;
  root: string;
}): Promise<string[]> {
  const agent = input.agent;
  if (agent === "aider") {
    return discoverAiderSessionFiles(input.root);
  }
  if (agent === "codex") {
    return walkFiles(input.root, (path) => extname(path) === ".jsonl" && basename(path) !== "session_index.jsonl");
  }
  if (agent === "opencode" || agent === "kilo") {
    return walkFiles(join(input.root, "storage", "session"), (path) => extname(path) === ".json");
  }
  if (agent === "mimocode") {
    return walkFiles(join(input.root, "storage", "session_diff"), (path) => extname(path) === ".json");
  }
  if (agent === "openclaw" || agent === "qclaw") {
    return walkFiles(input.root, (path) => path.endsWith(`${sep}sessions${sep}${basename(path)}`) && extname(path) === ".jsonl");
  }
  if (agent === "kimi") {
    return walkFiles(input.root, (path) => basename(path) === "wire.jsonl");
  }
  if (agent === "qwen") {
    return walkFiles(input.root, (path) => path.includes(`${sep}chats${sep}`) && extname(path) === ".jsonl");
  }
  if (agent === "pi" || agent === "omp") {
    return walkFiles(input.root, (path) => extname(path) === ".jsonl");
  }
  if (agent === "qwenpaw") {
    return discoverQwenPawSessionFiles(input.root);
  }
  if (agent === "reasonix") {
    return walkFiles(input.root, (path) => extname(path) === ".jsonl");
  }
  if (agent === "kiro") {
    return walkFiles(input.root, (path) => dirname(path) === input.root && extname(path) === ".jsonl");
  }
  if (agent === "hermes") {
    return walkFiles(input.root, (path) => [".jsonl", ".json"].includes(extname(path)));
  }
  if (agent === "grok") {
    // ~/.grok/sessions/<workspace>/<sessionId>/chat_history.jsonl
    return walkFiles(input.root, (path) => basename(path) === "chat_history.jsonl");
  }
  if (agent === "workbuddy") {
    // ~/.workbuddy/projects/<project>/<sessionId>.jsonl
    return walkFiles(input.root, (path) => extname(path) === ".jsonl");
  }
  return walkFiles(input.root, (path) => [".jsonl", ".json"].includes(extname(path)));
}

function createParserForAgent(entry: SessionArchiveRegistryEntry): SessionArchiveParser["parseFile"] {
  if (entry.agent === "claude") return parseClaudeFile;
  if (entry.agent === "codex") return parseCodexFile;
  if (entry.agent === "opencode" || entry.agent === "kilo" || entry.agent === "mimocode") {
    return (path, options) => parseOpenCodeLikeFile(path, entry, options);
  }
  if (entry.agent === "hermes") return parseHermesFile;
  if (entry.agent === "openclaw" || entry.agent === "qclaw") {
    return (path, options) => parseOpenClawLikeFile(path, entry, options);
  }
  if (entry.agent === "gemini") return parseGeminiFile;
  if (entry.agent === "kiro") return parseKiroFile;
  if (entry.agent === "kimi") return parseKimiFile;
  if (entry.agent === "qwen") return parseQwenFile;
  if (entry.agent === "pi" || entry.agent === "omp") {
    return (path, options) => parsePiLikeFile(path, entry, options);
  }
  if (entry.agent === "qwenpaw") return parseQwenPawFile;
  if (entry.agent === "reasonix") return parseReasonixFile;
  if (entry.agent === "aider") return parseAiderFile;
  if (entry.agent === "grok") return parseGrokFile;
  if (entry.agent === "workbuddy") return parseWorkBuddyFile;
  return (path, options) => parseGenericAgentFile(path, entry, options);
}

async function parseClaudeFile(path: string, options: SessionArchiveParserOptions = {}) {
  const rows = await readJsonLines(path);
  const messages: SessionArchiveMessage[] = [];
  let cwd = "";
  for (const row of rows) {
    const type = stringValue(row, "type");
    const message = objectValue(row, "message");
    const role = stringValue(message, "role") || type;
    if (type !== "user" && type !== "assistant" && role !== "user" && role !== "assistant") continue;
    if (!cwd) cwd = stringValue(row, "cwd");
    const contentValue = Reflect.get(message, "content");
    const extracted = extractContent(contentValue);
    const content = extracted.text.trim();
    if (!content && extracted.toolCalls.length === 0) continue;
    messages.push(makeMessage({
      id: messages.length + 1,
      sessionId: sessionIdFromFilename(path),
      ordinal: messages.length,
      role: role === "assistant" ? "assistant" : "user",
      content,
      timestamp: stringValue(row, "timestamp"),
      thinkingText: extracted.thinkingText,
      toolCalls: extracted.toolCalls,
      model: stringValue(message, "model"),
      tokenUsage: objectValue(message, "usage"),
      claudeMessageId: stringValue(message, "id"),
      claudeRequestId: stringValue(row, "requestId") || stringValue(row, "request_id"),
      sourceType: type,
      sourceUuid: stringValue(row, "uuid"),
      sourceParentUuid: stringValue(row, "parentUuid"),
      isSidechain: row && typeof row === "object" ? Boolean(Reflect.get(row as object, "isSidechain")) : false,
    }));
  }
  return buildParseResult({ path, agent: "claude", id: sessionIdFromFilename(path), messages, cwd, options });
}

async function parseCodexFile(path: string, options: SessionArchiveParserOptions = {}) {
  const rows = await readJsonLines(path);
  const messages: SessionArchiveMessage[] = [];
  let rawId = sessionIdFromFilename(path);
  let cwd = "";
  let model = "";
  for (const row of rows) {
    const type = stringValue(row, "type");
    const payload = objectValue(row, "payload");
    if (type === "session_meta") {
      rawId = stringValue(payload, "id") || rawId;
      cwd = stringValue(payload, "cwd") || cwd;
      model = stringValue(payload, "model") || model;
      continue;
    }
    if (type === "turn_context") {
      model = stringValue(payload, "model") || model;
      continue;
    }
    if (type === "event_msg") {
      const usage = codexLastTokenUsage(payload);
      if (usage) {
        const timestamp = stringValue(row, "timestamp");
        messages.push(makeMessage({
          id: messages.length + 1,
          sessionId: `codex:${rawId}`,
          ordinal: messages.length,
          role: "system",
          content: "Token usage",
          timestamp,
          model,
          tokenUsage: usage,
          isSystem: true,
          sourceSubtype: "token_count",
          sourceType: type,
        }));
      }
      continue;
    }
    if (type !== "response_item") continue;
    if (stringValue(payload, "type") === "model_info") {
      model = stringValue(payload, "model") || model;
      continue;
    }
    const role = stringValue(payload, "role");
    if (role !== "user" && role !== "assistant") continue;
    const extracted = extractContent(Reflect.get(payload, "content"));
    if (!extracted.text && extracted.toolCalls.length === 0) continue;
    messages.push(makeMessage({
      id: messages.length + 1,
      sessionId: `codex:${rawId}`,
      ordinal: messages.length,
      role,
      content: extracted.text,
      timestamp: stringValue(row, "timestamp"),
      thinkingText: extracted.thinkingText,
      toolCalls: extracted.toolCalls,
      model,
      sourceType: type,
      sourceUuid: stringValue(payload, "id"),
    }));
  }
  const threadName = await lookupCodexThreadName(path, rawId);
  return buildParseResult({ path, agent: "codex", id: `codex:${rawId}`, messages, cwd, displayName: threadName, options });
}

async function parseOpenCodeLikeFile(path: string, entry: SessionArchiveRegistryEntry, options: SessionArchiveParserOptions = {}) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const id = stringValue(raw, "id") || sessionIdFromFilename(path);
  const sessionId = `${entry.idPrefix}${id}`;
  const project = openCodeProjectFromPath(path);
  const rows = arrayValue(fieldValue(raw, "messages"));
  const messages = rows.flatMap((row, index) => {
    const role = stringValue(row, "role");
    if (role !== "user" && role !== "assistant") return [];
    const extracted = extractContent(fieldValue(row, "content") ?? fieldValue(row, "parts"));
    if (!extracted.text && extracted.toolCalls.length === 0) return [];
    return makeMessage({
      id: index + 1,
      sessionId,
      ordinal: index,
      role,
      content: extracted.text,
      timestamp: isoFromMillis(numberValue(row, "time") || numberValue(objectValue(row, "time"), "created")),
      timestampFallback: isoFromMillis(options.sourceMtimeMs ?? 0),
      thinkingText: extracted.thinkingText,
      toolCalls: extracted.toolCalls,
      model: stringValue(row, "model"),
      sourceType: stringValue(row, "type") || "message",
      sourceUuid: stringValue(row, "id") || stringValue(row, "uuid"),
      sourceParentUuid: stringValue(row, "parentUuid") || stringValue(row, "parent_id"),
    });
  });
  return buildParseResult({ path, agent: entry.agent, id: sessionId, messages, project, options });
}

async function parseHermesFile(path: string, options: SessionArchiveParserOptions = {}) {
  if (extname(path) === ".json") {
    const raw = JSON.parse(await readFile(path, "utf8"));
    const id = hermesSessionId(path);
    const rows = arrayValue(Reflect.get(raw, "messages"));
    const messages = rows.flatMap((row, index) => hermesMessageFromRow(row, `hermes:${id}`, index));
    return buildParseResult({ path, agent: "hermes", id: `hermes:${id}`, messages, project: stringValue(raw, "platform") || "hermes", options });
  }
  const rows = await readJsonLines(path);
  const id = hermesSessionId(path);
  const messages = rows.flatMap((row, index) => hermesMessageFromRow(row, `hermes:${id}`, index));
  return buildParseResult({ path, agent: "hermes", id: `hermes:${id}`, messages, project: "hermes", options });
}

async function parseOpenClawLikeFile(path: string, entry: SessionArchiveRegistryEntry, options: SessionArchiveParserOptions = {}) {
  const rows = await readJsonLines(path);
  let rawId = sessionIdFromFilename(path);
  let cwd = "";
  const agentId = openClawAgentId(path);
  const messages: SessionArchiveMessage[] = [];
  for (const row of rows) {
    const type = stringValue(row, "type");
    if (type === "session") {
      rawId = stringValue(row, "id") || rawId;
      cwd = stringValue(row, "cwd") || cwd;
      continue;
    }
    if (type !== "message") continue;
    const message = objectValue(row, "message");
    const role = stringValue(message, "role");
    if (role !== "user" && role !== "assistant" && role !== "toolResult") continue;
    const extracted = extractContent(Reflect.get(message, "content"));
    if (!extracted.text && extracted.toolCalls.length === 0 && role !== "toolResult") continue;
    messages.push(makeMessage({
      id: messages.length + 1,
      sessionId: `${entry.idPrefix}${agentId}:${rawId}`,
      ordinal: messages.length,
      role: role === "assistant" ? "assistant" : "user",
      content: extracted.text,
      timestamp: stringValue(message, "timestamp") || stringValue(row, "timestamp"),
      thinkingText: extracted.thinkingText,
      toolCalls: extracted.toolCalls,
      sourceType: type,
      sourceUuid: stringValue(row, "uuid") || stringValue(message, "id"),
      sourceParentUuid: stringValue(row, "parentUuid"),
      isSidechain: row && typeof row === "object" ? Boolean(Reflect.get(row as object, "isSidechain")) : false,
    }));
  }
  return buildParseResult({ path, agent: entry.agent, id: `${entry.idPrefix}${agentId}:${rawId}`, messages, cwd, options });
}

async function parseGeminiFile(path: string, options: SessionArchiveParserOptions = {}) {
  const raw = await readStructuredFile(path);
  const id = stringValue(raw, "sessionId") || sessionIdFromFilename(path);
  const rows = arrayValue(fieldValue(raw, "messages"));
  const messages = rows.flatMap((row, index) => {
    const type = stringValue(row, "type");
    const role = type === "gemini" || stringValue(row, "role") === "model" ? "assistant" : "user";
    const extracted = extractContent(fieldValue(row, "content") ?? fieldValue(objectValue(row, "message"), "parts"));
    if (!extracted.text && extracted.toolCalls.length === 0) return [];
    return makeMessage({
      id: index + 1,
      sessionId: `gemini:${id}`,
      ordinal: index,
      role,
      content: extracted.text,
      timestamp: stringValue(row, "timestamp") || stringValue(row, "time"),
      thinkingText: extracted.thinkingText,
      toolCalls: extracted.toolCalls,
      tokenUsage: objectValue(row, "tokens"),
      sourceType: type,
      sourceUuid: stringValue(row, "id") || stringValue(row, "uuid"),
    });
  });
  return buildParseResult({ path, agent: "gemini", id: `gemini:${id}`, messages, options });
}

async function parseKiroFile(path: string, options: SessionArchiveParserOptions = {}) {
  const rows = await readJsonLines(path);
  const messages: SessionArchiveMessage[] = [];
  for (const row of rows) {
    const kind = stringValue(row, "kind");
    const data = objectValue(row, "data");
    if (kind === "Prompt") {
      const content = extractContent(fieldValue(data, "content") ?? fieldValue(data, "text") ?? data).text;
      if (!content) continue;
      messages.push(makeMessage({ id: messages.length + 1, sessionId: `kiro:${sessionIdFromFilename(path)}`, ordinal: messages.length, role: "user", content, timestamp: stringValue(row, "timestamp") }));
    } else if (kind === "AssistantMessage") {
      const extracted = extractContent(fieldValue(data, "content") ?? fieldValue(data, "text") ?? data);
      if (!extracted.text && extracted.toolCalls.length === 0) continue;
      messages.push(makeMessage({ id: messages.length + 1, sessionId: `kiro:${sessionIdFromFilename(path)}`, ordinal: messages.length, role: "assistant", content: extracted.text, timestamp: stringValue(row, "timestamp"), thinkingText: extracted.thinkingText, toolCalls: extracted.toolCalls }));
    }
  }
  return buildParseResult({ path, agent: "kiro", id: `kiro:${sessionIdFromFilename(path)}`, messages, options });
}

async function parseKimiFile(path: string, options: SessionArchiveParserOptions = {}) {
  const rows = await readJsonLines(path);
  const rawId = kimiSessionId(path);
  return buildSimpleRowsResult({ path, agent: "kimi", id: `kimi:${rawId}`, rows, options });
}

async function parseQwenFile(path: string, options: SessionArchiveParserOptions = {}) {
  const rows = await readJsonLines(path);
  const firstSessionId = rows.map((row) => stringValue(row, "sessionId")).find(Boolean);
  return buildSimpleRowsResult({ path, agent: "qwen", id: `qwen:${firstSessionId || sessionIdFromFilename(path)}`, rows, options });
}

async function parsePiLikeFile(path: string, entry: SessionArchiveRegistryEntry, options: SessionArchiveParserOptions = {}) {
  const rows = await readJsonLines(path);
  const header = rows.find((row) => stringValue(row, "type") === "session");
  const rawId = stringValue(header, "id") || sessionIdFromFilename(path);
  const cwd = stringValue(header, "cwd");
  const parentPath = stringValue(header, "branchedFrom");
  const parentBase = parentPath ? sessionIdFromFilename(parentPath) : "";
  let model = "";
  let sessionName = "";
  const messages: SessionArchiveMessage[] = [];
  for (const row of rows) {
    const type = stringValue(row, "type");
    if (type === "model_change") {
      model = stringValue(row, "modelId") || model;
      continue;
    }
    if (type === "session_info") {
      sessionName = stringValue(row, "name") || sessionName;
      continue;
    }
    if (type !== "message") continue;
    const message = objectValue(row, "message");
    const role = stringValue(message, "role");
    const sessionId = `${entry.idPrefix}${rawId}`;
    if (role === "user") {
      const extracted = extractContent(fieldValue(message, "content"));
      if (!extracted.text && extracted.toolCalls.length === 0) continue;
      messages.push(makeMessage({ id: messages.length + 1, sessionId, ordinal: messages.length, role: "user", content: extracted.text, timestamp: stringValue(row, "timestamp"), thinkingText: extracted.thinkingText, toolCalls: extracted.toolCalls, model }));
    } else if (role === "assistant") {
      const extracted = extractContent(fieldValue(message, "content"));
      const nextModel = stringValue(message, "model") || model;
      if (nextModel) model = nextModel;
      if (!extracted.text && extracted.toolCalls.length === 0) continue;
      messages.push(makeMessage({ id: messages.length + 1, sessionId, ordinal: messages.length, role: "assistant", content: extracted.text, timestamp: stringValue(row, "timestamp"), thinkingText: extracted.thinkingText, toolCalls: extracted.toolCalls, model }));
    } else if (role === "toolResult") {
      const content = extractContent(fieldValue(message, "content")).text || stringValue(message, "content");
      if (!content.trim()) continue;
      messages.push(makeMessage({ id: messages.length + 1, sessionId, ordinal: messages.length, role: "user", content, timestamp: stringValue(row, "timestamp"), sourceType: "toolResult" }));
    }
  }
  const result = buildParseResult({ path, agent: entry.agent, id: `${entry.idPrefix}${rawId}`, messages, cwd, displayName: sessionName, options });
  if (result?.session && parentBase) {
    result.session.parent_session_id = `${entry.idPrefix}${parentBase}`;
    result.session.relationship_type = "fork";
  }
  return result;
}

async function parseQwenPawFile(path: string, options: SessionArchiveParserOptions = {}) {
  const raw = await readStructuredFile(path);
  const rows = Array.isArray(raw) ? raw : arrayValue(fieldValue(raw, "messages"));
  const workspace = qwenPawWorkspaceFromPath(path) || options.project || "default";
  const subdir = qwenPawSubdirFromPath(path);
  const stem = sessionIdFromFilename(path);
  const idParts = ["qwenpaw", workspace, subdir, stem].filter(Boolean);
  const id = idParts.join(":");
  return buildSimpleRowsResult({ path, agent: "qwenpaw", id, rows, options: { ...options, project: options.project || workspace } });
}

async function parseReasonixFile(path: string, options: SessionArchiveParserOptions = {}) {
  const rows = await readJsonLines(path);
  const meta = await readReasonixMetadata(path);
  const id = `reasonix:${stringValue(meta, "id") || reasonixSessionIdFromPath(path)}`;
  const cwd = stringValue(meta, "workspace_root");
  const model = stringValue(meta, "model");
  const messages: SessionArchiveMessage[] = [];
  for (const row of rows) {
    const role = stringValue(row, "role").toLocaleLowerCase();
    if (role === "tool") {
      const content = stringValue(row, "content");
      if (!content) continue;
      messages.push(makeMessage({ id: messages.length + 1, sessionId: id, ordinal: messages.length, role: "user", content, timestamp: "", sourceType: "tool", sourceUuid: stringValue(row, "tool_call_id") }));
      continue;
    }
    if (role !== "user" && role !== "assistant") continue;
    const toolCalls = arrayValue(fieldValue(row, "tool_calls")).flatMap((call): SessionArchiveToolCall[] => {
      const name = stringValue(call, "name");
      if (!name) return [];
      return [{ tool_name: name, category: toolCategory(name), tool_use_id: stringValue(call, "id") || undefined, input_json: stringValue(call, "arguments") || "{}" }];
    });
    const thinkingText = stringValue(row, "reasoning_content");
    const content = stringValue(row, "content");
    if (!content && toolCalls.length === 0 && !thinkingText) continue;
    messages.push(makeMessage({ id: messages.length + 1, sessionId: id, ordinal: messages.length, role, content, timestamp: "", thinkingText, toolCalls, model }));
  }
  return buildParseResult({ path, agent: "reasonix", id, messages, cwd, displayName: stringValue(meta, "topic_title"), options });
}

async function parseGenericAgentFile(path: string, entry: SessionArchiveRegistryEntry, options: SessionArchiveParserOptions = {}) {
  const rows = await readGenericRows(path);
  const id = `${entry.idPrefix}${sessionIdFromFilename(path)}`;
  return buildSimpleRowsResult({ path, agent: entry.agent, id, rows, options });
}

/**
 * Grok Build CLI: ~/.grok/sessions/<workspace>/<sessionId>/chat_history.jsonl
 * Rows: { type: "user"|"assistant"|…, content: string | [{type,text}] }
 */
async function parseGrokFile(path: string, options: SessionArchiveParserOptions = {}) {
  const rows = await readJsonLines(path);
  const sessionId = `grok:${basename(dirname(path)) || sessionIdFromFilename(path)}`;
  const messages: SessionArchiveMessage[] = [];
  for (const row of rows) {
    const type = stringValue(row, "type");
    if (type !== "user" && type !== "assistant") continue;
    const extracted = extractContent(fieldValue(row, "content"));
    const content = extracted.text.trim();
    if (!content && extracted.toolCalls.length === 0) continue;
    // Skip pure system-reminder / skill-list synthetic user dumps when they are the only text.
    if (type === "user" && content.includes("<system-reminder>") && content.length > 400) continue;
    messages.push(makeMessage({
      id: messages.length + 1,
      sessionId,
      ordinal: messages.length,
      role: type === "assistant" ? "assistant" : "user",
      content,
      timestamp: stringValue(row, "timestamp") || isoFromMillis(numberValue(row, "timestamp")),
      thinkingText: extracted.thinkingText,
      toolCalls: extracted.toolCalls,
      sourceType: type,
      sourceUuid: stringValue(row, "uuid") || stringValue(row, "id"),
    }));
  }
  const project = projectFromGrokSessionPath(path);
  return buildParseResult({ path, agent: "grok", id: sessionId, messages, project, options });
}

/**
 * WorkBuddy / CodeBuddy CLI: ~/.workbuddy/projects/<project>/<sessionId>.jsonl
 * Rows: { type: "message", role: "user"|"assistant", content: [{type:input_text|output_text,text}], timestamp: number }
 */
async function parseWorkBuddyFile(path: string, options: SessionArchiveParserOptions = {}) {
  const rows = await readJsonLines(path);
  const rawId = stringValue(rows[0], "sessionId") || sessionIdFromFilename(path);
  const sessionId = `workbuddy:${rawId}`;
  const messages: SessionArchiveMessage[] = [];
  for (const row of rows) {
    const role = stringValue(row, "role");
    if (role !== "user" && role !== "assistant") continue;
    const extracted = extractContent(fieldValue(row, "content"));
    const content = extracted.text.trim();
    if (!content && extracted.toolCalls.length === 0) continue;
    const tsMs = numberValue(row, "timestamp");
    messages.push(makeMessage({
      id: messages.length + 1,
      sessionId,
      ordinal: messages.length,
      role: role === "assistant" ? "assistant" : "user",
      content,
      timestamp: isoFromMillis(tsMs) || stringValue(row, "timestamp"),
      thinkingText: extracted.thinkingText,
      toolCalls: extracted.toolCalls,
      sourceType: stringValue(row, "type") || role,
      sourceUuid: stringValue(row, "id"),
      sourceParentUuid: stringValue(row, "parentId") || stringValue(row, "logicalParentId"),
    }));
  }
  const project = projectFromWorkBuddyPath(path);
  return buildParseResult({ path, agent: "workbuddy", id: sessionId, messages, project, options });
}

function projectFromGrokSessionPath(path: string): string {
  // .../sessions/%2FUsers%2Fwork%2Fcode%2F.../<id>/chat_history.jsonl
  const sessionsIdx = path.split(sep).lastIndexOf("sessions");
  if (sessionsIdx < 0) return "";
  const encoded = path.split(sep)[sessionsIdx + 1] ?? "";
  try {
    const decoded = decodeURIComponent(encoded);
    if (decoded.startsWith("/") || /^[A-Za-z]:[\\/]/.test(decoded)) {
      return projectFromCwd(decoded);
    }
  } catch {
    // ignore
  }
  return projectFromPath(path);
}

function projectFromWorkBuddyPath(path: string): string {
  // .../projects/Users-work-foo/<session>.jsonl
  const projectsIdx = path.split(sep).lastIndexOf("projects");
  if (projectsIdx < 0) return "";
  const folder = path.split(sep)[projectsIdx + 1] ?? "";
  return folder || projectFromPath(path);
}

async function parseAiderFile(path: string, options: SessionArchiveParserOptions = {}) {
  const raw = await readFile(path, "utf8");
  const runs = splitAiderRuns(raw);
  const runIndex = aiderVirtualRunIndex(path);
  const selectedRuns = runIndex == null ? runs : runs.filter((_, index) => index === runIndex);
  const physicalPath = path.split("#")[0] || path;
  const selectedRunIndex = runIndex ?? 0;
  const sessionId = `aider:${sessionIdFromFilename(physicalPath)}:${selectedRunIndex}`;
  const messages = selectedRuns.flatMap((run) => aiderMessagesFromRun(run, sessionId));
  return buildParseResult({ path, agent: "aider", id: sessionId, messages, options });
}

type AiderRun = { timestamp: string; lines: string[] };

function splitAiderRuns(raw: string): AiderRun[] {
  const runs: AiderRun[] = [];
  let current: AiderRun | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const match = /^# aider chat started at (.+)$/.exec(line.trim());
    if (match) {
      current = { timestamp: aiderTimestampToIso(match[1] ?? ""), lines: [] };
      runs.push(current);
      continue;
    }
    current?.lines.push(line);
  }
  return runs;
}

function aiderMessagesFromRun(run: AiderRun, sessionId: string): SessionArchiveMessage[] {
  const messages: SessionArchiveMessage[] = [];
  let assistantLines: string[] = [];
  const flushAssistant = () => {
    const content = assistantLines.join("\n").trim();
    assistantLines = [];
    if (!content) return;
    messages.push(makeMessage({ id: messages.length + 1, sessionId, ordinal: messages.length, role: "assistant", content, timestamp: run.timestamp }));
  };
  for (const line of run.lines) {
    if (line.startsWith("####")) {
      flushAssistant();
      const content = line.replace(/^####\s*/, "").trim();
      if (content) {
        messages.push(makeMessage({ id: messages.length + 1, sessionId, ordinal: messages.length, role: "user", content, timestamp: run.timestamp }));
      }
      continue;
    }
    assistantLines.push(line);
  }
  flushAssistant();
  return messages;
}

function aiderVirtualRunIndex(path: string): number | null {
  const match = /#(\d+)$/.exec(path);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function aiderTimestampToIso(value: string): string {
  const parsed = new Date(value.trim().replace(" ", "T") + "Z").getTime();
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed).toISOString() : "";
}

function buildSimpleRowsResult(input: {
  path: string;
  agent: SessionArchiveAgent;
  id: string;
  rows: unknown[];
  options: SessionArchiveParserOptions;
}) {
  const messages = input.rows.flatMap((row, index) => messageFromGenericRow(row, input.id, index));
  return buildParseResult({ path: input.path, agent: input.agent, id: input.id, messages, options: input.options });
}

function messageFromGenericRow(row: unknown, sessionId: string, index: number): SessionArchiveMessage[] {
  const nested = objectValue(row, "message");
  const roleValue = stringValue(row, "role") || stringValue(nested, "role") || stringValue(row, "type") || stringValue(row, "kind");
  const role = ["assistant", "gemini", "model", "AssistantMessage"].includes(roleValue) ? "assistant" : "user";
  const extracted = extractContent(
    fieldValue(row, "content")
      ?? fieldValue(nested, "content")
      ?? fieldValue(row, "parts")
      ?? fieldValue(nested, "parts")
      ?? fieldValue(row, "text")
      ?? fieldValue(row, "data"),
  );
  if (!extracted.text && extracted.toolCalls.length === 0) return [];
  return [makeMessage({
    id: index + 1,
    sessionId,
    ordinal: index,
    role,
    content: extracted.text,
    timestamp: stringValue(row, "timestamp") || stringValue(nested, "timestamp") || stringValue(row, "created_at"),
    thinkingText: extracted.thinkingText,
    toolCalls: extracted.toolCalls,
    model: stringValue(row, "model") || stringValue(nested, "model"),
    tokenUsage: fieldValue(row, "usage") ?? fieldValue(nested, "usage") ?? fieldValue(row, "tokens"),
    sourceType: roleValue,
    sourceUuid: stringValue(row, "uuid") || stringValue(row, "id") || stringValue(nested, "id"),
    sourceParentUuid: stringValue(row, "parentUuid") || stringValue(row, "parent_id"),
  })];
}

function hermesMessageFromRow(row: unknown, sessionId: string, index: number) {
  const role = stringValue(row, "role");
  if (role !== "user" && role !== "assistant" && role !== "tool") return [];
  const extracted = extractContent(Reflect.get(objectValue(row, "message"), "content") ?? Reflect.get(row as object, "content"));
  const content = extracted.text || stringValue(row, "content");
  if (!content && extracted.toolCalls.length === 0) return [];
  return [makeMessage({
    id: index + 1,
    sessionId,
    ordinal: index,
    role: role === "assistant" ? "assistant" : "user",
    content,
    timestamp: stringValue(row, "timestamp"),
    thinkingText: extracted.thinkingText || stringValue(row, "reasoning"),
    toolCalls: extracted.toolCalls,
    sourceType: stringValue(row, "type") || role,
    sourceUuid: stringValue(row, "uuid") || stringValue(row, "id"),
    sourceParentUuid: stringValue(row, "parentUuid"),
  })];
}

function buildParseResult(input: {
  path: string;
  agent: SessionArchiveAgent;
  id: string;
  messages: SessionArchiveMessage[];
  cwd?: string;
  project?: string;
  displayName?: string;
  options: SessionArchiveParserOptions;
}): SessionArchiveParseResult | null {
  if (input.messages.length === 0) return null;
  const visibleMessages = input.messages.filter((message) => !message.is_system);
  const sourceMtimeIso = isoFromMillis(input.options.sourceMtimeMs ?? 0);
  const firstMessage = visibleMessages[0] ?? input.messages[0];
  const lastMessage = visibleMessages[visibleMessages.length - 1] ?? input.messages[input.messages.length - 1];
  const startedAt = validIsoTimestamp(firstMessage?.timestamp ?? "") || sourceMtimeIso || null;
  const endedAt = validIsoTimestamp(lastMessage?.timestamp ?? "") || startedAt;
  // Prefer a human title preview (e.g. Grok `<user_query>`), not harness dumps.
  // Grok often emits a standalone `<user_info>` user row first — never store that.
  const first_message = pickSessionArchiveFirstMessagePreview(visibleMessages);
  const session: SessionArchiveSession = {
    id: input.id,
    project: input.options.project || input.project || projectFromCwd(input.cwd) || projectFromPath(input.path),
    machine: input.options.machine || "local",
    agent: input.agent,
    first_message,
    display_name: input.displayName?.trim() || undefined,
    started_at: startedAt,
    ended_at: endedAt,
    message_count: visibleMessages.length,
    user_message_count: input.messages.filter((message) => message.role === "user" && !message.is_system).length,
    total_output_tokens: input.messages.reduce((sum, message) => sum + message.output_tokens, 0),
    peak_context_tokens: input.messages.reduce((max, message) => Math.max(max, message.context_tokens), 0),
    is_automated: false,
    file_path: input.path,
    file_hash: input.options.sourceHash ?? undefined,
    file_mtime: input.options.sourceMtimeMs ?? 0,
    file_inode: input.options.sourceInode ?? undefined,
    file_device: input.options.sourceDevice ?? undefined,
    local_modified_at: sourceMtimeIso || null,
    cwd: input.cwd ?? "",
    source_session_id: input.id,
    source_version: "studio-session-archive-v1",
    parser_malformed_lines: 0,
    is_truncated: false,
    created_at: startedAt || sourceMtimeIso || new Date().toISOString(),
  };
  const messages = input.messages.map((message, index) => ({ ...message, ordinal: index }));
  return { session, messages, usageEvents: usageEventsFromMessages(session.id, messages), sourcePath: input.path };
}

function usageEventsFromMessages(sessionId: string, messages: SessionArchiveMessage[]): SessionArchiveUsageEvent[] {
  return messages.flatMap((message) => {
    const usage = message.token_usage;
    if (!usage || !message.model || message.model === "<synthetic>") return [];
    const inputTokens = numberFromRecord(usage, "input_tokens", "prompt_tokens", "inputTokens");
    const outputTokens = numberFromRecord(usage, "output_tokens", "completion_tokens", "outputTokens");
    const cacheCreationInputTokens = numberFromRecord(usage, "cache_creation_input_tokens", "cacheCreationInputTokens");
    const cacheReadInputTokens = numberFromRecord(usage, "cache_read_input_tokens", "cacheReadInputTokens", "cached_tokens");
    const reasoningTokens = numberFromRecord(usage, "reasoning_output_tokens", "reasoningOutputTokens");
    if (inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens + reasoningTokens === 0) return [];
    return [{
      session_id: sessionId,
      message_ordinal: message.ordinal,
      source: message.source_type || message.source_subtype || "message_token_usage",
      model: message.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheCreationInputTokens,
      cache_read_input_tokens: cacheReadInputTokens,
      reasoning_tokens: reasoningTokens,
      cost_usd: tokenCost(usage),
      cost_status: tokenCost(usage) === null ? "" : "actual",
      cost_source: tokenCost(usage) === null ? "" : "token_usage",
      occurred_at: message.timestamp || null,
      dedup_key: message.source_uuid || `${message.ordinal}:${message.model}`,
    }];
  });
}

function tokenCost(usage: Record<string, number | boolean>): number | null {
  for (const key of ["cost_usd", "cost", "total_cost"]) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function isSessionArchiveTitleCandidate(content: string): boolean {
  return pickSessionArchiveTitlePreview(content) != null;
}

/**
 * Human list-title / first_message body from a single user message.
 * Prefer `<user_query>` / `<user-request>`; reject pure env / system-reminder dumps.
 */
function pickSessionArchiveTitlePreview(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("# AGENTS.md instructions") && trimmed.includes("<INSTRUCTIONS>")) {
    return null;
  }

  const wrapped =
    trimmed.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i)?.[1]?.trim()
    ?? trimmed.match(/<user-request>\s*([\s\S]*?)\s*<\/user-request>/i)?.[1]?.trim();
  if (wrapped) {
    const line = wrapped.split(/\r?\n/).find((row) => row.trim().length > 0)?.trim();
    if (line) return line.slice(0, 300);
  }

  // Pure `<user_info>…</user_info>` (common Grok first row) — not a title.
  const withoutUserInfo = trimmed
    .replace(/<user_info\b[^>]*>[\s\S]*?<\/user_info\s*>/gi, "\n")
    .trim();
  if (!withoutUserInfo) return null;

  // Long system-reminder skill dumps.
  if (withoutUserInfo.includes("<system-reminder>") && withoutUserInfo.length > 200) {
    return null;
  }

  // Remaining prose after dropping known harness blocks.
  const cleaned = withoutUserInfo
    .replace(
      /<(?:system-reminder|system_reminder|available_skills|INSTRUCTIONS|auto-slash-command|command-instruction)\b[^>]*>[\s\S]*?<\/(?:system-reminder|system_reminder|available_skills|INSTRUCTIONS|auto-slash-command|command-instruction)\s*>/gi,
      "\n",
    )
    .replace(/<\/?(?:user_info|user_query|user-request|system-reminder|system_reminder)\b[^>]*\/?>/gi, "\n")
    .replace(/^\s*<\/?[A-Za-z_][\w:.-]*(?:\s[^>]*)?\/?>\s*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2) return null;
  // Skip env-info only lines if they still look like metadata.
  if (/^(OS Version|Shell|Workspace Path|Today's date)\b/i.test(cleaned) && cleaned.length < 120) {
    return null;
  }
  return cleaned.slice(0, 300);
}

/** Walk user messages and return the first usable human preview for `first_message`. */
function pickSessionArchiveFirstMessagePreview(
  messages: ReadonlyArray<Pick<SessionArchiveMessage, "role" | "content" | "is_system">>,
): string | null {
  for (const message of messages) {
    if (message.role !== "user" || message.is_system) continue;
    const preview = pickSessionArchiveTitlePreview(message.content);
    if (preview) return preview;
  }
  return null;
}

async function lookupCodexThreadName(sessionPath: string, sessionId: string): Promise<string> {
  if (!sessionId.trim()) return "";
  const indexPath = codexSessionIndexPath(sessionPath);
  if (!indexPath) return "";
  let rows: unknown[];
  try {
    rows = await readJsonLines(indexPath);
  } catch {
    return "";
  }
  for (const row of rows) {
    if (stringValue(row, "id") !== sessionId) continue;
    return stringValue(row, "thread_name").trim();
  }
  return "";
}

function codexSessionIndexPath(sessionPath: string): string {
  let dir = dirname(sessionPath);
  while (dir && dirname(dir) !== dir) {
    const base = basename(dir);
    if (base === "sessions" || base === "archived_sessions") {
      return join(dirname(dir), "session_index.jsonl");
    }
    dir = dirname(dir);
  }
  return "";
}

function makeMessage(input: {
  id: number;
  sessionId: string;
  ordinal: number;
  role: string;
  content: string;
  timestamp: string;
  timestampFallback?: string;
  thinkingText?: string;
  toolCalls?: SessionArchiveToolCall[];
  model?: string;
  tokenUsage?: unknown;
  isSystem?: boolean;
  sourceSubtype?: string;
  claudeMessageId?: string;
  claudeRequestId?: string;
  sourceType?: string;
  sourceUuid?: string;
  sourceParentUuid?: string;
  isSidechain?: boolean;
}): SessionArchiveMessage {
  const tokenUsage = numericRecord(input.tokenUsage);
  const outputTokens = numberFromRecord(tokenUsage, "output_tokens", "completion_tokens", "outputTokens");
  const contextTokens = numberFromRecord(tokenUsage, "input_tokens", "prompt_tokens", "inputTokens");
  const toolCalls = input.toolCalls?.length ? input.toolCalls : undefined;
  const content = input.content.trim() || toolCallSummary(toolCalls) || input.thinkingText?.trim() || "";
  return {
    id: input.id,
    session_id: input.sessionId,
    ordinal: input.ordinal,
    role: input.role,
    content,
    timestamp: validIsoTimestamp(input.timestamp) || input.timestampFallback || "",
    has_thinking: Boolean(input.thinkingText),
    thinking_text: input.thinkingText ?? "",
    has_tool_use: Boolean(toolCalls?.length),
    content_length: content.length,
    model: input.model ?? "",
    ...(tokenUsage ? { token_usage: tokenUsage } : {}),
    context_tokens: contextTokens,
    output_tokens: outputTokens,
    has_context_tokens: contextTokens > 0,
    has_output_tokens: outputTokens > 0,
    ...(toolCalls ? { tool_calls: toolCalls } : {}),
    is_system: input.isSystem ?? false,
    ...(input.claudeMessageId ? { claude_message_id: input.claudeMessageId } : {}),
    ...(input.claudeRequestId ? { claude_request_id: input.claudeRequestId } : {}),
    ...(input.sourceType ? { source_type: input.sourceType } : {}),
    ...(input.sourceSubtype ? { source_subtype: input.sourceSubtype } : {}),
    ...(input.sourceUuid ? { source_uuid: input.sourceUuid } : {}),
    ...(input.sourceParentUuid ? { source_parent_uuid: input.sourceParentUuid } : {}),
    ...(input.isSidechain === undefined ? {} : { is_sidechain: input.isSidechain }),
  };
}

function codexLastTokenUsage(payload: Record<string, unknown>): Record<string, number> | null {
  if (stringValue(payload, "type") !== "token_count") return null;
  const info = objectValue(payload, "info");
  const usage = objectValue(info, "last_token_usage");
  const normalized = numberRecord({
    input_tokens: fieldValue(usage, "input_tokens"),
    cache_read_input_tokens: fieldValue(usage, "cached_input_tokens"),
    cached_tokens: fieldValue(usage, "cached_input_tokens"),
    output_tokens: fieldValue(usage, "output_tokens"),
    reasoning_output_tokens: fieldValue(usage, "reasoning_output_tokens"),
    total_tokens: fieldValue(usage, "total_tokens"),
  });
  return normalized && Object.keys(normalized).length > 0 ? normalized : null;
}

function numberRecord(value: Record<string, unknown>): Record<string, number> | null {
  const entries = Object.entries(value).flatMap(([key, entry]) => {
    if (typeof entry === "number" && Number.isFinite(entry)) return [[key, entry] as const];
    if (typeof entry === "string" && Number.isFinite(Number(entry))) return [[key, Number(entry)] as const];
    return [];
  });
  return entries.length ? Object.fromEntries(entries) : null;
}

function validIsoTimestamp(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const parsed = new Date(trimmed).getTime();
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return new Date(parsed).toISOString();
}

function toolCallSummary(toolCalls: SessionArchiveToolCall[] | undefined): string {
  const names = toolCalls?.map((call) => call.tool_name.trim()).filter(Boolean) ?? [];
  if (names.length === 0) return "";
  return `Tool: ${Array.from(new Set(names)).join(", ")}`;
}

function extractContent(value: unknown): { text: string; thinkingText: string; toolCalls: SessionArchiveToolCall[] } {
  if (typeof value === "string") return { text: value, thinkingText: "", toolCalls: [] };
  if (!Array.isArray(value)) {
    if (value && typeof value === "object") {
      const text = stringValue(value, "text") || stringValue(value, "content");
      if (text) return { text, thinkingText: "", toolCalls: [] };
      return extractContent([value]);
    }
    return { text: "", thinkingText: "", toolCalls: [] };
  }
  const text: string[] = [];
  const thinking: string[] = [];
  const toolCalls: SessionArchiveToolCall[] = [];
  for (const part of value) {
    if (!part || typeof part !== "object") continue;
    const type = stringValue(part, "type");
    const partText = stringValue(part, "text") || stringValue(part, "content");
    if ((!type || ["text", "input_text", "output_text"].includes(type)) && partText) text.push(partText);
    if (["thinking", "reasoning"].includes(type)) thinking.push(partText || stringValue(part, "thinking"));
    if (["tool_use", "toolCall", "function_call"].includes(type)) {
      const name = stringValue(part, "name") || stringValue(part, "tool_name");
      if (name) {
        const input = objectValue(part, "input");
        const args = objectValue(part, "arguments");
        toolCalls.push({
          tool_name: name,
          category: toolCategory(name),
          tool_use_id: stringValue(part, "id") || stringValue(part, "tool_use_id") || undefined,
          input_json: JSON.stringify(Object.keys(input).length ? input : args),
        });
      }
    }
  }
  return { text: text.join("\n\n"), thinkingText: thinking.filter(Boolean).join("\n\n"), toolCalls };
}

async function readJsonLines(path: string): Promise<unknown[]> {
  const raw = await readFile(path, "utf8");
  return raw.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    try {
      return [JSON.parse(trimmed)];
    } catch {
      return [];
    }
  });
}

async function readGenericRows(path: string): Promise<unknown[]> {
  const raw = await readStructuredFile(path);
  if (Array.isArray(raw)) return raw;
  const rows = arrayValue(fieldValue(raw, "messages"));
  if (rows.length) return rows;
  return [raw];
}

async function readStructuredFile(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) return {};
  if (extname(path) === ".jsonl" || trimmed.includes("\n")) {
    const rows = await readJsonLines(path);
    if (rows.length === 1) return rows[0];
    return rows;
  }
  return JSON.parse(trimmed);
}

async function walkFiles(root: string, keep: (path: string) => boolean): Promise<string[]> {
  try {
    const info = await stat(root);
    if (!info.isDirectory()) return [];
  } catch {
    return [];
  }
  const found: string[] = [];
  async function visit(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && keep(path)) found.push(path);
    }
  }
  await visit(root);
  return found.sort();
}

const AIDER_HISTORY_FILE = ".aider.chat.history.md";
const AIDER_MAX_WALK_DEPTH = 4;
const AIDER_MAX_FILES = 5000;
const AIDER_MAX_DIRS = 50000;
const AIDER_WALK_BUDGET_MS = 2000;
const AIDER_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "target",
  ".cache",
  "Library",
  "go",
  ".cargo",
  ".rustup",
  ".npm",
  ".pnpm-store",
  ".gradle",
  ".m2",
  "vendor",
  "dist",
  "build",
  ".venv",
  "venv",
  "__pycache__",
  ".svn",
  ".hg",
]);

async function discoverAiderSessionFiles(root: string): Promise<string[]> {
  try {
    const info = await stat(root);
    if (!info.isDirectory()) return [];
  } catch {
    return [];
  }
  const found: string[] = [];
  const startedAt = Date.now();
  const rootDepth = root.split(sep).filter(Boolean).length;
  let dirCount = 0;

  async function visit(dir: string): Promise<boolean> {
    if (Date.now() - startedAt >= AIDER_WALK_BUDGET_MS) return false;
    const depth = dir.split(sep).filter(Boolean).length - rootDepth;
    if (depth > AIDER_MAX_WALK_DEPTH) return true;
    dirCount += 1;
    if (dirCount > AIDER_MAX_DIRS) return false;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const entry of entries) {
      if (Date.now() - startedAt >= AIDER_WALK_BUDGET_MS || found.length >= AIDER_MAX_FILES) return false;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.isSymbolicLink() || AIDER_SKIP_DIRS.has(entry.name)) continue;
        const shouldContinue = await visit(path);
        if (!shouldContinue) return false;
        continue;
      }
      if (entry.isFile() && !entry.isSymbolicLink() && entry.name === AIDER_HISTORY_FILE) {
        found.push(path);
      }
    }
    return true;
  }

  await visit(root);
  return found.sort();
}

async function discoverQwenPawSessionFiles(root: string): Promise<string[]> {
  const workspaceDirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  const discovered: string[] = [];
  for (const workspace of workspaceDirs) {
    if (!workspace.isDirectory() || workspace.name.startsWith(".")) continue;
    const sessionsDir = join(root, workspace.name, "sessions");
    const entries = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile() && extname(entry.name) === ".json") discovered.push(join(sessionsDir, entry.name));
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const nested = await readdir(join(sessionsDir, entry.name), { withFileTypes: true }).catch(() => []);
      for (const file of nested) {
        if (file.isFile() && extname(file.name) === ".json") discovered.push(join(sessionsDir, entry.name, file.name));
      }
    }
  }
  return discovered.sort();
}

async function readReasonixMetadata(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(`${path}.meta`, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function sessionIdFromFilename(path: string): string {
  return basename(path).replace(/\.(jsonl|json|md)$/i, "").replace(/^rollout-[^-]+-[^-]+-/, "");
}

function reasonixSessionIdFromPath(path: string): string {
  const stem = sessionIdFromFilename(path);
  const parent = basename(dirname(path));
  return parent && parent !== "." ? `${parent}:${stem}` : stem;
}

function qwenPawWorkspaceFromPath(path: string): string {
  const parts = path.split(sep);
  const sessionsIndex = parts.lastIndexOf("sessions");
  if (sessionsIndex <= 0) return "";
  return parts[sessionsIndex - 1] ?? "";
}

function qwenPawSubdirFromPath(path: string): string {
  const parts = path.split(sep);
  const sessionsIndex = parts.lastIndexOf("sessions");
  if (sessionsIndex < 0 || sessionsIndex + 2 >= parts.length) return "";
  return parts[sessionsIndex + 1] ?? "";
}

function hermesSessionId(path: string): string {
  return sessionIdFromFilename(path).replace(/^session_/, "");
}

function openClawAgentId(path: string): string {
  const parts = path.split(sep);
  const sessionsIndex = parts.lastIndexOf("sessions");
  return sessionsIndex > 0 ? parts[sessionsIndex - 1] || "default" : "default";
}

function kimiSessionId(path: string): string {
  const parts = path.split(sep);
  const wireIndex = parts.lastIndexOf("wire.jsonl");
  const agentIndex = parts.lastIndexOf("agents");
  if (wireIndex >= 0 && agentIndex > 1 && agentIndex + 2 === wireIndex) {
    const agent = parts[agentIndex + 1] || "default";
    const session = parts[agentIndex - 1] || sessionIdFromFilename(path);
    const project = parts[agentIndex - 2] || "kimi";
    return `${project}:${agent}:${session}`;
  }
  const session = parts.at(-2) || sessionIdFromFilename(path);
  const project = parts.at(-3) || "kimi";
  return `${project}:${session}`;
}

function openCodeProjectFromPath(path: string): string {
  return basename(dirname(path)).replace(/^-+/, "").replace(/-/g, "/") || "opencode";
}

function projectFromCwd(cwd?: string): string {
  return cwd ? basename(cwd) || "workspace" : "";
}

function projectFromPath(path: string): string {
  const rel = relative(resolve(path, "../../.."), path);
  return rel.split(sep).filter(Boolean)[0] || basename(dirname(path)) || "workspace";
}

function toolCategory(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("read")) return "Read";
  if (lower.includes("bash") || lower.includes("shell") || lower.includes("exec")) return "Bash";
  if (lower.includes("write") || lower.includes("edit") || lower.includes("patch")) return "Edit";
  return name;
}

function stringValue(value: unknown, key: string): string {
  const field = fieldValue(value, key);
  return typeof field === "string" ? field : "";
}

function numberValue(value: unknown, key: string): number {
  const field = fieldValue(value, key);
  const number = Number(field);
  return Number.isFinite(number) ? number : 0;
}

function objectValue(value: unknown, key: string): Record<string, unknown> {
  const field = fieldValue(value, key);
  return field && typeof field === "object" && !Array.isArray(field) ? field as Record<string, unknown> : {};
}

function fieldValue(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? Reflect.get(value, key) : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numericRecord(value: unknown): Record<string, number | boolean> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value).flatMap(([key, entry]) =>
    typeof entry === "number" || typeof entry === "boolean"
      ? [[key, entry] as const]
      : typeof entry === "string" && Number.isFinite(Number(entry))
        ? [[key, Number(entry)] as const]
        : [],
  );
  return entries.length ? Object.fromEntries(entries) : null;
}

function numberFromRecord(record: Record<string, number | boolean> | null, ...keys: string[]): number {
  if (!record) return 0;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  }
  return 0;
}

function isoFromMillis(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return new Date(value).toISOString();
}
