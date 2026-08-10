import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import { readOnMyAgentEnvPendingChanges } from "../../../app/lib/onmyagent-env-runtime";

const DEFAULT_CACHE_KEY = "__onmyagent_env_default__";
const MAX_CONTEXT_CACHE_ENTRIES = 100;

const envSystemContextCache = new Map<string, string | undefined>();

export function clearOnMyAgentEnvSystemContextCache(): void {
  envSystemContextCache.clear();
}

function normalizeEnvKeys(keys: string[]): string[] {
  return Array.from(
    new Set(
      keys.flatMap((key) => {
        const trimmed = key.trim();
        return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) ? [trimmed] : [];
      }),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

/**
 * Fire-and-forget prewarm so expert first-send cold path can join a warm cache.
 * Safe to call from draft activation / rail open.
 */
export function prewarmOnMyAgentEnvSystemContext(
  client: OnMyAgentServerClient | null,
  options: {
    runtimeKey?: string | null;
  } = {},
): void {
  void buildOnMyAgentEnvSystemContext(client, options);
}

export async function buildOnMyAgentEnvSystemContext(
  client: OnMyAgentServerClient | null,
  options: {
    cacheKey?: string;
    runtimeKey?: string | null;
    readPendingChanges?: () => boolean;
  } = {},
): Promise<string | undefined> {
  if (!client) return undefined;
  const readPendingChanges = options.readPendingChanges ??
    (() => readOnMyAgentEnvPendingChanges(options.runtimeKey));
  if (readPendingChanges()) return undefined;

  // Prefer a stable default key: env names are not session-scoped. Callers that
  // used sessionId as cacheKey re-fetched listUserEnvKeys every new expert chat.
  const cacheKey = `${client.baseUrl}:${options.cacheKey ?? DEFAULT_CACHE_KEY}`;
  if (envSystemContextCache.has(cacheKey)) {
    return envSystemContextCache.get(cacheKey);
  }

  try {
    const response = await client.listUserEnvKeys();
    const keys = normalizeEnvKeys(response.keys ?? []);
    if (keys.length === 0) {
      rememberEnvSystemContext(cacheKey, undefined);
      return undefined;
    }

    const keyList = keys.map((key) => `- ${key}`).join("\n");

    const context = [
      "OnMyAgent environment variables configured:",
      keyList,
      "Only names are shown; values are secret. Use these names when relevant.",
    ].join("\n");
    rememberEnvSystemContext(cacheKey, context);
    return context;
  } catch {
    return undefined;
  }
}

function rememberEnvSystemContext(cacheKey: string, context: string | undefined): void {
  if (envSystemContextCache.size >= MAX_CONTEXT_CACHE_ENTRIES && !envSystemContextCache.has(cacheKey)) {
    const firstKey = envSystemContextCache.keys().next().value;
    if (firstKey) envSystemContextCache.delete(firstKey);
  }
  envSystemContextCache.set(cacheKey, context);
}
