/**
 * End-to-end OnMyAgent server HTTP client method contracts.
 *
 * Maps each `ServerClientMethodName` (from `server-client-methods.mjs`) to its
 * call `args` tuple and `result`. Methods with shared payload types in
 * `server.ts` / `session-archive.ts` are typed explicitly; remaining methods
 * default to `unknown[]` / `unknown` so the key set stays complete and can be
 * tightened over time.
 */
import { serverClientMethodNames } from "./server-client-methods.mjs";
import type {
  ArtifactPluginCatalogItem,
  ArtifactPluginSkillItem,
  AuditEntry,
  AutomationRunHistoryResult,
  AutomationTaskInput,
  AutomationTaskItem,
  CommandItem,
  HubSkillItem,
  InboxListResponse,
  InboxUploadResponse,
  ArtifactListResponse,
  ResolvedArtifactTarget,
  McpItem,
  OpencodeConfigFile,
  PluginItem,
  ReloadEvent,
  RuntimeVersionsResponse,
  ServerClientCapabilities,
  ServerHealthResponse,
  ServerStatusResponse,
  SkillContentResponse,
  SkillItem,
  WorkspaceExportResponse,
  WorkspaceFileCatalogResponse,
  WorkspaceFileContentResponse,
  WorkspaceFileStatResponse,
  WorkspaceFileWriteResponse,
  WorkspaceImportPreviewResponse,
  WorkspaceInfo,
} from "./server";
import type { ArtifactPluginConnectionState } from "./artifact-plugin";
import type {
  SessionArchiveActivityReport,
  SessionArchiveAnalyticsActivityResponse,
  SessionArchiveAnalyticsBatchResponse,
  SessionArchiveAnalyticsHeatmapResponse,
  SessionArchiveAnalyticsHourOfWeekResponse,
  SessionArchiveAnalyticsProjectsResponse,
  SessionArchiveAnalyticsSessionShapeResponse,
  SessionArchiveAnalyticsSignalSessionsResponse,
  SessionArchiveAnalyticsSignalsResponse,
  SessionArchiveAnalyticsSkillsResponse,
  SessionArchiveAnalyticsSummary,
  SessionArchiveAnalyticsToolsResponse,
  SessionArchiveAnalyticsTopSessionsResponse,
  SessionArchiveAnalyticsVelocityResponse,
  SessionArchiveApplyWorktreeMappingsResponse,
  SessionArchiveBackendsStatusResponse,
  SessionArchiveConfigSnapshot,
  SessionArchiveConfigUpdate,
  SessionArchiveExportResponse,
  SessionArchiveGenerateInsightRequest,
  SessionArchiveImportStats,
  SessionArchiveInsightsResponse,
  SessionArchiveLifecycleStatus,
  SessionArchiveMessagesResponse,
  SessionArchiveOpenSessionResponse,
  SessionArchivePinsResponse,
  SessionArchivePublishResponse,
  SessionArchiveResumeSessionResponse,
  SessionArchiveSearchResponse,
  SessionArchiveSecretFindingsResponse,
  SessionArchiveSecretScanSummary,
  SessionArchiveSession,
  SessionArchiveSessionPage,
  SessionArchiveSessionSearchResponse,
  SessionArchiveSessionUsage,
  SessionArchiveStarredResponse,
  SessionArchiveSyncResult,
  SessionArchiveSyncStatus,
  SessionArchiveTopUsageSession,
  SessionArchiveTrendsTermsResponse,
  SessionArchiveUploadImportRequest,
  SessionArchiveUsageComparison,
  SessionArchiveUsageSummaryResponse,
  SessionArchiveWorktreeMapping,
  SessionArchiveWorktreeMappingInput,
  SessionArchiveWorktreeMappingsResponse,
} from "./session-archive";

/** Literal union of every registered HTTP client method name. */
export type ServerClientMethodName = (typeof serverClientMethodNames)[number];

export type ServerClientMethodContract<
  Args extends readonly unknown[] = readonly unknown[],
  Result = unknown,
> = {
  args: Args;
  result: Result;
};

type WorkspaceListPayload = {
  items: WorkspaceInfo[];
  activeId?: string | null;
  selectedId?: string | null;
  workspaces?: WorkspaceInfo[];
};

type BinaryDownloadResult = {
  data: ArrayBuffer;
  contentType: string | null;
  filename: string | null;
};

type OkResult = { ok: boolean };

