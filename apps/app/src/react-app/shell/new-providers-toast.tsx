/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import {
  newProvidersEvent,
  type NewProviderInfo,
  type NewProvidersEventDetail,
} from "../../app/lib/provider-events";
import { Button } from "@/components/ui/button";
import { t } from "../../i18n";
import { ProviderIcon } from "../design-system/provider-icon";
import { FloatingToastFrame } from "../domains/shell-feedback";
import { orgOnboardingVisibilityEvent } from "./reload-coordinator";

const SEEN_KEY = "onmyagent.seenProviderIds";
const PENDING_MODEL_PICKER_KEY = "onmyagent.pendingModelPickerProviderIds";
/** Success toast auto-hides; no click-through required. */
const AUTO_DISMISS_MS = 4_000;

/** Custom event to request the model picker to open (other surfaces may fire this). */
export const openModelPickerEvent = "onmyagent-open-model-picker";
export const pendingModelPickerProviderIdsKey = PENDING_MODEL_PICKER_KEY;

function readSeenProviderIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function markProvidersSeen(ids: string[]): void {
  try {
    const existing = readSeenProviderIds();
    for (const id of ids) existing.add(id);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...existing]));
  } catch {
    // ignore storage errors
  }
}

type ToastState = {
  show: boolean;
  providers: NewProviderInfo[];
  newProviderCount: number;
  newModelCount: number;
};

function formatSuccessMessage(input: {
  newProviderCount: number;
  newModelCount: number;
  providers: NewProviderInfo[];
}): string {
  const { newProviderCount, newModelCount, providers } = input;
  if (newProviderCount > 0 && newModelCount > 0) {
    // zh uses {providerCount}/{modelCount}; en uses pluralized parts.
    return t("settings.new_providers_toast_both", {
      providerCount: newProviderCount,
      modelCount: newModelCount,
      providerPart: t("settings.new_providers_toast_provider_part", {
        count: newProviderCount,
      }),
      modelPart: t("settings.new_providers_toast_model_part", {
        count: newModelCount,
      }),
    });
  }
  if (newProviderCount > 0) {
    return t("settings.new_providers_toast_providers", {
      count: newProviderCount,
    });
  }
  if (newModelCount > 0) {
    return t("settings.new_providers_toast_models", {
      count: newModelCount,
    });
  }
  const name = providers[0]?.name || providers[0]?.providerId;
  if (name) {
    return t("settings.new_providers_toast_named", { name });
  }
  return t("settings.new_providers_toast_generic");
}

/**
 * Global success toast when new providers/models become available.
 * Auto-dismisses; no model-picker CTA (user already has them connected).
 */
export function NewProvidersToast() {
  const [state, setState] = useState<ToastState>({
    show: false,
    providers: [],
    newProviderCount: 0,
    newModelCount: 0,
  });
  const [orgOnboardingVisible, setOrgOnboardingVisible] = useState(false);
  const [pendingProviders, setPendingProviders] = useState<NewProviderInfo[]>([]);
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoDismiss = useCallback(() => {
    if (autoDismissTimerRef.current != null) {
      clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(
    (providers: NewProviderInfo[]) => {
      clearAutoDismiss();
      markProvidersSeen(providers.map((p) => p.id));
      setState({
        show: false,
        providers: [],
        newProviderCount: 0,
        newModelCount: 0,
      });
    },
    [clearAutoDismiss],
  );

  const showProviders = useCallback(
    (detail: NewProvidersEventDetail) => {
      const seen = readSeenProviderIds();
      const genuinelyNew = detail.providers.filter((p) => !seen.has(p.id));
      const newProviderCount = detail.newProviderCount ?? genuinelyNew.length;
      const newModelCount = detail.newModelCount ?? 0;
      if (genuinelyNew.length === 0 && newModelCount === 0) return;

      setState((prev) => {
        const nextProviders = prev.show
          ? [
              ...prev.providers,
              ...detail.providers.filter(
                (p) => !prev.providers.some((e) => e.id === p.id),
              ),
            ]
          : detail.providers;
        const next: ToastState = {
          show: true,
          providers: nextProviders,
          newProviderCount: prev.show
            ? prev.newProviderCount + newProviderCount
            : newProviderCount,
          newModelCount: prev.show
            ? prev.newModelCount + newModelCount
            : newModelCount,
        };
        return next;
      });
    },
    [],
  );

  // Auto-dismiss whenever a success toast is visible.
  useEffect(() => {
    if (!state.show) {
      clearAutoDismiss();
      return;
    }
    clearAutoDismiss();
    autoDismissTimerRef.current = setTimeout(() => {
      dismiss(state.providers);
    }, AUTO_DISMISS_MS);
    return clearAutoDismiss;
  }, [
    state.show,
    state.providers,
    state.newProviderCount,
    state.newModelCount,
    dismiss,
    clearAutoDismiss,
  ]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<NewProvidersEventDetail>).detail;
      if (detail.providers.length === 0 && !detail.newModelCount) return;
      if (orgOnboardingVisible) {
        setPendingProviders((current) => [
          ...current,
          ...detail.providers.filter(
            (p) => !current.some((existing) => existing.id === p.id),
          ),
        ]);
        return;
      }
      showProviders(detail);
    };
    window.addEventListener(newProvidersEvent, handler);
    return () => window.removeEventListener(newProvidersEvent, handler);
  }, [orgOnboardingVisible, showProviders]);

  useEffect(() => {
    const handler = (event: Event) => {
      setOrgOnboardingVisible(
        Boolean((event as CustomEvent<{ visible?: boolean }>).detail?.visible),
      );
    };
    window.addEventListener(orgOnboardingVisibilityEvent, handler);
    return () => window.removeEventListener(orgOnboardingVisibilityEvent, handler);
  }, []);

  useEffect(() => {
    if (orgOnboardingVisible || pendingProviders.length === 0) return;
    showProviders({ providers: pendingProviders, source: "cloud_sync" });
    setPendingProviders([]);
  }, [orgOnboardingVisible, pendingProviders, showProviders]);

  if (!state.show || (state.providers.length === 0 && state.newModelCount === 0)) {
    return null;
  }

  const message = formatSuccessMessage(state);

  return (
    <FloatingToastFrame>
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-dls-status-success-soft text-dls-status-success-fg">
        <Check size={14} strokeWidth={2.5} aria-hidden="true" />
      </span>

      <div className="flex min-w-0 items-center gap-2">
        {state.providers.slice(0, 4).map((p) => (
          <ProviderIcon
            key={p.id}
            providerId={p.providerId}
            providerName={p.name}
            size={16}
            className="shrink-0 text-dls-text"
          />
        ))}
        <div className="min-w-0 text-sm font-medium text-dls-text">{message}</div>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0 rounded-lg text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
        onClick={() => dismiss(state.providers)}
        aria-label={t("common.dismiss")}
      >
        <X size={14} />
      </Button>
    </FloatingToastFrame>
  );
}
