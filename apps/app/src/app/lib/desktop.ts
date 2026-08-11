import { nativeDeepLinkEvent } from "./deep-link-bridge";
import { desktopCommandNames } from "@onmyagent/types/desktop-ipc-commands";
import type {
  DesktopCommandName,
  DesktopInvoke,
} from "@onmyagent/types/desktop-ipc";
import {
  invokeDesktopCommand,
  invokeElectronHelper,
  type DesktopCommandResultOf,
} from "./desktop-invoke";
import {
  classifyDesktopFetchDestination,
  DesktopFetchPolicyError,
} from "./desktop-fetch-policy";

export {
  classifyDesktopFetchDestination,
  DesktopFetchPolicyError,
  type DesktopFetchDecision,
  type DesktopFetchRoute,
} from "./desktop-fetch-policy";

export {
  invokeDesktopCommand,
  invokeElectronHelper,
} from "./desktop-invoke";
export type {
  DesktopCommandMap,
  DesktopCommandName,
  DesktopCommandArgsOf,
  DesktopCommandResultOf,
  DesktopInvoke,
} from "./desktop-invoke";

export type * from "./desktop-types";
export type {
  EngineInfo,
  OnMyAgentServerInfo,
  EngineDoctorResult,
  WorkspaceInfo,
  WorkspaceList,
  WorkspaceExportSummary,
  OpencodeCommandDraft,
  WorkspaceOnMyAgentConfig,
  AppBuildInfo,
  DesktopBootstrapConfig,
  OrchestratorDetachedHost,
  SandboxDoctorResult,
  OnMyAgentDockerCleanupResult,
  SandboxDebugProbeResult,
  ExecResult,
  CodeWorkspaceOpenTargetId,
  CodeWorkspaceOpenTargetsResult,
  CodeWorkspaceOpenResult,
  CodeWorkspaceEnvironmentSnapshot,
  CodeWorkspaceGitActionResult,
  CodeWorkspaceTerminal,
  CodeWorkspaceTerminalSnapshot,
  CodeWorkspaceFileContent,
  CodeWorkspaceFileEntry,
  LocalSkillCard,
  LocalSkillContent,
  OpencodeConfigFile,
  UpdaterEnvironment,
  CacheResetResult,
  SystemPermissionType,
  SystemPermissionStatus,
  SystemPermissionResult,
  BuiltinSkillCatalogResult,
  BuiltinSkillPackageInstallInput,
  BuiltinSkillPackageInstallResult,
  EnsureDefaultBuiltinSkillsResult,
  DesktopChannelEventHistoryEntry,
  ExpertMarketplaceName,
  ExpertPackageInstallInput,
  ExpertPackageInstallResult,
  ExpertPackageDeleteInput,
  ExpertPackageDeleteResult,
  ExpertPackageListEntry,
  ExpertRegistryListEntry,
  MyExpertPackageWriteInput,
} from "./desktop-types";
import type { OfficeCliProgress, OfficeCliStatus } from "@onmyagent/types/officecli";
import type {
  LarkCliAuthProgress,
  LarkCliConnectionStatus,
  LarkCliManualCredentialsInput,
  LarkCliStartUserLoginResult,
} from "@onmyagent/types/lark-cli-auth";
import type {
  TencentDocsAuthProgress,
  TencentDocsConnectionStatus,
  TencentDocsStartConnectResult,
} from "@onmyagent/types/tencent-docs-connector";
import type {
  BaiduDriveAuthProgress,
  BaiduDriveConnectionStatus,
  BaiduDriveStartConnectResult,
} from "@onmyagent/types/baidu-drive-connector";
import type {
  KdocsAuthProgress,
  KdocsConnectionStatus,
} from "@onmyagent/types/kdocs-connector";
import type {
  DingtalkAuthProgress,
  DingtalkConnectInput,
  DingtalkConnectionStatus,
} from "@onmyagent/types/dingtalk-connector";
import type {
  WecomAuthProgress,
  WecomConnectCredentialsInput,
  WecomConnectionStatus,
  WecomStartConnectResult,
} from "@onmyagent/types/wecom-connector";
import type {
  TencentMeetingAuthProgress,
  TencentMeetingConnectionStatus,
} from "@onmyagent/types/tencent-meeting-connector";

import type { WorkspaceList } from "./desktop-types";
import type {
  AgentManagementProviderActionInput,
  AgentManagementFetchModelsInput,
  AgentManagementTestModelInput,
  AgentManagementSkillActionInput,
  BuiltinSkillPackageInstallInput,
  ExpertMarketplaceName,
  ExpertPackageInstallInput,
  ExpertPackageInstallResult,
  ExpertPackageDeleteInput,
  ExpertPackageDeleteResult,
  MessagingChannelStatus,
  MyExpertKnowledgeStageInput,
  MyExpertPackageWriteInput,
  UserAgentRegistryWriteResult,
} from "./desktop-types";

