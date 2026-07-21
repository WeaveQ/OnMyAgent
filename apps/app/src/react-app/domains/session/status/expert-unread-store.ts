/** @jsxImportSource react */
/**
 * Local unread cursors for expert (agent) conversation list + session tabs.
 * WeChat-style red dots; no server sync.
 *
 * Count rules (one assistant turn = at most +1):
 * - Stream tokens within the same session run never bump the count.
 * - A new run (new runKey) or a different session under the same expert can +1.
 *
 * Manual “标为未读”:
 * - Sets agent-level badge (visible even while that expert is open).
 * - Optionally marks a session tab with its own red dot.
 * - Cleared by markRead / opening another expert (focus change) / markSessionRead.
 */
import { create } from "zustand";

import {
  readCustomAgentIdForSession,
  readSessionAgentSnapshot,
} from "../../agents";
import { useSessionActivityStore } from "./session-activity-store";

const STORAGE_KEY = "onmyagent.expert-unread.v2";
/** Migrate from Phase 1–2 agent-only payload. */
const LEGACY_STORAGE_KEY = "onmyagent.expert-unread.v1";

export type ExpertUnreadRecord = {
  lastReadAt: number;
  lastAssistantAt: number;
  unreadCount: number;
  /** Last session that contributed to unreadCount (prevents stream double-count). */
  lastNotedSessionId: string | null;
  /** Session run identity last counted (see session-activity-store). */
  lastNotedRunKey: string | null;
  /**
   * User chose “标为未读” — keep expert badge visible even while focused,
   * and do not auto-clear on in-focus stream activity.
   */
  manualUnread: boolean;
};

type FocusedAgent = {
  workspaceId: string;
  agentId: string;
};

type NoteOptions = {
  at?: number;
  sessionId?: string;
  runKey?: string | null;
};

type MarkUnreadOptions = {
  at?: number;
  /** When set, also show a red dot on this session chip. */
  sessionId?: string;
};

type ExpertUnreadStore = {
  byWorkspace: Record<string, Record<string, ExpertUnreadRecord>>;
  /** workspaceId → sessionId → agentId (session chip red dots). */
  sessionUnreadByWorkspace: Record<string, Record<string, string>>;
  focused: FocusedAgent | null;
  noteAssistantActivity: (
    workspaceId: string,
    agentId: string,
    options?: NoteOptions,
  ) => void;
  noteAssistantActivityForSession: (
    workspaceId: string,
    sessionId: string,
    at?: number,
  ) => void;
  markRead: (workspaceId: string, agentId: string, at?: number) => void;
  markUnread: (
    workspaceId: string,
    agentId: string,
    options?: MarkUnreadOptions,
  ) => void;
  /** Clear red dot on one session tab (e.g. when user opens it). */
  markSessionRead: (workspaceId: string, sessionId: string) => void;
  setFocusedAgent: (
    workspaceId: string | null,
    agentId: string | null,
  ) => void;
  isUnread: (workspaceId: string, agentId: string) => boolean;
  hasUnreadRecord: (workspaceId: string, agentId: string) => boolean;
  isSessionUnread: (workspaceId: string, sessionId: string) => boolean;
  getUnreadCount: (workspaceId: string, agentId: string) => number;
  hydrate: () => void;
};

function emptyRecord(at = 0): ExpertUnreadRecord {
  return {
    lastReadAt: at,
    lastAssistantAt: 0,
    unreadCount: 0,
    lastNotedSessionId: null,
    lastNotedRunKey: null,
    manualUnread: false,
  };
}

function normalizeId(value: string): string {
  return value.trim();
}

function parseAgentRecord(record: unknown): ExpertUnreadRecord | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const lastReadAt =
    "lastReadAt" in record && typeof record.lastReadAt === "number"
      ? record.lastReadAt
      : 0;
  const lastAssistantAt =
    "lastAssistantAt" in record && typeof record.lastAssistantAt === "number"
      ? record.lastAssistantAt
      : 0;
  const unreadCount =
    "unreadCount" in record && typeof record.unreadCount === "number"
      ? Math.max(0, Math.floor(record.unreadCount))
      : 0;
  const lastNotedSessionId =
    "lastNotedSessionId" in record &&
    typeof record.lastNotedSessionId === "string"
      ? record.lastNotedSessionId
      : null;
  const lastNotedRunKey =
    "lastNotedRunKey" in record &&
    (typeof record.lastNotedRunKey === "string" ||
      record.lastNotedRunKey === null)
      ? (record.lastNotedRunKey as string | null)
      : null;
  const manualUnread =
    "manualUnread" in record && record.manualUnread === true;
  return {
    lastReadAt,
    lastAssistantAt,
    unreadCount,
    lastNotedSessionId,
    lastNotedRunKey,
    manualUnread,
  };
}

