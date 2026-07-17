import { nativeDeepLinkEvent } from "./deep-link-bridge";
import { desktopCommandNames } from "@onmyagent/types/desktop-ipc-commands";
import type { DesktopCommandName } from "@onmyagent/types/desktop-ipc";

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
} from "./desktop-types";

import type { WorkspaceList } from "./desktop-types";
import type {
  CodeWorkspaceOpenTargetId,
  CodeWorkspaceOpenTargetsResult,
  CodeWorkspaceOpenResult,
  CodeWorkspaceEnvironmentSnapshot,
  CodeWorkspaceGitActionResult,
  CodeWorkspaceTerminal,
  CodeWorkspaceTerminalSnapshot,
  CodeWorkspaceFileContent,
  CodeWorkspaceFileEntry,
} from "@onmyagent/types";
import type {
  AgentManagementProviderActionInput,
  AgentManagementProviderActionResult,
  AgentManagementFetchModelsInput,
  AgentManagementFetchModelsResult,
  AgentManagementMcpActionInput,
  AgentManagementMcpActionResult,
  AgentManagementMcpSnapshot,
  AgentManagementSkillActionInput,
  AgentManagementSkillActionResult,
  AgentManagementSnapshot,
  PersonalLocalAgent,
  PersonalLocalAgentAcpConfigOptionInput,
  PersonalLocalAgentAcpConfigOptionResult,
  PersonalLocalAgentApprovalDecision,
  PersonalLocalAgentApprovalMode,
  PersonalLocalAgentApprovalInput,
  PersonalLocalAgentConversationCreateResult,
  PersonalLocalAgentCustomAgentInput,
  PersonalLocalAgentCustomAgentResult,
  PersonalLocalAgentDeleteCustomAgentResult,
  PersonalLocalAgentDetectResult,
  PersonalLocalAgentDetectAvailableAgent,
  PersonalLocalAgentExtensionListResult,
  PersonalLocalAgentExtensionSetEnabledResult,
  PersonalLocalAgentOverridesResult,
  PersonalLocalAgentConversationConfirmationsResult,
  PersonalLocalAgentConversationGetResult,
  PersonalLocalAgentConversationGetByIdResult,
  PersonalLocalAgentChannelConversationsListResult,
  PersonalLocalAgentConversationsListByProviderResult,
  PersonalLocalAgentConversationImportInput,
  PersonalLocalAgentConversationImportResult,
  PersonalLocalAgentConversationInput,
  PersonalLocalAgentConversationStatusResult,
  PersonalLocalAgentConversationWarmupResult,
  PersonalLocalAgentConversationTranscriptInput,
  PersonalLocalAgentConversationTranscriptResult,
  PersonalLocalAgentConversationsListResult,
  PersonalLocalAgentHostStatusInput,
  PersonalLocalAgentHostStatusResult,
  PersonalLocalAgentHeartbeatCreateInput,
  PersonalLocalAgentHeartbeatCreateResult,
  PersonalLocalAgentHeartbeatDeleteInput,
  PersonalLocalAgentHeartbeatDeleteResult,
  PersonalLocalAgentHeartbeatRunNowInput,
  PersonalLocalAgentHeartbeatRunNowResult,
  PersonalLocalAgentHeartbeatRunsInput,
  PersonalLocalAgentHeartbeatRunsResult,
  PersonalLocalAgentHeartbeatsListInput,
  PersonalLocalAgentHeartbeatsListResult,
  PersonalLocalAgentHeartbeatUpdateInput,
  PersonalLocalAgentHeartbeatUpdateResult,
  PersonalLocalAgentMetadataListResult,
  PersonalLocalAgentNativeSessionsListResult,
  PersonalLocalAgentProviderSessionsListResult,
  PersonalLocalAgentProviderSessionLoadResult,
  PersonalLocalAgentProviderSessionCloseResult,
  PersonalLocalAgentProviderSessionForkResult,
  PersonalLocalAgentProcessRecord,
  PersonalLocalAgentProvider,
  PersonalLocalAgentStatus,
  PersonalLocalAgentResetConversationInput,
  PersonalLocalAgentResetConversationResult,
  PersonalLocalAgentRunInput,
  PersonalLocalAgentRunResult,
  PersonalLocalAgentsListResult,
  FeishuAccountStatusInput,
  FeishuAccountStatus,
  FeishuSaveAccountInput,
  FeishuServiceStartInput,
  FeishuSimulateInboundInput,
  MessagingAccessibleRootProbe,
  MessagingChannelStatus,
  WeixinAccountStatusInput,
  WeixinAccountStatus,
  WeixinLoginPollInput,
  WeixinLoginStartInput,
  WeixinSaveAccountInput,
  WeixinServiceStartInput,
  WeixinSimulateInboundInput,
} from "./desktop-types";

// ---------------------------------------------------------------------------
// Electron bridge surface
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __ONMYAGENT_ZOOM_FACTOR__?: number;
    __ONMYAGENT_ELECTRON__?: {
      invokeDesktop?: (command: DesktopCommandName, ...args: unknown[]) => Promise<unknown>;
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
        }>;
        setChannel?: (channel: "stable" | "alpha") => Promise<{
          channel: "stable" | "alpha";
          feedUrl: string;
          currentVersion: string;
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
        }>;
        download?: () => Promise<{ ok: boolean; reason?: string }>;
        installAndRestart?: () => Promise<{ ok: boolean; reason?: string }>;
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

