#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";

import { parseCliArgs, printHelp, resolveServerConfig } from "./config.js";
import { createManagedOpencodeServer, type ManagedOpencodeServer } from "./managed-opencode.js";
import { createServerLogger, startServer } from "./server.js";
import { ensureAllWorkspaceFiles } from "./workspace/workspace-init.js";
import { onmyagentExtensionsPreviewPluginPath } from "./onmyagent-extensions-plugin-path.js";
import {
  preparePrimaryRuntimeBootstrap,
  readPrimaryOpencodeRuntimeIdentity,
  readPrimaryRuntimeDataRoot,
  stopPrimaryRuntimeHostLifecycle,
  type PrimaryRuntimeBackfillReport,
} from "./services/primary-runtime-bootstrap.js";
import pkg from "../package.json" with { type: "json" };

const args = parseCliArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.version) {
  console.log(pkg.version);
  process.exit(0);
}

const config = await resolveServerConfig(args);
const logger = createServerLogger(config);
const primaryRuntimeDataRoot = readPrimaryRuntimeDataRoot();
const primaryOpencodeRuntimeIdentity = await readPrimaryOpencodeRuntimeIdentity();
const runtimeBootstrap = await preparePrimaryRuntimeBootstrap({
  config,
  dataRoot: primaryRuntimeDataRoot,
  opencodeRuntimeIdentity: primaryOpencodeRuntimeIdentity ?? undefined,
  onReport: (report) => logPrimaryRuntimeBackfillReport(logger, report),
});
const serverUrl = `http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${config.port}`;
let managedOpencode: ManagedOpencodeServer | null = null;
let server: Awaited<ReturnType<typeof startServer>> | null = null;

try {
  if (!config.readOnly) {
    const refresh = await ensureAllWorkspaceFiles(config.workspaces, {
      log: (level, message, meta) => {
        logger.log(level === "warn" ? "warn" : "info", message, meta);
      },
    });
    if (refresh.failed > 0) {
      logger.log(
        "warn",
        `Refreshed ${refresh.ok} workspace(s); ${refresh.failed} failed`,
        { errors: refresh.errors },
      );
    } else if (refresh.ok > 0) {
      logger.log(
        "info",
        `Refreshed managed .opencode files for ${refresh.ok} workspace(s)`,
        { changed: refresh.changed },
      );
    }
  }

  if (!config.opencodeBaseUrl && process.env.ONMYAGENT_MANAGE_OPENCODE === "1") {
    const workspace = config.workspaces[0];
    if (workspace?.path) {
      const onmyagentExtensionsPreviewConfig = JSON.stringify({
        plugin: [onmyagentExtensionsPreviewPluginPath()],
      });
      const managedOpencodeCwd = process.env.ONMYAGENT_MANAGED_OPENCODE_CWD?.trim()
        || workspace.path;
      await mkdir(managedOpencodeCwd, { recursive: true });
      managedOpencode = await createManagedOpencodeServer({
        bin: process.env.ONMYAGENT_OPENCODE_BIN,
        cwd: managedOpencodeCwd,
        env: {
          ...(process.env.ONMYAGENT_DEV_MODE
            ? { ONMYAGENT_DEV_MODE: process.env.ONMYAGENT_DEV_MODE }
            : {}),
          ONMYAGENT_SERVER_URL: serverUrl,
          ONMYAGENT_SERVER_TOKEN: config.token,
          OPENCODE_CONFIG_CONTENT: onmyagentExtensionsPreviewConfig,
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
      logger.log("info", `Managed OpenCode listening on ${managedOpencode.url}`);
    }
  }

  server = await startServer(config, {
    primaryRuntime: {
      dataRoot: primaryRuntimeDataRoot,
      ...(primaryOpencodeRuntimeIdentity
        ? { opencodeIdentity: primaryOpencodeRuntimeIdentity }
        : {}),
    },
  });
  const runningServer = server;
  runtimeBootstrap.start();

  const url = `http://${config.host}:${runningServer.port}`;
  logger.log("info", `OnMyAgent server listening on ${url}`);

  if (config.tokenSource === "generated") {
    logger.log("info", `Client token: ${config.token}`);
  }

  if (config.hostTokenSource === "generated") {
    logger.log("info", `Host token: ${config.hostToken}`);
  }

  if (config.workspaces.length === 0) {
    logger.log("info", "No workspaces configured. Add --workspace or update server.json.");
  } else {
    logger.log("info", `Workspaces: ${config.workspaces.length}`);
  }

  if (args.verbose) {
    logger.log("info", `Config path: ${config.configPath ?? "unknown"}`);
    logger.log("info", `Read-only: ${config.readOnly ? "true" : "false"}`);
    logger.log("info", `Approval: ${config.approval.mode} (${config.approval.timeoutMs}ms)`);
    logger.log("info", `CORS origins: ${config.corsOrigins.join(", ")}`);
    logger.log("info", `Authorized roots: ${config.authorizedRoots.join(", ")}`);
    logger.log("info", `Token source: ${config.tokenSource}`);
    logger.log("info", `Host token source: ${config.hostTokenSource}`);
  }

  const shutdown = async () => {
    await stopPrimaryRuntimeHostLifecycle({
      bootstrap: runtimeBootstrap,
      stopServerOwners: () => Promise.resolve(runningServer.stop()),
      stopManagedRuntime: () => managedOpencode?.close(),
    });
  };

  const shutdownAndExit = () => {
    void shutdown().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdownAndExit);
  process.once("SIGTERM", shutdownAndExit);
} catch (error) {
  await stopPrimaryRuntimeHostLifecycle({
    bootstrap: runtimeBootstrap,
    stopServerOwners: () => server
      ? Promise.resolve(server.stop())
      : Promise.resolve(),
    stopManagedRuntime: () => managedOpencode?.close(),
  });
  throw error;
}

function logPrimaryRuntimeBackfillReport(
  logger: ReturnType<typeof createServerLogger>,
  report: PrimaryRuntimeBackfillReport,
): void {
  logger.log(report.level, report.code, {
    ...report.counts,
    reasonCounts: report.reasonCounts,
  });
}
