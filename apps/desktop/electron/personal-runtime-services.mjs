/**
 * Desktop personal-agent + messaging channel service composition.
 * Cold-start: personal runtime is light (orphan reconcile deferred);
 * channel plugin initialize() is lazy via wrapChannelApiForLazyInit.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createMessagingChannelServices } from "./channel-runtime.mjs";
import { createPersonalAgentHeartbeatScheduler } from "./personal-agent-runtime/heartbeat-scheduler.mjs";
import { createPersonalAgentRuntime } from "./personal-agent-runtime/index.mjs";
import { createPersonalAgentLegacyHarness } from "./personal-agent-runtime/legacy-harness.mjs";
import { createPersonalAgentNativeSessionBridge } from "./personal-agent-runtime/native-sessions.mjs";
import {
  BUNDLED_EXTENSIONS_RESOURCE_DIR,
  buildBundledResourceCandidates,
  filterExisting,
} from "./runtime-helpers.mjs";

const __runtimeDir = path.dirname(fileURLToPath(import.meta.url));

function bundledExtensionRootPaths() {
  return filterExisting(
    buildBundledResourceCandidates(
      __runtimeDir,
      BUNDLED_EXTENSIONS_RESOURCE_DIR,
      process.resourcesPath,
    ),
    existsSync,
  );
}

/** Await channel initialize before any async API method (lazy cold start). */
export function wrapChannelApiForLazyInit(api, ensureReady) {
  if (!api || typeof api !== "object") return api;
  const wrapped = { ...api, ensureChannelsReady: ensureReady };
  for (const [key, value] of Object.entries(api)) {
    if (typeof value !== "function") continue;
    wrapped[key] = async (...args) => {
      await ensureReady();
      return value.apply(api, args);
    };
  }
  return wrapped;
}

/**
 * Cold-start: Personal runtime is created light (orphan reconcile deferred inside
 * createPersonalAgentRuntime). Channel plugin initialize() is lazy — first IPC
 * touch, not app boot. Skills global scan lives in skills-scan.mjs (cached on demand).
 *
 * @param {{
 *   app?: { getPath: (name: string) => string },
 *   runtimeManager?: object,
 *   readWorkspaceState?: () => Promise<{ workspaces?: Array<object> }>,
 *   claudeProjectsRoot?: () => string,
 *   deferStartupReconcileMs?: number,
 * }} [options]
 */
export function createDesktopPersonalRuntimeServices(options = {}) {
  const app = options.app;
  const runtimeManager = options.runtimeManager;
  const readWorkspaceState = options.readWorkspaceState;
  if (!app || typeof app.getPath !== "function") {
    throw new Error("app with getPath is required");
  }
  if (!runtimeManager) throw new Error("runtimeManager is required");
  if (typeof readWorkspaceState !== "function") {
    throw new Error("readWorkspaceState is required");
  }

  const deferStartupReconcileMs = Math.max(
    0,
    Number(options.deferStartupReconcileMs ?? 8_000) || 0,
  );

  const personalAgentLegacyHarness = createPersonalAgentLegacyHarness({
    runtimePathEntries: () => runtimeManager.runtimePathEntries(),
  });
  const personalAgentRuntime = createPersonalAgentRuntime({
    userDataDir: app.getPath("userData"),
    engineInfo: () => runtimeManager.engineInfo(),
    onmyagentServerInfo: () => runtimeManager.onmyagentServerInfo(),
    legacy: personalAgentLegacyHarness,
    bundledExtensionRoots: bundledExtensionRootPaths(),
    // Defer orphan/process reconcile off the critical cold-start path.
    deferStartupReconcileMs,
  });
  const personalAgentHeartbeatScheduler = createPersonalAgentHeartbeatScheduler({
    personalAgentRuntime,
    listWorkspaceRoots: async () =>
      (await readWorkspaceState()).workspaces
        .filter((entry) => entry?.workspaceType !== "remote")
        .map((entry) => String(entry?.path ?? "").trim())
        .filter(Boolean),
  });
  const personalAgentNativeSessions = createPersonalAgentNativeSessionBridge({
    detectPersonalLocalAgent: personalAgentLegacyHarness.detectAgent,
    runCommandCapture: personalAgentLegacyHarness.runCommandCapture,
    claudeProjectsRoot: options.claudeProjectsRoot,
  });
  const channels = createMessagingChannelServices({
    userDataDir: app.getPath("userData"),
    personalAgentRuntime,
  });

  // Lazy channel init: first API call / ensureChannelsReady, not boot.
  let channelsInitPromise = null;
  function ensureChannelsReady() {
    if (!channelsInitPromise) {
      channelsInitPromise = channels.initialize().catch((error) => {
        channelsInitPromise = null;
        console.error(
          "[runtime] Failed to initialize channel infrastructure:",
          error,
        );
        throw error;
      });
    }
    return channelsInitPromise;
  }

  const rawApi = channels.channelInfrastructureApi;
  const channelInfrastructureApi = wrapChannelApiForLazyInit(
    rawApi,
    ensureChannelsReady,
  );

  return {
    personalAgentLegacyHarness,
    personalAgentRuntime,
    personalAgentHeartbeatScheduler,
    personalAgentNativeSessions,
    weixinService: channels.weixinService,
    feishuService: channels.feishuService,
    telegramService: channels.telegramService,
    discordService: channels.discordService,
    channelInfrastructureApi,
    channelInfrastructure: channels,
    ensureChannelsReady,
  };
}
