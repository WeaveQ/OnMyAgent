/** @jsxImportSource react */
/**
 * Shared loading chrome for boot, route Suspense, and page insets.
 * Prefer this over one-off OwDotTicker + "Starting OnMyAgent…" copies.
 */
import { useSyncExternalStore, type ReactNode } from "react";

import { t } from "../../i18n";
import { OwDotTicker } from "./dot-ticker";
import {
  getRouteLoadSnapshot,
  subscribeRouteLoad,
  type LoadScopeDefinition,
  type LoadScopeId,
  beginLoadScope,
  endLoadScope,
} from "./route-load-registry";
import { useEffect } from "react";

const surfaceClass = {
  full: "fixed inset-0 z-[1000] flex items-center justify-center bg-dls-surface",
  fullTransition:
    "fixed inset-0 z-[1000] flex items-center justify-center bg-dls-surface transition-opacity duration-[160ms]",
  fullVisible: "pointer-events-auto opacity-100",
  fullFading: "pointer-events-none opacity-0",
  inset: "flex min-h-[12rem] w-full items-center justify-center py-10",
  content: "flex w-full max-w-[320px] flex-col items-center gap-4 px-6 text-center",
  contentInset: "flex flex-col items-center",
  message: "text-xs leading-5 text-dls-secondary",
  messageInset: "mt-3 text-xs leading-5 text-dls-secondary",
};

function resolveMessage(
  def: LoadScopeDefinition | null | undefined,
  fallbackKey: string,
  detail?: string | null,
): string {
  const base = def?.messageKey
    ? t(def.messageKey)
    : def?.defaultMessage || t(fallbackKey);
  if (detail?.trim()) return `${base} · ${detail.trim()}`;
  return base;
}

export function useRouteLoadTop(): {
  top: LoadScopeDefinition | null;
  detail: string | null;
  busy: boolean;
} {
  const snap = useSyncExternalStore(
    subscribeRouteLoad,
    getRouteLoadSnapshot,
    getRouteLoadSnapshot,
  );
  return { top: snap.top, detail: snap.topDetail, busy: snap.busy };
}

/** Report a load scope for the lifetime of the mounted subtree / effect. */
export function useLoadScope(
  id: LoadScopeId,
  active: boolean,
  detail?: string | null,
): void {
  useEffect(() => {
    if (!active) return;
    const end = beginLoadScope(id, detail);
    return end;
  }, [active, detail, id]);
}

type LoadSurfaceProps = {
  variant: "full" | "inset";
  /** Override message; otherwise registry top or fallback. */
  message?: string;
  messageKey?: string;
  size?: "sm" | "md";
  fading?: boolean;
  children?: ReactNode;
};

/**
 * Unified spinner surface. `full` matches boot overlay; `inset` matches
 * settings tab suspense.
 */
export function LoadSurface(props: LoadSurfaceProps) {
  const { top, detail } = useRouteLoadTop();
  const message =
    props.message ??
    (props.messageKey ? t(props.messageKey) : null) ??
    resolveMessage(top, "system.boot_preparing_workspace", detail);

  const size = props.size ?? (props.variant === "inset" ? "sm" : "md");

  if (props.variant === "full") {
    const fading = props.fading === true;
    return (
      <div
        className={`${surfaceClass.fullTransition} ${
          fading ? surfaceClass.fullFading : surfaceClass.fullVisible
        }`}
        aria-live="polite"
        aria-busy={!fading}
        role="status"
      >
        <div className={surfaceClass.content}>
          <OwDotTicker size={size} />
          <div className={surfaceClass.message}>{message}</div>
          {props.children}
        </div>
      </div>
    );
  }

  return (
    <div
      className={surfaceClass.inset}
      aria-live="polite"
      aria-busy="true"
      role="status"
    >
      <div className={surfaceClass.contentInset}>
        <OwDotTicker size={size} />
        <div className={surfaceClass.messageInset}>{message}</div>
        {props.children}
      </div>
    </div>
  );
}

/** Static full-screen fallback for React.lazy route chunks (no registry needed). */
export function RouteChunkFallback(props: {
  scope?: LoadScopeId;
  messageKey?: string;
}) {
  const def = props.scope
    ? // lazy import avoided circular: use message key only
      null
    : null;
  void def;
  return (
    <div
      className={surfaceClass.full}
      aria-live="polite"
      aria-busy="true"
      role="status"
    >
      <div className={surfaceClass.content}>
        <OwDotTicker size="md" />
        <div className={surfaceClass.message}>
          {props.messageKey
            ? t(props.messageKey)
            : t("system.boot_preparing_workspace")}
        </div>
      </div>
    </div>
  );
}
