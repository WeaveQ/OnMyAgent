import { t } from "../../../../i18n";
import type {
  OpenworkSessionArchiveAnalyticsActivityResponse,
  OpenworkSessionArchiveAnalyticsHeatmapResponse,
  OpenworkSessionArchiveAnalyticsProjectsResponse,
  OpenworkSessionArchiveAnalyticsSessionShapeResponse,
  OpenworkSessionArchiveAnalyticsSignalsResponse,
  OpenworkSessionArchiveAnalyticsSkillsResponse,
  OpenworkSessionArchiveAnalyticsSummary,
  OpenworkSessionArchiveAnalyticsToolsResponse,
  OpenworkSessionArchiveAnalyticsTopSessionsResponse,
  OpenworkSessionArchiveAnalyticsVelocityResponse,
  OpenworkSessionArchiveActivityReport,
  OpenworkSessionArchiveImportStats,
  OpenworkSessionArchiveMessagesResponse,
  OpenworkSessionArchiveInsightsResponse,
  OpenworkSessionArchiveSearchResponse,
  OpenworkSessionArchiveSession,
  OpenworkSessionArchiveSessionPage,
  OpenworkSessionArchiveTrendsTermsResponse,
} from "../../../../app/lib/onmyagent-server";

export const SESSION_ARCHIVE_ARCHIVE_PAGE_LIMIT = 80;
export const SESSION_ARCHIVE_ARCHIVE_MESSAGE_LIMIT = 500;

export type SessionArchivePanel = "transcript" | "usage" | "analytics" | "settings";
export type SessionArchiveImportKind = "upload" | "claude-ai" | "chatgpt";

export type SessionArchiveCommandItem = {
  id: string;
  title: string;
  detail?: string;
  meta?: string;
  searchText?: string;
  action: () => void;
};

export type SessionArchiveCommandActions = {
  sync: () => void;
  toggleArchiveTrash: () => void;
  openSettings: () => void;
  copySessionId: (sessionId: string) => void;
  selectSession: (sessionId: string) => void;
};

export type SessionArchiveAnalyticsState = {
  summary: OpenworkSessionArchiveAnalyticsSummary;
  activity: OpenworkSessionArchiveAnalyticsActivityResponse;
  heatmap: OpenworkSessionArchiveAnalyticsHeatmapResponse;
  projects: OpenworkSessionArchiveAnalyticsProjectsResponse;
  sessions: OpenworkSessionArchiveAnalyticsSessionShapeResponse;
  velocity: OpenworkSessionArchiveAnalyticsVelocityResponse;
  tools: OpenworkSessionArchiveAnalyticsToolsResponse;
  skills: OpenworkSessionArchiveAnalyticsSkillsResponse;
  topSessions: OpenworkSessionArchiveAnalyticsTopSessionsResponse;
  signals: OpenworkSessionArchiveAnalyticsSignalsResponse;
  activityReport: OpenworkSessionArchiveActivityReport | null;
  trends: OpenworkSessionArchiveTrendsTermsResponse | null;
  insights: OpenworkSessionArchiveInsightsResponse | null;
};

export const EMPTY_SESSION_ARCHIVE_ANALYTICS_HEATMAP: OpenworkSessionArchiveAnalyticsHeatmapResponse = {
  metric: "messages",
  entries: [],
  levels: { l1: 0, l2: 0, l3: 0, l4: 0 },
  entries_from: "",
};

export const EMPTY_SESSION_ARCHIVE_ANALYTICS_SESSIONS: OpenworkSessionArchiveAnalyticsSessionShapeResponse = {
  count: 0,
  length_distribution: [],
  duration_distribution: [],
  autonomy_distribution: [],
};

export const EMPTY_SESSION_ARCHIVE_ANALYTICS_VELOCITY: OpenworkSessionArchiveAnalyticsVelocityResponse = {
  overall: {
    turn_cycle_sec: { p50: 0, p90: 0 },
    first_response_sec: { p50: 0, p90: 0 },
    msgs_per_active_min: 0,
    chars_per_active_min: 0,
    tool_calls_per_active_min: 0,
  },
  by_agent: [],
  by_complexity: [],
};

export const EMPTY_SESSION_ARCHIVE_ANALYTICS_TOOLS: OpenworkSessionArchiveAnalyticsToolsResponse = {
  total_calls: 0,
  by_category: [],
  by_agent: [],
  trend: [],
};

export const EMPTY_SESSION_ARCHIVE_ANALYTICS_SKILLS: OpenworkSessionArchiveAnalyticsSkillsResponse = {
  total_skill_calls: 0,
  distinct_skills: 0,
  by_skill: [],
  trend: [],
};

