import { useEffect, useRef, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
  ExpertDirectoryProjection,
  ServerClientCapabilities,
} from "@onmyagent/types/server";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server/client";
import {
  isCompleteProjection,
  readExpertDirectoryCache,
  type ExpertDirectoryCacheStorage,
  writeExpertDirectoryCache,
} from "./expert-directory-cache";
import {
  buildExpertDirectoryShadowDiff,
  buildExpertDirectoryPageModel,
  type ExpertDirectoryShadowDiff,
  type LegacyExpertDirectorySnapshot,
} from "./expert-directory-page-model";
import { useExpertDirectoryStore } from "./expert-directory-store";

export const EXPERT_DIRECTORY_QUERY_ROOT = ["expert-directory"] as const;
export const EXPERT_DIRECTORY_SHADOW_OVERRIDE_KEY = "onmyagent:dev:expert-directory-shadow";

export type ExpertDirectoryClient = Pick<
  OnMyAgentServerClient,
  "capabilities" | "getExpertDirectory"
>;
type ExpertDirectoryFetchClient = Pick<OnMyAgentServerClient, "getExpertDirectory">;
export type ExpertDirectoryQueryResult = UseQueryResult<ExpertDirectoryProjection, Error> & {
  lastComplete?: ExpertDirectoryProjection;
};

export function expertDirectoryQueryKey(workspaceId: string): readonly ["expert-directory", string] {
  return ["expert-directory", workspaceId.trim()];
}

export async function fetchExpertDirectory(input: {
  /** Local renderer workspace key used for cache isolation. */
  workspaceId: string;
  /** Server-owned workspace id; differs for remote workspace aliases. */
  serverWorkspaceId?: string;
  client: ExpertDirectoryFetchClient;
  storage?: ExpertDirectoryCacheStorage | null;
}): Promise<ExpertDirectoryProjection> {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) throw new Error("workspaceId is required");
  const serverWorkspaceId = input.serverWorkspaceId?.trim() || workspaceId;
  const cached = readExpertDirectoryCache(workspaceId, input.storage);
  try {
    const payload = await input.client.getExpertDirectory(serverWorkspaceId);
    if (isCompleteProjection(payload)) {
      writeExpertDirectoryCache(workspaceId, payload, input.storage);
      return payload;
    }
    return payload;
  } catch (error) {
    if (cached) {
      throw new ExpertDirectoryFetchError(error, cached.payload);
    }
    throw error;
  }
}

export function useExpertDirectoryQuery(input: {
  workspaceId: string;
  serverWorkspaceId?: string;
  client: ExpertDirectoryClient | null | undefined;
  enabled?: boolean;
  storage?: ExpertDirectoryCacheStorage | null;
}): ExpertDirectoryQueryResult {
  const workspaceId = input.workspaceId.trim();
  const [lastComplete, setLastComplete] = useState<ExpertDirectoryProjection | undefined>();
  useEffect(() => {
    let active = true;
    const cache = readExpertDirectoryCache(workspaceId, input.storage);
    if (active) setLastComplete(cache?.payload);
    return () => { active = false; };
  }, [input.storage, workspaceId]);
  const query = useQuery<ExpertDirectoryProjection, Error>({
    queryKey: expertDirectoryQueryKey(workspaceId),
    enabled: Boolean(input.enabled !== false && input.client && workspaceId),
    queryFn: ({ signal }) => {
      if (!input.client) throw new Error("OnMyAgent server client is unavailable");
      if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
      return fetchExpertDirectory({
        workspaceId,
        serverWorkspaceId: input.serverWorkspaceId,
        client: input.client,
        storage: input.storage,
      });
    },
  });
  useEffect(() => {
    if (query.data?.complete === true) setLastComplete(query.data);
  }, [query.data]);
  return { ...query, lastComplete: lastComplete ?? readFetchErrorCache(query.error) };
}

class ExpertDirectoryFetchError extends Error {
  constructor(cause: unknown, readonly lastComplete: ExpertDirectoryProjection) {
    super(cause instanceof Error ? cause.message : "Expert directory fetch failed");
    this.name = "ExpertDirectoryFetchError";
  }
}

function readFetchErrorCache(error: unknown): ExpertDirectoryProjection | undefined {
  return error instanceof ExpertDirectoryFetchError ? error.lastComplete : undefined;
}

export function readPersistedExpertDirectoryShadowOverride(input: {
  storage?: ExpertDirectoryCacheStorage | null;
  isDevelopment: boolean;
}): boolean | null {
  if (!input.isDevelopment || !input.storage) return null;
  try {
    const value = input.storage.getItem(EXPERT_DIRECTORY_SHADOW_OVERRIDE_KEY);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    return null;
  }
  return null;
}

