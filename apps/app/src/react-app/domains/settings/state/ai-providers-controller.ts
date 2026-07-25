/**
 * Settings → Models provider list controller: SDK list hydrate, OpenCode
 * inventory prefetch (single-flight), and merge into list rows.
 *
 * Shell settings-route host should only pass wiring (client, workspace, policy).
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
  type MergedConnectedProvider,
} from "../../connections";

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

export type AiProvidersController = {
  connectedProviders: MergedConnectedProvider[];
  providerListHydrated: boolean;
  opencodeInventoryReady: boolean;
  opencodeManagedProviders: AgentManagementManagedProvider[];
  setOpenCodeManagedProviders: Dispatch<
    SetStateAction<AgentManagementManagedProvider[]>
  >;
  providersDiscovering: boolean;
  inventorySyncing: boolean;
  loadOpenCodeManagedProviders: () => Promise<AgentManagementManagedProvider[]>;
  findManagedProvider: (
    providerId: string,
  ) => AgentManagementManagedProvider | null;
};

/** Module-level single-flight cache for inventory IPC per workspace root. */
const inventoryInflight = new Map<
  string,
  Promise<AgentManagementManagedProvider[]>
>();

export async function loadOpenCodeManagedProvidersForWorkspace(
  workspaceRoot: string,
): Promise<AgentManagementManagedProvider[]> {
  const key = workspaceRoot.trim();
  if (!key) return [];
  const existing = inventoryInflight.get(key);
  if (existing) return existing;

  const request = (async () => {
    try {
      const snapshot = await agentManagementSnapshot({
        workspaceRoot: key,
        domains: ["providers"],
        includeModels: false,
      });
      return snapshot.providers.byAgent.opencode;
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

/** Test helper: clear single-flight map between tests. */
export function resetOpenCodeInventoryInflightForTests() {
  inventoryInflight.clear();
}

export function useAiProvidersController(
  input: AiProvidersControllerInput,
): AiProvidersController {
  const [providerListHydrated, setProviderListHydrated] = useState(false);
  const [opencodeInventoryReady, setOpenCodeInventoryReady] = useState(false);
  const [opencodeManagedProviders, setOpenCodeManagedProviders] = useState<
    AgentManagementManagedProvider[]
  >([]);
  const root = input.selectedWorkspaceRoot?.trim() || "";

  const loadOpenCodeManagedProviders = useCallback(async () => {
    if (!root) return [];
    return loadOpenCodeManagedProvidersForWorkspace(root);
  }, [root]);

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
    setOpenCodeManagedProviders([]);
    setOpenCodeInventoryReady(false);
  }, [root]);

  useEffect(() => {
    if (!root || !input.activeClient) return;
    if (opencodeInventoryReady) return;
    let cancelled = false;
    void loadOpenCodeManagedProviders()
      .then((providers) => {
        if (cancelled) return;
        setOpenCodeManagedProviders(providers);
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

  const connectedProviders = useMemo(
    () =>
      mergeConnectedProviders({
        sdkProviders: input.sdkProviders,
        connectedIds: input.connectedIds,
        managedProviders: opencodeManagedProviders,
        isBlocked: input.isBlocked,
      }),
    [
      input.connectedIds,
      input.isBlocked,
      input.sdkProviders,
      opencodeManagedProviders,
    ],
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
