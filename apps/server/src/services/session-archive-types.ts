import type {
  SessionArchiveActivityReport,
  SessionArchiveAnalyticsActivityResponse,
  SessionArchiveAnalyticsHeatmapResponse,
  SessionArchiveAnalyticsHourOfWeekResponse,
  SessionArchiveAnalyticsProjectsResponse,
  SessionArchiveAnalyticsSessionShapeResponse,
  SessionArchiveAnalyticsSignalSessionsResponse,
  SessionArchiveAnalyticsSignalsResponse,
  SessionArchiveAnalyticsSummary,
  SessionArchiveAnalyticsBatchResponse,
  SessionArchiveAnalyticsSkillsResponse,
  SessionArchiveAnalyticsToolsResponse,
  SessionArchiveAnalyticsTopSessionsResponse,
  SessionArchiveAnalyticsVelocityResponse,
  SessionArchiveStats,
  SessionArchiveBackendsStatusResponse,
  SessionArchiveConfigSnapshot,
  SessionArchiveConfigUpdate,
  SessionArchiveContentSearchResponse,
  SessionArchiveGenerateInsightRequest,
  SessionArchiveInsight,
  SessionArchiveInsightsResponse,
  SessionArchiveImportStats,
  SessionArchiveDirectoryResponse,
  SessionArchiveExportResponse,
  SessionArchiveSessionActivityResponse,
  SessionArchiveMessage,
  SessionArchiveMessagesResponse,
  SessionArchiveOpenSessionResponse,
  SessionArchivePinRequest,
  SessionArchivePinResponse,
  SessionArchivePinnedMessage,
  SessionArchivePinsResponse,
  SessionArchivePublishResponse,
  SessionArchiveRenameSessionRequest,
  SessionArchiveResumeSessionRequest,
  SessionArchiveResumeSessionResponse,
  SessionArchiveSearchResponse,
  SessionArchiveSecretConfidence,
  SessionArchiveSecretFinding,
  SessionArchiveSecretFindingsResponse,
  SessionArchiveSecretScanSummary,
  SessionArchiveSession,
  SessionArchiveSessionPage,
  SessionArchiveSessionSearchResponse,
  SessionArchiveSessionTiming,
  SessionArchiveSessionUsage,
  SessionArchiveTopUsageSession,
  SessionArchiveToolCallListResponse,
  SessionArchiveTrendsTermsResponse,
  SessionArchiveUsageComparison,
  SessionArchiveUsageEvent,
  SessionArchiveUsageSummaryResponse,
  SessionArchiveUploadImportRequest,
  SessionArchiveWorktreeMapping,
  SessionArchiveWorktreeMappingInput,
} from "@onmyagent/types/session-archive";

