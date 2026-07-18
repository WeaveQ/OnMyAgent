/** @jsxImportSource react */
import {
  createContext,
  useCallback,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { THINKING_PREF_KEY } from "../../app/constants";
import { coerceReleaseChannel } from "../../app/lib/release-channels";
import type { ModelRef, ReleaseChannel, SettingsTab, View } from "../../app/types";
import { canonicalizeProfileOptionValues } from "../domains/shared";
import { readStoredDefaultModel } from "./model-config";

export type LocalUIState = {
  view: View;
  tab: SettingsTab;
};

export type OnboardingProfile = {
  userName: string;
  assistantName: string;
  mbti: string;
  roles: string[];
  industries: string[];
  tools: string[];
  tasks: string[];
  /** Document output style preference for personal assistant. */
  docPreference: "data" | "narrative" | "";
  /** Free-form terminology / format notes. */
  terminology: string;
  skipped: boolean;
  updatedAt: number;
};

export type ConversationMemoryItem = {
  id: string;
  text: string;
  source: "dialog" | "manual";
  updatedAt: number;
  sessionId?: string;
};

export type ConversationMemoryState = {
  /** Default false — opt-in only. */
  enabled: boolean;
  items: ConversationMemoryItem[];
};

export const DEFAULT_CONVERSATION_MEMORY: ConversationMemoryState = {
  enabled: false,
  items: [],
};

function filterStringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((v): v is string => typeof v === "string");
}

export function normalizeOnboardingProfile(
  input: Partial<OnboardingProfile> | null | undefined,
): OnboardingProfile | null {
  if (!input || typeof input !== "object") return null;
  return {
    userName: typeof input.userName === "string" ? input.userName : "",
    assistantName: typeof input.assistantName === "string" ? input.assistantName : "",
    mbti: typeof input.mbti === "string" ? input.mbti : "",
    // Collapse fine-grained roles/industries so multi-select still matches options.
    roles: canonicalizeProfileOptionValues(filterStringList(input.roles)),
    industries: canonicalizeProfileOptionValues(filterStringList(input.industries)),
    tools: canonicalizeProfileOptionValues(filterStringList(input.tools)),
    tasks: canonicalizeProfileOptionValues(filterStringList(input.tasks)),
    docPreference:
      input.docPreference === "data" || input.docPreference === "narrative"
        ? input.docPreference
        : "",
    terminology: typeof input.terminology === "string" ? input.terminology : "",
    skipped: Boolean(input.skipped),
    updatedAt: typeof input.updatedAt === "number" ? input.updatedAt : 0,
  };
}

export function normalizeIdleHours(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 6;
  return Math.min(168, Math.max(1, Math.round(n)));
}

export function normalizeConversationMemory(
  input: Partial<ConversationMemoryState> | null | undefined,
): ConversationMemoryState {
  if (!input || typeof input !== "object") return { ...DEFAULT_CONVERSATION_MEMORY, items: [] };
  const items = Array.isArray(input.items)
    ? input.items
        .filter((item): item is ConversationMemoryItem =>
          Boolean(
            item &&
              typeof item === "object" &&
              typeof item.id === "string" &&
              typeof item.text === "string" &&
              (item.source === "dialog" || item.source === "manual") &&
              typeof item.updatedAt === "number",
          ),
        )
        .map((item) => ({
          id: item.id,
          text: item.text,
          source: item.source,
          updatedAt: item.updatedAt,
          sessionId: typeof item.sessionId === "string" ? item.sessionId : undefined,
        }))
    : [];
  return {
    enabled: Boolean(input.enabled),
    items,
  };
}

export type LocalPreferences = {
  showThinking: boolean;
  responseTone: "friendly" | "business";
  customInstructions: string;
  modelVariant: string | null;
  defaultModel: ModelRef | null;
  /**
   * When true, fire a desktop notification when an agent turn becomes idle
   * and the app is not focused. Default false — opt-in only.
   */
  desktopNotifyOnAgentReady: boolean;
  /**
   * Release channel the desktop app is subscribed to. Defaults to
   * "stable". Alpha is only honored on macOS; the updater helper falls
   * back to stable elsewhere.
   */
  releaseChannel: ReleaseChannel;
  featureFlags: {
    microsandboxCreateSandbox: boolean;
  };
  /**
   * Set to true after the user completes the welcome/onboarding flow
   * (creates or connects their first workspace). When false and the
   * workspace list is empty, the app redirects to /welcome.
   */
  hasCompletedOnboarding: boolean;
  onboardingProfile: OnboardingProfile | null;
  /** Dialog-derived / manual personal memory facts. Default disabled. */
  conversationMemory: ConversationMemoryState;
  /**
   * When true, sending after long inactivity creates a new session instead of
   * continuing the idle thread (reduces stale context / token use).
   */
  autoNewSessionOnIdle: boolean;
  /** Idle threshold in hours before auto-new-session applies. Default 6. */
  autoNewSessionIdleHours: number;
};

