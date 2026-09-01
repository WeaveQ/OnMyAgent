/**
 * One-shot Home prompt enhance via an OpenCode scratch session.
 * Write-path owner: OpenCode. Never prompt_async on the Home session.
 */
import type { Client, ModelRef } from "../types";
import { unwrap } from "./opencode";
import { toSessionTransportDirectory } from "./session-scope";

export const PROMPT_ENHANCE_SESSION_TITLE = "draft:prompt-enhance";
export const PROMPT_ENHANCE_TIMEOUT_MS = 25_000;

const STORAGE_KEY = "onmyagent:prompt-enhance-scratch-sessions";

/** Named keys OpenCode honors; unspecified tools keep the agent default. */
const DISABLED_TOOL_NAMES = [
  "Bash",
  "BashFunc",
  "Browser",
  "BrowserEval",
  "BrowserNavigate",
  "BrowserScreenshot",
  "Edit",
  "EditFileFunc",
  "Glob",
  "Grep",
  "List",
  "ListFileFunc",
  "MultiEdit",
  "NotebookEdit",
  "Read",
  "ReadFileFunc",
  "Shell",
  "Skill",
  "SkillLoad",
  "Task",
  "Terminal",
  "TodoRead",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Write",
  "WriteFileFunc",
  "apply_patch",
  "bash",
  "bash_func",
  "browser",
  "browser_click",
  "browser_eval",
  "browser_fill",
  "browser_list",
  "browser_navigate",
  "browser_select",
  "browser_screenshot",
  "browser_snapshot",
  "browser_version",
  "create_file",
  "create_file_func",
  "delete_file",
  "delete_file_func",
  "edit",
  "edit_file",
  "edit_file_func",
  "extension",
  "gitnexus",
  "gitnexus_analyze",
  "gitnexus_context",
  "gitnexus_cypher",
  "gitnexus_detect_changes",
  "gitnexus_explain",
  "gitnexus_impact",
  "gitnexus_list_repos",
  "gitnexus_path",
  "gitnexus_paths",
  "gitnexus_query",
  "gitnexus_rename",
  "gitnexus_search",
  "gitnexus_status",
  "gitnexus_*",
  "glob",
  "grep",
  "list",
  "list_file_func",
  "load_skill",
  "mcp",
  "multi_edit",
  "multiedit",
  "move_file",
  "onmyagent_extension_list_actions",
  "onmyagent_extension_call",
  "onmyagent_list_actions",
  "opencode_router",
  "opencode_router_call",
  "opencode_router_route",
  "opencode_router_send",
  "opencode_router_status",
  "patch",
  "question",
  "read",
  "read_file_func",
  "shell",
  "skill",
  "skill_load",
  "str_replace_editor",
  "task",
  "terminal",
  "todoread",
  "todowrite",
  "webfetch",
  "websearch",
  "write",
  "write_file",
  "write_file_func",
] as const;

export const DISABLED_TOOLS: Record<string, boolean> = Object.fromEntries(
  DISABLED_TOOL_NAMES.map((name) => [name, false]),
);

const memoryIds = new Set<string>();

function readStoredIds(): Set<string> {
  const next = new Set(memoryIds);
  const storage = typeof localStorage === "undefined" ? null : localStorage;
  if (!storage) return next;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return next;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return next;
    for (const id of parsed) {
      if (typeof id === "string" && id.trim()) next.add(id.trim());
    }
  } catch {
    // ignore quota / private mode / corrupt
  }
  return next;
}

function writeStoredIds(ids: Set<string>): void {
  memoryIds.clear();
  for (const id of ids) memoryIds.add(id);
  const storage = typeof localStorage === "undefined" ? null : localStorage;
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore
  }
}

export function registerPromptEnhanceScratchSession(sessionId: string): void {
  const id = sessionId.trim();
  if (!id) return;
  const ids = readStoredIds();
  if (ids.has(id)) return;
  ids.add(id);
  writeStoredIds(ids);
}

export function unregisterPromptEnhanceScratchSession(sessionId: string): void {
  const id = sessionId.trim();
  if (!id) return;
  const ids = readStoredIds();
  if (!ids.delete(id)) return;
  writeStoredIds(ids);
}

export function listPromptEnhanceScratchSessions(): string[] {
  return Array.from(readStoredIds());
}

export function clearPromptEnhanceScratchSessionsForTests(): void {
  writeStoredIds(new Set());
}

