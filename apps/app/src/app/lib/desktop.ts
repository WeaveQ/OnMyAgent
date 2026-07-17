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
  DesktopChannelEventHistoryEntry,
  ExpertMarketplaceName,
  ExpertPackageInstallInput,
  ExpertPackageInstallResult,
  ExpertPackageListEntry,
  ExpertRegistryListEntry,
  MyExpertPackageWriteInput,
} from "./desktop-types";

import type { WorkspaceList } from "./desktop-types";
import type {
  AgentManagementProviderActionInput,
  AgentManagementFetchModelsInput,
  AgentManagementMcpActionInput,
  AgentManagementSkillActionInput,
  BuiltinSkillPackageInstallInput,
  ExpertMarketplaceName,
  ExpertPackageInstallInput,
  ExpertPackageInstallResult,
  MessagingChannelStatus,
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

export const onmyagentMarketplaceRoot = (marketplace: ExpertMarketplaceName) =>
  invokeDesktopCommand("onmyagentMarketplaceRoot", marketplace);

export const listExpertPackages = (marketplace: ExpertMarketplaceName) =>
  invokeDesktopCommand("listExpertPackages", marketplace);

export const listExpertRegistryRecords = (marketplace: ExpertMarketplaceName) =>
  invokeDesktopCommand("listExpertRegistryRecords", marketplace);

export const writeMyExpertPackage = (input: MyExpertPackageWriteInput) =>
  invokeDesktopCommand("writeMyExpertPackage", input);

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
