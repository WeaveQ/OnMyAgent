import { nativeDeepLinkEvent } from "./deep-link-bridge";
import { desktopCommandNames } from "@onmyagent/types/desktop-ipc-commands";
import type {
  DesktopCommandName,
  DesktopInvoke,
} from "@onmyagent/types/desktop-ipc";
import {
  invokeDesktopCommand,
  invokeElectronHelper,
} from "./desktop-invoke";

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
  BuiltinSkillPackageInstallInput,
  BuiltinSkillPackageInstallResult,
  ChannelProbeResult,
  DesktopChannelAuthorizedUser,
  DesktopChannelEventHistoryEntry,
  DesktopChannelPairingRequest,
  DesktopChannelSession,
  ExpertMarketplaceName,
  ExpertPackageInstallInput,
  ExpertPackageInstallResult,
  ExpertPackageListEntry,
  ExpertRegistryListEntry,
  MyExpertPackageWriteInput,
} from "./desktop-types";

import type { WorkspaceList } from "./desktop-types";
import type { CodeWorkspaceOpenTargetId } from "@onmyagent/types";
import type {
  AgentManagementProviderActionInput,
  AgentManagementFetchModelsInput,
  AgentManagementMcpActionInput,
  AgentManagementSkillActionInput,
  PersonalLocalAgent,
  PersonalLocalAgentAcpConfigOptionInput,
  PersonalLocalAgentApprovalDecision,
  PersonalLocalAgentApprovalMode,
  PersonalLocalAgentApprovalInput,
  PersonalLocalAgentCustomAgentInput,
  PersonalLocalAgentConversationImportInput,
  PersonalLocalAgentConversationInput,
  PersonalLocalAgentConversationTranscriptInput,
  PersonalLocalAgentHostStatusInput,
  PersonalLocalAgentHeartbeatCreateInput,
  PersonalLocalAgentHeartbeatDeleteInput,
  PersonalLocalAgentHeartbeatRunNowInput,
  PersonalLocalAgentHeartbeatRunsInput,
  PersonalLocalAgentHeartbeatsListInput,
  PersonalLocalAgentHeartbeatUpdateInput,
  PersonalLocalAgentResetConversationInput,
  PersonalLocalAgentRunInput,
  BuiltinSkillPackageInstallInput,
  ChannelProbeResult,
  DesktopChannelAuthorizedUser,
  DesktopChannelPairingRequest,
  DesktopChannelSession,
  ExpertMarketplaceName,
  ExpertPackageInstallInput,
  ExpertPackageInstallResult,
  MyExpertPackageWriteInput,
  FeishuAccountStatusInput,
  FeishuSaveAccountInput,
  FeishuServiceStartInput,
  FeishuSimulateInboundInput,
  DiscordAccountStatusInput,
  DiscordSaveAccountInput,
  DiscordServiceStartInput,
  DiscordSimulateInboundInput,
  MessagingChannelStatus,
  TelegramAccountStatusInput,
  TelegramSaveAccountInput,
  TelegramServiceStartInput,
  TelegramSimulateInboundInput,
  WeixinAccountStatusInput,
  WeixinLoginPollInput,
  WeixinLoginStartInput,
  WeixinSaveAccountInput,
  WeixinServiceStartInput,
  WeixinSimulateInboundInput,
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
        createTab?: (url?: string) => Promise<{ tabId: string }>;
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
// desktopFetch — proxies non-loopback requests through Electron main process
// ---------------------------------------------------------------------------

function isLoopbackUrl(input: RequestInfo | URL): boolean {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    const url = new URL(raw);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  } catch {
    return false;
  }
}

