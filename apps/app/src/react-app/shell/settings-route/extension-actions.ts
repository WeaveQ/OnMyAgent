/** @jsxImportSource react */
/**
 * Settings extension install/test handlers (image, voice, local provider).
 * Extracted from settings-route/render.tsx (mechanical split).
 */
import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import type { ResolvedWorkspaceEndpoint } from "../../../app/lib/workspace-endpoint";
import type { ReloadReason, ReloadTrigger } from "../../../app/types";
import { t } from "../../../i18n";
import { getReactQueryClient } from "../../infra/query-client";
import { refreshProviderListQueries } from "../../domains/connections";
import {
  OPENAI_API_KEY_ENV_KEY,
  OPENAI_IMAGE_EXTENSION_ID,
  OPENAI_IMAGE_MODEL,
  installOpenAiImageExtensionFiles,
  openAiImageResponseToArrayBuffer,
  requestOpenAiImage,
  slugifyImageArtifactName,
  type LocalProviderInstallInput,
} from "../../domains/settings";
import type { LocalPreferences } from "../../kernel/local-provider";
import { describeRouteError } from "./model";

export type SettingsExtensionActionsInput = {
  onmyagentClient: OnMyAgentServerClient | null;
  selectedWorkspaceEndpoint: ResolvedWorkspaceEndpoint | null;
  runtimeWorkspaceId: string | null | undefined;
  reloadCoordinator: {
    markReloadRequired: (reason: ReloadReason, trigger?: ReloadTrigger) => void;
  };
  local: {
    setPrefs: (updater: (previous: LocalPreferences) => LocalPreferences) => void;
  };
  setImageExtensionBusy: Dispatch<SetStateAction<boolean>>;
  setImageExtensionStatus: Dispatch<SetStateAction<string | null>>;
  setImageExtensionError: Dispatch<SetStateAction<string | null>>;
  setImageExtensionInstalled: Dispatch<SetStateAction<boolean>>;
  setImageGenerationBusy: Dispatch<SetStateAction<boolean>>;
  setImageGenerationStatus: Dispatch<SetStateAction<string | null>>;
  setImageGenerationError: Dispatch<SetStateAction<string | null>>;
  setVoiceBusy: Dispatch<SetStateAction<boolean>>;
  setVoiceStatus: Dispatch<SetStateAction<string | null>>;
  setVoiceError: Dispatch<SetStateAction<string | null>>;
  setLocalProviderBusy: Dispatch<SetStateAction<boolean>>;
  setLocalProviderStatus: Dispatch<SetStateAction<string | null>>;
  setLocalProviderError: Dispatch<SetStateAction<string | null>>;
  setUserEnvKeys: Dispatch<SetStateAction<string[]>>;
};

