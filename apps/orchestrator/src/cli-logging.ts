import { hostname } from "node:os";

import { type LogFormat } from "./cli-args.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogAttributes = Record<string, unknown>;
export type LoggerChild = {
  log: (level: LogLevel, message: string, attributes?: LogAttributes) => void;
  debug: (message: string, attributes?: LogAttributes) => void;
  info: (message: string, attributes?: LogAttributes) => void;
  warn: (message: string, attributes?: LogAttributes) => void;
  error: (message: string, attributes?: LogAttributes) => void;
};
export type Logger = {
  format: LogFormat;
  output: "stdout" | "silent";
  log: (
    level: LogLevel,
    message: string,
    attributes?: LogAttributes,
    component?: string,
  ) => void;
  debug: (
    message: string,
    attributes?: LogAttributes,
    component?: string,
  ) => void;
  info: (
    message: string,
    attributes?: LogAttributes,
    component?: string,
  ) => void;
  warn: (
    message: string,
    attributes?: LogAttributes,
    component?: string,
  ) => void;
  error: (
    message: string,
    attributes?: LogAttributes,
    component?: string,
  ) => void;
  child: (component: string, attributes?: LogAttributes) => LoggerChild;
};
export type LogEvent = {
  time: number;
  level: LogLevel;
  message: string;
  component?: string;
  attributes?: LogAttributes;
};

export const LOG_LEVEL_NUMBERS: Record<LogLevel, number> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
};

export const ANSI = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

export function colorize(input: string, color: string, enabled: boolean): string {
  if (!enabled) return input;
  return `${color}${input}${ANSI.reset}`;
}

export function toUnixNano(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}


export const REDACTED_LOG_VALUE = "[REDACTED]";

export const SENSITIVE_FLAG_NAMES = [
  "--token",
  "--host-token",
  "--onmyagent-token",
  "--onmyagent-host-token",
  "--opencode-password",
  "--opencode-username",
];

export const SENSITIVE_ATTRIBUTE_KEYS = new Set([
  "token",
  "hosttoken",
  "ownertoken",
  "collaboratortoken",
  "controltoken",
  "authorization",
  "password",
  "opencodepassword",
  "opencodeusername",
  "bottoken",
  "apptoken",
]);

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isSensitiveAttributeKey(key?: string): boolean {
  const trimmed = key?.trim() ?? "";
  if (!trimmed) return false;
  const normalized = trimmed.toLowerCase();
  if (SENSITIVE_ATTRIBUTE_KEYS.has(normalized)) return true;
  return (
    (trimmed.startsWith("ONMYAGENT_") ||
      trimmed.startsWith("OPENCODE_") ||
      trimmed.startsWith("DEN_")) &&
    /TOKEN|PASSWORD|USERNAME|AUTHORIZATION/.test(trimmed)
  );
}

export function redactSensitiveString(input: string): string {
  let redacted = input;
  redacted = redacted.replace(/\b(Bearer)\s+[^\s"']+/gi, "$1 [REDACTED]");
  redacted = redacted.replace(/\b(Basic)\s+[A-Za-z0-9+/=]+/g, "$1 [REDACTED]");
  redacted = redacted.replace(
    /((?:ONMYAGENT|OPENCODE|DEN)_[A-Z0-9_]*(?:TOKEN|PASSWORD|USERNAME|AUTHORIZATION)[A-Z0-9_]*=)([^\s]+)/g,
    `$1${REDACTED_LOG_VALUE}`,
  );
  redacted = redacted.replace(
    /("?(?:token|hostToken|ownerToken|collaboratorToken|controlToken|password|authorization|opencodePassword|opencodeUsername|botToken|appToken)"?\s*[:=]\s*")([^"]*)(")/g,
    `$1${REDACTED_LOG_VALUE}$3`,
  );
  redacted = redacted.replace(
    /("?(?:token|hostToken|ownerToken|collaboratorToken|controlToken|password|authorization|opencodePassword|opencodeUsername|botToken|appToken)"?\s*[:=]\s*)([^,\s}]+)/g,
    `$1${REDACTED_LOG_VALUE}`,
  );
  for (const flag of SENSITIVE_FLAG_NAMES) {
    redacted = redacted.replace(
      new RegExp(`(${escapeRegExp(flag)}\\s+)([^\\s]+)`, "g"),
      `$1${REDACTED_LOG_VALUE}`,
    );
  }
  return redacted;
}

export function redactLogValue(value: unknown, key?: string): unknown {
  if (isSensitiveAttributeKey(key)) {
    return REDACTED_LOG_VALUE;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return redactSensitiveString(value);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, key));
  }
  if (value instanceof Error) {
    return `${value.name}: ${redactSensitiveString(value.message)}`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([entryKey, entryValue]) => [
        entryKey,
        redactLogValue(entryValue, entryKey),
      ],
    );
    return Object.fromEntries(entries);
  }
  return redactSensitiveString(String(value));
}

