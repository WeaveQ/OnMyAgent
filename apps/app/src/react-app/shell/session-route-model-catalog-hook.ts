/**
 * Provider discovery, model catalog prefetch, variant options, picker list,
 * slash commands, and settings navigation helpers for the session route.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { NavigateFunction } from "react-router-dom";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import { unwrap } from "../../app/lib/opencode";
import { listCommands } from "../../app/lib/opencode-session";
import type { ResolvedWorkspaceEndpoint } from "../../app/lib/workspace-endpoint";
import type {
  Client,
  ModelOption,
  ModelRef,
  ProviderListItem,
  SlashCommandOption,
} from "../../app/types";
import { resolveModelDisplayName } from "../../app/utils";
import { filterProviderList } from "../../app/utils/providers";
import type { DesktopAppRestrictionChecker } from "../../app/cloud/desktop-app-restrictions";
import { currentLocale, subscribeToLocale, t } from "../../i18n";
import type { LocalPreferences } from "../kernel/local-provider";
import { getReactQueryClient } from "../infra/query-client";
import {
  ensureProviderListQuery,
} from "../domains/connections";
import { seedSessionState } from "../domains/session";
import { writeActiveWorkspaceId } from "./session-memory";
import { buildSettingsNavigationTarget } from "./session-route-model";
import {
  buildConnectedModelOptions,
  buildProviderModelCatalog,
  filterAllowedModelOptions,
  resolveModelVariantState,
  resolveProviderDefaultModel,
  type ProviderModelCatalog,
} from "./session-route-model-options";
import { emptyModelBehaviorOptions } from "./session-route-state";
import { readWindowSeenProviderIds } from "./session-route-storage";
import { refreshCreatedSessionSnapshotWithRetries } from "./session-route-sessions";
import { workspaceSettingsRoute } from "./workspace-routes";

type Input = {
  checkDesktopRestriction: DesktopAppRestrictionChecker;
  denSessionVersion: number;
  engineReloadVersion: number;
  local: {
    prefs: LocalPreferences;
    setPrefs: (updater: (previous: LocalPreferences) => LocalPreferences) => void;
  };
  modelOptions: ModelOption[];
  modelPickerOpen: boolean;
  navigate: NavigateFunction;
  opencodeBaseUrl: string;
  opencodeClient: Client | null;
  pendingAgentModel: ModelRef | null | undefined;
  providerListData: ProviderListResponse | undefined;
  recentProviderIds: Set<string>;
  selectedSessionId: string | null;
  selectedWorkspaceEndpoint: ResolvedWorkspaceEndpoint | null;
  selectedWorkspaceId: string;
  sessionModelOverrideById: Record<string, ModelRef>;
  sessionWorkspaceRoot: string;
  setModelOptions: Dispatch<SetStateAction<ModelOption[]>>;
  sidebarActiveWorkspaceId: string;
};

export function useSessionRouteModelCatalog(input: Input) {
  const {
    checkDesktopRestriction,
    denSessionVersion,
    engineReloadVersion,
    local,
    modelOptions,
    modelPickerOpen,
    navigate,
    opencodeBaseUrl,
    opencodeClient,
    pendingAgentModel,
    providerListData,
    recentProviderIds,
    selectedSessionId,
    selectedWorkspaceEndpoint,
    selectedWorkspaceId,
    sessionModelOverrideById,
    sessionWorkspaceRoot,
    setModelOptions,
    sidebarActiveWorkspaceId,
  } = input;

  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [providerDefaults, setProviderDefaults] = useState<
    Record<string, string>
  >({});
  const [providerConnectedIds, setProviderConnectedIds] = useState<string[]>(
    [],
  );
  const [disabledProviderIds, setDisabledProviderIds] = useState<string[]>([]);
  const [providerCatalog, setProviderCatalog] = useState<ProviderModelCatalog>(
    {},
  );

  // Discover providers / defaults when the OpenCode client or engine changes.
  useEffect(() => {
    if (!opencodeClient) {
      setProviders([]);
      setProviderDefaults({});
      setProviderConnectedIds([]);
      return;
    }

    let cancelled = false;

    const applyProviderState = (value: ProviderListResponse) => {
      if (cancelled) return;
      setProviders(value.all ?? []);
      setProviderConnectedIds(value.connected ?? []);
      setProviderDefaults(value.default ?? {});

      const providerDefaultModel = resolveProviderDefaultModel({
        defaults: value.default,
        currentDefault: local.prefs.defaultModel,
      });
      if (providerDefaultModel) {
        local.setPrefs((previous) => ({
          ...previous,
          defaultModel: providerDefaultModel,
        }));
      }

      // New-provider detection is handled globally by the provider auth
      // store's applyProviderListState, which fires dispatchNewProviders.
    };

    void (async () => {
      let disabledProviders: string[] = [];
      try {
        const config = unwrap(
          await opencodeClient.config.get({
            directory: sessionWorkspaceRoot || undefined,
          }),
        ) as { disabled_providers?: string[] };
        disabledProviders = Array.isArray(config.disabled_providers)
          ? config.disabled_providers
          : [];
        if (!cancelled) setDisabledProviderIds(disabledProviders);
      } catch {
        // ignore config read failures and continue with provider discovery
      }

      try {
        applyProviderState(
          filterProviderList(
            await ensureProviderListQuery(getReactQueryClient(), {
              client: opencodeClient,
              baseUrl: opencodeBaseUrl,
              directory: sessionWorkspaceRoot || undefined,
            }),
            disabledProviders,
          ),
        );
      } catch {
        if (cancelled) return;
        setProviders([]);
        setProviderDefaults({});
        setProviderConnectedIds([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    denSessionVersion,
    opencodeBaseUrl,
    opencodeClient,
    sessionWorkspaceRoot,
  ]);

  const modelScopeSessionId =
    selectedSessionId ?? `draft:${selectedWorkspaceId}`;
  // Priority: 1) this session's override, 2) pending agent's configured model,
  // 3) global default. Session controls must never rewrite the global default.
  const effectiveModelRef =
    sessionModelOverrideById[modelScopeSessionId] ??
    pendingAgentModel ??
    local.prefs.defaultModel;
  const modelLabel = effectiveModelRef
    ? resolveModelDisplayName(effectiveModelRef.modelID)
    : t("session.default_model");
  const localeSnapshot = useSyncExternalStore(
    subscribeToLocale,
    currentLocale,
    currentLocale,
  );

  // Prefetch the full provider catalog once so `getModelBehaviorSummary` has
  // everything it needs to expose the reasoning/thinking variants the active
  // model supports — without waiting for the model picker to open. Cached
  // as providerID → modelID → ProviderModel.
  useEffect(() => {
    if (!providerListData?.all) return;
    setProviderCatalog(buildProviderModelCatalog(providerListData));
  }, [providerListData]);

  // Compute behavior (reasoning/thinking variant) options for the current
  // default model. This is what the composer renders as its variant pill.
  const { modelVariantLabel, modelBehaviorOptions, modelVariantValue } =
    useMemo(
      () =>
        resolveModelVariantState({
          ref: effectiveModelRef,
          variant: local.prefs.modelVariant,
          providerCatalog,
          emptyOptions: emptyModelBehaviorOptions,
        }),
      [
        effectiveModelRef,
        local.prefs.modelVariant,
        localeSnapshot,
        providerCatalog,
      ],
    );

  // Load the picker list lazily the first time the modal opens. Uses the
  // cached catalog when available, otherwise re-fetches.
  useEffect(() => {
    if (!modelPickerOpen || !opencodeClient) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await ensureProviderListQuery(getReactQueryClient(), {
          client: opencodeClient,
          baseUrl: opencodeBaseUrl,
          directory: sessionWorkspaceRoot || undefined,
        });
        if (cancelled || !data?.all) return;
        setModelOptions(
          buildConnectedModelOptions({
            data,
            seenProviderIds: readWindowSeenProviderIds(),
            recentProviderIds,
          }),
        );
      } catch {
        // Silent: the picker surfaces an empty list rather than blocking the UI.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    modelPickerOpen,
    opencodeBaseUrl,
    opencodeClient,
    recentProviderIds,
    sessionWorkspaceRoot,
    setModelOptions,
  ]);

  // Apply org-level restrictions (dev #1505) on top of the raw model list
  // so the picker never surfaces blocked options:
  //   - `allowZenModel` hides the built-in OpenCode provider entries when false
  //   - `allowCustomProviders` hides providers that OpenCode does not report
  //     as connected through the provider list endpoint.
  const allowedModelOptions = useMemo(
    () =>
      filterAllowedModelOptions({
        options: modelOptions,
        checkRestriction: checkDesktopRestriction,
      }),
    [checkDesktopRestriction, modelOptions],
  );

  const listSlashCommands = useCallback(async (): Promise<
    SlashCommandOption[]
  > => {
    // engineReloadVersion is included so the callback identity changes after
    // an engine reload, which invalidates the composer's command list cache
    // and causes it to re-fetch (picking up newly created skills).
    void engineReloadVersion;
    if (!opencodeClient) return [];
    return listCommands(opencodeClient, sessionWorkspaceRoot || undefined);
  }, [engineReloadVersion, opencodeClient, sessionWorkspaceRoot]);

  const refreshCreatedSessionSnapshot = useCallback(
    (sessionId: string, directory: string) => {
      const endpoint = selectedWorkspaceEndpoint;
      if (!endpoint) return;
      void refreshCreatedSessionSnapshotWithRetries({
        directory,
        endpoint,
        sessionId,
        setQueryData: (queryKey, value) =>
          getReactQueryClient().setQueryData(queryKey, value),
        seedSessionState,
      });
    },
    [selectedWorkspaceEndpoint],
  );

  const handleOpenSettings = useCallback(
    (route = "/settings/general", workspaceId = sidebarActiveWorkspaceId) => {
      const navigation = buildSettingsNavigationTarget({
        route,
        workspaceId,
        activeWorkspaceId: sidebarActiveWorkspaceId,
        selectedSessionId,
        workspaceSettingsRoute,
      });
      writeActiveWorkspaceId(workspaceId || null);
      navigate(navigation.target, { state: navigation.state });
    },
    [navigate, selectedSessionId, sidebarActiveWorkspaceId],
  );

  return {
    allowedModelOptions,
    disabledProviderIds,
    effectiveModelRef,
    handleOpenSettings,
    listSlashCommands,
    localeSnapshot,
    modelBehaviorOptions,
    modelLabel,
    modelVariantLabel,
    modelVariantValue,
    providerConnectedIds,
    providerDefaults,
    providers,
    refreshCreatedSessionSnapshot,
    setDisabledProviderIds,
    setProviderConnectedIds,
    setProviderDefaults,
    setProviders,
  };
}