export const desktopFetch: typeof globalThis.fetch = async (input, init) => {
  if (isLoopbackUrl(input)) {
    return globalThis.fetch(input, init);
  }

  // Extract method/headers/body from either a Request object or the (input, init)
  // pair. The OpenCode SDK calls fetch(request) (no init), so reading these only
  // from `init` would silently drop the Authorization header and the POST body
  // — the remote would then reject every request with "Invalid bearer token".
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
      // Request body is a stream — buffer to text so it survives the IPC hop
      // to the Electron main process.
      body = await input.clone().text();
    }
  } else {
    url = typeof input === "string" ? input : input.toString();
    method = init?.method;
    headers = init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : undefined;
    body = typeof init?.body === "string" ? init.body : undefined;
  }

  const result = await invokeDesktopCommand("__fetch", url, {
    method,
    headers,
    body,
  });

  // Response constructor rejects bodies for null-body status codes, so we
  // must pass null instead of an empty string for those.
  const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
  const responseBody = NULL_BODY_STATUSES.has(result.status) ? null : result.body;

  return new Response(responseBody, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
};

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

  const result = await invokeDesktopCommand("__fetch", url, {
    method,
    headers,
    body,
    timeoutMs,
  });

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

export async function revealDesktopItemInDir(target: string): Promise<void> {
  await invokeDesktopCommand("__revealItemInDir", target);
}

export const listCodeWorkspaceOpenTargets = () =>
  invokeDesktopCommand("codeWorkspaceOpenTargets");

export const openCodeWorkspaceTarget = (input: {
  targetId: CodeWorkspaceOpenTargetId;
  workspacePath: string;
}) => invokeDesktopCommand("codeWorkspaceOpen", input);

export const getCodeWorkspaceEnvironment = (
  input: {
    workspacePath?: string | null;
    sessionId?: string | null;
  } = {},
) => invokeDesktopCommand("codeWorkspaceEnvironment", input);

export const switchCodeWorkspaceBranch = (input: {
  workspacePath: string;
  sessionId: string;
  branch: string;
}) => invokeDesktopCommand("codeWorkspaceGitSwitchBranch", input);

export const commitCodeWorkspaceChanges = (input: {
  workspacePath: string;
  sessionId: string;
  message: string;
  push: boolean;
}) => invokeDesktopCommand("codeWorkspaceGitCommit", input);

export const pushCodeWorkspaceChanges = (input: {
  workspacePath: string;
  sessionId: string;
}) => invokeDesktopCommand("codeWorkspaceGitPush", input);

export const createCodeWorkspaceTerminal = (input: {
  workspacePath?: string | null;
}) => invokeDesktopCommand("codeWorkspaceTerminalCreate", input);

export const writeCodeWorkspaceTerminal = (input: {
  terminalId: string;
  data: string;
}) => invokeDesktopCommand("codeWorkspaceTerminalWrite", input);

export const resizeCodeWorkspaceTerminal = (input: {
  terminalId: string;
  cols: number;
  rows: number;
}) => invokeDesktopCommand("codeWorkspaceTerminalResize", input);

export const getCodeWorkspaceTerminalSnapshot = (input: {
  terminalId: string;
}) => invokeDesktopCommand("codeWorkspaceTerminalSnapshot", input);

export const closeCodeWorkspaceTerminal = (input: { terminalId: string }) =>
  invokeDesktopCommand("codeWorkspaceTerminalClose", input);

export const listCodeWorkspaceFiles = (input: {
  workspacePath: string;
  relativePath?: string;
}) => invokeDesktopCommand("codeWorkspaceFilesList", input);

export const readCodeWorkspaceFile = (input: {
  workspacePath: string;
  relativePath: string;
}) => invokeDesktopCommand("codeWorkspaceFileRead", input);

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
  // IPC channel names remain Openwork* (desktop main process); alias to OnMyAgent* for app API.
  workspaceOpenworkWrite: workspaceOnMyAgentWrite,
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

export const onmyagentMarketplaceRoot = (marketplace: ExpertMarketplaceName) =>
  invokeDesktopCommand("onmyagentMarketplaceRoot", marketplace);

export const listExpertPackages = (marketplace: ExpertMarketplaceName) =>
  invokeDesktopCommand("listExpertPackages", marketplace);

export const listExpertRegistryRecords = (marketplace: ExpertMarketplaceName) =>
  invokeDesktopCommand("listExpertRegistryRecords", marketplace);

export const writeMyExpertPackage = (input: MyExpertPackageWriteInput) =>
  invokeDesktopCommand("writeMyExpertPackage", input);

export const personalLocalAgentsList = (input?: {
  agents?: Array<Partial<PersonalLocalAgent>>;
  workspaceRoot?: string;
  includeModels?: boolean;
}) => invokeDesktopCommand("personalLocalAgentsList", input ?? {});

