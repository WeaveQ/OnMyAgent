export type ParsedArgs = {
  positionals: string[];
  flags: Map<string, string | boolean>;
};

export type OpencodeHotReload = {
  enabled: boolean;
  debounceMs: number;
  cooldownMs: number;
};

export type BinarySourcePreference = "auto" | "bundled" | "downloaded" | "external";

export type LogFormat = "pretty" | "json";

export type SandboxMode = "none" | "auto" | "docker" | "container";

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "-h") {
      flags.set("help", true);
      continue;
    }
    if (arg === "-v") {
      flags.set("version", true);
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const trimmed = arg.slice(2);
    if (!trimmed) continue;

    if (trimmed.startsWith("no-")) {
      flags.set(trimmed.slice(3), false);
      continue;
    }

    const [key, inlineValue] = trimmed.split("=");
    if (inlineValue !== undefined) {
      flags.set(key, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }

  return { positionals, flags };
}

export function parseList(value?: string): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed))
        return parsed.map((item) => String(item)).filter(Boolean);
    } catch {
      return [];
    }
  }
  return trimmed
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function readFlag(
  flags: Map<string, string | boolean>,
  key: string,
): string | undefined {
  const value = flags.get(key);
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}

export function readBool(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: boolean,
  envKey?: string,
): boolean {
  const raw = flags.get(key);
  if (raw !== undefined) {
    if (typeof raw === "boolean") return raw;
    const normalized = String(raw).toLowerCase();
    if (["false", "0", "no"].includes(normalized)) return false;
    if (["true", "1", "yes"].includes(normalized)) return true;
  }

  const envValue = envKey ? process.env[envKey] : undefined;
  if (envValue) {
    const normalized = envValue.toLowerCase();
    if (["false", "0", "no"].includes(normalized)) return false;
    if (["true", "1", "yes"].includes(normalized)) return true;
  }

  return fallback;
}

export function readOptionalBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return undefined;
}

export function readNumber(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: number | undefined,
  envKey?: string,
): number | undefined {
  const raw = flags.get(key);
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (envKey) {
    const envValue = process.env[envKey];
    if (envValue) {
      const parsed = Number(envValue);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return fallback;
}

export function readOpencodeHotReload(
  flags: Map<string, string | boolean>,
  defaults: OpencodeHotReload,
  env?: {
    enabled?: string;
    debounceMs?: string;
    cooldownMs?: string;
  },
): OpencodeHotReload {
  const enabled = readBool(
    flags,
    "opencode-hot-reload",
    defaults.enabled,
    env?.enabled,
  );
  const debounceRaw = readNumber(
    flags,
    "opencode-hot-reload-debounce-ms",
    defaults.debounceMs,
    env?.debounceMs,
  );
  const cooldownRaw = readNumber(
    flags,
    "opencode-hot-reload-cooldown-ms",
    defaults.cooldownMs,
    env?.cooldownMs,
  );
  const debounceMs =
    typeof debounceRaw === "number" &&
    Number.isFinite(debounceRaw) &&
    debounceRaw >= 50
      ? Math.floor(debounceRaw)
      : defaults.debounceMs;
  const cooldownMs =
    typeof cooldownRaw === "number" &&
    Number.isFinite(cooldownRaw) &&
    cooldownRaw >= 100
      ? Math.floor(cooldownRaw)
      : defaults.cooldownMs;
  return {
    enabled,
    debounceMs,
    cooldownMs,
  };
}

export function readBinarySource(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: BinarySourcePreference,
  envKey?: string,
): BinarySourcePreference {
  const raw = readFlag(flags, key) ?? (envKey ? process.env[envKey] : undefined);
  if (!raw) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (
    normalized === "auto" ||
    normalized === "bundled" ||
    normalized === "downloaded" ||
    normalized === "external"
  ) {
    return normalized as BinarySourcePreference;
  }
  throw new Error(
    `Invalid ${key} value: ${raw}. Use auto|bundled|downloaded|external.`,
  );
}

export function readLogFormat(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: LogFormat,
  envKey?: string,
): LogFormat {
  const raw = readFlag(flags, key) ?? (envKey ? process.env[envKey] : undefined);
  if (!raw) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "json") return "json";
  if (
    normalized === "pretty" ||
    normalized === "text" ||
    normalized === "human"
  )
    return "pretty";
  throw new Error(`Invalid ${key} value: ${raw}. Use pretty|json.`);
}

export function readSandboxMode(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: SandboxMode,
  envKey?: string,
): SandboxMode {
  const raw = readFlag(flags, key) ?? (envKey ? process.env[envKey] : undefined);
  if (!raw) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (
    normalized === "none" ||
    normalized === "auto" ||
    normalized === "docker" ||
    normalized === "container"
  ) {
    return normalized as SandboxMode;
  }
  throw new Error(
    `Invalid ${key} value: ${raw}. Use none|auto|docker|container.`,
  );
}