// ---------------------------------------------------------------------------
// Electron bridge surface
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __ONMYAGENT_ZOOM_FACTOR__?: number;
    __ONMYAGENT_ELECTRON__?: {
      invokeDesktop?: DesktopInvoke;
      files?: {
        getPathForFile?: (file: File) => string | null;
      };
      computerUse?: {
        onActivity?: (callback: (activity: {
          phase: "inactive" | "ready" | "running" | "paused" | "errored";
          app?: string;
          reason?: string;
        }) => void) => () => void;
        onAppshot?: (callback: (appshot: {
          name: string;
          mimeType: string;
          data: string;
          appName?: string;
        }) => void) => () => void;
      };
      shell?: {
        openExternal?: (url: string) => Promise<void>;
        relaunch?: () => Promise<void>;
        quit?: () => Promise<void>;
      };
      system?: {
        getArchitectureInfo?: () => Promise<{
          appArch: string;
          appArchLabel: string;
          systemArch: string;
          systemArchLabel: string;
          mismatch: boolean;
          platform: "darwin" | "linux" | "windows";
          version: string;
          downloadUrl: string;
          releaseUrl: string;
        }>;
      };
      dev?: {
        openInEditor?: (request: {
          path: string;
          line?: number;
          column?: number;
        } | string) => Promise<{
          ok: boolean;
          path?: string;
          command?: string;
          args?: string[];
          reason?: string;
        }>;
      };
      softwareEnvironment?: {
        onProgress?: (
          callback: (progress: SoftwareEnvironmentProgress) => void,
        ) => () => void;
      };
      officeCli?: {
        onProgress?: (
          callback: (progress: OfficeCliProgress) => void,
        ) => () => void;
        onStatus?: (callback: (status: OfficeCliStatus) => void) => () => void;
      };
      larkCli?: {
        onProgress?: (
          callback: (progress: OfficeCliProgress) => void,
        ) => () => void;
        onStatus?: (callback: (status: OfficeCliStatus) => void) => () => void;
        onAuthProgress?: (
          callback: (progress: LarkCliAuthProgress) => void,
        ) => () => void;
      };
      tencentDocs?: {
        onStatus?: (
          callback: (status: TencentDocsConnectionStatus) => void,
        ) => () => void;
        onAuthProgress?: (
          callback: (progress: TencentDocsAuthProgress) => void,
        ) => () => void;
      };
      baiduDrive?: {
        onStatus?: (
          callback: (status: BaiduDriveConnectionStatus) => void,
        ) => () => void;
        onAuthProgress?: (
          callback: (progress: BaiduDriveAuthProgress) => void,
        ) => () => void;
      };
      kdocs?: {
        onStatus?: (
          callback: (status: KdocsConnectionStatus) => void,
        ) => () => void;
        onAuthProgress?: (
          callback: (progress: KdocsAuthProgress) => void,
        ) => () => void;
      };
      dingtalk?: {
        onStatus?: (
          callback: (status: DingtalkConnectionStatus) => void,
        ) => () => void;
        onAuthProgress?: (
          callback: (progress: DingtalkAuthProgress) => void,
        ) => () => void;
      };
      wecom?: {
        onStatus?: (
          callback: (status: WecomConnectionStatus) => void,
        ) => () => void;
        onAuthProgress?: (
          callback: (progress: WecomAuthProgress) => void,
        ) => () => void;
      };
      tencentMeeting?: {
        onStatus?: (
          callback: (status: TencentMeetingConnectionStatus) => void,
        ) => () => void;
        onAuthProgress?: (
          callback: (progress: TencentMeetingAuthProgress) => void,
        ) => () => void;
      };
      migration?: {
        readSnapshot?: () => Promise<unknown>;
        ackSnapshot?: () => Promise<{ ok: boolean; moved: boolean }>;
      };
      updater?: {
        getChannel?: () => Promise<{
          channel: "stable" | "alpha";
          feedUrl: string;
          currentVersion: string;
          alphaSupported?: boolean;
        }>;
        setChannel?: (channel: "stable" | "alpha") => Promise<{
          channel: "stable" | "alpha";
          feedUrl: string;
          currentVersion: string;
          alphaSupported?: boolean;
          requestedChannel?: "stable" | "alpha";
          reason?: string;
        }>;
        check?: (channel?: "stable" | "alpha") => Promise<{
          available: boolean;
          currentVersion?: string;
          latestVersion?: string | null;
          releaseDate?: string | null;
          releaseNotes?: unknown;
          channel?: "stable" | "alpha";
          feedUrl?: string;
          reason?: string;
          reasonCode?: string;
          soft?: boolean;
          releaseUrl?: string;
        }>;
        download?: () => Promise<{ ok: boolean; reason?: string }>;
        installAndRestart?: () => Promise<{ ok: boolean; reason?: string }>;
        getLastKnown?: () => Promise<{
          available: boolean;
          currentVersion?: string;
          latestVersion?: string | null;
          releaseDate?: string | null;
          releaseNotes?: unknown;
          reason?: string | null;
        }>;
        onAvailable?: (
          callback: (payload: {
            available: boolean;
            currentVersion?: string;
            latestVersion?: string | null;
            releaseDate?: string | null;
            releaseNotes?: unknown;
            reason?: string | null;
            releaseUrl?: string | null;
          }) => void,
        ) => () => void;
      };
      channels?: {
        onStatus?: (
          callback: (payload: { platformType: string; status: MessagingChannelStatus }) => void,
        ) => () => void;
        onPairing?: (callback: (payload: unknown) => void) => () => void;
        onUserAuthorized?: (callback: (payload: unknown) => void) => () => void;
      };
      browser?: {
        diagnostics?: () => Promise<{
          protocolVersion: number;
          inAppBrowser: boolean;
          rpcListening: boolean;
          backend: "in-app";
          platform: "darwin" | "linux" | "windows";
          openTabs: number;
          agentTabs: number;
        }>;
        show?: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
        hide?: () => Promise<void>;
        navigate?: (url: string, options?: { announcePanelOpen?: boolean }) => Promise<void>;
        back?: () => Promise<void>;
        forward?: () => Promise<void>;
        reload?: () => Promise<void>;
        setBounds?: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
        getState?: () => Promise<{
          url: string;
          title: string;
          canGoBack: boolean;
          canGoForward: boolean;
          isLoading: boolean;
          activeTabId?: string | null;
          tabs?: Array<{
            tabId: string;
            owner?: "user" | "agent" | "claimed";
            sessionId?: string | null;
            temporary?: boolean;
            deliverable?: boolean;
            handoff?: boolean;
            url: string;
            title: string;
            favicon?: string | null;
            canGoBack: boolean;
            canGoForward: boolean;
            isLoading: boolean;
            isActive: boolean;
          }>;
        } | null>;
        createTab?: (
          url?: string,
          options?: { sessionId?: string },
        ) => Promise<{ tabId: string; sessionId?: string | null }>;
        closeTab?: (tabId: string) => Promise<string | null>;
        closeAllTabs?: () => Promise<string[]>;
        selectTab?: (tabId: string) => Promise<string>;
        reorderTabs?: (tabIds: string[]) => Promise<Array<{
          tabId: string;
          owner?: "user" | "agent" | "claimed";
          sessionId?: string | null;
          temporary?: boolean;
          deliverable?: boolean;
          handoff?: boolean;
          url: string;
          title: string;
          favicon?: string | null;
          canGoBack: boolean;
          canGoForward: boolean;
          isLoading: boolean;
          isActive: boolean;
        }>>;
        listTabs?: () => Promise<Array<{
          tabId: string;
          url: string;
          title: string;
          favicon?: string | null;
          canGoBack: boolean;
          canGoForward: boolean;
          isLoading: boolean;
          isActive: boolean;
        }>>;
        showTabContextMenu?: (tabId: string, point?: { x: number; y: number }) => Promise<void>;
        destroy?: () => Promise<void>;
        onStateChange?: (callback: (state: {
          url: string;
          title: string;
          canGoBack: boolean;
          canGoForward: boolean;
          isLoading: boolean;
          activeTabId?: string | null;
          tabs?: Array<{
            tabId: string;
            owner?: "user" | "agent" | "claimed";
            sessionId?: string | null;
            temporary?: boolean;
            deliverable?: boolean;
            handoff?: boolean;
            url: string;
            title: string;
            favicon?: string | null;
            canGoBack: boolean;
            canGoForward: boolean;
            isLoading: boolean;
            isActive: boolean;
          }>;
        }) => void) => () => void;
        onPanelOpened?: (callback: () => void) => () => void;
        onPanelClosed?: (callback: () => void) => () => void;
      };
      artifactPreview?: {
        show?: (request: {
          filePath: string;
          bounds: { x: number; y: number; width: number; height: number };
          theme: "light" | "dark";
          locale: string;
        }) => Promise<{ ok: boolean; kind: "pdf" | "office" }>;
        openForEditing?: (request: { filePath: string }) => Promise<{ ok: boolean }>;
        hide?: () => Promise<void>;
        setBounds?: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
      };
      meta?: {
        initialDeepLinks?: string[];
        platform?: "darwin" | "linux" | "windows";
        version?: string;
      };
    };
    openInEditor?: (
      path: string,
      line?: number,
      column?: number,
    ) => Promise<{
      ok: boolean;
      path?: string;
      command?: string;
      args?: string[];
      reason?: string;
    }>;
  }
}