async function invokeElectronHelper<T>(command: DesktopCommandName, ...args: unknown[]): Promise<T> {
  const invokeDesktop = window.__ONMYAGENT_ELECTRON__?.invokeDesktop;
  if (!invokeDesktop) {
    throw new Error(`Electron desktop helper is unavailable: ${command}`);
  }
  return (await invokeDesktop(command, ...args)) as T;
}

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

  const result = await invokeElectronHelper<{
    status: number;
    statusText: string;
    headers: [string, string][];
    body: string;
  }>("__fetch", url, { method, headers, body });

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

  const result = await invokeElectronHelper<{
    status: number;
    statusText: string;
    headers: [string, string][];
    body: string;
  }>("__fetch", url, { method, headers, body, timeoutMs });

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
  const result = await invokeElectronHelper<string | null>("__openPath", target);
  if (typeof result === "string" && result.trim()) {
    throw new Error(result);
  }
}

export async function revealDesktopItemInDir(target: string): Promise<void> {
  await invokeElectronHelper<void>("__revealItemInDir", target);
}

export async function listCodeWorkspaceOpenTargets(): Promise<CodeWorkspaceOpenTargetsResult> {
  return invokeElectronHelper<CodeWorkspaceOpenTargetsResult>(
    "codeWorkspaceOpenTargets",
  );
}

export async function openCodeWorkspaceTarget(input: {
  targetId: CodeWorkspaceOpenTargetId;
  workspacePath: string;
}): Promise<CodeWorkspaceOpenResult> {
  return invokeElectronHelper<CodeWorkspaceOpenResult>(
    "codeWorkspaceOpen",
    input,
  );
}

export async function getCodeWorkspaceEnvironment(input: {
  workspacePath?: string | null;
  sessionId?: string | null;
} = {}): Promise<CodeWorkspaceEnvironmentSnapshot> {
  return invokeElectronHelper<CodeWorkspaceEnvironmentSnapshot>(
    "codeWorkspaceEnvironment",
    input,
  );
}

export async function switchCodeWorkspaceBranch(input: {
  workspacePath: string;
  sessionId: string;
  branch: string;
}): Promise<CodeWorkspaceGitActionResult> {
  return invokeElectronHelper<CodeWorkspaceGitActionResult>(
    "codeWorkspaceGitSwitchBranch",
    input,
  );
}

export async function commitCodeWorkspaceChanges(input: {
  workspacePath: string;
  sessionId: string;
  message: string;
  push: boolean;
}): Promise<CodeWorkspaceGitActionResult> {
  return invokeElectronHelper<CodeWorkspaceGitActionResult>(
    "codeWorkspaceGitCommit",
    input,
  );
}

export async function pushCodeWorkspaceChanges(input: {
  workspacePath: string;
  sessionId: string;
}): Promise<CodeWorkspaceGitActionResult> {
  return invokeElectronHelper<CodeWorkspaceGitActionResult>(
    "codeWorkspaceGitPush",
    input,
  );
}

export async function createCodeWorkspaceTerminal(input: {
  workspacePath?: string | null;
}): Promise<CodeWorkspaceTerminal> {
  return invokeElectronHelper<CodeWorkspaceTerminal>(
    "codeWorkspaceTerminalCreate",
    input,
  );
}

export async function writeCodeWorkspaceTerminal(input: {
  terminalId: string;
  data: string;
}): Promise<{ ok: true }> {
  return invokeElectronHelper<{ ok: true }>(
    "codeWorkspaceTerminalWrite",
    input,
  );
}

export async function resizeCodeWorkspaceTerminal(input: {
  terminalId: string;
  cols: number;
  rows: number;
}): Promise<{ ok: true }> {
  return invokeElectronHelper<{ ok: true }>(
    "codeWorkspaceTerminalResize",
    input,
  );
}

export async function getCodeWorkspaceTerminalSnapshot(input: {
  terminalId: string;
}): Promise<CodeWorkspaceTerminalSnapshot> {
  return invokeElectronHelper<CodeWorkspaceTerminalSnapshot>(
    "codeWorkspaceTerminalSnapshot",
    input,
  );
}

export async function closeCodeWorkspaceTerminal(input: {
  terminalId: string;
}): Promise<{ ok: true }> {
  return invokeElectronHelper<{ ok: true }>(
    "codeWorkspaceTerminalClose",
    input,
  );
}

export async function listCodeWorkspaceFiles(input: {
  workspacePath: string;
  relativePath?: string;
}): Promise<{ items: CodeWorkspaceFileEntry[] }> {
  return invokeElectronHelper<{ items: CodeWorkspaceFileEntry[] }>(
    "codeWorkspaceFilesList",
    input,
  );
}

