/**
 * Settings-route default-model picker open state + catalog load.
 * Extracted from settings-route/render.tsx (mechanical split).
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import type { AgentManagementManagedProvider } from "../../../app/lib/desktop";
import type { Client, ModelOption } from "../../../app/types";
import { isProviderModelFree, modelSupportsVision } from "../../../app/utils/providers";
import { t } from "../../../i18n";
import {
  ensureProviderListQuery,
  getConnectedProviderItems,
} from "../../domains/connections";
import { getReactQueryClient } from "../../infra/query-client";
import type { UserErrorScenario } from "../../kernel/user-error";
import {
  openModelPickerEvent,
  pendingModelPickerProviderIdsKey,
} from "../new-providers-toast";

export type SettingsModelPickerInput = {
  opencodeClient: Client | null;
  opencodeBaseUrl: string;
  selectedWorkspaceRoot: string;
  providerAuthStore: {
    refreshProviders: () => void | Promise<unknown>;
  };
  setFacingRouteError: (
    raw: string | null,
    forcedScenario?: UserErrorScenario,
  ) => void;
};

/** Mechanical extract of model picker open + options load for settings. */
export function useSettingsModelPicker(input: SettingsModelPickerInput) {
  const {
    opencodeClient,
    opencodeBaseUrl,
    selectedWorkspaceRoot,
    providerAuthStore,
    setFacingRouteError,
  } = input;

  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelPickerQuery, setModelPickerQuery] = useState("");
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);

  useEffect(() => {
    const openFromPending = (raw: string | null) => {
      if (!raw) return false;
      setModelPickerQuery("");
      setModelPickerOpen(true);
      return true;
    };

    try {
      const raw = window.localStorage.getItem(pendingModelPickerProviderIdsKey);
      if (openFromPending(raw)) {
        window.localStorage.removeItem(pendingModelPickerProviderIdsKey);
      }
    } catch {
      window.localStorage.removeItem(pendingModelPickerProviderIdsKey);
    }

    const handler = () => {
      setModelPickerQuery("");
      setModelPickerOpen(true);
      try {
        window.localStorage.removeItem(pendingModelPickerProviderIdsKey);
      } catch {}
    };
    window.addEventListener(openModelPickerEvent, handler);
    return () => window.removeEventListener(openModelPickerEvent, handler);
  }, []);

  useEffect(() => {
    if (!modelPickerOpen || !opencodeClient) return;
    let cancelled = false;
    void providerAuthStore.refreshProviders();
    void (async () => {
      try {
        const data = await ensureProviderListQuery(getReactQueryClient(), {
          client: opencodeClient,
          baseUrl: opencodeBaseUrl,
          directory: selectedWorkspaceRoot || undefined,
        });
        if (cancelled || !data?.all) return;
        let seenIds: Set<string>;
        try {
          const raw = window.localStorage.getItem("onmyagent.seenProviderIds");
          seenIds = new Set(raw ? JSON.parse(raw) : []);
        } catch {
          seenIds = new Set();
        }
        // Prefer Settings inventory names so renames (阿里TokenPlan / 火山)
        // match the Models list instead of npm defaults (千问).
        const displayNameByProviderId: Record<string, string> = {};
        let managed: AgentManagementManagedProvider[] = [];
        try {
          const {
            loadOpenCodeManagedProvidersForWorkspace,
            peekOpenCodeManagedProvidersCache,
          } = await import("../../domains/settings");
          const root = selectedWorkspaceRoot || "";
          const cached = root
            ? peekOpenCodeManagedProvidersCache(root)
            : null;
          managed =
            root && (!cached || cached.length === 0)
              ? await loadOpenCodeManagedProvidersForWorkspace(root)
              : cached ?? [];
          for (const provider of managed) {
            const id = provider.id?.trim();
            const name = provider.name?.trim();
            if (id && name) displayNameByProviderId[id] = name;
          }
        } catch {
          // best-effort label overlay
        }
        const options: ModelOption[] = [];
        for (const provider of getConnectedProviderItems(data, {
          managedProviders: managed,
        })) {
          const modelIds = Object.keys(provider.models);
          const isNew = !seenIds.has(provider.id);
          const displayName =
            displayNameByProviderId[provider.id]?.trim() ||
            provider.name ||
            provider.id;
          for (const id of modelIds) {
            const model = provider.models[id];
            options.push({
              providerID: provider.id,
              modelID: id,
              title: model.name || id,
              description: displayName,
              behaviorTitle: t("settings.model_reasoning"),
              behaviorLabel: t("settings.default_label"),
              behaviorDescription: "",
              behaviorValue: null,
              isFree: isProviderModelFree({
                providerId: provider.id,
                modelId: id,
                model,
              }),
              supportsVision: modelSupportsVision(model, id),
              isConnected: true,
              isRecommended: isNew,
              source: /^lpr_/i.test(provider.id) ? ("cloud" as const) : undefined,
            });
          }
        }
        setModelOptions(options);
      } catch (error) {
        setFacingRouteError(
          error instanceof Error ? error.message : t("app.unknown_error"),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    modelPickerOpen,
    opencodeBaseUrl,
    opencodeClient,
    providerAuthStore,
    selectedWorkspaceRoot,
    setFacingRouteError,
  ]);

  return {
    modelPickerOpen,
    setModelPickerOpen,
    modelPickerQuery,
    setModelPickerQuery,
    modelOptions,
  };
}
