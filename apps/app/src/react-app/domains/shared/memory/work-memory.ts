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
 * Seed bodies for awareness files (keep in sync with desktop workMemoryEnsureAwareness).
 * Used by danger-zone reset/clear and first-open seeds.
 */
export const WORK_MEMORY_SEED = {
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
} as const;

export type WorkMemorySeedFileName = keyof typeof WORK_MEMORY_SEED;

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
    out.push(`- ${row.label}: ${row.value.trim()}`);
  }
  out.push("");
}

/**
 * Build USER.md body from Personal settings (onboarding profile).
 * Empty / skipped profile → seed template (still creates a real file).
 */
export function buildUserProfileMarkdown(
  profile: OnboardingProfile | null | undefined,
  labels?: UserProfileLabelMaps,
): string {
  if (!profile || profile.skipped) {
    return WORK_MEMORY_SEED["USER.md"];
  }

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
    return WORK_MEMORY_SEED["USER.md"];
  }

  const out: string[] = [
    "# User profile",
    "",
    "> Generated from Settings → Personal. Editing Personal rewrites this file.",
    "",
  ];

  pushBulletSection(out, "Basics", [
    { label: "Name", value: profile.userName },
    { label: "Assistant name", value: profile.assistantName },
    { label: "MBTI", value: profile.mbti },
  ]);

  pushBulletSection(out, "Work", [
    { label: "Roles", value: roles.join(", ") },
    { label: "Industries", value: industries.join(", ") },
  ]);

  pushBulletSection(out, "Habits", [
    { label: "Tools", value: tools.join(", ") },
    { label: "Tasks", value: tasks.join(", ") },
  ]);

  if (profile.docPreference === "data" || profile.docPreference === "narrative") {
    out.push("## Document preference", "");
    out.push(
      profile.docPreference === "data"
        ? "- Data-driven (tables, charts, quantitative analysis)"
        : "- Narrative-driven (paragraphs with highlighted key points)",
    );
    out.push("");
  }

  if (profile.terminology.trim()) {
    out.push("## Terminology / format", "", profile.terminology.trim(), "");
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