export function isPromptEnhanceScratchSessionId(
  sessionId: string | null | undefined,
): boolean {
  const id = sessionId?.trim() ?? "";
  if (!id) return false;
  if (id === PROMPT_ENHANCE_SESSION_TITLE || id.startsWith(`${PROMPT_ENHANCE_SESSION_TITLE}:`)) {
    return true;
  }
  return readStoredIds().has(id);
}

export function isPromptEnhanceScratchSession(session: {
  id?: string | null;
  title?: string | null;
}): boolean {
  const id = session.id?.trim() ?? "";
  const title = session.title?.trim() ?? "";
  if (isPromptEnhanceScratchSessionId(id)) return true;
  return (
    title === PROMPT_ENHANCE_SESSION_TITLE ||
    title.startsWith(`${PROMPT_ENHANCE_SESSION_TITLE}:`)
  );
}

function readEventSessionId(event: { type?: string; properties?: unknown }): string {
  const properties = event.properties;
  if (!properties || typeof properties !== "object") return "";
  const record = properties as {
    sessionID?: unknown;
    part?: { sessionID?: unknown };
    info?: { sessionID?: unknown; id?: unknown };
  };
  if (typeof record.sessionID === "string" && record.sessionID) return record.sessionID;
  const partId = record.part?.sessionID;
  if (typeof partId === "string" && partId) return partId;
  const infoId = record.info?.sessionID;
  if (typeof infoId === "string" && infoId) return infoId;
  const nestedId = record.info?.id;
  if (typeof nestedId === "string" && nestedId) return nestedId;
  return "";
}

/** Home SSE / transcript must ignore scratch enhance sessions. */
export function shouldIgnorePromptEnhanceScratchEvent(event: {
  type?: string;
  properties?: unknown;
}): boolean {
  const sessionId = readEventSessionId(event);
  return Boolean(sessionId && isPromptEnhanceScratchSessionId(sessionId));
}

export const PROMPT_ENHANCE_MIN_CHARS = 50;
export const PROMPT_ENHANCE_MAX_CHARS = 100;
export const PROMPT_ENHANCE_HARD_MAX_CHARS = 160;

export const PROMPT_ENHANCE_SYSTEM = [
  "Rewrite only the user's next prompt so it is clearer and more specific, without changing their intent.",
  "Keep the user's language.",
  `The rewritten prompt must be at most ${PROMPT_ENHANCE_MAX_CHARS} characters (count each CJK glyph as one).`,
  `For a real task, aim for ${PROMPT_ENHANCE_MIN_CHARS}–${PROMPT_ENHANCE_MAX_CHARS} characters.`,
  "Do not pad a greeting or fragment to hit a minimum.",
  "One short paragraph only. No headings, bullets, numbered news, or sections such as goal, constraints, or expected output.",
  "Do not invent files, folders, or attachments that were not named.",
  "Context is only to resolve short follow-ups. Never copy prior answers, news, or lists into the rewrite.",
  "Never output a transcript or labels such as Prompt to rewrite, Context, User:, or Assistant:.",
  "Return ONLY the rewritten prompt the user will send next.",
].join(" ");

export type PromptEnhanceTurn = {
  role: "user" | "assistant";
  text: string;
};

export const PROMPT_ENHANCE_MAX_RECENT_TURNS = 1;
export const PROMPT_ENHANCE_TURN_CHAR_LIMIT = 60;

function turnPlainText(
  message: {
    parts?: ReadonlyArray<{ type?: string; text?: string }> | null;
  } | null | undefined,
): string {
  return (message?.parts ?? [])
    .filter((part) => part?.type === "text")
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function compactPromptEnhanceTurns(
  messages: ReadonlyArray<{
    role?: string;
    parts?: ReadonlyArray<{ type?: string; text?: string }> | null;
  } | null | undefined>,
): PromptEnhanceTurn[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = clipPromptEnhanceLine(turnPlainText(message), PROMPT_ENHANCE_TURN_CHAR_LIMIT);
    if (!text) continue;
    return [{ role: "user", text }];
  }
  return [];
}

export function clipPromptEnhanceLine(text: string, limit: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if ([...compact].length <= limit) return compact;
  return `${[...compact].slice(0, Math.max(0, limit - 1)).join("")}…`;
}

const ASK_HINT =
  /[?\uFF1F]|\u8bf7|\u5e2e|\u67e5|\u6574\u7406|\u5199|\u641c\u7d22|\u603b\u7ed3|\u751f\u6210|\u5206\u6790|\u7ffb\u8bd1|\u4ecb\u7ecd|continue|please/i;

