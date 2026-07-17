import type { Message, Part, Session, Todo } from "@opencode-ai/sdk/v2/client";
import type {
  SessionArchiveAnalyticsActivityResponse,
  SessionArchiveAnalyticsHeatmapResponse,
  SessionArchiveAnalyticsHourOfWeekResponse,
  SessionArchiveAnalyticsProjectsResponse, SessionArchiveAnalyticsBatchResponse,
  SessionArchiveAnalyticsSessionShapeResponse,
  SessionArchiveAnalyticsSignalSessionsResponse,
  SessionArchiveAnalyticsSignalsResponse,
  SessionArchiveAnalyticsSkillsResponse,
  SessionArchiveAnalyticsSummary,
  SessionArchiveAnalyticsToolsResponse,
  SessionArchiveAnalyticsTopSessionsResponse,
  SessionArchiveAnalyticsVelocityResponse,
  SessionArchiveActivityReport,
  SessionArchiveApplyWorktreeMappingsResponse,
  SessionArchiveBackendsStatusResponse,
  SessionArchiveGenerateInsightRequest,
  SessionArchiveConfigSnapshot,
  SessionArchiveConfigUpdate,
  SessionArchiveInsight,
  SessionArchiveInsightsResponse,
  SessionArchiveImportStats,
  SessionArchiveDirectoryResponse,
  SessionArchiveExportResponse,
  SessionArchiveLifecycleStatus,
  SessionArchiveMessagesResponse,
  SessionArchiveOpenSessionResponse,
  SessionArchivePinnedMessage,
  SessionArchivePinsResponse,
  SessionArchivePublishResponse,
  SessionArchiveResumeSessionResponse,
  SessionArchiveSearchResponse,
  SessionArchiveSecretConfidence,
  SessionArchiveSecretFinding,
  SessionArchiveSecretFindingsResponse,
  SessionArchiveSecretScanSummary,
  SessionArchiveSession,
  SessionArchiveSessionPage,
  SessionArchiveSessionSearchResponse,
  SessionArchiveStarredResponse,
  SessionArchiveSyncResult,
  SessionArchiveSyncStatus,
  SessionArchiveSessionUsage,
  SessionArchiveTopUsageSession,
  SessionArchiveTrendsTermsResponse,
  SessionArchiveUploadImportRequest,
  SessionArchiveUsageComparison,
  SessionArchiveUsageSummaryResponse,
  SessionArchiveWorktreeMapping,
  SessionArchiveWorktreeMappingsResponse,
  SessionArchiveWorktreeMappingInput,
} from "@onmyagent/types/session-archive";
import type {
  Actor,
  ArtifactPluginCatalogItem,
  ArtifactItem,
  ArtifactListResponse,
  AuditEntry,
  AutomationRunHistoryResult,
  AutomationTaskInput,
  AutomationTaskItem,
  CommandItem,
  HubSkillItem,
  InboxItem,
  InboxListResponse,
  InboxUploadResponse,
  McpItem,
  PluginItem,
  ReloadEvent,
  ReloadTrigger,
  ResolvedArtifactTarget,
  RuntimeServiceName,
  RuntimeServiceSnapshot,
  RuntimeVersionsResponse,
  ServerClientCapabilities,
  ServerHealthResponse,
  ServerStatusResponse,
  SkillContentResponse,
  SkillItem,
  WorkspaceExportResponse,
  WorkspaceFileCatalogEntry,
  WorkspaceFileCatalogResponse,
  WorkspaceFileContentResponse,
  WorkspaceFileStatResponse,
  WorkspaceFileWriteResponse,
  WorkspaceImportChange,
  WorkspaceImportPreviewResponse,
} from "@onmyagent/types/server";
import type { ArtifactPluginConnectionState } from "@onmyagent/types/artifact-plugin";
import { desktopFetch } from "../desktop";
import { isDesktopRuntime } from "../../utils";
import type { ExecResult, OpencodeConfigFile, WorkspaceInfo, WorkspaceList } from "../desktop";