export function createLogger(options: {
  format: LogFormat;
  runId: string;
  serviceName: string;
  serviceVersion?: string;
  output?: "stdout" | "silent";
  color?: boolean;
  onLog?: (event: LogEvent) => void;
}): Logger {
  const host = hostname().trim();
  const resource: Record<string, string> = {
    "service.name": options.serviceName,
    "service.instance.id": options.runId,
  };
  if (options.serviceVersion) {
    resource["service.version"] = options.serviceVersion;
  }
  if (host) {
    resource["host.name"] = host;
  }
  const baseAttributes: LogAttributes = {
    "run.id": options.runId,
    "process.pid": process.pid,
  };
  const output = options.output ?? "stdout";
  const colorEnabled = options.color ?? false;
  const componentColors: Record<string, string> = {
    "onmyagent-orchestrator": ANSI.gray,
    opencode: ANSI.cyan,
    "onmyagent-server": ANSI.green,
    opencodeRouter: ANSI.magenta,
    "onmyagent-orchestrator-router": ANSI.cyan,
  };
  const levelColors: Record<LogLevel, string> = {
    debug: ANSI.gray,
    info: ANSI.gray,
    warn: ANSI.yellow,
    error: ANSI.red,
  };

  const emit = (
    level: LogLevel,
    message: string,
    attributes?: LogAttributes,
    component?: string,
  ) => {
    const mergedAttributes: LogAttributes = {
      ...baseAttributes,
      ...(component ? { "service.component": component } : {}),
      ...(attributes ?? {}),
    };
    const redactedMessage = redactSensitiveString(message);
    const redactedAttributes = redactLogValue(mergedAttributes) as LogAttributes;
    options.onLog?.({
      time: Date.now(),
      level,
      message: redactedMessage,
      component,
      attributes: redactedAttributes,
    });
    if (output === "silent") return;
    if (options.format === "json") {
      const record = {
        timeUnixNano: toUnixNano(),
        severityText: level.toUpperCase(),
        severityNumber: LOG_LEVEL_NUMBERS[level],
        body: redactedMessage,
        attributes: redactedAttributes,
        resource,
      };
      process.stdout.write(`${JSON.stringify(record)}\n`);
      return;
    }
    const label = component ?? options.serviceName;
    const tagLabel = label ? `[${label}]` : "";
    const levelTag = level === "info" ? "" : level.toUpperCase();
    const coloredLabel = tagLabel
      ? colorize(tagLabel, componentColors[label] ?? ANSI.gray, colorEnabled)
      : "";
    const coloredLevel = levelTag
      ? colorize(levelTag, levelColors[level] ?? ANSI.gray, colorEnabled)
      : "";
    const tag = [coloredLabel, coloredLevel].filter(Boolean).join(" ");
    const line = tag ? `${tag} ${redactedMessage}` : redactedMessage;
    process.stdout.write(`${line}\n`);
  };

  const child = (
    component: string,
    attributes?: LogAttributes,
  ): LoggerChild => ({
    log: (level, message, attrs) =>
      emit(
        level,
        message,
        { ...(attributes ?? {}), ...(attrs ?? {}) },
        component,
      ),
    debug: (message, attrs) =>
      emit(
        "debug",
        message,
        { ...(attributes ?? {}), ...(attrs ?? {}) },
        component,
      ),
    info: (message, attrs) =>
      emit(
        "info",
        message,
        { ...(attributes ?? {}), ...(attrs ?? {}) },
        component,
      ),
    warn: (message, attrs) =>
      emit(
        "warn",
        message,
        { ...(attributes ?? {}), ...(attrs ?? {}) },
        component,
      ),
    error: (message, attrs) =>
      emit(
        "error",
        message,
        { ...(attributes ?? {}), ...(attrs ?? {}) },
        component,
      ),
  });

  return {
    format: options.format,
    output,
    log: emit,
    debug: (message, attrs, component) =>
      emit("debug", message, attrs, component),
    info: (message, attrs, component) =>
      emit("info", message, attrs, component),
    warn: (message, attrs, component) =>
      emit("warn", message, attrs, component),
    error: (message, attrs, component) =>
      emit("error", message, attrs, component),
    child,
  };
}