export type SessionArchiveStore = {
  dbPath: string;
  close: () => void;
  upsertSession: (session: SessionArchiveSession) => void;
  replaceSessionMessages: (sessionId: string, messages: SessionArchiveMessage[]) => void;
  replaceSessionUsageEvents: (sessionId: string, events: SessionArchiveUsageEvent[]) => void;
  listUsageEvents: (sessionId: string) => SessionArchiveUsageEvent[];
  getSourceFile: (path: string) => SessionArchiveSourceFileState | null;
  upsertSourceFile: (state: SessionArchiveSourceFileState) => void;
  getSkippedFile: (path: string) => SessionArchiveSkippedFileState | null;
  upsertSkippedFile: (state: SessionArchiveSkippedFileState) => void;
  deleteSkippedFile: (path: string) => void;
  listSessions: (input?: SessionArchiveSessionListInput) => SessionArchiveSessionPage;
  getSession: (sessionId: string) => SessionArchiveSession | null;
  getSessionIncludingDeleted: (sessionId: string) => SessionArchiveSession | null;
  isSessionExcluded: (sessionId: string) => boolean;
  listMessages: (sessionId: string, input?: SessionArchiveMessagesInput) => SessionArchiveMessagesResponse;
  listToolCalls: (sessionId: string) => SessionArchiveToolCallListResponse;
  listChildren: (sessionId: string) => SessionArchiveSession[];
  getActivity: (sessionId: string) => SessionArchiveSessionActivityResponse | null;
  getTiming: (sessionId: string) => SessionArchiveSessionTiming | null;
  getUsage: (sessionId: string) => SessionArchiveSessionUsage | null;
  getUsageSummary: (input: SessionArchiveUsageFilterInput) => SessionArchiveUsageSummaryResponse;
  getUsageComparison: (input: SessionArchiveUsageComparisonInput) => SessionArchiveUsageComparison;
  getTopUsageSessions: (input: SessionArchiveUsageTopSessionsInput) => SessionArchiveTopUsageSession[];
  getAnalyticsSummary: () => SessionArchiveAnalyticsSummary;
  getAnalyticsActivity: () => SessionArchiveAnalyticsActivityResponse;
  getAnalyticsHeatmap: (metric?: string) => SessionArchiveAnalyticsHeatmapResponse;
  getAnalyticsProjects: () => SessionArchiveAnalyticsProjectsResponse;
  getAnalyticsHourOfWeek: () => SessionArchiveAnalyticsHourOfWeekResponse;
  getAnalyticsSessionShape: () => SessionArchiveAnalyticsSessionShapeResponse;
  getAnalyticsVelocity: () => SessionArchiveAnalyticsVelocityResponse;
  getAnalyticsTools: () => SessionArchiveAnalyticsToolsResponse;
  getAnalyticsSkills: () => SessionArchiveAnalyticsSkillsResponse;
  getAnalyticsTopSessions: (metric?: string, limit?: number) => SessionArchiveAnalyticsTopSessionsResponse;
  getAnalyticsSignals: () => SessionArchiveAnalyticsSignalsResponse;
  getAnalyticsSignalSessions: (signal: string, limit?: number) => SessionArchiveAnalyticsSignalSessionsResponse;
  getAnalyticsBatch: () => SessionArchiveAnalyticsBatchResponse;
  getActivityReport: (input: SessionArchiveActivityReportInput) => SessionArchiveActivityReport;
  getTrendsTerms: (input: SessionArchiveTrendsTermsInput) => SessionArchiveTrendsTermsResponse;
  listInsights: (input?: SessionArchiveInsightFilterInput) => SessionArchiveInsightsResponse;
  getInsight: (id: number) => SessionArchiveInsight | null;
  deleteInsight: (id: number) => boolean;
  generateInsight: (input: SessionArchiveGenerateInsightRequest) => SessionArchiveInsight;
  starSession: (sessionId: string) => boolean;
  unstarSession: (sessionId: string) => void;
  listStarredSessions: () => string[];
  bulkStarSessions: (sessionIds: string[]) => void;
  pinMessage: (sessionId: string, messageId: number, input?: SessionArchivePinRequest) => SessionArchivePinResponse | null;
  unpinMessage: (sessionId: string, messageId: number) => void;
  listPins: (project?: string) => SessionArchivePinsResponse;
  listSessionPins: (sessionId: string) => SessionArchivePinsResponse;
  renameSession: (sessionId: string, input: SessionArchiveRenameSessionRequest) => SessionArchiveSession | null;
  trashSession: (sessionId: string) => boolean;
  restoreSession: (sessionId: string) => boolean;
  permanentlyDeleteSession: (sessionId: string) => boolean;
  listTrash: () => SessionArchiveTrashList;
  emptyTrash: () => number;
  getSessionDirectory: (sessionId: string) => SessionArchiveDirectoryResponse | null;
  openSessionDirectory: (sessionId: string) => SessionArchiveOpenSessionResponse | null;
  resumeSession: (sessionId: string, input?: SessionArchiveResumeSessionRequest) => SessionArchiveResumeSessionResponse | null;
  exportSessionHtml: (sessionId: string) => SessionArchiveExportResponse | null;
  exportSessionMarkdown: (sessionId: string) => SessionArchiveExportResponse | null;
  publishSession: (sessionId: string) => SessionArchivePublishResponse | null;
  importUploadedExport: (input: SessionArchiveUploadImportRequest) => SessionArchiveImportStats;
  importClaudeAiExport: (input: SessionArchiveUploadImportRequest) => SessionArchiveImportStats;
  importChatGptExport: (input: SessionArchiveUploadImportRequest) => SessionArchiveImportStats;
  getConfigSnapshot: () => SessionArchiveConfigSnapshot;
  updateConfig: (input: SessionArchiveConfigUpdate) => SessionArchiveConfigSnapshot;
  getBackendsStatus: () => SessionArchiveBackendsStatusResponse;
  upsertWorktreeMapping: (input: SessionArchiveWorktreeMappingInput) => SessionArchiveWorktreeMapping;
  deleteWorktreeMapping: (id: string) => boolean;
  applyWorktreeMappings: () => { updated: number; mappings: SessionArchiveWorktreeMapping[] };
  scanSecrets: () => SessionArchiveSecretScanSummary;
  listSecretFindings: (input?: SessionArchiveSecretFindingsInput) => SessionArchiveSecretFindingsResponse;
  searchSession: (input: SessionArchiveSessionSearchInput) => SessionArchiveSessionSearchResponse;
  searchContent: (input: SessionArchiveContentSearchInput) => SessionArchiveContentSearchResponse;
  search: (input: SessionArchiveSearchInput) => SessionArchiveSearchResponse;
  stats: () => SessionArchiveStats;
};

