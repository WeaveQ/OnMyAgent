/** @jsxImportSource react */
import { CheckCircle2, ChevronRight, Search } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { openDesktopUrl } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { compareProviders } from "@/app/utils/providers";
import { ActionRowButton, IconTile } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { CodeToken } from "@/components/ui/code-token";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProviderIcon } from "../../design-system/provider-icon";
import { LabeledInput } from "../../design-system/labeled-input";
import { t } from "@/i18n";
import type {
  ProviderAuthMethod,
  ProviderAuthProvider,
  ProviderOAuthStartResult,
} from "./provider-auth-types";

type ProviderAuthEntry = {
  id: string;
  name: string;
  methods: ProviderAuthMethod[];
  connected: boolean;
  env: string[];
};

type ProviderOAuthSession = ProviderOAuthStartResult & {
  providerId: string;
  methodLabel: string;
};

function ProviderAuthPanel(props: { children: React.ReactNode }) {
  return (
    <div className="space-y-4 rounded-xl border border-dls-mist bg-dls-surface-muted p-5">
      {props.children}
    </div>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  onmyagent: "OnMyAgent",
  opencode: "OpenCode Zen",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  openrouter: "OpenRouter",
};

const ONMYAGENT_MODELS_PROVIDER_ID = "onmyagent";
const providerAuthTextClass = {
  methodChip: "text-xs font-medium px-2 py-0.5 rounded-md border",
  fieldLabel: "text-xs font-medium text-dls-secondary",
};

const providerAuthStateClass = {
  oauthChip: "bg-dls-accent/10 text-dls-accent border-dls-accent/30",
  cloudChip: "bg-dls-accent/10 text-dls-accent border-dls-accent/30",
  neutralChip: "bg-dls-surface-muted text-dls-secondary border-dls-mist",
  oauthMethod: "border-dls-accent/30 bg-dls-accent/10 hover:bg-dls-accent/10",
  neutralMethod: "border-dls-mist bg-dls-surface-muted hover:bg-dls-surface-muted",
  accentLink: "h-auto p-0 text-dls-accent hover:text-dls-accent hover:opacity-80",
  subscribePanel: "rounded-xl border border-dls-accent/30 bg-dls-accent/10 p-5 space-y-4",
};

export type ProviderAuthModalProps = {
  open: boolean;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  preferredProviderId?: string | null;
  workerType?: "local" | "remote";
  providers: ProviderAuthProvider[];
  connectedProviderIds: string[];
  authMethods: Record<string, ProviderAuthMethod[]>;
  onSelect: (
    providerId: string,
    methodIndex?: number,
  ) => Promise<ProviderOAuthStartResult>;
  onSubmitApiKey: (
    providerId: string,
    apiKey: string,
  ) => Promise<string | void>;
  onConnectCloudProvider: (cloudProviderId: string) => Promise<string | void>;
  onSubmitOAuth: (
    providerId: string,
    methodIndex: number,
    code?: string,
  ) => Promise<{ connected: boolean; pending?: boolean; message?: string }>;
  onRefreshProviders?: () => Promise<unknown>;
  showOnMyAgentModelsSubscribe?: boolean;
  onSubscribeOnMyAgentModels?: () => void | Promise<void>;
  onClose: () => void;
};

export default function ProviderAuthModal(props: ProviderAuthModalProps) {
  const workerType = props.workerType === "remote" ? "remote" : "local";
  const isRemoteWorker = workerType === "remote";

  const [view, setView] = useState<
    | "list"
    | "method"
    | "api"
    | "cloud"
    | "oauth-code"
    | "oauth-auto"
    | "onmyagent-subscribe"
  >("list");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  const [selectedCloudMethod, setSelectedCloudMethod] =
    useState<ProviderAuthMethod | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [oauthCodeInput, setOauthCodeInput] = useState("");
  const [oauthSession, setOauthSession] = useState<ProviderOAuthSession | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [activeEntryIndex, setActiveEntryIndex] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pollingBusy, setPollingBusy] = useState(false);
  const [oauthAutoBusy, setOauthAutoBusy] = useState(false);
  const [oauthCodeCopied, setOauthCodeCopied] = useState(false);
  const [oauthBrowserOpened, setOauthBrowserOpened] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const providerPollRef = useRef<number | null>(null);
  const oauthAutoPollRef = useRef<number | null>(null);
  const oauthCodeCopiedResetRef = useRef<number | null>(null);
  const autoOpenedPreferredProviderIdRef = useRef<string | null>(null);

  const formatProviderName = (id: string, fallback?: string) => {
    const named = fallback?.trim();
    if (named) return named;

    const normalized = id.trim();
    const mapped = PROVIDER_LABELS[normalized.toLowerCase()];
    if (mapped) return mapped;

    const cleaned = normalized
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return id;

    return cleaned
      .split(" ")
      .flatMap((word) => {
        if (!word) return [];
        if (/\d/.test(word) || word.length <= 3) {
          return [word.toUpperCase()];
        }
        const lower = word.toLowerCase();
        return [lower.charAt(0).toUpperCase() + lower.slice(1)];
      })
      .join(" ");
  };

  const isOpenAiHeadlessMethod = (method: ProviderAuthMethod) => {
    const label = method.label.toLowerCase();
    return (
      method.type === "oauth" &&
      (label.includes("headless") || label.includes("device"))
    );
  };

  const isOpenAiProvider = (id: string, fallbackName?: string) => {
    const normalizedId = id.trim().toLowerCase();
    const normalizedName = fallbackName?.trim().toLowerCase() ?? "";
    return normalizedId === "openai" || normalizedName === "openai";
  };

  const isAnthropicProvider = (id: string, fallbackName?: string) => {
    const normalizedId = id.trim().toLowerCase();
    const normalizedName = fallbackName?.trim().toLowerCase() ?? "";
    return normalizedId === "anthropic" || normalizedName === "anthropic";
  };

  const isOpencodeZenProvider = (id: string) =>
    id.trim().toLowerCase() === "opencode";

  const OPENCODE_ZEN_KEY_URL = "https://opencode.ai/auth";

  const openExternalUrl = async (url: string) => {
    if (!url) return;
    if (isDesktopRuntime()) {
      await openDesktopUrl(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const isClaudeProMaxMethod = (method: ProviderAuthMethod) => {
    const label = method.label.toLowerCase();
    return (
      method.type === "oauth" &&
      (label.includes("pro/max") || label.includes("create an api key"))
    );
  };

  const entries = useMemo<ProviderAuthEntry[]>(() => {
    const methods = props.authMethods ?? {};
    const connected = new Set(props.connectedProviderIds ?? []);
    const providers = props.providers ?? [];

    const providersById = new Map(
      providers.map((provider) => [provider.id, provider]),
    );
    const nextEntries = Object.keys(methods)
      .flatMap((id) => {
        const provider = providersById.get(id);
        const entryMethods = (methods[id] ?? []).filter((method) => {
          if (
            isAnthropicProvider(id, provider?.name) &&
            isClaudeProMaxMethod(method)
          ) {
            return false;
          }
          if (!isOpenAiProvider(id, provider?.name)) return true;
          if (method.type !== "oauth") return true;
          if (isRemoteWorker) return isOpenAiHeadlessMethod(method);
          return !isOpenAiHeadlessMethod(method);
        });
        if (entryMethods.length === 0) return [];
        return [
          {
            id,
            name: formatProviderName(id, provider?.name),
            methods: entryMethods,
            connected: connected.has(id),
            env: Array.isArray(provider?.env) ? provider.env : [],
          } satisfies ProviderAuthEntry,
        ];
      })
      .sort(compareProviders);

    if (props.showOnMyAgentModelsSubscribe) {
      const connectedToOnMyAgent = connected.has(ONMYAGENT_MODELS_PROVIDER_ID);
      return [
        {
          id: ONMYAGENT_MODELS_PROVIDER_ID,
          name: "OnMyAgent",
          methods: [{ type: "cloud", label: t("provider_auth.subscribe") }],
          connected: connectedToOnMyAgent,
          env: [],
        },
        ...nextEntries.filter(
          (entry) =>
            entry.id.trim().toLowerCase() !== ONMYAGENT_MODELS_PROVIDER_ID,
        ),
      ];
    }

    return nextEntries;
  }, [
    isRemoteWorker,
    props.authMethods,
    props.connectedProviderIds,
    props.providers,
    props.showOnMyAgentModelsSubscribe,
  ]);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedProviderId) ?? null,
    [entries, selectedProviderId],
  );

  const resolvedView = selectedEntry ? view : "list";
  const errorMessage = localError ?? props.error;

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => {
      const methodText = entry.methods
        .map(
          (method) =>
            method.label || (method.type === "oauth" ? t("provider_auth.method_oauth") : t("provider_auth.method_api_key")),
        )
        .join(" ");
      return `${entry.name} ${entry.id} ${methodText}`
        .toLowerCase()
        .includes(query);
    });
  }, [entries, searchQuery]);

  const oauthInstructions =
    oauthSession?.authorization.instructions?.trim() ?? "";
  const isOpenAiHeadlessSession = Boolean(
    oauthSession &&
    oauthSession.providerId === "openai" &&
    oauthSession.methodLabel.toLowerCase().includes("headless"),
  );
  const shouldStartOauthAutoPolling =
    props.open &&
    resolvedView === "oauth-auto" &&
    oauthSession &&
    (!isOpenAiHeadlessSession || oauthBrowserOpened);

  const oauthDisplayCode = useMemo(() => {
    if (!oauthInstructions) return "";
    const matched = oauthInstructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0];
    if (matched) return matched;
    if (oauthInstructions.includes(":")) {
      return oauthInstructions.split(":").slice(1).join(":").trim();
    }
    return oauthInstructions;
  }, [oauthInstructions]);

  const methodLabel = (method: ProviderAuthMethod) =>
    method.label || (method.type === "oauth" ? t("provider_auth.method_oauth") : t("provider_auth.method_api_key"));

  const actionDisabled = props.loading || props.submitting;

  const resetState = () => {
    if (
      oauthCodeCopiedResetRef.current !== null &&
      typeof window !== "undefined"
    ) {
      window.clearTimeout(oauthCodeCopiedResetRef.current);
      oauthCodeCopiedResetRef.current = null;
    }
    setView("list");
    setSelectedProviderId(null);
    setSelectedCloudMethod(null);
    setApiKeyInput("");
    setOauthCodeInput("");
    setOauthSession(null);
    setSearchQuery("");
    setActiveEntryIndex(0);
    setLocalError(null);
    setOauthCodeCopied(false);
    setOauthBrowserOpened(false);
  };

  const stopProviderPolling = () => {
    if (providerPollRef.current !== null) {
      window.clearInterval(providerPollRef.current);
      providerPollRef.current = null;
    }
  };

  const stopOauthAutoPolling = () => {
    if (oauthAutoPollRef.current !== null) {
      window.clearInterval(oauthAutoPollRef.current);
      oauthAutoPollRef.current = null;
    }
  };

  const handleClose = () => {
    void props.onRefreshProviders?.();
    stopOauthAutoPolling();
    stopProviderPolling();
    resetState();
    props.onClose();
  };

  useEffect(() => {
    if (!props.open) {
      autoOpenedPreferredProviderIdRef.current = null;
      resetState();
    }
  }, [props.open]);

  useEffect(() => {
    if (!props.open || resolvedView !== "list") return;
    const total = filteredEntries.length;
    if (total <= 0) {
      setActiveEntryIndex(0);
      return;
    }
    setActiveEntryIndex((current) => Math.max(0, Math.min(current, total - 1)));
  }, [filteredEntries.length, props.open, resolvedView]);

  useEffect(() => {
    if (!props.open || resolvedView !== "list") return;
    queueMicrotask(() => searchInputRef.current?.focus());
  }, [props.open, resolvedView]);

  useEffect(() => {
    if (!props.open || props.loading || resolvedView !== "list") return;

    const preferredId = props.preferredProviderId?.trim().toLowerCase() ?? "";
    if (
      !preferredId ||
      autoOpenedPreferredProviderIdRef.current === preferredId
    )
      return;

    const entry = entries.find(
      (item) => item.id.trim().toLowerCase() === preferredId,
    );
    if (!entry) return;

    autoOpenedPreferredProviderIdRef.current = preferredId;
    queueMicrotask(() => {
      handleEntrySelect(entry);
    });
  }, [
    entries,
    props.loading,
    props.open,
    props.preferredProviderId,
    resolvedView,
  ]);

  useEffect(() => {
    return () => {
      stopOauthAutoPolling();
      stopProviderPolling();
      if (oauthCodeCopiedResetRef.current !== null) {
        window.clearTimeout(oauthCodeCopiedResetRef.current);
        oauthCodeCopiedResetRef.current = null;
      }
    };
  }, []);

  const isOauthView =
    resolvedView === "oauth-code" || resolvedView === "oauth-auto";
  const activeProviderId = oauthSession?.providerId ?? selectedProviderId;
  const isActiveProviderConnected =
    !!activeProviderId &&
    (props.connectedProviderIds ?? []).includes(activeProviderId);

  const pollProviders = async () => {
    const id = activeProviderId;
    if (!id || pollingBusy) return;
    setPollingBusy(true);
    try {
      await props.onRefreshProviders?.();
    } finally {
      setPollingBusy(false);
    }
    if ((props.connectedProviderIds ?? []).includes(id)) {
      handleClose();
    }
  };

  const startProviderPolling = () => {
    if (typeof window === "undefined") return;
    if (providerPollRef.current !== null) return;
    void pollProviders();
    providerPollRef.current = window.setInterval(() => {
      void pollProviders();
    }, 2000);
  };

  useEffect(() => {
    if (!props.open || !isOauthView) {
      stopProviderPolling();
      return;
    }
    if (isActiveProviderConnected) {
      handleClose();
      return;
    }
    startProviderPolling();
  }, [isActiveProviderConnected, isOauthView, props.open]);

  const openOauthUrl = async (url: string) => {
    if (!url) return;
    if (isDesktopRuntime()) {
      await openDesktopUrl(url);
      setOauthBrowserOpened(true);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    setOauthBrowserOpened(true);
  };

  const copyOauthDisplayCode = async () => {
    const code = oauthDisplayCode.trim();
    if (!code) return;
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setLocalError(t("provider_auth.error_clipboard_unavailable"));
      return;
    }
    await navigator.clipboard.writeText(code);
    setOauthCodeCopied(true);
    if (typeof window === "undefined") return;
    if (oauthCodeCopiedResetRef.current !== null) {
      window.clearTimeout(oauthCodeCopiedResetRef.current);
    }
    oauthCodeCopiedResetRef.current = window.setTimeout(() => {
      setOauthCodeCopied(false);
      oauthCodeCopiedResetRef.current = null;
    }, 2000);
  };

  const submitOauth = async (
    providerId: string,
    methodIndex: number,
    code?: string,
  ) => {
    const trimmedCode = code?.trim();
    setLocalError(null);
    try {
      return await props.onSubmitOAuth(
        providerId,
        methodIndex,
        trimmedCode || undefined,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("provider_auth.error_oauth_complete");
      setLocalError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  const attemptOauthAutoCompletion = async () => {
    const session = oauthSession;
    if (!session || oauthAutoBusy) return;
    setOauthAutoBusy(true);
    try {
      const result = await submitOauth(session.providerId, session.methodIndex);
      if (result?.connected) {
        stopOauthAutoPolling();
      }
    } finally {
      setOauthAutoBusy(false);
    }
  };

  const startOauthAutoPolling = () => {
    if (typeof window === "undefined") return;
    if (oauthAutoPollRef.current !== null) return;
    void attemptOauthAutoCompletion();
    oauthAutoPollRef.current = window.setInterval(() => {
      void attemptOauthAutoCompletion();
    }, 2000);
  };

  useEffect(() => {
    if (!shouldStartOauthAutoPolling) {
      stopOauthAutoPolling();
      return;
    }
    startOauthAutoPolling();
  }, [shouldStartOauthAutoPolling]);

  const startOauth = async (entry: ProviderAuthEntry, methodIndex?: number) => {
    if (actionDisabled) return;
    if (!Number.isInteger(methodIndex) || methodIndex === undefined) {
      setLocalError(t("provider_auth.error_no_oauth_flow", { name: entry.name }));
      return;
    }
    setLocalError(null);
    setOauthCodeInput("");
    setOauthSession(null);
    setOauthCodeCopied(false);
    setOauthBrowserOpened(false);
    try {
      const started = await props.onSelect(entry.id, methodIndex);
      const selectedMethod = entry.methods.find(
        (method) => method.methodIndex === methodIndex,
      );
      if (!selectedMethod) {
        throw new Error(
          t("provider_auth.error_method_unavailable", { name: entry.name }),
        );
      }
      const nextSession: ProviderOAuthSession = {
        providerId: entry.id,
        methodIndex: started.methodIndex,
        methodLabel: selectedMethod.label,
        authorization: started.authorization,
      };
      setOauthSession(nextSession);

      if (started.authorization.method === "code") {
        await openOauthUrl(started.authorization.url);
        setView("oauth-code");
        return;
      }

      if (!isOpenAiHeadlessMethod(selectedMethod)) {
        await openOauthUrl(started.authorization.url);
      }

      setView("oauth-auto");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("provider_auth.error_oauth_start");
      setLocalError(message);
    }
  };

  const handleMethodSelect = async (method: ProviderAuthMethod) => {
    if (!selectedEntry || actionDisabled) return;
    setLocalError(null);
    setSelectedCloudMethod(null);

    if (method.type === "oauth") {
      await startOauth(selectedEntry, method.methodIndex);
      return;
    }

    if (method.type === "cloud") {
      setSelectedCloudMethod(method);
      setView("cloud");
      return;
    }

    setView("api");
  };

  const handleEntrySelect = (entry: ProviderAuthEntry) => {
    if (actionDisabled) return;
    setLocalError(null);
    setSelectedProviderId(entry.id);

    if (
      props.showOnMyAgentModelsSubscribe &&
      entry.id.trim().toLowerCase() === ONMYAGENT_MODELS_PROVIDER_ID
    ) {
      setView("onmyagent-subscribe");
      return;
    }

    if (entry.methods.length === 1) {
      void handleMethodSelect(entry.methods[0]);
      return;
    }

    if (entry.methods.length > 1) {
      setView("method");
      return;
    }

    setLocalError(t("provider_auth.error_no_auth_methods", { name: entry.name }));
  };

  const handleApiSubmit = async () => {
    if (!selectedEntry || actionDisabled) return;

    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      setLocalError(t("provider_auth.error_api_key_required"));
      return;
    }

    setLocalError(null);
    try {
      await props.onSubmitApiKey(selectedEntry.id, trimmed);
      // Close the modal after a successful save
      props.onClose();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("provider_auth.error_save_api_key");
      setLocalError(message);
    }
  };

  const handleCloudSubmit = async () => {
    if (!selectedCloudMethod?.cloudProviderId || actionDisabled) return;

    setLocalError(null);
    try {
      await props.onConnectCloudProvider(selectedCloudMethod.cloudProviderId);
      props.onClose();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("provider_auth.error_connect_org");
      setLocalError(message);
    }
  };

  const handleOauthCodeSubmit = async () => {
    if (!selectedEntry || !oauthSession || actionDisabled) return;

    const trimmed = oauthCodeInput.trim();
    if (!trimmed) {
      setLocalError(t("provider_auth.error_auth_code_required"));
      return;
    }

    await submitOauth(selectedEntry.id, oauthSession.methodIndex, trimmed);
  };

  const handleBack = () => {
    if (resolvedView === "onmyagent-subscribe") {
      resetState();
      return;
    }

    if (resolvedView === "oauth-code" || resolvedView === "oauth-auto") {
      if ((selectedEntry?.methods.length ?? 0) > 1) {
        setView("method");
      } else {
        setView("list");
      }
      setOauthSession(null);
      setOauthCodeInput("");
      setOauthCodeCopied(false);
      setOauthBrowserOpened(false);
      setLocalError(null);
      return;
    }

    if (resolvedView === "api" && (selectedEntry?.methods.length ?? 0) > 1) {
      setView("method");
      setSelectedCloudMethod(null);
      setApiKeyInput("");
      setLocalError(null);
      return;
    }
    if (resolvedView === "cloud" && (selectedEntry?.methods.length ?? 0) > 1) {
      setView("method");
      setSelectedCloudMethod(null);
      setLocalError(null);
      return;
    }
    resetState();
  };

  const submittingLabel = () => {
    if (!props.submitting) return null;
    if (resolvedView === "api") return t("provider_auth.spinner_saving_api");
    if (resolvedView === "cloud") return t("provider_auth.spinner_connecting_org");
    if (resolvedView === "oauth-code") return t("provider_auth.spinner_verifying_code");
    if (resolvedView === "oauth-auto")
      return t("provider_auth.spinner_waiting_oauth");
    return t("provider_auth.spinner_opening_auth");
  };

  const stepEntryIndex = (delta: number) => {
    const total = filteredEntries.length;
    if (total <= 0) {
      setActiveEntryIndex(0);
      return;
    }
    setActiveEntryIndex((current) => {
      const normalized = ((current % total) + total) % total;
      return (normalized + delta + total) % total;
    });
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (resolvedView !== "list") return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      stepEntryIndex(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      stepEntryIndex(-1);
      return;
    }
    if (event.key === "Enter") {
      const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent & {
        keyCode?: number;
      };
      if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
        return;
      }
      const entry = filteredEntries[activeEntryIndex];
      if (!entry) return;
      event.preventDefault();
      handleEntrySelect(entry);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      handleClose();
    }
  };

  const methodDescription = (
    entry: ProviderAuthEntry,
    method: ProviderAuthMethod,
  ) => {
    const label = methodLabel(method).toLowerCase();
    if (
      isOpenAiProvider(entry.id, entry.name) &&
      (label.includes("headless") || label.includes("device"))
    ) {
      return isRemoteWorker
        ? t("provider_auth.hint_openai_device_remote")
        : t("provider_auth.hint_openai_device_local");
    }
    if (method.type === "oauth") {
      return t("provider_auth.hint_oauth_continue_in_browser");
    }
    if (method.type === "cloud") {
      return (
        method.description ??
        t("provider_auth.hint_org_managed")
      );
    }
    if (isOpencodeZenProvider(entry.id)) {
      return t("provider_auth.hint_opencode_zen_signin");
    }
    return t("provider_auth.hint_paste_secret_key_local");
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="flex max-h-[min(520px,calc(100vh-5rem))] min-h-0 w-full max-w-md flex-col overflow-hidden sm:max-w-md">
        <DialogHeader className="space-y-1 pb-0">
          <DialogTitle className="text-base">
            {t("settings.providers_dialog_title")}
          </DialogTitle>
          <DialogDescription className="text-xs leading-snug">
            {t("settings.providers_dialog_description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5">
          {errorMessage ? (
            <NoticeBox tone="error">{errorMessage}</NoticeBox>
          ) : props.loading ? (
            <NoticeBox className="animate-pulse" size="comfortable">
              {t("provider_auth.loading_providers")}
            </NoticeBox>
          ) : null}

          {!props.loading ? (
            <div className="-mr-1 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {resolvedView === "list" ? (
                <div
                  className="space-y-2"
                  role="presentation"
                  onKeyDown={handleListKeyDown}
                >
                  <InputGroup controlSize="sm" tone="surfaceMuted">
                    <InputGroupAddon align="inline-start">
                      <Search size={14} />
                    </InputGroupAddon>
                    <InputGroupInput
                      ref={searchInputRef}
                      type="text"
                      placeholder={t("provider_auth.filter_providers_placeholder")}
                      value={searchQuery}
                      onChange={(event) => {
                        setSearchQuery(event.currentTarget.value);
                        setActiveEntryIndex(0);
                      }}
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      disabled={actionDisabled}
                      className="text-sm text-dls-text"
                    />
                  </InputGroup>

                  {filteredEntries.length ? (
                    filteredEntries.map((entry, index) => (
                      <ActionRowButton
                        key={entry.id}
                        type="button"
                        density="row"
                        className={`group gap-2.5 !py-2 transition-colors ${
                          index === activeEntryIndex
                            ? "bg-dls-surface-muted"
                            : "hover:bg-dls-surface-muted"
                        }`}
                        disabled={actionDisabled}
                        onMouseEnter={() => setActiveEntryIndex(index)}
                        onClick={() => handleEntrySelect(entry)}
                      >
                        <IconTile
                          size="xs"
                          shape="circle"
                          tone="surface"
                          border
                          className="overflow-hidden border-dls-mist bg-dls-surface-muted"
                        >
                          <ProviderIcon
                            providerId={entry.id}
                            size={14}
                            className="text-dls-text"
                          />
                        </IconTile>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium tracking-tight text-dls-text">
                                {entry.name}
                              </div>
                              <div className="mt-0.5 truncate font-mono text-2xs text-dls-secondary/70">
                                {entry.id}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center justify-end">
                              {entry.connected ? (
                                <StatusBadge tone="accent" shape="soft" size="tiny">
                                  <CheckCircle2 size={12} strokeWidth={2.5} />
                                  {t("provider_auth.action_connected")}
                                </StatusBadge>
                              ) : (
                                <div className="flex items-center gap-0.5 text-xs font-medium text-dls-secondary opacity-80 transition-colors group-hover:text-dls-text group-hover:opacity-100">
                                  {t("provider_auth.action_connect")}
                                  <ChevronRight
                                    size={14}
                                    className="-ml-2 opacity-0 transition-all duration-200 group-hover:ml-0 group-hover:opacity-100"
                                  />
                                </div>
                              )}
                            </div>
                          </div>

                          {entry.methods.length > 0 ? (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {entry.methods.map((method) => (
                                <span
                                  key={`${entry.id}-${method.type}-${method.methodIndex ?? method.cloudProviderId ?? method.label}`}
                                  className={`${providerAuthTextClass.methodChip} !px-1.5 !py-0 !text-2xs ${
                                    method.type === "oauth"
                                      ? providerAuthStateClass.oauthChip
                                      : method.type === "cloud"
                                        ? providerAuthStateClass.cloudChip
                                        : providerAuthStateClass.neutralChip
                                  }`}
                                >
                                  {methodLabel(method)}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </ActionRowButton>
                    ))
                  ) : (
                    <div className="pt-1 text-sm text-dls-secondary">
                      {entries.length
                        ? t("provider_auth.empty_no_match")
                        : t("provider_auth.empty_no_providers")}
                    </div>
                  )}
                </div>
              ) : null}

              {resolvedView === "method" && selectedEntry ? (
                <ProviderAuthPanel>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-dls-text">
                        {selectedEntry.name}
                      </div>
                      <div className="text-xs text-dls-secondary mt-1">
                        {t("provider_auth.hint_choose_connection")}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleBack}
                      disabled={actionDisabled}
                    >
                      {t("provider_auth.action_back")}
                    </Button>
                  </div>
                  <div className="grid gap-2">
                    {selectedEntry.methods.map((method) => (
                      <ActionRowButton
                        key={`${selectedEntry.id}-${method.type}-${method.methodIndex ?? method.cloudProviderId ?? method.label}`}
                        type="button"
                        density="row"
                        className={`transition-all duration-200 ${
                          method.type === "oauth"
                            ? providerAuthStateClass.oauthMethod
                            : providerAuthStateClass.neutralMethod
                        }`}
                        onClick={() => void handleMethodSelect(method)}
                        disabled={actionDisabled}
                      >
                        <div className="text-sm font-medium text-dls-text">
                          {methodLabel(method)}
                        </div>
                        <div className="mt-1 text-xs text-dls-secondary">
                          {methodDescription(selectedEntry, method)}
                        </div>
                      </ActionRowButton>
                    ))}
                  </div>
                </ProviderAuthPanel>
              ) : null}

              {resolvedView === "api" && selectedEntry ? (
                <ProviderAuthPanel>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-dls-text">
                        {selectedEntry.name}
                      </div>
                      <div className="text-xs text-dls-secondary mt-1">
                        {isOpencodeZenProvider(selectedEntry.id)
                          ? t("provider_auth.hint_opencode_zen_signin_from_url")
                          : t("provider_auth.hint_paste_api_key")}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleBack}
                      disabled={actionDisabled}
                    >
                      {t("provider_auth.action_back")}
                    </Button>
                  </div>
                  {isOpencodeZenProvider(selectedEntry.id) ? (
                    <NoticeBox className="space-y-1.5" tone="info">
                      <div>
                        {t("provider_auth.hint_opencode_zen_perks")}
                      </div>
                      <Button
                        type="button"
                        variant="link"
                        className={providerAuthStateClass.accentLink}
                        onClick={() =>
                          void openExternalUrl(OPENCODE_ZEN_KEY_URL)
                        }
                      >
                        {t("provider_auth.action_get_api_key")}
                      </Button>
                    </NoticeBox>
                  ) : null}
                  <LabeledInput
                    label={t("provider_auth.api_key")}
                    type="password"
                    placeholder={
                      isOpencodeZenProvider(selectedEntry.id)
                        ? "ock_..."
                        : "sk-..."
                    }
                    value={apiKeyInput}
                    onChange={(event) => {
                      setApiKeyInput(event.currentTarget.value);
                      if (localError) setLocalError(null);
                    }}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    disabled={actionDisabled}
                  />
                  {selectedEntry.env.length > 0 ? (
                    <div className="text-xs text-dls-secondary">
                      {t("provider_auth.label_env_vars")}{" "}
                      <span className="font-mono">
                        {selectedEntry.env.join(", ")}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-dls-secondary">
                      {t("provider_auth.hint_keys_stored_locally")}
                    </div>
                    <Button
                      onClick={handleApiSubmit}
                      disabled={actionDisabled || !apiKeyInput.trim()}
                    >
                      {props.submitting ? t("provider_auth.action_saving") : t("provider_auth.action_save_key")}
                    </Button>
                  </div>
                </ProviderAuthPanel>
              ) : null}

              {resolvedView === "cloud" &&
              selectedEntry &&
              selectedCloudMethod ? (
                <ProviderAuthPanel>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-dls-text">
                        {selectedEntry.name}
                      </div>
                      <div className="text-xs text-dls-secondary mt-1">
                        {t("provider_auth.hint_org_managed_short")}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleBack}
                      disabled={actionDisabled}
                    >
                      {t("provider_auth.action_back")}
                    </Button>
                  </div>
                  <div className="text-xs text-dls-secondary">
                    {selectedCloudMethod.description ??
                      t("provider_auth.hint_org_managed")}
                  </div>
                  {(selectedCloudMethod.modelCount ?? 0) > 0 ? (
                    <NoticeBox>
                      {t("provider_auth.hint_org_curated_models", { count: selectedCloudMethod.modelCount ?? 0 })}
                    </NoticeBox>
                  ) : null}
                  {(selectedCloudMethod.env?.length ?? 0) > 0 ? (
                    <div className="text-xs text-dls-secondary">
                      {t("provider_auth.label_env_vars")}{" "}
                      <span className="font-mono">
                        {selectedCloudMethod.env?.join(", ")}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-dls-secondary">
                      {t("provider_auth.hint_org_install")}
                    </div>
                    <Button
                      onClick={handleCloudSubmit}
                      disabled={actionDisabled}
                    >
                      {props.submitting ? t("provider_auth.action_connecting") : t("provider_auth.action_connect_provider")}
                    </Button>
                  </div>
                </ProviderAuthPanel>
              ) : null}

              {resolvedView === "onmyagent-subscribe" && selectedEntry ? (
                <div className={providerAuthStateClass.subscribePanel}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-dls-text">
                        {t("provider_auth.subscribe_title")}
                      </div>
                      <div className="text-xs text-dls-secondary mt-1">
                        {t("provider_auth.subscribe_subtitle")}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={handleBack}
                      disabled={actionDisabled}
                    >
                      {t("provider_auth.action_back")}
                    </Button>
                  </div>
                  <div className="flex items-center justify-end">
                    <Button
                      onClick={() => void props.onSubscribeOnMyAgentModels?.()}
                      disabled={actionDisabled}
                    >
                      {t("provider_auth.subscribe")}
                    </Button>
                  </div>
                </div>
              ) : null}

              {resolvedView === "oauth-code" &&
              selectedEntry &&
              oauthSession ? (
                <ProviderAuthPanel>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-dls-text">
                        {selectedEntry.name}
                      </div>
                      <div className="text-xs text-dls-secondary mt-1">
                        {t("provider_auth.hint_finish_oauth_paste_code")}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleBack}
                      disabled={actionDisabled}
                    >
                      {t("provider_auth.action_back")}
                    </Button>
                  </div>
                  <div className="text-xs text-dls-secondary">
                    {t("provider_auth.complete_sign_in_paste_code")}
                  </div>
                  {oauthInstructions ? (
                    <CodeToken tone="surface" size="lg" display="block" className="break-all border-dls-mist bg-dls-surface">
                      {oauthInstructions}
                    </CodeToken>
                  ) : null}
                  <LabeledInput
                    label={t("provider_auth.authorization_code")}
                    type="text"
                    placeholder={t("provider_auth.paste_code")}
                    value={oauthCodeInput}
                    onChange={(event) => {
                      setOauthCodeInput(event.currentTarget.value);
                      if (localError) setLocalError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      void handleOauthCodeSubmit();
                    }}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    disabled={actionDisabled}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        void openOauthUrl(oauthSession.authorization.url ?? "");
                      }}
                    >
                      {t("provider_auth.action_open_browser_again")}
                    </Button>
                    <Button
                      onClick={() => void handleOauthCodeSubmit()}
                      disabled={actionDisabled || !oauthCodeInput.trim()}
                    >
                      {props.submitting
                        ? t("provider_auth.action_verifying")
                        : t("provider_auth.action_complete_connection")}
                    </Button>
                  </div>
                </ProviderAuthPanel>
              ) : null}

              {resolvedView === "oauth-auto" &&
              selectedEntry &&
              oauthSession ? (
                <ProviderAuthPanel>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-dls-text">
                        {selectedEntry.name}
                      </div>
                      <div className="text-xs text-dls-secondary mt-1">
                        {t("provider_auth.hint_waiting_browser")}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleBack}
                      disabled={actionDisabled}
                    >
                      {t("provider_auth.action_back")}
                    </Button>
                  </div>
                  {isOpenAiHeadlessSession ? (
                    <div className="space-y-2 text-xs text-dls-secondary">
                      <div>{t("provider_auth.hint_openai_signin_step1")}</div>
                      <div>{t("provider_auth.hint_openai_device_auth_step")}</div>
                      <div>{t("provider_auth.hint_openai_chatgpt_path")}</div>
                      <div>{t("provider_auth.hint_openai_ready")}</div>
                    </div>
                  ) : (
                    <div className="text-xs text-dls-secondary">
                      {t("provider_auth.hint_oauth_signin_open_tab")}
                    </div>
                  )}
                  {oauthDisplayCode ? (
                    <div className="rounded-xl border border-dls-mist bg-dls-surface-muted p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className={providerAuthTextClass.fieldLabel}>
                          {t("provider_auth.label_confirmation_code")}
                        </div>
                        <div className="text-sm text-dls-text font-mono break-all">
                          {oauthDisplayCode}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => void copyOauthDisplayCode()}
                      >
                        {oauthCodeCopied ? t("provider_auth.action_copied") : t("provider_auth.action_copy")}
                      </Button>
                    </div>
                  ) : null}
                  {isOpenAiHeadlessSession && !oauthBrowserOpened ? (
                    <div className="flex items-center gap-2 text-xs text-dls-secondary">
                      <span>
                        {t("provider_auth.hint_authorization_checks_start")}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-dls-secondary">
                      <LoadingSpinner size="sm" className={props.submitting || pollingBusy || oauthAutoBusy
                            ? "animate-spin"
                            : ""} />
                      <span>{t("provider_auth.checking_connection_automatically")}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        void openOauthUrl(oauthSession.authorization.url ?? "");
                      }}
                    >
                      {isOpenAiHeadlessSession
                        ? oauthBrowserOpened
                          ? t("provider_auth.action_reopen_browser")
                          : t("provider_auth.action_open_browser")
                        : t("provider_auth.action_open_browser_again")}
                    </Button>
                    <div className="text-xs text-dls-secondary text-right">
                      {t("provider_auth.hint_window_closes_when_connected")}
                    </div>
                  </div>
                </ProviderAuthPanel>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 flex-row items-center justify-end gap-2 sm:space-x-0">
          {props.submitting ? (
            <div className="mr-auto text-xs text-dls-secondary">
              {submittingLabel()}
            </div>
          ) : null}
          <DialogClose
            disabled={actionDisabled}
            render={<Button size="sm" variant="outline" disabled={actionDisabled} />}
          >
            {t("provider_auth.action_close")}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
