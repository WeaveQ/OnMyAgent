/**
 * Work memory assembly (pure): personal profile (B') + confirmed memory + expert slots.
 * Main-session system context only — not Personal agent runtime / session-archive.
 */

import type {
  ConversationMemoryItem,
  ConversationMemoryState,
  OnboardingProfile,
} from "../../../kernel/local-provider";
import {
  MAX_CONVERSATION_MEMORY_ITEMS,
  MAX_EXPERT_MEMORY_ITEMS,
  MAX_INJECTED_EXPERT_MEMORY_CHARS,
  MAX_INJECTED_MEMORY_CHARS,
  MAX_INJECTED_SHORT_TERM_CHARS,
  MAX_SHORT_TERM_MEMORY_ITEMS,
} from "./conversation-memory";

export type WorkMemoryAwarenessPaths = {
  /** User-level awareness root (file backend). */
  userAwarenessRoot: string;
  globalMainDir: string;
  expertSlotDir: (expertId: string) => string;
  workspaceAwarenessDir: (workspaceRoot: string) => string;
};

/**
 * Canonical paths under ~/.onmyagent/data/user/awareness (plan SoT).
 * Pure path join — no fs. Caller supplies home dir.
 */
export function resolveWorkMemoryAwarenessPaths(
  homeDir: string,
): WorkMemoryAwarenessPaths {
  const root = joinPath(homeDir, ".onmyagent", "data", "user", "awareness");
  const globalMainDir = joinPath(root, "main");
  return {
    userAwarenessRoot: root,
    globalMainDir,
    expertSlotDir: (expertId: string) =>
      joinPath(globalMainDir, "experts", sanitizeExpertId(expertId)),
    workspaceAwarenessDir: (workspaceRoot: string) =>
      joinPath(workspaceRoot, ".onmyagent", "awareness"),
  };
}

export function sanitizeExpertId(expertId: string): string {
  return expertId
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 120);
}