/** Mechanical extract of settings extension action callbacks. */
export function useSettingsExtensionActions(input: SettingsExtensionActionsInput) {
  const {
    onmyagentClient,
    selectedWorkspaceEndpoint,
    runtimeWorkspaceId,
    reloadCoordinator,
    local,
    setImageExtensionBusy,
    setImageExtensionStatus,
    setImageExtensionError,
    setImageExtensionInstalled,
    setImageGenerationBusy,
    setImageGenerationStatus,
    setImageGenerationError,
    setVoiceBusy,
    setVoiceStatus,
    setVoiceError,
    setLocalProviderBusy,
    setLocalProviderStatus,
    setLocalProviderError,
    setUserEnvKeys,
  } = input;

  const installOpenAiImageExtension = useCallback(async (apiKey: string) => {
    const workspaceClient = selectedWorkspaceEndpoint?.client ?? onmyagentClient;
    const workspaceId = runtimeWorkspaceId?.trim() ?? "";
    const resolvedApiKey = apiKey.trim();
    if (!workspaceClient || !workspaceId) {
      setImageExtensionError(t("extensions.openai_image_server_not_connected"));
      return;
    }
    if (!resolvedApiKey) {
      setImageExtensionError(t("extensions.openai_image_api_key_required"));
      return;
    }

    setImageExtensionBusy(true);
    setImageExtensionStatus(null);
    setImageExtensionError(null);
    try {
      await installOpenAiImageExtensionFiles({
        apiKey: resolvedApiKey,
        client: workspaceClient,
        workspaceId,
      });
      // upsertUserEnv requires the host token; use onmyagentClient which carries it.
      if (onmyagentClient) {
        await onmyagentClient.upsertUserEnv([{ key: OPENAI_API_KEY_ENV_KEY, value: resolvedApiKey }]);
        setUserEnvKeys((current) => Array.from(new Set([...current, OPENAI_API_KEY_ENV_KEY])));
      }
      reloadCoordinator.markReloadRequired("plugins", { type: "plugin", name: OPENAI_IMAGE_EXTENSION_ID, action: "added" });
      setImageExtensionInstalled(true);
      setImageExtensionStatus(t("extensions.openai_image_installed_status"));
    } catch (error) {
      setImageExtensionError(describeRouteError(error));
    } finally {
      setImageExtensionBusy(false);
    }
  }, [onmyagentClient, reloadCoordinator, runtimeWorkspaceId, selectedWorkspaceEndpoint]);

  const generateOpenAiTestImage = useCallback(async (input: { apiKey: string; prompt: string }) => {
    const client = selectedWorkspaceEndpoint?.client ?? onmyagentClient;
    const workspaceId = runtimeWorkspaceId?.trim() ?? "";
    const apiKey = input.apiKey.trim();
    const prompt = input.prompt.trim();
    if (!client || !workspaceId) {
      setImageGenerationError(t("extensions.openai_image_server_not_connected"));
      return;
    }
    if (!apiKey) {
      setImageGenerationError(t("extensions.openai_image_api_key_required"));
      return;
    }
    if (!prompt) {
      setImageGenerationError(t("app.error_prompt_required"));
      return;
    }

    setImageGenerationBusy(true);
    setImageGenerationStatus(null);
    setImageGenerationError(null);
    try {
      const payload = await requestOpenAiImage({ apiKey, prompt });
      const data = await openAiImageResponseToArrayBuffer(payload);
      const fileName = `${slugifyImageArtifactName(prompt)}.png`;
      await client.writeWorkspaceBinaryFile(workspaceId, { path: `artifacts/${fileName}`, data, force: true });
      setImageGenerationStatus(t("extensions.openai_image_generated_status", { fileName, model: OPENAI_IMAGE_MODEL }));
    } catch (error) {
      setImageGenerationError(describeRouteError(error));
    } finally {
      setImageGenerationBusy(false);
    }
  }, [onmyagentClient, runtimeWorkspaceId, selectedWorkspaceEndpoint]);

  const saveVoiceApiKey = useCallback(async (apiKey: string) => {
    const resolvedApiKey = apiKey.trim();
    if (!onmyagentClient || !resolvedApiKey) {
      setVoiceError(t("extensions.voice_openai_api_key_required"));
      return;
    }
    setVoiceBusy(true);
    setVoiceStatus(null);
    setVoiceError(null);
    try {
      await onmyagentClient.upsertUserEnv([{ key: OPENAI_API_KEY_ENV_KEY, value: resolvedApiKey }]);
      setUserEnvKeys((current) => Array.from(new Set([...current, OPENAI_API_KEY_ENV_KEY])));
      setVoiceStatus(t("extensions.voice_saved_status"));
    } catch (error) {
      setVoiceError(describeRouteError(error));
    } finally {
      setVoiceBusy(false);
    }
  }, [onmyagentClient]);

  const testVoiceSession = useCallback(async () => {
    if (!onmyagentClient) {
      setVoiceError(t("extensions.voice_server_not_connected"));
      return;
    }
    setVoiceBusy(true);
    setVoiceStatus(null);
    setVoiceError(null);
    try {
      const session = await onmyagentClient.createVoiceRealtimeSession();
      setVoiceStatus(t("extensions.voice_realtime_ready_status", { model: session.model, count: session.tools.length }));
    } catch (error) {
      setVoiceError(describeRouteError(error));
    } finally {
      setVoiceBusy(false);
    }
  }, [onmyagentClient]);

  const installLocalProvider = useCallback(async (input: LocalProviderInstallInput) => {
    const client = selectedWorkspaceEndpoint?.client ?? onmyagentClient;
    const workspaceId = runtimeWorkspaceId?.trim() ?? "";
    const modelId = input.modelId.trim();
    if (!client || !workspaceId) {
      setLocalProviderError(t("extensions.local_provider_server_not_connected"));
      return;
    }
    if (!modelId) {
      setLocalProviderError(t("extensions.local_provider_model_required"));
      return;
    }

    setLocalProviderBusy(true);
    setLocalProviderStatus(null);
    setLocalProviderError(null);
    try {
      await client.patchConfig(workspaceId, {
        opencode: {
          provider: {
            [input.providerId]: {
              npm: "@ai-sdk/openai-compatible",
              name: input.name,
              options: { baseURL: input.baseURL },
              models: { [modelId]: { name: input.modelName.trim() || modelId } },
            },
          },
        },
      });
      if (input.setDefault) {
        local.setPrefs((previous) => ({
          ...previous,
          defaultModel: { providerID: input.providerId, modelID: modelId },
          modelVariant: null,
        }));
      }
      reloadCoordinator.markReloadRequired("config", { type: "config", name: "opencode.json", action: "updated" });
      try {
        await client.reloadEngine(workspaceId);
      } catch {
        // The reload toast still lets the user retry if the immediate reload fails.
      }
      await refreshProviderListQueries(getReactQueryClient());
      try {
        window.dispatchEvent(new CustomEvent("onmyagent-server-settings-changed"));
      } catch {
        // ignore browser event dispatch failures
      }
      setLocalProviderStatus(t("extensions.local_provider_added_status", { name: input.name, modelId }));
    } catch (error) {
      setLocalProviderError(describeRouteError(error));
    } finally {
      setLocalProviderBusy(false);
    }
  }, [local, onmyagentClient, reloadCoordinator, runtimeWorkspaceId, selectedWorkspaceEndpoint]);


  return {
    installOpenAiImageExtension,
    generateOpenAiTestImage,
    saveVoiceApiKey,
    testVoiceSession,
    installLocalProvider,
  };
}