/** @deprecated Prefer ServerClientCapabilities from @onmyagent/types/server */
export type OnMyAgentServerCapabilities = ServerClientCapabilities;

export type OnMyAgentServerStatus = "connected" | "disconnected" | "limited";

/** @deprecated Prefer ServerStatusResponse from @onmyagent/types/server */
export type OnMyAgentServerDiagnostics = Omit<ServerStatusResponse, "workspace"> & {
  workspace: OnMyAgentWorkspaceInfo | null;
};

export type OnMyAgentRuntimeServiceName = RuntimeServiceName;
export type OnMyAgentRuntimeServiceSnapshot = RuntimeServiceSnapshot;
/** @deprecated Prefer RuntimeVersionsResponse from @onmyagent/types/server */
export type OnMyAgentRuntimeSnapshot = RuntimeVersionsResponse;
export type OnMyAgentServerHealth = ServerHealthResponse;

export type OnMyAgentServerSettings = {
  urlOverride?: string;
  portOverride?: number;
  token?: string;
  hostToken?: string;
  remoteAccessEnabled?: boolean;
};

export type OnMyAgentWorkspaceInfo = WorkspaceInfo & {
  opencode?: {
    baseUrl?: string;
    directory?: string;
    username?: string;
    password?: string;
  };
};

export type OnMyAgentWorkspaceList = {
  items: OnMyAgentWorkspaceInfo[];
  workspaces?: WorkspaceInfo[];
  activeId?: string | null;
};

export type OnMyAgentSessionMessage = {
  info: Message;
  parts: Part[];
};

export type OnMyAgentSessionSnapshot = {
  session: Session;
  messages: OnMyAgentSessionMessage[];
  todos: Todo[];
  status:
    | { type: "idle" }
    | { type: "busy" }
    | { type: "retry"; attempt: number; message: string; next: number };
};

export type OnMyAgentPluginItem = PluginItem;
export type OnMyAgentSkillItem = SkillItem;
export type OnMyAgentSkillContent = SkillContentResponse;
export type OnMyAgentHubSkillItem = HubSkillItem;

export type OnMyAgentHubRepo = {
  owner?: string;
  repo?: string;
  ref?: string;
};

export type OnMyAgentWorkspaceFileContent = WorkspaceFileContentResponse;
export type OnMyAgentWorkspaceFileWriteResult = WorkspaceFileWriteResponse;

function readErrorName(error: unknown): string {
  if (error && typeof error === "object" && "name" in error) {
    const value = (error as { name?: unknown }).name;
    return typeof value === "string" ? value : "";
  }
  return "";
}

export function arrayBufferToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export type OnMyAgentCommandItem = CommandItem;