function looksLikeCopiedContext(text: string): boolean {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const bullets = lines.filter(
    (line) =>
      /^[-*•、]/.test(line) ||
      /^\*\*/.test(line) ||
      /^#{1,6}\s/.test(line) ||
      /^\d+[\.)]\s/.test(line),
  );
  return bullets.length >= 3 || lines.length >= 6;
}

function looksLikeUserAsk(text: string): boolean {
  if (!text || [...text].length > 200) return false;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 3) return false;
  if (looksLikeCopiedContext(text)) return false;
  return ASK_HINT.test(text) || [...text].length <= 80;
}

/** Keep the user's actual next ask when a pasted article sits above it. */
export function extractPromptEnhanceTarget(draft: string): string {
  const trimmed = draft.trim();
  if (!trimmed) return "";
  const lines = trimmed.split(/\r?\n/);
  const lastLine = [...lines].reverse().find((line) => line.trim())?.trim() ?? trimmed;
  const earlier = trimmed.slice(0, Math.max(0, trimmed.lastIndexOf(lastLine))).trim();
  if (looksLikeCopiedContext(earlier) && looksLikeUserAsk(lastLine)) return lastLine;
  const blocks = trimmed.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const lastBlock = blocks[blocks.length - 1] ?? trimmed;
  if (
    blocks.length >= 2 &&
    looksLikeCopiedContext(blocks.slice(0, -1).join("\n")) &&
    looksLikeUserAsk(lastBlock)
  ) {
    return lastBlock;
  }
  return trimmed;
}

export function countPromptEnhanceChars(text: string): number {
  return [...text.replace(/\s+/g, " ").trim()].length;
}

const ENHANCE_SCAFFOLD_HEADING =
  /^(?:current draft|selected workspace folder|recent conversation|attachment filenames|mention names in the draft|background for rewriting only(?:\s*\(do not copy\))?|prompt to rewrite|context(?:\s*\(do not copy\))?)\s*:?$/i;

export function isUsableEnhancedPrompt(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  if (countPromptEnhanceChars(clean) > PROMPT_ENHANCE_HARD_MAX_CHARS) return false;
  if (looksLikeCopiedContext(clean)) return false;
  const first = clean.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  if (ENHANCE_SCAFFOLD_HEADING.test(first)) return false;
  return true;
}

export type HomePromptEnhanceContext = {
  draft: string;
  attachmentNames?: readonly string[];
  workspaceFolderName?: string | null;
  mentionNames?: readonly string[];
  recentTurns?: readonly PromptEnhanceTurn[];
};

export function buildHomePromptEnhanceUserMessage(input: HomePromptEnhanceContext): string {
  const draft = extractPromptEnhanceTarget(input.draft);
  const lines = ["Prompt to rewrite:", draft];
  const attachments = (input.attachmentNames ?? []).map((name) => name.trim()).filter(Boolean);
  if (attachments.length) {
    lines.push("", "Attachment filenames:", attachments.join(", "));
  }
  const mentions = (input.mentionNames ?? []).map((name) => name.trim()).filter(Boolean);
  if (mentions.length) {
    lines.push("", "Mention names in the draft:", mentions.map((name) => `@${name}`).join(", "));
  }
  const lastUser = [...(input.recentTurns ?? [])]
    .reverse()
    .find((turn) => turn.role === "user" && turn.text.trim());
  if (lastUser) {
    lines.push(
      "",
      "Context (do not copy):",
      `Previous ask: ${clipPromptEnhanceLine(lastUser.text, PROMPT_ENHANCE_TURN_CHAR_LIMIT)}. The assistant already replied.`,
    );
  }
  return lines.join("\n");
}

const ENHANCE_ROLE_LINE =
  /^(?:user|assistant|human|ai|previous user|previous assistant|they previously asked|the assistant previously replied)\s*:\s*/i;