export type SessionArchiveSourceFileState = {
  path: string;
  agent: string;
  session_id: string;
  size: number;
  mtime: number;
  hash: string;
  synced_at: string;
};

export type SessionArchiveSkippedFileState = {
  path: string;
  agent: string;
  size: number;
  mtime: number;
  hash: string;
  reason: string;
  skipped_at: string;
};

export type SessionArchiveSessionListInput = {
  start?: number;
  cursor?: string;
  limit?: number;
  search?: string;
  agent?: string;
  project?: string;
  excludeProject?: string;
  machine?: string;
  date?: string;
  from?: string;
  to?: string;
  activeSince?: string;
  minMessages?: number;
  maxMessages?: number;
  minUserMessages?: number;
  includeOneShot?: boolean;
  includeAutomated?: boolean;
  automated?: "all" | "human" | "automated";
  includeChildren?: boolean;
  includeOrphans?: boolean;
  outcome?: string[];
  healthGrade?: string[];
  minToolFailures?: number;
  hasSecret?: boolean;
  starred?: boolean;
  termination?: "all" | "clean" | "unclean" | "truncated" | "tool_call_pending";
};

export type SessionArchiveMessagesInput = {
  limit?: number;
  direction?: "asc" | "desc";
  from?: number;
};

export type SessionArchiveSearchInput = {
  query: string;
  cursor?: number;
  limit?: number;
  sort?: "relevance" | "recency";
} & Omit<SessionArchiveSessionListInput, "search" | "start" | "cursor" | "limit">;

export type SessionArchiveSessionSearchInput = {
  sessionId: string;
  query: string;
};

export type SessionArchiveSessionSearchMatch = {
  ordinal: number;
  source: "message" | "tool_result";
  match_start: number;
  match_end: number;
  snippet: string;
};

export type SessionArchiveContentSearchInput = {
  pattern: string;
  mode?: "substring" | "regex" | "fts";
  sources?: string[];
  excludeSystem?: boolean;
  cursor?: number;
  limit?: number;
  project?: string;
  agent?: string;
};

export type SessionArchiveUsageFilterInput = {
  from: string;
  to: string;
  agent?: string;
  project?: string;
  machine?: string;
  model?: string;
  excludeProject?: string;
  excludeAgent?: string;
  excludeModel?: string;
  minUserMessages?: number;
  includeOneShot?: boolean;
  includeAutomated?: boolean;
  activeSince?: string;
};

export type SessionArchiveUsageComparisonInput = SessionArchiveUsageFilterInput & {
  currentCost: number;
};

export type SessionArchiveUsageTopSessionsInput = SessionArchiveUsageFilterInput & {
  limit?: number;
};

export type SessionArchiveActivityReportInput = {
  preset?: "day" | "week" | "month" | "custom";
  date?: string;
  from?: string;
  to?: string;
  timezone?: string;
  bucket?: "5m" | "15m" | "1h" | "1d" | "1w";
  project?: string;
  agent?: string;
  machine?: string;
  automation?: "all" | "interactive" | "automated";
};

export type SessionArchiveTrendsTermsInput = SessionArchiveUsageFilterInput & {
  terms: string[];
  granularity?: "day" | "week" | "month";
};

export type SessionArchiveSecretFindingsInput = {
  from?: string;
  to?: string;
  project?: string;
  agent?: string;
  rule?: string;
  confidence?: SessionArchiveSecretConfidence;
  limit?: number;
  cursor?: number;
};

export type SessionArchiveInsightFilterInput = {
  type?: string;
  project?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type SessionArchiveTrashList = { sessions: SessionArchiveSession[] };

export type SessionArchiveListCursor = {
  activity: string;
  id: string;
  total: number;
};