export const personalLocalAgentMetadataList = (input?: {
  agents?: Array<Partial<PersonalLocalAgent>>;
  workspaceRoot?: string;
  includeModels?: boolean;
}) => invokeDesktopCommand("personalLocalAgentMetadataList", input ?? {});

export const personalLocalAgentAcpAgentsList = (input?: {
  agents?: Array<Partial<PersonalLocalAgent>>;
  workspaceRoot?: string;
  includeModels?: boolean;
}) => invokeDesktopCommand("personalLocalAgentAcpAgentsList", input ?? {});

export const personalLocalAgentAcpAgentsRefresh = (input?: {
  agents?: Array<Partial<PersonalLocalAgent>>;
  workspaceRoot?: string;
  includeModels?: boolean;
}) => invokeDesktopCommand("personalLocalAgentAcpAgentsRefresh", input ?? {});

export const personalLocalAgentAcpHealth = (input?: {
  agents?: Array<Partial<PersonalLocalAgent>>;
  workspaceRoot?: string;
}) => invokeDesktopCommand("personalLocalAgentAcpHealth", input ?? {});

export type { LocalAgentComposerFileEntry } from "./desktop-types";

export const localAgentComposerListFiles = (input: {
  workspaceRoot: string;
  query?: string;
  limit?: number;
}) => invokeDesktopCommand("localAgentComposerListFiles", input);

export const localAgentComposerSaveAttachment = (input: {
  workspaceRoot: string;
  name: string;
  dataUrl: string;
}) => invokeDesktopCommand("localAgentComposerSaveAttachment", input);

export const personalLocalAgentAcpSend = (input: PersonalLocalAgentRunInput) =>
  invokeDesktopCommand("personalLocalAgentAcpSend", input);

export const personalLocalAgentAcpCancel = (runId: string) =>
  invokeDesktopCommand("personalLocalAgentAcpCancel", runId);

export const personalLocalAgentAcpResolveApproval = (
  input: PersonalLocalAgentApprovalInput,
) => invokeDesktopCommand("personalLocalAgentAcpResolveApproval", input);

export const personalLocalAgentAcpConfigOptions = (input?: {
  agent?: Partial<PersonalLocalAgent>;
  workspaceRoot?: string;
}) => invokeDesktopCommand("personalLocalAgentAcpConfigOptions", input ?? {});

export const personalLocalAgentSetAcpConfigOption = (
  input: PersonalLocalAgentAcpConfigOptionInput,
) => invokeDesktopCommand("personalLocalAgentSetAcpConfigOption", input);

export const personalLocalAgentCreateCustomAgent = (
  input: PersonalLocalAgentCustomAgentInput,
) => invokeDesktopCommand("personalLocalAgentCreateCustomAgent", input);

export const personalLocalAgentUpdateCustomAgent = (
  input: PersonalLocalAgentCustomAgentInput,
) => invokeDesktopCommand("personalLocalAgentUpdateCustomAgent", input);

export const personalLocalAgentDeleteCustomAgent = (input: {
  workspaceRoot: string;
  id: string;
}) => invokeDesktopCommand("personalLocalAgentDeleteCustomAgent", input);

export const personalLocalAgentDetectAvailableAgents = (input: {
  workspaceRoot: string;
  existingIds?: string[];
}) => invokeDesktopCommand("personalLocalAgentDetectAvailableAgents", input);

export const personalLocalAgentListExtensions = () =>
  invokeDesktopCommand("personalLocalAgentExtensionsList", {});

export const personalLocalAgentSetExtensionEnabled = (input: {
  name: string;
  enabled: boolean;
}) => invokeDesktopCommand("personalLocalAgentExtensionSetEnabled", input);

export const personalLocalAgentGetAgentOverrides = (input: {
  workspaceRoot: string;
  id: string;
}) => invokeDesktopCommand("personalLocalAgentGetAgentOverrides", input);

export const personalLocalAgentSetAgentOverrides = (input: {
  workspaceRoot: string;
  id: string;
  overrides: Record<string, unknown>;
}) => invokeDesktopCommand("personalLocalAgentSetAgentOverrides", input);

