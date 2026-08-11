/** @jsxImportSource react */
/**
 * Shared loading chrome for boot, route Suspense, and page insets.
 * Prefer this over one-off OwDotTicker + "Starting OnMyAgent…" copies.
 */
import { useSyncExternalStore, type ReactNode } from "react";

import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { t } from "../../i18n";
import { resolvePublicAssetUrl } from "../../lib/public-asset-url";
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
  // Hero monogram + quiet progress (product name lives in the status line).
  content:
    "flex w-full max-w-[24rem] flex-col items-center gap-12 px-8 text-center",
  contentInset: "flex flex-col items-center",
  brandMark:
    "relative flex size-[9.5rem] items-center justify-center bg-transparent",
  brandMarkRing:
    "pointer-events-none absolute inset-0 rounded-full animate-[oma-boot-spin_1.05s_linear_infinite] motion-reduce:animate-none motion-reduce:opacity-40",
  brandMarkImg:
    "size-[6.75rem] object-contain animate-[oma-boot-breathe_2.6s_ease-in-out_infinite] motion-reduce:animate-none",
  message: "text-[0.8125rem] leading-5 tracking-wide text-dls-secondary/90",
  messageInset: "mt-3 text-xs leading-5 text-dls-secondary",
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
      {/* Soft spinner ring — common load pattern; no white sweep. */}
      <span
        className={surfaceClass.brandMarkRing}
        style={{
          border: "1.5px solid rgba(0, 93, 255, 0.1)",
          borderTopColor: "rgba(0, 93, 255, 0.65)",
          borderRightColor: "rgba(0, 93, 255, 0.22)",
        }}
      />
      <img
        src={resolvePublicAssetUrl("/onmyagent-boot-mark.png")}
        width={128}
        height={128}
        alt=""
        draggable={false}
        className={surfaceClass.brandMarkImg}
      />
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
        <div className={surfaceClass.message}>
          {props.messageKey
            ? t(props.messageKey)
            : t("system.boot_preparing_workspace")}
        </div>
      </div>
    </div>
  );
}
