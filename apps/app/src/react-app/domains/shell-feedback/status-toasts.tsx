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
 * Merge a new toast into the stack. A toast with a `tag` replaces any existing
 * toast with the same tag in place (stable id, no timer reset) — this is what
 * lets a progress toast update its percentage every second without stacking or
 * restarting its auto-dismiss. Toasts without a tag dedupe by content
 * fingerprint (same copy = one visible toast).
 */
export function mergeStatusToastStack(
  current: AppStatusToast[],
  next: AppStatusToast,
  max = 4,
): AppStatusToast[] {
  if (next.tag) {
    const existingIndex = current.findIndex(
      (toast) => toast.tag === next.tag,
    );
    if (existingIndex >= 0) {
      const without = current.filter((_, index) => index !== existingIndex);
      // Preserve the original id so its dismiss timer (if any) keeps running
      // and ownership stays stable; bump the rest of the content.
      const updated: AppStatusToast = {
        ...next,
        id: current[existingIndex]!.id,
      };
      return [...without, updated];
    }
    return [...current, next].slice(-max);
  }

  const key = statusToastContentKey(next);
  const existingIndex = current.findIndex(
    (toast) => !toast.tag && statusToastContentKey(toast) === key,
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
  const toastsRef = useRef<AppStatusToast[]>([]);
  const timersRef = useRef(new Map<string, number>());
  const counterRef = useRef(0);
  const contentIdRef = useRef(new Map<string, string>());
  const tagIdRef = useRef(new Map<string, string>());

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    // Resolve callbacks from the mirrored ref — never from inside a setState
    // updater (updaters may run async / twice under Strict Mode).
    const toast = toastsRef.current.find((item) => item.id === id);
    const onDismiss = toast?.onDismiss;
    for (const [key, toastId] of contentIdRef.current) {
      if (toastId === id) contentIdRef.current.delete(key);
    }
    for (const [tag, toastId] of tagIdRef.current) {
      if (toastId === id) tagIdRef.current.delete(tag);
    }
    setToasts((current) => {
      const next = current.filter((item) => item.id !== id);
      toastsRef.current = next;
      return next;
    });
    onDismiss?.();
  }, []);

  const showToast = useCallback(
    (input: AppStatusToastInput) => {
      const tone = input.tone ?? "info";
      // Tagged toasts (e.g. download progress) update in place under a stable
      // identity; untagged toasts dedupe by content fingerprint.
      let id: string;
      let isUpdate = false;
      if (input.tag) {
        const existing = tagIdRef.current.get(input.tag);
        if (existing) {
          id = existing;
          isUpdate = true;
        } else {
          id = `status-toast-${Date.now()}-${counterRef.current++}`;
          tagIdRef.current.set(input.tag, id);
        }
      } else {
        const contentKey = statusToastContentKey({ ...input, tone });
        const existingId = contentIdRef.current.get(contentKey);
        id =
          existingId ?? `status-toast-${Date.now()}-${counterRef.current++}`;
        contentIdRef.current.set(contentKey, id);
      }

      const toast: AppStatusToast = { ...input, tone, id };
      setToasts((current) => {
        const next = mergeStatusToastStack(current, toast);
        toastsRef.current = next;
        return next;
      });

      // For a tagged in-place update, keep the existing auto-dismiss timer (if
      // any) running rather than restarting it on every progress tick.
      if (isUpdate) {
        return id;
      }

      const previousTimer = timersRef.current.get(id);
      if (previousTimer) {
        window.clearTimeout(previousTimer);
        timersRef.current.delete(id);
      }

      const duration = input.durationMs ?? statusToastDurationForTone(tone);
      if (duration > 0) {
        const timer = window.setTimeout(() => {
          timersRef.current.delete(id);
          if (input.tag) {
            if (tagIdRef.current.get(input.tag) === id) {
              tagIdRef.current.delete(input.tag);
            }
          } else {
            const contentKey = statusToastContentKey({ ...input, tone });
            if (contentIdRef.current.get(contentKey) === id) {
              contentIdRef.current.delete(contentKey);
            }
          }
          // Auto-dismiss should also fire onDismiss so consumers can clear
          // "user dismissed" / ownership flags consistently.
          const current = toastsRef.current.find((item) => item.id === id);
          const onDismiss = current?.onDismiss;
          setToasts((stack) => {
            const next = stack.filter((item) => item.id !== id);
            toastsRef.current = next;
            return next;
          });
          onDismiss?.();
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
    tagIdRef.current.clear();
    toastsRef.current = [];
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
      tagIdRef.current.clear();
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
            icon={toast.icon}
            spinIcon={toast.spinIcon}
          />
        </div>
      ))}
    </>
  );
}
