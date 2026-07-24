/**
 * Provider discovery, model catalog prefetch, variant options, picker list,
 * slash commands, and settings navigation helpers for the session route.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { NavigateFunction } from "react-router-dom";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import { unwrap } from "../../../app/lib/opencode";
import { listCommands } from "../../../app/lib/opencode-session";
import type { ResolvedWorkspaceEndpoint } from "../../../app/lib/workspace-endpoint";
import type {
  Client,
  ModelOption,
  ModelRef,
  ProviderListItem,
  SlashCommandOption,
} from "../../../app/types";
import {
  resolveModelDisplayName,
} from "../../../app/utils";
import { filterProviderList } from "../../../app/utils/providers";
import type { DesktopAppRestrictionChecker } from "../../../app/cloud/desktop-app-restrictions";
import { currentLocale, subscribeToLocale, t } from "../../../i18n";
import type { LocalPreferences } from "../../kernel/local-provider";
import {
  clearStoredDefaultModel,
} from "../../kernel/model-config";
import { getReactQueryClient } from "../../infra/query-client";
import {
  ensureProviderListQuery,
} from "../../domains/connections";
import { seedSessionState } from "../../domains/session";
import { useStatusToasts } from "../../domains/shell-feedback";
import { writeActiveWorkspaceId } from "../session-memory";
import { buildSettingsNavigationTarget } from "./model";
import {
  buildConnectedModelOptions,
  buildProviderModelCatalog,
  filterAllowedModelOptions,
  isModelPickableInConnectedCatalog,
  isSelectedModelUnavailable,
  resolveModelVariantState,
  resolveUsableDefaultModel,
  type ProviderModelCatalog,
} from "./model-options";
import { emptyModelBehaviorOptions } from "./state";
import { readWindowSeenProviderIds } from "./storage";
import { refreshCreatedSessionSnapshotWithRetries } from "./sessions";
import { workspaceSettingsRoute } from "../workspace-routes";

/**
 * Session-scoped dedupe for "previous model unavailable" toasts.
 * Lives outside the hook so remounts / soft reloads do not re-spam the same model.
 */