export type OnMyAgentAutomationTaskItem = AutomationTaskItem;
export type OnMyAgentAutomationTaskInput = AutomationTaskInput;
export type OnMyAgentAutomationRunHistoryResult = AutomationRunHistoryResult;
export type OnMyAgentSessionArchiveSession = SessionArchiveSession;
export type OnMyAgentSessionArchiveSessionPage = SessionArchiveSessionPage;
export type OnMyAgentSessionArchiveMessagesResponse = SessionArchiveMessagesResponse;
export type OnMyAgentSessionArchiveSearchResponse = SessionArchiveSearchResponse;
export type OnMyAgentSessionArchiveSessionSearchResponse = SessionArchiveSessionSearchResponse;
export type OnMyAgentSessionArchiveStarredResponse = SessionArchiveStarredResponse;
export type OnMyAgentSessionArchiveSecretConfidence = SessionArchiveSecretConfidence;
export type OnMyAgentSessionArchiveSecretFinding = SessionArchiveSecretFinding;
export type OnMyAgentSessionArchiveSecretFindingsResponse = SessionArchiveSecretFindingsResponse;
export type OnMyAgentSessionArchiveSecretScanSummary = SessionArchiveSecretScanSummary;
export type OnMyAgentSessionArchiveSessionUsage = SessionArchiveSessionUsage;
export type OnMyAgentSessionArchiveUsageSummaryResponse = SessionArchiveUsageSummaryResponse;
export type OnMyAgentSessionArchiveUsageComparison = SessionArchiveUsageComparison;
export type OnMyAgentSessionArchiveTopUsageSession = SessionArchiveTopUsageSession;
export type OnMyAgentSessionArchiveAnalyticsSummary = SessionArchiveAnalyticsSummary;
export type OnMyAgentSessionArchiveAnalyticsActivityResponse = SessionArchiveAnalyticsActivityResponse;
export type OnMyAgentSessionArchiveAnalyticsHeatmapResponse = SessionArchiveAnalyticsHeatmapResponse;
export type OnMyAgentSessionArchiveAnalyticsProjectsResponse = SessionArchiveAnalyticsProjectsResponse;
export type OnMyAgentSessionArchiveAnalyticsHourOfWeekResponse = SessionArchiveAnalyticsHourOfWeekResponse;
export type OnMyAgentSessionArchiveAnalyticsSessionShapeResponse = SessionArchiveAnalyticsSessionShapeResponse;
export type OnMyAgentSessionArchiveAnalyticsVelocityResponse = SessionArchiveAnalyticsVelocityResponse;
export type OnMyAgentSessionArchiveAnalyticsToolsResponse = SessionArchiveAnalyticsToolsResponse;
export type OnMyAgentSessionArchiveAnalyticsSkillsResponse = SessionArchiveAnalyticsSkillsResponse;
export type OnMyAgentSessionArchiveAnalyticsTopSessionsResponse = SessionArchiveAnalyticsTopSessionsResponse;
export type OnMyAgentSessionArchiveAnalyticsSignalsResponse = SessionArchiveAnalyticsSignalsResponse;
export type OnMyAgentSessionArchiveAnalyticsSignalSessionsResponse = SessionArchiveAnalyticsSignalSessionsResponse;
export type OnMyAgentSessionArchiveActivityReport = SessionArchiveActivityReport;
export type OnMyAgentSessionArchiveTrendsTermsResponse = SessionArchiveTrendsTermsResponse;
export type OnMyAgentSessionArchiveInsight = SessionArchiveInsight;
export type OnMyAgentSessionArchiveInsightsResponse = SessionArchiveInsightsResponse;
export type OnMyAgentSessionArchiveGenerateInsightRequest = SessionArchiveGenerateInsightRequest;
export type OnMyAgentSessionArchiveConfigSnapshot = SessionArchiveConfigSnapshot;
export type OnMyAgentSessionArchiveConfigUpdate = SessionArchiveConfigUpdate;
export type OnMyAgentSessionArchiveBackendsStatusResponse = SessionArchiveBackendsStatusResponse;
export type OnMyAgentSessionArchiveLifecycleStatus = SessionArchiveLifecycleStatus;
export type OnMyAgentSessionArchiveImportStats = SessionArchiveImportStats;
export type OnMyAgentSessionArchiveUploadImportRequest = SessionArchiveUploadImportRequest;
export type OnMyAgentSessionArchiveWorktreeMapping = SessionArchiveWorktreeMapping;
export type OnMyAgentSessionArchiveWorktreeMappingInput = SessionArchiveWorktreeMappingInput;
export type OnMyAgentSessionArchiveWorktreeMappingsResponse = SessionArchiveWorktreeMappingsResponse;
export type OnMyAgentSessionArchiveApplyWorktreeMappingsResponse = SessionArchiveApplyWorktreeMappingsResponse;
export type OnMyAgentSessionArchiveDirectoryResponse = SessionArchiveDirectoryResponse;
export type OnMyAgentSessionArchiveOpenSessionResponse = SessionArchiveOpenSessionResponse;
export type OnMyAgentSessionArchiveResumeSessionResponse = SessionArchiveResumeSessionResponse;
export type OnMyAgentSessionArchiveExportResponse = SessionArchiveExportResponse;
export type OnMyAgentSessionArchivePublishResponse = SessionArchivePublishResponse;
export type OnMyAgentSessionArchivePinnedMessage = SessionArchivePinnedMessage;
export type OnMyAgentSessionArchivePinsResponse = SessionArchivePinsResponse;
export type OnMyAgentSessionArchiveSyncResult = SessionArchiveSyncResult;
export type OnMyAgentSessionArchiveSyncStatus = SessionArchiveSyncStatus;

