import { hostname } from "node:os";
import type { ServerConfig } from "@onmyagent/types/server";
import { shortId } from "./utils.js";
import type { AuthMode } from "../routes/route-core.js";
import pkg from "../../package.json" with { type: "json" };

const SERVER_VERSION = pkg.version;

export type LogLevel = "info" | "warn" | "error";

export type LogAttributes = Record<string, unknown>;

export type ServerLogger = {
  log: (level: LogLevel, message: string, attributes?: LogAttributes) => void;
};

const LOG_LEVEL_NUMBERS: Record<LogLevel, number> = {
  info: 9,
  warn: 13,
  error: 17,
};

const stdoutErrorGuardInstalled = Symbol.for("onmyagent.server.stdoutErrorGuardInstalled");

function toUnixNano(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

function isIgnorableStdoutWriteError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = Reflect.get(error, "code");
  return code === "EPIPE"
    || code === "ERR_STREAM_DESTROYED"
    || code === "ERR_STREAM_WRITE_AFTER_END";
}

function installStdoutErrorGuard() {
  const stdout = process.stdout as NodeJS.WriteStream & { [stdoutErrorGuardInstalled]?: true };
  if (stdout[stdoutErrorGuardInstalled]) return;
  stdout[stdoutErrorGuardInstalled] = true;
  stdout.on("error", (error) => {
    if (isIgnorableStdoutWriteError(error)) return;
    throw error;
  });
}

function writeStdoutLine(line: string) {
  try {
    installStdoutErrorGuard();
    process.stdout.write(`${line}\n`);
  } catch (error) {
    if (isIgnorableStdoutWriteError(error)) return;
    throw error;
  }
}

export function createServerLogger(config: ServerConfig): ServerLogger {
  const runId = process.env.ONMYAGENT_RUN_ID ?? shortId();
  const host = hostname().trim();
  const resource: Record<string, string> = {
    "service.name": "onmyagent-server",
    "service.version": SERVER_VERSION,
    "service.instance.id": runId,
  };
  if (host) {
    resource["host.name"] = host;
  }
  const baseAttributes: LogAttributes = {
    "run.id": runId,
    "process.pid": process.pid,
  };

  const emit = (
    level: LogLevel,
    message: string,
    attributes?: LogAttributes,
  ) => {
    const merged = { ...baseAttributes, ...(attributes ?? {}) };
    if (config.logFormat === "json") {
      const record = {
        timeUnixNano: toUnixNano(),
        severityText: level.toUpperCase(),
        severityNumber: LOG_LEVEL_NUMBERS[level],
        body: message,
        attributes: merged,
        resource,
      };
      writeStdoutLine(JSON.stringify(record));
      return;
    }
    writeStdoutLine(message);
  };

  return { log: emit };
}

export function logRequest(input: {
  logger: ServerLogger;
  request: Request;
  response: Response;
  durationMs: number;
  authMode: AuthMode;
  proxyService?: "opencode";
  proxyBaseUrl?: string;
  error?: string;
}) {
  const {
    logger,
    request,
    response,
    durationMs,
    authMode,
    proxyService,
    proxyBaseUrl,
    error,
  } = input;
  const status = response.status;
  const level: LogLevel =
    status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const proxyLabel = proxyBaseUrl ? ` (${proxyService ?? "proxy"})` : "";
  const message = `${method} ${url.pathname} ${status} ${durationMs}ms${proxyLabel}`;
  const attributes: LogAttributes = {
    method,
    path: url.pathname,
    status,
    durationMs,
    auth: authMode,
  };
  if (proxyBaseUrl) {
    attributes["proxy.base_url"] = proxyBaseUrl;
    if (proxyService) attributes["proxy.service"] = proxyService;
  }
  if (error) {
    attributes.error = error;
  }
  logger.log(level, message, attributes);
}
