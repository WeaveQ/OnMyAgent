/**
 * Build a seed row for OpenCodeProviderConfigDialog when agent-management
 * inventory does not yet know the provider (workspace config installs).
 */
import type { AgentManagementManagedProvider } from "../../../app/lib/desktop";
import type { ProviderListItem } from "../../../app/types";
import { OLLAMA_PROVIDER_CONFIG } from "../../domains/settings";
import type { AiSettingsConnectedProvider } from "../../domains/settings";

export function buildOpenCodeProviderEditFallback(
  provider: AiSettingsConnectedProvider,
  sdkProviders: ReadonlyArray<ProviderListItem>,
): AgentManagementManagedProvider {
  const sdkProvider = sdkProviders.find((item) => item.id === provider.id);
  const sdkModels = Object.entries(sdkProvider?.models ?? {}).map(
    ([id, model]) => ({
      id,
      name:
        model && typeof model === "object" && "name" in model
          ? String((model as { name?: string }).name ?? id)
          : id,
    }),
  );
  const isOllama = provider.id === "ollama";
  const fallbackSettings: Record<string, unknown> = {
    name: provider.name || provider.id,
    npm: "@ai-sdk/openai-compatible",
    options: {
      baseURL: isOllama ? OLLAMA_PROVIDER_CONFIG.baseURL : "",
    },
    ...(sdkModels.length > 0
      ? {
          models: Object.fromEntries(
            sdkModels.map((model) => [model.id, { name: model.name }]),
          ),
        }
      : isOllama
        ? {
            models: {
              [OLLAMA_PROVIDER_CONFIG.defaultModelId]: {
                name: OLLAMA_PROVIDER_CONFIG.defaultModelId,
              },
            },
          }
        : {}),
  };
  return {
    id: provider.id,
    appType: "opencode",
    name: provider.name || provider.id,
    settingsConfig: fallbackSettings,
    isCurrent: false,
    inFailoverQueue: false,
    liveManaged: true,
    livePresent: true,
    configPath: "",
    models: sdkModels.length
      ? sdkModels
      : isOllama
        ? [
            {
              id: OLLAMA_PROVIDER_CONFIG.defaultModelId,
              name: OLLAMA_PROVIDER_CONFIG.defaultModelId,
            },
          ]
        : [],
  };
}
