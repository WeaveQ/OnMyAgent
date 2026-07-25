/**
 * Settings → Models provider list controller: SDK list hydrate, OpenCode
 * inventory prefetch (single-flight + TTL cache), and merge into list rows.
 *
 * Shell settings-route host should only pass wiring (client, workspace, policy).
 * Inventory is module-cached so session/welcome prewarm can zero-cost the first
 * Settings → Models open.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { AgentManagementManagedProvider } from "../../../../app/lib/desktop";
import { agentManagementSnapshot } from "../../../../app/lib/desktop";
import type { ProviderListItem } from "../../../../app/types";
import {
  mergeConnectedProviders,
  moveConnectedProviderInOrder,
  orderConnectedProviders,
  type MergedConnectedProvider,
} from "../../connections";
import {
  readConnectedProviderOrderIds,
  writeConnectedProviderOrderIds,
} from "../../../shell/session-memory";

/** Match provider-list React Query TTL so list + inventory stay coherent. */
export const OPENCODE_INVENTORY_CACHE_MS = 5 * 60 * 1000;

export type AiProvidersControllerInput = {
  activeClient: boolean;
  selectedWorkspaceRoot: string | null | undefined;
  selectedWorkspaceId: string | null | undefined;
  /** SDK rows currently known to the host (from provider auth refresh). */
  sdkProviders: ReadonlyArray<ProviderListItem>;
  connectedIds: ReadonlyArray<string>;
  isBlocked: (providerId: string) => boolean;
  /** Host-driven refresh of OpenCode provider.list / auth snapshot. */
  refreshSdkProviders: () => Promise<unknown>;
  /** Host refreshes MCP (side effect of client change). */
  refreshMcpServers?: () => void;
};

export type LoadOpenCodeManagedProvidersOptions = {
  /** Bypass TTL cache and re-fetch via IPC. */
  force?: boolean;
};

export type AiProvidersController = {
  connectedProviders: MergedConnectedProvider[];
  /** Persist move-up / move-down order for the settings list. */
  moveConnectedProvider: (
    providerId: string,
    direction: "up" | "down",
  ) => void;
  providerListHydrated: boolean;
  opencodeInventoryReady: boolean;
  opencodeManagedProviders: AgentManagementManagedProvider[];
  setOpenCodeManagedProviders: Dispatch<
    SetStateAction<AgentManagementManagedProvider[]>
  >;
  providersDiscovering: boolean;
  inventorySyncing: boolean;
  loadOpenCodeManagedProviders: (
    options?: LoadOpenCodeManagedProvidersOptions,
  ) => Promise<AgentManagementManagedProvider[]>;
  findManagedProvider: (
    providerId: string,
  ) => AgentManagementManagedProvider | null;
};

/** Module-level single-flight for in-progress inventory IPC per workspace root. */
const inventoryInflight = new Map<
  string,
  Promise<AgentManagementManagedProvider[]>
>();

type InventoryCacheEntry = {
  at: number;
  providers: AgentManagementManagedProvider[];
};

/** Module-level result cache so prewarm survives Settings remount. */
const inventoryCache = new Map<string, InventoryCacheEntry>();

export function peekOpenCodeManagedProvidersCache(
  workspaceRoot: string,
): AgentManagementManagedProvider[] | null {
  const key = workspaceRoot.trim();
  if (!key) return null;
  const entry = inventoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at >= OPENCODE_INVENTORY_CACHE_MS) return null;
  return entry.providers;
}

export function seedOpenCodeManagedProvidersCache(
  workspaceRoot: string,
  providers: AgentManagementManagedProvider[],
): void {
  const key = workspaceRoot.trim();
  if (!key) return;
  inventoryCache.set(key, { at: Date.now(), providers });
}

export function invalidateOpenCodeManagedProvidersCache(
  workspaceRoot?: string,
): void {
  if (workspaceRoot == null) {
    inventoryCache.clear();
    return;
  }
  inventoryCache.delete(workspaceRoot.trim());
}

export async function loadOpenCodeManagedProvidersForWorkspace(
  workspaceRoot: string,
  options?: LoadOpenCodeManagedProvidersOptions,
): Promise<AgentManagementManagedProvider[]> {
  const key = workspaceRoot.trim();
  if (!key) return [];

  if (!options?.force) {
    const cached = peekOpenCodeManagedProvidersCache(key);
    if (cached) return cached;
    const existing = inventoryInflight.get(key);
    if (existing) return existing;
  }

  const request = (async () => {
    try {
      const snapshot = await agentManagementSnapshot({
        workspaceRoot: key,
        domains: ["providers"],
        includeModels: false,
      });
      const providers = snapshot.providers.byAgent.opencode;
      seedOpenCodeManagedProvidersCache(key, providers);
      return providers;
    } catch (error) {
      console.warn("[settings] failed to load OpenCode managed providers", error);
      return [];
    } finally {
      inventoryInflight.delete(key);
    }
  })();

  inventoryInflight.set(key, request);
  return request;
}