export function writeExpertDirectoryShadowOverride(input: {
  storage?: ExpertDirectoryCacheStorage | null;
  isDevelopment: boolean;
  value: boolean | null;
}): boolean {
  if (!input.isDevelopment || !input.storage) return false;
  try {
    if (input.value === null) {
      // Keep this dev-only key out of the server truth; clear is optional on
      // the minimal storage contract, so write an empty sentinel instead.
      input.storage.setItem(EXPERT_DIRECTORY_SHADOW_OVERRIDE_KEY, "");
    } else {
      input.storage.setItem(EXPERT_DIRECTORY_SHADOW_OVERRIDE_KEY, String(input.value));
    }
    return true;
  } catch {
    return false;
  }
}

export function resolveExpertDirectoryShadowEnabled(input: {
  serverCapability?: ServerClientCapabilities["expertDirectory"];
  devOverride?: boolean | null;
}): boolean {
  if (input.serverCapability?.shadow !== true) return false;
  return input.devOverride ?? true;
}

export function useExpertDirectoryShadow(input: {
  workspaceId: string;
  serverWorkspaceId?: string;
  client: ExpertDirectoryClient | null | undefined;
  legacy: LegacyExpertDirectorySnapshot;
  enabled?: boolean;
  serverCapability?: ServerClientCapabilities["expertDirectory"];
  devOverride?: boolean | null;
  isDevelopment?: boolean;
  storage?: ExpertDirectoryCacheStorage | null;
  emit?: (event: ExpertDirectoryShadowDiff) => void;
}): ExpertDirectoryQueryResult {
  const workspaceId = input.workspaceId.trim();
  const capabilitiesQuery = useQuery({
    queryKey: ["onmyagent-server-capabilities", workspaceId],
    enabled: Boolean(
      input.enabled !== false &&
      input.client &&
      workspaceId &&
      input.serverCapability === undefined
    ),
    queryFn: () => {
      if (!input.client) throw new Error("OnMyAgent server client is unavailable");
      return input.client.capabilities();
    },
    staleTime: 60_000,
  });
  const [persistedDevOverride, setPersistedDevOverride] = useState<boolean | null>(null);
  useEffect(() => {
    setPersistedDevOverride(readPersistedExpertDirectoryShadowOverride({
      storage: input.storage,
      isDevelopment: input.isDevelopment === true,
    }));
  }, [input.isDevelopment, input.storage]);
  const serverCapability = input.serverCapability ?? capabilitiesQuery.data?.expertDirectory;
  const shadowEnabled = resolveExpertDirectoryShadowEnabled({
    serverCapability,
    devOverride: input.devOverride ?? persistedDevOverride,
  });
  const query = useExpertDirectoryQuery({
    workspaceId: input.workspaceId,
    serverWorkspaceId: input.serverWorkspaceId,
    client: input.client,
    enabled: input.enabled !== false && shadowEnabled,
    storage: input.storage,
  });
  const legacySignature = JSON.stringify(input.legacy);
  const lastEmittedSignatureRef = useRef("");
  const pageModel = buildExpertDirectoryPageModel({
    query: {
      data: query.data,
      lastComplete: query.lastComplete,
      error: query.error,
      isPending: query.isPending,
      isLoading: query.isLoading,
    },
  });
  useEffect(() => {
    useExpertDirectoryStore.getState().setStatus(input.workspaceId, pageModel.state);
  }, [input.workspaceId, pageModel.state]);
  useEffect(() => {
    if (!pageModel.payload) return;
    const records = pageModel.payload?.records ?? [];
    const sessionIds = new Set<string>();
    const agentIdBySessionId = new Map<string, string>();
    for (const record of records) {
      for (const sessionId of record.sessionIds) {
        const id = sessionId.trim();
        if (!id) continue;
        sessionIds.add(id);
        agentIdBySessionId.set(id, record.agentId);
      }
    }
    useExpertDirectoryStore.getState().setIdentity(input.workspaceId, {
      sessionIds,
      agentIdBySessionId,
    });
  }, [input.workspaceId, pageModel.payload]);
  useEffect(() => {
    if (!shadowEnabled || !query.data?.complete || !input.emit) return;
    const legacy = JSON.parse(legacySignature) as LegacyExpertDirectorySnapshot;
    const diff = buildExpertDirectoryShadowDiff({
      workspaceId: input.workspaceId,
      legacy,
      projection: query.data,
    });
    const emittedSignature = JSON.stringify(diff);
    if (emittedSignature === lastEmittedSignatureRef.current) return;
    lastEmittedSignatureRef.current = emittedSignature;
    input.emit(diff);
  }, [input.emit, input.workspaceId, legacySignature, query.data, shadowEnabled]);
  return query;
}
