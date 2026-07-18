/**
 * Conversation memory helpers (pure).
 *
 * Model: a flat list of profile-style lines written into `items` and injected
 * via buildOnboardingProfileSystemPrompt. Format:
 *   [YYYY-MM-DD] #category content
 *
 * Categories align with the personal usage profile template:
 * instruction | identity | career | project | preference
 */

import type {
  ConversationMemoryItem,
  ConversationMemoryState,
} from "../../../kernel/local-provider";

export const MAX_CONVERSATION_MEMORY_ITEMS = 50;
export const MAX_CONVERSATION_MEMORY_TEXT_CHARS = 500;
export const MAX_PENDING_MEMORY_ITEMS = 20;
export const MAX_EXTRACT_CANDIDATES_PER_TURN = 3;

/** Personal-profile categories (stable ids; UI localizes labels). */
export type MemoryProfileCategory =
  | "instruction"
  | "identity"
  | "career"
  | "project"
  | "preference";

export const MEMORY_PROFILE_CATEGORIES: MemoryProfileCategory[] = [
  "instruction",
  "identity",
  "career",
  "project",
  "preference",
];

const SENSITIVE_RE =
  /(?:api[_-]?key|secret|password|passwd|token|bearer\s+[a-z0-9._-]+|\b\d{15,19}\b|\b1[3-9]\d{9}\b)/i;

type ExtractRule = {
  category: MemoryProfileCategory;
  /** Full-message match; group 1 = content (keep user's wording). */
  re: RegExp;
};

