/** @jsxImportSource react */
import { useCallback, useEffect } from "react";
import { useAgentRegistryStore } from "./agent-registry-store";
import {
  AGENT_REGISTRY_PATH,
  LEGACY_AGENT_REGISTRY_PATH,
  createAgentRegistryWithUserAgents,
  createDefaultAgentRegistry,
  parseAgentRegistry,
  parseUserAgentRegistry,
  serializeUserAgentRegistry,
} from "./agent-registry";
import type { OpenworkServerClient, OpenworkServerError } from "../../../app/lib/onmyagent-server";
import { isElectronRuntime } from "../../../app/utils";
import {
  readUserAgentRegistry,
  writeUserAgentRegistry,
} from "../../../app/lib/desktop";

/**
 * Hook to ensure agent registry is loaded from the workspace.
 * This is needed because the "Expert" menu displays session lists
 * that require registry data to show agent avatars and names.
 * 
 * The registry is cached in localStorage by `useAgentRegistryStore`,
 * so this hook will load it from the network if the cache is stale
 * or missing.
 */
export function useEnsureAgentRegistry(
  client: OpenworkServerClient | null,
  workspaceId: string | undefined,
) {
  const registry = useAgentRegistryStore((state) => state.registry);
  const setRegistry = useAgentRegistryStore((state) => state.setRegistry);

  const loadRegistry = useCallback(async () => {
    try {
      if (isElectronRuntime()) {
        const userRegistry = await readUserAgentRegistry();
        if (userRegistry) {
          setRegistry(parseUserAgentRegistry(userRegistry.content));
          return;
        }
      }

      if (!client || !workspaceId) {
        setRegistry(createDefaultAgentRegistry());
        return;
      }

      let result: Awaited<ReturnType<OpenworkServerClient["readWorkspaceFile"]>>;
      try {
        result = await client.readWorkspaceFile(
          workspaceId,
          AGENT_REGISTRY_PATH,
        );
      } catch (error) {
        if (!(error instanceof Error && "status" in error && (error as OpenworkServerError).status === 404)) {
          throw error;
        }
        result = await client.readWorkspaceFile(
          workspaceId,
          LEGACY_AGENT_REGISTRY_PATH,
        );
      }
      const legacyRegistry = parseAgentRegistry(result.content ?? "");
      const migrated = createAgentRegistryWithUserAgents(
        legacyRegistry.agents,
        legacyRegistry.updatedAt,
        legacyRegistry.templates,
      );
      if (isElectronRuntime()) {
        await writeUserAgentRegistry(serializeUserAgentRegistry(migrated));
      }
      setRegistry(migrated);
    } catch (error) {
      // If file doesn't exist, create a default registry
      if (error instanceof Error && "status" in error && (error as OpenworkServerError).status === 404) {
        try {
          const seed = createDefaultAgentRegistry();
          if (isElectronRuntime()) {
            await writeUserAgentRegistry(serializeUserAgentRegistry(seed));
          }
          setRegistry(seed);
        } catch (writeError) {
          console.error("Failed to create default agent registry:", writeError);
        }
        return;
      }
      console.error("Failed to load agent registry:", error);
    }
  }, [client, workspaceId, setRegistry]);

  useEffect(() => {
    // Only load if registry is null (not cached)
    if (registry === null) {
      void loadRegistry();
    }
  }, [registry, loadRegistry]);

  return registry;
}
