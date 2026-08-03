/**
 * Work-memory file mirror (prefs → disk; viewer save → prefs).
 *
 * Authority for model inject: prefs only.
 * Disk file bodies follow app language (zh / zh-TW / en); allowlisted for CJK gate.
 */
import { currentLocale } from "@/i18n";
import { isElectronRuntime } from "../../../../app/utils";
import {
  ensureWorkMemoryAwarenessDir,
  writeWorkMemoryAwarenessFile,
} from "../../../../app/lib/desktop";
import type {
  ConversationMemoryItem,
  ConversationMemoryState,
  OnboardingProfile,
} from "../../../kernel/local-provider";
import {
  normalizeResponseTone,
  type ResponseToneId,
} from "../../../kernel/response-tone";
import { createConversationMemoryId } from "./conversation-memory";
import {
  buildUserProfileMarkdown,
  resolveAwarenessFileLocale,
  selectGlobalMemoryItems,
  type UserProfileLabelMaps,
} from "./work-memory";

// ─── fingerprints / timers ───────────────────────────────────────────

let lastUserFingerprint = "";
let lastStyleFingerprint = "";
let lastMemoryFingerprint = "";
let userTimer: ReturnType<typeof setTimeout> | null = null;
let styleTimer: ReturnType<typeof setTimeout> | null = null;
let memoryTimer: ReturnType<typeof setTimeout> | null = null;

function activeLocale(override?: string | null): string {
  return override ?? currentLocale();
}

// ─── builders (prefs → markdown) ─────────────────────────────────────

export function buildStyleMarkdown(
  responseTone: string | null | undefined,
  customInstructions: string | null | undefined,
  locale?: string | null,
): string {
  const tone = normalizeResponseTone(responseTone);
  const instructions = (customInstructions ?? "").trim();
  const loc = resolveAwarenessFileLocale(locale);
  if (loc === "en") {
    return [
      "# Collaboration style",
      "",
      "> Synced from Settings → Personal. Edit and save to write back to the app.",
      "",
      "## Tone",
      tone,
      "",
      "## Custom instructions",
      instructions || "(none)",
      "",
    ].join("\n");
  }
  if (loc === "zh-TW") {
    return [
      "# 協作風格",
      "",
      "> 由「設定 → 個人」自動同步。也可在此編輯後保存回應用。",
      "",
      "## 語氣",
      tone,
      "",
      "## 自訂指令",
      instructions || "（無）",
      "",
    ].join("\n");
  }
  return [
    "# 协作风格",
    "",
    "> 由「设置 → 个人」自动同步。也可在此编辑后保存回应用。",
    "",
    "## 语气",
    tone,
    "",
    "## 自定义指令",
    instructions || "（无）",
    "",
  ].join("\n");
}