const toastedUnavailableModelKeys = new Set<string>();

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
  /** Compact composer model menu — must refresh options the same way as the full picker. */
  compactModelPickerOpen?: boolean;
  navigate: NavigateFunction;
  opencodeBaseUrl: string;
  opencodeClient: Client | null;
  pendingAgentModel: ModelRef | null | undefined;
  providerListData: ProviderListResponse | undefined;
  recentProviderIds: Set<string>;
  /** Current shell mode so settings "Back to app" can return to the same side. */
  pageMode: "assistant" | "expert";
  /** Pathname+search when opening settings (restored by Back to app). */
  returnTo: string;
  selectedSessionId: string | null;
  selectedWorkspaceEndpoint: ResolvedWorkspaceEndpoint | null;
  selectedWorkspaceId: string;
  sessionModelOverrideById: Record<string, ModelRef>;
  setSessionModelOverrideById: Dispatch<SetStateAction<Record<string, ModelRef>>>;
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
    setSessionModelOverrideById,
    modelOptions,
    modelPickerOpen,
    compactModelPickerOpen = false,
    navigate,
    opencodeBaseUrl,
    opencodeClient,
    pageMode,
    pendingAgentModel,
    providerListData,
    recentProviderIds,
    returnTo,
    selectedSessionId,
    selectedWorkspaceEndpoint,
    selectedWorkspaceId,
    sessionModelOverrideById,
    sessionWorkspaceRoot,
    setModelOptions,
    sidebarActiveWorkspaceId,
  } = input;

  const { showToast } = useStatusToasts();
  const defaultModelRef = useRef(local.prefs.defaultModel);
  defaultModelRef.current = local.prefs.defaultModel;
  const setPrefsRef = useRef(local.setPrefs);
  setPrefsRef.current = local.setPrefs;
  const checkRestrictionRef = useRef(checkDesktopRestriction);
  checkRestrictionRef.current = checkDesktopRestriction;

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

      // Keep the user's last-used default even if it became unavailable.
      // Do not auto-switch to another model — the composer shows
      // "模型已不可用" and the user picks a new one.
      // Only clear when discovery finishes with an empty catalog.
      let currentDefault = defaultModelRef.current;
      const resolved = resolveUsableDefaultModel({
        currentDefault,
        checkRestriction: checkRestrictionRef.current,
        connectedProviderIds: value.connected ?? [],
        providerListData: value,
      });
      if (resolved.changed && !resolved.model) {
        clearStoredDefaultModel();
        setPrefsRef.current((previous) => ({
          ...previous,
          defaultModel: null,
        }));
        currentDefault = null;
        defaultModelRef.current = null;
      } else if (!resolved.changed && resolved.model) {
        currentDefault = resolved.model;
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
    engineReloadVersion,
    opencodeBaseUrl,
    opencodeClient,
    sessionWorkspaceRoot,
  ]);

  const modelScopeSessionId =
    selectedSessionId ?? `draft:${selectedWorkspaceId}`;
  // Priority: 1) this session's override, 2) pending agent's configured model,
  // 3) global default (last model chosen in the composer — also written on select).
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

  // When the active model is no longer available (e.g. provider removed from
  // config), do NOT auto-switch. Composer shows "模型已不可用"; toast once per
  // model key for the app session so soft reloads / remounts do not spam.
  const effectiveModelKey = effectiveModelRef
    ? `${effectiveModelRef.providerID}/${effectiveModelRef.modelID}`
    : "";
  const connectedProviderKey = providerConnectedIds.join(",");
  useEffect(() => {
    if (!providerListData) return;

    const connectedIds = new Set(
      [
        ...providerConnectedIds,
        ...(providerListData.connected ?? []).map((id) => String(id)),
      ]
        .map((id) => id.trim())
        .filter(Boolean),
    );
    // Soft dispose / engine reload often reports zero connected providers for a
    // beat. That is not "model removed" — skip toast and do not re-arm.
    if (connectedIds.size === 0) return;

    const restriction = checkRestrictionRef.current;
    const effectiveUnavailable = isSelectedModelUnavailable({
      model: effectiveModelRef,
      checkRestriction: restriction,
      connectedProviderIds: providerConnectedIds,
      providerListData,
    });

    if (!effectiveModelKey) return;

    if (!effectiveUnavailable) {
      // Only re-arm when the model is genuinely pickable again (not a flicker).
      if (
        isModelPickableInConnectedCatalog(providerListData, effectiveModelRef)
      ) {
        toastedUnavailableModelKeys.delete(effectiveModelKey);
      }
      return;
    }

    if (toastedUnavailableModelKeys.has(effectiveModelKey)) return;
    toastedUnavailableModelKeys.add(effectiveModelKey);

    const modelLabel =
      resolveModelDisplayName(effectiveModelRef!.modelID) || effectiveModelKey;
    showToast({
      tone: "warning",
      title: t("session.model_unavailable_after_removed_title"),
      description: t("session.model_unavailable_after_removed_desc", {
        model: modelLabel,
      }),
      durationMs: 7000,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    connectedProviderKey,
    effectiveModelKey,
    pendingAgentModel,
    providerListData,
  ]);

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

  // Keep composer/full picker options in sync whenever the connected provider
  // catalog changes (e.g. custom provider deleted in Settings). Without this,
  // modelOptions can retain deleted providers until a full page reload.
  useEffect(() => {
    if (!providerListData) {
      setModelOptions([]);
      return;
    }
    setModelOptions(
      buildConnectedModelOptions({
        data: providerListData,
        seenProviderIds: readWindowSeenProviderIds(),
        recentProviderIds,
      }),
    );
  }, [providerListData, recentProviderIds, setModelOptions]);

  // When either the compact or full model menu opens, force a fresh provider
  // list so we never show providers that were just removed.
  useEffect(() => {
    const pickerOpen = modelPickerOpen || compactModelPickerOpen;
    if (!pickerOpen || !opencodeClient) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await ensureProviderListQuery(getReactQueryClient(), {
          client: opencodeClient,
          baseUrl: opencodeBaseUrl,
          directory: sessionWorkspaceRoot || undefined,
          force: true,
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
    compactModelPickerOpen,
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
        pageMode,
        returnTo,
        workspaceSettingsRoute,
      });
      writeActiveWorkspaceId(workspaceId || null);
      navigate(navigation.target, { state: navigation.state });
    },
    [
      navigate,
      pageMode,
      returnTo,
      selectedSessionId,
      sidebarActiveWorkspaceId,
    ],
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