function loadAgentsMap(
  raw: unknown,
): Record<string, Record<string, ExpertUnreadRecord>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, Record<string, ExpertUnreadRecord>> = {};
  for (const [workspaceId, agents] of Object.entries(raw)) {
    if (!agents || typeof agents !== "object" || Array.isArray(agents)) continue;
    const map: Record<string, ExpertUnreadRecord> = {};
    for (const [agentId, record] of Object.entries(agents)) {
      const parsed = parseAgentRecord(record);
      if (parsed) map[agentId] = parsed;
    }
    out[workspaceId] = map;
  }
  return out;
}

function loadSessionMap(
  raw: unknown,
): Record<string, Record<string, string>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, Record<string, string>> = {};
  for (const [workspaceId, sessions] of Object.entries(raw)) {
    if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) {
      continue;
    }
    const map: Record<string, string> = {};
    for (const [sessionId, agentId] of Object.entries(sessions)) {
      if (typeof agentId === "string" && agentId.trim()) {
        map[sessionId] = agentId.trim();
      }
    }
    out[workspaceId] = map;
  }
  return out;
}

function loadFromStorage(): {
  byWorkspace: Record<string, Record<string, ExpertUnreadRecord>>;
  sessionUnreadByWorkspace: Record<string, Record<string, string>>;
} {
  if (typeof localStorage === "undefined") {
    return { byWorkspace: {}, sessionUnreadByWorkspace: {} };
  }
  try {
    const v2raw = localStorage.getItem(STORAGE_KEY);
    if (v2raw) {
      const parsed: unknown = JSON.parse(v2raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        if (obj.v === 2) {
          return {
            byWorkspace: loadAgentsMap(obj.agents),
            sessionUnreadByWorkspace: loadSessionMap(obj.sessions),
          };
        }
      }
    }
    // Legacy v1: whole payload is agents map.
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      return {
        byWorkspace: loadAgentsMap(JSON.parse(legacy)),
        sessionUnreadByWorkspace: {},
      };
    }
  } catch {
    // ignore
  }
  return { byWorkspace: {}, sessionUnreadByWorkspace: {} };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(
  byWorkspace: Record<string, Record<string, ExpertUnreadRecord>>,
  sessionUnreadByWorkspace: Record<string, Record<string, string>>,
) {
  if (typeof localStorage === "undefined") return;
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          v: 2,
          agents: byWorkspace,
          sessions: sessionUnreadByWorkspace,
        }),
      );
    } catch {
      // Quota / private mode
    }
  }, 300);
}

export function resolveAgentIdForSession(sessionId: string): string | null {
  const id = normalizeId(sessionId);
  if (!id || id.startsWith("draft:")) return null;
  const custom = readCustomAgentIdForSession(id);
  if (custom?.trim()) return custom.trim();
  const snapshot = readSessionAgentSnapshot(id);
  if (snapshot?.id?.trim()) return snapshot.id.trim();
  return null;
}

function isUnreadRecord(record: ExpertUnreadRecord | undefined): boolean {
  if (!record) return false;
  return record.lastAssistantAt > record.lastReadAt && record.unreadCount > 0;
}

/**
 * Decide whether this activity should +1 unreadCount.
 * Same session + same run → no; new cycle / new session / new run → yes.
 */
function shouldIncrementCount(
  prev: ExpertUnreadRecord,
  sessionId: string | undefined,
  runKey: string | null | undefined,
): boolean {
  const isNewCycle =
    prev.lastAssistantAt <= prev.lastReadAt || prev.unreadCount === 0;
  if (isNewCycle) return true;

  const session = sessionId?.trim() || null;
  const run = runKey ?? null;

  if (
    session &&
    prev.lastNotedSessionId === session &&
    (run === null ||
      prev.lastNotedRunKey === null ||
      prev.lastNotedRunKey === run)
  ) {
    return false;
  }

  if (session && prev.lastNotedSessionId === session && run === null) {
    return false;
  }

  if (
    session &&
    prev.lastNotedSessionId &&
    prev.lastNotedSessionId !== session
  ) {
    return true;
  }
  if (run && prev.lastNotedRunKey && prev.lastNotedRunKey !== run) {
    return true;
  }

  return false;
}