export function unwrapEnhancedPromptText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const fenced = trimmed.match(/^```(?:[\w-]+)?\r?\n([\s\S]*?)\r?\n```$/);
  const body = (fenced?.[1] ?? trimmed).trim();
  const kept: string[] = [];
  let skipValue = false;
  let inTranscript = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      inTranscript = false;
      if (kept.length && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }
    if (ENHANCE_SCAFFOLD_HEADING.test(line)) {
      inTranscript = /conversation|background|rewriting/i.test(line);
      skipValue = !inTranscript;
      continue;
    }
    if (skipValue) {
      skipValue = false;
      continue;
    }
    if (inTranscript && ENHANCE_ROLE_LINE.test(line)) continue;
    inTranscript = false;
    kept.push(raw);
  }
  while (kept.length && !kept[0]?.trim()) kept.shift();
  while (kept.length && !kept[kept.length - 1]?.trim()) kept.pop();
  return kept.join("\n").trim();
}

function eventProperty(properties: unknown, key: string): unknown {
  if (!properties || typeof properties !== "object") return undefined;
  return Reflect.get(properties, key);
}

function isScratchSessionComplete(
  event: { type: string; properties?: unknown },
  sessionId: string,
): boolean {
  if (eventProperty(event.properties, "sessionID") !== sessionId) return false;
  if (event.type === "session.idle") return true;
  if (event.type !== "session.status") return false;
  const status = eventProperty(event.properties, "status");
  return eventProperty(status, "type") === "idle";
}

function isScratchSessionError(
  event: { type: string; properties?: unknown },
  sessionId: string,
): string | null {
  if (event.type !== "session.error") return null;
  if (eventProperty(event.properties, "sessionID") !== sessionId) return null;
  const error = eventProperty(event.properties, "error");
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object" && "message" in error) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return "Prompt enhance failed";
}

function readAssistantTextDelta(
  event: { type: string; properties?: unknown },
  sessionId: string,
  parts: Map<string, string>,
): void {
  if (event.type !== "message.part.updated") return;
  const part = eventProperty(event.properties, "part");
  if (!part || typeof part !== "object") return;
  const record = part as {
    id?: unknown;
    sessionID?: unknown;
    type?: unknown;
    text?: unknown;
    synthetic?: unknown;
  };
  if (record.sessionID !== sessionId || record.type !== "text") return;
  if (record.synthetic === true) return;
  if (typeof record.id !== "string" || typeof record.text !== "string") return;
  parts.set(record.id, record.text);
}

function joinedPartText(parts: Map<string, string>): string {
  return unwrapEnhancedPromptText(Array.from(parts.values()).join("\n"));
}

function extractAssistantTextFromMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const row = messages[index];
    if (!row || typeof row !== "object") continue;
    const info = Reflect.get(row, "info");
    const role =
      info && typeof info === "object" ? Reflect.get(info, "role") : Reflect.get(row, "role");
    if (role !== "assistant") continue;
    const parts = Reflect.get(row, "parts");
    if (!Array.isArray(parts)) continue;
    const chunks: string[] = [];
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      if (Reflect.get(part, "type") !== "text") continue;
      if (Reflect.get(part, "synthetic") === true) continue;
      const text = Reflect.get(part, "text");
      if (typeof text === "string" && text.trim()) chunks.push(text);
    }
    const joined = unwrapEnhancedPromptText(chunks.join("\n"));
    if (joined) return joined;
  }
  return "";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
  });
}

async function deleteScratchSession(
  client: Client,
  sessionID: string,
  directory?: string,
): Promise<boolean> {
  try {
    const params = directory ? { sessionID, directory } : { sessionID };
    const result = await client.session.delete(params);
    if (result && typeof result === "object" && "error" in result && result.error !== undefined) {
      return false;
    }
    unregisterPromptEnhanceScratchSession(sessionID);
    return true;
  } catch {
    return false;
  }
}

export type EnhancePromptWithScratchSessionInput = {
  client: Client;
  directory?: string | null;
  model: ModelRef;
  variant?: string | null;
  draft: string;
  attachmentNames?: readonly string[];
  workspaceFolderName?: string | null;
  mentionNames?: readonly string[];
  recentTurns?: readonly PromptEnhanceTurn[];
  signal?: AbortSignal;
  timeoutMs?: number;
};

function finalizeEnhancedPrompt(raw: string): string {
  return extractPromptEnhanceTarget(unwrapEnhancedPromptText(raw));
}