export function buildLongTermMemoryMarkdown(
  state: ConversationMemoryState | null | undefined,
  locale?: string | null,
): string {
  const global = selectGlobalMemoryItems(state?.items ?? []).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  const loc = resolveAwarenessFileLocale(locale);
  const header =
    loc === "en"
      ? [
          "# Long-term memory",
          "",
          "> Global confirmed memories synced by the app. Expert-scoped items are not listed here.",
          "",
        ]
      : loc === "zh-TW"
        ? [
            "# 長期記憶",
            "",
            "> 由應用自動同步全域已確認記憶。專家域記憶不在此檔。",
            "",
          ]
        : [
            "# 长期记忆",
            "",
            "> 由应用自动同步全局已确认记忆。专家域记忆不在此文件。",
            "",
          ];
  const empty =
    loc === "en" ? "(no items)" : loc === "zh-TW" ? "（暫無條目）" : "（暂无条目）";
  const lines = [...header];
  if (global.length === 0) {
    lines.push(empty, "");
  } else {
    for (const item of global) {
      const text = item.text.trim();
      if (text) lines.push(`- ${text}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ─── parsers (markdown → prefs) ──────────────────────────────────────

function sectionBody(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `##\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    "i",
  );
  const match = markdown.match(re);
  return (match?.[1] ?? "").trim();
}

function bulletValue(markdown: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^-\\s*${escaped}\\s*[：:]\\s*(.+)$`, "im");
  const match = markdown.match(re);
  return (match?.[1] ?? "").trim();
}

function reverseMapLabels(
  joined: string,
  labels?: Record<string, string>,
): string[] {
  if (!joined.trim()) return [];
  const parts = joined
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!labels) return parts;
  const labelToValue = new Map<string, string>();
  for (const [value, label] of Object.entries(labels)) {
    labelToValue.set(label, value);
    labelToValue.set(value, value);
  }
  return parts.map((part) => labelToValue.get(part) ?? part);
}

export function parseStyleMarkdown(content: string): {
  responseTone: ResponseToneId;
  customInstructions: string;
} {
  // Accept en + zh + zh-TW headings written by locale-aware builders.
  const toneRaw =
    (
      sectionBody(content, "Tone") ||
      sectionBody(content, "语气") ||
      sectionBody(content, "語氣")
    )
      .split("\n")[0]
      ?.trim() ?? "";
  let instructions =
    sectionBody(content, "Custom instructions") ||
    sectionBody(content, "自定义指令") ||
    sectionBody(content, "自訂指令");
  if (
    instructions === "(none)" ||
    instructions === "（无）" ||
    instructions === "（無）"
  ) {
    instructions = "";
  }
  return {
    responseTone: normalizeResponseTone(toneRaw || "default"),
    customInstructions: instructions,
  };
}

export function parseUserProfileMarkdown(
  content: string,
  labels?: UserProfileLabelMaps,
  base?: OnboardingProfile | null,
): OnboardingProfile {
  const fallback: OnboardingProfile = base ?? {
    userName: "",
    assistantName: "",
    mbti: "",
    roles: [],
    industries: [],
    tools: [],
    tasks: [],
    docPreference: "",
    terminology: "",
    skipped: false,
    updatedAt: Date.now(),
  };

  const name =
    bulletValue(content, "Name") ||
    bulletValue(content, "称呼") ||
    bulletValue(content, "稱呼") ||
    fallback.userName;
  const assistantName =
    bulletValue(content, "Assistant name") ||
    bulletValue(content, "助手名") ||
    fallback.assistantName;
  const rolesRaw =
    bulletValue(content, "Roles") ||
    bulletValue(content, "角色");
  const industriesRaw =
    bulletValue(content, "Industries") ||
    bulletValue(content, "行业") ||
    bulletValue(content, "產業");
  const toolsRaw =
    bulletValue(content, "Tools") ||
    bulletValue(content, "常用工具");
  const tasksRaw =
    bulletValue(content, "Tasks") ||
    bulletValue(content, "常见任务") ||
    bulletValue(content, "常見任務");

  return {
    ...fallback,
    userName: name,
    assistantName,
    mbti: bulletValue(content, "MBTI") || fallback.mbti,
    roles: reverseMapLabels(rolesRaw, labels?.roles),
    industries: reverseMapLabels(industriesRaw, labels?.industries),
    tools: reverseMapLabels(toolsRaw, labels?.tools),
    tasks: reverseMapLabels(tasksRaw, labels?.tasks),
    skipped: false,
    updatedAt: Date.now(),
  };
}

/** Extract global long-term lines from MEMORY.md (- bullets). */
export function parseLongTermMemoryMarkdown(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) continue;
    const text = trimmed.slice(2).trim();
    if (
      !text ||
      text === "(no items)" ||
      text === "（暂无条目）" ||
      text === "（暫無條目）" ||
      text.startsWith("(") ||
      text.startsWith("（")
    ) {
      continue;
    }
    out.push(text.slice(0, 2000));
  }
  return out;
}

export function applyLongTermMemoryMarkdown(
  state: ConversationMemoryState,
  content: string,
): ConversationMemoryState {
  const texts = parseLongTermMemoryMarkdown(content);
  const expertItems = state.items.filter((item) => Boolean(item.expertId?.trim()));
  const now = Date.now();
  const globalItems: ConversationMemoryItem[] = texts.map((text, index) => ({
    id: createConversationMemoryId("mem"),
    text,
    source: "manual",
    updatedAt: now - index,
  }));
  return {
    ...state,
    items: [...expertItems, ...globalItems],
    pending: state.pending ?? [],
    shortTerm: state.shortTerm ?? [],
  };
}

// ─── disk write ──────────────────────────────────────────────────────

async function writeAwarenessFile(
  name: string,
  content: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!isElectronRuntime()) {
    return { ok: false, reason: "not_desktop" };
  }
  try {
    await ensureWorkMemoryAwarenessDir();
    await writeWorkMemoryAwarenessFile({ name, content });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return { ok: false, reason: message || "write_failed" };
  }
}

function profileFingerprint(
  profile: OnboardingProfile | null | undefined,
  labels?: UserProfileLabelMaps,
): string {
  return JSON.stringify({
    p: profile
      ? {
          userName: profile.userName,
          assistantName: profile.assistantName,
          mbti: profile.mbti,
          roles: profile.roles,
          industries: profile.industries,
          tools: profile.tools,
          tasks: profile.tasks,
          docPreference: profile.docPreference,
          terminology: profile.terminology,
          skipped: profile.skipped,
          updatedAt: profile.updatedAt,
        }
      : null,
    labels: labels ?? null,
  });
}

/**
 * Write USER.md (+ profile.md) from Personal profile.
 */
export async function syncUserProfileAwarenessFiles(
  profile: OnboardingProfile | null | undefined,
  labels?: UserProfileLabelMaps,
): Promise<{ ok: boolean; reason?: string }> {
  const locale = activeLocale();
  const content = buildUserProfileMarkdown(profile, labels, locale);
  const fingerprint = JSON.stringify({
    locale: resolveAwarenessFileLocale(locale),
    body: profileFingerprint(profile, labels),
  });
  if (fingerprint === lastUserFingerprint) {
    return { ok: true, reason: "unchanged" };
  }
  const written = await writeAwarenessFile("USER.md", content);
  if (!written.ok) return written;
  await writeAwarenessFile("profile.md", content);
  lastUserFingerprint = fingerprint;
  return { ok: true };
}

/**
 * Write style.md from tone + custom instructions.
 */
export async function syncStyleAwarenessFiles(
  responseTone: string | null | undefined,
  customInstructions: string | null | undefined,
): Promise<{ ok: boolean; reason?: string }> {
  const locale = activeLocale();
  const content = buildStyleMarkdown(responseTone, customInstructions, locale);
  const fingerprint = JSON.stringify({
    locale: resolveAwarenessFileLocale(locale),
    tone: normalizeResponseTone(responseTone),
    instructions: (customInstructions ?? "").trim(),
  });
  if (fingerprint === lastStyleFingerprint) {
    return { ok: true, reason: "unchanged" };
  }
  const written = await writeAwarenessFile("style.md", content);
  if (!written.ok) return written;
  lastStyleFingerprint = fingerprint;
  return { ok: true };
}

/**
 * Rewrite MEMORY.md from global long-term items.
 */
export async function syncMemoryAwarenessFiles(
  state: ConversationMemoryState | null | undefined,
): Promise<{ ok: boolean; reason?: string }> {
  const locale = activeLocale();
  const content = buildLongTermMemoryMarkdown(state, locale);
  const fingerprint = JSON.stringify({
    locale: resolveAwarenessFileLocale(locale),
    items: selectGlobalMemoryItems(state?.items ?? []).map((item) => item.text),
  });
  if (fingerprint === lastMemoryFingerprint) {
    return { ok: true, reason: "unchanged" };
  }
  const written = await writeAwarenessFile("MEMORY.md", content);
  if (!written.ok) return written;
  lastMemoryFingerprint = fingerprint;
  return { ok: true };
}

/** Personal pack: USER + style in one call. */
export async function syncPersonalAwarenessFiles(input: {
  profile: OnboardingProfile | null | undefined;
  labels?: UserProfileLabelMaps;
  responseTone?: string | null;
  customInstructions?: string | null;
}): Promise<void> {
  await syncUserProfileAwarenessFiles(input.profile, input.labels);
  if (
    input.responseTone !== undefined ||
    input.customInstructions !== undefined
  ) {
    await syncStyleAwarenessFiles(
      input.responseTone,
      input.customInstructions,
    );
  }
}

export function scheduleSyncUserProfileAwarenessFiles(
  profile: OnboardingProfile | null | undefined,
  labels?: UserProfileLabelMaps,
  delayMs = 400,
): void {
  if (!isElectronRuntime()) return;
  if (userTimer) clearTimeout(userTimer);
  userTimer = setTimeout(() => {
    userTimer = null;
    void syncUserProfileAwarenessFiles(profile, labels);
  }, delayMs);
}

export function scheduleSyncStyleAwarenessFiles(
  responseTone: string | null | undefined,
  customInstructions: string | null | undefined,
  delayMs = 400,
): void {
  if (!isElectronRuntime()) return;
  if (styleTimer) clearTimeout(styleTimer);
  styleTimer = setTimeout(() => {
    styleTimer = null;
    void syncStyleAwarenessFiles(responseTone, customInstructions);
  }, delayMs);
}

export function scheduleSyncMemoryAwarenessFiles(
  state: ConversationMemoryState | null | undefined,
  delayMs = 400,
): void {
  if (!isElectronRuntime()) return;
  if (memoryTimer) clearTimeout(memoryTimer);
  memoryTimer = setTimeout(() => {
    memoryTimer = null;
    void syncMemoryAwarenessFiles(state);
  }, delayMs);
}

export function scheduleSyncPersonalAwarenessFiles(input: {
  profile: OnboardingProfile | null | undefined;
  labels?: UserProfileLabelMaps;
  responseTone?: string | null;
  customInstructions?: string | null;
  delayMs?: number;
}): void {
  const delay = input.delayMs ?? 400;
  scheduleSyncUserProfileAwarenessFiles(input.profile, input.labels, delay);
  if (
    input.responseTone !== undefined ||
    input.customInstructions !== undefined
  ) {
    scheduleSyncStyleAwarenessFiles(
      input.responseTone,
      input.customInstructions,
      delay,
    );
  }
}

/** Build label maps from option lists (value → display label). */
export function buildUserProfileLabelMaps(options: {
  roles?: ReadonlyArray<{ value: string; label: string }>;
  industries?: ReadonlyArray<{ value: string; label: string }>;
  tools?: ReadonlyArray<{ value: string; label: string }>;
  tasks?: ReadonlyArray<{ value: string; label: string }>;
}): UserProfileLabelMaps {
  const toMap = (
    list?: ReadonlyArray<{ value: string; label: string }>,
  ): Record<string, string> | undefined => {
    if (!list?.length) return undefined;
    const map: Record<string, string> = {};
    for (const item of list) {
      map[item.value] = item.label;
    }
    return map;
  };
  return {
    roles: toMap(options.roles),
    industries: toMap(options.industries),
    tools: toMap(options.tools),
    tasks: toMap(options.tasks),
  };
}

/**
 * Apply viewer-saved markdown back into prefs-shaped patches.
 * Caller merges into local prefs. AGENTS.md → no prefs patch.
 */
export function prefsPatchFromAwarenessFile(
  fileName: "USER.md" | "style.md" | "MEMORY.md" | "AGENTS.md" | string,
  content: string,
  context: {
    profile?: OnboardingProfile | null;
    labels?: UserProfileLabelMaps;
    conversationMemory?: ConversationMemoryState | null;
  },
): {
  onboardingProfile?: OnboardingProfile;
  responseTone?: ResponseToneId;
  customInstructions?: string;
  conversationMemory?: ConversationMemoryState;
} | null {
  if (fileName === "USER.md") {
    return {
      onboardingProfile: parseUserProfileMarkdown(
        content,
        context.labels,
        context.profile,
      ),
    };
  }
  if (fileName === "style.md") {
    return parseStyleMarkdown(content);
  }
  if (fileName === "MEMORY.md") {
    const base = context.conversationMemory ?? {
      enabled: false,
      autoCapture: false,
      items: [],
      pending: [],
      shortTerm: [],
    };
    return {
      conversationMemory: applyLongTermMemoryMarkdown(base, content),
    };
  }
  return null;
}