function clearSessionsForAgent(
  sessionMap: Record<string, Record<string, string>>,
  workspace: string,
  agent: string,
): Record<string, Record<string, string>> {
  const workspaceSessions = sessionMap[workspace];
  if (!workspaceSessions) return sessionMap;
  const nextWorkspace: Record<string, string> = {};
  for (const [sessionId, agentId] of Object.entries(workspaceSessions)) {
    if (agentId !== agent) nextWorkspace[sessionId] = agentId;
  }
  return {
    ...sessionMap,
    [workspace]: nextWorkspace,
  };
}

export const useExpertUnreadStore = create<ExpertUnreadStore>((set, get) => ({
  byWorkspace: {},
  sessionUnreadByWorkspace: {},
  focused: null,

  hydrate: () => {
    const loaded = loadFromStorage();
    set({
      byWorkspace: loaded.byWorkspace,
      sessionUnreadByWorkspace: loaded.sessionUnreadByWorkspace,
    });
  },

  noteAssistantActivity: (workspaceId, agentId, options = {}) => {
    const workspace = normalizeId(workspaceId);
    const agent = normalizeId(agentId);
    if (!workspace || !agent) return;
    const at = options.at ?? Date.now();
    const sessionId = options.sessionId?.trim() || undefined;
    const runKey =
      options.runKey !== undefined
        ? options.runKey
        : sessionId
          ? useSessionActivityStore
              .getState()
              .getRunIdentity(workspace, sessionId)?.runKey ?? null
          : null;

    const focused = get().focused;
    if (
      focused &&
      focused.workspaceId === workspace &&
      focused.agentId === agent
    ) {
      const current = get().byWorkspace[workspace]?.[agent];
      // Keep intentional “标为未读” while user is still in this expert.
      if (current?.manualUnread) return;
      get().markRead(workspace, agent, at);
      return;
    }

    set((state) => {
      const workspaceMap = { ...(state.byWorkspace[workspace] ?? {}) };
      const prev = workspaceMap[agent] ?? emptyRecord();
      const bump = shouldIncrementCount(prev, sessionId, runKey);
      const isNewCycle =
        prev.lastAssistantAt <= prev.lastReadAt || prev.unreadCount === 0;
      const next: ExpertUnreadRecord = {
        lastReadAt: prev.lastReadAt,
        lastAssistantAt: Math.max(prev.lastAssistantAt, at),
        unreadCount: bump
          ? isNewCycle
            ? 1
            : Math.min(99, prev.unreadCount + 1)
          : Math.max(1, prev.unreadCount),
        lastNotedSessionId: sessionId ?? prev.lastNotedSessionId,
        lastNotedRunKey: runKey ?? prev.lastNotedRunKey,
        manualUnread: prev.manualUnread,
      };

      workspaceMap[agent] = next;
      const byWorkspace = { ...state.byWorkspace, [workspace]: workspaceMap };
      // Auto activity also marks the contributing session chip when not focused.
      let sessionUnreadByWorkspace = state.sessionUnreadByWorkspace;
      if (sessionId && bump) {
        const sessions = {
          ...(sessionUnreadByWorkspace[workspace] ?? {}),
          [sessionId]: agent,
        };
        sessionUnreadByWorkspace = {
          ...sessionUnreadByWorkspace,
          [workspace]: sessions,
        };
      }
      schedulePersist(byWorkspace, sessionUnreadByWorkspace);
      return { byWorkspace, sessionUnreadByWorkspace };
    });
  },

  noteAssistantActivityForSession: (workspaceId, sessionId, at = Date.now()) => {
    const agentId = resolveAgentIdForSession(sessionId);
    if (!agentId) return;
    const runKey =
      useSessionActivityStore.getState().getRunIdentity(workspaceId, sessionId)
        ?.runKey ?? null;
    get().noteAssistantActivity(workspaceId, agentId, {
      at,
      sessionId,
      runKey,
    });
  },

  markRead: (workspaceId, agentId, at = Date.now()) => {
    const workspace = normalizeId(workspaceId);
    const agent = normalizeId(agentId);
    if (!workspace || !agent) return;

    set((state) => {
      const workspaceMap = { ...(state.byWorkspace[workspace] ?? {}) };
      const prev = workspaceMap[agent] ?? emptyRecord();
      const next: ExpertUnreadRecord = {
        lastReadAt: Math.max(prev.lastReadAt, at),
        lastAssistantAt: prev.lastAssistantAt,
        unreadCount: 0,
        lastNotedSessionId: null,
        lastNotedRunKey: null,
        manualUnread: false,
      };
      if (next.lastAssistantAt > next.lastReadAt) {
        next.lastAssistantAt = next.lastReadAt;
      }
      workspaceMap[agent] = next;
      const byWorkspace = { ...state.byWorkspace, [workspace]: workspaceMap };
      const sessionUnreadByWorkspace = clearSessionsForAgent(
        state.sessionUnreadByWorkspace,
        workspace,
        agent,
      );
      schedulePersist(byWorkspace, sessionUnreadByWorkspace);
      return { byWorkspace, sessionUnreadByWorkspace };
    });
  },

  markUnread: (workspaceId, agentId, options = {}) => {
    const workspace = normalizeId(workspaceId);
    const agent = normalizeId(agentId);
    if (!workspace || !agent) return;
    const at = options.at ?? Date.now();
    const sessionId = options.sessionId?.trim() || undefined;

    set((state) => {
      const workspaceMap = { ...(state.byWorkspace[workspace] ?? {}) };
      const prev = workspaceMap[agent] ?? emptyRecord();
      const next: ExpertUnreadRecord = {
        lastReadAt: prev.lastReadAt,
        lastAssistantAt: Math.max(prev.lastAssistantAt, at, prev.lastReadAt + 1),
        unreadCount: Math.max(1, prev.unreadCount || 1),
        lastNotedSessionId: sessionId ?? prev.lastNotedSessionId,
        lastNotedRunKey: prev.lastNotedRunKey,
        manualUnread: true,
      };
      workspaceMap[agent] = next;
      const byWorkspace = { ...state.byWorkspace, [workspace]: workspaceMap };
      let sessionUnreadByWorkspace = state.sessionUnreadByWorkspace;
      if (sessionId) {
        sessionUnreadByWorkspace = {
          ...sessionUnreadByWorkspace,
          [workspace]: {
            ...(sessionUnreadByWorkspace[workspace] ?? {}),
            [sessionId]: agent,
          },
        };
      }
      schedulePersist(byWorkspace, sessionUnreadByWorkspace);
      return { byWorkspace, sessionUnreadByWorkspace };
    });
  },

  markSessionRead: (workspaceId, sessionId) => {
    const workspace = normalizeId(workspaceId);
    const session = normalizeId(sessionId);
    if (!workspace || !session) return;
    set((state) => {
      const workspaceSessions = state.sessionUnreadByWorkspace[workspace];
      if (!workspaceSessions?.[session]) return state;
      const nextWorkspace = { ...workspaceSessions };
      delete nextWorkspace[session];
      const sessionUnreadByWorkspace = {
        ...state.sessionUnreadByWorkspace,
        [workspace]: nextWorkspace,
      };
      schedulePersist(state.byWorkspace, sessionUnreadByWorkspace);
      return { sessionUnreadByWorkspace };
    });
  },

  setFocusedAgent: (workspaceId, agentId) => {
    const workspace = workspaceId?.trim() || null;
    const agent = agentId?.trim() || null;
    if (!workspace || !agent) {
      set({ focused: null });
      return;
    }
    const prev = get().focused;
    const sameFocus =
      prev?.workspaceId === workspace && prev?.agentId === agent;
    set({ focused: { workspaceId: workspace, agentId: agent } });
    // Auto-read only when switching *to* an expert — not while staying on it
    // (preserves manual 标为未读 red dots until user leaves and re-enters).
    if (!sameFocus) {
      get().markRead(workspace, agent);
    }
  },

  isUnread: (workspaceId, agentId) => {
    const workspace = normalizeId(workspaceId);
    const agent = normalizeId(agentId);
    if (!workspace || !agent) return false;
    const record = get().byWorkspace[workspace]?.[agent];
    if (!isUnreadRecord(record)) return false;
    // Manual mark: show badge even while this expert is open.
    if (record?.manualUnread) return true;
    const focused = get().focused;
    if (
      focused &&
      focused.workspaceId === workspace &&
      focused.agentId === agent
    ) {
      return false;
    }
    return true;
  },

  hasUnreadRecord: (workspaceId, agentId) => {
    const workspace = normalizeId(workspaceId);
    const agent = normalizeId(agentId);
    if (!workspace || !agent) return false;
    return isUnreadRecord(get().byWorkspace[workspace]?.[agent]);
  },

  isSessionUnread: (workspaceId, sessionId) => {
    const workspace = normalizeId(workspaceId);
    const session = normalizeId(sessionId);
    if (!workspace || !session) return false;
    return Boolean(get().sessionUnreadByWorkspace[workspace]?.[session]);
  },

  getUnreadCount: (workspaceId, agentId) => {
    if (!get().isUnread(workspaceId, agentId)) return 0;
    return (
      get().byWorkspace[normalizeId(workspaceId)]?.[normalizeId(agentId)]
        ?.unreadCount ?? 0
    );
  },
}));

// Hydrate once on module load (browser only).
if (typeof localStorage !== "undefined") {
  useExpertUnreadStore.getState().hydrate();
}