export type OnMyAgentMcpItem = McpItem;

export type OnMyAgentWorkspaceExport = WorkspaceExportResponse;
export type OnMyAgentWorkspaceImportChange = WorkspaceImportChange;
export type OnMyAgentWorkspaceImportPreview = WorkspaceImportPreviewResponse;

export type OnMyAgentWorkspaceExportSensitiveMode = "auto" | "include" | "exclude";

export type OnMyAgentWorkspaceExportWarning = {
  id: string;
  label: string;
  detail: string;
};

export type OnMyAgentBlueprintSessionsMaterializeResult = {
  ok: boolean;
  created: Array<{ templateId: string; sessionId: string; title: string }>;
  existing: Array<{ templateId: string; sessionId: string }>;
  openSessionId: string | null;
};

export type OnMyAgentArtifactItem = ArtifactItem;
export type OnMyAgentArtifactList = ArtifactListResponse;
export type OnMyAgentResolvedArtifactTarget = ResolvedArtifactTarget;
export type OnMyAgentWorkspaceFileStat = WorkspaceFileStatResponse;
export type OnMyAgentWorkspaceFileCatalogEntry = WorkspaceFileCatalogEntry;
export type OnMyAgentWorkspaceFileCatalog = WorkspaceFileCatalogResponse;
export type OnMyAgentInboxItem = InboxItem;
export type OnMyAgentInboxList = InboxListResponse;
export type OnMyAgentInboxUploadResult = InboxUploadResponse;
export type OnMyAgentActor = Actor;
export type OnMyAgentAuditEntry = AuditEntry;
export type OnMyAgentReloadTrigger = ReloadTrigger;
export type OnMyAgentReloadEvent = ReloadEvent;

// Fallback for explicit server-mode URL derivation. Desktop local workers replace this
// with the persisted runtime-discovered port once the host reports it.
export const DEFAULT_ONMYAGENT_SERVER_PORT = 8787;

const STORAGE_URL_OVERRIDE = "onmyagent.server.urlOverride";
const STORAGE_PORT_OVERRIDE = "onmyagent.server.port";
const STORAGE_TOKEN = "onmyagent.server.token";
const STORAGE_HOST_AUTH_KEY = "onmyagent.server.hostToken";
const STORAGE_REMOTE_ACCESS = "onmyagent.server.remoteAccessEnabled";

export function normalizeOnMyAgentServerUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

