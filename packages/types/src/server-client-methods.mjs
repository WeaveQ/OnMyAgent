/**
 * Canonical renderer-facing HTTP client method inventory, grouped by domain.
 *
 * Keep method names here so app client modules, parity tests, and
 * `ServerClientMethodMap` share one domain-grouped source of truth.
 */
const methodGroups = /** @type {const} */ ({
  system: [
    "baseUrl", "token", "health", "runtimeVersions", "status", "capabilities",
    "getConfig", "patchConfig", "listReloadEvents", "reloadEngine", "listAudit",
    "createVoiceRealtimeSession",
  ],
  workspace: [
    "listWorkspaces", "createLocalWorkspace", "updateWorkspaceDisplayName",
    "activateWorkspace", "deleteWorkspace", "exportWorkspace", "importWorkspace",
    "previewWorkspaceImport", "materializeBlueprintSessions",
    "readOpencodeConfigFile", "writeOpencodeConfigFile", "readWorkspaceFile",
    "statWorkspaceFile", "writeWorkspaceFile", "writeWorkspaceBinaryFile",
    "downloadWorkspaceFile", "listWorkspaceFiles",
  ],
  sessions: [
    "deleteSession", "listSessions", "getSession", "getSessionMessages",
    "getSessionSnapshot",
  ],
  extensions: [
    "listPlugins", "addPlugin", "removePlugin", "listSkills", "listHubSkills",
    "installHubSkill", "getSkill", "upsertSkill", "deleteSkill",
    "getOpenCodeRouterHealth", "getOpenCodeRouterTelegram",
    "getOpenCodeRouterTelegramIdentities", "getOpenCodeRouterSlackIdentities",
    "sendOpenCodeRouterMessage", "upsertOpenCodeRouterTelegramIdentity",
    "deleteOpenCodeRouterTelegramIdentity", "upsertOpenCodeRouterSlackIdentity",
    "deleteOpenCodeRouterSlackIdentity", "listMcp", "addMcp", "removeMcp",
    "setMcpEnabled", "logoutMcpAuth", "listCommands", "upsertCommand",
    "deleteCommand", "listAutomations", "listAutomationRuns", "createAutomation",
    "updateAutomation", "runAutomation", "deleteAutomation",
  ],
  sessionArchive: [
    "listSessionArchiveSessions", "getSessionArchiveSession",
    "openSessionArchiveEventsStream", "openSessionArchiveSessionWatchStream",
    "getSessionArchiveMessages", "searchSessionArchiveSession",
    "getSessionArchiveSessionUsage", "renameSessionArchiveSession",
    "trashSessionArchiveSession", "restoreSessionArchiveSession",
    "permanentlyDeleteSessionArchiveSession", "listSessionArchiveTrash",
    "emptySessionArchiveTrash", "getSessionArchiveStarred",
    "starSessionArchiveSession", "unstarSessionArchiveSession",
    "listSessionArchivePins", "pinSessionArchiveMessage",
    "unpinSessionArchiveMessage", "openSessionArchiveSessionDirectory",
    "resumeSessionArchiveSession", "exportSessionArchiveSessionHtml",
    "exportSessionArchiveSessionMarkdown", "publishSessionArchiveSession",
    "getSessionArchiveUsageSummary", "getSessionArchiveUsageComparison",
    "getSessionArchiveTopUsageSessions", "getSessionArchiveAnalyticsBatch",
    "getSessionArchiveAnalyticsSummary", "getSessionArchiveAnalyticsActivity",
    "getSessionArchiveAnalyticsHeatmap", "getSessionArchiveAnalyticsProjects",
    "getSessionArchiveAnalyticsHourOfWeek", "getSessionArchiveAnalyticsSessions",
    "getSessionArchiveAnalyticsVelocity", "getSessionArchiveAnalyticsTools",
    "getSessionArchiveAnalyticsSkills", "getSessionArchiveAnalyticsTopSessions",
    "getSessionArchiveAnalyticsSignals", "getSessionArchiveAnalyticsSignalSessions",
    "getSessionArchiveActivityReport", "getSessionArchiveTrendTerms",
    "listSessionArchiveInsights", "generateSessionArchiveInsight",
    "deleteSessionArchiveInsight", "uploadSessionArchiveExport",
    "importSessionArchiveClaudeAi", "importSessionArchiveChatGpt",
    "getSessionArchiveConfig", "getSessionArchiveBackendsStatus",
    "getSessionArchiveLifecycleStatus", "updateSessionArchiveConfig",
    "listSessionArchiveWorktreeMappings", "upsertSessionArchiveWorktreeMapping",
    "deleteSessionArchiveWorktreeMapping", "applySessionArchiveWorktreeMappings",
    "scanSessionArchiveSecrets", "listSessionArchiveSecrets",
    "searchSessionArchive", "syncSessionArchive", "getSessionArchiveSyncStatus",
  ],
  artifactPlugins: [
    "listArtifactPlugins", "getArtifactPlugin", "setArtifactPluginEnabled",
    "setArtifactPluginSkillEnabled", "getArtifactPluginConnection",
  ],
  artifacts: [
    "uploadInbox", "listInbox", "downloadInboxItem", "listArtifacts",
    "resolveArtifacts", "downloadArtifact",
  ],
  environment: [
    "listUserEnvKeys", "listUserEnv", "upsertUserEnv", "deleteUserEnv",
  ],
});

export const serverClientMethodGroups = Object.freeze(methodGroups);

export const serverClientMethodNames = Object.freeze(
  /** @type {readonly (typeof methodGroups)[keyof typeof methodGroups][number][]} */
  (Object.values(methodGroups).flat()),
);