// CN patterns use unicode escapes for i18n-cjk gate.
const EXTRACT_RULES: ExtractRule[] = [
  // instruction: 记住 / 以后 / 不要 / 请勿 / remember / don't
  {
    category: "instruction",
    re: /(?:\u8bf7)?\u8bb0\u4f4f(?:\u4e00\u4e0b)?[：:\s]+(.+)$/i,
  },
  {
    category: "instruction",
    re: /\u4ee5\u540e(?:\u8bf7)?(?:\u90fd)?[：:\s]*(.+)$/i,
  },
  {
    category: "instruction",
    re: /(?:\u8bf7\u52ff|\u4e0d\u8981)[：:\s]*(.+)$/i,
  },
  {
    category: "instruction",
    re: /remember(?:\s+that)?[：:\s]+(.+)$/i,
  },
  {
    category: "instruction",
    re: /please\s+remember[：:\s]+(.+)$/i,
  },
  {
    category: "instruction",
    re: /(?:don'?t|do\s+not)[：:\s]+(.+)$/i,
  },
  // identity: 我是 / 我叫 / I am
  {
    category: "identity",
    re: /\u6211(?:\u7684\u540d\u5b57)?\u53eb[：:\s]*(.+)$/i,
  },
  {
    category: "identity",
    re: /\u6211\u662f[：:\s]*(.+)$/i,
  },
  {
    category: "identity",
    re: /my\s+name\s+is[：:\s]+(.+)$/i,
  },
  {
    category: "identity",
    re: /i\s+am[：:\s]+(.+)$/i,
  },
  // career: 我做 / 我在…做 / I work
  {
    category: "career",
    re: /\u6211\u505a[：:\s]*(.+)$/i,
  },
  {
    category: "career",
    re: /\u6211\u5728.{0,12}(?:\u505a|\u8d1f\u8d23)[：:\s]*(.+)$/i,
  },
  {
    category: "career",
    re: /i\s+work(?:\s+as|\s+on)?[：:\s]+(.+)$/i,
  },
  // preference: 偏好 / prefer
  {
    category: "preference",
    re: /\u504f\u597d[：:\s]*(.+)$/i,
  },
  {
    category: "preference",
    re: /prefer(?:ence)?[：:\s]+(.+)$/i,
  },
];

// Section headers when pasting a full profile block (unicode for CN).
const PROFILE_SECTION_RE =
  /^(?:#{1,3}\s*)?(instruction|identity|career|project|preference|\u6307\u4ee4|\u8eab\u4efd|\u804c\u4e1a|\u9879\u76ee|\u504f\u597d)\s*[：:]?\s*$/i;

const LINE_ITEM_RE =
  /^\[(\d{4}-\d{2}-\d{2}|unknown)\]\s*(?:#([a-z]+)|\u00b7|·|-)?\s*(.+)$/i;

export function createConversationMemoryId(prefix = "mem"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function todayMemoryDate(now = Date.now()): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function normalizeMemoryFingerprint(text: string): string {
  // Ignore date + category tags when deduping content.
  const stripped = text
    .replace(/^\[[\dunknown-]+\]\s*/i, "")
    .replace(/^#[a-z]+\s+/i, "")
    .trim();
  return stripped
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
  return EXTRACT_RULES.some((rule) => rule.re.test(text));
}

export function formatProfileMemoryLine(input: {
  category: MemoryProfileCategory;
  content: string;
  date?: string;
}): string {
  const date = input.date ?? todayMemoryDate();
  const content = input.content.trim().slice(0, MAX_CONVERSATION_MEMORY_TEXT_CHARS - 32);
  return `[${date}] #${input.category} ${content}`;
}

export function parseProfileMemoryLine(text: string): {
  date: string;
  category: MemoryProfileCategory | null;
  content: string;
} {
  const raw = text.trim();
  const tagged = raw.match(/^\[([^\]]+)\]\s*#([a-z]+)\s+(.+)$/i);
  if (tagged) {
    const category = MEMORY_PROFILE_CATEGORIES.includes(
      tagged[2].toLowerCase() as MemoryProfileCategory,
    )
      ? (tagged[2].toLowerCase() as MemoryProfileCategory)
      : null;
    return { date: tagged[1], category, content: tagged[3].trim() };
  }
  const loose = raw.match(LINE_ITEM_RE);
  if (loose) {
    return {
      date: loose[1],
      category: null,
      content: (loose[3] ?? loose[2] ?? "").trim() || raw,
    };
  }
  return { date: "unknown", category: null, content: raw };
}

function mapSectionHeader(header: string): MemoryProfileCategory | null {
  const h = header.trim().toLowerCase();
  if (h === "instruction" || h === "\u6307\u4ee4") return "instruction";
  if (h === "identity" || h === "\u8eab\u4efd") return "identity";
  if (h === "career" || h === "\u804c\u4e1a") return "career";
  if (h === "project" || h === "\u9879\u76ee") return "project";
  if (h === "preference" || h === "\u504f\u597d") return "preference";
  return null;
}

/**
 * Rule-based extract: one best match, keep user wording, tag with profile category.
 */
export function extractMemoryCandidatesFromUserText(
  userText: string,
  options?: { sessionId?: string; now?: number },
): ConversationMemoryItem[] {
  const text = userText.trim();
  if (!text || !shouldAttemptMemoryExtract(text)) return [];

  const now = options?.now ?? Date.now();
  const sessionId = options?.sessionId;
  const date = todayMemoryDate(now);

  for (const rule of EXTRACT_RULES) {
    const match = text.match(rule.re);
    if (!match?.[1]) continue;
    let body = match[1].trim();
    // Prefer short capture: stop at first sentence end for long tails
    const cut = body.search(/[。\n]/);
    if (cut > 8) body = body.slice(0, cut).trim();
    // Strip trailing filler like " / 我是..."
    body = body.split(/\s*\/\s*/)[0]?.trim() ?? body;
    body = body.slice(0, 200).trim();
    if (body.length < 2 || isSensitiveMemoryText(body)) continue;

    const line = formatProfileMemoryLine({
      category: rule.category,
      content: body,
      date,
    });
    return [
      {
        id: createConversationMemoryId("mem"),
        text: line,
        source: "dialog",
        updatedAt: now,
        sessionId,
      },
    ];
  }
  return [];
}

/**
 * Import a multi-section personal profile block (user-pasted AI output).
 * Supports headers: 指令/身份/职业/项目/偏好 or English tags.
 * Lines: `[YYYY-MM-DD] - content` or plain lines under a section.
 */
export function importProfileBlockToItems(
  block: string,
  options?: { now?: number; sessionId?: string },
): ConversationMemoryItem[] {
  const now = options?.now ?? Date.now();
  const fallbackDate = todayMemoryDate(now);
  const lines = block.split(/\r?\n/);
  let current: MemoryProfileCategory | null = null;
  const out: ConversationMemoryItem[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("```")) continue;

    const section = line.match(PROFILE_SECTION_RE);
    if (section) {
      current = mapSectionHeader(section[1]);
      continue;
    }

    let date = fallbackDate;
    let content = line;
    let category = current;

    const tagged = line.match(/^\[([^\]]+)\]\s*#([a-z]+)\s+(.+)$/i);
    if (tagged) {
      date = tagged[1];
      category =
        (MEMORY_PROFILE_CATEGORIES.includes(
          tagged[2].toLowerCase() as MemoryProfileCategory,
        )
          ? (tagged[2].toLowerCase() as MemoryProfileCategory)
          : current) ?? "preference";
      content = tagged[3].trim();
    } else {
      const dated = line.match(/^\[([^\]]+)\]\s*[-–—·]?\s*(.+)$/);
      if (dated) {
        date = dated[1];
        content = dated[2].trim();
      }
    }

    if (!category) category = "preference";
    if (content.length < 2 || isSensitiveMemoryText(content)) continue;

    const text = formatProfileMemoryLine({ category, content, date });
    const fp = normalizeMemoryFingerprint(text);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push({
      id: createConversationMemoryId("mem"),
      text,
      source: "manual",
      updatedAt: now,
      sessionId: options?.sessionId,
    });
    if (out.length >= MAX_CONVERSATION_MEMORY_ITEMS) break;
  }
  return out;
}

/** Write candidates straight into `items` (no pending queue). */
export function appendMemoryItems(
  state: ConversationMemoryState,
  candidates: ConversationMemoryItem[],
): ConversationMemoryState {
  if (!state.enabled || candidates.length === 0) return state;

  const existingFp = new Set(
    state.items.map((item) => normalizeMemoryFingerprint(item.text)),
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
      updatedAt: candidate.updatedAt || Date.now(),
    });
  }

  if (additions.length === 0) return state;
  return {
    ...state,
    pending: state.pending ?? [],
    items: [...additions, ...state.items].slice(0, MAX_CONVERSATION_MEMORY_ITEMS),
  };
}

/** @deprecated Prefer appendMemoryItems — kept for accept/reject helpers. */
export function mergePendingMemoryCandidates(
  state: ConversationMemoryState,
  candidates: ConversationMemoryItem[],
): ConversationMemoryState {
  // Direct-write path: simpler UX, write into items immediately.
  return appendMemoryItems(state, candidates);
}

export function acceptPendingMemory(
  state: ConversationMemoryState,
  id: string,
): ConversationMemoryState {
  const pendingItem = (state.pending ?? []).find((item) => item.id === id);
  if (!pendingItem) return state;
  const without = {
    ...state,
    pending: (state.pending ?? []).filter((item) => item.id !== id),
  };
  return appendMemoryItems(without, [
    { ...pendingItem, source: "dialog", updatedAt: Date.now() },
  ]);
}

export function rejectPendingMemory(
  state: ConversationMemoryState,
  id: string,
): ConversationMemoryState {
  return {
    ...state,
    pending: (state.pending ?? []).filter((item) => item.id !== id),
  };
}

export function acceptAllPendingMemory(
  state: ConversationMemoryState,
): ConversationMemoryState {
  let next = state;
  for (const item of state.pending ?? []) {
    next = acceptPendingMemory(next, item.id);
  }
  return next;
}

/**
 * Prompt template for AI tools: organize a portable personal profile.
 * Stored as one string; CN text via unicode so CJK gate stays clean.
 */
export function buildPersonalProfileInsightPrompt(): string {
  // "请帮我整理一份我的个人使用画像..." full template
  return [
    "\u8bf7\u5e2e\u6211\u6574\u7406\u4e00\u4efd\u6211\u7684\u4e2a\u4eba\u4f7f\u7528\u753b\u50cf\uff0c\u7528\u9014\u662f\u8ba9\u6211\u5728\u4e0d\u540c AI \u5de5\u5177\u4e4b\u95f4\u4fdd\u6301\u4e00\u81f4\u7684\u534f\u4f5c\u4f53\u9a8c\u3002\u8bf7\u57fa\u4e8e\u4f60\u5f53\u524d\u80fd\u8bbf\u95ee\u5230\u7684\u3001\u4e0e\u6211\u76f8\u5173\u7684\u957f\u671f\u4fe1\u606f\u548c\u672c\u6b21\u4f1a\u8bdd\u4e0a\u4e0b\u6587\u8fdb\u884c\u6574\u7406\u3002\u5728\u6d89\u53ca\u6211\u7684\u6307\u4ee4\u548c\u504f\u597d\u65f6\uff0c\u8bf7\u5c3d\u91cf\u4fdd\u7559\u6211\u539f\u672c\u7684\u8868\u8ff0\u65b9\u5f0f\uff0c\u4e0d\u8981\u8fc7\u5ea6\u6539\u5199\u3002",
    "",
    "\u5206\u7c7b\uff08\u6309\u4ee5\u4e0b\u987a\u5e8f\u8f93\u51fa\uff09",
    "\u6307\u4ee4\uff1a\u6211\u660e\u786e\u8981\u6c42\u9075\u5faa\u7684\u89c4\u5219\uff08\u8bed\u6c14/\u683c\u5f0f/\u98ce\u683c/\u59cb\u7ec8\u505a X/\u7edd\u4e0d\u505a Y/\u5bf9\u52a9\u624b\u884c\u4e3a\u7684\u7ea0\u6b63\uff09\u3002\u4ec5\u6574\u7406\u53ef\u4ece\u957f\u671f\u8bb0\u5fc6\u4e2d\u660e\u786e\u8bc6\u522b\u5e76\u5ba2\u89c2\u5b58\u5728\u7684\u89c4\u5219\uff0c\u4e0d\u4e34\u65f6\u65b0\u589e\u3001\u4e0d\u5f3a\u52a0\u3001\u4e0d\u8111\u8865\u3002",
    "\u8eab\u4efd\uff1a\u59d3\u540d\u3001\u5e74\u9f84\u3001\u6240\u5728\u5730\u3001\u6559\u80b2\u80cc\u666f\u3001\u5bb6\u5ead\u3001\u4eba\u9645\u5173\u7cfb\u3001\u8bed\u8a00\u80fd\u529b\u548c\u4e2a\u4eba\u5174\u8da3\uff08\u4ec5\u5305\u542b\u6211\u4e3b\u52a8\u5206\u4eab\u8fc7\u7684\u975e\u654f\u611f\u4fe1\u606f\uff09\u3002",
    "\u804c\u4e1a\uff1a\u5f53\u524d\u548c\u8fc7\u5f80\u7684\u804c\u4f4d\u3001\u516c\u53f8\u4ee5\u53ca\u4e3b\u8981\u6280\u80fd\u9886\u57df\u3002",
    "\u9879\u76ee\uff1a\u6211\u5b9e\u9645\u53c2\u4e0e\u6784\u5efa\u6216\u6295\u5165\u7cbe\u529b\u7684\u9879\u76ee\u3002\u6bcf\u4e2a\u9879\u76ee\u4e00\u6761\u3002",
    "\u504f\u597d\uff1a\u5e7f\u6cdb\u9002\u7528\u7684\u89c2\u70b9\u3001\u54c1\u5473\u548c\u5de5\u4f5c\u98ce\u683c\u504f\u597d\u3002",
    "",
    "\u683c\u5f0f",
    "\u4f7f\u7528\u5206\u7c7b\u6807\u9898\u4f5c\u4e3a\u6bcf\u4e2a\u7c7b\u522b\u7684\u8282\u6807\u9898\u3002\u6bcf\u4e2a\u7c7b\u522b\u5185\uff0c\u6bcf\u884c\u4e00\u6761\u8bb0\u5f55\uff0c\u6309\u65e5\u671f\u4ece\u65e9\u5230\u665a\u6392\u5217\u3002\u6bcf\u884c\u683c\u5f0f\uff1a",
    "",
    "[YYYY-MM-DD] - \u6761\u76ee\u5185\u5bb9",
    "",
    "\u5982\u679c\u65e5\u671f\u672a\u77e5\uff0c\u4f7f\u7528 [unknown] \u4ee3\u66ff\u3002",
    "",
    "\u8f93\u51fa",
    "\u5c06\u6574\u4e2a\u753b\u50cf\u5305\u88f9\u5728\u4e00\u4e2a\u4ee3\u7801\u5757\u4e2d\uff0c\u65b9\u4fbf\u590d\u5236\u3002",
  ].join("\n");
}
