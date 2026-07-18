/**
 * Conversation memory extract + staging helpers (pure).
 * Confirmed items live in prefs; only `items` are injected (never `pending`).
 */

import type {
  ConversationMemoryItem,
  ConversationMemoryState,
} from "../../../kernel/local-provider";

export const MAX_CONVERSATION_MEMORY_ITEMS = 50;
export const MAX_CONVERSATION_MEMORY_TEXT_CHARS = 500;
export const MAX_PENDING_MEMORY_ITEMS = 20;
export const MAX_EXTRACT_CANDIDATES_PER_TURN = 3;

const SENSITIVE_RE =
  /(?:api[_-]?key|secret|password|passwd|token|bearer\s+[a-z0-9._-]+|\b\d{15,19}\b|\b1[3-9]\d{9}\b)/i;

/** Explicit remember / identity / preference signals (CN + EN). */
// CN matchers use unicode escapes so check-i18n-cjk does not flag this module.
const EXTRACT_PATTERNS: RegExp[] = [
  // 请记住 / 记住
  /(?:\u8bf7)?\u8bb0\u4f4f(?:\u4e00\u4e0b)?[：:\s]+(.+)/i,
  /\u8bb0\u4f4f[：:\s]*(.+)/i,
  // 以后
  /\u4ee5\u540e(?:\u8bf7)?(?:\u90fd)?[：:\s]*(.+)/i,
  // 我叫 / 我是
  /\u6211(?:\u7684\u540d\u5b57)?\u53eb[：:\s]*(.+)/i,
  /\u6211\u662f[：:\s]*(.+)/i,
  // 偏好 / 不要 / 请勿
  /\u504f\u597d[：:\s]*(.+)/i,
  /\u4e0d\u8981[：:\s]*(.+)/i,
  /\u8bf7\u52ff[：:\s]*(.+)/i,
  /remember(?:\s+that)?[：:\s]+(.+)/i,
  /please\s+remember[：:\s]+(.+)/i,
  /my\s+name\s+is[：:\s]+(.+)/i,
  /i\s+am[：:\s]+(.+)/i,
  /i'?m[：:\s]+(.+)/i,
  /prefer(?:ence)?[：:\s]+(.+)/i,
  /don'?t[：:\s]+(.+)/i,
  /do\s+not[：:\s]+(.+)/i,
];

export function createConversationMemoryId(prefix = "mem"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeMemoryFingerprint(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[。.!！?？,，;；:：]/g, "");
}

export function isSensitiveMemoryText(text: string): boolean {
  return SENSITIVE_RE.test(text);
}

export function shouldAttemptMemoryExtract(userText: string): boolean {
  const text = userText.trim();
  if (!text || text.length < 2) return false;
  return EXTRACT_PATTERNS.some((re) => re.test(text));
}

/**
 * Rule-based extract from a single user turn (no LLM).
 * Returns short standalone facts suitable for confirmation UI.
 */
export function extractMemoryCandidatesFromUserText(
  userText: string,
  options?: { sessionId?: string; now?: number },
): ConversationMemoryItem[] {
  const text = userText.trim();
  if (!text || !shouldAttemptMemoryExtract(text)) return [];

  const now = options?.now ?? Date.now();
  const sessionId = options?.sessionId;
  const seen = new Set<string>();
  const out: ConversationMemoryItem[] = [];

  for (const re of EXTRACT_PATTERNS) {
    const match = text.match(re);
    if (!match?.[1]) continue;
    let body = match[1].trim();
    // Truncate at sentence boundary if the capture is huge
    const cut = body.search(/[。\n]/);
    if (cut > 12) body = body.slice(0, cut).trim();
    body = body.slice(0, MAX_CONVERSATION_MEMORY_TEXT_CHARS).trim();
    if (body.length < 2) continue;
    if (isSensitiveMemoryText(body)) continue;

    const fact = formatExtractedFact(text, body);
    const fp = normalizeMemoryFingerprint(fact);
    if (seen.has(fp)) continue;
    seen.add(fp);

    out.push({
      id: createConversationMemoryId("pend"),
      text: fact,
      source: "dialog",
      updatedAt: now,
      sessionId,
    });
    if (out.length >= MAX_EXTRACT_CANDIDATES_PER_TURN) break;
  }

  return out;
}