export async function enhancePromptWithScratchSession(
  input: EnhancePromptWithScratchSessionInput,
): Promise<string> {
  const target = extractPromptEnhanceTarget(input.draft);
  if (!target) throw new Error("Prompt is empty");
  const first = await runPromptEnhanceScratchSession({ ...input, draft: target });
  const cleaned = finalizeEnhancedPrompt(first);
  if (isUsableEnhancedPrompt(cleaned) && cleaned !== target) return cleaned;
  if (input.recentTurns?.length) {
    const retry = await runPromptEnhanceScratchSession({
      ...input,
      draft: target,
      recentTurns: [],
    });
    const retryCleaned = finalizeEnhancedPrompt(retry);
    if (isUsableEnhancedPrompt(retryCleaned)) return retryCleaned;
  }
  if (isUsableEnhancedPrompt(cleaned)) return cleaned;
  throw new Error("Prompt enhance returned unusable text");
}

async function runPromptEnhanceScratchSession(
  input: EnhancePromptWithScratchSessionInput,
): Promise<string> {
  const draft = input.draft.trim();
  if (!draft) throw new Error("Prompt is empty");
  if (!input.model.providerID?.trim() || !input.model.modelID?.trim()) {
    throw new Error("Model unavailable");
  }

  const directory = toSessionTransportDirectory(input.directory) || undefined;
  const timeoutMs = input.timeoutMs ?? PROMPT_ENHANCE_TIMEOUT_MS;
  const parentSignal = input.signal;
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  const timeout =
    timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  let sessionId = "";
  try {
    for (const ghostId of listPromptEnhanceScratchSessions()) {
      await deleteScratchSession(input.client, ghostId, directory);
    }

    const created = unwrap(
      await input.client.session.create({
        title: PROMPT_ENHANCE_SESSION_TITLE,
        directory,
      }),
    );
    sessionId = created.id?.trim() ?? "";
    if (!sessionId) throw new Error("Failed to create enhance session");
    registerPromptEnhanceScratchSession(sessionId);

    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");

    const subscription = await input.client.event.subscribe(undefined, {
      signal: controller.signal,
    });
    const parts = new Map<string, string>();
    let consumeError: unknown = null;
    const consume = (async () => {
      for await (const raw of subscription.stream) {
        if (!raw || typeof raw !== "object") continue;
        const event = raw as { type?: unknown; properties?: unknown; payload?: unknown };
        const typed =
          typeof event.type === "string"
            ? { type: event.type, properties: event.properties }
            : event.payload && typeof event.payload === "object"
              ? (event.payload as { type: string; properties?: unknown })
              : null;
        if (!typed || typeof typed.type !== "string") continue;
        const error = isScratchSessionError(typed, sessionId);
        if (error) throw new Error(error);
        readAssistantTextDelta(typed, sessionId, parts);
        if (isScratchSessionComplete(typed, sessionId)) return;
      }
    })();
    void consume.catch((error) => {
      consumeError = error;
    });

    const promptRequest = input.client.session.promptAsync({
      sessionID: sessionId,
      directory,
      model: {
        providerID: input.model.providerID,
        modelID: input.model.modelID,
      },
      ...(input.variant?.trim() ? { variant: input.variant.trim() } : {}),
      tools: DISABLED_TOOLS,
      system: PROMPT_ENHANCE_SYSTEM,
      parts: [
        {
          type: "text",
          text: buildHomePromptEnhanceUserMessage({
            draft,
            attachmentNames: input.attachmentNames,
            workspaceFolderName: input.workspaceFolderName,
            mentionNames: input.mentionNames,
            recentTurns: input.recentTurns,
          }),
        },
      ],
    });
    void promptRequest.catch(() => undefined);
    const abortWait = waitForAbort(controller.signal);
    void abortWait.catch(() => undefined);
    try {
      unwrap(await Promise.race([promptRequest, abortWait]));
    } catch (error) {
      if (!isAbortError(error)) throw error;
    }

    try {
      await consume;
    } catch (error) {
      consumeError = error;
    }

    let text = joinedPartText(parts);
    if (!text) {
      try {
        const messages = unwrap(
          await input.client.session.messages({
            sessionID: sessionId,
            directory,
            limit: 8,
          }),
        );
        text = extractAssistantTextFromMessages(messages);
      } catch {
        // keep streamed text
      }
    }
    if (text && (consumeError == null || isAbortError(consumeError))) return text;
    if (consumeError && !isAbortError(consumeError)) throw consumeError;
    if (!text) throw new Error("Prompt enhance returned no text");
    return text;
  } finally {
    if (timeout) clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", onParentAbort);
    if (sessionId) {
      try {
        await input.client.session.abort({ sessionID: sessionId, directory });
      } catch {
        // already idle
      }
      await deleteScratchSession(input.client, sessionId, directory);
    }
  }
}