type LocalContextValue = {
  ui: LocalUIState;
  setUi: (updater: (previous: LocalUIState) => LocalUIState) => void;
  prefs: LocalPreferences;
  setPrefs: (updater: (previous: LocalPreferences) => LocalPreferences) => void;
  ready: boolean;
};

const LocalContext = createContext<LocalContextValue | undefined>(undefined);

const UI_STORAGE_KEY = "onmyagent.ui";
const PREFS_STORAGE_KEY = "onmyagent.preferences";
export const DEFAULT_SHOW_THINKING = true;

export const INITIAL_UI: LocalUIState = { view: "session", tab: "general" };
const INITIAL_PREFS: LocalPreferences = {
  showThinking: DEFAULT_SHOW_THINKING,
  responseTone: "business",
  customInstructions: "",
  modelVariant: null,
  defaultModel: null,
  desktopNotifyOnAgentReady: false,
  releaseChannel: "stable",
  featureFlags: { microsandboxCreateSandbox: true },
  hasCompletedOnboarding: false,
  onboardingProfile: null,
  conversationMemory: { enabled: false, items: [] },
  autoNewSessionOnIdle: false,
  autoNewSessionIdleHours: 6,
};

function readPersisted<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return { ...fallback, ...(parsed as Record<string, unknown>) } as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function writePersisted(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

type LocalProviderProps = {
  children: ReactNode;
};

export function LocalProvider({ children }: LocalProviderProps) {
  const [ui, setUiRaw] = useState<LocalUIState>(() =>
    readPersisted(UI_STORAGE_KEY, INITIAL_UI),
  );
  const [prefs, setPrefsRaw] = useState<LocalPreferences>(() => {
    const persisted = readPersisted(PREFS_STORAGE_KEY, INITIAL_PREFS);
    const base: LocalPreferences = {
      ...INITIAL_PREFS,
      ...persisted,
      featureFlags: {
        ...INITIAL_PREFS.featureFlags,
        ...(persisted.featureFlags ?? {}),
      },
      onboardingProfile: normalizeOnboardingProfile(persisted.onboardingProfile),
      conversationMemory: normalizeConversationMemory(persisted.conversationMemory),
      autoNewSessionOnIdle: Boolean(persisted.autoNewSessionOnIdle),
      autoNewSessionIdleHours: normalizeIdleHours(persisted.autoNewSessionIdleHours),
      defaultModel: persisted.defaultModel ?? readStoredDefaultModel(),
    };
    return base;
  });
  const ready = true;
  const migratedThinkingRef = useRef(false);

  useEffect(() => {
    writePersisted(UI_STORAGE_KEY, ui);
  }, [ui]);

  useEffect(() => {
    writePersisted(PREFS_STORAGE_KEY, prefs);
  }, [prefs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (migratedThinkingRef.current) return;
    migratedThinkingRef.current = true;

    const raw = window.localStorage.getItem(THINKING_PREF_KEY);
    if (raw == null) return;

    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "boolean") {
        setPrefsRaw((previous) => ({ ...previous, showThinking: parsed }));
      }
    } catch {
      // ignore invalid legacy values
    }

    try {
      window.localStorage.removeItem(THINKING_PREF_KEY);
    } catch {
      // ignore
    }
  }, []);

  const setUi = useCallback(
    (updater: (previous: LocalUIState) => LocalUIState) => {
      setUiRaw(updater);
    },
    [],
  );

  const setPrefs = useCallback(
    (updater: (previous: LocalPreferences) => LocalPreferences) => {
      setPrefsRaw(updater);
    },
    [],
  );

  const value = useMemo<LocalContextValue>(
    () => ({ ui, setUi, prefs, setPrefs, ready }),
    [prefs, ready, setPrefs, setUi, ui],
  );

  return <LocalContext.Provider value={value}>{children}</LocalContext.Provider>;
}

export function useLocal(): LocalContextValue {
  const context = use(LocalContext);
  if (!context) {
    throw new Error("Local context is missing");
  }
  return context;
}