/** Test helper: clear single-flight + result cache between tests. */
export function resetOpenCodeInventoryInflightForTests() {
  inventoryInflight.clear();
  inventoryCache.clear();
}

export function useAiProvidersController(
  input: AiProvidersControllerInput,
): AiProvidersController {
  const root = input.selectedWorkspaceRoot?.trim() || "";
  const cachedInventory = root ? peekOpenCodeManagedProvidersCache(root) : null;

  const [providerListHydrated, setProviderListHydrated] = useState(false);
  const [opencodeInventoryReady, setOpenCodeInventoryReady] = useState(
    () => cachedInventory != null,
  );
  const [opencodeManagedProviders, setOpenCodeManagedProvidersState] = useState<
    AgentManagementManagedProvider[]
  >(() => cachedInventory ?? []);

  const setOpenCodeManagedProviders = useCallback<
    Dispatch<SetStateAction<AgentManagementManagedProvider[]>>
  >(
    (action) => {
      setOpenCodeManagedProvidersState((previous) => {
        const next =
          typeof action === "function" ? action(previous) : action;
        if (root) seedOpenCodeManagedProvidersCache(root, next);
        return next;
      });
    },
    [root],
  );

  const loadOpenCodeManagedProviders = useCallback(
    async (options?: LoadOpenCodeManagedProvidersOptions) => {
      if (!root) return [];
      return loadOpenCodeManagedProvidersForWorkspace(root, options);
    },
    [root],
  );

  useEffect(() => {
    if (!input.activeClient) {
      setProviderListHydrated(false);
      return;
    }
    let cancelled = false;
    setProviderListHydrated(false);
    void input
      .refreshSdkProviders()
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setProviderListHydrated(true);
      });
    input.refreshMcpServers?.();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store methods stable; re-run on workspace/client
  }, [input.activeClient, input.selectedWorkspaceId]);

  useEffect(() => {
    const nextCached = root ? peekOpenCodeManagedProvidersCache(root) : null;
    if (nextCached) {
      setOpenCodeManagedProvidersState(nextCached);
      setOpenCodeInventoryReady(true);
      return;
    }
    setOpenCodeManagedProvidersState([]);
    setOpenCodeInventoryReady(false);
  }, [root]);

  useEffect(() => {
    if (!root || !input.activeClient) return;
    if (opencodeInventoryReady) return;
    let cancelled = false;
    void loadOpenCodeManagedProviders()
      .then((providers) => {
        if (cancelled) return;
        setOpenCodeManagedProvidersState(providers);
        seedOpenCodeManagedProvidersCache(root, providers);
      })
      .finally(() => {
        if (!cancelled) setOpenCodeInventoryReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [
    input.activeClient,
    loadOpenCodeManagedProviders,
    opencodeInventoryReady,
    root,
  ]);

  const [providerOrderIds, setProviderOrderIds] = useState<string[]>(() =>
    readConnectedProviderOrderIds(),
  );

  const connectedProviders = useMemo(() => {
    const merged = mergeConnectedProviders({
      sdkProviders: input.sdkProviders,
      connectedIds: input.connectedIds,
      managedProviders: opencodeManagedProviders,
      isBlocked: input.isBlocked,
    });
    return orderConnectedProviders(merged, providerOrderIds);
  }, [
    input.connectedIds,
    input.isBlocked,
    input.sdkProviders,
    opencodeManagedProviders,
    providerOrderIds,
  ]);

  const moveConnectedProvider = useCallback(
    (providerId: string, direction: "up" | "down") => {
      const presentIds = connectedProviders.map((provider) => provider.id);
      const next = moveConnectedProviderInOrder(
        providerOrderIds,
        presentIds,
        providerId,
        direction,
      );
      setProviderOrderIds(next);
      writeConnectedProviderOrderIds(next);
    },
    [connectedProviders, providerOrderIds],
  );

  const providersDiscovering =
    input.activeClient && !providerListHydrated;
  const inventorySyncing =
    input.activeClient && providerListHydrated && !opencodeInventoryReady;

  const findManagedProvider = useCallback(
    (providerId: string) =>
      opencodeManagedProviders.find((item) => item.id === providerId) ?? null,
    [opencodeManagedProviders],
  );

  return {
    connectedProviders,
    moveConnectedProvider,
    providerListHydrated,
    opencodeInventoryReady,
    opencodeManagedProviders,
    setOpenCodeManagedProviders,
    providersDiscovering,
    inventorySyncing,
    loadOpenCodeManagedProviders,
    findManagedProvider,
  };
}