export type SoftwareEnvironmentProgress = {
  requestId: string;
  tool: string;
  progress: number;
  phase: string;
  message: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Pure utility — resolves the selected workspace ID from a workspace list
// payload, handling legacy fields.
export function resolveWorkspaceListSelectedId(
  list: Pick<WorkspaceList, "selectedId" | "activeId"> | null | undefined,
): string {
  return list?.selectedId?.trim() || list?.activeId?.trim() || "";
}

// ---------------------------------------------------------------------------
// Desktop bridge (Electron IPC proxy)
// ---------------------------------------------------------------------------

// All bridge methods are implemented via invokeDesktop IPC. The Proxy
// automatically maps property access to `invokeDesktop(propertyName, ...args)`.

type DesktopBridgeFn = (...args: unknown[]) => Promise<unknown>;

const electronBridge: Record<string, DesktopBridgeFn> = {};

export const desktopBridge = new Proxy(electronBridge, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;

    // resolveWorkspaceListSelectedId is a pure function, not an IPC call
    if (prop === "resolveWorkspaceListSelectedId") {
      return resolveWorkspaceListSelectedId;
    }

    const cached = target[prop];
    if (cached) return cached;

    const command = desktopCommandNames.find((candidate) => candidate === prop);
    if (!command) {
      throw new Error(`Electron desktop helper is not declared: ${prop}`);
    }
    const fn = (...args: unknown[]) => invokeElectronHelper(command, ...args);
    target[prop] = fn;
    return fn;
  },
});

export function subscribeSoftwareEnvironmentProgress(
  callback: (progress: SoftwareEnvironmentProgress) => void,
): () => void {
  return window.__ONMYAGENT_ELECTRON__?.softwareEnvironment?.onProgress?.(
    callback,
  ) ?? (() => {});
}

// ---------------------------------------------------------------------------
// desktopFetch — policy-gated: loopback direct, else main-process proxy
// ---------------------------------------------------------------------------

export const desktopFetch: typeof globalThis.fetch = (input, init) =>
  desktopFetchWithTimeout(input, init);

/** Preserve native cancellation for loopback and enforce a main-process deadline remotely. */
export async function desktopFetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs?: number,
): Promise<Response> {
  const decision = classifyDesktopFetchDestination(input);
  if (decision.route === "reject") {
    throw new DesktopFetchPolicyError(decision);
  }
  if (decision.route === "direct") {
    return globalThis.fetch(input, init);
  }
  return desktopFetchViaMain(input, init, timeoutMs);
}

