/** @jsxImportSource react */
import type { ReactNode } from "react";
import { Loader2, MessageCircle, Plus } from "lucide-react";

import { StatusDot } from "@/components/ui/status-dot";
import { t } from "@/i18n";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";

import {
  connectorTileActionClassName,
  connectorTileActionPlusClassName,
  connectorTileClassName,
  connectorTileDescClassName,
  connectorTileHeaderClassName,
  connectorTileOrderClass,
} from "./connector-tile";

/**
 * Connection health for recommend-style connector cards.
 * - connected: green dot + chat bubble (go try)
 * - error: red dot
 * - pending: amber pulse / spinner action
 * - idle: no dot / + to connect
 */
export type ConnectorCardStatus = "connected" | "error" | "pending" | "idle";

export type ConnectorStatusCardProps = {
  name: string;
  description: string;
  iconSrc?: string | null;
  /** Fallback letter when no icon. */
  iconFallback?: string;
  status: ConnectorCardStatus;
  /** Busy overlay on the action control. */
  busy?: boolean;
  /** Open detail / connect dialog. */
  onOpen: () => void;
  /**
   * Right-side action:
   * - connected → chat bubble (try)
   * - idle / error → plus (connect)
   * Defaults to onOpen when omitted.
   */
  onAction?: () => void;
  /**
   * Compact one-line status under description (fixed-height tiles).
   * Prefer this over fat NoticeBox footers so the grid stays aligned.
   */
  errorLine?: string | null;
  /** Full message for native tooltip when errorLine is truncated. */
  errorTitle?: string | null;
  /** Optional extra under description (avoid large banners). */
  footer?: ReactNode;
  className?: string;
  "data-plugin-id"?: string;
};

function connectorStatusDot(status: ConnectorCardStatus) {
  switch (status) {
    case "connected":
      return <StatusDot size="xs" tone="success" />;
    case "error":
      return <StatusDot size="xs" tone="danger" />;
    case "pending":
      return <StatusDot size="xs" tone="warning" pulse />;
    case "idle":
      return null;
  }
}

/**
 * Image #1 style recommend card: logo + name·dot + 2-line desc + bubble/+.
 */
export function ConnectorStatusCard(props: ConnectorStatusCardProps) {
  const enabled = props.status === "connected";
  const action = props.onAction ?? props.onOpen;
  const showChat = props.status === "connected";
  const showPlus =
    props.status === "idle" ||
    props.status === "error" ||
    props.status === "pending";

  return (
    <article
      role="button"
      tabIndex={0}
      data-plugin-id={props["data-plugin-id"]}
      data-status={props.status}
      aria-busy={props.busy}
      className={cn(
        connectorTileClassName,
        connectorTileOrderClass(enabled),
        props.className,
      )}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen();
        }
      }}
      aria-label={`${props.name}. ${t("plugins.artifact_open")}`}
    >
      <div className={connectorTileHeaderClassName}>
        <div className="size-9 shrink-0 overflow-hidden rounded-md border border-black/5 bg-dls-surface">
          {props.iconSrc ? (
            <img
              src={resolvePublicAssetUrl(props.iconSrc)}
              alt=""
              className="size-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-sm font-semibold text-dls-text">
              {(props.iconFallback ?? props.name).trim().slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="min-w-0 truncate text-sm font-semibold leading-5 text-dls-text">
              {props.name}
            </h3>
            {connectorStatusDot(props.status)}
          </div>
          <div
            className="shrink-0"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {props.busy ? (
              <span
                className={cn(
                  connectorTileActionClassName,
                  "text-dls-secondary",
                )}
              >
                <Loader2 className="size-4 animate-spin" aria-hidden />
              </span>
            ) : showChat ? (
              <button
                type="button"
                className={cn(connectorTileActionClassName, "text-dls-text/90")}
                aria-label={t("plugins.connector_try_it")}
                onClick={action}
              >
                <MessageCircle className="size-4" strokeWidth={2} aria-hidden />
              </button>
            ) : showPlus ? (
              <button
                type="button"
                className={connectorTileActionPlusClassName}
                aria-label={t("plugins.add")}
                onClick={action}
              >
                <Plus className="size-4" strokeWidth={2.5} aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <p className={connectorTileDescClassName} title={props.description}>
        {props.description || "\u00a0"}
      </p>
      {props.errorLine ? (
        <p
          className="mt-auto shrink-0 truncate text-2xs leading-4 text-dls-status-danger-fg/90"
          title={props.errorTitle?.trim() || props.errorLine}
          role="status"
        >
          {props.errorLine}
        </p>
      ) : props.footer ? (
        <div className="mt-auto min-h-0 shrink-0 pt-0.5">{props.footer}</div>
      ) : (
        <div className="mt-auto h-0 shrink-0" aria-hidden />
      )}
    </article>
  );
}