export const personalLocalAgentAcpProcessesList = (input?: {
  workspaceRoot?: string;
  provider?: string;
  conversationId?: string;
}) => invokeDesktopCommand("personalLocalAgentAcpProcessesList", input ?? {});

export type {
  PersonalLocalAgentTestConnectionResult,
  PersonalLocalAgentProviderHealthResult,
  PersonalLocalAgentTestCustomAgentResult,
} from "./desktop-types";

export const personalLocalAgentTestConnection = (input: {
  agent: Partial<PersonalLocalAgent>;
  workspaceRoot?: string;
  timeoutMs?: number;
}) => invokeDesktopCommand("personalLocalAgentTestConnection", input);

export const personalLocalAgentTestCustomAgent = (input: {
  command: string;
  acpArgs?: string[];
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}) => invokeDesktopCommand("personalLocalAgentTestCustomAgent", input);

export const personalLocalAgentCheckProviderHealth = (input: {
  agent: Partial<PersonalLocalAgent>;
  workspaceRoot?: string;
  timeoutMs?: number;
}) => invokeDesktopCommand("personalLocalAgentCheckProviderHealth", input);

export const personalLocalAgentCheckManagedAgentHealthById = (input: {
  id?: string;
  agentId?: string;
  provider?: string;
  workspaceRoot?: string;
  timeoutMs?: number;
}) => invokeDesktopCommand("personalLocalAgentCheckManagedAgentHealthById", input);

export const personalLocalAgentValidate = (agent: Partial<PersonalLocalAgent>) =>
  invokeDesktopCommand("personalLocalAgentValidate", agent);

export const personalLocalAgentStart = (input: PersonalLocalAgentRunInput) =>
  invokeDesktopCommand("personalLocalAgentStart", input);

export const personalLocalAgentStatus = (
  input: string | { runId: string; workspaceRoot?: string },
) => invokeDesktopCommand("personalLocalAgentStatus", input);

export const personalLocalAgentRun = (input: PersonalLocalAgentRunInput) =>
  invokeDesktopCommand("personalLocalAgentRun", input);

export const personalLocalAgentCancel = (runId: string) =>
  invokeDesktopCommand("personalLocalAgentCancel", runId);

export const personalLocalAgentResolveApproval = (
  input: PersonalLocalAgentApprovalInput,
) => invokeDesktopCommand("personalLocalAgentResolveApproval", input);

export const personalLocalAgentResetConversation = (
  input: PersonalLocalAgentResetConversationInput,
) => invokeDesktopCommand("personalLocalAgentResetConversation", input);

export const personalLocalAgentConversationsList = (
  input: PersonalLocalAgentConversationInput,
) => invokeDesktopCommand("personalLocalAgentConversationsList", input);

export const personalLocalAgentConversationCreate = (
  input: PersonalLocalAgentConversationInput,
) => invokeDesktopCommand("personalLocalAgentConversationCreate", input);

export const personalLocalAgentConversationGet = (
  input: PersonalLocalAgentConversationInput,
) => invokeDesktopCommand("personalLocalAgentConversationGet", input);

export const personalLocalAgentConversationGetById = (input: {
  workspaceRoot: string;
  conversationId: string;
}) => invokeDesktopCommand("personalLocalAgentConversationGetById", input);

export const personalLocalAgentChannelConversationsList = (input: {
  workspaceRoot: string;
}) => invokeDesktopCommand("personalLocalAgentChannelConversationsList", input);

export const personalLocalAgentConversationsListByProvider = (
  input: PersonalLocalAgentConversationInput,
) => invokeDesktopCommand("personalLocalAgentConversationsListByProvider", input);

export const personalLocalAgentConversationImportFromArchive = (
  input: PersonalLocalAgentConversationImportInput,
) => invokeDesktopCommand("personalLocalAgentConversationImportFromArchive", input);

export const personalLocalAgentConversationStatus = (
  input: PersonalLocalAgentConversationInput & { conversationId?: string | null },
) => invokeDesktopCommand("personalLocalAgentConversationStatus", input);

export const personalLocalAgentConversationWarmup = (
  input: PersonalLocalAgentConversationInput & {
    conversationId?: string | null;
    approvalMode?: PersonalLocalAgentApprovalMode;
    model?: string | null;
  },
) => invokeDesktopCommand("personalLocalAgentConversationWarmup", input);