export async function desktopFetchViaMain(input: RequestInfo | URL, init?: RequestInit, timeoutMs?: number): Promise<Response> {
  let url: string;
  let method: string | undefined;
  let headers: Record<string, string> | undefined;
  let body: string | undefined;

  if (typeof Request !== "undefined" && input instanceof Request) {
    url = input.url;
    method = init?.method ?? input.method;
    const headersSource = init?.headers ? new Headers(init.headers) : input.headers;
    headers = Object.fromEntries(headersSource.entries());
    if (typeof init?.body === "string") {
      body = init.body;
    } else if (input.body) {
      body = await input.clone().text();
    }
  } else {
    url = typeof input === "string" ? input : input.toString();
    method = init?.method;
    headers = init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : undefined;
    body = typeof init?.body === "string" ? init.body : undefined;
  }

  const requestId = crypto.randomUUID();
  const signal = init?.signal;
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Request cancelled.", "AbortError");
  }
  const cancel = () => {
    void invokeDesktopCommand("__fetchCancel", requestId).catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  let result: DesktopCommandResultOf<"__fetch">;
  try {
    result = await invokeDesktopCommand("__fetch", url, {
      method,
      headers,
      body,
      timeoutMs,
      requestId,
    });
  } finally {
    signal?.removeEventListener("abort", cancel);
  }

  const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
  const responseBody = NULL_BODY_STATUSES.has(result.status) ? null : result.body;

  return new Response(responseBody, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

export async function openDesktopUrl(url: string): Promise<void> {
  const openExternal = window.__ONMYAGENT_ELECTRON__?.shell?.openExternal;
  if (openExternal) {
    await openExternal(url);
    return;
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function openDesktopPath(target: string): Promise<void> {
  const result = await invokeDesktopCommand("__openPath", target);
  if (typeof result === "string" && result.trim()) {
    throw new Error(result);
  }
}

export type RevealDesktopItemResult = {
  ok: boolean;
  path?: string;
  reason?: string;
};

export async function revealDesktopItemInDir(target: string): Promise<RevealDesktopItemResult> {
  const trimmed = target.trim();
  if (!trimmed) {
    throw new Error("Path is required.");
  }
  const result = await invokeDesktopCommand("__revealItemInDir", trimmed);
  if (result && typeof result === "object" && "ok" in result) {
    if (!result.ok) {
      const message = result.reason === "not_found" && result.path
        ? `File not found: ${result.path}`
        : result.reason === "empty_path"
          ? "Path is required."
          : "Failed to reveal item in folder.";
      throw new Error(message);
    }
    return result;
  }
  // Older desktop bridges returned void after a fire-and-forget reveal.
  return { ok: true, path: trimmed, reason: "legacy_void" };
}

/** Reveal the first candidate path that exists; throws when every candidate fails. */
export async function revealDesktopItemCandidates(
  candidates: readonly string[],
): Promise<RevealDesktopItemResult> {
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    try {
      return await revealDesktopItemInDir(trimmed);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("Path is required.");
}

export async function relaunchDesktopApp(): Promise<void> {
  await window.__ONMYAGENT_ELECTRON__?.shell?.relaunch?.();
}

export async function openInEditor(
  target: string,
  line?: number,
  column?: number,
): Promise<{
  ok: boolean;
  path?: string;
  command?: string;
  args?: string[];
  reason?: string;
}> {
  const open = window.__ONMYAGENT_ELECTRON__?.dev?.openInEditor;
  if (!open) {
    return { ok: false, reason: "open-in-editor bridge is unavailable." };
  }
  return open({ path: target, line, column });
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "openInEditor", {
    configurable: true,
    value: openInEditor,
  });
}

export const getDesktopHomeDir = () => invokeDesktopCommand("__homeDir");

export const joinDesktopPath = (...parts: string[]) =>
  invokeDesktopCommand("__joinPath", ...parts);

/** Ensure awareness main dir + seed files; returns absolute path. */
export const ensureWorkMemoryAwarenessDir = () =>
  invokeDesktopCommand("workMemoryEnsureAwareness");

export const listWorkMemoryAwarenessFiles = () =>
  invokeDesktopCommand("workMemoryListFiles");

export const readWorkMemoryAwarenessFile = (name: string) =>
  invokeDesktopCommand("workMemoryReadFile", name);

export const writeWorkMemoryAwarenessFile = (input: {
  name: string;
  content: string;
}) => invokeDesktopCommand("workMemoryWriteFile", input);

/** Create/seed awareness pack and open it in Finder/Explorer (Qwen-style). */
export async function openWorkMemoryAwarenessFolder(): Promise<string> {
  const ensured = await ensureWorkMemoryAwarenessDir();
  const target = ensured?.path?.trim();
  if (!target) {
    throw new Error("Awareness directory path is empty.");
  }
  await openDesktopPath(target);
  return target;
}

export async function openWorkMemoryAwarenessFileInFolder(
  name: string,
): Promise<void> {
  const ensured = await ensureWorkMemoryAwarenessDir();
  const base = ensured?.path?.trim();
  if (!base) throw new Error("Awareness directory path is empty.");
  const homeSep = base.includes("\\") ? "\\" : "/";
  const full = `${base.replace(/[/\\]$/, "")}${homeSep}${name}`;
  await revealDesktopItemInDir(full);
}

export type {
  UserAgentRegistryFile,
  UserAgentRegistryWriteResult,
} from "@onmyagent/types/desktop-ipc";

export const readUserAgentRegistry = () =>
  invokeDesktopCommand("userAgentRegistryRead");

export async function writeUserAgentRegistry(
  content: string,
): Promise<UserAgentRegistryWriteResult> {
  return invokeDesktopCommand("userAgentRegistryWrite", { content });
}

export const setDesktopZoomFactor = (value: number) =>
  invokeDesktopCommand("__setZoomFactor", value);

export async function subscribeDesktopDeepLinks(
  handler: (urls: string[]) => void,
): Promise<() => void> {
  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<string[]>;
    if (Array.isArray(customEvent.detail)) {
      handler(customEvent.detail);
    }
  };
  window.addEventListener(nativeDeepLinkEvent, listener as EventListener);
  const initialUrls = window.__ONMYAGENT_ELECTRON__?.meta?.initialDeepLinks;
  if (Array.isArray(initialUrls) && initialUrls.length > 0) {
    handler(initialUrls);
  }
  return () => {
    window.removeEventListener(nativeDeepLinkEvent, listener as EventListener);
  };
}

// ---------------------------------------------------------------------------
// Re-export bridge methods as named functions (preserves existing import API)
// ---------------------------------------------------------------------------

const {
  engineStart,
  // workspace* re-exported from ./desktop-workspace
  opencodeCommandList,
  opencodeCommandWrite,
  opencodeCommandDelete,
  engineStop,
  engineRestart,
  appBuildInfo,
  getDesktopBootstrapConfig,
  setDesktopBootstrapConfig,
  nukeOpenworkAndOpencodeConfigAndExit: nukeOnMyAgentAndOpencodeConfigAndExit,
  orchestratorStartDetached,
  sandboxDoctor,
  sandboxStop,
  sandboxCleanupOpenworkContainers: sandboxCleanupOnMyAgentContainers,
  sandboxDebugProbe,
  onmyagentServerInfo,
  onmyagentServerRestart,
  runtimeBootstrap,
  engineInfo,
  engineDoctor,
  pickDirectory,
  pickFile,
  saveFile,
  engineInstall,
  importSkill,
  installSkillTemplate,
  listLocalSkills,
  onmyagentSkillsRoot,
  readLocalSkill,
  writeLocalSkill,
  uninstallSkill,
  updaterEnvironment,
  readOpencodeConfig,
  writeOpencodeConfig,
  resetOpenworkState: resetOnMyAgentState,
  resetOpencodeCache,
  opencodeMcpAuth,
  setWindowDecorations,
} = desktopBridge;

export const installExpertPackage = (input: ExpertPackageInstallInput) =>
  invokeDesktopCommand("installExpertPackage", input);

export const installBuiltinSkillPackage = (
  input: BuiltinSkillPackageInstallInput,
) => invokeDesktopCommand("installBuiltinSkillPackage", input);

export const listBuiltinSkillCatalog = () =>
  invokeDesktopCommand("listBuiltinSkillCatalog");

export const ensureDefaultBuiltinSkills = () =>
  invokeDesktopCommand("ensureDefaultBuiltinSkills");

export const onmyagentMarketplaceRoot = (marketplace: ExpertMarketplaceName) =>
  invokeDesktopCommand("onmyagentMarketplaceRoot", marketplace);

export const listExpertPackages = (marketplace: ExpertMarketplaceName) =>
  invokeDesktopCommand("listExpertPackages", marketplace);

export const listExpertRegistryRecords = (marketplace: ExpertMarketplaceName) =>
  invokeDesktopCommand("listExpertRegistryRecords", marketplace);

export const writeMyExpertPackage = (input: MyExpertPackageWriteInput) =>
  invokeDesktopCommand("writeMyExpertPackage", input);

export const deleteExpertPackage = (
  input: ExpertPackageDeleteInput,
): Promise<ExpertPackageDeleteResult> =>
  invokeDesktopCommand("deleteExpertPackage", input);

export const stageMyExpertKnowledge = (input: MyExpertKnowledgeStageInput) =>
  invokeDesktopCommand("stageMyExpertKnowledge", input);

export const getOfficeCliStatus = (options?: { forceRefresh?: boolean }) =>
  invokeDesktopCommand("officeCliGetStatus", options);

export const installOfficeCli = (): Promise<OfficeCliStatus> =>
  invokeDesktopCommand("officeCliInstallLatest");

export const uninstallOfficeCli = (): Promise<OfficeCliStatus> =>
  invokeDesktopCommand("officeCliUninstall");

export function subscribeOfficeCliProgress(
  callback: (progress: OfficeCliProgress) => void,
) {
  return window.__ONMYAGENT_ELECTRON__?.officeCli?.onProgress?.(callback) ?? (() => undefined);
}

export function subscribeOfficeCliStatus(
  callback: (status: OfficeCliStatus) => void,
) {
  return window.__ONMYAGENT_ELECTRON__?.officeCli?.onStatus?.(callback) ?? (() => undefined);
}

export const getLarkCliStatus = (options?: { forceRefresh?: boolean }) =>
  invokeDesktopCommand("larkCliGetStatus", options);

export const installLarkCli = (): Promise<OfficeCliStatus> =>
  invokeDesktopCommand("larkCliInstallLatest");

export const uninstallLarkCli = (): Promise<OfficeCliStatus> =>
  invokeDesktopCommand("larkCliUninstall");

export function subscribeLarkCliProgress(
  callback: (progress: OfficeCliProgress) => void,
) {
  return window.__ONMYAGENT_ELECTRON__?.larkCli?.onProgress?.(callback) ?? (() => undefined);
}

export function subscribeLarkCliStatus(
  callback: (status: OfficeCliStatus) => void,
) {
  return window.__ONMYAGENT_ELECTRON__?.larkCli?.onStatus?.(callback) ?? (() => undefined);
}

export const getLarkCliConnectionStatus = (): Promise<LarkCliConnectionStatus> =>
  invokeDesktopCommand("larkCliGetConnectionStatus");

export const getLarkCliRecommendedScopesJson = (): Promise<string> =>
  invokeDesktopCommand("larkCliGetRecommendedScopesJson");

export const submitLarkCliManualCredentials = (
  input: LarkCliManualCredentialsInput,
): Promise<LarkCliConnectionStatus> =>
  invokeDesktopCommand("larkCliSubmitManualCredentials", input);

export const startLarkCliUserLogin = (): Promise<LarkCliStartUserLoginResult> =>
  invokeDesktopCommand("larkCliStartUserLogin");

export const completeLarkCliUserLogin = (
  sessionId: string,
): Promise<LarkCliConnectionStatus> =>
  invokeDesktopCommand("larkCliCompleteUserLogin", { sessionId });

export const startLarkCliConfigInit = () =>
  invokeDesktopCommand("larkCliStartConfigInit");

export const cancelLarkCliConfigInit = () =>
  invokeDesktopCommand("larkCliCancelConfigInit");

export const disconnectLarkCli = (options?: {
  clearCredentials?: boolean;
}): Promise<LarkCliConnectionStatus> =>
  invokeDesktopCommand("larkCliDisconnect", options);

export function subscribeLarkCliAuthProgress(
  callback: (progress: LarkCliAuthProgress) => void,
) {
  return (
    window.__ONMYAGENT_ELECTRON__?.larkCli?.onAuthProgress?.(callback) ??
    (() => undefined)
  );
}

export const getTencentDocsStatus = (): Promise<TencentDocsConnectionStatus> =>
  invokeDesktopCommand("tencentDocsGetStatus");

export const startTencentDocsConnect =
  (): Promise<TencentDocsStartConnectResult> =>
    invokeDesktopCommand("tencentDocsStartConnect");

export const completeTencentDocsConnect = (
  sessionId: string,
): Promise<TencentDocsConnectionStatus> =>
  invokeDesktopCommand("tencentDocsCompleteConnect", { sessionId });

export const cancelTencentDocsConnect = (): Promise<{ ok: boolean }> =>
  invokeDesktopCommand("tencentDocsCancelConnect");

export const disconnectTencentDocs =
  (): Promise<TencentDocsConnectionStatus> =>
    invokeDesktopCommand("tencentDocsDisconnect");

export function subscribeTencentDocsStatus(
  callback: (status: TencentDocsConnectionStatus) => void,
) {
  return (
    window.__ONMYAGENT_ELECTRON__?.tencentDocs?.onStatus?.(callback) ??
    (() => undefined)
  );
}

export function subscribeTencentDocsAuthProgress(
  callback: (progress: TencentDocsAuthProgress) => void,
) {
  return (
    window.__ONMYAGENT_ELECTRON__?.tencentDocs?.onAuthProgress?.(callback) ??
    (() => undefined)
  );
}

export const getBaiduDriveStatus = (): Promise<BaiduDriveConnectionStatus> =>
  invokeDesktopCommand("baiduDriveGetStatus");

export const startBaiduDriveConnect =
  (): Promise<BaiduDriveStartConnectResult> =>
    invokeDesktopCommand("baiduDriveStartConnect");

export const completeBaiduDriveConnect = (
  sessionId: string,
): Promise<BaiduDriveConnectionStatus> =>
  invokeDesktopCommand("baiduDriveCompleteConnect", { sessionId });

export const cancelBaiduDriveConnect = (): Promise<{ ok: boolean }> =>
  invokeDesktopCommand("baiduDriveCancelConnect");

export const disconnectBaiduDrive =
  (): Promise<BaiduDriveConnectionStatus> =>
    invokeDesktopCommand("baiduDriveDisconnect");

export const connectBaiduDriveWithToken = (input: {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}): Promise<BaiduDriveConnectionStatus> =>
  invokeDesktopCommand("baiduDriveConnectWithToken", input);

export function subscribeBaiduDriveStatus(
  callback: (status: BaiduDriveConnectionStatus) => void,
) {
  return (
    window.__ONMYAGENT_ELECTRON__?.baiduDrive?.onStatus?.(callback) ??
    (() => undefined)
  );
}

export function subscribeBaiduDriveAuthProgress(
  callback: (progress: BaiduDriveAuthProgress) => void,
) {
  return (
    window.__ONMYAGENT_ELECTRON__?.baiduDrive?.onAuthProgress?.(callback) ??
    (() => undefined)
  );
}

export const getKdocsStatus = (): Promise<KdocsConnectionStatus> =>
  invokeDesktopCommand("kdocsGetStatus");

export const connectKdocsWithToken = (input: {
  accessToken: string;
}): Promise<KdocsConnectionStatus> =>
  invokeDesktopCommand("kdocsConnectWithToken", input);

export const disconnectKdocs = (): Promise<KdocsConnectionStatus> =>
  invokeDesktopCommand("kdocsDisconnect");

export function subscribeKdocsStatus(
  callback: (status: KdocsConnectionStatus) => void,
) {
  return (
    window.__ONMYAGENT_ELECTRON__?.kdocs?.onStatus?.(callback) ??
    (() => undefined)
  );
}

export function subscribeKdocsAuthProgress(
  callback: (progress: KdocsAuthProgress) => void,
) {
  return (
    window.__ONMYAGENT_ELECTRON__?.kdocs?.onAuthProgress?.(callback) ??
    (() => undefined)
  );
}

export const getDingtalkStatus = (): Promise<DingtalkConnectionStatus> =>
  invokeDesktopCommand("dingtalkGetStatus");

export const connectDingtalkWithCredentials = (
  input: DingtalkConnectInput,
): Promise<DingtalkConnectionStatus> =>
  invokeDesktopCommand("dingtalkConnectWithCredentials", input);

export const disconnectDingtalk = (): Promise<DingtalkConnectionStatus> =>
  invokeDesktopCommand("dingtalkDisconnect");

export function subscribeDingtalkStatus(
  callback: (status: DingtalkConnectionStatus) => void,
) {
  return (
    window.__ONMYAGENT_ELECTRON__?.dingtalk?.onStatus?.(callback) ??
    (() => undefined)
  );
}

export function subscribeDingtalkAuthProgress(
  callback: (progress: DingtalkAuthProgress) => void,
) {
  return (
    window.__ONMYAGENT_ELECTRON__?.dingtalk?.onAuthProgress?.(callback) ??
    (() => undefined)
  );
}

export const getWecomStatus = (): Promise<WecomConnectionStatus> =>
  invokeDesktopCommand("wecomGetStatus");

export const startWecomConnect = (): Promise<WecomStartConnectResult> =>
  invokeDesktopCommand("wecomStartConnect");

export const completeWecomConnect = (
  sessionId: string,
): Promise<WecomConnectionStatus> =>
  invokeDesktopCommand("wecomCompleteConnect", { sessionId });

export const cancelWecomConnect = (): Promise<{ ok: boolean }> =>
  invokeDesktopCommand("wecomCancelConnect");

export const connectWecomWithCredentials = (
  input: WecomConnectCredentialsInput,
): Promise<WecomConnectionStatus> =>
  invokeDesktopCommand("wecomConnectWithCredentials", input);

export const disconnectWecom = (): Promise<WecomConnectionStatus> =>
  invokeDesktopCommand("wecomDisconnect");

export function subscribeWecomStatus(
  callback: (status: WecomConnectionStatus) => void,
) {
  return (
    window.__ONMYAGENT_ELECTRON__?.wecom?.onStatus?.(callback) ??
    (() => undefined)
  );
}

export function subscribeWecomAuthProgress(
  callback: (progress: WecomAuthProgress) => void,
) {
  return (
    window.__ONMYAGENT_ELECTRON__?.wecom?.onAuthProgress?.(callback) ??
    (() => undefined)
  );
}

export const getTencentMeetingStatus =
  (): Promise<TencentMeetingConnectionStatus> =>
    invokeDesktopCommand("tencentMeetingGetStatus");

export const connectTencentMeetingWithToken = (input: {
  accessToken: string;
}): Promise<TencentMeetingConnectionStatus> =>
  invokeDesktopCommand("tencentMeetingConnectWithToken", input);

export const openTencentMeetingTokenPage = (): Promise<{
  ok: boolean;
  url: string;
}> => invokeDesktopCommand("tencentMeetingOpenTokenPage");

export const disconnectTencentMeeting =
  (): Promise<TencentMeetingConnectionStatus> =>
    invokeDesktopCommand("tencentMeetingDisconnect");

export function subscribeTencentMeetingStatus(
  callback: (status: TencentMeetingConnectionStatus) => void,
) {
  return (
    window.__ONMYAGENT_ELECTRON__?.tencentMeeting?.onStatus?.(callback) ??
    (() => undefined)
  );
}

export function subscribeTencentMeetingAuthProgress(
  callback: (progress: TencentMeetingAuthProgress) => void,
) {
  return (
    window.__ONMYAGENT_ELECTRON__?.tencentMeeting?.onAuthProgress?.(
      callback,
    ) ?? (() => undefined)
  );
}

// ---------------------------------------------------------------------------
// Domain wrapper modules (stable public API re-exports)
// ---------------------------------------------------------------------------

export {
  listCodeWorkspaceOpenTargets,
  openCodeWorkspaceTarget,
  getCodeWorkspaceEnvironment,
  switchCodeWorkspaceBranch,
  commitCodeWorkspaceChanges,
  pushCodeWorkspaceChanges,
  createCodeWorkspaceTerminal,
  writeCodeWorkspaceTerminal,
  resizeCodeWorkspaceTerminal,
  getCodeWorkspaceTerminalSnapshot,
  closeCodeWorkspaceTerminal,
  listCodeWorkspaceFiles,
  readCodeWorkspaceFile,
  readCodeWorkspaceBinaryFile,
  workspaceBootstrap,
  workspaceSetSelected,
  workspaceSetRuntimeActive,
  workspaceCreate,
  workspaceCreateRemote,
  workspaceUpdateRemote,
  workspaceUpdateDisplayName,
  workspaceForget,
  workspaceAddAuthorizedRoot,
  workspaceExportConfig,
  workspaceImportConfig,
  workspaceOnMyAgentWrite,
  workspaceOnMyAgentRead,
} from "./desktop-workspace";

export {
  personalLocalAgentsList,
  personalLocalAgentMetadataList,
  personalLocalAgentAcpAgentsList,
  personalLocalAgentAcpAgentsRefresh,
  personalLocalAgentAcpHealth,
  localAgentComposerListFiles,
  localAgentComposerSaveAttachment,
  personalLocalAgentAcpSend,
  personalLocalAgentAcpCancel,
  personalLocalAgentAcpResolveApproval,
  personalLocalAgentAcpConfigOptions,
  personalLocalAgentSetAcpConfigOption,
  personalLocalAgentCreateCustomAgent,
  personalLocalAgentUpdateCustomAgent,
  personalLocalAgentDeleteCustomAgent,
  personalLocalAgentDetectAvailableAgents,
  personalLocalAgentListExtensions,
  personalLocalAgentSetExtensionEnabled,
  personalLocalAgentGetAgentOverrides,
  personalLocalAgentSetAgentOverrides,
  personalLocalAgentAcpProcessesList,
  personalLocalAgentTestConnection,
  personalLocalAgentTestCustomAgent,
  personalLocalAgentCheckProviderHealth,
  personalLocalAgentCheckManagedAgentHealthById,
  personalLocalAgentValidate,
  personalLocalAgentStart,
  personalLocalAgentStatus,
  personalLocalAgentRun,
  personalLocalAgentCancel,
  personalLocalAgentResolveApproval,
  personalLocalAgentResetConversation,
  personalLocalAgentConversationsList,
  personalLocalAgentConversationCreate,
  personalLocalAgentConversationGet,
  personalLocalAgentConversationGetById,
  personalLocalAgentChannelConversationsList,
  personalLocalAgentConversationsListByProvider,
  personalLocalAgentConversationImportFromArchive,
  personalLocalAgentConversationStatus,
  personalLocalAgentConversationWarmup,
  personalLocalAgentProviderSessionsList,
  personalLocalAgentProviderSessionLoad,
  personalLocalAgentProviderSessionClose,
  personalLocalAgentProviderSessionFork,
  personalLocalAgentConversationConfirmationsList,
  personalLocalAgentHostStatus,
  personalLocalAgentConversationConfirmationConfirm,
  personalLocalAgentNativeSessionsList,
  personalLocalAgentConversationTranscript,
  personalLocalAgentHeartbeatsList,
  personalLocalAgentHeartbeatCreate,
  personalLocalAgentHeartbeatUpdate,
  personalLocalAgentHeartbeatDelete,
  personalLocalAgentHeartbeatRunNow,
  personalLocalAgentHeartbeatRuns,
} from "./desktop-local-agents";

export type { LocalAgentComposerFileEntry } from "./desktop-local-agents";
export type {
  PersonalLocalAgentTestConnectionResult,
  PersonalLocalAgentProviderHealthResult,
  PersonalLocalAgentTestCustomAgentResult,
} from "./desktop-local-agents";

export {
  weixinLoginStart,
  weixinLoginPoll,
  weixinSaveAccount,
  weixinAccountStatus,
  weixinStart,
  weixinAutoStart,
  weixinStop,
  weixinStatus,
  weixinSimulateInbound,
  weixinProbeAccessibleRoot,
  feishuSaveAccount,
  feishuAccountStatus,
  feishuStart,
  feishuAutoStart,
  feishuStop,
  feishuStatus,
  feishuSimulateInbound,
  feishuProbeAccessibleRoot,
  telegramSaveAccount,
  telegramAccountStatus,
  telegramStart,
  telegramAutoStart,
  telegramStop,
  telegramStatus,
  telegramSimulateInbound,
  discordSaveAccount,
  discordAccountStatus,
  discordStart,
  discordAutoStart,
  discordStop,
  discordStatus,
  discordSimulateInbound,
  channelTestPlugin,
  testChannelConnection,
  onChannelStatus,
  onChannelPairing,
  onChannelUserAuthorized,
  channelGetPendingPairingRequests,
  channelApprovePairing,
  channelDenyPairing,
  channelGetAuthorizedUsers,
  channelIsUserAuthorized,
  channelRevokeUserAuthorization,
  channelGetOrCreateSession,
  channelGetSession,
  channelGetSessionsByPlatform,
  channelGetSessionsByUser,
  channelCloseSession,
  channelUpdateSessionMetadata,
  channelGetEventHistory,
} from "./desktop-messaging";

export type {
  ChannelPairingRequest,
  ChannelAuthorizedUser,
  ChannelSession,
} from "./desktop-messaging";

export const agentManagementSnapshot = (
  input: import("./desktop-types").AgentManagementSnapshotInput,
) => invokeDesktopCommand("agentManagementSnapshot", input);

export const agentManagementProviderAction = (
  input: AgentManagementProviderActionInput,
) => invokeDesktopCommand("agentManagementProviderAction", input);

export const agentManagementFetchModels = (
  input: AgentManagementFetchModelsInput,
) => invokeDesktopCommand("agentManagementFetchModels", input);

export const agentManagementTestModel = (
  input: AgentManagementTestModelInput,
) => invokeDesktopCommand("agentManagementTestModel", input);

export const agentManagementSkillAction = (
  input: AgentManagementSkillActionInput,
) => invokeDesktopCommand("agentManagementSkillAction", input);

export {
  engineStart,
  opencodeCommandList,
  opencodeCommandWrite,
  opencodeCommandDelete,
  engineStop,
  engineRestart,
  appBuildInfo,
  getDesktopBootstrapConfig,
  setDesktopBootstrapConfig,
  nukeOnMyAgentAndOpencodeConfigAndExit,
  orchestratorStartDetached,
  sandboxDoctor,
  sandboxStop,
  sandboxCleanupOnMyAgentContainers,
  sandboxDebugProbe,
  onmyagentServerInfo,
  onmyagentServerRestart,
  runtimeBootstrap,
  engineInfo,
  engineDoctor,
  pickDirectory,
  pickFile,
  saveFile,
  engineInstall,
  importSkill,
  installSkillTemplate,
  listLocalSkills,
  onmyagentSkillsRoot,
  readLocalSkill,
  writeLocalSkill,
  uninstallSkill,
  updaterEnvironment,
  readOpencodeConfig,
  writeOpencodeConfig,
  resetOnMyAgentState,
  resetOpencodeCache,
  opencodeMcpAuth,
  setWindowDecorations,
};