function joinPath(...parts: string[]): string {
  const sep = parts.some((p) => p.includes("\\")) ? "\\" : "/";
  const normalized = parts
    .map((p, i) => {
      let s = p.replace(/\\/g, "/");
      if (i > 0) s = s.replace(/^\/+/, "");
      s = s.replace(/\/+$/, "");
      return s;
    })
    .filter(Boolean);
  const joined = normalized.join("/");
  return sep === "\\" ? joined.replace(/\//g, "\\") : joined;
}

/**
 * Awareness disk templates follow the app language setting (zh / zh-TW / en).
 * These strings are file-body copy (not in-app chrome) and are allowlisted in
 * check-i18n-cjk.mjs — keep them in sync with desktop ensure-work-memory-awareness.
 */
export type AwarenessFileLocale = "en" | "zh" | "zh-TW";

export type WorkMemorySeedFileName =
  | "style.md"
  | "AGENTS.md"
  | "MEMORY.md"
  | "USER.md"
  | "profile.md"
  | "pending.json";

export function resolveAwarenessFileLocale(
  locale?: string | null,
): AwarenessFileLocale {
  const raw = String(locale ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (raw === "zh-tw" || raw === "zh-hant" || raw.startsWith("zh-tw")) {
    return "zh-TW";
  }
  if (raw === "zh" || raw.startsWith("zh-")) return "zh";
  if (raw.startsWith("en")) return "en";
  // Default product locale for disk packs.
  return "zh";
}

const SEED_BY_LOCALE: Record<
  AwarenessFileLocale,
  Record<WorkMemorySeedFileName, string>
> = {
  en: {
    "style.md":
      "# Collaboration style\n\nTone and custom instructions.\n\n## Tone\ndefault\n\n## Custom instructions\n(none)\n",
    "AGENTS.md":
      "# Work handbook\n\nProject / collaboration rules. Edit this file directly.\n\n## Rules\n- \n",
    "MEMORY.md":
      "# Long-term memory\n\nConfirmed facts and preferences across sessions.\n",
    "USER.md":
      "# User profile\n\n> Generated from Settings → Personal.\n\n## Basics\n- Name:\n- Assistant name:\n- MBTI:\n\n## Work\n- Roles:\n- Industries:\n\n## Habits\n- Tools:\n- Tasks:\n",
    "profile.md": "# User profile\n\n(mirrors USER.md)\n",
    "pending.json": "[]\n",
  },
  zh: {
    "style.md":
      "# 协作风格\n\n语气与自定义指令。\n\n## 语气\ndefault\n\n## 自定义指令\n（无）\n",
    "AGENTS.md":
      "# 工作手册\n\n项目 / 协作规范。可直接编辑本文件。\n\n## 规则\n- \n",
    "MEMORY.md": "# 长期记忆\n\n跨会话确认的事实与偏好。\n",
    "USER.md":
      "# 用户画像\n\n> 由「设置 → 个人」自动生成。\n\n## 基本信息\n- 称呼：\n- 助手名：\n- MBTI：\n\n## 工作\n- 角色：\n- 行业：\n\n## 习惯\n- 常用工具：\n- 常见任务：\n",
    "profile.md": "# 用户画像\n\n（与 USER.md 同步）\n",
    "pending.json": "[]\n",
  },
  "zh-TW": {
    "style.md":
      "# 協作風格\n\n語氣與自訂指令。\n\n## 語氣\ndefault\n\n## 自訂指令\n（無）\n",
    "AGENTS.md":
      "# 工作手冊\n\n專案 / 協作規範。可直接編輯本檔案。\n\n## 規則\n- \n",
    "MEMORY.md": "# 長期記憶\n\n跨會話確認的事實與偏好。\n",
    "USER.md":
      "# 使用者畫像\n\n> 由「設定 → 個人」自動產生。\n\n## 基本資訊\n- 稱呼：\n- 助手名：\n- MBTI：\n\n## 工作\n- 角色：\n- 產業：\n\n## 習慣\n- 常用工具：\n- 常見任務：\n",
    "profile.md": "# 使用者畫像\n\n（與 USER.md 同步）\n",
    "pending.json": "[]\n",
  },
};

/** Default seed pack (zh). Prefer getWorkMemorySeed(locale). */
export const WORK_MEMORY_SEED = SEED_BY_LOCALE.zh;

export function getWorkMemorySeed(
  locale?: string | null,
): Record<WorkMemorySeedFileName, string> {
  return SEED_BY_LOCALE[resolveAwarenessFileLocale(locale)];
}

/**
 * Clear global long-term items + pending + short-term.
 * Expert-scoped items (slot C) are kept by default (plan §3.5).
 */
export function clearGlobalWorkMemory(
  state: ConversationMemoryState,
): ConversationMemoryState {
  return {
    ...state,
    items: state.items.filter((item) => Boolean(item.expertId?.trim())),
    pending: [],
    shortTerm: [],
  };
}

/** Global confirmed items (no expertId). */
export function selectGlobalMemoryItems(
  items: ConversationMemoryItem[],
): ConversationMemoryItem[] {
  return items.filter((item) => !item.expertId?.trim());
}

/** Expert-scoped confirmed items for one expert only. */
export function selectExpertMemoryItems(
  items: ConversationMemoryItem[],
  expertId: string | null | undefined,
): ConversationMemoryItem[] {
  const id = expertId?.trim();
  if (!id) return [];
  return items.filter((item) => item.expertId?.trim() === id);
}

export function truncateMemoryLines(
  lines: string[],
  maxChars: number,
): { lines: string[]; truncated: boolean } {
  if (maxChars <= 0) return { lines: [], truncated: lines.length > 0 };
  const out: string[] = [];
  let used = 0;
  let truncated = false;
  for (const line of lines) {
    const next = used === 0 ? line.length : used + 1 + line.length;
    if (next > maxChars) {
      truncated = true;
      break;
    }
    out.push(line);
    used = next;
  }
  if (out.length < lines.length) truncated = true;
  return { lines: out, truncated };
}

function joinValues(label: string, values: string[]) {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? `${label}: ${normalized.join(", ")}` : null;
}

/** Personal profile lines only (B' — independent of memory.enabled). */
export function buildPersonalProfileLines(
  profile: OnboardingProfile | null | undefined,
): string[] {
  if (!profile || profile.skipped) return [];
  const lines: string[] = [];
  if (profile.userName.trim()) lines.push(`User name: ${profile.userName.trim()}`);
  if (profile.assistantName.trim()) {
    lines.push(
      `In personal assistant chats, the user wants the assistant named: ${profile.assistantName.trim()}`,
    );
  }
  if (profile.mbti.trim()) lines.push(`User MBTI: ${profile.mbti.trim()}`);
  const roleLine = joinValues("User role", profile.roles);
  if (roleLine) lines.push(roleLine);
  const industryLine = joinValues("User industry", profile.industries);
  if (industryLine) lines.push(industryLine);
  const toolsLine = joinValues("User tools", profile.tools);
  if (toolsLine) lines.push(toolsLine);
  const tasksLine = joinValues("User common tasks", profile.tasks);
  if (tasksLine) lines.push(tasksLine);
  if (profile.docPreference === "data") {
    lines.push(
      "Document preference: data-driven (prefer tables, charts, quantitative analysis).",
    );
  } else if (profile.docPreference === "narrative") {
    lines.push(
      "Document preference: narrative-driven (prefer paragraphs with highlighted key points).",
    );
  }
  if (profile.terminology.trim()) {
    lines.push(`Terminology / format preferences: ${profile.terminology.trim()}`);
  }
  return lines;
}

/**
 * Display labels for option values when writing USER.md.
 * Callers resolve i18n labels; raw values are used as fallback.
 */
export type UserProfileLabelMaps = {
  roles?: Record<string, string>;
  industries?: Record<string, string>;
  tools?: Record<string, string>;
  tasks?: Record<string, string>;
};

function mapOptionLabels(
  values: string[] | undefined,
  labels?: Record<string, string>,
): string[] {
  if (!values?.length) return [];
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => labels?.[value] ?? value);
}

function pushBulletSection(
  out: string[],
  title: string,
  bullets: Array<{ label: string; value: string }>,
) {
  const filled = bullets.filter((row) => row.value.trim());
  if (filled.length === 0) return;
  out.push(`## ${title}`, "");
  for (const row of filled) {
    // Fullwidth colon for CJK locales when label is CJK-looking.
    const sep = /[\u4e00-\u9fff]/.test(row.label) ? "：" : ": ";
    out.push(`- ${row.label}${sep}${row.value.trim()}`);
  }
  out.push("");
}

type UserProfileCopy = {
  title: string;
  note: string;
  basics: string;
  name: string;
  assistant: string;
  work: string;
  roles: string;
  industries: string;
  habits: string;
  tools: string;
  tasks: string;
  docTitle: string;
  docData: string;
  docNarrative: string;
  terminology: string;
  listJoin: string;
};

function userProfileCopy(locale?: string | null): UserProfileCopy {
  const loc = resolveAwarenessFileLocale(locale);
  if (loc === "en") {
    return {
      title: "User profile",
      note: "> Generated from Settings → Personal. Editing Personal rewrites this file.",
      basics: "Basics",
      name: "Name",
      assistant: "Assistant name",
      work: "Work",
      roles: "Roles",
      industries: "Industries",
      habits: "Habits",
      tools: "Tools",
      tasks: "Tasks",
      docTitle: "Document preference",
      docData: "- Data-driven (tables, charts, quantitative analysis)",
      docNarrative:
        "- Narrative-driven (paragraphs with highlighted key points)",
      terminology: "Terminology / format",
      listJoin: ", ",
    };
  }
  if (loc === "zh-TW") {
    return {
      title: "使用者畫像",
      note: "> 由「設定 → 個人」自動產生。修改個人設定會覆寫本檔。",
      basics: "基本資訊",
      name: "稱呼",
      assistant: "助手名",
      work: "工作",
      roles: "角色",
      industries: "產業",
      habits: "習慣",
      tools: "常用工具",
      tasks: "常見任務",
      docTitle: "文件偏好",
      docData: "- 資料驅動（表格、圖表、量化分析）",
      docNarrative: "- 敘述驅動（段落 + 重點標示）",
      terminology: "術語與格式",
      listJoin: "、",
    };
  }
  return {
    title: "用户画像",
    note: "> 由「设置 → 个人」自动生成。修改个人设置会覆盖本文件。",
    basics: "基本信息",
    name: "称呼",
    assistant: "助手名",
    work: "工作",
    roles: "角色",
    industries: "行业",
    habits: "习惯",
    tools: "常用工具",
    tasks: "常见任务",
    docTitle: "文档偏好",
    docData: "- 数据驱动（表格、图表、量化分析）",
    docNarrative: "- 叙述驱动（段落 + 要点高亮）",
    terminology: "术语与格式",
    listJoin: "、",
  };
}

/**
 * Build USER.md body from Personal settings (onboarding profile).
 * Language follows app locale (zh / zh-TW / en). Empty → seed template.
 */
export function buildUserProfileMarkdown(
  profile: OnboardingProfile | null | undefined,
  labels?: UserProfileLabelMaps,
  locale?: string | null,
): string {
  const seed = getWorkMemorySeed(locale);
  if (!profile || profile.skipped) {
    return seed["USER.md"];
  }

  const copy = userProfileCopy(locale);
  const roles = mapOptionLabels(profile.roles, labels?.roles);
  const industries = mapOptionLabels(profile.industries, labels?.industries);
  const tools = mapOptionLabels(profile.tools, labels?.tools);
  const tasks = mapOptionLabels(profile.tasks, labels?.tasks);

  const hasAny =
    Boolean(profile.userName.trim()) ||
    Boolean(profile.assistantName.trim()) ||
    Boolean(profile.mbti.trim()) ||
    roles.length > 0 ||
    industries.length > 0 ||
    tools.length > 0 ||
    tasks.length > 0 ||
    Boolean(profile.docPreference) ||
    Boolean(profile.terminology.trim());

  if (!hasAny) {
    return seed["USER.md"];
  }

  const out: string[] = [`# ${copy.title}`, "", copy.note, ""];

  pushBulletSection(out, copy.basics, [
    { label: copy.name, value: profile.userName },
    { label: copy.assistant, value: profile.assistantName },
    { label: "MBTI", value: profile.mbti },
  ]);

  pushBulletSection(out, copy.work, [
    { label: copy.roles, value: roles.join(copy.listJoin) },
    { label: copy.industries, value: industries.join(copy.listJoin) },
  ]);

  pushBulletSection(out, copy.habits, [
    { label: copy.tools, value: tools.join(copy.listJoin) },
    { label: copy.tasks, value: tasks.join(copy.listJoin) },
  ]);

  if (profile.docPreference === "data" || profile.docPreference === "narrative") {
    out.push(`## ${copy.docTitle}`, "");
    out.push(
      profile.docPreference === "data" ? copy.docData : copy.docNarrative,
    );
    out.push("");
  }

  if (profile.terminology.trim()) {
    out.push(`## ${copy.terminology}`, "", profile.terminology.trim(), "");
  }

  return out.join("\n").replace(/\n+$/, "\n");
}

function sortByUpdatedDesc(items: ConversationMemoryItem[]): ConversationMemoryItem[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt);
}