export const EMPTY_SESSION_ARCHIVE_ANALYTICS_SIGNALS: OpenworkSessionArchiveAnalyticsSignalsResponse = {
  scored_sessions: 0,
  unscored_sessions: 0,
  grade_distribution: {},
  avg_health_score: null,
  outcome_distribution: {},
  outcome_confidence_distribution: {},
  tool_health: {},
  context_health: {},
  quality_health: {},
  trend: [],
  by_agent: [],
  by_project: [],
  calibration: {},
};

export type SessionArchiveGroupMode = "none" | "agent" | "project";
export type SessionArchiveSessionTreeItem = {
  session: OpenworkSessionArchiveSession;
  depth: number;
  childCount: number;
  relationshipType: string | null;
};
export type SessionArchiveSessionGroup = { label: string; sessions: OpenworkSessionArchiveSession[]; treeItems: SessionArchiveSessionTreeItem[] };

export type SessionArchiveSessionPageState = {
  sessions: OpenworkSessionArchiveSession[];
  total: number;
  nextCursor: string | null;
  agentCounts: Array<{ agent: string; count: number }>;
};

export function mergeSessionArchiveSessionPage(
  current: SessionArchiveSessionPageState,
  page: OpenworkSessionArchiveSessionPage,
  mode: "replace" | "append",
): SessionArchiveSessionPageState {
  const sessions = mode === "replace"
    ? page.sessions
    : (() => {
      const seen = new Set(current.sessions.map((session) => session.id));
      return [...current.sessions, ...page.sessions.filter((session) => !seen.has(session.id))];
    })();
  return {
    sessions,
    total: page.total,
    nextCursor: page.next_cursor ?? null,
    agentCounts: page.agent_counts ?? current.agentCounts,
  };
}

export function normalizeLatestSessionArchiveMessages(
  page: OpenworkSessionArchiveMessagesResponse,
  pageLimit: number,
): { messages: OpenworkSessionArchiveMessagesResponse; hasOlder: boolean } {
  const orderedMessages = [...page.messages].reverse();
  return {
    messages: { ...page, messages: orderedMessages },
    hasOlder: page.messages.length === pageLimit && (orderedMessages[0]?.ordinal ?? 0) > 0,
  };
}

export function prependOlderSessionArchiveMessages(
  current: OpenworkSessionArchiveMessagesResponse,
  page: OpenworkSessionArchiveMessagesResponse,
  pageLimit: number,
): { messages: OpenworkSessionArchiveMessagesResponse; hasOlder: boolean } {
  const olderMessages = [...page.messages].reverse();
  const seen = new Set(current.messages.map((message) => message.ordinal));
  const prepended = olderMessages.filter((message) => !seen.has(message.ordinal));
  return {
    messages: { ...current, messages: [...prepended, ...current.messages], count: current.count + prepended.length },
    hasOlder: page.messages.length === pageLimit && (olderMessages[0]?.ordinal ?? 0) > 0,
  };
}

export function sessionArchiveTranscriptMessages(
  messages: OpenworkSessionArchiveMessagesResponse["messages"],
  newestFirst: boolean,
): OpenworkSessionArchiveMessagesResponse["messages"] {
  return newestFirst ? [...messages].reverse() : messages;
}

