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
import { t } from "../../i18n";

export type BootPhaseId =
  | "idle"
  | "bootstrapping-workspaces"
  | "starting-onmyagent-server"
  | "starting-engine"
  | "activating-workspace"
  | "ready"
  | "error";

export type BootStateSnapshot = {
  phase: BootPhaseId;
  message: string;
  detail: string | null;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
};

type BootStateContextValue = BootStateSnapshot & {
  routeReady: boolean;
  setPhase: (phase: BootPhaseId, detail?: string | null) => void;
  /**
   * User-facing error for the overlay. Prefer i18n; optional technical detail
   * is stored separately and not shown as the primary line.
   */
  setError: (message: string | null, technicalDetail?: string | null) => void;
  markReady: () => void;
  markRouteReady: () => void;
};

const DEFAULT_STATE: BootStateSnapshot = {
  phase: "idle",
  message: "",
  detail: null,
  startedAt: null,
  completedAt: null,
  error: null,
};

/** Resolve phase copy at call time so locale switches stay correct. */
export function bootPhaseMessage(phase: BootPhaseId): string {
  switch (phase) {
    case "idle":
      return "";
    case "bootstrapping-workspaces":
      return t("system.boot_loading_workspaces");
    case "starting-onmyagent-server":
      return t("system.boot_starting_server");
    case "starting-engine":
      return t("system.boot_preparing_workspace");
    case "activating-workspace":
      return t("system.boot_activating_workspace");
    case "ready":
      return t("system.boot_ready");
    case "error":
      return t("system.boot_error");
    default:
      return t("system.boot_preparing_workspace");
  }
}

/**
 * Map unknown/raw failures to a short user-facing string. Raw stack or
 * engine strings become a generic message; known i18n keys pass through.
 */
export function userFacingBootError(
  error: unknown,
  fallbackKey = "system.boot_start_runtime_failed",
): { message: string; technicalDetail: string | null } {
  if (error == null || error === "") {
    return { message: t(fallbackKey), technicalDetail: null };
  }
  if (typeof error === "string") {
    const trimmed = error.trim();
    // Already localized product copy (zh/en short sentences without stack).
    if (
      trimmed &&
      !trimmed.includes("\n") &&
      !/Error:|at\s+\S+\s+\(|ENOENT|ECONNREFUSED|TypeError/i.test(trimmed) &&
      trimmed.length < 160
    ) {
      // Prefer known friendly templates when the string matches English internals.
      if (/did not finish starting/i.test(trimmed)) {
        return {
          message: t("system.boot_server_not_ready"),
          technicalDetail: trimmed,
        };
      }
      if (/Failed to start OnMyAgent runtime/i.test(trimmed)) {
        return {
          message: t("system.boot_start_runtime_failed"),
          technicalDetail: trimmed,
        };
      }
      return { message: trimmed, technicalDetail: null };
    }
    return {
      message: t(fallbackKey),
      technicalDetail: trimmed || null,
    };
  }
  if (error instanceof Error) {
    return userFacingBootError(error.message, fallbackKey);
  }
  try {
    const serialized = JSON.stringify(error);
    return {
      message: t(fallbackKey),
      technicalDetail:
        serialized && serialized !== "{}" ? serialized.slice(0, 500) : null,
    };
  } catch {
    return { message: t(fallbackKey), technicalDetail: null };
  }
}

const BootStateContext = createContext<BootStateContextValue | null>(null);

export function BootStateProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<BootStateSnapshot>(DEFAULT_STATE);
  // Once the main route has enough shell chrome to paint (workspace list and
  // optionally cached sidebar titles), we consider the app interactive. This
  // is a one-way latch so subsequent background refreshes never re-show the
  // overlay. Session index and engine warm-up continue after this latch.
  const [routeReady, setRouteReady] = useState(false);
  const startedAtRef = useRef<number | null>(null);

  const setPhase = useCallback((phase: BootPhaseId, detail?: string | null) => {
    setSnapshot((current) => {
      const nextStartedAt =
        current.phase === "idle" && phase !== "idle"
          ? (startedAtRef.current = Date.now())
          : (startedAtRef.current ?? current.startedAt);
      return {
        ...current,
        phase,
        message: bootPhaseMessage(phase) || current.message,
        detail: detail ?? null,
        startedAt: nextStartedAt,
        completedAt: phase === "ready" ? Date.now() : null,
        error: phase === "error" ? current.error : null,
      };
    });
  }, []);

  const setError = useCallback(
    (message: string | null, technicalDetail?: string | null) => {
      setSnapshot((current) => ({
        ...current,
        error: message,
        phase: message ? "error" : current.phase,
        message: message ? bootPhaseMessage("error") : current.message,
        detail:
          technicalDetail === undefined
            ? current.detail
            : technicalDetail,
      }));
    },
    [],
  );

  const markReady = useCallback(() => {
    setSnapshot((current) => ({
      ...current,
      phase: "ready",
      message: bootPhaseMessage("ready"),
      detail: null,
      completedAt: Date.now(),
      error: null,
    }));
  }, []);

  const markRouteReady = useCallback(() => {
    setRouteReady(true);
  }, []);

  const value = useMemo<BootStateContextValue>(
    () => ({
      ...snapshot,
      routeReady,
      setPhase,
      setError,
      markReady,
      markRouteReady,
    }),
    [markReady, markRouteReady, routeReady, setError, setPhase, snapshot],
  );

  return (
    <BootStateContext.Provider value={value}>{children}</BootStateContext.Provider>
  );
}

export function useBootState(): BootStateContextValue {
  const value = use(BootStateContext);
  if (!value) {
    throw new Error("useBootState must be used inside <BootStateProvider>");
  }
  return value;
}

/**
 * Overlay stays up until the main route has enough shell data (`routeReady`).
 * Engine/runtime may still be warming (phase `starting-engine`, etc.); that
 * continues as in-app status rather than a full-screen blocker so cold start
 * feels interactive sooner. Errors keep the overlay so retry chrome is visible.
 *
 * After `canHide` we hold ~200ms so the fade feels intentional instead of a flicker.
 */
export function useBootOverlayVisible(): boolean {
  const { phase, routeReady } = useBootState();
  // HMR can remount the provider while the route tree stays mounted. In that
  // state the boot phase falls back to `idle`, but the already-rendered route
  // is interactive and can mark itself ready again.
  // Progressive: once the route painted shell chrome, hide even if desktop
  // boot is still on starting-engine / activating-workspace.
  const canHide = routeReady && phase !== "error";
  const [visible, setVisible] = useState(!canHide);

  useEffect(() => {
    if (canHide) {
      const handle = window.setTimeout(() => setVisible(false), 200);
      return () => window.clearTimeout(handle);
    }
    setVisible(true);
    return undefined;
  }, [canHide]);

  return visible;
}