/** Explicit contracts for methods with known shared payload types. */
type TypedServerClientMethodMap = {
  // system (sync fields + health/status/config)
  baseUrl: ServerClientMethodContract<[], string>;
  token: ServerClientMethodContract<[], string | undefined>;
  health: ServerClientMethodContract<[], ServerHealthResponse>;
  runtimeVersions: ServerClientMethodContract<[], RuntimeVersionsResponse>;
  status: ServerClientMethodContract<[], ServerStatusResponse>;
  capabilities: ServerClientMethodContract<[], ServerClientCapabilities>;
  getConfig: ServerClientMethodContract<
    [workspaceId: string],
    {
      opencode: Record<string, unknown>;
      onmyagent: Record<string, unknown>;
      updatedAt?: number | null;
    }
  >;
  patchConfig: ServerClientMethodContract<
    [
      workspaceId: string,
      payload: {
        opencode?: Record<string, unknown>;
        onmyagent?: Record<string, unknown>;
      },
    ],
    { updatedAt?: number | null }
  >;
  listReloadEvents: ServerClientMethodContract<
    [workspaceId: string, options?: { since?: number }],
    { items: ReloadEvent[]; cursor?: number }
  >;
  reloadEngine: ServerClientMethodContract<
    [workspaceId: string],
    { ok: boolean; reloadedAt?: number }
  >;
  listAudit: ServerClientMethodContract<
    [workspaceId: string, limit?: number],
    { items: AuditEntry[] }
  >;
  createVoiceRealtimeSession: ServerClientMethodContract<
    [payload?: { model?: string }],
    {
      ok: true;
      clientSecret: string;
      expiresAt: number | null;
      model: string;
      transcriptionModel: string;
      tools: string[];
    }
  >;

  // environment
  listUserEnvKeys: ServerClientMethodContract<[], { keys: string[] }>;
  listUserEnv: ServerClientMethodContract<
    [],
    { items: Array<{ key: string; value: string; updatedAt: number }> }
  >;
  upsertUserEnv: ServerClientMethodContract<
    [entries: Array<{ key: string; value: string }>],
    { ok: true; count: number }
  >;
  deleteUserEnv: ServerClientMethodContract<[key: string], { ok: true }>;

  // workspace
  listWorkspaces: ServerClientMethodContract<[], WorkspaceListPayload>;
  createLocalWorkspace: ServerClientMethodContract<
    [payload: { folderPath: string; name: string; preset: string }],
    WorkspaceListPayload
  >;
  updateWorkspaceDisplayName: ServerClientMethodContract<
    [workspaceId: string, displayName: string | null],
    WorkspaceListPayload
  >;
  activateWorkspace: ServerClientMethodContract<
    [workspaceId: string],
    { activeId: string; workspace: WorkspaceInfo }
  >;
  deleteWorkspace: ServerClientMethodContract<
    [workspaceId: string],
    {
      ok: boolean;
      deleted: boolean;
      persisted: boolean;
      activeId: string | null;
      items: WorkspaceInfo[];
      workspaces?: WorkspaceInfo[];
    }
  >;
  exportWorkspace: ServerClientMethodContract<
    [
      workspaceId: string,
      options?: { sensitiveMode?: "include" | "redact" | "omit" },
    ],
    WorkspaceExportResponse
  >;
  importWorkspace: ServerClientMethodContract<
    [workspaceId: string, payload: Record<string, unknown>],
    { ok: boolean; preview?: WorkspaceImportPreviewResponse }
  >;
  previewWorkspaceImport: ServerClientMethodContract<
    [workspaceId: string, payload: Record<string, unknown>],
    WorkspaceImportPreviewResponse
  >;
  materializeBlueprintSessions: ServerClientMethodContract<
    [workspaceId: string],
    { ok: boolean; created?: number; skipped?: number }
  >;
  readOpencodeConfigFile: ServerClientMethodContract<
    [workspaceId: string, scope?: "project" | "global"],
    OpencodeConfigFile
  >;
  writeOpencodeConfigFile: ServerClientMethodContract<
    [workspaceId: string, scope: "project" | "global", content: string],
    { ok: boolean; error?: string }
  >;
  readWorkspaceFile: ServerClientMethodContract<
    [workspaceId: string, path: string],
    WorkspaceFileContentResponse
  >;
  statWorkspaceFile: ServerClientMethodContract<
    [workspaceId: string, path: string],
    WorkspaceFileStatResponse
  >;
  writeWorkspaceFile: ServerClientMethodContract<
    [
      workspaceId: string,
      payload: {
        path: string;
        content: string;
        baseUpdatedAt?: number | null;
        force?: boolean;
      },
    ],
    WorkspaceFileWriteResponse
  >;
  writeWorkspaceBinaryFile: ServerClientMethodContract<
    [
      workspaceId: string,
      payload: {
        path: string;
        data: ArrayBuffer;
        baseUpdatedAt?: number | null;
        force?: boolean;
      },
    ],
    WorkspaceFileWriteResponse
  >;
  downloadWorkspaceFile: ServerClientMethodContract<
    [workspaceId: string, path: string],
    BinaryDownloadResult
  >;
  listWorkspaceFiles: ServerClientMethodContract<
    [
      workspaceId: string,
      options?: {
        includeDirs?: boolean;
        limit?: number;
        prefix?: string;
        root?: string;
      },
    ],
    WorkspaceFileCatalogResponse
  >;

  // sessions (OpenCode Session payload stays loosely typed at the packages boundary)
  deleteSession: ServerClientMethodContract<
    [workspaceId: string, sessionId: string, options?: { directory?: string }],
    OkResult
  >;
  listSessions: ServerClientMethodContract<
    [
      workspaceId: string,
      options?: {
        roots?: boolean;
        start?: number;
        search?: string;
        limit?: number;
        directory?: string;
      },
    ],
    { items: unknown[] }
  >;
  getSession: ServerClientMethodContract<
    [workspaceId: string, sessionId: string, options?: { directory?: string }],
    { item: unknown }
  >;
  getSessionMessages: ServerClientMethodContract<
    [
      workspaceId: string,
      sessionId: string,
      options?: { limit?: number; directory?: string },
    ],
    { items: unknown[] }
  >;
  getSessionSnapshot: ServerClientMethodContract<
    [
      workspaceId: string,
      sessionId: string,
      options?: { limit?: number; directory?: string },
    ],
    { item: unknown }
  >;

  // extensions — plugins / skills / MCP / commands / automations
  listPlugins: ServerClientMethodContract<
    [workspaceId: string, options?: { includeGlobal?: boolean }],
    { items: PluginItem[]; loadOrder: string[] }
  >;
  addPlugin: ServerClientMethodContract<
    [workspaceId: string, spec: string],
    { items: PluginItem[]; loadOrder: string[] }
  >;
  removePlugin: ServerClientMethodContract<
    [workspaceId: string, name: string],
    { items: PluginItem[]; loadOrder: string[] }
  >;
  listSkills: ServerClientMethodContract<
    [workspaceId: string, options?: { includeGlobal?: boolean }],
    { items: SkillItem[] }
  >;
  listHubSkills: ServerClientMethodContract<
    [options?: { repo?: { owner?: string; repo?: string; ref?: string } }],
    { items: HubSkillItem[] }
  >;
  installHubSkill: ServerClientMethodContract<
    [
      workspaceId: string,
      name: string,
      options?: {
        overwrite?: boolean;
        repo?: { owner?: string; repo?: string; ref?: string };
      },
    ],
    {
      ok: boolean;
      name: string;
      path: string;
      action: "added" | "updated";
      written: number;
      skipped: number;
    }
  >;
  getSkill: ServerClientMethodContract<
    [workspaceId: string, name: string, options?: { includeGlobal?: boolean }],
    SkillContentResponse
  >;
  upsertSkill: ServerClientMethodContract<
    [
      workspaceId: string,
      payload: { name: string; content: string; description?: string },
    ],
    SkillItem
  >;
  deleteSkill: ServerClientMethodContract<
    [workspaceId: string, name: string],
    { path: string }
  >;
  listMcp: ServerClientMethodContract<
    [workspaceId: string],
    { items: McpItem[] }
  >;
  addMcp: ServerClientMethodContract<
    [workspaceId: string, payload: { name: string; config: Record<string, unknown> }],
    { items: McpItem[] }
  >;
  removeMcp: ServerClientMethodContract<
    [workspaceId: string, name: string],
    { items: McpItem[] }
  >;
  setMcpEnabled: ServerClientMethodContract<
    [workspaceId: string, name: string, enabled: boolean],
    { items: McpItem[] }
  >;
  logoutMcpAuth: ServerClientMethodContract<
    [workspaceId: string, name: string],
    { ok: true }
  >;
  listCommands: ServerClientMethodContract<
    [workspaceId: string, scope?: "workspace" | "global"],
    { items: CommandItem[] }
  >;
  upsertCommand: ServerClientMethodContract<
    [
      workspaceId: string,
      payload: {
        name: string;
        description?: string;
        template: string;
        agent?: string;
        model?: string | null;
        subtask?: boolean;
      },
    ],
    { items: CommandItem[] }
  >;
  deleteCommand: ServerClientMethodContract<
    [workspaceId: string, name: string],
    OkResult
  >;
  listAutomations: ServerClientMethodContract<
    [workspaceId: string],
    { items: AutomationTaskItem[] }
  >;
  listAutomationRuns: ServerClientMethodContract<
    [workspaceId: string, automationId: string],
    AutomationRunHistoryResult
  >;
  createAutomation: ServerClientMethodContract<
    [workspaceId: string, payload: AutomationTaskInput],
    { item: AutomationTaskItem; items: AutomationTaskItem[] }
  >;
  updateAutomation: ServerClientMethodContract<
    [workspaceId: string, automationId: string, payload: Partial<AutomationTaskInput>],
    { item: AutomationTaskItem; items: AutomationTaskItem[] }
  >;
  runAutomation: ServerClientMethodContract<
    [workspaceId: string, automationId: string],
    { item: AutomationTaskItem; items: AutomationTaskItem[] }
  >;
  deleteAutomation: ServerClientMethodContract<
    [workspaceId: string, automationId: string],
    { ok: boolean; items: AutomationTaskItem[] }
  >;

  // artifact plugins
  listArtifactPlugins: ServerClientMethodContract<
    [workspaceId: string],
    {
      items: ArtifactPluginCatalogItem[];
      diagnostics: Array<{ pluginDirectory: string; message: string }>;
    }
  >;
  getArtifactPlugin: ServerClientMethodContract<
    [workspaceId: string, pluginId: string],
    {
      item: ArtifactPluginCatalogItem;
      diagnostics: Array<{ pluginDirectory: string; message: string }>;
    }
  >;
  setArtifactPluginEnabled: ServerClientMethodContract<
    [workspaceId: string, pluginId: string, enabled: boolean],
    { item: ArtifactPluginCatalogItem }
  >;
  setArtifactPluginSkillEnabled: ServerClientMethodContract<
    [workspaceId: string, pluginId: string, skillId: string, enabled: boolean],
    { item: ArtifactPluginSkillItem }
  >;
  getArtifactPluginConnection: ServerClientMethodContract<
    [workspaceId: string, pluginId: string],
    ArtifactPluginConnectionState
  >;

  // artifacts / inbox
  uploadInbox: ServerClientMethodContract<
    [workspaceId: string, file: File, options?: { path?: string }],
    InboxUploadResponse
  >;
  listInbox: ServerClientMethodContract<[workspaceId: string], InboxListResponse>;
  downloadInboxItem: ServerClientMethodContract<
    [workspaceId: string, inboxId: string],
    BinaryDownloadResult
  >;
  listArtifacts: ServerClientMethodContract<
    [workspaceId: string],
    ArtifactListResponse
  >;
  resolveArtifacts: ServerClientMethodContract<
    [
      workspaceId: string,
      targets: Array<{
        kind: "file" | "url";
        value: string;
        name?: string;
        preview?: string;
        confidence?: number;
        reason?: string;
      }>,
    ],
    { items: ResolvedArtifactTarget[] }
  >;
  downloadArtifact: ServerClientMethodContract<
    [workspaceId: string, artifactId: string],
    BinaryDownloadResult
  >;

  // session archive (shared session-archive package types)
  listSessionArchiveSessions: ServerClientMethodContract<
    [
      workspaceId: string,
      options?: {
        start?: number;
        cursor?: string;
        search?: string;
        limit?: number;
        agent?: string;
      },
    ],
    SessionArchiveSessionPage
  >;
  getSessionArchiveSession: ServerClientMethodContract<
    [workspaceId: string, sessionId: string],
    { item: SessionArchiveSession }
  >;
  openSessionArchiveEventsStream: ServerClientMethodContract<
    [workspaceId: string, options?: { pollMs?: number; signal?: AbortSignal }],
    Response
  >;
  openSessionArchiveSessionWatchStream: ServerClientMethodContract<
    [
      workspaceId: string,
      sessionId: string,
      options?: { pollMs?: number; signal?: AbortSignal },
    ],
    Response
  >;
  getSessionArchiveMessages: ServerClientMethodContract<
    [
      workspaceId: string,
      sessionId: string,
      options?: { limit?: number; direction?: "asc" | "desc"; from?: number },
    ],
    SessionArchiveMessagesResponse
  >;
  searchSessionArchiveSession: ServerClientMethodContract<
    [workspaceId: string, sessionId: string, queryText: string],
    SessionArchiveSessionSearchResponse
  >;
  getSessionArchiveSessionUsage: ServerClientMethodContract<
    [workspaceId: string, sessionId: string],
    SessionArchiveSessionUsage
  >;
  renameSessionArchiveSession: ServerClientMethodContract<
    [workspaceId: string, sessionId: string, name: string],
    { item: SessionArchiveSession }
  >;
  trashSessionArchiveSession: ServerClientMethodContract<
    [workspaceId: string, sessionId: string],
    OkResult
  >;
  restoreSessionArchiveSession: ServerClientMethodContract<
    [workspaceId: string, sessionId: string],
    OkResult
  >;
  permanentlyDeleteSessionArchiveSession: ServerClientMethodContract<
    [workspaceId: string, sessionId: string],
    OkResult
  >;
  listSessionArchiveTrash: ServerClientMethodContract<
    [workspaceId: string],
    { sessions: SessionArchiveSession[] }
  >;
  emptySessionArchiveTrash: ServerClientMethodContract<
    [workspaceId: string],
    { ok: boolean; deleted: number }
  >;
  getSessionArchiveStarred: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveStarredResponse
  >;
  starSessionArchiveSession: ServerClientMethodContract<
    [workspaceId: string, sessionId: string],
    OkResult
  >;
  unstarSessionArchiveSession: ServerClientMethodContract<
    [workspaceId: string, sessionId: string],
    OkResult
  >;
  listSessionArchivePins: ServerClientMethodContract<
    [workspaceId: string, sessionId?: string],
    SessionArchivePinsResponse
  >;
  pinSessionArchiveMessage: ServerClientMethodContract<
    [workspaceId: string, sessionId: string, messageId: number, note?: string],
    { id: number }
  >;
  unpinSessionArchiveMessage: ServerClientMethodContract<
    [workspaceId: string, sessionId: string, messageId: number],
    OkResult
  >;
  openSessionArchiveSessionDirectory: ServerClientMethodContract<
    [workspaceId: string, sessionId: string],
    SessionArchiveOpenSessionResponse
  >;
  resumeSessionArchiveSession: ServerClientMethodContract<
    [workspaceId: string, sessionId: string],
    SessionArchiveResumeSessionResponse
  >;
  exportSessionArchiveSessionHtml: ServerClientMethodContract<
    [workspaceId: string, sessionId: string],
    SessionArchiveExportResponse
  >;
  exportSessionArchiveSessionMarkdown: ServerClientMethodContract<
    [workspaceId: string, sessionId: string],
    SessionArchiveExportResponse
  >;
  publishSessionArchiveSession: ServerClientMethodContract<
    [workspaceId: string, sessionId: string],
    SessionArchivePublishResponse
  >;
  getSessionArchiveUsageSummary: ServerClientMethodContract<
    [workspaceId: string, options?: { from?: string; to?: string }],
    SessionArchiveUsageSummaryResponse
  >;
  getSessionArchiveUsageComparison: ServerClientMethodContract<
    [
      workspaceId: string,
      currentCost: number,
      options?: { from?: string; to?: string },
    ],
    SessionArchiveUsageComparison
  >;
  getSessionArchiveTopUsageSessions: ServerClientMethodContract<
    [
      workspaceId: string,
      options?: { from?: string; to?: string; limit?: number },
    ],
    SessionArchiveTopUsageSession[]
  >;
  getSessionArchiveAnalyticsBatch: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveAnalyticsBatchResponse
  >;
  getSessionArchiveAnalyticsSummary: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveAnalyticsSummary
  >;
  getSessionArchiveAnalyticsActivity: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveAnalyticsActivityResponse
  >;
  getSessionArchiveAnalyticsHeatmap: ServerClientMethodContract<
    [workspaceId: string, metric?: string],
    SessionArchiveAnalyticsHeatmapResponse
  >;
  getSessionArchiveAnalyticsProjects: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveAnalyticsProjectsResponse
  >;
  getSessionArchiveAnalyticsHourOfWeek: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveAnalyticsHourOfWeekResponse
  >;
  getSessionArchiveAnalyticsSessions: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveAnalyticsSessionShapeResponse
  >;
  getSessionArchiveAnalyticsVelocity: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveAnalyticsVelocityResponse
  >;
  getSessionArchiveAnalyticsTools: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveAnalyticsToolsResponse
  >;
  getSessionArchiveAnalyticsSkills: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveAnalyticsSkillsResponse
  >;
  getSessionArchiveAnalyticsTopSessions: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveAnalyticsTopSessionsResponse
  >;
  getSessionArchiveAnalyticsSignals: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveAnalyticsSignalsResponse
  >;
  getSessionArchiveAnalyticsSignalSessions: ServerClientMethodContract<
    [workspaceId: string, signal: string],
    SessionArchiveAnalyticsSignalSessionsResponse
  >;
  getSessionArchiveActivityReport: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveActivityReport
  >;
  getSessionArchiveTrendTerms: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveTrendsTermsResponse
  >;
  listSessionArchiveInsights: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveInsightsResponse
  >;
  generateSessionArchiveInsight: ServerClientMethodContract<
    [workspaceId: string, payload: SessionArchiveGenerateInsightRequest],
    SessionArchiveInsightsResponse
  >;
  deleteSessionArchiveInsight: ServerClientMethodContract<
    [workspaceId: string, insightId: string],
    OkResult
  >;
  uploadSessionArchiveExport: ServerClientMethodContract<
    [workspaceId: string, payload: SessionArchiveUploadImportRequest],
    SessionArchiveImportStats
  >;
  importSessionArchiveClaudeAi: ServerClientMethodContract<
    [workspaceId: string, payload: SessionArchiveUploadImportRequest],
    SessionArchiveImportStats
  >;
  importSessionArchiveChatGpt: ServerClientMethodContract<
    [workspaceId: string, payload: SessionArchiveUploadImportRequest],
    SessionArchiveImportStats
  >;
  getSessionArchiveConfig: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveConfigSnapshot
  >;
  getSessionArchiveBackendsStatus: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveBackendsStatusResponse
  >;
  getSessionArchiveLifecycleStatus: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveLifecycleStatus
  >;
  updateSessionArchiveConfig: ServerClientMethodContract<
    [workspaceId: string, payload: SessionArchiveConfigUpdate],
    SessionArchiveConfigSnapshot
  >;
  listSessionArchiveWorktreeMappings: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveWorktreeMappingsResponse
  >;
  upsertSessionArchiveWorktreeMapping: ServerClientMethodContract<
    [workspaceId: string, payload: SessionArchiveWorktreeMappingInput],
    { item: SessionArchiveWorktreeMapping }
  >;
  deleteSessionArchiveWorktreeMapping: ServerClientMethodContract<
    [workspaceId: string, mappingId: string],
    OkResult
  >;
  applySessionArchiveWorktreeMappings: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveApplyWorktreeMappingsResponse
  >;
  scanSessionArchiveSecrets: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveSecretScanSummary
  >;
  listSessionArchiveSecrets: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveSecretFindingsResponse
  >;
  searchSessionArchive: ServerClientMethodContract<
    [
      workspaceId: string,
      queryText: string,
      options?: { limit?: number; cursor?: string },
    ],
    SessionArchiveSearchResponse
  >;
  syncSessionArchive: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveSyncResult
  >;
  getSessionArchiveSyncStatus: ServerClientMethodContract<
    [workspaceId: string],
    SessionArchiveSyncStatus
  >;
};

/**
 * Complete method map: every `ServerClientMethodName` is a key.
 * Typed entries come from `TypedServerClientMethodMap`; others are untyped placeholders
 * (OpenCode router identities and similar client-local shapes).
 */
export type ServerClientMethodMap = {
  [K in ServerClientMethodName]: K extends keyof TypedServerClientMethodMap
    ? TypedServerClientMethodMap[K]
    : ServerClientMethodContract;
};

export type ServerClientMethodArgsOf<M extends ServerClientMethodName> =
  ServerClientMethodMap[M]["args"];

export type ServerClientMethodResultOf<M extends ServerClientMethodName> =
  ServerClientMethodMap[M]["result"];

/**
 * Typed call signature for a single HTTP client method.
 * Use when binding or wrapping `OnMyAgentServerClient` methods by name.
 */
export type ServerClientMethodFn<M extends ServerClientMethodName> = (
  ...args: ServerClientMethodMap[M]["args"] extends readonly unknown[]
    ? ServerClientMethodMap[M]["args"]
    : never
) =>
  | Promise<ServerClientMethodMap[M]["result"]>
  | ServerClientMethodMap[M]["result"];
