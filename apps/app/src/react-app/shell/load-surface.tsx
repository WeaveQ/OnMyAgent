/** @jsxImportSource react */
/**
 * Shared loading chrome for boot, route Suspense, and page insets.
 * Prefer this over one-off OwDotTicker + "Starting OnMyAgent…" copies.
 */
import { useSyncExternalStore, type ReactNode } from "react";

import { APP_NAME } from "../../i18n/locales/brand";
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
  // Never use --dls-background here: on macOS Electron it is glass-mixed
  // (color-mix … transparent) and the shell bleeds through.
  full: "onmyagent-boot-overlay fixed inset-0 z-[1000] flex items-center justify-center",
  fullTransition:
    "onmyagent-boot-overlay fixed inset-0 z-[1000] flex items-center justify-center transition-opacity duration-300 ease-out",
  fullVisible: "pointer-events-auto opacity-100",
  fullFading: "pointer-events-none opacity-0",
  inset: "flex min-h-[12rem] w-full items-center justify-center py-10",
  // Hero monogram + airy stack (not a cramped loading card).
  content:
    "flex w-full max-w-[24rem] flex-col items-center gap-11 px-8 text-center",
  contentInset: "flex flex-col items-center",
  brandMark: "flex size-[7.5rem] items-center justify-center bg-transparent",
  brandTitle:
    "text-[1.0625rem] font-semibold tracking-tight text-dls-text",
  message: "text-[0.8125rem] leading-5 tracking-wide text-dls-secondary/90",
  messageInset: "mt-3 text-xs leading-5 text-dls-secondary",
  statusRow: "flex flex-col items-center gap-5",
  progressRow: "flex flex-col items-center gap-3.5",
  bootDots: "flex h-3 items-center gap-2",
  bootDot: "ow-dot-ticker size-[0.3125rem] rounded-full bg-dls-secondary/55",
};

/** Solid boot fill — independent of vibrancy tokens. */
const BOOT_SOLID_BG =
  "var(--dls-surface-solid, #ffffff)";

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

function BootBrandMark() {
  return (
    <div className={surfaceClass.brandMark} aria-hidden="true">
      {/* Compact monogram — avoid decoding the large product logo PNG. */}
      <img
        src="/onmyagent-boot-mark.png"
        width={112}
        height={112}
        alt=""
        draggable={false}
        className="size-[6.5rem] object-contain"
      />
    </div>
  );
}

/** Quiet three-dot pulse — calmer than the 3×3 grid on a full-screen splash. */
function BootProgressDots() {
  return (
    <div className={surfaceClass.bootDots} aria-hidden="true">
      <span className={surfaceClass.bootDot} style={{ animationDelay: "0s" }} />
      <span className={surfaceClass.bootDot} style={{ animationDelay: "0.2s" }} />
      <span className={surfaceClass.bootDot} style={{ animationDelay: "0.4s" }} />
    </div>
  );
}

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

  const size = props.size ?? (props.variant === "inset" ? "sm" : "lg");

  if (props.variant === "full") {
    const fading = props.fading === true;
    return (
      <div
        className={`${surfaceClass.fullTransition} ${
          fading ? surfaceClass.fullFading : surfaceClass.fullVisible
        }`}
        style={{ backgroundColor: BOOT_SOLID_BG }}
        aria-live="polite"
        aria-busy={!fading}
        role="status"
      >
        <div className={surfaceClass.content}>
          <BootBrandMark />
          <div className={surfaceClass.statusRow}>
            <div className={surfaceClass.brandTitle}>{APP_NAME}</div>
            <div className={surfaceClass.progressRow}>
              <BootProgressDots />
              <div className={surfaceClass.message}>{message}</div>
            </div>
          </div>
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
        <OwDotTicker size={size === "lg" ? "md" : size} />
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
      style={{ backgroundColor: BOOT_SOLID_BG }}
      aria-live="polite"
      aria-busy="true"
      role="status"
    >
      <div className={surfaceClass.content}>
        <BootBrandMark />
        <div className={surfaceClass.statusRow}>
          <div className={surfaceClass.brandTitle}>{APP_NAME}</div>
          <OwDotTicker size="lg" className="text-dls-secondary" />
          <div className={surfaceClass.message}>
            {props.messageKey
              ? t(props.messageKey)
              : t("system.boot_preparing_workspace")}
          </div>
        </div>
      </div>
    </div>
  );
}
