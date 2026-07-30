import {
  sessionArchiveConfigUpdateSchema,
  type SessionArchiveBackendsStatusResponse,
  type SessionArchiveConfigSnapshot,
  type SessionArchiveConfigUpdate,
  type SessionArchiveWorktreeMapping,
} from "@onmyagent/types/session-archive";
import type { SqliteDatabase } from "../core/sqlite.js";
import { sessionArchiveRegistry, resolveSessionArchiveSourceRoots } from "./session-archive-registry.js";
import {
  objectField,
  parseOptionalJsonField,
  previewSecret,
  redactDuckDbConfigUpdate,
  redactPostgresConfigUpdate,
  stringArrayFromUnknown,
  stringFromUnknown,
} from "./session-archive-sql.js";

export type SessionArchiveConfigApi = {
  getConfigSnapshot: () => SessionArchiveConfigSnapshot;
  updateConfig: (input: SessionArchiveConfigUpdate) => SessionArchiveConfigSnapshot;
  getBackendsStatus: () => SessionArchiveBackendsStatusResponse;
};

/**
 * Pure config mappers + archive settings API — extracted from createSessionArchiveStore
 * to keep session-archive.ts under the file-size ratchet.
 */
export function createSessionArchiveConfigApi(input: {
  db: SqliteDatabase;
  listWorktreeMappings: () => SessionArchiveWorktreeMapping[];
}): SessionArchiveConfigApi {
  const { db, listWorktreeMappings } = input;

  function readArchiveConfig(): Record<string, unknown> {
    const row = db.prepare("SELECT value_json FROM archive_config WHERE key = 'settings'").get();
    const parsed = parseOptionalJsonField(objectField(row, "value_json"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  }

  function writeArchiveConfig(value: Record<string, unknown>) {
    db.prepare(`
      INSERT INTO archive_config (key, value_json, updated_at)
      VALUES ('settings', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(JSON.stringify(value), new Date().toISOString());
  }

  function getConfigSnapshot(): SessionArchiveConfigSnapshot {
    const config = readArchiveConfig();
    const resolvedRoots = resolveSessionArchiveSourceRoots({ config, includeMissing: true });
    const dirsByAgent = new Map<string, { dirs: string[]; configured: boolean; source: "default" | "config" | "env" }>();
    for (const root of resolvedRoots) {
      const current = dirsByAgent.get(root.agent) ?? { dirs: [], configured: false, source: root.source };
      current.dirs.push(root.root);
      current.configured = current.configured || root.configured;
      current.source = root.source;
      dirsByAgent.set(root.agent, current);
    }
    return {
      agent_dirs: sessionArchiveRegistry.map((entry) => {
        const resolved = dirsByAgent.get(entry.agent) ?? { dirs: [], configured: false, source: "default" as const };
        return {
          agent: entry.agent,
          display_name: entry.displayName,
          dirs: resolved.dirs,
          configured: resolved.configured,
          source: resolved.source,
        };
      }),
      terminal: terminalConfigFromConfig(config),
      github: githubConfigFromConfig(config),
      worktree_mappings: listWorktreeMappings(),
      remote: remoteConfigFromConfig(config),
      postgres: postgresConfigFromConfig(config),
      duckdb: duckDbConfigFromConfig(config),
      backends: backendsStatusFromConfig(config).backends,
    };
  }

  function updateConfig(input: SessionArchiveConfigUpdate): SessionArchiveConfigSnapshot {
    const parsed = sessionArchiveConfigUpdateSchema.parse(input);
    const current = readArchiveConfig();
    const next = { ...current };
    if (parsed.agent_dirs) {
      for (const item of parsed.agent_dirs) {
        const entry = sessionArchiveRegistry.find((candidate) => candidate.agent === item.agent);
        if (entry?.configKey) Reflect.set(next, entry.configKey, item.dirs);
      }
    }
    if (parsed.terminal) Reflect.set(next, "terminal", parsed.terminal);
    if (parsed.github_token !== undefined) {
      Reflect.set(next, "github_token_preview", previewSecret(parsed.github_token));
      Reflect.set(next, "github_token_configured", parsed.github_token.trim().length > 0);
    }
    if (parsed.remote) Reflect.set(next, "remote", parsed.remote);
    if (parsed.postgres) Reflect.set(next, "postgres", redactPostgresConfigUpdate(parsed.postgres));
    if (parsed.duckdb) Reflect.set(next, "duckdb", redactDuckDbConfigUpdate(parsed.duckdb));
    writeArchiveConfig(next);
    return getConfigSnapshot();
  }

  function getBackendsStatus(): SessionArchiveBackendsStatusResponse {
    return backendsStatusFromConfig(readArchiveConfig());
  }

  return {
    getConfigSnapshot,
    updateConfig,
    getBackendsStatus,
  };
}

export function terminalConfigFromConfig(config: Record<string, unknown>): SessionArchiveConfigSnapshot["terminal"] {
  const terminal = Reflect.get(config, "terminal");
  const source = terminal && typeof terminal === "object" ? terminal : {};
  const mode = stringFromUnknown(Reflect.get(source, "mode"));
  return {
    mode: mode === "custom" || mode === "clipboard" ? mode : "auto" as const,
    custom_bin: stringFromUnknown(Reflect.get(source, "custom_bin")) || undefined,
    custom_args: stringFromUnknown(Reflect.get(source, "custom_args")) || undefined,
  };
}

export function githubConfigFromConfig(config: Record<string, unknown>): SessionArchiveConfigSnapshot["github"] {
  return {
    configured: Reflect.get(config, "github_token_configured") === true,
    token_preview: stringFromUnknown(Reflect.get(config, "github_token_preview")) || undefined,
  };
}

export function remoteConfigFromConfig(config: Record<string, unknown>): SessionArchiveConfigSnapshot["remote"] {
  const remote = Reflect.get(config, "remote");
  const source = remote && typeof remote === "object" ? remote : {};
  return {
    public_url: stringFromUnknown(Reflect.get(source, "public_url")) || undefined,
    public_origins: stringArrayFromUnknown(Reflect.get(source, "public_origins")),
    require_auth: Reflect.get(source, "require_auth") === true,
    auth_configured: Reflect.get(source, "auth_token_configured") === true,
    remote_hosts: [],
  };
}

export function postgresConfigFromConfig(config: Record<string, unknown>): SessionArchiveConfigSnapshot["postgres"] {
  const postgres = Reflect.get(config, "postgres");
  const source = postgres && typeof postgres === "object" ? postgres : {};
  const urlPreview = stringFromUnknown(Reflect.get(source, "url_preview"));
  return {
    url_configured: Reflect.get(source, "url_configured") === true || Boolean(urlPreview),
    url_preview: urlPreview || undefined,
    schema: stringFromUnknown(Reflect.get(source, "schema")) || undefined,
    machine_name: stringFromUnknown(Reflect.get(source, "machine_name")) || undefined,
    allow_insecure: Reflect.get(source, "allow_insecure") === true,
    projects: stringArrayFromUnknown(Reflect.get(source, "projects")),
    exclude_projects: stringArrayFromUnknown(Reflect.get(source, "exclude_projects")),
    watch: Reflect.get(source, "watch") === true,
  };
}

export function duckDbConfigFromConfig(config: Record<string, unknown>): SessionArchiveConfigSnapshot["duckdb"] {
  const duckdb = Reflect.get(config, "duckdb");
  const source = duckdb && typeof duckdb === "object" ? duckdb : {};
  const urlPreview = stringFromUnknown(Reflect.get(source, "url_preview"));
  return {
    path: stringFromUnknown(Reflect.get(source, "path")) || undefined,
    url_configured: Reflect.get(source, "url_configured") === true || Boolean(urlPreview),
    url_preview: urlPreview || undefined,
    token_configured: Reflect.get(source, "token_configured") === true,
    machine_name: stringFromUnknown(Reflect.get(source, "machine_name")) || undefined,
    allow_insecure: Reflect.get(source, "allow_insecure") === true,
    projects: stringArrayFromUnknown(Reflect.get(source, "projects")),
    exclude_projects: stringArrayFromUnknown(Reflect.get(source, "exclude_projects")),
  };
}

export function backendsStatusFromConfig(config: Record<string, unknown>): SessionArchiveBackendsStatusResponse {
  const postgres = postgresConfigFromConfig(config);
  const duckdb = duckDbConfigFromConfig(config);
  return {
    backends: [
      {
        backend: "postgres",
        configured: postgres.url_configured,
        mode: postgres.watch ? "push" : "serve",
        read_only_serve: true,
        capabilities: ["push", "watch", "read_only_serve", "status"],
        status: "blocked",
        blocker: "Studio records PostgreSQL parity configuration, but this TypeScript migration does not include a PostgreSQL driver or user-approved DSN connection in the current environment.",
      },
      {
        backend: "duckdb",
        configured: Boolean(duckdb.path || duckdb.url_configured),
        mode: duckdb.url_configured ? "quack" : "mirror",
        read_only_serve: true,
        capabilities: ["push", "status", "read_only_serve", "quack"],
        status: "blocked",
        blocker: "Studio records DuckDB/Quack parity configuration, but this TypeScript migration does not include a DuckDB runtime/driver or user-approved remote Quack connection in the current environment.",
      },
    ],
  };
}
