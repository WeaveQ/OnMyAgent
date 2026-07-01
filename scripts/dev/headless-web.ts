import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import path from "node:path";

const cwd = process.cwd();
const tmpDir = path.join(cwd, "tmp");

const ensureTmp = async () => {
  await mkdir(tmpDir, { recursive: true });
};

const isPortFree = (port: number, host: string) =>
  new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });

const getFreePort = (host: string) =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to resolve free port")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });

const resolvePort = async (value: string | undefined, host: string) => {
  if (value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      const free = await isPortFree(parsed, host);
      if (free) return parsed;
    }
  }
  return await getFreePort(host);
};

const logLine = (message: string) => {
  process.stdout.write(`${message}\n`);
};

const readBool = (value: string | undefined) => {
  const normalized = (value ?? "").trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
};

const silent = process.argv.includes("--silent");

const autoBuildEnabled =
  process.env.ONMYAGENT_DEV_HEADLESS_WEB_AUTOBUILD == null
    ? true
    : readBool(process.env.ONMYAGENT_DEV_HEADLESS_WEB_AUTOBUILD);

const runCommand = (command: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: silent ? "ignore" : "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });

const spawnLogged = (
  command: string,
  args: string[],
  logPath: string,
  env: NodeJS.ProcessEnv,
) => {
  const logFd = openSync(logPath, "w");
  return spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", logFd, logFd],
  });
};

const shutdown = (
  label: string,
  code: number | null,
  signal: NodeJS.Signals | null,
) => {
  const reason =
    code !== null ? `code ${code}` : signal ? `signal ${signal}` : "unknown";
  logLine(`[dev:headless-web] ${label} exited (${reason})`);
  process.exit(code ?? 1);
};

await ensureTmp();

const remoteAccessEnabled = readBool(process.env.ONMYAGENT_REMOTE_ACCESS);
const host = remoteAccessEnabled ? "0.0.0.0" : "127.0.0.1";
const viteHost = process.env.VITE_HOST ?? process.env.HOST ?? host;
const publicHost = process.env.ONMYAGENT_PUBLIC_HOST ?? null;
const clientHost = publicHost ?? (host === "0.0.0.0" ? "127.0.0.1" : host);
const workspace = process.env.ONMYAGENT_WORKSPACE ?? cwd;
const onmyagentPort = await resolvePort(process.env.ONMYAGENT_PORT, "127.0.0.1");
const webPort = await resolvePort(process.env.ONMYAGENT_WEB_PORT, "127.0.0.1");
const onmyagentToken = process.env.ONMYAGENT_TOKEN ?? randomUUID();
const onmyagentHostToken = process.env.ONMYAGENT_HOST_TOKEN ?? randomUUID();
const onmyagentServerBin = path.join(
  cwd,
  "apps/server/dist/bin/onmyagent-server",
);

