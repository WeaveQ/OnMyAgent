import {
  type ChildProcess,
} from "node:child_process";

import {
  randomUUID,
} from "node:crypto";

import {
  createServer as createHttpServer,
} from "node:http";

import {
  resolve,
} from "node:path";

import {
  createOpencodeClient,
} from "@opencode-ai/sdk/v2/client";

import {
  assertManagedOpencodeAuth,
  encodeBasicAuth,
  resolveManagedOpencodeCredentials,
  resolveManagedOpencodeHost,
} from "../runtime-auth.js";

import {
  waitForOpencodeHealthy,
} from "../runtime-health.js";

import {
  startOpencode,
  stopChild,
} from "../runtime-services.js";

import {
  resolveSidecarConfig,
} from "../sidecar-config.js";

import {
  resolveRouterDataDir,
} from "../data-dir.js";

import {
  readVersionManifest,
} from "../version-manifest.js";

import {
  createLogger,
} from "../cli-logging.js";

import {
  type ParsedArgs,
  parseList,
  readBinarySource,
  readBool,
  readFlag,
  readLogFormat,
  readNumber,
  readOpencodeHotReload,
} from "../cli-args.js";

import {
  type RouterWorkspace,
  DEFAULT_OPENCODE_HOT_RELOAD_COOLDOWN_MS,
  DEFAULT_OPENCODE_HOT_RELOAD_DEBOUNCE_MS,
  createVerboseLogger,
  ensureOpencodeManagedTools,
  ensureOpencodeStateLayout,
  ensureRouterDaemon,
  ensureWorkspace,
  fetchJson,
  findWorkspace,
  isProcessAlive,
  loadRouterState,
  nowMs,
  outputError,
  outputResult,
  requestRouter,
  resolveCliVersion,
  resolveInternalDevMode,
  resolveOpencodeBin,
  resolveOpencodeLogLevel,
  resolveOpencodeStateLayout,
  resolvePort,
  routerStatePath,
  saveRouterState,
  unwrap,
  verifyOpencodeVersion,
  workspaceIdForLocal,
  workspaceIdForRemote,
} from "../cli-shared.js";

export async function runDaemonCommand(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const subcommand = args.positionals[1] ?? "run";

  try {
    if (subcommand === "run" || subcommand === "foreground") {
      await runRouterDaemon(args);
      return;
    }
    if (subcommand === "start") {
      const { baseUrl } = await ensureRouterDaemon(args, true);
      const status = await fetchJson(`${baseUrl.replace(/\/$/, "")}/health`);
      outputResult({ ok: true, baseUrl, ...status }, outputJson);
      return;
    }
    if (subcommand === "status") {
      const { baseUrl } = await ensureRouterDaemon(args, false);
      const status = await fetchJson(`${baseUrl.replace(/\/$/, "")}/health`);
      outputResult({ ok: true, baseUrl, ...status }, outputJson);
      return;
    }
    if (subcommand === "stop") {
      const { baseUrl } = await ensureRouterDaemon(args, false);
      await fetchJson(`${baseUrl.replace(/\/$/, "")}/shutdown`, {
        method: "POST",
      });
      outputResult({ ok: true }, outputJson);
      return;
    }
    throw new Error("daemon requires start|stop|status|run");
  } catch (error) {
    outputError(error, outputJson);
    process.exitCode = 1;
  }
}

