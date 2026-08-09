/**
 * Disconnect / delete handlers for the settings AI providers list.
 * Kept out of render.tsx for file-size and testability.
 */
import { t } from "../../../i18n";
import {
  agentManagementProviderAction,
  type AgentManagementManagedProvider,
} from "../../../app/lib/desktop";
import type { ReloadReason, ReloadTrigger } from "../../../app/types";
import type { LocalPreferences } from "../../kernel/local-provider";
import { getReactQueryClient } from "../../infra/query-client";
import { refreshProviderListQueries } from "../../domains/connections";
import { userErrorFromRaw } from "../../kernel/user-error";

export async function disconnectSettingsProvider(input: {
  providerId: string;
  disconnectProvider: (providerId: string) => Promise<unknown>;
  setBusyId: (id: string | null) => void;
  setError: (message: string | null) => void;
}): Promise<void> {
  input.setBusyId(input.providerId);
  input.setError(null);
  try {
    await input.disconnectProvider(input.providerId);
  } catch (error) {
    input.setError(
      userErrorFromRaw(
        error instanceof Error ? error.message : t("providers.disconnect_failed"),
      ),
    );
  } finally {
    input.setBusyId(null);
  }
}

export async function deleteOpenCodeManagedProvider(input: {
  providerId: string;
  workspaceRoot: string;
  defaultModelProviderId?: string | null;
  setBusyId: (id: string | null) => void;
  setSyncBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  setOpenCodeManagedProviders: (
    updater:
      | AgentManagementManagedProvider[]
      | ((
          current: AgentManagementManagedProvider[],
        ) => AgentManagementManagedProvider[]),
  ) => void;
  setPrefs: (
    updater: (previous: LocalPreferences) => LocalPreferences,
  ) => void;
  applyEngineConfigForProviders: () => Promise<boolean>;
  refreshProviders: (opts: { dispose: boolean }) => Promise<unknown>;
  loadOpenCodeManagedProviders: (options?: {
    force?: boolean;
  }) => Promise<AgentManagementManagedProvider[]>;
  clearReloadRequired: () => void;
  markReloadRequired: (reason: ReloadReason, trigger?: ReloadTrigger) => void;
  /**
   * Also drop the provider from the active workspace opencode.json(c)
   * (connector / Ollama installs land there via patchConfig).
   */
  removeWorkspaceProvider?: (providerId: string) => Promise<void>;
}): Promise<void> {
  input.setBusyId(input.providerId);
  input.setSyncBusy(true);
  input.setError(null);
  try {
    await agentManagementProviderAction({
      action: "delete",
      appType: "opencode",
      providerId: input.providerId,
      workspaceRoot: input.workspaceRoot,
    });
    // Workspace project file (e.g. Ollama from connectors) — independent of
    // the global ~/.config/opencode write above.
    await input.removeWorkspaceProvider?.(input.providerId).catch(() => null);
    input.setOpenCodeManagedProviders((current) =>
      current.filter((item) => item.id !== input.providerId),
    );
    if (input.defaultModelProviderId === input.providerId) {
      input.setPrefs((previous) => ({
        ...previous,
        defaultModel: null,
        modelVariant: null,
      }));
    }
    const applied = await input.applyEngineConfigForProviders().catch(() => false);
    await input.refreshProviders({ dispose: true }).catch(() => null);
    await refreshProviderListQueries(getReactQueryClient()).catch(() => null);
    const managed = await input.loadOpenCodeManagedProviders({ force: true });
    input.setOpenCodeManagedProviders(managed);
    if (applied) {
      input.clearReloadRequired();
    } else {
      input.markReloadRequired("config", {
        type: "config",
        name: "opencode.json",
        action: "updated",
      });
    }
  } catch (error) {
    input.setError(
      userErrorFromRaw(
        error instanceof Error
          ? error.message
          : t("settings.custom_provider_remove_failed"),
      ),
    );
  } finally {
    input.setBusyId(null);
    input.setSyncBusy(false);
  }
}