const ensureOpenworkServer = async () => {
  try {
    await access(onmyagentServerBin);
  } catch {
    if (!autoBuildEnabled) {
      logLine(
        `[dev:headless-web] Missing OnMyAgent server binary at ${onmyagentServerBin}`,
      );
      logLine(
        "[dev:headless-web] Auto-build disabled (ONMYAGENT_DEV_HEADLESS_WEB_AUTOBUILD=0)",
      );
      logLine(
        "[dev:headless-web] Run: pnpm --filter onmyagent-server build:bin",
      );
      logLine(
        "[dev:headless-web] Or unset/enable ONMYAGENT_DEV_HEADLESS_WEB_AUTOBUILD to auto-build.",
      );
      process.exit(1);
    }

    logLine(
      `[dev:headless-web] Missing OnMyAgent server binary at ${onmyagentServerBin}`,
    );
    logLine(
      "[dev:headless-web] Auto-building: pnpm --filter onmyagent-server build:bin",
    );
    try {
      await runCommand("pnpm", ["--filter", "onmyagent-server", "build:bin"]);
      await access(onmyagentServerBin);
    } catch (error) {
      logLine(
        `[dev:headless-web] Auto-build failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  }
};

const onmyagentUrl = `http://${clientHost}:${onmyagentPort}`;
const webUrl = `http://${clientHost}:${webPort}`;
const opencodeRouterEnabled =
  process.env.ONMYAGENT_DEV_OPENCODE_ROUTER == null
    ? false
    : readBool(process.env.ONMYAGENT_DEV_OPENCODE_ROUTER);
const opencodeRouterRequired = readBool(
  process.env.ONMYAGENT_DEV_OPENCODE_ROUTER_REQUIRED,
);
const viteEnv = {
  ...process.env,
  HOST: viteHost,
  PORT: String(webPort),
  VITE_ONMYAGENT_URL: process.env.VITE_ONMYAGENT_URL ?? onmyagentUrl,
  VITE_ONMYAGENT_PORT: process.env.VITE_ONMYAGENT_PORT ?? String(onmyagentPort),
  VITE_ONMYAGENT_TOKEN: process.env.VITE_ONMYAGENT_TOKEN ?? onmyagentToken,
};
const headlessEnv = {
  ...process.env,
  ONMYAGENT_WORKSPACE: workspace,
  ONMYAGENT_HOST: host,
  ONMYAGENT_REMOTE_ACCESS: remoteAccessEnabled ? "1" : "0",
  ONMYAGENT_PORT: String(onmyagentPort),
  ONMYAGENT_TOKEN: onmyagentToken,
  ONMYAGENT_HOST_TOKEN: onmyagentHostToken,
  ONMYAGENT_SERVER_BIN: onmyagentServerBin,
  ONMYAGENT_SIDECAR_SOURCE: process.env.ONMYAGENT_SIDECAR_SOURCE ?? "external",
};

await ensureOpenworkServer();

logLine("[dev:headless-web] Starting services");
logLine(`[dev:headless-web] Workspace: ${workspace}`);
logLine(`[dev:headless-web] OnMyAgent server: ${onmyagentUrl}`);
logLine(`[dev:headless-web] Web host: ${viteHost}`);
logLine(`[dev:headless-web] Web port: ${webPort}`);
logLine(`[dev:headless-web] Web URL: ${webUrl}`);
logLine(
  `[dev:headless-web] OpenCodeRouter: ${opencodeRouterEnabled ? "external" : "off"}`,
);
logLine("[dev:headless-web] ONMYAGENT_TOKEN: [REDACTED]");
logLine("[dev:headless-web] ONMYAGENT_HOST_TOKEN: [REDACTED]");
logLine(
  `[dev:headless-web] Web logs: ${path.relative(cwd, path.join(tmpDir, "dev-web.log"))}`,
);
logLine(
  `[dev:headless-web] Headless logs: ${path.relative(cwd, path.join(tmpDir, "dev-headless.log"))}`,
);

const webProcess = spawnLogged(
  "pnpm",
  [
    "--filter",
    "@onmyagent/app",
    "exec",
    "vite",
    "--host",
    viteHost,
    "--port",
    String(webPort),
    "--strictPort",
  ],
  path.join(tmpDir, "dev-web.log"),
  viteEnv,
);

const headlessProcess = spawnLogged(
  "pnpm",
  [
    "--filter",
    "onmyagent-orchestrator",
    "dev",
    "--",
    "start",
    "--workspace",
    workspace,
    "--approval",
    "auto",
    "--allow-external",
    "--opencode-router",
    opencodeRouterEnabled ? "true" : "false",
    ...(opencodeRouterRequired ? ["--opencode-router-required"] : []),
    ...(remoteAccessEnabled ? ["--remote-access"] : []),
    "--onmyagent-port",
    String(onmyagentPort),
  ],
  path.join(tmpDir, "dev-headless.log"),
  headlessEnv,
);

const stopAll = (signal: NodeJS.Signals) => {
  webProcess.kill(signal);
  headlessProcess.kill(signal);
};

process.on("SIGINT", () => {
  stopAll("SIGINT");
});
process.on("SIGTERM", () => {
  stopAll("SIGTERM");
});

webProcess.on("exit", (code, signal) => shutdown("web", code, signal));
headlessProcess.on("exit", (code, signal) =>
  shutdown("orchestrator", code, signal),
);
