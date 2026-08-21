/**
 * Single entry point for embedding the OnMyAgent server in-process.
 *
 * Handles config resolution, managed OpenCode spawn, and server start
 * in one call -- mirrors what cli.ts does but returns a handle instead
 * of owning the process lifecycle.
 */
import { mkdir } from "node:fs/promises";
import { resolveServerConfig, type CliArgs } from "./config.js";
import { createManagedOpencodeServer, type ManagedOpencodeServer } from "./managed-opencode.js";
import { startServer } from "./server.js";
import { ensureAllWorkspaceFiles } from "./workspace/workspace-init.js";
import { onmyagentExtensionsPreviewPluginPath } from "./onmyagent-extensions-plugin-path.js";
import type { ServeResult } from "./serve-node.js";
import type { ServerConfig } from "@onmyagent/types/server";

export type EmbeddedServerOptions = CliArgs & {
  /** When true, spawn a managed OpenCode child process. */
  manageOpencode?: boolean;
  /** Path to the OpenCode binary. Falls back to ONMYAGENT_OPENCODE_BIN env. */
  opencodeBin?: string;
  /** Working directory for the managed OpenCode process. */
  opencodeCwd?: string;
  /** Re-materialize runtime skill links after a global skill import. */
  onGlobalSkillsChanged?: () => Promise<unknown>;
};

export type EmbeddedServerHandle = {
  /** Bound port the HTTP server is listening on. */
  port: number;
  /** Full base URL, e.g. http://127.0.0.1:48123 */
  url: string;
  /** The resolved server config (with OpenCode URLs populated). */
  config: ServerConfig;
  /** Stop the HTTP server and managed OpenCode (if any). */
  stop: () => Promise<void>;
};

const DEFERRED_WORKSPACE_SYNC_GRACE_MS = 2_000;

/**
 * Schedule non-active workspace maintenance after the first interactive
 * server window. The returned stop function cancels an unstarted timer and
 * makes the continuation predicate false for an already-running sync.
 */
export function scheduleDeferredWorkspaceSync(input: {
  delayMs?: number;
  run: (shouldContinue: () => boolean) => Promise<void>;
  onError: (error: unknown) => void;
}): () => Promise<void> {
  let accepting = true;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null;
    if (!accepting) return;
    const task = input.run(() => accepting).catch(input.onError);
    running = task;
    void task.then(() => {
      if (running === task) running = null;
    });
  }, input.delayMs ?? DEFERRED_WORKSPACE_SYNC_GRACE_MS);

  return async () => {
    accepting = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    await running;
  };
}

/**
 * OpenCode 1.18.18 caches `models.json` only when the URL is omitted (default
 * `https://models.opencode.ai`) or equals that host. Injecting models.dev
 * hashes the cache filename and ignores the seeded snapshot.
 * Return null when the user did not override, so we do not set the env.
 */
export function resolveOpencodeModelsUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw =
    env.OPENCODE_MODELS_URL?.trim() ||
    env.ONMYAGENT_OPENCODE_MODELS_URL?.trim() ||
    (env.ONMYAGENT_MODELS_LOCAL === "1" ? "http://localhost:8791/models" : "");
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export async function startEmbeddedServer(options: EmbeddedServerOptions): Promise<EmbeddedServerHandle> {
  const config = await resolveServerConfig(options);
  const serverUrl = `http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${config.port}`;
  // Do not default OPENCODE_MODELS_URL: OpenCode 1.18.18 already uses
  // models.opencode.ai and models.json. models.onmyagentlabs.com is not live.
  // Opt into localhost:8791 with ONMYAGENT_MODELS_LOCAL=1.
  const opencodeModelsUrl = resolveOpencodeModelsUrl();

  // Spawn managed OpenCode if requested and no explicit base URL was provided.
  let managedOpencode: ManagedOpencodeServer | null = null;

  // Desktop restart / server boot: make the active workspace ready before the
  // managed OpenCode/server path starts.  Re-syncing every known workspace is
  // retained below as deferred maintenance; doing it serially here made cold
  // start scale with the total number of saved workspaces.
  if (!config.readOnly) {
    await ensureAllWorkspaceFiles(config.workspaces.slice(0, 1), {
      log: (level, message, meta) => {
        const detail = meta ? ` ${JSON.stringify(meta)}` : "";
        console[level === "warn" ? "warn" : "log"](
          `[onmyagent-server] ${message}${detail}`,
        );
      },
    });
  }

  if (!config.opencodeBaseUrl && options.manageOpencode) {
    const workspace = config.workspaces[0];
    if (workspace?.path) {
      const onmyagentExtensionsPreviewConfig = JSON.stringify({
        plugin: [onmyagentExtensionsPreviewPluginPath()],
      });
      const cwd = options.opencodeCwd
        || process.env.ONMYAGENT_MANAGED_OPENCODE_CWD?.trim()
        || workspace.path;
      await mkdir(cwd, { recursive: true });

      managedOpencode = await createManagedOpencodeServer({
        bin: options.opencodeBin || process.env.ONMYAGENT_OPENCODE_BIN,
        cwd,
        env: {
          ...(process.env.ONMYAGENT_DEV_MODE ? { ONMYAGENT_DEV_MODE: process.env.ONMYAGENT_DEV_MODE } : {}),
          ONMYAGENT_SERVER_URL: serverUrl,
          ONMYAGENT_SERVER_TOKEN: config.token,
          OPENCODE_CONFIG_CONTENT: onmyagentExtensionsPreviewConfig,
          ...(opencodeModelsUrl ? { OPENCODE_MODELS_URL: opencodeModelsUrl } : {}),
        },
      });

      config.opencodeBaseUrl = managedOpencode.url;
      config.opencodeUsername = managedOpencode.username;
      config.opencodePassword = managedOpencode.password;
      for (const entry of config.workspaces) {
        entry.baseUrl ??= managedOpencode.url;
        entry.opencodeUsername ??= managedOpencode.username;
        entry.opencodePassword ??= managedOpencode.password;
        entry.directory ??= entry.path;
      }
    }
  }

  const server = await startServer(config, {
    onGlobalSkillsChanged: options.onGlobalSkillsChanged,
  });

  let stopDeferredWorkspaceSync: () => Promise<void> = async () => undefined;
  if (!config.readOnly && config.workspaces.length > 1) {
    // Keep product updates eventually consistent for every saved workspace,
    // without keeping the first usable server response behind unrelated disk
    // work. The loop checks the latch before each workspace, so stop() never
    // expands the maintenance work after shutdown begins.
    stopDeferredWorkspaceSync = scheduleDeferredWorkspaceSync({
      run: async (shouldContinue) => {
        await ensureAllWorkspaceFiles(config.workspaces.slice(1), {
          shouldContinue,
          log: (level, message, meta) => {
            const detail = meta ? ` ${JSON.stringify(meta)}` : "";
            console[level === "warn" ? "warn" : "log"](
              `[onmyagent-server] deferred ${message}${detail}`,
            );
          },
        });
      },
      onError: (error) => {
        console.warn(
          "[onmyagent-server] deferred workspace refresh failed",
          error,
        );
      },
    });
  }

  let stopping: Promise<void> | null = null;
  return {
    port: server.port,
    url: `http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${server.port}`,
    config,
    stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        await stopDeferredWorkspaceSync();
        managedOpencode?.close();
        await server.stop();
      })();
      return stopping;
    },
  };
}