export function isLoopbackOnMyAgentServerUrl(input: string) {
  const normalized = normalizeOnMyAgentServerUrl(input) ?? "";
  if (!normalized) return false;
  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function parseOnMyAgentWorkspaceIdFromUrl(input: string) {
  const normalized = normalizeOnMyAgentServerUrl(input) ?? "";
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const segments = url.pathname.split("/").filter(Boolean);
    const legacyIndex = segments.indexOf("w");
    if (legacyIndex >= 0 && segments[legacyIndex + 1]) {
      return decodeURIComponent(segments[legacyIndex + 1]);
    }
    const workspaceIndex = segments.indexOf("workspace");
    if (workspaceIndex >= 0 && segments[workspaceIndex + 1]) {
      return decodeURIComponent(segments[workspaceIndex + 1]);
    }
    return null;
  } catch {
    const match = normalized.match(/\/(?:w|workspace)\/([^/?#]+)/);
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
}

export function buildOnMyAgentWorkspaceBaseUrl(hostUrl: string, workspaceId?: string | null) {
  const normalized = normalizeOnMyAgentServerUrl(hostUrl) ?? "";
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const segments = url.pathname.split("/").filter(Boolean);
    const workspaceIndex = segments.indexOf("workspace");
    const legacyIndex = segments.indexOf("w");
    const mountIndex = workspaceIndex >= 0 ? workspaceIndex : legacyIndex;
    if (mountIndex >= 0 && segments[mountIndex + 1]) {
      const prefix = segments.slice(0, mountIndex).join("/");
      url.pathname = `${prefix ? `/${prefix}` : ""}/workspace/${encodeURIComponent(
        decodeURIComponent(segments[mountIndex + 1]),
      )}`;
      return url.toString().replace(/\/+$/, "");
    }

    const id = (workspaceId ?? "").trim();
    if (!id) return url.toString().replace(/\/+$/, "");

    const basePath = url.pathname.replace(/\/+$/, "");
    url.pathname = `${basePath}/workspace/${encodeURIComponent(id)}`;
    return url.toString().replace(/\/+$/, "");
  } catch {
    const id = (workspaceId ?? "").trim();
    if (!id) return normalized;
    return `${normalized.replace(/\/+$/, "")}/workspace/${encodeURIComponent(id)}`;
  }
}

const ONMYAGENT_INVITE_PARAM_URL = "ow_url";
const ONMYAGENT_INVITE_PARAM_TOKEN = "ow_token";
const ONMYAGENT_INVITE_PARAM_STARTUP = "ow_startup";
const ONMYAGENT_INVITE_PARAM_AUTO_CONNECT = "ow_auto_connect";

export type OnMyAgentOpenCodeRouterHealthSnapshot = {
  ok: boolean;
  opencode: Record<string, unknown>;
  channels: Record<string, unknown>;
  config: Record<string, unknown>;
  activity?: {
    inboundToday?: number;
    outboundToday?: number;
    lastMessageAt?: number | null;
    [key: string]: unknown;
  };
  agent?: {
    loaded?: boolean;
    selected?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type OnMyAgentOpenCodeRouterIdentityItem = {
  id: string;
  channel?: string;
  enabled?: boolean;
  peerId?: string;
  [key: string]: unknown;
};

export type OnMyAgentOpenCodeRouterSendResult = {
  ok: boolean;
  sent: number;
  attempted: number;
  failures?: Array<{ identityId: string; peerId: string; error: string }>;
  reason?: string;
  [key: string]: unknown;
};

export type OnMyAgentOpenCodeRouterTelegramConfig = {
  ok: boolean;
  telegram?: {
    bot?: {
      username?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  bot?: {
    username?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type OnMyAgentOpenCodeRouterIdentityWriteResult = {
  ok: boolean;
  applied?: boolean;
  applyError?: string;
  pairingCode?: string;
  telegram?: OnMyAgentOpenCodeRouterTelegramConfig["telegram"];
  [key: string]: unknown;
};

export type OnMyAgentOpenCodeRouterResponse<T> = {
  ok: boolean;
  json: T | null;
  status: number;
};

export type OnMyAgentConnectInvite = {
  url: string;
  token?: string;
  startup?: "server";
  autoConnect?: boolean;
};

export function readOnMyAgentConnectInviteFromSearch(input: string | URLSearchParams) {
  const search =
    typeof input === "string"
      ? new URLSearchParams(input.startsWith("?") ? input.slice(1) : input)
      : input;

  const rawUrl = search.get(ONMYAGENT_INVITE_PARAM_URL)?.trim() ?? "";
  const url = normalizeOnMyAgentServerUrl(rawUrl);
  if (!url) return null;

  const token = search.get(ONMYAGENT_INVITE_PARAM_TOKEN)?.trim() ?? "";
  const startupRaw = search.get(ONMYAGENT_INVITE_PARAM_STARTUP)?.trim() ?? "";
  const startup = startupRaw === "server" ? "server" : undefined;
  const autoConnect = search.get(ONMYAGENT_INVITE_PARAM_AUTO_CONNECT)?.trim() === "1";

  return {
    url,
    token: token || undefined,
    startup,
    autoConnect: autoConnect || undefined,
  } satisfies OnMyAgentConnectInvite;
}

export function stripOnMyAgentConnectInviteFromUrl(input: string) {
  try {
    const url = new URL(input);
    url.searchParams.delete(ONMYAGENT_INVITE_PARAM_URL);
    url.searchParams.delete(ONMYAGENT_INVITE_PARAM_TOKEN);
    url.searchParams.delete(ONMYAGENT_INVITE_PARAM_STARTUP);
    url.searchParams.delete(ONMYAGENT_INVITE_PARAM_AUTO_CONNECT);
    return url.toString();
  } catch {
    return input;
  }
}

export function readOnMyAgentServerSettings(): OnMyAgentServerSettings {
  if (typeof window === "undefined") return {};
  try {
    const urlOverride = normalizeOnMyAgentServerUrl(
      window.localStorage.getItem(STORAGE_URL_OVERRIDE) ?? "",
    );
    const portRaw = window.localStorage.getItem(STORAGE_PORT_OVERRIDE) ?? "";
    const portOverride = portRaw ? Number(portRaw) : undefined;
    const token = window.localStorage.getItem(STORAGE_TOKEN) ?? undefined;
    const hostToken = window.localStorage.getItem(STORAGE_HOST_AUTH_KEY) ?? undefined;
    const remoteAccessRaw = window.localStorage.getItem(STORAGE_REMOTE_ACCESS) ?? "";
    return {
      urlOverride: urlOverride ?? undefined,
      portOverride: Number.isNaN(portOverride) ? undefined : portOverride,
      token: token?.trim() || undefined,
      hostToken: hostToken?.trim() || undefined,
      remoteAccessEnabled: remoteAccessRaw === "1",
    };
  } catch {
    return {};
  }
}

export function writeOnMyAgentServerSettings(next: OnMyAgentServerSettings): OnMyAgentServerSettings {
  if (typeof window === "undefined") return next;
  try {
    const urlOverride = normalizeOnMyAgentServerUrl(next.urlOverride ?? "");
    const portOverride = typeof next.portOverride === "number" ? next.portOverride : undefined;
    const token = next.token?.trim() || undefined;
    const hostToken = next.hostToken?.trim() || undefined;
    const remoteAccessEnabled = next.remoteAccessEnabled === true;

    if (urlOverride) {
      window.localStorage.setItem(STORAGE_URL_OVERRIDE, urlOverride);
    } else {
      window.localStorage.removeItem(STORAGE_URL_OVERRIDE);
    }

    if (typeof portOverride === "number" && !Number.isNaN(portOverride)) {
      window.localStorage.setItem(STORAGE_PORT_OVERRIDE, String(portOverride));
    } else {
      window.localStorage.removeItem(STORAGE_PORT_OVERRIDE);
    }

    if (token) {
      window.localStorage.setItem(STORAGE_TOKEN, token);
    } else {
      window.localStorage.removeItem(STORAGE_TOKEN);
    }

    if (hostToken) {
      window.localStorage.setItem(STORAGE_HOST_AUTH_KEY, hostToken);
    } else {
      window.localStorage.removeItem(STORAGE_HOST_AUTH_KEY);
    }

    if (remoteAccessEnabled) {
      window.localStorage.setItem(STORAGE_REMOTE_ACCESS, "1");
    } else {
      window.localStorage.removeItem(STORAGE_REMOTE_ACCESS);
    }

    return readOnMyAgentServerSettings();
  } catch {
    return next;
  }
}

export function hydrateOnMyAgentServerSettingsFromEnv() {
  if (typeof window === "undefined") return;

  const envUrl = typeof import.meta.env?.VITE_ONMYAGENT_URL === "string"
    ? import.meta.env.VITE_ONMYAGENT_URL.trim()
    : "";
  const envPort = typeof import.meta.env?.VITE_ONMYAGENT_PORT === "string"
    ? import.meta.env.VITE_ONMYAGENT_PORT.trim()
    : "";
  const envToken = typeof import.meta.env?.VITE_ONMYAGENT_TOKEN === "string"
    ? import.meta.env.VITE_ONMYAGENT_TOKEN.trim()
    : "";
  const envHostToken = typeof import.meta.env?.VITE_ONMYAGENT_HOST_TOKEN === "string"
    ? import.meta.env.VITE_ONMYAGENT_HOST_TOKEN.trim()
    : "";

  if (!envUrl && !envPort && !envToken && !envHostToken) return;

  try {
    const current = readOnMyAgentServerSettings();
    const next: OnMyAgentServerSettings = { ...current };
    let changed = false;

    if (!current.urlOverride && envUrl) {
      next.urlOverride = normalizeOnMyAgentServerUrl(envUrl) ?? undefined;
      changed = true;
    }

    if (!current.portOverride && envPort) {
      const parsed = Number(envPort);
      if (Number.isFinite(parsed) && parsed > 0) {
        next.portOverride = parsed;
        changed = true;
      }
    }

    if (!current.token && envToken) {
      next.token = envToken;
      changed = true;
    }

    if (!current.hostToken && envHostToken) {
      next.hostToken = envHostToken;
      changed = true;
    }

    if (changed) {
      writeOnMyAgentServerSettings(next);
    }
  } catch {
    // ignore
  }
}

export function clearOnMyAgentServerSettings() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_URL_OVERRIDE);
    window.localStorage.removeItem(STORAGE_PORT_OVERRIDE);
    window.localStorage.removeItem(STORAGE_TOKEN);
    window.localStorage.removeItem(STORAGE_HOST_AUTH_KEY);
    window.localStorage.removeItem(STORAGE_REMOTE_ACCESS);
  } catch {
    // ignore
  }
}

export class OnMyAgentServerError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function buildHeaders(
  token?: string,
  hostToken?: string,
  extra?: Record<string, string>,
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (hostToken) {
    headers["X-OnMyAgent-Host-Token"] = hostToken;
  }
  if (extra) {
    Object.assign(headers, extra);
  }
  return headers;
}

export function buildAuthHeaders(token?: string, hostToken?: string, extra?: Record<string, string>) {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (hostToken) {
    headers["X-OnMyAgent-Host-Token"] = hostToken;
  }
  if (extra) {
    Object.assign(headers, extra);
  }
  return headers;
}

// Use the desktop IPC fetch when running in the desktop app to avoid CORS issues.
// Stream URLs (SSE) bypass the IPC bridge because it blocks until the body
// closes — that freezes the webview for infinite bodies.
export const ONMYAGENT_STREAM_URL_RE = /\/events(\b|\?)|\/event-stream\b|\/stream\b/;

export function isStreamUrl(url: string): boolean {
  return ONMYAGENT_STREAM_URL_RE.test(url);
}

export const resolveFetch = (url?: string) => {
  if (!isDesktopRuntime()) return globalThis.fetch;
  if (url && isStreamUrl(url)) {
    return typeof window !== "undefined" ? window.fetch.bind(window) : globalThis.fetch;
  }
  return desktopFetch;
};

export const DEFAULT_ONMYAGENT_SERVER_TIMEOUT_MS = 10_000;

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetchImpl(url, init);
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const signal = controller?.signal;
  const initWithSignal = signal && !init.signal ? { ...init, signal } : init;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      try {
        controller?.abort();
      } catch {
        // ignore
      }
      reject(new Error("Request timed out."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fetchImpl(url, initWithSignal), timeoutPromise]);
  } catch (error) {
    const name = readErrorName(error);
    if (name === "AbortError") {
      throw new Error("Request timed out.");
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; hostToken?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const fetchImpl = resolveFetch(url);
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: options.method ?? "GET",
      headers: buildHeaders(options.token, options.hostToken),
      body: options.body ? JSON.stringify(options.body) : undefined,
    },
    options.timeoutMs ?? DEFAULT_ONMYAGENT_SERVER_TIMEOUT_MS,
  );

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const code = typeof json?.code === "string" ? json.code : "request_failed";
    const message = typeof json?.message === "string" ? json.message : response.statusText;
    throw new OnMyAgentServerError(response.status, code, message, json?.details);
  }

  return json as T;
}

export async function requestText(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; hostToken?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<string> {
  const url = `${baseUrl}${path}`;
  const fetchImpl = resolveFetch(url);
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: options.method ?? "GET",
      headers: buildHeaders(options.token, options.hostToken),
      body: options.body ? JSON.stringify(options.body) : undefined,
    },
    options.timeoutMs ?? DEFAULT_ONMYAGENT_SERVER_TIMEOUT_MS,
  );
  const text = await response.text();
  if (!response.ok) {
    throw new OnMyAgentServerError(response.status, "request_failed", text || response.statusText);
  }
  return text;
}

export async function requestMultipartRaw(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; hostToken?: string; body?: FormData; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; text: string }>{
  const url = `${baseUrl}${path}`;
  const fetchImpl = resolveFetch(url);
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: options.method ?? "POST",
      headers: buildAuthHeaders(options.token, options.hostToken),
      body: options.body,
    },
    options.timeoutMs ?? DEFAULT_ONMYAGENT_SERVER_TIMEOUT_MS,
  );
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

export async function requestBinary(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; hostToken?: string; timeoutMs?: number } = {},
): Promise<{ data: ArrayBuffer; contentType: string | null; filename: string | null }>{
  const url = `${baseUrl}${path}`;
  const fetchImpl = resolveFetch(url);
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: options.method ?? "GET",
      headers: buildAuthHeaders(options.token, options.hostToken),
    },
    options.timeoutMs ?? DEFAULT_ONMYAGENT_SERVER_TIMEOUT_MS,
  );

  if (!response.ok) {
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const jsonObject = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
    const code = typeof jsonObject?.code === "string" ? jsonObject.code : "request_failed";
    const message = typeof jsonObject?.message === "string" ? jsonObject.message : response.statusText;
    throw new OnMyAgentServerError(response.status, code, message, jsonObject?.details);
  }

  const contentType = response.headers.get("content-type");
  const disposition = response.headers.get("content-disposition") ?? "";
  const filenameMatch = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  const filenameRaw = filenameMatch?.[1] ?? filenameMatch?.[2] ?? null;
  const filename = filenameRaw ? decodeURIComponent(filenameRaw) : null;
  const data = await response.arrayBuffer();
  return { data, contentType, filename };
}

export async function requestStream(
  baseUrl: string,
  path: string,
  options: { token?: string; hostToken?: string; signal?: AbortSignal } = {},
): Promise<Response> {
  const url = `${baseUrl}${path}`;
  const fetchImpl = resolveFetch(url);
  const response = await fetchImpl(url, {
    method: "GET",
    headers: buildAuthHeaders(options.token, options.hostToken),
    signal: options.signal,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new OnMyAgentServerError(response.status, "request_failed", text || response.statusText);
  }
  return response;
}


export type OnMyAgentServerClientTimeouts = {
  health: number;
  capabilities: number;
  listWorkspaces: number;
  activateWorkspace: number;
  deleteWorkspace: number;
  deleteSession: number;
  sessionRead: number;
  status: number;
  config: number;
  workspaceExport: number;
  workspaceImport: number;
  binary: number;
};

export type OnMyAgentServerClientContext = {
  baseUrl: string;
  token?: string;
  hostToken?: string;
  timeouts: OnMyAgentServerClientTimeouts;
  requestOpenCodeRouter: <T>(
    workspaceId: string,
    path: string,
  ) => Promise<OnMyAgentOpenCodeRouterResponse<T>>;
  routerPath: (workspaceId: string, path: string) => string;
};
