import type { ServerConfig } from "@onmyagent/types/server";
import {
  EnvStoreReadError,
  InvalidEnvKeyError,
  isValidEnvKey,
  type EnvService,
} from "../services/env-file.js";
import { ApiError } from "../core/errors.js";
import { addRoute, systemJsonResponse, type Route } from "./route-core.js";

export function registerEnvRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  env: EnvService;
  ensureWritable: (config: ServerConfig) => void;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
}) {
  const { routes, config, env, ensureWritable, readJsonBody } = input;

  addRoute(routes, "GET", "/env", "host-token", async () => {
    const items = await env.list().catch(rethrowEnvStoreReadError);
    return systemJsonResponse({ items });
  });

  addRoute(routes, "GET", "/env/keys", "host-token", async () => {
    const items = await env.list().catch(rethrowEnvStoreReadError);
    return systemJsonResponse({ keys: items.map((item) => item.key) });
  });

  addRoute(routes, "PUT", "/env", "host-token", async (ctx) => {
    ensureWritable(config);
    const body = await readJsonBody(ctx.request);
    const rawEntries = Array.isArray(body.entries)
      ? body.entries
      : [{ key: body.key, value: body.value }];
    const entries: Array<{ key: string; value: string }> = [];
    for (const raw of rawEntries) {
      if (!raw || typeof raw !== "object") {
        throw new ApiError(
          400,
          "invalid_entry",
          "Each entry must be an object",
        );
      }
      const key = typeof raw.key === "string" ? raw.key.trim() : "";
      const value = typeof raw.value === "string" ? raw.value : "";
      if (!isValidEnvKey(key)) {
        throw new ApiError(
          400,
          "invalid_env_key",
          "Invalid environment variable name",
        );
      }
      entries.push({ key, value });
    }
    if (entries.length === 0) {
      throw new ApiError(400, "no_entries", "No entries provided");
    }
    try {
      await env.upsertMany(entries);
    } catch (error) {
      if (error instanceof EnvStoreReadError) {
        rethrowEnvStoreReadError(error);
      }
      if (error instanceof InvalidEnvKeyError) {
        throw new ApiError(
          400,
          error.code,
          error.code === "reserved_env_key"
            ? "Environment variable name is reserved for OnMyAgent internals"
            : "Invalid environment variable name",
        );
      }
      throw error;
    }
    return systemJsonResponse({ ok: true, count: entries.length });
  });

  addRoute(routes, "DELETE", "/env/:key", "host-token", async (ctx) => {
    ensureWritable(config);
    const key = ctx.params.key;
    if (!isValidEnvKey(key)) {
      throw new ApiError(
        400,
        "invalid_env_key",
        "Invalid environment variable name",
      );
    }
    const removed = await env.delete(key).catch(rethrowEnvStoreReadError);
    if (!removed) {
      throw new ApiError(
        404,
        "env_not_found",
        "Environment variable not found",
      );
    }
    return systemJsonResponse({ ok: true });
  });
}

function rethrowEnvStoreReadError(error: unknown): never {
  if (error instanceof EnvStoreReadError) {
    throw new ApiError(
      409,
      error.code,
      "Environment variable store is invalid. Fix or remove the local env file before editing.",
    );
  }
  throw error;
}