export const personalLocalAgentProviderSessionsList = (
  input: PersonalLocalAgentConversationInput,
) => invokeDesktopCommand("personalLocalAgentProviderSessionsList", input);

export const personalLocalAgentProviderSessionLoad = (
  input: PersonalLocalAgentConversationInput & { sessionId: string; title?: string },
) => invokeDesktopCommand("personalLocalAgentProviderSessionLoad", input);

export const personalLocalAgentProviderSessionClose = (
  input: PersonalLocalAgentConversationInput & {
    conversationId?: string | null;
    sessionId: string;
  },
) => invokeDesktopCommand("personalLocalAgentProviderSessionClose", input);

export const personalLocalAgentProviderSessionFork = (
  input: PersonalLocalAgentConversationInput & {
    sessionId: string;
    title?: string;
    messageId?: string;
  },
) => invokeDesktopCommand("personalLocalAgentProviderSessionFork", input);

export const personalLocalAgentConversationConfirmationsList = (
  input: PersonalLocalAgentConversationInput,
) => invokeDesktopCommand("personalLocalAgentConversationConfirmationsList", input);

export const personalLocalAgentHostStatus = (
  input: PersonalLocalAgentHostStatusInput,
) => invokeDesktopCommand("personalLocalAgentHostStatus", input);

export const personalLocalAgentConversationConfirmationConfirm = (
  input: PersonalLocalAgentConversationInput & {
    runId?: string | null;
    approvalId?: string | null;
    id?: string | null;
    decision: PersonalLocalAgentApprovalDecision;
    alwaysAllow?: boolean;
  },
) => invokeDesktopCommand("personalLocalAgentConversationConfirmationConfirm", input);

export const personalLocalAgentNativeSessionsList = (input: {
  workspaceRoot: string;
  limit?: number;
  agent?: Partial<PersonalLocalAgent>;
}) => invokeDesktopCommand("personalLocalAgentNativeSessionsList", input);

export const personalLocalAgentConversationTranscript = (
  input: PersonalLocalAgentConversationTranscriptInput,
) => invokeDesktopCommand("personalLocalAgentConversationTranscript", input);

export const personalLocalAgentHeartbeatsList = (
  input: PersonalLocalAgentHeartbeatsListInput,
) => invokeDesktopCommand("personalLocalAgentHeartbeatsList", input);

export const personalLocalAgentHeartbeatCreate = (
  input: PersonalLocalAgentHeartbeatCreateInput,
) => invokeDesktopCommand("personalLocalAgentHeartbeatCreate", input);

export const personalLocalAgentHeartbeatUpdate = (
  input: PersonalLocalAgentHeartbeatUpdateInput,
) => invokeDesktopCommand("personalLocalAgentHeartbeatUpdate", input);

export const personalLocalAgentHeartbeatDelete = (
  input: PersonalLocalAgentHeartbeatDeleteInput,
) => invokeDesktopCommand("personalLocalAgentHeartbeatDelete", input);

export const personalLocalAgentHeartbeatRunNow = (
  input: PersonalLocalAgentHeartbeatRunNowInput,
) => invokeDesktopCommand("personalLocalAgentHeartbeatRunNow", input);

export const personalLocalAgentHeartbeatRuns = (
  input: PersonalLocalAgentHeartbeatRunsInput,
) => invokeDesktopCommand("personalLocalAgentHeartbeatRuns", input);

export const weixinLoginStart = (input?: WeixinLoginStartInput) =>
  invokeDesktopCommand("weixinLoginStart", input ?? {});

export const weixinLoginPoll = (input: WeixinLoginPollInput) =>
  invokeDesktopCommand("weixinLoginPoll", input);

export const weixinSaveAccount = (input: WeixinSaveAccountInput) =>
  invokeDesktopCommand("weixinSaveAccount", input);

export const weixinAccountStatus = (input?: WeixinAccountStatusInput) =>
  invokeDesktopCommand("weixinAccountStatus", input ?? {});

export const weixinStart = (input: WeixinServiceStartInput) =>
  invokeDesktopCommand("weixinStart", input);

