/**
 * Local account avatar appearance (WorkBuddy-style color + initial/emoji).
 * Stored in localStorage; independent of onboarding profile / welcome flow.
 */

export type AccountAvatarMode = "initial" | "emoji";

export type AccountAvatarColorId =
  | "gray"
  | "violet"
  | "purple"
  | "amber"
  | "orange"
  | "sky"
  | "blue"
  | "slate"
  | "mint";

export type AccountAvatarPrefs = {
  colorId: AccountAvatarColorId;
  mode: AccountAvatarMode;
  emoji: string;
};

export const ACCOUNT_AVATAR_STORAGE_KEY = "onmyagent.account.avatar";

/** Soft pastel backgrounds aligned with common office-agent profile UIs. */
export const ACCOUNT_AVATAR_COLORS: ReadonlyArray<{
  id: AccountAvatarColorId;
  /** Tailwind-friendly solid fill for the circle. */
  className: string;
  /** Hex for inline style fallback when class may not load. */
  hex: string;
}> = [
  { id: "gray", className: "bg-zinc-200 dark:bg-zinc-600", hex: "#e4e4e7" },
  { id: "violet", className: "bg-violet-200 dark:bg-violet-700", hex: "#ddd6fe" },
  { id: "purple", className: "bg-purple-200 dark:bg-purple-700", hex: "#e9d5ff" },
  { id: "amber", className: "bg-amber-200 dark:bg-amber-700", hex: "#fde68a" },
  { id: "orange", className: "bg-orange-200 dark:bg-orange-700", hex: "#fed7aa" },
  { id: "sky", className: "bg-sky-200 dark:bg-sky-700", hex: "#bae6fd" },
  { id: "blue", className: "bg-blue-200 dark:bg-blue-700", hex: "#bfdbfe" },
  { id: "slate", className: "bg-slate-200 dark:bg-slate-600", hex: "#e2e8f0" },
  { id: "mint", className: "bg-emerald-200 dark:bg-emerald-700", hex: "#a7f3d0" },
];

/** Compact emoji set (animals / hobbies / symbols) for the picker grid. */
export const ACCOUNT_AVATAR_EMOJIS = [
  "🦊",
  "🐶",
  "🐰",
  "🐻",
  "🐼",
  "🐨",
  "🐯",
  "🐸",
  "🐵",
  "🦉",
  "🦋",
  "🐙",
  "⭐",
  "🌙",
  "☀️",
  "🌈",
  "⚡",
  "🎯",
  "🚀",
  "💡",
  "🎨",
  "🎮",
  "📚",
  "☕",
  "🐧",
  "🐢",
  "🦆",
  "🐝",
  "🦄",
  "🦒",
  "🍄",
  "🌻",
  "🌱",
  "✈️",
  "🎹",
  "🎸",
  "🎬",
  "📷",
  "🎤",
  "🥁",
  "🧩",
  "🚲",
  "🍕",
  "🧁",
  "🍦",
  "⚽",
  "🏀",
  "🎾",
  "🎁",
  "👑",
  "⛰️",
  "🔭",
  "💎",
  "🧠",
] as const;

export const DEFAULT_ACCOUNT_AVATAR_PREFS: AccountAvatarPrefs = {
  colorId: "amber",
  mode: "emoji",
  emoji: "🦊",
};

const listeners = new Set<() => void>();

function isColorId(value: unknown): value is AccountAvatarColorId {
  return (
    typeof value === "string" &&
    ACCOUNT_AVATAR_COLORS.some((color) => color.id === value)
  );
}

export function normalizeAccountAvatarPrefs(
  input: Partial<AccountAvatarPrefs> | null | undefined,
): AccountAvatarPrefs {
  const colorId = isColorId(input?.colorId)
    ? input.colorId
    : DEFAULT_ACCOUNT_AVATAR_PREFS.colorId;
  const mode: AccountAvatarMode =
    input?.mode === "initial" || input?.mode === "emoji"
      ? input.mode
      : DEFAULT_ACCOUNT_AVATAR_PREFS.mode;
  const emoji =
    typeof input?.emoji === "string" && input.emoji.trim()
      ? input.emoji.trim().slice(0, 8)
      : DEFAULT_ACCOUNT_AVATAR_PREFS.emoji;
  return { colorId, mode, emoji };
}

export function readAccountAvatarPrefs(): AccountAvatarPrefs {
  if (typeof window === "undefined") return DEFAULT_ACCOUNT_AVATAR_PREFS;
  try {
    const raw = window.localStorage.getItem(ACCOUNT_AVATAR_STORAGE_KEY);
    if (!raw) return DEFAULT_ACCOUNT_AVATAR_PREFS;
    return normalizeAccountAvatarPrefs(JSON.parse(raw) as Partial<AccountAvatarPrefs>);
  } catch {
    return DEFAULT_ACCOUNT_AVATAR_PREFS;
  }
}

export function writeAccountAvatarPrefs(prefs: AccountAvatarPrefs): void {
  if (typeof window === "undefined") return;
  const next = normalizeAccountAvatarPrefs(prefs);
  try {
    window.localStorage.setItem(ACCOUNT_AVATAR_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota
  }
  for (const listener of listeners) listener();
}

export function patchAccountAvatarPrefs(
  patch: Partial<AccountAvatarPrefs>,
): AccountAvatarPrefs {
  const next = normalizeAccountAvatarPrefs({
    ...readAccountAvatarPrefs(),
    ...patch,
  });
  writeAccountAvatarPrefs(next);
  return next;
}

export function subscribeAccountAvatarPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function accountAvatarColorClass(colorId: AccountAvatarColorId): string {
  return (
    ACCOUNT_AVATAR_COLORS.find((color) => color.id === colorId)?.className ??
    ACCOUNT_AVATAR_COLORS[0]!.className
  );
}

export function accountAvatarColorHex(colorId: AccountAvatarColorId): string {
  return (
    ACCOUNT_AVATAR_COLORS.find((color) => color.id === colorId)?.hex ??
    ACCOUNT_AVATAR_COLORS[0]!.hex
  );
}

/** Prefer personal profile name, then auth account, then empty. */
export function resolveAccountDisplayName(input: {
  profileUserName?: string | null;
  accountName?: string | null;
  accountEmail?: string | null;
}): string {
  const profile = (input.profileUserName ?? "").trim();
  if (profile) return profile;
  const name = (input.accountName ?? "").trim();
  if (name) return name;
  return (input.accountEmail ?? "").trim();
}

export function accountAvatarInitial(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "";
  // Prefer first non-space grapheme for CJK / Latin.
  const match = trimmed.match(/\S/u);
  return (match?.[0] ?? trimmed.charAt(0)).toUpperCase();
}

/** Read onboarding profile userName from preferences without React context. */
export function readProfileUserNameFromStorage(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem("onmyagent.preferences");
    if (!raw) return "";
    const parsed = JSON.parse(raw) as {
      onboardingProfile?: { userName?: string };
    };
    return typeof parsed?.onboardingProfile?.userName === "string"
      ? parsed.onboardingProfile.userName.trim()
      : "";
  } catch {
    return "";
  }
}