export function groupSessionArchiveSessions(sessions: OpenworkSessionArchiveSession[], mode: SessionArchiveGroupMode = "agent"): SessionArchiveSessionGroup[] {
  if (mode === "none") {
    return [{ label: "", sessions, treeItems: sessions.map((session) => ({ session, depth: 0, childCount: 0, relationshipType: session.relationship_type ?? null })) }];
  }
  const groups = new Map<string, OpenworkSessionArchiveSession[]>();
  for (const session of sessions) {
    const key = mode === "project" ? session.project || "unknown" : session.agent;
    const group = groups.get(key) ?? [];
    group.push(session);
    groups.set(key, group);
  }
  return Array.from(groups.entries())
    .map(([label, groupSessions]) => ({ label, sessions: groupSessions, treeItems: buildSessionArchiveTreeItems(groupSessions) }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function buildSessionArchiveTreeItems(sessions: OpenworkSessionArchiveSession[]): SessionArchiveSessionTreeItem[] {
  const byParent = new Map<string, OpenworkSessionArchiveSession[]>();
  const byId = new Map(sessions.map((session) => [session.id, session]));
  for (const session of sessions) {
    const parentId = session.parent_session_id?.trim();
    if (!parentId) continue;
    const children = byParent.get(parentId) ?? [];
    children.push(session);
    byParent.set(parentId, children);
  }
  const roots = sessions.filter((session) => {
    const parentId = session.parent_session_id?.trim();
    return !parentId || !byId.has(parentId);
  });
  const result: SessionArchiveSessionTreeItem[] = [];
  const visited = new Set<string>();
  const append = (session: OpenworkSessionArchiveSession, depth: number) => {
    if (visited.has(session.id)) return;
    visited.add(session.id);
    const children = byParent.get(session.id) ?? [];
    result.push({
      session,
      depth,
      childCount: children.length,
      relationshipType: session.relationship_type ?? null,
    });
    for (const child of children) append(child, depth + 1);
  };
  for (const root of roots) append(root, 0);
  for (const session of sessions) append(session, 0);
  return result;
}

export function sessionArchiveAgentCounts(
  agentCounts: Array<{ agent: string; count: number }>,
  groups: SessionArchiveSessionGroup[],
): Array<{ agent: string; count: number }> {
  if (agentCounts.length > 0) return agentCounts.map((item) => ({ agent: item.agent, count: item.count }));
  return groups.filter((group) => group.label).map((group) => ({ agent: group.label, count: group.sessions.length }));
}

export function nextSessionArchiveSessionId(
  sessions: OpenworkSessionArchiveSession[],
  selectedSessionId: string | null,
  delta: number,
): string | null {
  if (sessions.length === 0) return null;
  const currentIndex = selectedSessionId ? sessions.findIndex((session) => session.id === selectedSessionId) : -1;
  const fallbackIndex = delta >= 0 ? 0 : sessions.length - 1;
  if (currentIndex < 0) return sessions[fallbackIndex]?.id ?? null;
  return sessions[(currentIndex + delta + sessions.length) % sessions.length]?.id ?? null;
}

export function plainSessionArchiveSnippet(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

export function buildSessionArchiveCommandItems(input: {
  sessions: OpenworkSessionArchiveSession[];
  searchResults: OpenworkSessionArchiveSearchResponse["results"];
  selectedSession: OpenworkSessionArchiveSession | null;
  showTrash: boolean;
  trashCount: number;
  labels: {
    sync: string;
    archive: string;
    trash: string;
    trashMeta: string;
    settings: string;
    copySessionId: string;
  };
  actions: SessionArchiveCommandActions;
}): SessionArchiveCommandItem[] {
  const actionItems: SessionArchiveCommandItem[] = [
    { id: "sync", title: input.labels.sync, meta: "R", action: input.actions.sync },
    {
      id: input.showTrash ? "show-archive" : "show-trash",
      title: input.showTrash ? input.labels.archive : input.labels.trash,
      meta: input.showTrash ? input.labels.archive : input.labels.trashMeta,
      action: input.actions.toggleArchiveTrash,
    },
    { id: "settings", title: input.labels.settings, action: input.actions.openSettings },
  ];
  const selectedSession = input.selectedSession;
  const copyItem: SessionArchiveCommandItem[] = selectedSession ? [{
    id: `copy:${selectedSession.id}`,
    title: input.labels.copySessionId,
    detail: selectedSession.display_name || selectedSession.first_message || selectedSession.id,
    meta: selectedSession.agent,
    searchText: selectedSession.id,
    action: () => input.actions.copySessionId(selectedSession.id),
  }] : [];
  const searchItems: SessionArchiveCommandItem[] = input.searchResults.slice(0, 10).map((result) => ({
    id: `search:${result.session_id}:${result.ordinal}`,
    title: plainSessionArchiveSnippet(result.name || result.snippet || result.session_id),
    detail: result.project,
    meta: result.agent,
    searchText: `${result.session_id} ${result.project} ${result.agent} ${plainSessionArchiveSnippet(result.snippet ?? "")}`,
    action: () => input.actions.selectSession(result.session_id),
  }));
  const recentItems: SessionArchiveCommandItem[] = input.sessions.slice(0, 10).map((session) => ({
    id: `session:${session.id}`,
    title: session.display_name || session.first_message || session.id,
    detail: session.project,
    meta: session.agent,
    searchText: `${session.id} ${session.project} ${session.agent} ${session.first_message ?? ""}`,
    action: () => input.actions.selectSession(session.id),
  }));
  return [...actionItems, ...copyItem, ...searchItems, ...recentItems];
}

export function sessionArchiveImportStatsMessage(stats: OpenworkSessionArchiveImportStats): string {
  return t("session_archive.import_stats", {
    imported: stats.imported,
    updated: stats.updated,
    skipped: stats.skipped,
    errors: stats.errors,
  });
}

export function splitSessionArchiveLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function formatSessionArchiveNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatSessionArchiveCost(value: number): string {
  if (value > 0 && value < 0.01) return `$${value.toFixed(5)}`;
  return `$${value.toFixed(2)}`;
}

export function formatSessionArchiveBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function formatSessionArchiveDuration(value: number): string {
  const seconds = Math.floor(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatSessionArchivePercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