export const weixinAutoStart = (input?: WeixinServiceStartInput) =>
  invokeDesktopCommand("weixinAutoStart", input ?? {});

export const weixinStop = () => invokeDesktopCommand("weixinStop");
export const weixinStatus = () => invokeDesktopCommand("weixinStatus");

export const weixinSimulateInbound = (input: WeixinSimulateInboundInput) =>
  invokeDesktopCommand("weixinSimulateInbound", input);

export const weixinProbeAccessibleRoot = (
  input: { root: string } | { folderPath: string },
) => invokeDesktopCommand("weixinProbeAccessibleRoot", input);

export const feishuSaveAccount = (input: FeishuSaveAccountInput) =>
  invokeDesktopCommand("feishuSaveAccount", input);

export const feishuAccountStatus = (input?: FeishuAccountStatusInput) =>
  invokeDesktopCommand("feishuAccountStatus", input ?? {});

export const feishuStart = (input: FeishuServiceStartInput) =>
  invokeDesktopCommand("feishuStart", input);

export const feishuAutoStart = (input?: FeishuServiceStartInput) =>
  invokeDesktopCommand("feishuAutoStart", input ?? {});

export const feishuStop = () => invokeDesktopCommand("feishuStop");
export const feishuStatus = () => invokeDesktopCommand("feishuStatus");

export const feishuSimulateInbound = (input: FeishuSimulateInboundInput) =>
  invokeDesktopCommand("feishuSimulateInbound", input);

export const feishuProbeAccessibleRoot = (
  input: { root: string } | { folderPath: string },
) => invokeDesktopCommand("feishuProbeAccessibleRoot", input);

export const telegramSaveAccount = (input: TelegramSaveAccountInput) =>
  invokeDesktopCommand("telegramSaveAccount", input);

export const telegramAccountStatus = (input?: TelegramAccountStatusInput) =>
  invokeDesktopCommand("telegramAccountStatus", input ?? {});

export const telegramStart = (input: TelegramServiceStartInput) =>
  invokeDesktopCommand("telegramStart", input);

export const telegramAutoStart = (input?: TelegramServiceStartInput) =>
  invokeDesktopCommand("telegramAutoStart", input ?? {});

export const telegramStop = () => invokeDesktopCommand("telegramStop");
export const telegramStatus = () => invokeDesktopCommand("telegramStatus");

export const telegramSimulateInbound = (input: TelegramSimulateInboundInput) =>
  invokeDesktopCommand("telegramSimulateInbound", input);

export const discordSaveAccount = (input: DiscordSaveAccountInput) =>
  invokeDesktopCommand("discordSaveAccount", input);

export const discordAccountStatus = (input?: DiscordAccountStatusInput) =>
  invokeDesktopCommand("discordAccountStatus", input ?? {});

export const discordStart = (input: DiscordServiceStartInput) =>
  invokeDesktopCommand("discordStart", input);

export const discordAutoStart = (input?: DiscordServiceStartInput) =>
  invokeDesktopCommand("discordAutoStart", input ?? {});

export const discordStop = () => invokeDesktopCommand("discordStop");
export const discordStatus = () => invokeDesktopCommand("discordStatus");

export const discordSimulateInbound = (input: DiscordSimulateInboundInput) =>
  invokeDesktopCommand("discordSimulateInbound", input);

// --- Channel connectivity probe (self-check) ---
export function channelTestPlugin(
  pluginId: string,
  input?: { accountId?: string },
) {
  return invokeDesktopCommand("channelTestPlugin", {
    pluginId,
    ...(input ?? {}),
  });
}

export function testChannelConnection(
  kind: TokenChannelKindLike,
  input?: { accountId?: string },
) {
  return channelTestPlugin(kind, input);
}

type TokenChannelKindLike = "telegram" | "discord" | "weixin" | "feishu";

// --- Channel event subscriptions ---
export function onChannelStatus(
  callback: (payload: {
    platformType: string;
    status: MessagingChannelStatus;
  }) => void,
): () => void {
  const api = window.__ONMYAGENT_ELECTRON__;
  if (!api?.channels?.onStatus) return () => {};
  return api.channels.onStatus(callback);
}