export async function runWorkspaceCommand(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const subcommand = args.positionals[1];
  const id = args.positionals[2];

  try {
    if (subcommand === "add") {
      if (!id) throw new Error("workspace path is required");
      const name = readFlag(args.flags, "name");
      const result = await requestRouter(args, "POST", "/workspaces", {
        path: id,
        name: name ?? null,
      });
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    if (subcommand === "add-remote") {
      if (!id) throw new Error("baseUrl is required");
      const directory = readFlag(args.flags, "directory");
      const name = readFlag(args.flags, "name");
      const result = await requestRouter(args, "POST", "/workspaces/remote", {
        baseUrl: id,
        directory: directory ?? null,
        name: name ?? null,
      });
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    if (subcommand === "list") {
      const result = await requestRouter(args, "GET", "/workspaces");
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    if (subcommand === "switch") {
      if (!id) throw new Error("workspace id is required");
      const result = await requestRouter(
        args,
        "POST",
        `/workspaces/${encodeURIComponent(id)}/activate`,
      );
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    if (subcommand === "info") {
      if (!id) throw new Error("workspace id is required");
      const result = await requestRouter(
        args,
        "GET",
        `/workspaces/${encodeURIComponent(id)}`,
      );
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    if (subcommand === "path") {
      if (!id) throw new Error("workspace id is required");
      const result = await requestRouter(
        args,
        "GET",
        `/workspaces/${encodeURIComponent(id)}/path`,
      );
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    throw new Error("workspace requires add|add-remote|list|switch|info|path");
  } catch (error) {
    outputError(error, outputJson);
    process.exitCode = 1;
  }
}

export async function runInstanceCommand(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const subcommand = args.positionals[1];
  const id = args.positionals[2];

  try {
    if (subcommand === "dispose") {
      if (!id) throw new Error("workspace id is required");
      const result = await requestRouter(
        args,
        "POST",
        `/instances/${encodeURIComponent(id)}/dispose`,
      );
      outputResult({ ok: true, ...result }, outputJson);
      return;
    }
    throw new Error("instance requires dispose");
  } catch (error) {
    outputError(error, outputJson);
    process.exitCode = 1;
  }
}

export async function runRouterDaemon(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const verbose = readBool(args.flags, "verbose", false, "ONMYAGENT_VERBOSE");
  const logFormat = readLogFormat(
    args.flags,
    "log-format",
    "pretty",
    "ONMYAGENT_LOG_FORMAT",
  );
  const colorEnabled =
    readBool(args.flags, "color", process.stdout.isTTY, "ONMYAGENT_COLOR") &&
    !process.env.NO_COLOR;
  const runId =
    readFlag(args.flags, "run-id") ??
    process.env.ONMYAGENT_RUN_ID ??
    randomUUID();
  const cliVersion = await resolveCliVersion();
  const logger = createLogger({
    format: logFormat,
    runId,
    serviceName: "onmyagent-orchestrator",
    serviceVersion: cliVersion,
    output: "stdout",
    color: colorEnabled,
  });
  const logVerbose = createVerboseLogger(
    verbose && !outputJson,
    logger,
    "onmyagent-orchestrator",
  );
  const sidecarSourceInput = readBinarySource(
    args.flags,
    "sidecar-source",
    "auto",
    "ONMYAGENT_SIDECAR_SOURCE",
  );
  const opencodeSourceInput = readBinarySource(
    args.flags,
    "opencode-source",
    "auto",
    "ONMYAGENT_OPENCODE_SOURCE",
  );
  const sidecarSource = sidecarSourceInput;
  const opencodeSource = opencodeSourceInput;
  const dataDir = resolveRouterDataDir(args.flags, readFlag);
  const statePath = routerStatePath(dataDir);
  let state = await loadRouterState(statePath);

  const host = readFlag(args.flags, "daemon-host") ?? "127.0.0.1";
  const port = await resolvePort(
    readNumber(args.flags, "daemon-port", undefined, "ONMYAGENT_DAEMON_PORT"),
    "127.0.0.1",
  );

  const opencodeBin =
    readFlag(args.flags, "opencode-bin") ?? process.env.ONMYAGENT_OPENCODE_BIN;
  assertManagedOpencodeAuth(args);
  const opencodeHost = resolveManagedOpencodeHost(
    readFlag(args.flags, "opencode-host") ?? process.env.ONMYAGENT_OPENCODE_HOST,
  );
  const opencodeCredentials = resolveManagedOpencodeCredentials(args);
  const opencodeUsername = opencodeCredentials.username;
  const opencodePassword = opencodeCredentials.password;
  const authHeaders = {
    Authorization: `Basic ${encodeBasicAuth(opencodeCredentials.username, opencodeCredentials.password)}`,
  };
  const opencodePort = await resolvePort(
    readNumber(
      args.flags,
      "opencode-port",
      state.opencode?.port,
      "ONMYAGENT_OPENCODE_PORT",
    ),
    "127.0.0.1",
    state.opencode?.port,
  );
  const opencodeLogLevel = resolveOpencodeLogLevel(
    readFlag(args.flags, "opencode-log-level") ??
      process.env.ONMYAGENT_OPENCODE_LOG_LEVEL,
  );
  const opencodeHotReload = readOpencodeHotReload(
    args.flags,
    {
      enabled: true,
      debounceMs: DEFAULT_OPENCODE_HOT_RELOAD_DEBOUNCE_MS,
      cooldownMs: DEFAULT_OPENCODE_HOT_RELOAD_COOLDOWN_MS,
    },
    {
      enabled: "ONMYAGENT_OPENCODE_HOT_RELOAD",
      debounceMs: "ONMYAGENT_OPENCODE_HOT_RELOAD_DEBOUNCE_MS",
      cooldownMs: "ONMYAGENT_OPENCODE_HOT_RELOAD_COOLDOWN_MS",
    },
  );
  const corsValue =
    readFlag(args.flags, "cors") ??
    process.env.ONMYAGENT_OPENCODE_CORS ??
    "http://localhost:5173";
  const corsOrigins = parseList(corsValue);
  const opencodeWorkdirFlag =
    readFlag(args.flags, "opencode-workdir") ??
    process.env.ONMYAGENT_OPENCODE_WORKDIR;
  const activeWorkspace = state.workspaces.find(
    (entry) => entry.id === state.activeId && entry.workspaceType === "local",
  );
  const opencodeWorkdir =
    opencodeWorkdirFlag ?? activeWorkspace?.path ?? process.cwd();
  const resolvedWorkdir = await ensureWorkspace(opencodeWorkdir);
  const devMode = resolveInternalDevMode(args.flags);
  const opencodeStateLayout = await resolveOpencodeStateLayout({
    dataDir,
    workspace: resolvedWorkdir,
    devMode,
  });
  const opencodeConfigDir = opencodeStateLayout.configDir;
  await ensureOpencodeStateLayout(opencodeStateLayout);
  await ensureOpencodeManagedTools(opencodeConfigDir);
  logger.info(
    "Daemon starting",
    { runId, logFormat, workdir: resolvedWorkdir, host, port },
    "onmyagent-orchestrator",
  );

  const sidecar = resolveSidecarConfig(args.flags, cliVersion, readFlag);
  const allowExternal = readBool(
    args.flags,
    "allow-external",
    false,
    "ONMYAGENT_ALLOW_EXTERNAL",
  );
  const manifest = await readVersionManifest();
  logVerbose(`cli version: ${cliVersion}`);
  logVerbose(`sidecar target: ${sidecar.target ?? "unknown"}`);
  logVerbose(`sidecar dir: ${sidecar.dir}`);
  logVerbose(`sidecar base URL: ${sidecar.baseUrl}`);
  logVerbose(`sidecar manifest: ${sidecar.manifestUrl}`);
  logVerbose(`sidecar source: ${sidecarSource}`);
  logVerbose(`opencode source: ${opencodeSource}`);
  logVerbose(
    `opencode hot reload: ${opencodeHotReload.enabled ? "on" : "off"} (debounce=${opencodeHotReload.debounceMs}ms cooldown=${opencodeHotReload.cooldownMs}ms)`,
  );
  logVerbose(`allow external: ${allowExternal ? "true" : "false"}`);
  let opencodeBinary = await resolveOpencodeBin({
    explicit: opencodeBin,
    manifest,
    allowExternal,
    sidecar,
    source: opencodeSource,
  });
  logVerbose(`opencode bin: ${opencodeBinary.bin} (${opencodeBinary.source})`);

  let opencodeChild: ChildProcess | null = null;

  const updateDiagnostics = (actualVersion?: string) => {
    state.cliVersion = cliVersion;
    state.sidecar = {
      dir: sidecar.dir,
      baseUrl: sidecar.baseUrl,
      manifestUrl: sidecar.manifestUrl,
      target: sidecar.target,
      source: sidecarSource,
      opencodeSource,
      allowExternal,
    };
    state.binaries = {
      opencode: {
        path: opencodeBinary.bin,
        source: opencodeBinary.source,
        expectedVersion: opencodeBinary.expectedVersion,
        actualVersion,
      },
    };
  };

  const ensureOpencode = async () => {
    const existing = state.opencode;
    if (existing && isProcessAlive(existing.pid)) {
      const client = createOpencodeClient({
        baseUrl: existing.baseUrl,
        directory: resolvedWorkdir,
        headers: authHeaders,
      });
      try {
        await waitForOpencodeHealthy(client, 2000, 200);
        if (!state.sidecar || !state.cliVersion || !state.binaries?.opencode) {
          updateDiagnostics(state.binaries?.opencode?.actualVersion);
          await saveRouterState(statePath, state);
        }
        return { baseUrl: existing.baseUrl, client };
      } catch {
        // restart
      }
    }

    if (opencodeChild) {
      await stopChild(opencodeChild);
    }

    const opencodeActualVersion = await verifyOpencodeVersion(opencodeBinary);
    logVerbose(`opencode version: ${opencodeActualVersion ?? "unknown"}`);
    const child = await startOpencode({
      bin: opencodeBinary.bin,
      workspace: resolvedWorkdir,
      stateLayout: opencodeStateLayout,
      hotReload: opencodeHotReload,
      bindHost: opencodeHost,
      port: opencodePort,
      username: opencodeCredentials.username,
      password: opencodeCredentials.password,
      corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
      logger,
      runId,
      logFormat,
      logLevel: opencodeLogLevel,
    });
    opencodeChild = child;
    logger.info("Process spawned", { pid: child.pid ?? 0 }, "opencode");
    const baseUrl = `http://${opencodeHost}:${opencodePort}`;
    const client = createOpencodeClient({
      baseUrl,
      directory: resolvedWorkdir,
      headers: authHeaders,
    });
    logger.info("Waiting for health", { url: baseUrl }, "opencode");
    await waitForOpencodeHealthy(client);
    logger.info("Healthy", { url: baseUrl }, "opencode");
    state.opencode = {
      pid: child.pid ?? 0,
      port: opencodePort,
      baseUrl,
      startedAt: nowMs(),
    };
    updateDiagnostics(opencodeActualVersion);
    await saveRouterState(statePath, state);
    return { baseUrl, client };
  };

  await ensureOpencode();

  const server = createHttpServer(async (req, res) => {
    const startedAt = Date.now();
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    res.on("finish", () => {
      logger.info(
        "Router request",
        {
          method,
          path: url.pathname,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
          activeId: state.activeId,
        },
        "onmyagent-orchestrator-router",
      );
    });
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    const parts = url.pathname.split("/").filter(Boolean);

    const send = (status: number, payload: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(payload));
    };

    const readBody = async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      if (!chunks.length) return null;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return null;
      return JSON.parse(raw);
    };

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        send(200, {
          ok: true,
          daemon: state.daemon ?? null,
          opencode: state.opencode ?? null,
          activeId: state.activeId,
          workspaceCount: state.workspaces.length,
          cliVersion: state.cliVersion ?? null,
          sidecar: state.sidecar ?? null,
          binaries: state.binaries ?? null,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/workspaces") {
        send(200, { activeId: state.activeId, workspaces: state.workspaces });
        return;
      }

      if (req.method === "POST" && url.pathname === "/workspaces") {
        const body = await readBody();
        const pathInput =
          typeof body?.path === "string" ? body.path.trim() : "";
        if (!pathInput) {
          send(400, { error: "path is required" });
          return;
        }
        const resolved = await ensureWorkspace(pathInput);
        const id = workspaceIdForLocal(resolved);
        const name =
          typeof body?.name === "string" && body.name.trim()
            ? body.name.trim()
            : (resolved.split(/[\\/]/).filter(Boolean).pop() ?? "Workspace");
        const existing = state.workspaces.find((entry) => entry.id === id);
        const entry: RouterWorkspace = {
          id,
          name,
          path: resolved,
          workspaceType: "local",
          createdAt: existing?.createdAt ?? nowMs(),
          lastUsedAt: nowMs(),
        };
        state.workspaces = state.workspaces.filter((item) => item.id !== id);
        state.workspaces.push(entry);
        if (!state.activeId) state.activeId = id;
        await saveRouterState(statePath, state);
        send(200, { activeId: state.activeId, workspace: entry });
        return;
      }

      if (req.method === "POST" && url.pathname === "/workspaces/remote") {
        const body = await readBody();
        const baseUrl =
          typeof body?.baseUrl === "string" ? body.baseUrl.trim() : "";
        if (
          !baseUrl ||
          (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://"))
        ) {
          send(400, { error: "baseUrl must start with http:// or https://" });
          return;
        }
        const directory =
          typeof body?.directory === "string" ? body.directory.trim() : "";
        const id = workspaceIdForRemote(baseUrl, directory || undefined);
        const name =
          typeof body?.name === "string" && body.name.trim()
            ? body.name.trim()
            : baseUrl;
        const existing = state.workspaces.find((entry) => entry.id === id);
        const entry: RouterWorkspace = {
          id,
          name,
          path: directory,
          workspaceType: "remote",
          baseUrl,
          directory: directory || undefined,
          createdAt: existing?.createdAt ?? nowMs(),
          lastUsedAt: nowMs(),
        };
        state.workspaces = state.workspaces.filter((item) => item.id !== id);
        state.workspaces.push(entry);
        if (!state.activeId) state.activeId = id;
        await saveRouterState(statePath, state);
        send(200, { activeId: state.activeId, workspace: entry });
        return;
      }

      if (
        parts[0] === "workspaces" &&
        parts.length === 2 &&
        req.method === "GET"
      ) {
        const workspace = findWorkspace(
          state,
          decodeURIComponent(parts[1] ?? ""),
        );
        if (!workspace) {
          send(404, { error: "workspace not found" });
          return;
        }
        send(200, { workspace });
        return;
      }

      if (
        parts[0] === "workspaces" &&
        parts.length === 3 &&
        parts[2] === "activate" &&
        req.method === "POST"
      ) {
        const workspace = findWorkspace(
          state,
          decodeURIComponent(parts[1] ?? ""),
        );
        if (!workspace) {
          send(404, { error: "workspace not found" });
          return;
        }
        state.activeId = workspace.id;
        workspace.lastUsedAt = nowMs();
        await saveRouterState(statePath, state);
        send(200, { activeId: state.activeId, workspace });
        return;
      }

      if (
        parts[0] === "workspaces" &&
        parts.length === 3 &&
        parts[2] === "path" &&
        req.method === "GET"
      ) {
        const workspace = findWorkspace(
          state,
          decodeURIComponent(parts[1] ?? ""),
        );
        if (!workspace) {
          send(404, { error: "workspace not found" });
          return;
        }
        const isRemote = workspace.workspaceType === "remote";
        const baseUrl = isRemote
          ? (workspace.baseUrl ?? "")
          : (await ensureOpencode()).baseUrl;
        if (!baseUrl) {
          send(400, { error: "workspace baseUrl missing" });
          return;
        }
        const directory = isRemote
          ? (workspace.directory ?? "")
          : workspace.path;
        const client = createOpencodeClient({
          baseUrl,
          directory: directory ? directory : undefined,
          headers: authHeaders,
        });
        const pathInfo = unwrap(await client.path.get());
        workspace.lastUsedAt = nowMs();
        await saveRouterState(statePath, state);
        send(200, { workspace, path: pathInfo });
        return;
      }

      if (
        parts[0] === "instances" &&
        parts.length === 3 &&
        parts[2] === "dispose" &&
        req.method === "POST"
      ) {
        const workspace = findWorkspace(
          state,
          decodeURIComponent(parts[1] ?? ""),
        );
        if (!workspace) {
          send(404, { error: "workspace not found" });
          return;
        }
        const isRemote = workspace.workspaceType === "remote";
        const baseUrl = isRemote
          ? (workspace.baseUrl ?? "")
          : (await ensureOpencode()).baseUrl;
        if (!baseUrl) {
          send(400, { error: "workspace baseUrl missing" });
          return;
        }
        const directory = isRemote
          ? (workspace.directory ?? "")
          : workspace.path;
        const response = await fetch(
          `${baseUrl.replace(/\/$/, "")}/instance/dispose?directory=${encodeURIComponent(directory)}`,
          { method: "POST", headers: authHeaders },
        );
        const ok = response.ok ? await response.json() : false;
        workspace.lastUsedAt = nowMs();
        await saveRouterState(statePath, state);
        send(200, { disposed: ok });
        return;
      }

      if (req.method === "POST" && url.pathname === "/shutdown") {
        send(200, { ok: true });
        await shutdown();
        return;
      }

      send(404, { error: "not found" });
    } catch (error) {
      send(500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const shutdown = async () => {
    logger.info(
      "Daemon shutting down",
      { host, port },
      "onmyagent-orchestrator-router",
    );
    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } catch {
      // ignore
    }

    if (opencodeChild) {
      await stopChild(opencodeChild);
      opencodeChild = null;
    }

    state.daemon = undefined;
    if (state.opencode && !isProcessAlive(state.opencode.pid)) {
      state.opencode = undefined;
    }
    await saveRouterState(statePath, state);
    process.exit(0);
  };

  server.listen(port, host, async () => {
    state.daemon = {
      pid: process.pid,
      port,
      baseUrl: `http://${host}:${port}`,
      startedAt: nowMs(),
    };
    await saveRouterState(statePath, state);
    if (outputJson) {
      outputResult({ ok: true, daemon: state.daemon }, true);
    } else {
      if (logFormat === "json") {
        logger.info(
          "Daemon running",
          { host, port },
          "onmyagent-orchestrator-router",
        );
      } else {
        console.log(`orchestrator daemon running on ${host}:${port}`);
      }
    }
  });

  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());
  await new Promise(() => undefined);
}

