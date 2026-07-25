/** @jsxImportSource react */
import {
  createContext,
  useCallback,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { StatusToast } from "./status-toast";
import { ComputerUseStatusMonitor } from "./computer-use-status-monitor";
import type {
  AppStatusToast,
  AppStatusToastInput,
  AppStatusToastTone,
} from "./status-toast-types";

export type {
  AppStatusToast,
  AppStatusToastInput,
  AppStatusToastTone,
} from "./status-toast-types";

export type StatusToastsStore = {
  toasts: AppStatusToast[];
  showToast: (input: AppStatusToastInput) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
};

const StatusToastsContext = createContext<StatusToastsStore | null>(null);

export const statusToastDurationForTone = (tone: AppStatusToastTone) => {
  if (tone === "warning" || tone === "error") return 4200;
  return 3200;
};

/** Fingerprint for content-level dedupe (same copy = one visible toast). */
export function statusToastContentKey(input: {
  title: string;
  description?: string | null;
  tone?: AppStatusToastTone;
}): string {
  const tone = input.tone ?? "info";
  const title = input.title.trim();
  const description = (input.description ?? "").trim();
  return `${tone}\u0000${title}\u0000${description}`;
}

/**
 * Merge a new toast into the stack. Identical content refreshes the existing
 * entry instead of stacking a duplicate (avoids double "原模型已不可用").
 */
export function mergeStatusToastStack(
  current: AppStatusToast[],
  next: AppStatusToast,
  max = 4,
): AppStatusToast[] {
  const key = statusToastContentKey(next);
  const existingIndex = current.findIndex(
    (toast) => statusToastContentKey(toast) === key,
  );
  if (existingIndex < 0) {
    return [...current, next].slice(-max);
  }
  const without = current.filter((_, index) => index !== existingIndex);
  // Keep original id so dismiss/timer ownership stays stable; bump content.
  const refreshed: AppStatusToast = { ...next, id: current[existingIndex]!.id };
  return [...without, refreshed].slice(-max);
}

type StatusToastsProviderProps = {
  children: ReactNode;
};

export function StatusToastsProvider({ children }: StatusToastsProviderProps) {
  const [toasts, setToasts] = useState<AppStatusToast[]>([]);
  const timersRef = useRef(new Map<string, number>());
  const counterRef = useRef(0);
  const contentIdRef = useRef(new Map<string, string>());

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    for (const [key, toastId] of contentIdRef.current) {
      if (toastId === id) contentIdRef.current.delete(key);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (input: AppStatusToastInput) => {
      const tone = input.tone ?? "info";
      const contentKey = statusToastContentKey({ ...input, tone });
      const existingId = contentIdRef.current.get(contentKey);
      const id =
        existingId ?? `status-toast-${Date.now()}-${counterRef.current++}`;
      contentIdRef.current.set(contentKey, id);

      const toast: AppStatusToast = { ...input, tone, id };
      setToasts((current) => mergeStatusToastStack(current, toast));

      const previousTimer = timersRef.current.get(id);
      if (previousTimer) {
        window.clearTimeout(previousTimer);
        timersRef.current.delete(id);
      }

      const duration = input.durationMs ?? statusToastDurationForTone(tone);
      if (duration > 0) {
        const timer = window.setTimeout(() => {
          timersRef.current.delete(id);
          if (contentIdRef.current.get(contentKey) === id) {
            contentIdRef.current.delete(contentKey);
          }
          setToasts((current) => current.filter((item) => item.id !== id));
        }, duration);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [],
  );

  const clearToasts = useCallback(() => {
    for (const timer of timersRef.current.values()) {
      window.clearTimeout(timer);
    }
    timersRef.current.clear();
    contentIdRef.current.clear();
    setToasts([]);
  }, []);

  useEffect(() => {
    return () => {
      const timers = timersRef.current;
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
      contentIdRef.current.clear();
    };
  }, []);

  const store = useMemo<StatusToastsStore>(
    () => ({ toasts, showToast, dismissToast, clearToasts }),
    [clearToasts, dismissToast, showToast, toasts],
  );

  return (
    <StatusToastsContext.Provider value={store}>
      <ComputerUseStatusMonitor showToast={showToast} />
      {children}
    </StatusToastsContext.Provider>
  );
}

export function useStatusToasts(): StatusToastsStore {
  const context = use(StatusToastsContext);
  if (!context) {
    throw new Error("useStatusToasts must be used within a StatusToastsProvider");
  }
  return context;
}

export function StatusToastsViewport() {
  const { toasts, dismissToast } = useStatusToasts();
  return (
    <>
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <StatusToast
            open
            tone={toast.tone}
            title={toast.title}
            description={toast.description ?? null}
            actionLabel={toast.actionLabel}
            onAction={toast.onAction}
            dismissLabel={toast.dismissLabel ?? "Dismiss"}
            onDismiss={() => dismissToast(toast.id)}
          />
        </div>
      ))}
    </>
  );
}
