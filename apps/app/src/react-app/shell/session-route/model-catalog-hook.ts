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
  formatModelRef,
  resolveModelDisplayName,
} from "../../../app/utils";
import { filterProviderList } from "../../../app/utils/providers";
import type { DesktopAppRestrictionChecker } from "../../../app/cloud/desktop-app-restrictions";
import { currentLocale, subscribeToLocale, t } from "../../../i18n";
import type { LocalPreferences } from "../../kernel/local-provider";
import { writeStoredDefaultModel } from "../../kernel/model-config";
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
  isSelectedModelUnavailable,
  resolveModelVariantState,
  resolveProviderDefaultModel,
  resolveUsableDefaultModel,
  shouldPromptProviderDefaultModel,
  type ProviderModelCatalog,
} from "./model-options";
import { emptyModelBehaviorOptions } from "./state";
import { readWindowSeenProviderIds } from "./storage";
import { refreshCreatedSessionSnapshotWithRetries } from "./sessions";
import { workspaceSettingsRoute } from "../workspace-routes";

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

  const { showToast } = useStatusToasts();
  const defaultModelRef = useRef(local.prefs.defaultModel);
  defaultModelRef.current = local.prefs.defaultModel;
  const setPrefsRef = useRef(local.setPrefs);
  setPrefsRef.current = local.setPrefs;
  const checkRestrictionRef = useRef(checkDesktopRestriction);
  checkRestrictionRef.current = checkDesktopRestriction;
  /** Avoid re-toasting the same OpenCode suggestion on every provider refresh. */
  const promptedProviderDefaultKeyRef = useRef<string | null>(null);

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

      // Keep last-used default when still connected; if missing/stale, fall
      // back to a usable model (never leave the composer empty).
      let currentDefault = defaultModelRef.current;
      const resolved = resolveUsableDefaultModel({
        currentDefault,
        checkRestriction: checkRestrictionRef.current,
        connectedProviderIds: value.connected ?? [],
        providerListData: value,
      });
      if (resolved.changed && resolved.model) {
        writeStoredDefaultModel(resolved.model);
        setPrefsRef.current((previous) => ({
          ...previous,
          defaultModel: resolved.model,
        }));
        currentDefault = resolved.model;
        defaultModelRef.current = resolved.model;
      } else if (resolved.model) {
        currentDefault = resolved.model;
      }

      // Non-blocking hint only while still on the app placeholder default —
      // not when we just healed a stale selection with a real fallback.
      const suggested = resolveProviderDefaultModel({
        defaults: value.default,
      });
      if (
        shouldPromptProviderDefaultModel({
          suggested,
          currentDefault,
        }) &&
        suggested
      ) {
        const key = formatModelRef(suggested);
        if (promptedProviderDefaultKeyRef.current !== key) {
          promptedProviderDefaultKeyRef.current = key;
          const modelLabel =
            resolveModelDisplayName(suggested.modelID) || key;
          showToast({
            tone: "info",
            title: t("model_picker.provider_default_available_title"),
            description: t("model_picker.provider_default_available_desc", {
              model: modelLabel,
            }),
            actionLabel: t("model_picker.provider_default_apply"),
            durationMs: 8000,
            onAction: () => {
              writeStoredDefaultModel(suggested);
              setPrefsRef.current((previous) => ({
                ...previous,
                defaultModel: suggested,
              }));
            },
          });
        }
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
    showToast,
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

  // Heal ghost selections (e.g. OpenCode-suggested gpt-5-nano) that are not
  // in the connected catalog so the composer never sticks on "模型已不可用".
  const effectiveModelKey = effectiveModelRef
    ? `${effectiveModelRef.providerID}:${effectiveModelRef.modelID}`
    : "";
  const connectedProviderKey = providerConnectedIds.join(",");
  const defaultModelKey = local.prefs.defaultModel
    ? `${local.prefs.defaultModel.providerID}:${local.prefs.defaultModel.modelID}`
    : "";
  useEffect(() => {
    if (!providerListData) return;
    const restriction = checkRestrictionRef.current;
    const resolvedFromEffective = resolveUsableDefaultModel({
      currentDefault: effectiveModelRef,
      checkRestriction: restriction,
      connectedProviderIds: providerConnectedIds,
      providerListData,
    });
    const healed = resolvedFromEffective.model;
    if (!healed?.providerID || !healed.modelID) return;

    const effectiveUnavailable = isSelectedModelUnavailable({
      model: effectiveModelRef,
      checkRestriction: restriction,
      connectedProviderIds: providerConnectedIds,
      providerListData,
    });
    const defaultUnavailable = isSelectedModelUnavailable({
      model: local.prefs.defaultModel,
      checkRestriction: restriction,
      connectedProviderIds: providerConnectedIds,
      providerListData,
    });

    // Scope the active composer model when the effective selection is a ghost.
    if (effectiveUnavailable && resolvedFromEffective.changed) {
      setSessionModelOverrideById((current) => {
        const existing = current[modelScopeSessionId];
        if (
          existing?.providerID === healed.providerID &&
          existing?.modelID === healed.modelID
        ) {
          return current;
        }
        return {
          ...current,
          [modelScopeSessionId]: healed,
        };
      });
    }

    // Always repair a ghost global default so new drafts don't re-flash red.
    if (defaultUnavailable) {
      const prefsDefault = local.prefs.defaultModel;
      if (
        !prefsDefault ||
        prefsDefault.providerID !== healed.providerID ||
        prefsDefault.modelID !== healed.modelID
      ) {
        writeStoredDefaultModel(healed);
        setPrefsRef.current((previous) => ({
          ...previous,
          defaultModel: healed,
        }));
      }
    }
    // Keys intentionally stabilize object-identity churn for model/provider sets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    connectedProviderKey,
    defaultModelKey,
    effectiveModelKey,
    modelScopeSessionId,
    pendingAgentModel,
    providerListData,
    setSessionModelOverrideById,
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