export type BuildWorkMemoryContextInput = {
  profile: OnboardingProfile | null | undefined;
  conversationMemory?: ConversationMemoryState | null;
  /** Bound expert for this session (slot C). */
  expertId?: string | null;
  /** Optional workspace handbook markdown (layer D). */
  handbookText?: string | null;
  maxGlobalMemoryChars?: number;
  maxExpertMemoryChars?: number;
  maxGlobalItems?: number;
  maxExpertItems?: number;
};

export type WorkMemoryContextResult = {
  systemText: string | null;
  /** Personal profile included (B'). */
  hasPersonal: boolean;
  /** Confirmed memory lines included (requires enabled). */
  hasMemory: boolean;
  truncated: boolean;
};

/**
 * Assemble main-session system context.
 * - Personal profile injects when present even if memory.enabled is false (B').
 * - Confirmed global + matching expert memory inject only when enabled.
 * - Pending is never injected.
 */
export function buildWorkMemoryContext(
  input: BuildWorkMemoryContextInput,
): WorkMemoryContextResult {
  const profileLines = buildPersonalProfileLines(input.profile);
  const memoryEnabled = Boolean(input.conversationMemory?.enabled);
  const allItems = input.conversationMemory?.items ?? [];

  let truncated = false;
  const memoryBulletLines: string[] = [];

  if (memoryEnabled) {
    const maxGlobalItems = input.maxGlobalItems ?? MAX_CONVERSATION_MEMORY_ITEMS;
    const maxExpertItems = input.maxExpertItems ?? MAX_EXPERT_MEMORY_ITEMS;
    const maxGlobalChars =
      input.maxGlobalMemoryChars ?? MAX_INJECTED_MEMORY_CHARS;
    const maxExpertChars =
      input.maxExpertMemoryChars ?? MAX_INJECTED_EXPERT_MEMORY_CHARS;

    const globalItems = sortByUpdatedDesc(selectGlobalMemoryItems(allItems)).slice(
      0,
      maxGlobalItems,
    );
    const expertItems = sortByUpdatedDesc(
      selectExpertMemoryItems(allItems, input.expertId),
    ).slice(0, maxExpertItems);
    const shortItems = sortByUpdatedDesc(
      input.conversationMemory?.shortTerm ?? [],
    ).slice(0, MAX_SHORT_TERM_MEMORY_ITEMS);

    const globalRaw = globalItems
      .map((item) => item.text.trim())
      .filter(Boolean)
      .map((text) => `- ${text.slice(0, 500)}`);
    const expertRaw = expertItems
      .map((item) => item.text.trim())
      .filter(Boolean)
      .map((text) => `- ${text.slice(0, 500)}`);
    const shortRaw = shortItems
      .map((item) => item.text.trim())
      .filter(Boolean)
      .map((text) => `- ${text.slice(0, 500)}`);

    const g = truncateMemoryLines(globalRaw, maxGlobalChars);
    const e = truncateMemoryLines(expertRaw, maxExpertChars);
    const s = truncateMemoryLines(shortRaw, MAX_INJECTED_SHORT_TERM_CHARS);
    truncated = g.truncated || e.truncated || s.truncated;
    if (e.lines.length > 0) {
      memoryBulletLines.push(
        "Expert-scoped memories for the current expert (do not invent extras):",
        ...e.lines,
      );
    }
    if (g.lines.length > 0) {
      memoryBulletLines.push(
        "Long-term memories the user saved for personalization. Treat as durable user context; do not invent extra memories.",
        ...g.lines,
      );
    }
    if (s.lines.length > 0) {
      memoryBulletLines.push(
        "Short-term / recent notes (may be ephemeral):",
        ...s.lines,
      );
    }
  }

  const handbook = (input.handbookText ?? "").trim();
  const handbookBlock =
    handbook.length > 0
      ? [
          "Workspace work handbook (project rules). Agent-specific identity still takes precedence when defined.",
          handbook.length > 4000 ? `${handbook.slice(0, 4000)}\n…` : handbook,
        ]
      : [];

  if (
    profileLines.length === 0 &&
    memoryBulletLines.length === 0 &&
    handbookBlock.length === 0
  ) {
    return {
      systemText: null,
      hasPersonal: false,
      hasMemory: false,
      truncated: false,
    };
  }

  const parts: string[] = [];
  if (handbookBlock.length > 0) {
    parts.push(...handbookBlock);
  }
  if (profileLines.length > 0) {
    parts.push(
      "The user provided the following personal work preferences during onboarding / settings. Keep referring to them in personal assistant and agent conversations; do not proactively recap them unless the user asks.",
      "Priority rule: when the current session is bound to an agent that has its own identity, tone, addressing, background, or mind configuration, that agent configuration takes precedence; only fall back to the preferences below for areas the agent does not define.",
      ...profileLines.map((line) => `- ${line}`),
    );
  }
  if (memoryBulletLines.length > 0) {
    parts.push(...memoryBulletLines);
  }

  return {
    systemText: parts.join("\n"),
    hasPersonal: profileLines.length > 0,
    hasMemory: memoryBulletLines.length > 0,
    truncated,
  };
}