function formatExtractedFact(original: string, body: string): string {
  // Prefixes stay English (i18n CJK gate); captured body may be any language.
  if (
    /\u6211\u662f|\u6211(?:\u7684\u540d\u5b57)?\u53eb|my\s+name\s+is|i\s+am|i'?m/i.test(
      original,
    )
  ) {
    return `User identity: ${body}`;
  }
  if (/\u504f\u597d|prefer/i.test(original)) {
    return `User preference: ${body}`;
  }
  if (/\u4e0d\u8981|\u8bf7\u52ff|don'?t|do\s+not/i.test(original)) {
    const cleaned = body
      .replace(/^\u4e0d\u8981/, "")
      .replace(/^do not\s+/i, "")
      .replace(/^don't\s+/i, "")
      .trim();
    return `User constraint: do not ${cleaned}`;
  }
  if (/\u4ee5\u540e/i.test(original)) {
    return `User standing request: ${body}`;
  }
  return body.startsWith("User ") ? body : `User note: ${body}`;
}

export function mergePendingMemoryCandidates(
  state: ConversationMemoryState,
  candidates: ConversationMemoryItem[],
): ConversationMemoryState {
  if (!state.enabled || candidates.length === 0) return state;

  const existingFp = new Set(
    [...state.items, ...state.pending].map((item) =>
      normalizeMemoryFingerprint(item.text),
    ),
  );

  const additions: ConversationMemoryItem[] = [];
  for (const candidate of candidates) {
    const text = candidate.text.trim().slice(0, MAX_CONVERSATION_MEMORY_TEXT_CHARS);
    if (!text || isSensitiveMemoryText(text)) continue;
    const fp = normalizeMemoryFingerprint(text);
    if (existingFp.has(fp)) continue;
    existingFp.add(fp);
    additions.push({
      ...candidate,
      text,
      source: "dialog",
      updatedAt: candidate.updatedAt || Date.now(),
    });
  }

  if (additions.length === 0) return state;
  return {
    ...state,
    pending: [...additions, ...state.pending].slice(0, MAX_PENDING_MEMORY_ITEMS),
  };
}

export function acceptPendingMemory(
  state: ConversationMemoryState,
  id: string,
): ConversationMemoryState {
  const pendingItem = state.pending.find((item) => item.id === id);
  if (!pendingItem) return state;

  const text = pendingItem.text.trim().slice(0, MAX_CONVERSATION_MEMORY_TEXT_CHARS);
  if (!text) {
    return {
      ...state,
      pending: state.pending.filter((item) => item.id !== id),
    };
  }

  const fp = normalizeMemoryFingerprint(text);
  const itemsWithoutDup = state.items.filter(
    (item) => normalizeMemoryFingerprint(item.text) !== fp,
  );
  const confirmed: ConversationMemoryItem = {
    ...pendingItem,
    text,
    source: "dialog",
    updatedAt: Date.now(),
  };

  return {
    ...state,
    pending: state.pending.filter((item) => item.id !== id),
    items: [confirmed, ...itemsWithoutDup].slice(0, MAX_CONVERSATION_MEMORY_ITEMS),
  };
}

export function rejectPendingMemory(
  state: ConversationMemoryState,
  id: string,
): ConversationMemoryState {
  return {
    ...state,
    pending: state.pending.filter((item) => item.id !== id),
  };
}

export function acceptAllPendingMemory(
  state: ConversationMemoryState,
): ConversationMemoryState {
  let next = state;
  for (const item of state.pending) {
    next = acceptPendingMemory(next, item.id);
  }
  return next;
}