export function onChannelPairing(callback: (payload: unknown) => void): () => void {
  const api = window.__ONMYAGENT_ELECTRON__;
  if (!api?.channels?.onPairing) return () => {};
  return api.channels.onPairing(callback);
}

export function onChannelUserAuthorized(
  callback: (payload: unknown) => void,
): () => void {
  const api = window.__ONMYAGENT_ELECTRON__;
  if (!api?.channels?.onUserAuthorized) return () => {};
  return api.channels.onUserAuthorized(callback);
}

// --- Channel Infrastructure API ---
export type ChannelPairingRequest = DesktopChannelPairingRequest;
export type ChannelAuthorizedUser = DesktopChannelAuthorizedUser;
export type ChannelSession = DesktopChannelSession;

export const channelGetPendingPairingRequests = () =>
  invokeDesktopCommand("channelGetPendingPairingRequests");

export const channelApprovePairing = (code: string) =>
  invokeDesktopCommand("channelApprovePairing", { code });

export const channelDenyPairing = (code: string) =>
  invokeDesktopCommand("channelDenyPairing", { code });

export const channelGetAuthorizedUsers = () =>
  invokeDesktopCommand("channelGetAuthorizedUsers");

export const channelIsUserAuthorized = (
  platformType: string,
  platformUserId: string,
) =>
  invokeDesktopCommand("channelIsUserAuthorized", {
    platformType,
    platformUserId,
  });

export const channelRevokeUserAuthorization = (
  platformType: string,
  platformUserId: string,
) =>
  invokeDesktopCommand("channelRevokeUserAuthorization", {
    platformType,
    platformUserId,
  });

export const channelGetOrCreateSession = (options: {
  platformType: string;
  platformUserId: string;
  agentType: string;
  workspace?: string;
  chatId?: string;
}) => invokeDesktopCommand("channelGetOrCreateSession", options);

export const channelGetSession = (sessionId: string) =>
  invokeDesktopCommand("channelGetSession", { sessionId });

export const channelGetSessionsByPlatform = (platformType: string) =>
  invokeDesktopCommand("channelGetSessionsByPlatform", { platformType });

export const channelGetSessionsByUser = (
  platformType: string,
  platformUserId: string,
) =>
  invokeDesktopCommand("channelGetSessionsByUser", {
    platformType,
    platformUserId,
  });

export const channelCloseSession = (sessionId: string) =>
  invokeDesktopCommand("channelCloseSession", { sessionId });

export const channelUpdateSessionMetadata = (
  sessionId: string,
  metadata: Record<string, unknown>,
) =>
  invokeDesktopCommand("channelUpdateSessionMetadata", {
    sessionId,
    metadata,
  });

export const channelGetEventHistory = (
  limit?: number,
  filterEvent?: string,
) =>
  invokeDesktopCommand("channelGetEventHistory", { limit, filterEvent });

// --- End Channel Infrastructure API ---

export const agentManagementSnapshot = (input: { workspaceRoot: string }) =>
  invokeDesktopCommand("agentManagementSnapshot", input);

export const agentManagementProviderAction = (
  input: AgentManagementProviderActionInput,
) => invokeDesktopCommand("agentManagementProviderAction", input);

export const agentManagementFetchModels = (
  input: AgentManagementFetchModelsInput,
) => invokeDesktopCommand("agentManagementFetchModels", input);

export const agentManagementSkillAction = (
  input: AgentManagementSkillActionInput,
) => invokeDesktopCommand("agentManagementSkillAction", input);

export const agentManagementMcpSnapshot = () =>
  invokeDesktopCommand("agentManagementMcpSnapshot");

export const agentManagementMcpAction = (input: AgentManagementMcpActionInput) =>
  invokeDesktopCommand("agentManagementMcpAction", input);

// Typed wrappers for workspace OnMyAgent config IPC (channel kept as Openwork*
// for desktop main-process compatibility).
export function workspaceOnMyAgentRead(input: {
  workspacePath: string;
}): Promise<Record<string, unknown>> {
  // IPC channel remains Openwork*; public API uses workspacePath while the map
  // accepts optional workspace id/path string.
  return invokeDesktopCommand(
    "workspaceOpenworkRead",
    input.workspacePath,
  ) as Promise<Record<string, unknown>>;
}

export {
  engineStart,
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