export async function readCodeWorkspaceFile(input: {
  workspacePath: string;
  relativePath: string;
}): Promise<CodeWorkspaceFileContent> {
  return invokeElectronHelper<CodeWorkspaceFileContent>(
    "codeWorkspaceFileRead",
    input,
  );
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

export async function getDesktopHomeDir(): Promise<string> {
  return invokeElectronHelper<string>("__homeDir");
}

export async function joinDesktopPath(...parts: string[]): Promise<string> {
  return invokeElectronHelper<string>("__joinPath", ...parts);
}

export type UserAgentRegistryFile = {
  path: string;
  content: string;
  bytes: number;
  updatedAt: number;
};

export type UserAgentRegistryWriteResult = {
  ok: boolean;
  path: string;
  bytes: number;
  updatedAt: number;
};

export async function readUserAgentRegistry(): Promise<UserAgentRegistryFile | null> {
  return invokeElectronHelper<UserAgentRegistryFile | null>(
    "userAgentRegistryRead",
  );
}

export async function writeUserAgentRegistry(
  content: string,
): Promise<UserAgentRegistryWriteResult> {
  return invokeElectronHelper<UserAgentRegistryWriteResult>(
    "userAgentRegistryWrite",
    { content },
  );
}

export async function setDesktopZoomFactor(value: number): Promise<boolean> {
  return invokeElectronHelper<boolean>("__setZoomFactor", value);
}

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

export type ExpertPackageInstallInput = {
  source: "builtin";
  marketplace: "experts" | "my-experts";
  packageName: string;
};

export type ExpertPackageInstallResult = {
  ok: true;
  path: string;
  packageName: string;
  marketplace: "experts" | "my-experts";
};

export type BuiltinSkillPackageInstallInput = {
  source: "builtin";
  packageName: string;
  skillName: string;
};

export type BuiltinSkillPackageInstallResult = {
  ok: true;
  path: string;
  packageName: string;
  skillName: string;
};

export type ExpertPackageListEntry = {
  id: string;
  packageName: string;
  source: "installed" | "mine";
  packagePath: string;
  displayName: string;
  profession: string;
  description: string;
  categoryId: string;
  tags: string[];
  quickPrompts: string[];
  avatarUrl: string | null;
  expertType: "agent" | "team";
  leadAgentName: string;
  systemPrompt: string;
  version: string | null;
};

export type ExpertRegistryListEntry = {
  id: string;
  name: string;
  source: "installed" | "mine";
  packageName: string;
  packagePath: string;
};

export type MyExpertPackageWriteInput = {
  id: string;
  packageName: string;
  name: string;
  description: string;
  quote: string;
};

export function installExpertPackage(
  input: ExpertPackageInstallInput,
): Promise<ExpertPackageInstallResult> {
  return invokeElectronHelper<ExpertPackageInstallResult>(
    "installExpertPackage",
    input,
  );
}

export function installBuiltinSkillPackage(
  input: BuiltinSkillPackageInstallInput,
): Promise<BuiltinSkillPackageInstallResult> {
  return invokeElectronHelper<BuiltinSkillPackageInstallResult>(
    "installBuiltinSkillPackage",
    input,
  );
}

export function onmyagentMarketplaceRoot(
  marketplace: "experts" | "my-experts",
): Promise<string> {
  return invokeElectronHelper<string>("onmyagentMarketplaceRoot", marketplace);
}

export function listExpertPackages(
  marketplace: "experts" | "my-experts",
): Promise<ExpertPackageListEntry[]> {
  return invokeElectronHelper<ExpertPackageListEntry[]>(
    "listExpertPackages",
    marketplace,
  );
}

export function listExpertRegistryRecords(
  marketplace: "experts" | "my-experts",
): Promise<ExpertRegistryListEntry[]> {
  return invokeElectronHelper<ExpertRegistryListEntry[]>(
    "listExpertRegistryRecords",
    marketplace,
  );
}

export function writeMyExpertPackage(
  input: MyExpertPackageWriteInput,
): Promise<ExpertPackageInstallResult> {
  return invokeElectronHelper<ExpertPackageInstallResult>(
    "writeMyExpertPackage",
    input,
  );
}

export function personalLocalAgentsList(input?: {
  agents?: Array<Partial<PersonalLocalAgent>>;
  workspaceRoot?: string;
  includeModels?: boolean;
}): Promise<PersonalLocalAgentsListResult> {
  return invokeElectronHelper<PersonalLocalAgentsListResult>(
    "personalLocalAgentsList",
    input ?? {},
  );
}

export function personalLocalAgentMetadataList(input?: {
  agents?: Array<Partial<PersonalLocalAgent>>;
  workspaceRoot?: string;
  includeModels?: boolean;
}): Promise<PersonalLocalAgentMetadataListResult> {
  return invokeElectronHelper<PersonalLocalAgentMetadataListResult>(
    "personalLocalAgentMetadataList",
    input ?? {},
  );
}

export function personalLocalAgentAcpAgentsList(input?: {
  agents?: Array<Partial<PersonalLocalAgent>>;
  workspaceRoot?: string;
  includeModels?: boolean;
}): Promise<PersonalLocalAgentMetadataListResult> {
  return invokeElectronHelper<PersonalLocalAgentMetadataListResult>(
    "personalLocalAgentAcpAgentsList",
    input ?? {},
  );
}

export function personalLocalAgentAcpAgentsRefresh(input?: {
  agents?: Array<Partial<PersonalLocalAgent>>;
  workspaceRoot?: string;
  includeModels?: boolean;
}): Promise<PersonalLocalAgentMetadataListResult> {
  return invokeElectronHelper<PersonalLocalAgentMetadataListResult>(
    "personalLocalAgentAcpAgentsRefresh",
    input ?? {},
  );
}

export function personalLocalAgentAcpHealth(input?: {
  agents?: Array<Partial<PersonalLocalAgent>>;
  workspaceRoot?: string;
}): Promise<{ ok: boolean; agents: Array<Record<string, unknown>> }> {
  return invokeElectronHelper<{ ok: boolean; agents: Array<Record<string, unknown>> }>(
    "personalLocalAgentAcpHealth",
    input ?? {},
  );
}

export type LocalAgentComposerFileEntry = {
  path: string;
  relativePath: string;
  name: string;
  isDirectory: boolean;
};

export function localAgentComposerListFiles(input: {
  workspaceRoot: string;
  query?: string;
  limit?: number;
}): Promise<{ files: LocalAgentComposerFileEntry[] }> {
  return invokeElectronHelper<{ files: LocalAgentComposerFileEntry[] }>(
    "localAgentComposerListFiles",
    input,
  );
}

export function localAgentComposerSaveAttachment(input: {
  workspaceRoot: string;
  name: string;
  dataUrl: string;
}): Promise<{ path: string; relativePath: string; name: string; size: number }> {
  return invokeElectronHelper<{ path: string; relativePath: string; name: string; size: number }>(
    "localAgentComposerSaveAttachment",
    input,
  );
}

export function personalLocalAgentAcpSend(
  input: PersonalLocalAgentRunInput,
): Promise<PersonalLocalAgentRunResult> {
  return invokeElectronHelper<PersonalLocalAgentRunResult>(
    "personalLocalAgentAcpSend",
    input,
  );
}

export function personalLocalAgentAcpCancel(
  runId: string,
): Promise<{ ok: boolean; error?: string }> {
  return invokeElectronHelper<{ ok: boolean; error?: string }>(
    "personalLocalAgentAcpCancel",
    runId,
  );
}

export function personalLocalAgentAcpResolveApproval(
  input: PersonalLocalAgentApprovalInput,
): Promise<{ ok: boolean; error?: string }> {
  return invokeElectronHelper<{ ok: boolean; error?: string }>(
    "personalLocalAgentAcpResolveApproval",
    input,
  );
}

export function personalLocalAgentAcpConfigOptions(input?: {
  agent?: Partial<PersonalLocalAgent>;
  workspaceRoot?: string;
}): Promise<{ configOptions: unknown[]; availableModels: unknown[]; availableCommands: unknown[]; capabilities?: Record<string, boolean>; unsupportedReason?: string | null }> {
  return invokeElectronHelper<{ configOptions: unknown[]; availableModels: unknown[]; availableCommands: unknown[]; capabilities?: Record<string, boolean>; unsupportedReason?: string | null }>(
    "personalLocalAgentAcpConfigOptions",
    input ?? {},
  );
}

export function personalLocalAgentSetAcpConfigOption(
  input: PersonalLocalAgentAcpConfigOptionInput,
): Promise<PersonalLocalAgentAcpConfigOptionResult> {
  return invokeElectronHelper<PersonalLocalAgentAcpConfigOptionResult>(
    "personalLocalAgentSetAcpConfigOption",
    input,
  );
}

export function personalLocalAgentCreateCustomAgent(
  input: PersonalLocalAgentCustomAgentInput,
): Promise<PersonalLocalAgentCustomAgentResult> {
  return invokeElectronHelper<PersonalLocalAgentCustomAgentResult>("personalLocalAgentCreateCustomAgent", input);
}

export function personalLocalAgentUpdateCustomAgent(
  input: PersonalLocalAgentCustomAgentInput,
): Promise<PersonalLocalAgentCustomAgentResult> {
  return invokeElectronHelper<PersonalLocalAgentCustomAgentResult>("personalLocalAgentUpdateCustomAgent", input);
}

export function personalLocalAgentDeleteCustomAgent(input: {
  workspaceRoot: string;
  id: string;
}): Promise<PersonalLocalAgentDeleteCustomAgentResult> {
  return invokeElectronHelper<PersonalLocalAgentDeleteCustomAgentResult>("personalLocalAgentDeleteCustomAgent", input);
}

export function personalLocalAgentDetectAvailableAgents(input: {
  workspaceRoot: string;
  existingIds?: string[];
}): Promise<PersonalLocalAgentDetectResult> {
  return invokeElectronHelper<PersonalLocalAgentDetectResult>("personalLocalAgentDetectAvailableAgents", input);
}


export function personalLocalAgentListExtensions(): Promise<PersonalLocalAgentExtensionListResult> {
  return invokeElectronHelper<PersonalLocalAgentExtensionListResult>("personalLocalAgentExtensionsList", {});
}

export function personalLocalAgentSetExtensionEnabled(input: {
  name: string;
  enabled: boolean;
}): Promise<PersonalLocalAgentExtensionSetEnabledResult> {
  return invokeElectronHelper<PersonalLocalAgentExtensionSetEnabledResult>("personalLocalAgentExtensionSetEnabled", input);
}


export function personalLocalAgentGetAgentOverrides(input: {
  workspaceRoot: string;
  id: string;
}): Promise<PersonalLocalAgentOverridesResult> {
  return invokeElectronHelper<PersonalLocalAgentOverridesResult>("personalLocalAgentGetAgentOverrides", input);
}

export function personalLocalAgentSetAgentOverrides(input: {
  workspaceRoot: string;
  id: string;
  overrides: Record<string, unknown>;
}): Promise<PersonalLocalAgentOverridesResult> {
  return invokeElectronHelper<PersonalLocalAgentOverridesResult>("personalLocalAgentSetAgentOverrides", input);
}

export function personalLocalAgentAcpProcessesList(input?: {
  provider?: string;
  conversationId?: string;
}): Promise<{ processes: PersonalLocalAgentProcessRecord[] }> {
  return invokeElectronHelper<{ processes: PersonalLocalAgentProcessRecord[] }>(
    "personalLocalAgentAcpProcessesList",
    input ?? {},
  );
}

export type PersonalLocalAgentTestConnectionResult = {
  ok: boolean;
  status: PersonalLocalAgentStatus;
  step: "fail_cli" | "fail_acp" | "needs_auth" | "online" | string;
  error: string | null;
  capabilities: Record<string, unknown> | null;
  models: Array<{ id: string; label: string }>;
  configOptions: unknown[];
  checkedAt: number;
};

export type PersonalLocalAgentProviderHealthResult = PersonalLocalAgentTestConnectionResult & {
  healthy: boolean;
  reason: string | null;
};

export function personalLocalAgentTestConnection(input: {
  agent: Partial<PersonalLocalAgent>;
  workspaceRoot?: string;
  timeoutMs?: number;
}): Promise<PersonalLocalAgentTestConnectionResult> {
  return invokeElectronHelper<PersonalLocalAgentTestConnectionResult>(
    "personalLocalAgentTestConnection",
    input,
  );
}

export type PersonalLocalAgentTestCustomAgentResult = {
  step: "success" | "fail_cli" | "fail_acp";
  error: string | null;
  durationMs: number;
};

export function personalLocalAgentTestCustomAgent(input: {
  command: string;
  acpArgs?: string[];
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}): Promise<PersonalLocalAgentTestCustomAgentResult> {
  return invokeElectronHelper<PersonalLocalAgentTestCustomAgentResult>(
    "personalLocalAgentTestCustomAgent",
    input,
  );
}

export function personalLocalAgentCheckProviderHealth(input: {
  agent: Partial<PersonalLocalAgent>;
  workspaceRoot?: string;
  timeoutMs?: number;
}): Promise<PersonalLocalAgentProviderHealthResult> {
  return invokeElectronHelper<PersonalLocalAgentProviderHealthResult>("personalLocalAgentCheckProviderHealth", input);
}

export function personalLocalAgentCheckManagedAgentHealthById(input: {
  id?: string;
  agentId?: string;
  provider?: string;
  workspaceRoot?: string;
  timeoutMs?: number;
}): Promise<PersonalLocalAgentProviderHealthResult> {
  return invokeElectronHelper<PersonalLocalAgentProviderHealthResult>("personalLocalAgentCheckManagedAgentHealthById", input);
}

export function personalLocalAgentValidate(
  agent: Partial<PersonalLocalAgent>,
): Promise<PersonalLocalAgent> {
  return invokeElectronHelper<PersonalLocalAgent>(
    "personalLocalAgentValidate",
    agent,
  );
}

export function personalLocalAgentStart(
  input: PersonalLocalAgentRunInput,
): Promise<PersonalLocalAgentRunResult> {
  return invokeElectronHelper<PersonalLocalAgentRunResult>(
    "personalLocalAgentStart",
    input,
  );
}

export function personalLocalAgentStatus(
  input: string | { runId: string; workspaceRoot?: string },
): Promise<PersonalLocalAgentRunResult> {
  return invokeElectronHelper<PersonalLocalAgentRunResult>(
    "personalLocalAgentStatus",
    input,
  );
}

export function personalLocalAgentRun(
  input: PersonalLocalAgentRunInput,
): Promise<PersonalLocalAgentRunResult> {
  return invokeElectronHelper<PersonalLocalAgentRunResult>(
    "personalLocalAgentRun",
    input,
  );
}

export function personalLocalAgentCancel(
  runId: string,
): Promise<{ ok: boolean; error?: string }> {
  return invokeElectronHelper<{ ok: boolean; error?: string }>(
    "personalLocalAgentCancel",
    runId,
  );
}

export function personalLocalAgentResolveApproval(
  input: PersonalLocalAgentApprovalInput,
): Promise<{ ok: boolean; error?: string }> {
  return invokeElectronHelper<{ ok: boolean; error?: string }>(
    "personalLocalAgentResolveApproval",
    input,
  );
}

export function personalLocalAgentResetConversation(
  input: PersonalLocalAgentResetConversationInput,
): Promise<PersonalLocalAgentResetConversationResult> {
  return invokeElectronHelper<PersonalLocalAgentResetConversationResult>(
    "personalLocalAgentResetConversation",
    input,
  );
}

export function personalLocalAgentConversationsList(
  input: PersonalLocalAgentConversationInput,
): Promise<PersonalLocalAgentConversationsListResult> {
  return invokeElectronHelper<PersonalLocalAgentConversationsListResult>(
    "personalLocalAgentConversationsList",
    input,
  );
}

export function personalLocalAgentConversationCreate(
  input: PersonalLocalAgentConversationInput,
): Promise<PersonalLocalAgentConversationCreateResult> {
  return invokeElectronHelper<PersonalLocalAgentConversationCreateResult>(
    "personalLocalAgentConversationCreate",
    input,
  );
}

export function personalLocalAgentConversationGet(
  input: PersonalLocalAgentConversationInput,
): Promise<PersonalLocalAgentConversationGetResult> {
  return invokeElectronHelper<PersonalLocalAgentConversationGetResult>(
    "personalLocalAgentConversationGet",
    input,
  );
}

export function personalLocalAgentConversationGetById(
  input: { workspaceRoot: string; conversationId: string },
): Promise<PersonalLocalAgentConversationGetByIdResult> {
  return invokeElectronHelper<PersonalLocalAgentConversationGetByIdResult>(
    "personalLocalAgentConversationGetById",
    input,
  );
}

export function personalLocalAgentChannelConversationsList(
  input: { workspaceRoot: string },
): Promise<PersonalLocalAgentChannelConversationsListResult> {
  return invokeElectronHelper<PersonalLocalAgentChannelConversationsListResult>(
    "personalLocalAgentChannelConversationsList",
    input,
  );
}

export function personalLocalAgentConversationsListByProvider(
  input: PersonalLocalAgentConversationInput,
): Promise<PersonalLocalAgentConversationsListByProviderResult> {
  return invokeElectronHelper<PersonalLocalAgentConversationsListByProviderResult>(
    "personalLocalAgentConversationsListByProvider",
    input,
  );
}

export function personalLocalAgentConversationImportFromArchive(
  input: PersonalLocalAgentConversationImportInput,
): Promise<PersonalLocalAgentConversationImportResult> {
  return invokeElectronHelper<PersonalLocalAgentConversationImportResult>(
    "personalLocalAgentConversationImportFromArchive",
    input,
  );
}

export function personalLocalAgentConversationStatus(
  input: PersonalLocalAgentConversationInput & { conversationId?: string | null },
): Promise<PersonalLocalAgentConversationStatusResult> {
  return invokeElectronHelper<PersonalLocalAgentConversationStatusResult>(
    "personalLocalAgentConversationStatus",
    input,
  );
}

export function personalLocalAgentConversationWarmup(
  input: PersonalLocalAgentConversationInput & { conversationId?: string | null; approvalMode?: PersonalLocalAgentApprovalMode; model?: string | null },
): Promise<PersonalLocalAgentConversationWarmupResult> {
  return invokeElectronHelper<PersonalLocalAgentConversationWarmupResult>(
    "personalLocalAgentConversationWarmup",
    input,
  );
}


export function personalLocalAgentProviderSessionsList(
  input: PersonalLocalAgentConversationInput,
): Promise<PersonalLocalAgentProviderSessionsListResult> {
  return invokeElectronHelper<PersonalLocalAgentProviderSessionsListResult>(
    "personalLocalAgentProviderSessionsList",
    input,
  );
}

export function personalLocalAgentProviderSessionLoad(
  input: PersonalLocalAgentConversationInput & { sessionId: string; title?: string },
): Promise<PersonalLocalAgentProviderSessionLoadResult> {
  return invokeElectronHelper<PersonalLocalAgentProviderSessionLoadResult>(
    "personalLocalAgentProviderSessionLoad",
    input,
  );
}

export function personalLocalAgentProviderSessionClose(
  input: PersonalLocalAgentConversationInput & { conversationId?: string | null; sessionId: string },
): Promise<PersonalLocalAgentProviderSessionCloseResult> {
  return invokeElectronHelper<PersonalLocalAgentProviderSessionCloseResult>(
    "personalLocalAgentProviderSessionClose",
    input,
  );
}

export function personalLocalAgentProviderSessionFork(
  input: PersonalLocalAgentConversationInput & { sessionId: string; title?: string; messageId?: string },
): Promise<PersonalLocalAgentProviderSessionForkResult> {
  return invokeElectronHelper<PersonalLocalAgentProviderSessionForkResult>(
    "personalLocalAgentProviderSessionFork",
    input,
  );
}

export function personalLocalAgentConversationConfirmationsList(
  input: PersonalLocalAgentConversationInput,
): Promise<PersonalLocalAgentConversationConfirmationsResult> {
  return invokeElectronHelper<PersonalLocalAgentConversationConfirmationsResult>(
    "personalLocalAgentConversationConfirmationsList",
    input,
  );
}

export function personalLocalAgentHostStatus(
  input: PersonalLocalAgentHostStatusInput,
): Promise<PersonalLocalAgentHostStatusResult> {
  return invokeElectronHelper<PersonalLocalAgentHostStatusResult>(
    "personalLocalAgentHostStatus",
    input,
  );
}

export function personalLocalAgentConversationConfirmationConfirm(
  input: PersonalLocalAgentConversationInput & {
    runId?: string | null;
    approvalId?: string | null;
    id?: string | null;
    decision: PersonalLocalAgentApprovalDecision;
    alwaysAllow?: boolean;
  },
): Promise<{ ok: boolean; error?: string }> {
  return invokeElectronHelper<{ ok: boolean; error?: string }>(
    "personalLocalAgentConversationConfirmationConfirm",
    input,
  );
}

export function personalLocalAgentNativeSessionsList(input: {
  workspaceRoot: string;
  limit?: number;
  agent?: Partial<PersonalLocalAgent> & {
    provider?: PersonalLocalAgentProvider;
    customArgs?: string[];
  };
}): Promise<PersonalLocalAgentNativeSessionsListResult> {
  return invokeElectronHelper<PersonalLocalAgentNativeSessionsListResult>(
    "personalLocalAgentNativeSessionsList",
    input,
  );
}

export function personalLocalAgentConversationTranscript(
  input: PersonalLocalAgentConversationTranscriptInput,
): Promise<PersonalLocalAgentConversationTranscriptResult> {
  return invokeElectronHelper<PersonalLocalAgentConversationTranscriptResult>(
    "personalLocalAgentConversationTranscript",
    input,
  );
}

export function personalLocalAgentHeartbeatsList(
  input: PersonalLocalAgentHeartbeatsListInput,
): Promise<PersonalLocalAgentHeartbeatsListResult> {
  return invokeElectronHelper<PersonalLocalAgentHeartbeatsListResult>(
    "personalLocalAgentHeartbeatsList",
    input,
  );
}

export function personalLocalAgentHeartbeatCreate(
  input: PersonalLocalAgentHeartbeatCreateInput,
): Promise<PersonalLocalAgentHeartbeatCreateResult> {
  return invokeElectronHelper<PersonalLocalAgentHeartbeatCreateResult>(
    "personalLocalAgentHeartbeatCreate",
    input,
  );
}

export function personalLocalAgentHeartbeatUpdate(
  input: PersonalLocalAgentHeartbeatUpdateInput,
): Promise<PersonalLocalAgentHeartbeatUpdateResult> {
  return invokeElectronHelper<PersonalLocalAgentHeartbeatUpdateResult>(
    "personalLocalAgentHeartbeatUpdate",
    input,
  );
}

export function personalLocalAgentHeartbeatDelete(
  input: PersonalLocalAgentHeartbeatDeleteInput,
): Promise<PersonalLocalAgentHeartbeatDeleteResult> {
  return invokeElectronHelper<PersonalLocalAgentHeartbeatDeleteResult>(
    "personalLocalAgentHeartbeatDelete",
    input,
  );
}

export function personalLocalAgentHeartbeatRunNow(
  input: PersonalLocalAgentHeartbeatRunNowInput,
): Promise<PersonalLocalAgentHeartbeatRunNowResult> {
  return invokeElectronHelper<PersonalLocalAgentHeartbeatRunNowResult>(
    "personalLocalAgentHeartbeatRunNow",
    input,
  );
}

export function personalLocalAgentHeartbeatRuns(
  input: PersonalLocalAgentHeartbeatRunsInput,
): Promise<PersonalLocalAgentHeartbeatRunsResult> {
  return invokeElectronHelper<PersonalLocalAgentHeartbeatRunsResult>(
    "personalLocalAgentHeartbeatRuns",
    input,
  );
}

export function weixinLoginStart(input?: WeixinLoginStartInput): Promise<MessagingChannelStatus> {
  return invokeElectronHelper<MessagingChannelStatus>("weixinLoginStart", input ?? {});
}

export function weixinLoginPoll(input: WeixinLoginPollInput): Promise<MessagingChannelStatus> {
  return invokeElectronHelper<MessagingChannelStatus>("weixinLoginPoll", input);
}

export function weixinSaveAccount(input: WeixinSaveAccountInput): Promise<WeixinAccountStatus> {
  return invokeElectronHelper<WeixinAccountStatus>("weixinSaveAccount", input);
}

export function weixinAccountStatus(input?: WeixinAccountStatusInput): Promise<WeixinAccountStatus> {
  return invokeElectronHelper<WeixinAccountStatus>("weixinAccountStatus", input ?? {});
}

export function weixinStart(input: WeixinServiceStartInput): Promise<MessagingChannelStatus> {
  return invokeElectronHelper<MessagingChannelStatus>("weixinStart", input);
}

export function weixinAutoStart(input?: WeixinServiceStartInput): Promise<MessagingChannelStatus> {
  return invokeElectronHelper<MessagingChannelStatus>("weixinAutoStart", input ?? {});
}

export function weixinStop(): Promise<MessagingChannelStatus> {
  return invokeElectronHelper<MessagingChannelStatus>("weixinStop");
}

export function weixinStatus(): Promise<MessagingChannelStatus> {
  return invokeElectronHelper<MessagingChannelStatus>("weixinStatus");
}

export function weixinSimulateInbound(input: WeixinSimulateInboundInput): Promise<MessagingChannelStatus> {
  return invokeElectronHelper<MessagingChannelStatus>("weixinSimulateInbound", input);
}

export function weixinProbeAccessibleRoot(input: { root: string } | { folderPath: string }): Promise<MessagingAccessibleRootProbe> {
  return invokeElectronHelper<MessagingAccessibleRootProbe>("weixinProbeAccessibleRoot", input);
}

export function feishuSaveAccount(input: FeishuSaveAccountInput): Promise<FeishuAccountStatus> {
  return invokeElectronHelper<FeishuAccountStatus>("feishuSaveAccount", input);
}

export function feishuAccountStatus(input?: FeishuAccountStatusInput): Promise<FeishuAccountStatus> {
  return invokeElectronHelper<FeishuAccountStatus>("feishuAccountStatus", input ?? {});
}

export function feishuStart(input: FeishuServiceStartInput): Promise<MessagingChannelStatus> {
  return invokeElectronHelper<MessagingChannelStatus>("feishuStart", input);
}

export function feishuAutoStart(input?: FeishuServiceStartInput): Promise<MessagingChannelStatus> {
  return invokeElectronHelper<MessagingChannelStatus>("feishuAutoStart", input ?? {});
}

export function feishuStop(): Promise<MessagingChannelStatus> {
  return invokeElectronHelper<MessagingChannelStatus>("feishuStop");
}

export function feishuStatus(): Promise<MessagingChannelStatus> {
  return invokeElectronHelper<MessagingChannelStatus>("feishuStatus");
}

export function feishuSimulateInbound(input: FeishuSimulateInboundInput): Promise<MessagingChannelStatus> {
  return invokeElectronHelper<MessagingChannelStatus>("feishuSimulateInbound", input);
}

export function feishuProbeAccessibleRoot(input: { root: string } | { folderPath: string }): Promise<MessagingAccessibleRootProbe> {
  return invokeElectronHelper<MessagingAccessibleRootProbe>("feishuProbeAccessibleRoot", input);
}

// --- Channel Infrastructure API ---
// Wrappers for channel pairing, session, and event APIs

export interface ChannelPairingRequest {
  code: string;
  platformType: string;
  platformUserId: string;
  displayName?: string;
  requestedAt: number;
  expiresAt: number;
  status: string;
}

export interface ChannelAuthorizedUser {
  id: string;
  platformType: string;
  platformUserId: string;
  displayName?: string;
  authorizedAt: number;
  lastActive?: number;
}

export interface ChannelSession {
  id: string;
  platformType: string;
  platformUserId: string;
  agentType: string;
  workspace?: string;
  chatId?: string;
  createdAt: number;
  lastActivity: number;
  messages: Array<{ id: string; role: string; content: string; timestamp: number }>;
  metadata: Record<string, unknown>;
  closedAt?: number;
}

/**
 * Get all pending pairing requests
 * Security: Safe, only returns pending request metadata
 */
export function channelGetPendingPairingRequests(): Promise<ChannelPairingRequest[]> {
  return invokeElectronHelper<ChannelPairingRequest[]>("channelGetPendingPairingRequests");
}

/**
 * Approve a pairing request
 * Security: This can only be called from local UI, never from remote IM
 */
export function channelApprovePairing(code: string): Promise<{ ok: boolean; error?: string; user?: ChannelAuthorizedUser }> {
  return invokeElectronHelper<{ ok: boolean; error?: string; user?: ChannelAuthorizedUser }>("channelApprovePairing", { code });
}

/**
 * Deny a pairing request
 * Security: This can only be called from local UI, never from remote IM
 */
export function channelDenyPairing(code: string): Promise<{ ok: boolean; error?: string }> {
  return invokeElectronHelper<{ ok: boolean; error?: string }>("channelDenyPairing", { code });
}

/**
 * Get all authorized users
 */
export function channelGetAuthorizedUsers(): Promise<ChannelAuthorizedUser[]> {
  return invokeElectronHelper<ChannelAuthorizedUser[]>("channelGetAuthorizedUsers");
}

/**
 * Check if a user is authorized
 */
export function channelIsUserAuthorized(platformType: string, platformUserId: string): Promise<boolean> {
  return invokeElectronHelper<boolean>("channelIsUserAuthorized", { platformType, platformUserId });
}

/**
 * Revoke user authorization
 * Security: This can only be called from local UI
 */
export function channelRevokeUserAuthorization(platformType: string, platformUserId: string): Promise<{ ok: boolean; error?: string }> {
  return invokeElectronHelper<{ ok: boolean; error?: string }>("channelRevokeUserAuthorization", { platformType, platformUserId });
}

/**
 * Get or create a session for a user + agent combination
 */
export function channelGetOrCreateSession(options: {
  platformType: string;
  platformUserId: string;
  agentType: string;
  workspace?: string;
  chatId?: string;
}): Promise<{ ok: boolean; session?: ChannelSession; error?: string }> {
  return invokeElectronHelper<{ ok: boolean; session?: ChannelSession; error?: string }>("channelGetOrCreateSession", options);
}

/**
 * Get session by ID
 */
export function channelGetSession(sessionId: string): Promise<{ ok: boolean; session?: ChannelSession; error?: string }> {
  return invokeElectronHelper<{ ok: boolean; session?: ChannelSession; error?: string }>("channelGetSession", { sessionId });
}

/**
 * Get all sessions for a platform
 */
export function channelGetSessionsByPlatform(platformType: string): Promise<ChannelSession[]> {
  return invokeElectronHelper<ChannelSession[]>("channelGetSessionsByPlatform", { platformType });
}

/**
 * Get all sessions for a user on a platform
 */
export function channelGetSessionsByUser(platformType: string, platformUserId: string): Promise<ChannelSession[]> {
  return invokeElectronHelper<ChannelSession[]>("channelGetSessionsByUser", { platformType, platformUserId });
}

/**
 * Close (archive) a session
 */
export function channelCloseSession(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  return invokeElectronHelper<{ ok: boolean; error?: string }>("channelCloseSession", { sessionId });
}

/**
 * Update session metadata
 */
export function channelUpdateSessionMetadata(sessionId: string, metadata: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  return invokeElectronHelper<{ ok: boolean; error?: string }>("channelUpdateSessionMetadata", { sessionId, metadata });
}

/**
 * Get recent channel event history
 */
export function channelGetEventHistory(limit?: number, filterEvent?: string): Promise<Array<{ id: string; name: string; payload: unknown; timestamp: number }>> {
  return invokeElectronHelper<Array<{ id: string; name: string; payload: unknown; timestamp: number }>>("channelGetEventHistory", { limit, filterEvent });
}
// --- End Channel Infrastructure API ---


export function agentManagementSnapshot(input: {
  workspaceRoot: string;
}): Promise<AgentManagementSnapshot> {
  return invokeElectronHelper<AgentManagementSnapshot>(
    "agentManagementSnapshot",
    input,
  );
}


export function agentManagementProviderAction(
  input: AgentManagementProviderActionInput,
): Promise<AgentManagementProviderActionResult> {
  return invokeElectronHelper<AgentManagementProviderActionResult>(
    "agentManagementProviderAction",
    input,
  );
}

export function agentManagementFetchModels(
  input: AgentManagementFetchModelsInput,
): Promise<AgentManagementFetchModelsResult> {
  return invokeElectronHelper<AgentManagementFetchModelsResult>(
    "agentManagementFetchModels",
    input,
  );
}

export function agentManagementSkillAction(
  input: AgentManagementSkillActionInput,
): Promise<AgentManagementSkillActionResult> {
  return invokeElectronHelper<AgentManagementSkillActionResult>(
    "agentManagementSkillAction",
    input,
  );
}

export function agentManagementMcpSnapshot(): Promise<AgentManagementMcpSnapshot> {
  return invokeElectronHelper<AgentManagementMcpSnapshot>(
    "agentManagementMcpSnapshot",
  );
}

export function agentManagementMcpAction(
  input: AgentManagementMcpActionInput,
): Promise<AgentManagementMcpActionResult> {
  return invokeElectronHelper<AgentManagementMcpActionResult>(
    "agentManagementMcpAction",
    input,
  );
}

// Typed wrappers for workspace OnMyAgent config IPC (channel kept as Openwork*
// for desktop main-process compatibility).
export function workspaceOnMyAgentRead(input: {
  workspacePath: string;
}): Promise<Record<string, unknown>> {
  return invokeElectronHelper<Record<string, unknown>>("workspaceOpenworkRead", input);
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
